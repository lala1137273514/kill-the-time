"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  buildRequest,
  extractAudioUrl,
  synthesize,
} = require("../src/glassbox-tts");

describe("glassbox-tts buildRequest", () => {
  it("builds the qwen3-tts-flash payload and bearer auth", () => {
    const { endpoint, payload, headers } = buildRequest("你好", { apiKey: "k-123" });
    assert.strictEqual(endpoint, DEFAULT_ENDPOINT);
    assert.strictEqual(payload.model, DEFAULT_MODEL);
    assert.strictEqual(payload.input.text, "你好");
    assert.strictEqual(payload.input.voice, "Cherry");
    assert.strictEqual(payload.input.language_type, "Chinese");
    assert.strictEqual(headers.Authorization, "Bearer k-123");
    assert.strictEqual(headers["Content-Type"], "application/json");
  });

  it("throws when no API key is available", () => {
    const savedB = process.env.BAILIAN_API_KEY;
    const savedD = process.env.DASHSCOPE_API_KEY;
    delete process.env.BAILIAN_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    try {
      assert.throws(() => buildRequest("hi", {}), /missing API key/);
    } finally {
      if (savedB !== undefined) process.env.BAILIAN_API_KEY = savedB;
      if (savedD !== undefined) process.env.DASHSCOPE_API_KEY = savedD;
    }
  });
});

describe("glassbox-tts extractAudioUrl", () => {
  it("pulls output.audio.url", () => {
    assert.strictEqual(
      extractAudioUrl({ output: { audio: { url: "http://x/a.wav" } } }),
      "http://x/a.wav"
    );
  });
  it("returns null when absent", () => {
    assert.strictEqual(extractAudioUrl({ output: {} }), null);
    assert.strictEqual(extractAudioUrl({}), null);
    assert.strictEqual(extractAudioUrl(null), null);
  });
});

describe("glassbox-tts synthesize", () => {
  function makeFetch(steps) {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      const step = steps.shift();
      if (typeof step === "function") return step(url, init);
      return step;
    };
    impl.calls = calls;
    return impl;
  }

  it("POSTs text then downloads the WAV from audio.url", async () => {
    const fetchImpl = makeFetch([
      { ok: true, json: async () => ({ output: { audio: { url: "http://cdn/a.wav" } } }) },
      { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
    ]);
    const buf = await synthesize("讲一句", { apiKey: "k", fetchImpl });
    assert.ok(Buffer.isBuffer(buf));
    assert.deepStrictEqual([...buf], [1, 2, 3]);
    assert.strictEqual(fetchImpl.calls.length, 2);
    assert.strictEqual(fetchImpl.calls[0].init.method, "POST");
    assert.strictEqual(fetchImpl.calls[1].url, "http://cdn/a.wav");
  });

  it("throws on empty text without calling fetch", async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return { ok: true }; };
    await assert.rejects(() => synthesize("   ", { apiKey: "k", fetchImpl }), /empty text/);
    assert.strictEqual(called, false);
  });

  it("throws when the synth response has no audio.url", async () => {
    const fetchImpl = makeFetch([{ ok: true, json: async () => ({ output: {} }) }]);
    await assert.rejects(() => synthesize("x", { apiKey: "k", fetchImpl }), /no output\.audio\.url/);
  });

  it("throws on a non-ok synth response", async () => {
    const fetchImpl = makeFetch([{ ok: false, status: 401 }]);
    await assert.rejects(() => synthesize("x", { apiKey: "k", fetchImpl }), /HTTP 401/);
  });
});
