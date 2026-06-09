"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { DEFAULT_LINES, createDragNarration } = require("../src/glassbox-drag-narration");

describe("glassbox-drag-narration", () => {
  it("speaks only after the hold threshold while dragging", () => {
    let t = 1000;
    const spoken = [];
    const d = createDragNarration({
      now: () => t,
      random: () => 0,
      speak: (line) => spoken.push(line),
      minHoldMs: 1200,
      cooldownMs: 10000,
      chance: 1,
      lines: ["慢点"],
    });
    d.start();
    t += 1199;
    assert.strictEqual(d.maybeSpeak(), null);
    t += 1;
    assert.strictEqual(d.maybeSpeak(), "慢点");
    assert.deepStrictEqual(spoken, ["慢点"]);
  });

  it("respects cooldown and stops cleanly", () => {
    let t = 0;
    const spoken = [];
    const d = createDragNarration({
      now: () => t,
      random: () => 0,
      speak: (line) => spoken.push(line),
      minHoldMs: 0,
      cooldownMs: 5000,
      chance: 1,
      lines: ["A", "B"],
    });
    d.start();
    assert.strictEqual(d.maybeSpeak(), "A");
    t += 1000;
    assert.strictEqual(d.maybeSpeak(), null);
    d.end();
    t += 6000;
    assert.strictEqual(d.maybeSpeak(), null);
    assert.deepStrictEqual(spoken, ["A"]);
  });

  it("ships a small default line bank", () => {
    assert.ok(DEFAULT_LINES.length >= 3);
    assert.ok(DEFAULT_LINES.every((line) => typeof line === "string" && line.length > 0));
  });
});
