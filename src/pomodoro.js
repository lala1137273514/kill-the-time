"use strict";

// Minimal pomodoro state machine (功能2). Pure: now() injected, owns NO timer
// (main.js drives tick() on an interval). idle | focus | break. No persistence,
// no history (per spec). Let it crash — no fabricated state.

const MIN = 60000;

function createPomodoro({ now = () => Date.now(), focusMs = 25 * MIN, breakMs = 5 * MIN } = {}) {
  let state = "idle"; // "idle" | "focus" | "break"
  let endsAt = 0;

  function start(kind) { state = kind; endsAt = now() + (kind === "focus" ? focusMs : breakMs); }
  function startFocus() { start("focus"); }
  function startBreak() { start("break"); }
  function stop() { state = "idle"; endsAt = 0; }
  function remainingMs() { return state === "idle" ? 0 : Math.max(0, endsAt - now()); }

  // Call periodically. Returns { state, remainingMs, justFinished } where
  // justFinished is the kind that just elapsed (machine auto-returns to idle),
  // else null.
  function tick() {
    if (state === "idle") return { state, remainingMs: 0, justFinished: null };
    if (now() >= endsAt) {
      const finished = state;
      state = "idle"; endsAt = 0;
      return { state, remainingMs: 0, justFinished: finished };
    }
    return { state, remainingMs: remainingMs(), justFinished: null };
  }

  function snapshot() { return { state, remainingMs: remainingMs() }; }

  return { startFocus, startBreak, stop, tick, snapshot, get state() { return state; } };
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

module.exports = { createPomodoro, formatRemaining };
