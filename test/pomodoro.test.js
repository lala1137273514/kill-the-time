"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createPomodoro, formatRemaining } = require("../src/pomodoro");

describe("pomodoro formatRemaining", () => {
  it("mm:ss, ceil seconds", () => {
    assert.strictEqual(formatRemaining(25 * 60000), "25:00");
    assert.strictEqual(formatRemaining(65000), "1:05");
    assert.strictEqual(formatRemaining(4200), "0:05"); // ceil
    assert.strictEqual(formatRemaining(0), "0:00");
    assert.strictEqual(formatRemaining(-50), "0:00");
  });
});

describe("pomodoro state machine", () => {
  function harness() {
    let t = 0;
    const p = createPomodoro({ now: () => t, focusMs: 1000, breakMs: 500 });
    return { p, adv: (ms) => { t += ms; } };
  }
  it("starts idle", () => {
    const { p } = harness();
    assert.strictEqual(p.state, "idle");
    assert.strictEqual(p.snapshot().remainingMs, 0);
  });
  it("startFocus -> focus with full remaining; tick counts down", () => {
    const { p, adv } = harness();
    p.startFocus();
    assert.strictEqual(p.state, "focus");
    assert.strictEqual(p.snapshot().remainingMs, 1000);
    adv(400);
    const r = p.tick();
    assert.strictEqual(r.state, "focus");
    assert.strictEqual(r.remainingMs, 600);
    assert.strictEqual(r.justFinished, null);
  });
  it("tick at/after end -> justFinished kind, returns to idle", () => {
    const { p, adv } = harness();
    p.startFocus();
    adv(1000);
    const r = p.tick();
    assert.strictEqual(r.justFinished, "focus");
    assert.strictEqual(r.state, "idle");
    assert.strictEqual(p.state, "idle");
    assert.strictEqual(p.tick().justFinished, null); // no double-fire
  });
  it("startBreak uses breakMs", () => {
    const { p } = harness();
    p.startBreak();
    assert.strictEqual(p.state, "break");
    assert.strictEqual(p.snapshot().remainingMs, 500);
  });
  it("stop -> idle, no remaining", () => {
    const { p } = harness();
    p.startFocus(); p.stop();
    assert.strictEqual(p.state, "idle");
    assert.strictEqual(p.snapshot().remainingMs, 0);
  });
  it("switching focus->break resets the clock", () => {
    const { p, adv } = harness();
    p.startFocus(); adv(300); p.startBreak();
    assert.strictEqual(p.snapshot().remainingMs, 500);
  });
});
