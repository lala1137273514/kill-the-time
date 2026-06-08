"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  parseToken,
  isExpired,
  normalizeUsage,
  USAGE_WINDOWS,
  formatCountdown,
  usageColor,
  formatPct,
  readCredentials,
  fetchUsage,
  USAGE_URL,
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
  it("maps the 4 windows, keeps utilization + resetsAt, skips missing", () => {
    const data = {
      five_hour: { utilization: 42.6, resetsAt: "2026-06-08T12:00:00Z" },
      seven_day: { utilization: 10, resetsAt: "2026-06-15T00:00:00Z" },
      seven_day_sonnet: { utilization: 5, resetsAt: "2026-06-15T00:00:00Z" },
    };
    const out = normalizeUsage(data);
    assert.strictEqual(out.length, 3);
    assert.deepStrictEqual(out[0], { key: "five_hour", label: USAGE_WINDOWS[0].label, utilization: 42.6, resetsAt: "2026-06-08T12:00:00Z" });
    assert.ok(out.every((w) => typeof w.utilization === "number" && typeof w.resetsAt === "string"));
  });
  it("returns [] for junk", () => {
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
const usageBody = { five_hour: { utilization: 50, resetsAt: "2099-01-01T00:00:00Z" } };
function deps(over = {}) {
  return {
    platform: "win32", homedir: "/h", now: over.now || (() => 1000),
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
