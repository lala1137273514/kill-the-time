"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createNarrator } = require("../src/glassbox-narrator");

describe("glassbox-narrator", () => {
  it("permission request outranks everything and returns card+speak+petState", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    const eff = n.observe({ source: "permission", kind: "request", text: "rm -rf /tmp/x" });
    assert.ok(eff);
    assert.strictEqual(eff.card.mode, "permission");
    assert.strictEqual(eff.card.summary, "rm -rf /tmp/x");
    assert.strictEqual(typeof eff.speak, "string");
    assert.ok(eff.speak.length > 0);
    assert.strictEqual(eff.petState, "notification");
  });

  it("permission request interrupts even mid glass-box phase", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    n.observe({ source: "phase", kind: "phase", text: "running" });
    const eff = n.observe({ source: "permission", kind: "request", text: "git push" });
    assert.strictEqual(eff.card.mode, "permission");
    assert.strictEqual(eff.petState, "notification");
  });

  it("permission resolved hides the card", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    const eff = n.observe({ source: "permission", kind: "resolved" });
    assert.ok(eff);
    assert.strictEqual(eff.card.mode, "hide");
    assert.strictEqual(eff.speak, undefined);
  });

  it("native sleep suppresses subsequent phase/commentary/chat", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    assert.strictEqual(n.observe({ source: "native", kind: "sleep" }), null);
    assert.strictEqual(n.observe({ source: "phase", kind: "phase", text: "running" }), null);
    assert.strictEqual(n.observe({ source: "commentary", kind: "milestone", text: "在改文件" }), null);
    assert.strictEqual(n.observe({ source: "chat", kind: "reply", text: "你好" }), null);
  });

  it("permission still passes through while asleep", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    n.observe({ source: "native", kind: "sleep" });
    const eff = n.observe({ source: "permission", kind: "request", text: "do thing" });
    assert.ok(eff);
    assert.strictEqual(eff.card.mode, "permission");
  });

  it("native wake clears the asleep flag and phases flow again", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    n.observe({ source: "native", kind: "sleep" });
    assert.strictEqual(n.observe({ source: "phase", kind: "phase", text: "running" }), null);
    n.observe({ source: "native", kind: "wake" });
    const eff = n.observe({ source: "phase", kind: "phase", text: "running" });
    assert.ok(eff);
    assert.strictEqual(eff.card.mode, "status");
  });

  it("glass-box phase maps to a status card with emoji/text/terminal + petState", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    const eff = n.observe({ source: "phase", kind: "phase", text: "running" });
    assert.ok(eff);
    assert.strictEqual(eff.card.mode, "status");
    assert.strictEqual(typeof eff.card.emoji, "string");
    assert.strictEqual(typeof eff.card.text, "string");
    assert.strictEqual(eff.card.terminal, false);
    assert.strictEqual(typeof eff.petState, "string");
  });

  it("sparse speak: a non-SPEAK phase returns card but no speak", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    const eff = n.observe({ source: "phase", kind: "phase", text: "running" });
    assert.ok(eff.card);
    assert.strictEqual(eff.speak, undefined);
  });

  it("sparse speak: a SPEAK-set phase (done) returns card AND speak", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    const eff = n.observe({ source: "phase", kind: "phase", text: "done" });
    assert.ok(eff.card);
    assert.strictEqual(eff.card.terminal, true);
    assert.strictEqual(typeof eff.speak, "string");
    assert.ok(eff.speak.length > 0);
  });

  it("chat returns both a chat card and speaks the reply text", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    const eff = n.observe({ source: "chat", kind: "reply", text: "明天多云" });
    assert.ok(eff);
    assert.strictEqual(eff.card.mode, "chat");
    assert.strictEqual(eff.card.text, "明天多云");
    assert.strictEqual(eff.speak, "明天多云");
  });

  it("commentary returns an activity card only, never speaks", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    const eff = n.observe({ source: "commentary", kind: "milestone", text: "在跑测试" });
    assert.ok(eff);
    assert.strictEqual(eff.card.mode, "activity");
    assert.strictEqual(eff.card.text, "在跑测试");
    assert.strictEqual(eff.speak, undefined);
    assert.strictEqual(eff.petState, undefined);
  });

  it("commentary is throttled: a burst within the window coalesces to nothing", () => {
    let t = 0;
    const n = createNarrator({ now: () => t, speakThrottleMs: 4000 });
    const first = n.observe({ source: "commentary", kind: "milestone", text: "在改文件" });
    assert.ok(first); // first within a fresh window passes
    t = 1000;
    assert.strictEqual(n.observe({ source: "commentary", kind: "milestone", text: "在跑测试" }), null);
    t = 3999;
    assert.strictEqual(n.observe({ source: "commentary", kind: "milestone", text: "在打包" }), null);
    t = 4001;
    const after = n.observe({ source: "commentary", kind: "milestone", text: "搞定" });
    assert.ok(after); // window elapsed -> passes again
  });

  it("reset clears the asleep flag and commentary throttle", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    n.observe({ source: "native", kind: "sleep" });
    n.observe({ source: "commentary", kind: "milestone", text: "在改文件" });
    n.reset();
    // awake again
    const eff = n.observe({ source: "phase", kind: "phase", text: "running" });
    assert.ok(eff && eff.card.mode === "status");
    // throttle cleared -> commentary passes immediately
    const c = n.observe({ source: "commentary", kind: "milestone", text: "在跑测试" });
    assert.ok(c && c.card.mode === "activity");
  });

  it("unknown source returns null (let-it-crash on shape, quiet on unknown source)", () => {
    let t = 0;
    const n = createNarrator({ now: () => t });
    assert.strictEqual(n.observe({ source: "bogus", kind: "x" }), null);
  });

  it("defaults now/throttle when not injected (still constructs)", () => {
    const n = createNarrator();
    assert.strictEqual(typeof n.observe, "function");
    assert.strictEqual(typeof n.reset, "function");
    const eff = n.observe({ source: "phase", kind: "phase", text: "thinking" });
    assert.ok(eff && eff.card.mode === "status");
  });
});
