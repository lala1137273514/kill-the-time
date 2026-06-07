"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { PROMPTS_DIR, loadPrompt } = require("../src/glassbox-prompts");

describe("glassbox-prompts loadPrompt", () => {
  it("reads <name>.md from the given dir and trims the trailing newline", () => {
    const calls = [];
    const fakeFs = {
      readFileSync: (p, enc) => {
        calls.push([p, enc]);
        return "hello world\n\n";
      },
    };
    const out = loadPrompt("foo", { fs: fakeFs, dir: "/d" });
    assert.strictEqual(out, "hello world");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], path.join("/d", "foo.md"));
    assert.strictEqual(calls[0][1], "utf8");
  });

  it("defaults the dir to PROMPTS_DIR", () => {
    let readPath = null;
    const fakeFs = { readFileSync: (p) => { readPath = p; return "x"; } };
    loadPrompt("bar", { fs: fakeFs });
    assert.strictEqual(readPath, path.join(PROMPTS_DIR, "bar.md"));
  });

  it("propagates read errors (let it crash, no fallback)", () => {
    const fakeFs = { readFileSync: () => { throw new Error("ENOENT boom"); } };
    assert.throws(() => loadPrompt("missing", { fs: fakeFs }), /ENOENT boom/);
  });

  it("loads the real orchestrator-system prompt with the decision fields", () => {
    const sys = loadPrompt("orchestrator-system");
    assert.ok(sys.length > 0);
    assert.ok(/json/i.test(sys));
    assert.ok(sys.includes("dispatch"));
    assert.ok(sys.includes("chat"));
    assert.ok(sys.includes("refinedPrompt"));
    assert.ok(sys.includes("risk"));
    assert.ok(sys.includes("needCapture"));
  });
});
