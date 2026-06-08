"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createCommentary } = require("../src/glassbox-commentary");

describe("glassbox-commentary", () => {
  it("constructs with defaults (injected now optional)", () => {
    const c = createCommentary();
    assert.strictEqual(typeof c.observe, "function");
    assert.strictEqual(typeof c.finish, "function");
    assert.strictEqual(typeof c.reset, "function");
  });

  it("returns null for a line with no milestone", () => {
    let t = 0;
    const c = createCommentary({ now: () => t });
    assert.strictEqual(c.observe("just some chatter about the plan"), null);
    assert.strictEqual(c.observe(""), null);
    assert.strictEqual(c.observe(null), null);
  });

  it("detects dependency installation (npm/pnpm/pip/yarn)", () => {
    let t = 0;
    let c = createCommentary({ now: () => t });
    let ev = c.observe("npm install express");
    assert.ok(ev && typeof ev.say === "string" && ev.say.length > 0);

    t = 0; c = createCommentary({ now: () => t });
    assert.ok(c.observe("running `pnpm install`"));

    t = 0; c = createCommentary({ now: () => t });
    assert.ok(c.observe("pip install -r requirements.txt"));

    t = 0; c = createCommentary({ now: () => t });
    assert.ok(c.observe("yarn add react"));
  });

  it("detects file edits/creates", () => {
    let t = 0;
    const c = createCommentary({ now: () => t });
    const ev = c.observe("Editing src/foo.js");
    assert.ok(ev && ev.say.length > 0);
  });

  it("detects running tests / build", () => {
    let t = 0;
    let c = createCommentary({ now: () => t });
    assert.ok(c.observe("npm test"));

    t = 0; c = createCommentary({ now: () => t });
    assert.ok(c.observe("running build..."));
  });

  it("detects an error / exception line", () => {
    let t = 0;
    const c = createCommentary({ now: () => t });
    const ev = c.observe("Error: cannot find module 'x'");
    assert.ok(ev && ev.say.length > 0);
  });

  it("detects a completion / done marker", () => {
    let t = 0;
    const c = createCommentary({ now: () => t });
    const ev = c.observe("All tasks completed successfully");
    assert.ok(ev && ev.say.length > 0);
  });

  it("throttles to at most one say per throttleMs window", () => {
    let t = 0;
    const c = createCommentary({ now: () => t, throttleMs: 4000 });
    assert.ok(c.observe("npm install"));      // t=0 emits
    t = 1000;
    assert.strictEqual(c.observe("Editing a.js"), null); // within window -> swallowed
    t = 3999;
    assert.strictEqual(c.observe("running tests"), null); // still within window
    t = 4001;
    assert.ok(c.observe("Error: boom"));       // window elapsed -> emits again
  });

  it("coalesces a burst of the same milestone category (no repeat within window)", () => {
    let t = 0;
    const c = createCommentary({ now: () => t, throttleMs: 4000 });
    assert.ok(c.observe("Editing a.js"));
    t = 1;
    assert.strictEqual(c.observe("Editing b.js"), null);
    t = 2;
    assert.strictEqual(c.observe("Editing c.js"), null);
  });

  it("privacy: NEVER echoes raw code / file contents / secrets verbatim in say", () => {
    let t = 0;
    const c = createCommentary({ now: () => t });
    const secretLine = 'Editing config.js: const API_KEY = "sk-supersecret-1234567890"';
    const ev = c.observe(secretLine);
    assert.ok(ev);
    assert.ok(!ev.say.includes("sk-supersecret-1234567890"), "must not echo the secret");
    assert.ok(!ev.say.includes("API_KEY"), "must not echo identifiers");
    assert.ok(!ev.say.includes("config.js"), "must not echo the raw path");
    assert.ok(!ev.say.includes("="), "must not echo raw code");
  });

  it("privacy: does not echo a full file path verbatim", () => {
    let t = 0;
    const c = createCommentary({ now: () => t });
    const ev = c.observe("Creating C:\\Users\\me\\repos\\secret-project\\src\\auth\\token.js");
    assert.ok(ev);
    assert.ok(!ev.say.includes("token.js"), "must not echo the filename");
    assert.ok(!ev.say.includes("secret-project"), "must not echo path segments");
    assert.ok(!ev.say.includes("\\"), "must not echo a raw path");
    assert.ok(!ev.say.includes("/"), "must not echo a raw path");
  });

  it("finish(code 0) returns a success say", () => {
    const c = createCommentary({ now: () => 0 });
    const ev = c.finish({ code: 0 });
    assert.ok(ev && typeof ev.say === "string" && ev.say.length > 0);
  });

  it("finish(non-zero code) returns a failure say", () => {
    const c = createCommentary({ now: () => 0 });
    const ev = c.finish({ code: 1 });
    assert.ok(ev && typeof ev.say === "string" && ev.say.length > 0);
  });

  it("finish success and failure differ", () => {
    const c1 = createCommentary({ now: () => 0 });
    const c2 = createCommentary({ now: () => 0 });
    assert.notStrictEqual(c1.finish({ code: 0 }).say, c2.finish({ code: 1 }).say);
  });

  it("finish is NOT throttled (always speaks the verdict)", () => {
    let t = 0;
    const c = createCommentary({ now: () => t, throttleMs: 4000 });
    assert.ok(c.observe("npm install")); // t=0 consumes the throttle window
    t = 1;
    const ev = c.finish({ code: 0 }); // immediately after, still must speak
    assert.ok(ev && ev.say.length > 0);
  });

  it("reset clears throttle + run state for a new run", () => {
    let t = 0;
    const c = createCommentary({ now: () => t, throttleMs: 4000 });
    assert.ok(c.observe("npm install")); // t=0 emits, window now active
    t = 100;
    assert.strictEqual(c.observe("Editing a.js"), null); // throttled
    c.reset();
    // after reset the throttle clock is clear -> a milestone emits immediately
    assert.ok(c.observe("running tests"));
  });
});
