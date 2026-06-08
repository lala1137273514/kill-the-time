"use strict";

// Wake-word detector for "hey, cc" — engine-agnostic skeleton (direction 1,
// phase 2). The chosen engine reuses the existing local faster-whisper: a
// renderer captures short windows, an energy gate (rms) skips silence, the clip
// is transcribed by the whisper the user already has, and the transcript is
// fuzzy-matched here. No new account, no new native dependency (Picovoice was
// rejected: enterprise-gated + free tier ends 2026-06-30).
//
// Everything is pure / dependency-injected so it's unit-tested without a mic.
// The matcher is swappable, so a snappier engine (e.g. Vosk) can drop in later.

// Greeting + keyword spellings whisper tends to produce for "hey cc".
const WAKE_RE = /(hey|hei|hai|hi|嘿)(cc|ccc|seesee|cici|sisi|xixi|西西)/;

function matchesWakeWord(transcript) {
  if (typeof transcript !== "string") return false;
  const norm = transcript.toLowerCase().replace(/[^a-z0-9一-鿿]/g, "");
  if (!norm) return false;
  return WAKE_RE.test(norm);
}

// Root-mean-square amplitude of a PCM sample window — the energy gate uses this
// to skip silence so whisper only runs when someone is actually speaking.
function rms(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) { const v = Number(s) || 0; sum += v * v; }
  return Math.sqrt(sum / samples.length);
}

class WakeWordDetector {
  constructor(deps = {}) {
    this.transcribe = typeof deps.transcribe === "function" ? deps.transcribe : null;
    this.onWake = typeof deps.onWake === "function" ? deps.onWake : () => {};
    this.matcher = typeof deps.matcher === "function" ? deps.matcher : matchesWakeWord;
    this.cooldownMs = Number.isFinite(deps.cooldownMs) ? deps.cooldownMs : 3000;
    this.now = typeof deps.now === "function" ? deps.now : () => Date.now();
    this.log = typeof deps.log === "function" ? deps.log : () => {};
    this.enabled = false;
    this._lastWakeAt = -Infinity;
  }

  start() { this.enabled = true; }
  stop() { this.enabled = false; }
  isListening() { return this.enabled; }

  // feedClip(wavPath) -> { wake, text?, reason? }
  // Called by the capture loop for each gated audio window.
  async feedClip(wavPath, opts = {}) {
    if (!this.enabled) return { wake: false, reason: "disabled" };
    if (!this.transcribe) return { wake: false, reason: "no-transcribe" };
    let text = "";
    try {
      text = await this.transcribe(wavPath, opts);
    } catch (err) {
      this.log(`glassbox-wakeword: transcribe failed: ${err && err.message}`);
      return { wake: false, reason: "error" };
    }
    if (!this.matcher(text)) return { wake: false, text };
    const t = this.now();
    if (t - this._lastWakeAt < this.cooldownMs) return { wake: false, reason: "cooldown", text };
    this._lastWakeAt = t;
    try { this.onWake(text); } catch (err) { this.log(`glassbox-wakeword: onWake threw: ${err && err.message}`); }
    return { wake: true, text };
  }
}

module.exports = { matchesWakeWord, rms, WakeWordDetector };
