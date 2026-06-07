"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { computeGlassboxBubbleBounds } = require("../src/glassbox-bubble").__test;

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

describe("glassbox-bubble computeGlassboxBubbleBounds", () => {
  it("centers the bubble above the pet", () => {
    const b = computeGlassboxBubbleBounds({
      petBounds: { x: 900, y: 500, width: 120, height: 120 }, workArea: WA, width: 200, height: 56,
    });
    assert.strictEqual(b.width, 200);
    assert.strictEqual(b.height, 56);
    assert.strictEqual(b.x, 860); // petCx 960 - 100
    assert.strictEqual(b.y, 436); // 500 - 8 gap - 56
  });

  it("flips below the pet when there is no room above", () => {
    const b = computeGlassboxBubbleBounds({
      petBounds: { x: 900, y: 10, width: 120, height: 120 }, workArea: WA, width: 200, height: 56,
    });
    assert.strictEqual(b.y, 138); // above would be -54; below = 10 + 120 + 8
  });

  it("clamps x within the work area at both edges", () => {
    const left = computeGlassboxBubbleBounds({
      petBounds: { x: 0, y: 500, width: 100, height: 100 }, workArea: WA, width: 200, height: 56,
    });
    assert.ok(left.x >= WA.x + 8, "left clamped");
    const right = computeGlassboxBubbleBounds({
      petBounds: { x: 1900, y: 500, width: 100, height: 100 }, workArea: WA, width: 200, height: 56,
    });
    assert.ok(right.x <= WA.x + WA.width - 200 - 8, "right clamped");
  });

  it("respects a work area with a non-zero origin", () => {
    const wa2 = { x: 100, y: 100, width: 800, height: 600 };
    const b = computeGlassboxBubbleBounds({
      petBounds: { x: 400, y: 120, width: 100, height: 100 }, workArea: wa2, width: 200, height: 56,
    });
    assert.ok(b.y >= wa2.y + 8);
    assert.strictEqual(b.y, 228); // above too high → below = 120 + 100 + 8
  });
});
