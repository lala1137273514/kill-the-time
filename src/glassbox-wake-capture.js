"use strict";

// Energy-gated wake capture controller (demo/kill-boring-loading, "hey, cc").
//
// Engine = energy-gate + the existing local faster-whisper. The renderer runs a
// continuous getUserMedia + AnalyserNode loop and feeds this controller short
// window readings { rms, atMs }. This module is PURE: it owns only the gate
// state machine — when to open a clip, when to cut it, and a cooldown so it
// never spams whisper. It emits nothing but a `reason` ("silence" | "max"); the
// caller (main.js) is the one that grabs the actual audio buffer, runs whisper,
// and feeds the transcript to WakeWordDetector. No mic, no Electron, no clock
// dependency here, so it unit-tests under plain node.
//
// let-it-crash: a missing onClip throws at construction. Malformed readings
// (non-finite rms/atMs) are skipped — they're sensor noise, not a bug to mask.

function _finite(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// createWakeCapture({ rmsThreshold, trailingSilenceMs, maxWindowMs, cooldownMs,
//   onClip(reason) }) -> { feed({rms, atMs}), reset(), isOpen() }
//
// - rmsThreshold:      energy level that counts as "speech" (gate opens above it)
// - trailingSilenceMs: cut the clip after this much continuous silence
// - maxWindowMs:       hard cap so a non-stop talker still yields a clip
// - cooldownMs:        minimum gap between clips so whisper isn't spammed
function createWakeCapture(opts = {}) {
  if (typeof opts.onClip !== "function") {
    throw new Error("createWakeCapture needs onClip(reason)");
  }
  const onClip = opts.onClip;
  const rmsThreshold = _finite(opts.rmsThreshold) ? opts.rmsThreshold : 0.1;
  const trailingSilenceMs = _finite(opts.trailingSilenceMs) ? opts.trailingSilenceMs : 600;
  const maxWindowMs = _finite(opts.maxWindowMs) ? opts.maxWindowMs : 2500;
  const cooldownMs = _finite(opts.cooldownMs) ? opts.cooldownMs : 1000;

  let open = false;
  let openedAt = 0;        // atMs the gate opened
  let lastVoicedAt = 0;    // atMs of the most recent above-threshold reading
  let lastClipAt = -Infinity; // atMs the last clip was cut (cooldown anchor)

  function emit(reason, atMs) {
    open = false;
    lastClipAt = atMs;
    onClip(reason);
  }

  function feed(reading) {
    if (!reading || !_finite(reading.rms) || !_finite(reading.atMs)) return;
    const { rms, atMs } = reading;
    const voiced = rms >= rmsThreshold;

    if (!open) {
      // Closed: only a voiced frame past the cooldown can open the gate.
      if (!voiced) return;
      if (atMs - lastClipAt < cooldownMs) return;
      open = true;
      openedAt = atMs;
      lastVoicedAt = atMs;
      return;
    }

    // Open: keep buffering. A voiced frame extends speech and resets the
    // trailing-silence countdown; a silent frame is tolerated until it has been
    // quiet for trailingSilenceMs.
    if (voiced) {
      lastVoicedAt = atMs;
    } else if (atMs - lastVoicedAt >= trailingSilenceMs) {
      // Drop a clip that never had more than a single voiced frame — a lone
      // loud blip is noise, not an utterance, and isn't worth a whisper run.
      if (lastVoicedAt <= openedAt) { open = false; return; }
      emit("silence", atMs);
      return;
    }

    // Hard cap: a non-stop talker still gets cut so whisper runs.
    if (atMs - openedAt >= maxWindowMs) {
      emit("max", atMs);
    }
  }

  function reset() {
    open = false;
    openedAt = 0;
    lastVoicedAt = 0;
    lastClipAt = -Infinity;
  }

  function isOpen() {
    return open;
  }

  return { feed, reset, isOpen };
}

module.exports = { createWakeCapture };
