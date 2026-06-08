"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { PHASES, phaseFeedback } = require("../src/glassbox-phase-ui");

// Only states that ship with the built-in themes — phase reflection must reuse
// existing assets so it degrades gracefully on any theme (no new SVGs required).
const REAL_PET_STATES = new Set([
  "idle",
  "thinking",
  "working",
  "attention",
  "notification",
  "error",
  "sweeping",
  "carrying",
]);

const NON_TERMINAL = ["thinking", "capturing", "confirming", "dispatching", "running"];
const TERMINAL = ["done", "approved", "denied", "answered", "chatting", "cancelled", "needs-input", "error"];

describe("glassbox-phase-ui phaseFeedback", () => {
  it("exports every known phase exactly once", () => {
    assert.ok(Array.isArray(PHASES));
    assert.strictEqual(new Set(PHASES).size, PHASES.length);
    for (const p of [...NON_TERMINAL, ...TERMINAL]) {
      assert.ok(PHASES.includes(p), `PHASES missing ${p}`);
    }
  });

  it("returns string status, string emoji, real petState, and boolean terminal for every phase", () => {
    for (const p of PHASES) {
      const fb = phaseFeedback(p);
      assert.strictEqual(typeof fb.status, "string", `${p} status`);
      assert.strictEqual(typeof fb.emoji, "string", `${p} emoji`);
      assert.strictEqual(typeof fb.terminal, "boolean", `${p} terminal`);
      assert.ok(REAL_PET_STATES.has(fb.petState), `${p} petState ${fb.petState} not a shipped state`);
    }
  });

  it("marks mid-flow phases non-terminal and end phases terminal", () => {
    for (const p of NON_TERMINAL) assert.strictEqual(phaseFeedback(p).terminal, false, p);
    for (const p of TERMINAL) assert.strictEqual(phaseFeedback(p).terminal, true, p);
  });

  it("reflects sensible pet states for the key phases", () => {
    assert.strictEqual(phaseFeedback("thinking").petState, "thinking");
    assert.strictEqual(phaseFeedback("capturing").petState, "sweeping");
    assert.strictEqual(phaseFeedback("dispatching").petState, "carrying");
    assert.strictEqual(phaseFeedback("running").petState, "working");
    assert.strictEqual(phaseFeedback("confirming").petState, "attention");
    assert.strictEqual(phaseFeedback("error").petState, "error");
    assert.strictEqual(phaseFeedback("cancelled").petState, "idle");
  });

  it("uses Chinese status microcopy with a non-empty hint for mid-flow phases", () => {
    assert.match(phaseFeedback("thinking").status, /想|思考/);
    assert.match(phaseFeedback("running").status, /干活|处理|跑|监工/);
    for (const p of NON_TERMINAL) assert.ok(phaseFeedback(p).status.length > 0, `${p} status empty`);
    assert.ok(phaseFeedback("done").status.length > 0);
  });

  it("falls back gracefully for an unknown phase", () => {
    const fb = phaseFeedback("totally-unknown");
    assert.strictEqual(fb.petState, "idle");
    assert.strictEqual(fb.terminal, true);
    assert.strictEqual(typeof fb.status, "string");
    assert.strictEqual(typeof fb.emoji, "string");
  });

  it("falls back gracefully for empty / non-string input", () => {
    for (const bad of ["", null, undefined, 42]) {
      const fb = phaseFeedback(bad);
      assert.strictEqual(fb.petState, "idle");
      assert.strictEqual(fb.terminal, true);
    }
  });
});
