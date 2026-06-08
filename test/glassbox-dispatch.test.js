"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");

const {
  appendScreenshot,
  planDispatch,
  buildArgs,
  commandFor,
  dispatch,
} = require("../src/glassbox-dispatch");

function fakeChild() {
  const child = new EventEmitter();
  child.unref = () => {};
  const writes = [];
  child.stdin = { write: (d) => writes.push(String(d)), end: () => { child.stdin._ended = true; }, _writes: writes };
  return child;
}

function fakeChildWithIo() {
  const child = fakeChild();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("glassbox-dispatch helpers", () => {
  it("appendScreenshot adds an @ reference once", () => {
    assert.strictEqual(appendScreenshot("整理要点", "C:/t/shot.png"), "整理要点 @C:/t/shot.png");
    assert.strictEqual(appendScreenshot("整理要点", ""), "整理要点");
    assert.strictEqual(appendScreenshot("整理要点", null), "整理要点");
    assert.strictEqual(
      appendScreenshot("看 @C:/t/shot.png 这个", "C:/t/shot.png"),
      "看 @C:/t/shot.png 这个"
    );
  });

  it("commandFor maps agent to a binary, with overrides", () => {
    assert.strictEqual(commandFor("claude"), "claude");
    assert.strictEqual(commandFor("codex"), "codex");
    assert.strictEqual(commandFor("claude", { claudeBin: "C:/claude.cmd" }), "C:/claude.cmd");
    assert.strictEqual(commandFor("codex", { codexBin: "C:/codex.cmd" }), "C:/codex.cmd");
  });

  // Claude prompt goes over stdin (see dispatch), so it is NOT a CLI arg — this
  // dodges Windows shell arg-escaping for long/CJK prompts. Permission defaults
  // to the agent's native/default flow; the pet supervises, it does not YOLO.
  it("buildArgs builds a fresh claude run (prompt via stdin, native permissions)", () => {
    assert.deepStrictEqual(
      buildArgs({ agent: "claude", mode: "new", prompt: "做这个" }),
      ["-p", "--permission-mode", "default"]
    );
  });

  it("buildArgs resumes a known claude session", () => {
    assert.deepStrictEqual(
      buildArgs({ agent: "claude", mode: "resume", sessionId: "sid-1", prompt: "继续" }),
      ["-r", "sid-1", "-p", "--permission-mode", "default"]
    );
  });

  it("buildArgs permission mode is overridable via CLAWD_DISPATCH_PERMISSION_MODE", () => {
    const saved = process.env.CLAWD_DISPATCH_PERMISSION_MODE;
    process.env.CLAWD_DISPATCH_PERMISSION_MODE = "acceptEdits";
    try {
      assert.deepStrictEqual(
        buildArgs({ agent: "claude", mode: "new", prompt: "x" }),
        ["-p", "--permission-mode", "acceptEdits"]
      );
    } finally {
      if (saved === undefined) delete process.env.CLAWD_DISPATCH_PERMISSION_MODE;
      else process.env.CLAWD_DISPATCH_PERMISSION_MODE = saved;
    }
  });

  it("buildArgs builds a codex exec run with the prompt as an explicit argument", () => {
    assert.deepStrictEqual(
      buildArgs({ agent: "codex", mode: "new", prompt: "do it" }),
      ["exec", "do it"]
    );
  });
});

describe("glassbox-dispatch planDispatch", () => {
  it("resumes a matched claude session only when it is idle", () => {
    const plan = planDispatch({
      window: { agentId: "claude-code", sessionId: "s1", cwd: "/work" },
      decision: { refinedPrompt: "整理一下" },
      screenshotPath: "/t/shot.png",
      sessionIdle: true,
    });
    assert.strictEqual(plan.agent, "claude");
    assert.strictEqual(plan.mode, "resume");
    assert.strictEqual(plan.sessionId, "s1");
    assert.strictEqual(plan.cwd, "/work");
    assert.strictEqual(plan.prompt, "整理一下 @/t/shot.png");
  });

  it("starts a fresh run when the matched session is busy (not idle)", () => {
    const plan = planDispatch({
      window: { agentId: "claude-code", sessionId: "s1", cwd: "/work" },
      decision: { refinedPrompt: "整理一下" },
      sessionIdle: false,
    });
    assert.strictEqual(plan.mode, "new");
    assert.strictEqual(plan.sessionId, null);
    assert.strictEqual(plan.cwd, "/work");
  });

  it("starts a fresh run when no session matched, using defaultCwd", () => {
    const plan = planDispatch({
      window: { agentId: "claude-code", sessionId: null, cwd: null },
      decision: { refinedPrompt: "做事" },
      defaultCwd: "/home/me",
    });
    assert.strictEqual(plan.mode, "new");
    assert.strictEqual(plan.cwd, "/home/me");
  });

  it("leaves cwd null when nothing provides one (caller must ask)", () => {
    const plan = planDispatch({
      window: { agentId: "claude-code", sessionId: null, cwd: null },
      decision: { refinedPrompt: "做事" },
    });
    assert.strictEqual(plan.cwd, null);
  });

  it("routes a codex window to the codex agent", () => {
    const plan = planDispatch({
      window: { agentId: "codex", sessionId: "x", cwd: "/c" },
      decision: { refinedPrompt: "p" },
      sessionIdle: true,
    });
    assert.strictEqual(plan.agent, "codex");
    // codex resume isn't wired; treat as a fresh exec
    assert.strictEqual(plan.mode, "new");
  });

  it("defaults to claude when the agent is unknown", () => {
    const plan = planDispatch({
      window: { agentId: null, sessionId: null, cwd: "/c" },
      decision: { refinedPrompt: "p" },
    });
    assert.strictEqual(plan.agent, "claude");
  });

  it("uses the injected default agent when no session matched", () => {
    const plan = planDispatch({
      window: { agentId: null, sessionId: null, cwd: "/c" },
      decision: { refinedPrompt: "p" },
      defaultAgent: "codex",
    });
    assert.strictEqual(plan.agent, "codex");
  });
});

describe("glassbox-dispatch dispatch", () => {
  it("spawns a fresh claude run in the target cwd and writes the prompt to stdin", () => {
    let spawned = null;
    const child = fakeChild();
    const handle = dispatch(
      { agent: "claude", mode: "new", cwd: "/work", prompt: "做这个" },
      { spawnFn: (cmd, args, optsObj) => { spawned = { cmd, args, optsObj }; return child; } }
    );
    assert.strictEqual(spawned.cmd, "claude");
    assert.deepStrictEqual(spawned.args, ["-p", "--permission-mode", "default"]);
    assert.strictEqual(spawned.optsObj.cwd, "/work");
    assert.strictEqual(child.stdin._writes.join(""), "做这个");
    assert.strictEqual(child.stdin._ended, true);
    assert.strictEqual(handle.command, "claude");
    assert.strictEqual(handle.mode, "new");
  });

  it("spawns a resume run with the session id, prompt over stdin", () => {
    let spawned = null;
    const child = fakeChild();
    dispatch(
      { agent: "claude", mode: "resume", sessionId: "sid-9", cwd: "/w", prompt: "继续" },
      { spawnFn: (cmd, args) => { spawned = { cmd, args }; return child; } }
    );
    assert.deepStrictEqual(spawned.args, ["-r", "sid-9", "-p", "--permission-mode", "default"]);
    assert.strictEqual(child.stdin._writes.join(""), "继续");
  });

  it("spawns codex exec with the prompt argument and no stdin dependency", () => {
    let spawned = null;
    const child = fakeChild();
    child.stdin = null;
    dispatch(
      { agent: "codex", mode: "new", cwd: "/work", prompt: "做这个" },
      { spawnFn: (cmd, args, optsObj) => { spawned = { cmd, args, optsObj }; return child; } }
    );
    assert.strictEqual(spawned.cmd, "codex");
    assert.deepStrictEqual(spawned.args, ["exec", "做这个"]);
    assert.strictEqual(spawned.optsObj.stdio[0], "ignore");
  });

  it("throws when the prompt is empty (no blind dispatch)", () => {
    assert.throws(
      () => dispatch({ agent: "claude", mode: "new", cwd: "/w", prompt: "  " }, { spawnFn: () => fakeChild() }),
      /empty prompt/
    );
  });

  it("captures stdout and fires onComplete on close when a callback is given", () => {
    const child = fakeChildWithIo();
    let result = null;
    dispatch(
      { agent: "claude", mode: "new", cwd: "/w", prompt: "整理" },
      { spawnFn: () => child, onComplete: (r) => { result = r; } }
    );
    child.stdout.emit("data", "整理完成：要点A、");
    child.stdout.emit("data", "要点B");
    child.emit("close", 0);
    assert.strictEqual(result.code, 0);
    assert.match(result.output, /要点A、要点B/);
  });

  it("does not require stdout plumbing when no onComplete is given", () => {
    const child = fakeChild(); // no stdout/stderr
    assert.doesNotThrow(() => dispatch(
      { agent: "claude", mode: "new", cwd: "/w", prompt: "x" },
      { spawnFn: () => child }
    ));
    child.emit("close", 0); // must not blow up
  });

  it("surfaces a spawn error via the child error event without throwing synchronously", () => {
    const child = fakeChild();
    const handle = dispatch(
      { agent: "claude", mode: "new", cwd: "/w", prompt: "x" },
      { spawnFn: () => child }
    );
    // fire-and-forget: error is swallowed onto the handle, not thrown
    let seen = null;
    handle.onError((err) => { seen = err; });
    child.emit("error", new Error("ENOENT claude"));
    assert.match(seen.message, /ENOENT claude/);
  });
});
