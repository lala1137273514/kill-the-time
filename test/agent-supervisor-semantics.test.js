"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  classifySession,
  inferDisplayHintFromTool,
  isWaitingSession,
  isCompactingSession,
} = require("../src/agent-supervisor-semantics");

function session(overrides = {}) {
  return {
    agentId: "codex",
    state: "working",
    badge: "running",
    currentTool: null,
    subagentCount: 0,
    lastEvent: { rawEvent: "PreToolUse" },
    ...overrides,
  };
}

describe("agent-supervisor-semantics classifySession", () => {
  it("maps permission events to the waiting supervisor state", () => {
    const semantic = classifySession(session({ lastEvent: { rawEvent: "PermissionRequest" } }));
    assert.strictEqual(semantic.kind, "waiting");
    assert.strictEqual(semantic.animation, "permission/waiting");
    assert.strictEqual(semantic.waiting, true);
    assert.strictEqual(isWaitingSession(session({ lastEvent: { rawEvent: "PermissionRequest" } })), true);
  });

  it("maps compacting and compacted events distinctly", () => {
    const compacting = classifySession(session({ state: "sweeping", lastEvent: { rawEvent: "PreCompact" } }));
    assert.strictEqual(compacting.kind, "compacting");
    assert.strictEqual(compacting.animation, "compacting");
    assert.strictEqual(isCompactingSession(session({ state: "sweeping", lastEvent: { rawEvent: "PreCompact" } })), true);

    const compacted = classifySession(session({ state: "idle", badge: "done", lastEvent: { rawEvent: "PostCompact" } }));
    assert.strictEqual(compacted.kind, "compacted");
    assert.strictEqual(compacted.animation, "done");
  });

  it("keeps debugging, done, and subagent states richer than generic working", () => {
    assert.strictEqual(classifySession(session({ badge: "interrupted", lastEvent: { rawEvent: "PostToolUseFailure" } })).kind, "error");
    assert.strictEqual(classifySession(session({ state: "idle", badge: "done", lastEvent: { rawEvent: "Stop" } })).kind, "done");
    assert.strictEqual(classifySession(session({ state: "juggling", subagentCount: 1 })).kind, "subagent-single");
    assert.strictEqual(classifySession(session({ state: "juggling", subagentCount: 3 })).kind, "subagent-multi");
  });
});

describe("agent-supervisor-semantics inferDisplayHintFromTool", () => {
  it("selects existing Clawd debugger/building hints without inventing states", () => {
    const displayHintMap = {
      "clawd-working-debugger.svg": "debugger",
      "clawd-working-building.svg": "building",
    };
    assert.strictEqual(inferDisplayHintFromTool({ state: "working", toolName: "Grep", displayHintMap }), "clawd-working-debugger.svg");
    assert.strictEqual(inferDisplayHintFromTool({ state: "working", toolName: "Bash", displayHintMap }), "clawd-working-building.svg");
    assert.strictEqual(inferDisplayHintFromTool({ state: "idle", toolName: "Bash", displayHintMap }), undefined);
  });
});
