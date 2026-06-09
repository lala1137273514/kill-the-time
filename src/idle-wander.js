"use strict";

const DEFAULTS = Object.freeze({
  minDelayMs: 4200,
  maxDelayMs: 8200,
  minDistancePx: 8,
  maxDistancePx: 22,
  minSteps: 5,
  maxSteps: 8,
  verticalScale: 0.55,
});

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function randBetween(random, min, max) {
  return min + (max - min) * random();
}

function createIdleWander(opts = {}) {
  const random = typeof opts.random === "function" ? opts.random : Math.random;
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const cfg = {
    minDelayMs: numberOr(opts.minDelayMs, DEFAULTS.minDelayMs),
    maxDelayMs: numberOr(opts.maxDelayMs, DEFAULTS.maxDelayMs),
    minDistancePx: numberOr(opts.minDistancePx, DEFAULTS.minDistancePx),
    maxDistancePx: numberOr(opts.maxDistancePx, DEFAULTS.maxDistancePx),
    minSteps: Math.max(1, Math.floor(numberOr(opts.minSteps, DEFAULTS.minSteps))),
    maxSteps: Math.max(1, Math.floor(numberOr(opts.maxSteps, DEFAULTS.maxSteps))),
    verticalScale: numberOr(opts.verticalScale, DEFAULTS.verticalScale),
  };
  if (cfg.maxDelayMs < cfg.minDelayMs) cfg.maxDelayMs = cfg.minDelayMs;
  if (cfg.maxDistancePx < cfg.minDistancePx) cfg.maxDistancePx = cfg.minDistancePx;
  if (cfg.maxSteps < cfg.minSteps) cfg.maxSteps = cfg.minSteps;

  let nextAt = 0;
  let active = null;

  function scheduleNext(from = now()) {
    nextAt = from + randBetween(random, cfg.minDelayMs, cfg.maxDelayMs);
  }

  function reset() {
    active = null;
    scheduleNext(now());
  }

  function startMove() {
    const angle = random() * Math.PI * 2;
    const distance = randBetween(random, cfg.minDistancePx, cfg.maxDistancePx);
    const steps = Math.max(1, Math.round(randBetween(random, cfg.minSteps, cfg.maxSteps)));
    active = {
      remaining: steps,
      dx: Math.cos(angle) * distance / steps,
      dy: Math.sin(angle) * distance * cfg.verticalScale / steps,
    };
  }

  function tick(params = {}) {
    const allow = typeof params.allow === "function" ? params.allow() : !!params.allow;
    if (!allow) {
      reset();
      return false;
    }

    const t = now();
    if (!active && t < nextAt) return false;
    if (!active) startMove();
    if (!active) return false;

    const bounds = typeof params.getBounds === "function" ? params.getBounds() : params.bounds;
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
      reset();
      return false;
    }

    const nextX = bounds.x + active.dx;
    const nextY = bounds.y + active.dy;
    const clamp = typeof params.clamp === "function" ? params.clamp : null;
    const clamped = clamp
      ? clamp(nextX, nextY, bounds.width, bounds.height)
      : { x: nextX, y: nextY };
    if (!clamped || !Number.isFinite(clamped.x) || !Number.isFinite(clamped.y)) {
      reset();
      return false;
    }

    const nextBounds = {
      ...bounds,
      x: Math.round(clamped.x),
      y: Math.round(clamped.y),
    };

    if (nextBounds.x !== bounds.x || nextBounds.y !== bounds.y) {
      if (typeof params.move === "function") params.move(nextBounds);
    }

    active.remaining -= 1;
    if (active.remaining <= 0) {
      active = null;
      scheduleNext(t);
    }
    return true;
  }

  reset();

  return {
    tick,
    reset,
    isMoving: () => !!active,
    getNextAt: () => nextAt,
  };
}

module.exports = { DEFAULTS, createIdleWander };
