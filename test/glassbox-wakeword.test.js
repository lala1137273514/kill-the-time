"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { matchesWakeWord, rms, WakeWordDetector } = require("../src/glassbox-wakeword");

describe("glassbox-wakeword matchesWakeWord", () => {
  it("accepts the wake phrase and the ways whisper tends to spell it", () => {
    for (const t of [
      "hey cc", "Hey, CC", "hey cc.", "hey  c c", "嘿 cc", "hey 西西", "嘿西西",
      "hey see see", "hey cici", "hi cc", "Hey CC!", "hey, sisi",
    ]) {
      assert.strictEqual(matchesWakeWord(t), true, `should accept: ${t}`);
    }
  });

  it("rejects greetings without the keyword and the keyword without a greeting", () => {
    for (const t of [
      "hello there", "hey there", "let's see", "the cc thing", "this cc value",
      "okay", "", null, undefined, "see you", "cc the email",
    ]) {
      assert.strictEqual(matchesWakeWord(t), false, `should reject: ${t}`);
    }
  });
});

describe("glassbox-wakeword rms", () => {
  it("returns 0 for silence and grows with amplitude", () => {
    assert.strictEqual(rms([0, 0, 0, 0]), 0);
    const quiet = rms([10, -10, 10, -10]);
    const loud = rms([1000, -1000, 1000, -1000]);
    assert.ok(loud > quiet);
    assert.ok(Math.abs(rms([1000, -1000, 1000, -1000]) - 1000) < 1e-6);
  });

  it("handles empty / non-array input as 0", () => {
    assert.strictEqual(rms([]), 0);
    assert.strictEqual(rms(null), 0);
  });
});

describe("glassbox-wakeword WakeWordDetector", () => {
  function make(over = {}) {
    const calls = { woke: [], transcribed: 0 };
    let t = 1000;
    const det = new WakeWordDetector({
      transcribe: over.transcribe || (async () => { calls.transcribed++; return "hey cc"; }),
      onWake: (text) => calls.woke.push(text),
      now: () => t,
      cooldownMs: over.cooldownMs ?? 3000,
      log: () => {},
    });
    return { det, calls, advance: (ms) => { t += ms; } };
  }

  it("does nothing until started (default off)", async () => {
    const { det, calls } = make();
    assert.strictEqual(det.isListening(), false);
    const r = await det.feedClip("/tmp/x.wav");
    assert.strictEqual(r.wake, false);
    assert.strictEqual(calls.transcribed, 0);
  });

  it("fires onWake when a started detector hears the phrase", async () => {
    const { det, calls } = make();
    det.start();
    const r = await det.feedClip("/tmp/x.wav");
    assert.strictEqual(r.wake, true);
    assert.deepStrictEqual(calls.woke, ["hey cc"]);
  });

  it("passes clip options through to the ASR layer", async () => {
    const calls = [];
    const det = new WakeWordDetector({
      transcribe: async (file, opts) => {
        calls.push({ file, opts });
        return "hey cc";
      },
      onWake: () => {},
      log: () => {},
    });
    det.start();
    await det.feedClip("/tmp/wake.ogg", { mime: "audio/ogg;codecs=opus" });
    assert.deepStrictEqual(calls, [{ file: "/tmp/wake.ogg", opts: { mime: "audio/ogg;codecs=opus" } }]);
  });

  it("does not fire on a non-matching transcript", async () => {
    const { det, calls } = make({ transcribe: async () => "what's the weather" });
    det.start();
    const r = await det.feedClip("/tmp/x.wav");
    assert.strictEqual(r.wake, false);
    assert.strictEqual(calls.woke.length, 0);
  });

  it("respects the cooldown so it won't double-fire", async () => {
    const { det, calls, advance } = make({ cooldownMs: 3000 });
    det.start();
    assert.strictEqual((await det.feedClip("/a.wav")).wake, true);
    advance(1000);
    assert.strictEqual((await det.feedClip("/a.wav")).wake, false); // within cooldown
    advance(2500);
    assert.strictEqual((await det.feedClip("/a.wav")).wake, true);  // cooldown elapsed
    assert.strictEqual(calls.woke.length, 2);
  });

  it("swallows a transcribe error without firing or throwing", async () => {
    const { det, calls } = make({ transcribe: async () => { throw new Error("whisper boom"); } });
    det.start();
    const r = await det.feedClip("/a.wav");
    assert.strictEqual(r.wake, false);
    assert.strictEqual(calls.woke.length, 0);
  });

  it("stop() halts detection", async () => {
    const { det } = make();
    det.start();
    det.stop();
    assert.strictEqual(det.isListening(), false);
    assert.strictEqual((await det.feedClip("/a.wav")).wake, false);
  });
});
