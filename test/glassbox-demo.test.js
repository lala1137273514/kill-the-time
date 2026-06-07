"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { demoSteps, runDemo } = require("../src/glassbox-demo");

describe("glassbox-demo demoSteps", () => {
  it("scripts a full flow from thinking to a terminal done", () => {
    const steps = demoSteps();
    assert.ok(Array.isArray(steps) && steps.length >= 4);
    assert.strictEqual(steps[0].phase, "thinking");
    assert.strictEqual(steps[steps.length - 1].phase, "done");
  });

  it("every step has a phase and a positive hold duration", () => {
    for (const s of demoSteps()) {
      assert.strictEqual(typeof s.phase, "string");
      assert.ok(s.phase.length > 0);
      assert.ok(Number.isFinite(s.holdMs) && s.holdMs > 0, `${s.phase} holdMs`);
      if (s.say !== undefined) assert.strictEqual(typeof s.say, "string");
    }
  });
});

describe("glassbox-demo runDemo", () => {
  function spyDeps(over = {}) {
    const calls = { phases: [], said: [], slept: [] };
    return {
      calls,
      deps: {
        emitPhase: (p) => calls.phases.push(p),
        speak: (t) => calls.said.push(t),
        sleep: async (ms) => { calls.slept.push(ms); },
        isCancelled: over.isCancelled || (() => false),
        steps: over.steps,
      },
    };
  }

  it("emits every phase in order and sleeps each hold", async () => {
    const { calls, deps } = spyDeps({
      steps: [
        { phase: "thinking", say: "想想", holdMs: 10 },
        { phase: "running", holdMs: 20 },
        { phase: "done", say: "好了", holdMs: 30 },
      ],
    });
    const res = await runDemo(deps);
    assert.deepStrictEqual(calls.phases, ["thinking", "running", "done"]);
    assert.deepStrictEqual(calls.slept, [10, 20, 30]);
    assert.strictEqual(res.completed, true);
  });

  it("speaks only steps that have a say line", async () => {
    const { calls, deps } = spyDeps({
      steps: [
        { phase: "thinking", say: "想想", holdMs: 1 },
        { phase: "running", holdMs: 1 },
        { phase: "done", say: "好了", holdMs: 1 },
      ],
    });
    await runDemo(deps);
    assert.deepStrictEqual(calls.said, ["想想", "好了"]);
  });

  it("stops early when cancelled", async () => {
    let n = 0;
    const { calls, deps } = spyDeps({
      isCancelled: () => (++n > 2), // false, false, then true before 3rd step
      steps: [
        { phase: "thinking", holdMs: 1 },
        { phase: "running", holdMs: 1 },
        { phase: "done", holdMs: 1 },
      ],
    });
    const res = await runDemo(deps);
    assert.deepStrictEqual(calls.phases, ["thinking", "running"]);
    assert.strictEqual(res.completed, false);
  });

  it("uses the default script when no steps are injected", async () => {
    const { calls, deps } = spyDeps();
    await runDemo(deps);
    assert.strictEqual(calls.phases[0], "thinking");
    assert.strictEqual(calls.phases[calls.phases.length - 1], "done");
  });

  it("tolerates missing deps (no throw)", async () => {
    await assert.doesNotReject(() => runDemo({ steps: [{ phase: "done", holdMs: 1 }], sleep: async () => {} }));
  });
});
