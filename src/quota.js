"use strict";

// Claude Code usage quota (功能1). Read OAuth credentials, call the Anthropic
// usage endpoint, normalize to the limit windows. Pure/injectable (fetch / fs /
// exec / now) so request + parse logic is unit-testable. Let it crash — no
// fabricated numbers; every failure surfaces as a status the UI shows verbatim.

const path = require("path");

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CACHE_TTL_MS = 300000; // 5 min

// The 4 limit windows the endpoint reports. five_hour is the headline; the
// weekly ones are secondary in the UI. Order here = display order.
const USAGE_WINDOWS = [
  { key: "five_hour", label: "5 小时" },
  { key: "seven_day", label: "7 天" },
  { key: "seven_day_opus", label: "Opus 7 天" },
  { key: "seven_day_sonnet", label: "Sonnet 7 天" },
];

function parseToken(jsonText) {
  const obj = JSON.parse(jsonText);
  const entry = obj.claudeAiOauth || obj["claude.ai_oauth"];
  if (!entry || typeof entry.accessToken !== "string" || !entry.accessToken) {
    throw new Error("quota: credentials missing accessToken");
  }
  return { accessToken: entry.accessToken, expiresAt: Number(entry.expiresAt) || 0 };
}

// expiresAt > 1e12 is treated as a ms epoch (spec). Below that we cannot tell ms
// from seconds, so we do NOT pre-block — the API 401/403 is the source of truth
// for an expired token.
function isExpired(expiresAt, now) {
  if (typeof expiresAt !== "number" || expiresAt <= 1e12) return false;
  return expiresAt <= now;
}

// utilization is already a 0-100 percent (spec: don't compute it). The live API
// field is snake_case `resets_at` (ISO8601) and can be null — a window with a
// numeric utilization is kept even when resets_at is null (no countdown shown);
// a null/missing window is skipped — never invented.
function normalizeUsage(data) {
  const out = [];
  if (!data || typeof data !== "object") return out;
  for (const { key, label } of USAGE_WINDOWS) {
    const w = data[key];
    if (!w || typeof w.utilization !== "number") continue;
    const resetsAt = typeof w.resets_at === "string" ? w.resets_at : null;
    out.push({ key, label, utilization: w.utilization, resetsAt });
  }
  return out;
}

function formatCountdown(resetsAt, now) {
  const t = Date.parse(resetsAt);
  if (!Number.isFinite(t)) return "";
  const ms = t - now;
  if (ms <= 0) return "已重置";
  if (ms < 60000) return "<1m";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

function usageColor(utilization) {
  if (utilization >= 90) return "red";
  if (utilization >= 70) return "orange";
  return "normal";
}

function formatPct(utilization) {
  return `${Math.round(utilization)}%`;
}

function countCodexModels(cache) {
  if (!cache || typeof cache !== "object") return 0;
  if (Array.isArray(cache.models)) return cache.models.length;
  if (cache.models && typeof cache.models === "object") return Object.keys(cache.models).length;
  if (Array.isArray(cache.data)) return cache.data.length;
  return 0;
}

function resolveCodexAuthPath({ homedir, codexHome }) {
  return path.join(codexHome || process.env.CODEX_HOME || path.join(homedir, ".codex"), "auth.json");
}

function readCodexAuthText({ platform, homedir, codexHome, readFileImpl, execFileImpl }) {
  if (platform === "darwin" && typeof execFileImpl === "function") {
    try {
      const blob = execFileImpl("security", ["find-generic-password", "-s", "Codex Auth", "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const text = String(blob || "").trim();
      if (text) return text;
    } catch {}
  }
  return readFileImpl(resolveCodexAuthPath({ homedir, codexHome }), "utf8");
}

function parseDateTimeMs(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  if (typeof value !== "string" || !value.trim()) return NaN;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const utcParsed = Date.parse(`${value}Z`);
  return Number.isFinite(utcParsed) ? utcParsed : NaN;
}

function isStaleCodexRefresh(value, now) {
  const refreshedAt = parseDateTimeMs(value);
  if (!Number.isFinite(refreshedAt)) return false;
  return now - refreshedAt > 8 * 24 * 60 * 60 * 1000;
}

function parseCodexCredential(jsonText, now = Date.now()) {
  const auth = JSON.parse(jsonText);
  const tokens = auth && typeof auth === "object" ? (auth.tokens || auth) : {};
  const authMode = auth && typeof auth === "object" ? (auth.auth_mode || auth.authMode || null) : null;
  const accessToken = tokens && (tokens.access_token || tokens.accessToken);
  const accountId = tokens && (tokens.account_id || tokens.accountID || tokens.accountId);
  const apiKey = auth && typeof auth === "object" ? auth.api_key : null;

  if (authMode && authMode !== "chatgpt") {
    return { status: "not_logged_in", message: "Codex 未使用 ChatGPT 登录" };
  }
  if (typeof accessToken !== "string" || !accessToken) {
    if (typeof apiKey === "string" && apiKey) {
      return { status: "ok", apiKeyOnly: true, message: "已配置 API Key · 暂无 ChatGPT 额度百分比" };
    }
    throw new Error("quota: Codex credentials missing access_token");
  }
  if (auth && isStaleCodexRefresh(auth.last_refresh || auth.lastRefresh, now)) {
    return {
      status: "expired",
      accessToken,
      accountId: typeof accountId === "string" ? accountId : null,
      message: "Codex 需要重新登录",
    };
  }
  return {
    status: "ok",
    accessToken,
    accountId: typeof accountId === "string" ? accountId : null,
  };
}

function readCodexStatus({ platform, homedir, codexHome, readFileImpl, execFileImpl, now = Date.now() }) {
  let raw;
  try {
    raw = readCodexAuthText({ platform, homedir, codexHome, readFileImpl, execFileImpl });
  } catch {
    return {
      status: "not_logged_in",
      label: "Codex",
      message: "未检测到 Codex 登录",
    };
  }

  let credential;
  try {
    credential = parseCodexCredential(raw, now);
  } catch {
    return {
      status: "not_logged_in",
      label: "Codex",
      message: "未检测到 Codex 登录",
    };
  }
  if (credential.status !== "ok") {
    return {
      status: credential.status,
      label: "Codex",
      message: credential.message || "未检测到 Codex 登录",
    };
  }

  let modelCount = 0;
  try {
    const rawCache = readFileImpl(path.join(path.dirname(resolveCodexAuthPath({ homedir, codexHome })), "models_cache.json"), "utf8");
    modelCount = countCodexModels(JSON.parse(rawCache));
  } catch {}

  const suffix = modelCount > 0 ? ` · ${modelCount} 个模型缓存` : "";
  return {
    status: "ok",
    label: "Codex",
    message: credential.message || `已登录${suffix} · 暂无本地额度百分比`,
  };
}

function codexWindowLabel(seconds) {
  const n = Number(seconds);
  if (n === 18000) return "5 小时";
  if (n === 604800) return "7 天";
  if (Number.isFinite(n) && n > 0) return `${Math.round(n)} 秒`;
  return "未知";
}

function codexResetToIso(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeCodexUsage(data) {
  const rateLimit = data && typeof data === "object" ? data.rate_limit : null;
  if (!rateLimit || typeof rateLimit !== "object") return [];
  return [
    { key: "primary_window", source: rateLimit.primary_window },
    { key: "secondary_window", source: rateLimit.secondary_window },
  ].map(({ key, source }) => {
    if (!source || typeof source !== "object" || typeof source.used_percent !== "number") return null;
    return {
      key,
      label: codexWindowLabel(source.limit_window_seconds),
      utilization: source.used_percent,
      resetsAt: codexResetToIso(source.reset_at),
    };
  }).filter(Boolean);
}

// Platform split (mirrors src/focus.js). Win/Linux: the plaintext JSON file.
// macOS: the file usually doesn't exist — the blob lives in the Keychain under
// service "Claude Code-credentials", read via the `security` CLI. Injected
// readFileImpl / execFileImpl keep this testable; both are SYNC and return the
// raw JSON string.
function readCredentials({ platform, homedir, readFileImpl, execFileImpl }) {
  if (platform === "darwin") {
    const blob = execFileImpl("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return String(blob).trim();
  }
  const p = path.join(homedir, ".claude", ".credentials.json");
  return readFileImpl(p, "utf8");
}

// GET the OAuth usage endpoint. anthropic-beta is a hardcoded beta flag —
// Anthropic may change / retire it, which would surface as a 4xx here. No body,
// no anthropic-version, no User-Agent (per spec). 10s timeout via AbortController.
async function fetchUsage({ accessToken, fetchImpl, timeoutMs = 10000 }) {
  const impl = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!impl) throw new Error("quota: no fetch implementation available");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await impl(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20", // Anthropic 改版可能失效
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (resp.status === 401 || resp.status === 403) {
    const e = new Error("quota: unauthorized (token expired?)"); e.code = "EXPIRED"; throw e;
  }
  if (!resp.ok) {
    const e = new Error(`quota: HTTP ${resp.status}`); e.code = "HTTP"; e.status = resp.status; throw e;
  }
  return resp.json();
}

async function fetchCodexUsage({ accessToken, accountId, fetchImpl, timeoutMs = 10000 }) {
  const impl = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!impl) throw new Error("quota: no fetch implementation available");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "codex-cli",
    Accept: "application/json",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  let resp;
  try {
    resp = await impl(CODEX_USAGE_URL, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (resp.status === 401 || resp.status === 403) {
    const e = new Error("quota: Codex unauthorized (token expired?)"); e.code = "EXPIRED"; throw e;
  }
  if (!resp.ok) {
    const e = new Error(`quota: Codex HTTP ${resp.status}`); e.code = "HTTP"; e.status = resp.status; throw e;
  }
  return resp.json();
}

async function loadCodexUsage({ platform, homedir, codexHome, readFileImpl, execFileImpl, fetchImpl, now }) {
  let raw;
  try {
    raw = readCodexAuthText({ platform, homedir, codexHome, readFileImpl, execFileImpl });
  } catch {
    return {
      status: "not_logged_in",
      label: "Codex",
      message: "未检测到 Codex 登录",
    };
  }

  let credential;
  try {
    credential = parseCodexCredential(raw, now());
  } catch {
    return {
      status: "not_logged_in",
      label: "Codex",
      message: "未检测到 Codex 登录",
    };
  }

  if (credential.status === "expired") {
    return { status: "expired", label: "Codex", message: credential.message || "Codex 需要重新登录" };
  }
  if (credential.status !== "ok" || !credential.accessToken) {
    return readCodexStatus({ platform, homedir, codexHome, readFileImpl, execFileImpl, now: now() });
  }

  try {
    const data = await fetchCodexUsage({
      accessToken: credential.accessToken,
      accountId: credential.accountId,
      fetchImpl,
    });
    const windows = normalizeCodexUsage(data);
    return {
      status: "ok",
      label: "Codex",
      windows,
      fetchedAt: now(),
      message: windows.length > 0 ? "已登录" : "已登录 · 暂无额度窗口",
    };
  } catch (e) {
    if (e.code === "EXPIRED") return { status: "expired", label: "Codex", message: "Codex 需要重新登录" };
    return {
      status: "error",
      label: "Codex",
      message: `Codex 用量读取失败：${e.message || "接口错误"}`,
    };
  }
}

// createQuota(deps) -> { getUsage({force}) -> result, peek() }
// result.status: "ok" | "stale" | "not_logged_in" | "expired" | "error"
//   ok/stale carry .windows (normalized); stale/error carry .message.
function createQuota(deps = {}) {
  const fetchImpl = deps.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const readFileImpl = deps.readFileImpl || require("fs").readFileSync;
  const execFileImpl = deps.execFileImpl || require("child_process").execFileSync;
  const platform = deps.platform || process.platform;
  const homedir = deps.homedir || require("os").homedir();
  const codexHome = deps.codexHome || null;
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const ttl = Number.isFinite(deps.cacheTtlMs) ? deps.cacheTtlMs : CACHE_TTL_MS;

  let cache = null; // { at, result } — latest displayable result
  let lastOk = null; // last successful Claude usage result for stale fallback
  let lastCodexOk = null;

  async function codex() {
    const result = await loadCodexUsage({ platform, homedir, codexHome, readFileImpl, execFileImpl, fetchImpl, now });
    if (result.status === "ok" && Array.isArray(result.windows) && result.windows.length > 0) {
      lastCodexOk = result;
      return result;
    }
    if (result.status === "error" && lastCodexOk) {
      return { ...lastCodexOk, status: "stale", message: "Codex 刷新失败，显示上次数据" };
    }
    return result;
  }

  async function loadClaude() {
    let raw;
    try { raw = readCredentials({ platform, homedir, readFileImpl, execFileImpl }); }
    catch { return { status: "not_logged_in" }; }
    let token;
    try { token = parseToken(raw); } catch { return { status: "not_logged_in" }; }
    if (isExpired(token.expiresAt, now())) return { status: "expired" };
    try {
      const data = await fetchUsage({ accessToken: token.accessToken, fetchImpl });
      return { status: "ok", windows: normalizeUsage(data), fetchedAt: now() };
    } catch (e) {
      if (e.code === "EXPIRED") return { status: "expired" };
      return { status: "error", message: e.message };
    }
  }

  async function load() {
    const [claudeResult, codexResult] = await Promise.all([loadClaude(), codex()]);
    return { ...claudeResult, codex: codexResult };
  }

  async function getUsage({ force = false } = {}) {
    const t = now();
    if (!force && cache && t - cache.at < ttl) return cache.result;
    const result = await load();
    if (result.status === "ok") {
      lastOk = result;
      cache = { at: t, result };
      return result;
    }
    // Don't fabricate: keep showing the last good numbers, flagged stale.
    if (lastOk && lastOk.status === "ok") {
      const stale = { ...lastOk, status: "stale", message: "刷新失败", codex: result.codex || lastOk.codex };
      cache = { at: t, result: stale };
      return stale;
    }
    cache = { at: t, result };
    return result;
  }

  return { getUsage, peek: () => (cache && cache.result) || null };
}

module.exports = {
  USAGE_URL,
  CODEX_USAGE_URL,
  CACHE_TTL_MS,
  USAGE_WINDOWS,
  parseToken,
  isExpired,
  normalizeUsage,
  parseCodexCredential,
  normalizeCodexUsage,
  formatCountdown,
  usageColor,
  formatPct,
  countCodexModels,
  resolveCodexAuthPath,
  readCodexAuthText,
  readCodexStatus,
  readCredentials,
  fetchUsage,
  fetchCodexUsage,
  loadCodexUsage,
  createQuota,
};
