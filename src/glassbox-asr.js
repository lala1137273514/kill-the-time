"use strict";

// Glass-box ASR client (demo/kill-boring-loading, D3).
//
// Remote path: DashScope/Bailian Paraformer realtime WebSocket. It accepts
// binary audio after a run-task handshake and emits generated sentence events.
// Local fallback: faster-whisper standalone binary. Point CLAWD_WHISPER_BIN at
// it. We spawn it one-shot on a recorded file, have it emit JSON to a temp dir,
// then read the transcript.
//
// spawn + fs + path are injected so the arg-building / parsing / exit-handling is
// unit-testable without the real binary. No silent fallback: missing binary or a
// non-zero exit throws — the caller decides what the pet says about it.

const nodePath = require("node:path");
const nodeFs = require("node:fs");
const nodeCrypto = require("node:crypto");

const DEFAULT_REMOTE_ENDPOINT = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";
const DEFAULT_REMOTE_MODEL = "paraformer-realtime-v2";
const FALLBACK_REMOTE_MODELS = Object.freeze(["paraformer-realtime-v1"]);

function resolveBinary(opts = {}) {
  const bin = opts.bin || process.env.CLAWD_WHISPER_BIN;
  if (!bin) {
    throw new Error("glassbox-asr: no whisper binary (set CLAWD_WHISPER_BIN or pass bin)");
  }
  return bin;
}

// faster-whisper standalone mirrors the OpenAI Whisper CLI: positional audio
// path, then --flags. JSON output (one <basename>.json with a top-level `text`)
// is the stable machine-readable surface. Overridable via opts.buildArgs for a
// differently-flavored binary.
function buildArgs(wavPath, outDir, opts = {}) {
  if (typeof opts.buildArgs === "function") return opts.buildArgs(wavPath, outDir, opts);
  return [
    wavPath,
    "--model", opts.model || process.env.CLAWD_WHISPER_MODEL || "small",
    "--language", opts.language || "zh",
    "--output_format", "json",
    "--output_dir", outDir,
  ];
}

function jsonOutputPath(wavPath, outDir, pathApi = nodePath) {
  const base = pathApi.basename(wavPath).replace(/\.[^.]+$/, "");
  return pathApi.join(outDir, `${base}.json`);
}

function parseTranscript(jsonText) {
  const data = JSON.parse(jsonText);
  const text = data && typeof data.text === "string" ? data.text.trim() : "";
  return text;
}

function resolveRemoteApiKey(opts = {}) {
  return opts.apiKey || process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY || "";
}

function normalizeRemoteEndpoint(endpoint) {
  const raw = typeof endpoint === "string" ? endpoint.trim() : "";
  if (!raw) return "";
  if (/^https:\/\//i.test(raw)) return raw.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:/i, "ws:");
  return raw;
}

function audioFormatFromPath(filePath, mime = "") {
  const s = `${mime} ${filePath}`.toLowerCase();
  if (s.includes("ogg") || s.includes("opus")) return "opus";
  if (s.includes(".wav") || s.includes("audio/wav") || s.includes("audio/x-wav")) return "wav";
  if (s.includes(".mp3") || s.includes("mpeg")) return "mp3";
  if (s.includes(".pcm")) return "pcm";
  if (s.includes(".webm")) return "webm";
  return "wav";
}

function buildRemoteStartTask({ taskId, model, format, sampleRate }) {
  return {
    header: {
      action: "run-task",
      task_id: taskId,
      streaming: "duplex",
    },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model: model || DEFAULT_REMOTE_MODEL,
      input: {},
      parameters: {
        format,
        sample_rate: sampleRate || (format === "opus" ? 48000 : 16000),
      },
    },
  };
}

function buildRemoteFinishTask(taskId) {
  return {
    header: {
      action: "finish-task",
      task_id: taskId,
      streaming: "duplex",
    },
    payload: {
      input: {},
    },
  };
}

function extractRemoteText(data) {
  const output = data && data.payload && data.payload.output;
  if (!output || typeof output !== "object") return "";
  if (typeof output.text === "string") return output.text.trim();
  const sentence = output.sentence;
  if (sentence && typeof sentence.text === "string") return sentence.text.trim();
  if (Array.isArray(output.sentences)) {
    return output.sentences.map((s) => (s && typeof s.text === "string" ? s.text.trim() : "")).filter(Boolean).join("");
  }
  return "";
}

function remoteEventName(data) {
  return data && data.header && typeof data.header.event === "string" ? data.header.event : "";
}

function chunkBuffer(buffer, size) {
  const out = [];
  for (let i = 0; i < buffer.length; i += size) out.push(buffer.subarray(i, Math.min(i + size, buffer.length)));
  return out;
}

function loadWebSocketImpl(opts = {}) {
  if (opts.WebSocketImpl) return opts.WebSocketImpl;
  try { return require("ws"); } catch {}
  if (typeof WebSocket === "function") return WebSocket;
  throw new Error("glassbox-asr: no WebSocket implementation available");
}

function isRemoteModelDenied(err) {
  const msg = String((err && err.message) || err || "").toLowerCase();
  return /model access denied|access denied|model.*denied|permission/.test(msg);
}

function canUseLocalWhisper(opts = {}) {
  try {
    resolveBinary(opts);
    return true;
  } catch {
    return false;
  }
}

async function transcribeRemote(filePath, opts = {}) {
  const endpoint = normalizeRemoteEndpoint(opts.endpoint || process.env.DASHSCOPE_ASR_ENDPOINT || DEFAULT_REMOTE_ENDPOINT);
  const apiKey = resolveRemoteApiKey(opts);
  if (!endpoint || !apiKey) throw new Error("glassbox-asr: remote ASR requires endpoint and API key");
  const format = audioFormatFromPath(filePath, opts.mime);
  if (format === "webm") {
    throw new Error("glassbox-asr: DashScope ASR does not accept webm; record ogg/opus or use local whisper");
  }
  const readFileFn = opts.readBinaryFn || nodeFs.readFileSync;
  const audio = Buffer.from(readFileFn(filePath));
  const WebSocketImpl = loadWebSocketImpl(opts);
  const taskId = opts.taskId || (nodeCrypto.randomUUID ? nodeCrypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 30000;
  const chunkSize = Number.isFinite(opts.chunkSize) && opts.chunkSize > 0 ? opts.chunkSize : 3200;
  const sendDelayMs = Number.isFinite(opts.sendDelayMs) ? opts.sendDelayMs : 20;

  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    const texts = [];
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (ws && typeof ws.close === "function") ws.close(); } catch {}
      fn(val);
    };
    const timer = setTimeout(() => done(reject, new Error(`glassbox-asr: remote timed out after ${timeoutMs}ms`)), timeoutMs);
    if (timer && typeof timer.unref === "function") timer.unref();

    const ws = new WebSocketImpl(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-DataInspection": "enable",
      },
    });

    function sendJson(obj) {
      ws.send(JSON.stringify(obj));
    }

    function sendAudioThenFinish() {
      const chunks = chunkBuffer(audio, chunkSize);
      let i = 0;
      const pump = () => {
        if (settled) return;
        if (i >= chunks.length) {
          sendJson(buildRemoteFinishTask(taskId));
          return;
        }
        ws.send(chunks[i++]);
        if (sendDelayMs > 0) setTimeout(pump, sendDelayMs);
        else setImmediate(pump);
      };
      pump();
    }

    ws.on("open", () => {
      sendJson(buildRemoteStartTask({
        taskId,
        model: opts.model || process.env.CLAWD_ASR_MODEL || DEFAULT_REMOTE_MODEL,
        format,
        sampleRate: opts.sampleRate || (format === "opus" ? 48000 : 16000),
      }));
    });
    ws.on("message", (raw) => {
      let data;
      try { data = JSON.parse(String(raw)); } catch { return; }
      const event = remoteEventName(data);
      if (event === "task-started") {
        started = true;
        sendAudioThenFinish();
        return;
      }
      const text = extractRemoteText(data);
      if (text) texts.push(text);
      if (event === "task-finished") {
        done(resolve, texts.join("").trim());
      } else if (event === "task-failed") {
        const msg = (data.header && data.header.error_message) || "task failed";
        done(reject, new Error(`glassbox-asr: remote ${msg}`));
      }
    });
    ws.on("error", (err) => done(reject, new Error(`glassbox-asr: remote websocket error: ${err && err.message}`)));
    ws.on("close", () => {
      if (!settled && !started) done(reject, new Error("glassbox-asr: remote websocket closed before task started"));
    });
  });
}

// transcribe(wavPath, opts) -> Promise<string>
// opts: { bin, model, language, outDir, timeoutMs, spawnFn, readFileFn, pathApi, buildArgs }
async function transcribe(wavPath, opts = {}) {
  if (!wavPath || typeof wavPath !== "string") {
    throw new Error("glassbox-asr: wavPath required");
  }
  if (opts.endpoint && resolveRemoteApiKey(opts)) {
    const format = audioFormatFromPath(wavPath, opts.mime);
    if (format === "webm" && canUseLocalWhisper(opts)) {
      const nextOpts = { ...opts };
      delete nextOpts.endpoint;
      delete nextOpts.apiKey;
      return transcribe(wavPath, nextOpts);
    }
    const tried = [];
    const firstModel = opts.model || process.env.CLAWD_ASR_MODEL || DEFAULT_REMOTE_MODEL;
    for (const model of [firstModel, ...FALLBACK_REMOTE_MODELS]) {
      if (!model || tried.includes(model)) continue;
      tried.push(model);
      try {
        return await transcribeRemote(wavPath, { ...opts, model });
      } catch (err) {
        if (!isRemoteModelDenied(err)) throw err;
        if (tried.length > FALLBACK_REMOTE_MODELS.length) {
          throw new Error(`glassbox-asr: remote model access denied (${tried.join(" -> ")}). Enable this ASR model in Bailian/DashScope or pick another ASR model in settings.`);
        }
      }
    }
    throw new Error(`glassbox-asr: remote model access denied (${tried.join(" -> ")}). Enable this ASR model in Bailian/DashScope or pick another ASR model in settings.`);
  }
  const bin = resolveBinary(opts);
  const pathApi = opts.pathApi || nodePath;
  const outDir = opts.outDir || pathApi.dirname(wavPath);
  const spawnFn = opts.spawnFn || require("node:child_process").spawn;
  const readFileFn = opts.readFileFn || ((p) => require("node:fs").readFileSync(p, "utf8"));
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 30000;

  const args = buildArgs(wavPath, outDir, opts);
  const outPath = jsonOutputPath(wavPath, outDir, pathApi);

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    const child = spawnFn(bin, args);
    let stderr = "";
    if (child.stderr && typeof child.stderr.on === "function") {
      child.stderr.on("data", (d) => { stderr += String(d); });
    }

    const timer = setTimeout(() => {
      try { if (child && typeof child.kill === "function") child.kill(); } catch {}
      done(reject, new Error(`glassbox-asr: timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer && typeof timer.unref === "function") timer.unref();

    child.on("error", (err) => {
      clearTimeout(timer);
      done(reject, new Error(`glassbox-asr: spawn failed: ${err && err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return done(reject, new Error(`glassbox-asr: whisper exited ${code}: ${stderr.slice(0, 200)}`));
      }
      try {
        const text = parseTranscript(readFileFn(outPath));
        // Clean up the transcript whisper wrote — we own it. Best-effort.
        try { (opts.unlinkFn || require("node:fs").unlinkSync)(outPath); } catch {}
        done(resolve, text);
      } catch (err) {
        done(reject, new Error(`glassbox-asr: could not read transcript (${outPath}): ${err && err.message}`));
      }
    });
  });
}

module.exports = {
  DEFAULT_REMOTE_ENDPOINT,
  DEFAULT_REMOTE_MODEL,
  FALLBACK_REMOTE_MODELS,
  resolveBinary,
  buildArgs,
  jsonOutputPath,
  parseTranscript,
  resolveRemoteApiKey,
  normalizeRemoteEndpoint,
  audioFormatFromPath,
  canUseLocalWhisper,
  isRemoteModelDenied,
  buildRemoteStartTask,
  buildRemoteFinishTask,
  extractRemoteText,
  transcribeRemote,
  transcribe,
};
