"use strict";

// Claude Code usage quota (功能1). Read OAuth credentials, call the Anthropic
// usage endpoint, normalize to the limit windows. Pure/injectable (fetch / fs /
// exec / now) so request + parse logic is unit-testable. Let it crash — no
// fabricated numbers; every failure surfaces as a status the UI shows verbatim.

const path = require("path");

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
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

// utilization is already a 0-100 percent (spec: don't compute it). resetsAt is
// ISO8601. A window missing either field is skipped — never invented.
function normalizeUsage(data) {
  const out = [];
  if (!data || typeof data !== "object") return out;
  for (const { key, label } of USAGE_WINDOWS) {
    const w = data[key];
    if (!w || typeof w.utilization !== "number" || typeof w.resetsAt !== "string") continue;
    out.push({ key, label, utilization: w.utilization, resetsAt: w.resetsAt });
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

// Platform split (mirrors src/focus.js). Win/Linux: the plaintext JSON file.
// macOS: the file usually doesn't exist — the blob lives in the Keychain under
// service "Claude Code-credentials", read via the `security` CLI. Injected
// readFileImpl / execFileImpl keep this testable; both are SYNC and return the
// raw JSON string.
function readCredentials({ platform, homedir, readFileImpl, execFileImpl }) {
  if (platform === "darwin") {
    const blob = execFileImpl("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { encoding: "utf8" });
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

// createQuota(deps) -> { getUsage({force}) -> result, peek() }
// result.status: "ok" | "stale" | "not_logged_in" | "expired" | "error"
//   ok/stale carry .windows (normalized); stale/error carry .message.
function createQuota(deps = {}) {
  const fetchImpl = deps.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const readFileImpl = deps.readFileImpl || require("fs").readFileSync;
  const execFileImpl = deps.execFileImpl || require("child_process").execFileSync;
  const platform = deps.platform || process.platform;
  const homedir = deps.homedir || require("os").homedir();
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const ttl = Number.isFinite(deps.cacheTtlMs) ? deps.cacheTtlMs : CACHE_TTL_MS;

  let cache = null; // { at, result } — only ever holds an "ok" result

  async function load() {
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

  async function getUsage({ force = false } = {}) {
    const t = now();
    if (!force && cache && t - cache.at < ttl) return cache.result;
    const result = await load();
    if (result.status === "ok") { cache = { at: t, result }; return result; }
    // Don't fabricate: keep showing the last good numbers, flagged stale.
    if (cache && cache.result.status === "ok") {
      return { ...cache.result, status: "stale", message: "刷新失败" };
    }
    return result;
  }

  return { getUsage, peek: () => (cache && cache.result) || null };
}

module.exports = {
  USAGE_URL,
  CACHE_TTL_MS,
  USAGE_WINDOWS,
  parseToken,
  isExpired,
  normalizeUsage,
  formatCountdown,
  usageColor,
  formatPct,
  readCredentials,
  fetchUsage,
  createQuota,
};
