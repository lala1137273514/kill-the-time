"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { PROTECTED_STATES, resolvePhaseReflection } = require("../src/state-phase-resolver");

describe("state-phase-resolver resolvePhaseReflection", () => {
  it("reflects mid-flow phases onto the pet when it is idle", () => {
    assert.strictEqual(resolvePhaseReflection("thinking", "idle"), "thinking");
    assert.strictEqual(resolvePhaseReflection("capturing", "idle"), "sweeping");
    assert.strictEqual(resolvePhaseReflection("confirming", "idle"), "attention");
    assert.strictEqual(resolvePhaseReflection("dispatching", "idle"), "carrying");
    assert.strictEqual(resolvePhaseReflection("running", "working"), "working");
  });

  it("reflects done as a celebratory one-shot and error as error", () => {
    assert.strictEqual(resolvePhaseReflection("done", "working"), "notification");
    assert.strictEqual(resolvePhaseReflection("error", "working"), "error");
  });

  it("returns null for phases that map to idle (nothing to show)", () => {
    assert.strictEqual(resolvePhaseReflection("cancelled", "idle"), null);
  });

  it("never stomps the sleep family (don't wake the pet)", () => {
    for (const s of ["sleeping", "dozing", "collapsing", "waking", "yawning"]) {
      assert.strictEqual(resolvePhaseReflection("thinking", s), null, s);
      assert.strictEqual(resolvePhaseReflection("running", s), null, s);
    }
  });

  it("never stomps high-priority machine-owned states", () => {
    for (const s of ["error", "notification"]) {
      assert.strictEqual(resolvePhaseReflection("thinking", s), null, s);
    }
    // mid-tier states (sweeping/carrying) are reflection targets now, so a phase
    // may overwrite them as the flow advances — they are NOT protected.
    assert.strictEqual(resolvePhaseReflection("running", "carrying"), "working");
    assert.strictEqual(resolvePhaseReflection("confirming", "sweeping"), "attention");
  });

  it("still reflects when current state is unknown / not a string", () => {
    assert.strictEqual(resolvePhaseReflection("thinking", null), "thinking");
    assert.strictEqual(resolvePhaseReflection("thinking", undefined), "thinking");
  });

  it("returns null for an unknown phase", () => {
    assert.strictEqual(resolvePhaseReflection("nope", "idle"), null);
  });

  it("exposes the protected-state set for callers/tests", () => {
    assert.ok(PROTECTED_STATES instanceof Set);
    assert.ok(PROTECTED_STATES.has("sleeping"));
    assert.ok(PROTECTED_STATES.has("notification"));
  });
});
