"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { computeHudBounds } = require("../src/glassbox-hud").__test;

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

describe("glassbox-hud computeHudBounds", () => {
  it("centers ABOVE the pet when there is room", () => {
    const b = computeHudBounds({ petBounds: { x: 900, y: 500, width: 120, height: 120 }, workArea: WA, width: 240, height: 110, gap: 8 });
    assert.strictEqual(b.width, 240);
    assert.strictEqual(b.x, 840); // cx 960 - 120
    assert.strictEqual(b.y, 500 - 8 - 110); // 382, above the pet with gap
  });
  it("flips below the pet when there is no room above", () => {
    const b = computeHudBounds({ petBounds: { x: 900, y: 0, width: 120, height: 120 }, workArea: WA, width: 240, height: 110, gap: 8 });
    assert.ok(b.y >= WA.y + 8);
    assert.ok(b.y >= 120); // below the pet (its bottom is 120)
  });
  it("clamps x within the work area when the pet hugs the right edge", () => {
    const b = computeHudBounds({ petBounds: { x: 1850, y: 300, width: 120, height: 120 }, workArea: WA, width: 240, height: 110, gap: 8 });
    assert.ok(b.x >= WA.x + 8);
    assert.ok(b.x + 240 <= WA.x + WA.width - 8);
  });
  it("respects a non-zero work-area origin", () => {
    const wa2 = { x: 100, y: 100, width: 800, height: 600 };
    const b = computeHudBounds({ petBounds: { x: 400, y: 300, width: 100, height: 100 }, workArea: wa2, width: 240, height: 110, gap: 8 });
    assert.ok(b.x >= wa2.x + 8 && b.x + 240 <= wa2.x + wa2.width - 8);
    assert.ok(b.y >= wa2.y + 8 && b.y + 110 <= wa2.y + wa2.height - 8);
  });
});
