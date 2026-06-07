"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { computeFxBounds } = require("../src/glassbox-fx").__test;

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

describe("glassbox-fx computeFxBounds", () => {
  it("centers the overlay on the pet", () => {
    const b = computeFxBounds({ petBounds: { x: 900, y: 500, width: 120, height: 120 }, workArea: WA, width: 280, height: 200 });
    assert.strictEqual(b.width, 280);
    assert.strictEqual(b.height, 200);
    assert.strictEqual(b.x, 820); // petCx 960 - 140
    assert.strictEqual(b.y, 460); // petCy 560 - 100
  });

  it("clamps within the work area at both extremes", () => {
    const right = computeFxBounds({ petBounds: { x: 1850, y: 1000, width: 120, height: 120 }, workArea: WA, width: 280, height: 200 });
    assert.ok(right.x <= WA.x + WA.width - 280 - 8);
    assert.ok(right.y <= WA.y + WA.height - 200 - 8);
    const left = computeFxBounds({ petBounds: { x: -20, y: -20, width: 120, height: 120 }, workArea: WA, width: 280, height: 200 });
    assert.ok(left.x >= WA.x + 8);
    assert.ok(left.y >= WA.y + 8);
  });

  it("respects a non-zero work-area origin", () => {
    const wa2 = { x: 100, y: 100, width: 800, height: 600 };
    const b = computeFxBounds({ petBounds: { x: 400, y: 300, width: 100, height: 100 }, workArea: wa2, width: 280, height: 200 });
    assert.ok(b.x >= wa2.x + 8 && b.x <= wa2.x + wa2.width - 280 - 8);
    assert.ok(b.y >= wa2.y + 8 && b.y <= wa2.y + wa2.height - 200 - 8);
  });
});
