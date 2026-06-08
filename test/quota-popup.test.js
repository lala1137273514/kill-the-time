"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { computeQuotaPopupBounds } = require("../src/quota-popup").__test;

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

describe("quota-popup computeQuotaPopupBounds", () => {
  it("centers above the pet on the visible portion", () => {
    const b = computeQuotaPopupBounds({ petBounds: { x: 900, y: 500, width: 120, height: 120 }, workArea: WA, width: 260, height: 150 });
    assert.strictEqual(b.width, 260);
    assert.strictEqual(b.height, 150);
    assert.strictEqual(b.x, 830); // cx 960 - 130
    assert.strictEqual(b.y, 500 - 8 - 150); // above with gap 8
  });
  it("flips below when no room above, clamps on screen", () => {
    const b = computeQuotaPopupBounds({ petBounds: { x: 10, y: 0, width: 120, height: 120 }, workArea: WA, width: 260, height: 150 });
    assert.ok(b.y >= WA.y + 8);
    assert.ok(b.x >= WA.x + 8);
  });
});
