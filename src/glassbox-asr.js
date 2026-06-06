"use strict";

// Glass-box local ASR sidecar client (demo/kill-boring-loading, D3).
//
// Bailian/DashScope realtime ASR is Model.AccessDenied for our key (see
// loona-live/docs/research/01-dashscope-stt-tts.md), so speech-to-text runs
// LOCALLY against a faster-whisper standalone binary (Purfview whisper-standalone:
// whisper-faster.exe). Point CLAWD_WHISPER_BIN at it. We spawn it one-shot on a
// recorded WAV, have it emit JSON to a temp dir, then read the transcript.
//
// spawn + fs + path are injected so the arg-building / parsing / exit-handling is
// unit-testable without the real binary. No silent fallback: missing binary or a
// non-zero exit throws — the caller decides what the pet says about it.

const nodePath = require("node:path");

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

// transcribe(wavPath, opts) -> Promise<string>
// opts: { bin, model, language, outDir, timeoutMs, spawnFn, readFileFn, pathApi, buildArgs }
async function transcribe(wavPath, opts = {}) {
  if (!wavPath || typeof wavPath !== "string") {
    throw new Error("glassbox-asr: wavPath required");
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

module.exports = { resolveBinary, buildArgs, jsonOutputPath, parseTranscript, transcribe };
