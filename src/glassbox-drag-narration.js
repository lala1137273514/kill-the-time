"use strict";

const DEFAULT_LINES = Object.freeze([
  "慢点，我还在跟上",
  "好好好，换个地方站",
  "我被你拎起来了",
  "轻一点，我还要监工呢",
]);

function createDragNarration(opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const random = typeof opts.random === "function" ? opts.random : Math.random;
  const speak = typeof opts.speak === "function" ? opts.speak : () => {};
  const lines = Array.isArray(opts.lines) && opts.lines.length ? opts.lines : DEFAULT_LINES;
  const minHoldMs = Number.isFinite(opts.minHoldMs) ? opts.minHoldMs : 1200;
  const cooldownMs = Number.isFinite(opts.cooldownMs) ? opts.cooldownMs : 18000;
  const chance = Number.isFinite(opts.chance) ? Math.max(0, Math.min(1, opts.chance)) : 0.42;

  let dragging = false;
  let startedAt = 0;
  let timer = null;
  let lastSpokeAt = -Infinity;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function pickLine() {
    const idx = Math.floor(random() * lines.length) % lines.length;
    return String(lines[idx] || "").trim();
  }

  function maybeSpeak() {
    timer = null;
    if (!dragging) return null;
    const t = now();
    if (t - startedAt < minHoldMs) return null;
    if (t - lastSpokeAt < cooldownMs) return null;
    if (random() > chance) return null;
    const line = pickLine();
    if (!line) return null;
    lastSpokeAt = t;
    speak(line);
    return line;
  }

  function start() {
    if (dragging) return;
    dragging = true;
    startedAt = now();
    clearTimer();
    timer = setTimeout(maybeSpeak, minHoldMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function end() {
    dragging = false;
    clearTimer();
  }

  return {
    start,
    end,
    maybeSpeak,
    isDragging: () => dragging,
  };
}

module.exports = { DEFAULT_LINES, createDragNarration };
