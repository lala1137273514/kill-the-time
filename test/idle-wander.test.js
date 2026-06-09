"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createIdleWander } = require("../src/idle-wander");

describe("idle-wander", () => {
  it("waits until scheduled and then moves in small clamped steps", () => {
    let t = 0;
    const moved = [];
    const wander = createIdleWander({
      now: () => t,
      random: () => 0,
      minDelayMs: 1000,
      maxDelayMs: 1000,
      minDistancePx: 10,
      maxDistancePx: 10,
      minSteps: 5,
      maxSteps: 5,
      verticalScale: 1,
    });

    const bounds = { x: 50, y: 50, width: 100, height: 100 };
    assert.strictEqual(wander.tick({ allow: true, bounds, move: (b) => moved.push(b) }), false);
    t = 1000;
    assert.strictEqual(wander.tick({ allow: true, bounds, move: (b) => moved.push(b) }), true);
    assert.strictEqual(moved.length, 1);
    assert.deepStrictEqual(moved[0], { x: 52, y: 50, width: 100, height: 100 });
  });

  it("resets and does not move while disabled", () => {
    let t = 1000;
    const moved = [];
    const wander = createIdleWander({
      now: () => t,
      random: () => 0,
      minDelayMs: 1000,
      maxDelayMs: 1000,
    });

    assert.strictEqual(wander.tick({
      allow: false,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      move: (b) => moved.push(b),
    }), false);
    assert.deepStrictEqual(moved, []);
    assert.strictEqual(wander.isMoving(), false);
  });

  it("uses clamp before applying movement", () => {
    let t = 0;
    const moved = [];
    const wander = createIdleWander({
      now: () => t,
      random: () => 0,
      minDelayMs: 1000,
      maxDelayMs: 1000,
      minDistancePx: 20,
      maxDistancePx: 20,
      minSteps: 1,
      maxSteps: 1,
    });

    t = 1000;
    wander.tick({
      allow: true,
      bounds: { x: 95, y: 20, width: 100, height: 100 },
      clamp: () => ({ x: 100, y: 20 }),
      move: (b) => moved.push(b),
    });

    assert.deepStrictEqual(moved, [{ x: 100, y: 20, width: 100, height: 100 }]);
  });
});
