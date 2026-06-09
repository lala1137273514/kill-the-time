"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { GlassboxListener } = require("../src/glassbox-listen");

function deps(over = {}) {
  const calls = { resolve: [], text: [], log: [], transcripts: [], errors: [] };
  const base = {
    transcribe: async () => "",
    resolvePermission: (b) => calls.resolve.push(b),
    getPending: () => ({}),
    onText: (r) => calls.text.push(r),
    onTranscript: (t) => calls.transcripts.push(t),
    onError: (e) => calls.errors.push(e),
    log: (m) => calls.log.push(m),
  };
  return { d: { ...base, ...over }, calls };
}

describe("glassbox-listen GlassboxListener", () => {
  it("resolves a pending permission as allow on 批准", async () => {
    const { d, calls } = deps({
      transcribe: async () => "批准",
      getPending: () => ({ permissionPending: true }),
    });
    const r = await new GlassboxListener(d).onUtterance("/tmp/a.wav");
    assert.strictEqual(r.action, "approve");
    assert.deepStrictEqual(calls.resolve, ["allow"]);
    assert.strictEqual(calls.text.length, 0);
  });

  it("resolves as deny on 拒绝", async () => {
    const { d, calls } = deps({
      transcribe: async () => "拒绝",
      getPending: () => ({ permissionPending: true }),
    });
    const r = await new GlassboxListener(d).onUtterance("/tmp/a.wav");
    assert.strictEqual(r.action, "deny");
    assert.deepStrictEqual(calls.resolve, ["deny"]);
  });

  it("hands a clarification answer to onText, not the permission resolver", async () => {
    const { d, calls } = deps({
      transcribe: async () => "把估值也算上",
      getPending: () => ({ clarificationPending: true }),
    });
    const r = await new GlassboxListener(d).onUtterance("/tmp/a.wav");
    assert.strictEqual(r.action, "answer");
    assert.strictEqual(calls.resolve.length, 0);
    assert.strictEqual(calls.text[0].text, "把估值也算上");
  });

  it("routes a fresh request to onText as a task (clawd can't inject)", async () => {
    const { d, calls } = deps({ transcribe: async () => "帮我对比这三家公司" });
    const r = await new GlassboxListener(d).onUtterance("/tmp/a.wav");
    assert.strictEqual(r.action, "task");
    assert.strictEqual(calls.text[0].action, "task");
    assert.strictEqual(calls.resolve.length, 0);
  });

  it("does nothing on silence", async () => {
    const { d, calls } = deps({ transcribe: async () => "   " });
    const r = await new GlassboxListener(d).onUtterance("/tmp/a.wav");
    assert.strictEqual(r.action, "none");
    assert.strictEqual(calls.resolve.length, 0);
    assert.strictEqual(calls.text.length, 0);
  });

  it("returns a structured error and logs when transcription fails", async () => {
    const { d, calls } = deps({ transcribe: async () => { throw new Error("whisper down"); } });
    const r = await new GlassboxListener(d).onUtterance("/tmp/a.wav");
    assert.strictEqual(r.action, "error");
    assert.match(r.error, /whisper down/);
    assert.ok(calls.log.some((m) => /transcribe failed/.test(m)));
  });

  it("echoes the recognized transcript via onTranscript before routing", async () => {
    const { d, calls } = deps({ transcribe: async () => "帮我对比这三家公司" });
    await new GlassboxListener(d).onUtterance("/tmp/a.wav");
    assert.deepStrictEqual(calls.transcripts, ["帮我对比这三家公司"]);
  });

  it("passes clip options through to the ASR layer", async () => {
    const seen = [];
    const { d } = deps({
      transcribe: async (file, opts) => {
        seen.push({ file, opts });
        return "帮我查一下";
      },
    });
    await new GlassboxListener(d).onUtterance("/tmp/a.ogg", { mime: "audio/ogg;codecs=opus" });
    assert.deepStrictEqual(seen, [{ file: "/tmp/a.ogg", opts: { mime: "audio/ogg;codecs=opus" } }]);
  });

  it("reports a transcription failure via onError", async () => {
    const { d, calls } = deps({ transcribe: async () => { throw new Error("whisper down"); } });
    await new GlassboxListener(d).onUtterance("/tmp/a.wav");
    assert.strictEqual(calls.errors.length, 1);
    assert.match(calls.errors[0].message, /whisper down/);
    assert.strictEqual(calls.transcripts.length, 0);
  });

  it("validates required deps", () => {
    assert.throws(() => new GlassboxListener({ resolvePermission: () => {} }), /transcribe/);
    assert.throws(() => new GlassboxListener({ transcribe: async () => {} }), /resolvePermission/);
  });
});
