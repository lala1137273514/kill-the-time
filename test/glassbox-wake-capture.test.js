"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createWakeCapture } = require("../src/glassbox-wake-capture");

// Helper: feed a sequence of {rms, atMs} readings into a capture controller and
// collect the clip reasons it emits. `now` is driven by the last reading's atMs
// so cooldown is deterministic without a wall clock.
function make(over = {}) {
  const clips = [];
  const cap = createWakeCapture({
    rmsThreshold: over.rmsThreshold ?? 0.1,
    trailingSilenceMs: over.trailingSilenceMs ?? 600,
    maxWindowMs: over.maxWindowMs ?? 2500,
    cooldownMs: over.cooldownMs ?? 1000,
    onClip: (reason) => clips.push(reason),
  });
  return { cap, clips };
}

describe("glassbox-wake-capture createWakeCapture", () => {
  it("requires an onClip callback", () => {
    assert.throws(() => createWakeCapture({}), /onClip/);
  });

  it("stays closed and emits nothing while every window is silent", () => {
    const { cap, clips } = make();
    for (let i = 0; i < 10; i++) cap.feed({ rms: 0.01, atMs: i * 100 });
    assert.strictEqual(clips.length, 0);
    assert.strictEqual(cap.isOpen(), false);
  });

  it("opens the gate when rms crosses the threshold", () => {
    const { cap } = make();
    cap.feed({ rms: 0.02, atMs: 0 });
    assert.strictEqual(cap.isOpen(), false);
    cap.feed({ rms: 0.5, atMs: 100 });
    assert.strictEqual(cap.isOpen(), true);
  });

  it("cuts the clip after a trailing silence once speech stops", () => {
    const { cap, clips } = make({ trailingSilenceMs: 600 });
    cap.feed({ rms: 0.5, atMs: 0 });    // open
    cap.feed({ rms: 0.4, atMs: 200 });  // still speaking
    cap.feed({ rms: 0.01, atMs: 400 }); // silence starts
    assert.strictEqual(clips.length, 0); // not yet — silence < 600ms
    cap.feed({ rms: 0.01, atMs: 1100 }); // silence now 700ms from last speech
    assert.strictEqual(clips.length, 1);
    assert.strictEqual(clips[0], "silence");
    assert.strictEqual(cap.isOpen(), false);
  });

  it("keeps buffering through brief dips while speech continues", () => {
    const { cap, clips } = make({ trailingSilenceMs: 600 });
    cap.feed({ rms: 0.5, atMs: 0 });
    cap.feed({ rms: 0.01, atMs: 200 }); // brief pause
    cap.feed({ rms: 0.5, atMs: 400 });  // speaking again -> resets trailing silence
    cap.feed({ rms: 0.5, atMs: 600 });
    assert.strictEqual(clips.length, 0);
    assert.strictEqual(cap.isOpen(), true);
  });

  it("cuts the clip at the max window even if speech never stops", () => {
    const { cap, clips } = make({ maxWindowMs: 2500 });
    cap.feed({ rms: 0.5, atMs: 0 });
    cap.feed({ rms: 0.5, atMs: 1000 });
    cap.feed({ rms: 0.5, atMs: 2000 });
    assert.strictEqual(clips.length, 0);
    cap.feed({ rms: 0.5, atMs: 2600 }); // crossed max window
    assert.strictEqual(clips.length, 1);
    assert.strictEqual(clips[0], "max");
    assert.strictEqual(cap.isOpen(), false);
  });

  it("enforces a cooldown so it won't re-open immediately after a clip", () => {
    const { cap, clips } = make({ trailingSilenceMs: 600, cooldownMs: 1000 });
    // First utterance (two voiced frames -> real speech) -> clip.
    cap.feed({ rms: 0.5, atMs: 0 });
    cap.feed({ rms: 0.5, atMs: 100 });
    cap.feed({ rms: 0.01, atMs: 200 });
    cap.feed({ rms: 0.01, atMs: 800 }); // 700ms trailing silence -> clip @ 800
    assert.strictEqual(clips.length, 1);
    // Loud again within the cooldown window -> ignored.
    cap.feed({ rms: 0.9, atMs: 1200 });
    assert.strictEqual(cap.isOpen(), false);
    assert.strictEqual(clips.length, 1);
    // After cooldown elapses -> opens again.
    cap.feed({ rms: 0.9, atMs: 2000 });
    assert.strictEqual(cap.isOpen(), true);
  });

  it("reset() discards an open clip without emitting", () => {
    const { cap, clips } = make();
    cap.feed({ rms: 0.5, atMs: 0 });
    assert.strictEqual(cap.isOpen(), true);
    cap.reset();
    assert.strictEqual(cap.isOpen(), false);
    assert.strictEqual(clips.length, 0);
    // After reset a fresh utterance still works (and no cooldown carried over).
    cap.feed({ rms: 0.5, atMs: 100 });
    assert.strictEqual(cap.isOpen(), true);
  });

  it("ignores malformed readings (non-finite rms/atMs)", () => {
    const { cap, clips } = make();
    cap.feed({ rms: NaN, atMs: 0 });
    cap.feed({ rms: 0.5, atMs: NaN });
    cap.feed(null);
    cap.feed({});
    assert.strictEqual(cap.isOpen(), false);
    assert.strictEqual(clips.length, 0);
  });

  it("does not emit empty/too-short clips below a minimum voiced duration", () => {
    // A single loud blip immediately followed by long silence is noise, not
    // speech — opening then closing on one frame shouldn't fire whisper.
    const { cap, clips } = make({ trailingSilenceMs: 600 });
    cap.feed({ rms: 0.5, atMs: 0 });    // open (one voiced frame)
    cap.feed({ rms: 0.01, atMs: 700 }); // immediate trailing silence
    assert.strictEqual(clips.length, 0);
    assert.strictEqual(cap.isOpen(), false);
  });
});
