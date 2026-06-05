"use strict";

// Bailian (DashScope) qwen3-tts-flash client — one-shot path, Node rewrite of
// loona-live/agent/plugins/dashscope_tts.py (demo/kill-boring-loading).
//
// One-shot flow: POST text to the multimodal-generation endpoint, read
// output.audio.url from the JSON, then GET that URL for the complete WAV. No
// SSE/streaming framing — narration lines are short, so a single WAV is plenty.
//
// Network + key are injected (fetchImpl, apiKey) so the request/parse logic is
// unit-testable without hitting the network or shipping a mock into production.

const DEFAULT_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const DEFAULT_MODEL = "qwen3-tts-flash";
const DEFAULT_VOICE = "Cherry";
const DEFAULT_LANGUAGE = "Chinese";

function resolveApiKey(opts = {}) {
  const key = opts.apiKey || process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!key) {
    throw new Error("glassbox-tts: missing API key (pass apiKey or set BAILIAN_API_KEY)");
  }
  return key;
}

function buildRequest(text, opts = {}) {
  const endpoint = opts.endpoint || process.env.DASHSCOPE_TTS_ENDPOINT || DEFAULT_ENDPOINT;
  const payload = {
    model: opts.model || DEFAULT_MODEL,
    input: {
      text,
      voice: opts.voice || DEFAULT_VOICE,
      language_type: opts.language || DEFAULT_LANGUAGE,
    },
  };
  const headers = {
    Authorization: `Bearer ${resolveApiKey(opts)}`,
    "Content-Type": "application/json",
  };
  return { endpoint, payload, headers };
}

function extractAudioUrl(data) {
  const audio = (data && data.output && data.output.audio) || {};
  return typeof audio.url === "string" && audio.url ? audio.url : null;
}

// synthesize(text) -> Buffer (WAV bytes). Throws on missing key, HTTP error, or
// a response without audio.url — let it crash, no silent fallback.
async function synthesize(text, opts = {}) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) throw new Error("glassbox-tts: empty text");

  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) throw new Error("glassbox-tts: no fetch implementation available");

  const { endpoint, payload, headers } = buildRequest(trimmed, opts);

  const resp = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`glassbox-tts: synth HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const url = extractAudioUrl(data);
  if (!url) {
    throw new Error("glassbox-tts: response had no output.audio.url");
  }

  const audioResp = await fetchImpl(url);
  if (!audioResp.ok) {
    throw new Error(`glassbox-tts: download HTTP ${audioResp.status}`);
  }
  const buf = await audioResp.arrayBuffer();
  return Buffer.from(buf);
}

module.exports = {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  buildRequest,
  extractAudioUrl,
  synthesize,
};
