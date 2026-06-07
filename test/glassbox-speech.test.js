"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { wavDurationMs, emotionToPetState, speechReflection } = require("../src/glassbox-speech");

// Build a minimal valid PCM WAV buffer with a known duration.
function makeWav({ sampleRate = 16000, channels = 1, bits = 16, dataBytes }) {
  const byteRate = (sampleRate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

describe("glassbox-speech wavDurationMs", () => {
  it("computes duration from a valid WAV header", () => {
    assert.strictEqual(wavDurationMs(makeWav({ dataBytes: 32000 })), 1000); // 16k*1*2 byteRate
    assert.strictEqual(wavDurationMs(makeWav({ dataBytes: 16000 })), 500);
    assert.strictEqual(wavDurationMs(makeWav({ sampleRate: 24000, dataBytes: 48000 })), 1000);
  });

  it("returns 0 for a non-WAV / too-short / empty buffer", () => {
    assert.strictEqual(wavDurationMs(Buffer.from("not a wav file")), 0);
    assert.strictEqual(wavDurationMs(Buffer.alloc(10)), 0);
    assert.strictEqual(wavDurationMs(Buffer.alloc(0)), 0);
    assert.strictEqual(wavDurationMs(null), 0);
    assert.strictEqual(wavDurationMs("nope"), 0);
  });
});

describe("glassbox-speech emotionToPetState", () => {
  it("maps emotions to shipped pet states, defaulting to attention", () => {
    assert.strictEqual(emotionToPetState("positive"), "notification");
    assert.strictEqual(emotionToPetState("happy"), "notification");
    assert.strictEqual(emotionToPetState("concerned"), "thinking");
    assert.strictEqual(emotionToPetState("neutral"), "attention");
    assert.strictEqual(emotionToPetState(undefined), "attention");
    assert.strictEqual(emotionToPetState("???"), "attention");
  });
});

describe("glassbox-speech speechReflection", () => {
  it("reflects the speaking emotion onto the pet when state is free", () => {
    assert.strictEqual(speechReflection("positive", "idle"), "notification");
    assert.strictEqual(speechReflection(undefined, "working"), "attention");
    assert.strictEqual(speechReflection("concerned", null), "thinking");
  });

  it("never stomps the sleep family or high-priority machine states", () => {
    for (const s of ["sleeping", "dozing", "collapsing", "waking", "yawning", "error", "notification"]) {
      assert.strictEqual(speechReflection("positive", s), null, s);
    }
  });
});
