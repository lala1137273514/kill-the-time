"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { CONFIRM_MODES, needsConfirmation } = require("../src/glassbox-router");

describe("glassbox-router needsConfirmation", () => {
  it("defaults to agent-native (no extra pre-dispatch confirm)", () => {
    assert.strictEqual(needsConfirmation({ risk: "read" }, {}), false);
    assert.strictEqual(needsConfirmation({ risk: "write" }, {}), false);
    assert.strictEqual(needsConfirmation({ risk: "read" }), false);
    assert.strictEqual(needsConfirmation({ risk: "read" }, { confirmMode: "bogus" }), false);
    assert.strictEqual(needsConfirmation({ risk: "write" }, { confirmMode: "agent-native" }), false);
  });

  it("always mode confirms every dispatch", () => {
    assert.strictEqual(needsConfirmation({ risk: "read" }, { confirmMode: "always" }), true);
    assert.strictEqual(needsConfirmation({ risk: "write" }, { confirmMode: "always" }), true);
  });

  it("writes-only mode skips confirm for read-only, keeps it for writes", () => {
    assert.strictEqual(needsConfirmation({ risk: "read" }, { confirmMode: "writes-only" }), false);
    assert.strictEqual(needsConfirmation({ risk: "write" }, { confirmMode: "writes-only" }), true);
  });

  it("treats a missing/unknown risk as non-write (read-ish) in writes-only mode", () => {
    assert.strictEqual(needsConfirmation({}, { confirmMode: "writes-only" }), false);
    assert.strictEqual(needsConfirmation(null, { confirmMode: "writes-only" }), false);
    assert.strictEqual(needsConfirmation({ risk: "anything" }, { confirmMode: "writes-only" }), false);
  });

  it("exposes the valid confirm modes", () => {
    assert.deepStrictEqual([...CONFIRM_MODES].sort(), ["agent-native", "always", "writes-only"]);
  });
});
