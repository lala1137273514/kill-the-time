"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { GlassboxVoice, pickPrimary } = require("../src/glassbox-voice");

function snap(sessions, hudLastSessionId) {
  return { sessions, hudLastSessionId: hudLastSessionId || null };
}

describe("glassbox-voice pickPrimary", () => {
  it("prefers the HUD primary session id", () => {
    const s = snap(
      [{ id: "a", badge: "running" }, { id: "b", badge: "running" }],
      "b"
    );
    assert.strictEqual(pickPrimary(s).id, "b");
  });
  it("falls back to the first running session", () => {
    const s = snap([{ id: "a", badge: "idle" }, { id: "b", badge: "running" }]);
    assert.strictEqual(pickPrimary(s).id, "b");
  });
  it("returns null when nothing is running", () => {
    assert.strictEqual(pickPrimary(snap([{ id: "a", badge: "idle" }])), null);
    assert.strictEqual(pickPrimary(snap([])), null);
  });
});

describe("glassbox-voice GlassboxVoice", () => {
  function deps(over = {}) {
    const plays = [];
    const logs = [];
    let t = 0;
    const base = {
      synth: async (text) => Buffer.from(text),
      play: (audio) => plays.push(audio),
      now: () => t,
      log: (m) => logs.push(m),
      controllerOpts: { minIntervalMs: 0 },
    };
    const merged = { ...base, ...over };
    return { deps: merged, plays, logs, setTime: (v) => { t = v; }, getTime: () => t };
  }

  it("synthesizes and plays on a start milestone", async () => {
    const { deps: d, plays } = deps();
    const v = new GlassboxVoice(d);
    v.onSnapshot(snap([{ id: "a", badge: "running", state: "thinking" }], "a"));
    await v._inflight;
    assert.strictEqual(plays.length, 1);
    assert.ok(Buffer.isBuffer(plays[0]));
  });

  it("does not speak when nothing is running", async () => {
    const { deps: d, plays } = deps();
    const v = new GlassboxVoice(d);
    v.onSnapshot(snap([{ id: "a", badge: "idle" }]));
    assert.strictEqual(v._inflight, null);
    assert.strictEqual(plays.length, 0);
  });

  it("does not pile up lines while one is still in flight", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { deps: d, plays } = deps({ synth: async () => { await gate; return Buffer.from("x"); } });
    const v = new GlassboxVoice(d);
    v.onSnapshot(snap([{ id: "a", badge: "running" }], "a")); // start -> speaking
    v.onSnapshot(snap([{ id: "a", badge: "running", subagentCount: 3 }], "a")); // ignored while speaking
    release();
    await v._inflight;
    assert.strictEqual(plays.length, 1);
  });

  it("re-detects a milestone that arrived while speaking (done is never lost)", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { deps: d, plays } = deps({ synth: async () => { await gate; return Buffer.from("x"); } });
    const v = new GlassboxVoice(d);
    v.onSnapshot(snap([{ id: "a", badge: "running" }], "a")); // start -> speaking
    v.onSnapshot(snap([{ id: "a", badge: "done", state: "idle" }], "a")); // arrives mid-speech: deferred, NOT consumed
    release();
    await v._inflight;             // start finishes, speaking clears
    v.onSnapshot(snap([{ id: "a", badge: "done", state: "idle" }], "a")); // re-detected now
    await v._inflight;
    assert.strictEqual(plays.length, 2); // start + done both played
  });

  it("logs and survives a TTS failure without throwing", async () => {
    const { deps: d, plays, logs } = deps({ synth: async () => { throw new Error("boom"); } });
    const v = new GlassboxVoice(d);
    v.onSnapshot(snap([{ id: "a", badge: "running" }], "a"));
    await v._inflight;
    assert.strictEqual(plays.length, 0);
    assert.ok(logs.some((m) => /tts error/.test(m)));
    assert.strictEqual(v.speaking, false);
  });

  it("honors fixed-event narration switches", async () => {
    const seen = [];
    const { deps: d, plays } = deps({
      shouldSpeakMilestone: (m) => {
        seen.push(m);
        return m !== "start";
      },
    });
    const v = new GlassboxVoice(d);
    v.onSnapshot(snap([{ id: "a", badge: "running" }], "a"));
    assert.deepStrictEqual(seen, ["start"]);
    assert.strictEqual(v._inflight, null);
    assert.strictEqual(plays.length, 0);
  });

  it("validates required deps", () => {
    assert.throws(() => new GlassboxVoice({ play: () => {} }), /synth/);
    assert.throws(() => new GlassboxVoice({ synth: async () => {} }), /play/);
  });

  it("speak() synthesizes and plays an arbitrary line (dispatch receipt)", async () => {
    const synthed = [];
    const { deps: d, plays } = deps({ synth: async (t) => { synthed.push(t); return Buffer.from(t); } });
    const v = new GlassboxVoice(d);
    await v.speak("好的，已经让 Claude 处理了");
    assert.deepStrictEqual(synthed, ["好的，已经让 Claude 处理了"]);
    assert.strictEqual(plays.length, 1);
  });

  it("speak() ignores empty text", async () => {
    const { deps: d, plays } = deps();
    const v = new GlassboxVoice(d);
    await v.speak("   ");
    assert.strictEqual(plays.length, 0);
  });
});
