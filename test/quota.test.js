"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  parseToken,
  isExpired,
  normalizeUsage,
  normalizeCodexUsage,
  USAGE_WINDOWS,
  formatCountdown,
  usageColor,
  formatPct,
  countCodexModels,
  parseCodexCredential,
  readCodexStatus,
  readCredentials,
  fetchUsage,
  fetchCodexUsage,
  USAGE_URL,
  CODEX_USAGE_URL,
  createQuota,
} = require("../src/quota");

describe("quota parseToken", () => {
  it("reads claudeAiOauth.accessToken + expiresAt", () => {
    const json = JSON.stringify({ claudeAiOauth: { accessToken: "sk-tok", expiresAt: 1750000000000 } });
    assert.deepStrictEqual(parseToken(json), { accessToken: "sk-tok", expiresAt: 1750000000000 });
  });
  it("accepts the legacy 'claude.ai_oauth' key too", () => {
    const json = JSON.stringify({ "claude.ai_oauth": { accessToken: "sk-2", expiresAt: 1 } });
    assert.strictEqual(parseToken(json).accessToken, "sk-2");
  });
  it("throws when no accessToken", () => {
    assert.throws(() => parseToken(JSON.stringify({ claudeAiOauth: {} })));
    assert.throws(() => parseToken(JSON.stringify({})));
    assert.throws(() => parseToken("not json"));
  });
});

describe("quota isExpired", () => {
  it("treats expiresAt > 1e12 as ms epoch and compares to now", () => {
    assert.strictEqual(isExpired(2000000000000, 1000000000000), false);
    assert.strictEqual(isExpired(1000000000000 + 1, 1000000000000 + 2), true);
  });
  it("does not pre-expire when expiresAt is absent / not ms (<=1e12)", () => {
    assert.strictEqual(isExpired(0, Date.now()), false);
    assert.strictEqual(isExpired(1700000000, Date.now()), false);
  });
});

describe("quota normalizeUsage", () => {
  it("maps windows via snake_case resets_at; skips null windows; keeps null resets_at", () => {
    const data = {
      five_hour: { utilization: 42.6, resets_at: "2026-06-08T12:00:00Z" },
      seven_day: { utilization: 10, resets_at: "2026-06-15T00:00:00Z" },
      seven_day_opus: null, // skipped entirely
      seven_day_sonnet: { utilization: 0, resets_at: null }, // kept, no countdown
    };
    const out = normalizeUsage(data);
    assert.strictEqual(out.length, 3);
    assert.deepStrictEqual(out[0], { key: "five_hour", label: USAGE_WINDOWS[0].label, utilization: 42.6, resetsAt: "2026-06-08T12:00:00Z" });
    assert.strictEqual(out[2].key, "seven_day_sonnet");
    assert.strictEqual(out[2].resetsAt, null);
  });
  it("returns [] for junk; skips non-numeric utilization", () => {
    assert.deepStrictEqual(normalizeUsage(null), []);
    assert.deepStrictEqual(normalizeUsage({ five_hour: { utilization: "x" } }), []);
  });
});

describe("quota formatCountdown", () => {
  const base = Date.parse("2026-06-08T00:00:00Z");
  const at = (h, m = 0) => new Date(base + ((h * 60 + m) * 60000)).toISOString();
  it("days -> XdYh", () => assert.strictEqual(formatCountdown(at(3 * 24 + 12), base), "3d12h"));
  it("hours -> XhYm", () => assert.strictEqual(formatCountdown(at(1, 2), base), "1h2m"));
  it("minutes only -> Xm", () => assert.strictEqual(formatCountdown(at(0, 30), base), "30m"));
  it("<60s -> <1m", () => assert.strictEqual(formatCountdown(new Date(base + 30000).toISOString(), base), "<1m"));
  it("past -> 已重置", () => assert.strictEqual(formatCountdown(at(-1), base), "已重置"));
  it("garbage -> ''", () => assert.strictEqual(formatCountdown("nope", base), ""));
});

describe("quota usageColor / formatPct", () => {
  it("tiers: >=90 red, >=70 orange, else normal", () => {
    assert.strictEqual(usageColor(95), "red");
    assert.strictEqual(usageColor(70), "orange");
    assert.strictEqual(usageColor(69.9), "normal");
  });
  it("formatPct rounds and appends %", () => {
    assert.strictEqual(formatPct(42.6), "43%");
    assert.strictEqual(formatPct(0), "0%");
  });
});

describe("quota Codex status", () => {
  it("counts common models_cache shapes", () => {
    assert.strictEqual(countCodexModels({ models: [{ id: "a" }, { id: "b" }] }), 2);
    assert.strictEqual(countCodexModels({ models: { a: {}, b: {} } }), 2);
    assert.strictEqual(countCodexModels({ data: [{ id: "a" }] }), 1);
    assert.strictEqual(countCodexModels(null), 0);
  });

  it("reports Codex not_logged_in when auth is missing", () => {
    const status = readCodexStatus({
      homedir: "/h",
      readFileImpl: () => { throw new Error("missing"); },
    });
    assert.strictEqual(status.status, "not_logged_in");
  });

  it("reports Codex ok without exposing token material", () => {
    const status = readCodexStatus({
      homedir: "/h",
      readFileImpl: (p) => {
        if (p.endsWith("auth.json")) return JSON.stringify({ tokens: { access_token: "secret-token" } });
        return JSON.stringify({ models: [{ id: "gpt-5" }, { id: "codex" }] });
      },
    });
    assert.strictEqual(status.status, "ok");
    assert.match(status.message, /2 个模型缓存/);
    assert.doesNotMatch(status.message, /secret-token/);
  });
});

describe("quota Codex OAuth usage", () => {
  it("parses Codex ChatGPT OAuth credentials without exposing token material", () => {
    const credential = parseCodexCredential(JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "codex-secret", account_id: "acct_1" },
      last_refresh: "2099-01-01T00:00:00Z",
    }), Date.parse("2026-06-08T00:00:00Z"));
    assert.strictEqual(credential.status, "ok");
    assert.strictEqual(credential.accessToken, "codex-secret");
    assert.strictEqual(credential.accountId, "acct_1");
  });

  it("marks stale Codex OAuth refreshes expired before fetching", () => {
    const credential = parseCodexCredential(JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "codex-secret" },
      last_refresh: "2026-05-01T00:00:00Z",
    }), Date.parse("2026-06-08T00:00:00Z"));
    assert.strictEqual(credential.status, "expired");
  });

  it("normalizes Codex primary/secondary windows from wham usage", () => {
    const windows = normalizeCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 12.4, reset_at: 4102444800, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 56.7, reset_at: 4103049600, limit_window_seconds: 604800 },
      },
    });
    assert.deepStrictEqual(windows.map((w) => [w.key, w.label, w.utilization]), [
      ["primary_window", "5 小时", 12.4],
      ["secondary_window", "7 天", 56.7],
    ]);
    assert.strictEqual(windows[0].resetsAt, "2100-01-01T00:00:00.000Z");
  });

  it("GETs Codex wham usage with Bearer, codex-cli UA, and account id", async () => {
    let seen;
    const data = await fetchCodexUsage({
      accessToken: "codex-token",
      accountId: "acct_1",
      fetchImpl: async (url, opts) => {
        seen = { url, opts };
        return { ok: true, status: 200, json: async () => ({ rate_limit: {} }) };
      },
    });
    assert.strictEqual(seen.url, CODEX_USAGE_URL);
    assert.strictEqual(seen.opts.method, "GET");
    assert.strictEqual(seen.opts.headers.Authorization, "Bearer codex-token");
    assert.strictEqual(seen.opts.headers["User-Agent"], "codex-cli");
    assert.strictEqual(seen.opts.headers["ChatGPT-Account-Id"], "acct_1");
    assert.deepStrictEqual(data, { rate_limit: {} });
  });
});

describe("quota readCredentials", () => {
  it("win/linux: reads ~/.claude/.credentials.json", () => {
    const calls = [];
    const out = readCredentials({
      platform: "win32", homedir: "C:\\Users\\Q",
      readFileImpl: (p, enc) => { calls.push([p, enc]); return "{\"ok\":1}"; },
      execFileImpl: () => { throw new Error("should not exec on win"); },
    });
    assert.strictEqual(out, "{\"ok\":1}");
    assert.match(calls[0][0].replace(/\\/g, "/"), /\.claude\/\.credentials\.json$/);
  });
  it("macOS: reads the Keychain blob via security CLI", () => {
    const calls = [];
    const out = readCredentials({
      platform: "darwin", homedir: "/Users/q",
      readFileImpl: () => { throw new Error("should not read file on mac"); },
      execFileImpl: (cmd, args) => { calls.push([cmd, args]); return "  {\"k\":1}\n"; },
    });
    assert.strictEqual(out, "{\"k\":1}");
    assert.strictEqual(calls[0][0], "security");
    assert.deepStrictEqual(calls[0][1], ["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
  });
});

describe("quota fetchUsage", () => {
  const okResp = (body) => ({ ok: true, status: 200, json: async () => body });
  it("GETs the usage URL with Bearer + oauth beta header", async () => {
    let seen;
    const data = await fetchUsage({ accessToken: "tok", fetchImpl: async (url, opts) => { seen = { url, opts }; return okResp({ five_hour: {} }); } });
    assert.strictEqual(seen.url, USAGE_URL);
    assert.strictEqual(seen.opts.method, "GET");
    assert.strictEqual(seen.opts.headers.Authorization, "Bearer tok");
    assert.strictEqual(seen.opts.headers["anthropic-beta"], "oauth-2025-04-20");
    assert.deepStrictEqual(data, { five_hour: {} });
  });
  it("401/403 -> error code EXPIRED", async () => {
    for (const status of [401, 403]) {
      await assert.rejects(
        () => fetchUsage({ accessToken: "t", fetchImpl: async () => ({ ok: false, status }) }),
        (e) => e.code === "EXPIRED",
      );
    }
  });
  it("other non-2xx -> error code HTTP with status", async () => {
    await assert.rejects(
      () => fetchUsage({ accessToken: "t", fetchImpl: async () => ({ ok: false, status: 500 }) }),
      (e) => e.code === "HTTP" && e.status === 500,
    );
  });
});

const goodCreds = JSON.stringify({ claudeAiOauth: { accessToken: "tok", expiresAt: 2e12 } });
const usageBody = { five_hour: { utilization: 50, resets_at: "2099-01-01T00:00:00Z" } };
function deps(over = {}) {
  return {
    platform: "win32", homedir: "/h", codexHome: over.codexHome || "/h/.codex", now: over.now || (() => 1000),
    readFileImpl: over.readFileImpl || (() => goodCreds),
    execFileImpl: () => { throw new Error("no exec"); },
    fetchImpl: over.fetchImpl || (async () => ({ ok: true, status: 200, json: async () => usageBody })),
    cacheTtlMs: over.cacheTtlMs,
  };
}

describe("quota createQuota", () => {
  it("ok -> status ok with normalized windows", async () => {
    const q = createQuota(deps());
    const r = await q.getUsage();
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.windows[0].key, "five_hour");
    assert.ok(r.codex);
  });
  it("loads Codex usage even when Claude credentials are missing", async () => {
    const codexAuth = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "codex-token", account_id: "acct_1" },
      last_refresh: "2099-01-01T00:00:00Z",
    });
    let seenCodexRequest = false;
    const q = createQuota(deps({
      readFileImpl: (p) => {
        const normalized = p.replace(/\\/g, "/");
        if (normalized.endsWith("/.claude/.credentials.json")) throw new Error("no Claude");
        if (normalized.endsWith("/.codex/auth.json")) return codexAuth;
        if (normalized.endsWith("/.codex/models_cache.json")) return JSON.stringify({ models: [] });
        throw new Error(`unexpected read ${p}`);
      },
      fetchImpl: async (url) => {
        if (url === CODEX_USAGE_URL) {
          seenCodexRequest = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              rate_limit: {
                primary_window: { used_percent: 20, reset_at: 4102444800, limit_window_seconds: 18000 },
              },
            }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    }));
    const r = await q.getUsage({ force: true });
    assert.strictEqual(r.status, "not_logged_in");
    assert.strictEqual(seenCodexRequest, true);
    assert.strictEqual(r.codex.status, "ok");
    assert.strictEqual(r.codex.windows[0].label, "5 小时");
    assert.strictEqual(r.codex.windows[0].utilization, 20);
  });
  it("missing credentials file -> not_logged_in", async () => {
    const q = createQuota(deps({ readFileImpl: () => { const e = new Error("nope"); e.code = "ENOENT"; throw e; } }));
    assert.strictEqual((await q.getUsage()).status, "not_logged_in");
  });
  it("expired token -> expired, no fetch", async () => {
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: "t", expiresAt: 1.5e12 } }); // ms epoch, past
    let fetched = false;
    const q = createQuota(deps({ readFileImpl: () => creds, now: () => 2e12, fetchImpl: async () => { fetched = true; return { ok: true, status: 200, json: async () => ({}) }; } }));
    assert.strictEqual((await q.getUsage()).status, "expired");
    assert.strictEqual(fetched, false);
  });
  it("caches within TTL (one fetch), refetches after / on force", async () => {
    let n = 0, t = 1000;
    const q = createQuota(deps({ cacheTtlMs: 300000, now: () => t, fetchImpl: async () => { n++; return { ok: true, status: 200, json: async () => usageBody }; } }));
    await q.getUsage(); await q.getUsage();
    assert.strictEqual(n, 1);
    await q.getUsage({ force: true });
    assert.strictEqual(n, 2);
    t += 300001; await q.getUsage();
    assert.strictEqual(n, 3);
  });
  it("fetch error after a good value -> stale (last windows + 刷新失败)", async () => {
    let ok = true;
    const q = createQuota(deps({ cacheTtlMs: 0, fetchImpl: async () => ok ? { ok: true, status: 200, json: async () => usageBody } : { ok: false, status: 500 } }));
    await q.getUsage();
    ok = false;
    const r = await q.getUsage({ force: true });
    assert.strictEqual(r.status, "stale");
    assert.strictEqual(r.windows[0].key, "five_hour");
    assert.strictEqual(r.message, "刷新失败");
  });
});
