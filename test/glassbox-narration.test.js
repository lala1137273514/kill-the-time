"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { NarrationController, MILESTONES } = require("../src/glassbox-narration");

function sess(over = {}) {
  return { id: "s1", badge: "idle", state: "idle", subagentCount: 0, ...over };
}

describe("glassbox-narration", () => {
  it("speaks a start line when a session begins running", () => {
    const c = new NarrationController({ minIntervalMs: 4000 });
    const out = c.next(sess({ badge: "running", state: "thinking" }), 1000);
    assert.ok(out);
    assert.strictEqual(out.milestone, MILESTONES.START);
    assert.strictEqual(typeof out.text, "string");
    assert.ok(out.text.length > 0);
  });

  it("throttles a second milestone inside the interval", () => {
    const c = new NarrationController({ minIntervalMs: 4000 });
    assert.ok(c.next(sess({ badge: "running" }), 1000)); // start, speaks
    // fanout transition at t=2000 (within 4000ms floor) -> suppressed
    const muted = c.next(sess({ badge: "running", state: "juggling", subagentCount: 3 }), 2000);
    assert.strictEqual(muted, null);
  });

  it("announces fan-out with the live subagent count once the floor clears", () => {
    const c = new NarrationController({ minIntervalMs: 4000 });
    c.next(sess({ badge: "running" }), 1000); // start
    c.next(sess({ badge: "running", state: "juggling", subagentCount: 2 }), 2000); // throttled
    const out = c.next(sess({ badge: "running", state: "juggling", subagentCount: 3 }), 6000);
    assert.ok(out);
    assert.strictEqual(out.milestone, MILESTONES.FANOUT);
    assert.match(out.text, /3/);
  });

  it("lets the done milestone bypass the throttle", () => {
    const c = new NarrationController({ minIntervalMs: 4000 });
    c.next(sess({ badge: "running" }), 1000); // start at t=1000
    const out = c.next(sess({ badge: "done", state: "idle" }), 1500); // within floor
    assert.ok(out);
    assert.strictEqual(out.milestone, MILESTONES.DONE);
  });

  it("speaks a stuck line on entering error", () => {
    const c = new NarrationController({ minIntervalMs: 0 });
    c.next(sess({ badge: "running", state: "working" }), 0);
    const out = c.next(sess({ badge: "running", state: "error" }), 100);
    assert.ok(out);
    assert.strictEqual(out.milestone, MILESTONES.STUCK);
  });

  it("does not repeat a milestone without a real transition", () => {
    const c = new NarrationController({ minIntervalMs: 0 });
    assert.ok(c.next(sess({ badge: "running" }), 0)); // start
    const again = c.next(sess({ badge: "running" }), 10); // no transition
    assert.strictEqual(again, null);
  });

  it("rotates phrasing across repeated milestones", () => {
    const c = new NarrationController({ minIntervalMs: 0 });
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      c.next(sess({ id: "s1", badge: "idle" }), i * 10); // reset to idle
      const out = c.next(sess({ id: "s1", badge: "running" }), i * 10 + 1);
      if (out) seen.add(out.text);
    }
    assert.ok(seen.size >= 2, "expected varied start phrasing");
  });

  it("prunes tracking for sessions no longer present", () => {
    const c = new NarrationController({ minIntervalMs: 0 });
    c.next(sess({ id: "s1", badge: "running" }), 0);
    c.prune(["s2"]);
    assert.strictEqual(c.prev.has("s1"), false);
  });
});
