"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { routeVoiceCommand } = require("../src/glassbox-intent");

describe("glassbox-intent routeVoiceCommand", () => {
  it("approves a pending permission on affirmative speech", () => {
    const r = routeVoiceCommand("批准", { permissionPending: true });
    assert.strictEqual(r.action, "approve");
  });

  it("denies a pending permission, and 不可以 is not mistaken for 可以", () => {
    assert.strictEqual(routeVoiceCommand("拒绝", { permissionPending: true }).action, "deny");
    assert.strictEqual(routeVoiceCommand("不可以", { permissionPending: true }).action, "deny");
  });

  it("treats negated approval (不批准/别批准) as deny, not approve", () => {
    assert.strictEqual(routeVoiceCommand("不批准", { permissionPending: true }).action, "deny");
    assert.strictEqual(routeVoiceCommand("别批准", { permissionPending: true }).action, "deny");
    assert.strictEqual(routeVoiceCommand("不同意", { permissionPending: true }).action, "deny");
  });

  it("does NOT approve on weak fillers (好的/可以/行) — only strong words approve", () => {
    // Safety: whisper hallucinates fillers from noise; they must not auto-approve.
    for (const filler of ["好的", "可以", "行", "嗯"]) {
      assert.notStrictEqual(routeVoiceCommand(filler, { permissionPending: true }).action, "approve");
    }
    assert.strictEqual(routeVoiceCommand("批准", { permissionPending: true }).action, "approve");
    assert.strictEqual(routeVoiceCommand("同意", { permissionPending: true }).action, "approve");
  });

  it("treats other speech as the answer when a clarification is pending", () => {
    const r = routeVoiceCommand("把估值也算进去", { clarificationPending: true });
    assert.strictEqual(r.action, "answer");
    assert.strictEqual(r.text, "把估值也算进去");
  });

  it("ignores approve/deny words when nothing is pending (becomes a task)", () => {
    const r = routeVoiceCommand("批准", {});
    assert.strictEqual(r.action, "task");
  });

  it("routes a fresh request to task by default", () => {
    const r = routeVoiceCommand("帮我对比这三家公司", {});
    assert.strictEqual(r.action, "task");
    assert.strictEqual(r.text, "帮我对比这三家公司");
  });

  it("returns none for empty/blank input", () => {
    assert.strictEqual(routeVoiceCommand("   ", { permissionPending: true }).action, "none");
    assert.strictEqual(routeVoiceCommand("", {}).action, "none");
  });

  it("tolerates punctuation and spacing around the keyword", () => {
    assert.strictEqual(routeVoiceCommand("批 准。", { permissionPending: true }).action, "approve");
    assert.strictEqual(routeVoiceCommand("同意！", { permissionPending: true }).action, "approve");
  });

  it("permission precedence beats clarification for approve/deny words", () => {
    const r = routeVoiceCommand("同意", { permissionPending: true, clarificationPending: true });
    assert.strictEqual(r.action, "approve");
  });
});
