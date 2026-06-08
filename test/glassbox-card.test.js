"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { computeCardBounds } = require("../src/glassbox-card").__test;

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

describe("glassbox-card computeCardBounds", () => {
  it("centers the card above the pet", () => {
    const b = computeCardBounds({
      petBounds: { x: 900, y: 500, width: 120, height: 120 }, workArea: WA, width: 320, height: 200,
    });
    assert.strictEqual(b.width, 320);
    assert.strictEqual(b.height, 200);
    assert.strictEqual(b.x, 800); // petCx 960 - 160
    assert.strictEqual(b.y, 292); // 500 - 8 gap - 200
  });

  it("flips below the pet when there is no room above", () => {
    const b = computeCardBounds({
      petBounds: { x: 900, y: 10, width: 120, height: 120 }, workArea: WA, width: 320, height: 200,
    });
    assert.strictEqual(b.y, 138); // above would be -198; below = 10 + 120 + 8
  });

  it("clamps x within the work area at both edges", () => {
    const left = computeCardBounds({
      petBounds: { x: 0, y: 500, width: 100, height: 100 }, workArea: WA, width: 320, height: 200,
    });
    assert.ok(left.x >= WA.x + 8, "left clamped");
    const right = computeCardBounds({
      petBounds: { x: 1900, y: 500, width: 100, height: 100 }, workArea: WA, width: 320, height: 200,
    });
    assert.ok(right.x <= WA.x + WA.width - 320 - 8, "right clamped");
  });

  it("respects a work area with a non-zero origin", () => {
    const wa2 = { x: 100, y: 100, width: 800, height: 600 };
    const b = computeCardBounds({
      petBounds: { x: 400, y: 120, width: 100, height: 100 }, workArea: wa2, width: 320, height: 200,
    });
    assert.ok(b.y >= wa2.y + 8);
    assert.strictEqual(b.y, 228); // above too high → below = 120 + 100 + 8
  });
});
