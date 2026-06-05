"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { GlassboxListener } = require("../src/glassbox-listen");

function deps(over = {}) {
  const calls = { resolve: [], text: [], log: [] };
  const base = {
    transcribe: async () => "",
    resolvePermission: (b) => calls.resolve.push(b),
    getPending: () => ({}),
    onText: (r) => calls.text.push(r),
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

  it("validates required deps", () => {
    assert.throws(() => new GlassboxListener({ resolvePermission: () => {} }), /transcribe/);
    assert.throws(() => new GlassboxListener({ transcribe: async () => {} }), /resolvePermission/);
  });
});
