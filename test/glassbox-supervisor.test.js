"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createSupervisor } = require("../src/glassbox-supervisor");

// A session snapshot entry as built by state-session-snapshot.js:
//   { id, badge: "running"|"done"|"interrupted"|"idle", state, currentTool, subagentCount }
function sess(over = {}) {
  return { id: "s1", badge: "running", state: "working", currentTool: null, subagentCount: 0, ...over };
}

describe("glassbox-supervisor", () => {
  it("returns null on the very first note (nothing to compare yet)", () => {
    let t = 1000;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    assert.strictEqual(sup.note(sess()), null);
  });

  it("emits done when a running session reaches the done badge", () => {
    let t = 1000;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.note(sess({ badge: "running" }));
    t = 2000;
    const ev = sup.note(sess({ badge: "done", state: "idle" }));
    assert.ok(ev);
    assert.strictEqual(ev.kind, "done");
    assert.strictEqual(typeof ev.say, "string");
    assert.ok(ev.say.length > 0);
  });

  it("emits error when a running session is interrupted", () => {
    let t = 1000;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.note(sess({ badge: "running" }));
    t = 1500;
    const ev = sup.note(sess({ badge: "interrupted" }));
    assert.ok(ev);
    assert.strictEqual(ev.kind, "error");
    assert.ok(ev.say.length > 0);
  });

  it("emits stuck when running with no tool change for longer than stuckMs", () => {
    let t = 0;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.note(sess({ currentTool: "Bash" }));          // t=0, baseline tool
    t = 3000;
    assert.strictEqual(sup.note(sess({ currentTool: "Bash" })), null); // not yet
    t = 6000;
    const ev = sup.note(sess({ currentTool: "Bash" })); // 6s with same tool
    assert.ok(ev);
    assert.strictEqual(ev.kind, "stuck");
    assert.ok(ev.say.length > 0);
  });

  it("resets the stuck clock when the tool changes (=progress)", () => {
    let t = 0;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.note(sess({ currentTool: "Bash" }));   // t=0
    t = 4000;
    sup.note(sess({ currentTool: "Edit" }));   // tool changed -> clock resets
    t = 8000;
    // only 4s since the Edit change -> not stuck yet
    assert.strictEqual(sup.note(sess({ currentTool: "Edit" })), null);
    t = 9001;
    const ev = sup.note(sess({ currentTool: "Edit" })); // >5s since change
    assert.ok(ev);
    assert.strictEqual(ev.kind, "stuck");
  });

  it("does not emit stuck twice for the same stall (one warning per stall)", () => {
    let t = 0;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.note(sess({ currentTool: "Bash" }));
    t = 6000;
    const first = sup.note(sess({ currentTool: "Bash" }));
    assert.ok(first && first.kind === "stuck");
    t = 12000;
    const second = sup.note(sess({ currentTool: "Bash" }));
    assert.strictEqual(second, null);
  });

  it("re-arms the stuck warning after a tool change clears a prior stall", () => {
    let t = 0;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.note(sess({ currentTool: "Bash" }));
    t = 6000;
    assert.ok(sup.note(sess({ currentTool: "Bash" }))); // stuck #1
    t = 7000;
    sup.note(sess({ currentTool: "Grep" })); // progress -> re-arm
    t = 13001;
    const ev = sup.note(sess({ currentTool: "Grep" })); // stuck again on new tool
    assert.ok(ev && ev.kind === "stuck");
  });

  it("treats a subagent fan-out as progress (resets the stuck clock)", () => {
    let t = 0;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.note(sess({ currentTool: "Task", subagentCount: 0 }));
    t = 4000;
    sup.note(sess({ currentTool: "Task", subagentCount: 3 })); // fan-out = progress
    t = 8000;
    // tool unchanged but subagentCount changed at t=4000 -> clock reset there
    assert.strictEqual(sup.note(sess({ currentTool: "Task", subagentCount: 3 })), null);
  });

  it("ignores idle/no-session snapshots and never reports stuck for them", () => {
    let t = 0;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.note(sess({ badge: "running", currentTool: "Bash" }));
    t = 100000;
    // session went idle (not running) -> no stuck even though time elapsed
    assert.strictEqual(sup.note(sess({ badge: "idle", state: "idle" })), null);
  });

  it("does not re-emit done on subsequent done snapshots", () => {
    let t = 1000;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.note(sess({ badge: "running" }));
    t = 2000;
    assert.ok(sup.note(sess({ badge: "done", state: "idle" })));
    t = 3000;
    assert.strictEqual(sup.note(sess({ badge: "done", state: "idle" })), null);
  });

  it("accepts a full snapshot object via noteSnapshot and picks the primary session", () => {
    let t = 1000;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    sup.noteSnapshot({ sessions: [sess({ id: "a", badge: "running" })], hudLastSessionId: "a" });
    t = 2000;
    const ev = sup.noteSnapshot({ sessions: [sess({ id: "a", badge: "done", state: "idle" })], hudLastSessionId: "a" });
    assert.ok(ev);
    assert.strictEqual(ev.kind, "done");
  });

  it("noteSnapshot returns null when there is no primary running session", () => {
    let t = 1000;
    const sup = createSupervisor({ stuckMs: 5000, now: () => t });
    assert.strictEqual(sup.noteSnapshot({ sessions: [] }), null);
    assert.strictEqual(sup.noteSnapshot({ sessions: [sess({ id: "a", badge: "idle", state: "idle" })] }), null);
  });

  it("defaults stuckMs and now when not injected (still constructs)", () => {
    const sup = createSupervisor();
    assert.strictEqual(typeof sup.note, "function");
    assert.strictEqual(typeof sup.noteSnapshot, "function");
    // first note is always null regardless of defaults
    assert.strictEqual(sup.note(sess()), null);
  });
});
