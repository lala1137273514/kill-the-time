"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { computeHudBounds } = require("../src/glassbox-hud").__test;

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

describe("glassbox-hud computeHudBounds", () => {
  it("anchors to the RIGHT of the pet when there is room, vertically centered", () => {
    const b = computeHudBounds({ petBounds: { x: 900, y: 500, width: 120, height: 120 }, workArea: WA, width: 276, height: 52, gap: 8 });
    assert.strictEqual(b.width, 276);
    assert.strictEqual(b.x, 1028); // petRight 1020 + gap 8
    assert.strictEqual(b.y, 534);  // petCenterY 560 - 26
  });
  it("flips to the LEFT when the pet hugs the right edge", () => {
    const b = computeHudBounds({ petBounds: { x: 1850, y: 100, width: 120, height: 120 }, workArea: WA, width: 276, height: 52, gap: 8 });
    // no room on the right (1970+8+276 > 1920) -> left of the visible pet
    assert.ok(b.x + b.width <= 1850); // sits left of the pet
    assert.ok(b.x >= WA.x + 8);
  });
  it("clamps y within the work area at the top edge", () => {
    const b = computeHudBounds({ petBounds: { x: 900, y: -10, width: 120, height: 120 }, workArea: WA, width: 276, height: 52, gap: 8 });
    assert.ok(b.y >= WA.y + 8);
  });
  it("respects a non-zero work-area origin", () => {
    const wa2 = { x: 100, y: 100, width: 800, height: 600 };
    const b = computeHudBounds({ petBounds: { x: 400, y: 300, width: 100, height: 100 }, workArea: wa2, width: 276, height: 52, gap: 8 });
    assert.ok(b.x >= wa2.x + 8 && b.x + b.width <= wa2.x + wa2.width - 8);
    assert.ok(b.y >= wa2.y + 8 && b.y + b.height <= wa2.y + wa2.height - 8);
  });
});
