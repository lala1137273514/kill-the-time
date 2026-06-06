"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { GlassboxRemote, summarizeForSpeech } = require("../src/glassbox-remote");

// Build a remote with sensible spies; override per test.
function makeRemote(over = {}) {
  const calls = {
    screenshots: 0,
    dispatched: [],
    spoken: [],
    permissions: [],
    answers: [],
    confirms: 0,
    onComplete: null,
  };
  const deps = {
    orchestrate: over.orchestrate || (async () => ({ action: "chat", reply: "在的" })),
    getForegroundWindow: over.getForegroundWindow ||
      (async () => ({ hwnd: "1", pid: 2, title: "T", sessionId: null, cwd: "/work", agentId: "claude-code" })),
    takeScreenshot: over.takeScreenshot || (async () => { calls.screenshots++; return "/t/shot.png"; }),
    dispatchFn: over.dispatchFn || ((plan, o) => { calls.dispatched.push(plan); calls.onComplete = o && o.onComplete; return { command: "claude" }; }),
    getSessionIdle: over.getSessionIdle || (() => false),
    resolvePermission: over.resolvePermission || ((b) => calls.permissions.push(b)),
    onAnswer: over.onAnswer || ((r) => calls.answers.push(r)),
    speak: over.speak || ((t) => calls.spoken.push(t)),
    confirmDispatch: over.confirmDispatch || (async () => { calls.confirms++; return true; }),
    getPending: over.getPending || (() => ({})),
    defaultCwd: "defaultCwd" in over ? over.defaultCwd : "/home/me",
    log: () => {},
  };
  return { remote: new GlassboxRemote(deps), calls };
}

describe("glassbox-remote summarizeForSpeech", () => {
  it("returns short text unchanged", () => {
    assert.strictEqual(summarizeForSpeech("要点A、要点B"), "要点A、要点B");
  });
  it("collapses whitespace and newlines", () => {
    assert.strictEqual(summarizeForSpeech("  整理\n\n 完成  "), "整理 完成");
  });
  it("truncates long text with an ellipsis", () => {
    const s = summarizeForSpeech("一".repeat(80), 50);
    assert.ok(s.length <= 51);
    assert.ok(s.endsWith("…"));
  });
  it("returns empty for blank input", () => {
    assert.strictEqual(summarizeForSpeech("   \n "), "");
    assert.strictEqual(summarizeForSpeech(null), "");
  });
});

describe("GlassboxRemote", () => {
  it("recaps then confirms before dispatching, screenshots, and speaks the receipt", async () => {
    const { remote, calls } = makeRemote({
      orchestrate: async () => ({ action: "dispatch", refinedPrompt: "整理要点", needCapture: true, risk: "read", reply: "好的，已让 Claude 处理" }),
    });
    await remote.handle("帮我整理当前窗口");
    assert.strictEqual(calls.screenshots, 1);
    assert.strictEqual(calls.confirms, 1); // every dispatch is confirmed now
    assert.strictEqual(calls.dispatched.length, 1);
    assert.strictEqual(calls.dispatched[0].prompt, "整理要点 @/t/shot.png");
    // recap spoken before the receipt
    assert.ok(calls.spoken.some((t) => t.includes("整理要点") && /对吗/.test(t)));
    assert.ok(calls.spoken.includes("好的，已让 Claude 处理"));
  });

  it("does not screenshot when needCapture is false", async () => {
    const { remote, calls } = makeRemote({
      orchestrate: async () => ({ action: "dispatch", refinedPrompt: "跑测试", needCapture: false, risk: "read", reply: "好" }),
    });
    await remote.handle("跑一下测试");
    assert.strictEqual(calls.screenshots, 0);
    assert.strictEqual(calls.dispatched[0].prompt, "跑测试");
  });

  it("aborts when confirmation is declined", async () => {
    const spoken = [];
    const { remote, calls } = makeRemote({
      orchestrate: async () => ({ action: "dispatch", refinedPrompt: "删文件", needCapture: false, risk: "write", reply: "好的" }),
      confirmDispatch: async () => false,
      speak: (t) => spoken.push(t),
    });
    await remote.handle("删掉这个文件");
    assert.strictEqual(calls.dispatched.length, 0);
    assert.ok(spoken.some((t) => /取消/.test(t)));
  });

  it("speaks a result summary when the dispatched run completes", async () => {
    const { remote, calls } = makeRemote({
      orchestrate: async () => ({ action: "dispatch", refinedPrompt: "整理", needCapture: false, risk: "read", reply: "好的" }),
    });
    await remote.handle("整理一下");
    assert.strictEqual(typeof calls.onComplete, "function");
    calls.onComplete({ code: 0, output: "前面一些过程日志\n整理完成：共 5 个要点已写入 notes.md" });
    assert.ok(calls.spoken.some((t) => /整理完成|要点/.test(t)));
  });

  it("resumes an idle matched claude session", async () => {
    const { remote, calls } = makeRemote({
      getForegroundWindow: async () => ({ title: "Claude Code", sessionId: "s7", cwd: "/work", agentId: "claude-code" }),
      getSessionIdle: (sid) => sid === "s7",
      orchestrate: async () => ({ action: "dispatch", refinedPrompt: "继续", needCapture: false, risk: "read", reply: "好" }),
    });
    await remote.handle("继续上面那个");
    assert.strictEqual(calls.dispatched[0].mode, "resume");
    assert.strictEqual(calls.dispatched[0].sessionId, "s7");
  });

  it("asks for a directory instead of guessing — and never reaches confirm", async () => {
    const spoken = [];
    const { remote, calls } = makeRemote({
      getForegroundWindow: async () => ({ title: "Notepad", sessionId: null, cwd: null, agentId: null }),
      defaultCwd: null,
      orchestrate: async () => ({ action: "dispatch", refinedPrompt: "做事", needCapture: false, risk: "read", reply: "好" }),
      speak: (t) => spoken.push(t),
    });
    await remote.handle("帮我做个东西");
    assert.strictEqual(calls.dispatched.length, 0);
    assert.strictEqual(calls.confirms, 0);
    assert.ok(spoken.some((t) => /目录|哪/.test(t)));
  });

  it("speaks a chat reply without dispatching", async () => {
    const { remote, calls } = makeRemote({
      orchestrate: async () => ({ action: "chat", reply: "它还在跑，再等等" }),
    });
    await remote.handle("好了吗");
    assert.strictEqual(calls.dispatched.length, 0);
    assert.deepStrictEqual(calls.spoken, ["它还在跑，再等等"]);
  });

  it("resolves approve/deny through the permission channel", async () => {
    const a = makeRemote({ orchestrate: async () => ({ action: "approve" }) });
    await a.remote.handle("批准");
    assert.deepStrictEqual(a.calls.permissions, ["allow"]);
    assert.strictEqual(a.calls.dispatched.length, 0);

    const d = makeRemote({ orchestrate: async () => ({ action: "deny" }) });
    await d.remote.handle("不批准");
    assert.deepStrictEqual(d.calls.permissions, ["deny"]);
  });

  it("hands an answer to onAnswer (can't inject a running TUI)", async () => {
    const { remote, calls } = makeRemote({
      orchestrate: async () => ({ action: "answer", text: "用第二个" }),
    });
    await remote.handle("用第二个");
    assert.strictEqual(calls.answers.length, 1);
    assert.strictEqual(calls.dispatched.length, 0);
  });

  it("passes pending flags and window context into the orchestrator", async () => {
    let seenCtx = null;
    const { remote } = makeRemote({
      getPending: () => ({ permissionPending: true }),
      getForegroundWindow: async () => ({ title: "X", sessionId: "s1", cwd: "/w", agentId: "claude-code" }),
      orchestrate: async (text, ctx) => { seenCtx = ctx; return { action: "approve" }; },
    });
    await remote.handle("批准");
    assert.strictEqual(seenCtx.permissionPending, true);
    assert.strictEqual(seenCtx.window.sessionId, "s1");
  });

  it("survives a foreground-query failure and still handles permission words", async () => {
    const { remote, calls } = makeRemote({
      getForegroundWindow: async () => { throw new Error("PS boom"); },
      orchestrate: async () => ({ action: "deny" }),
    });
    await remote.handle("拒绝");
    assert.deepStrictEqual(calls.permissions, ["deny"]);
  });

  it("does nothing on an empty/none decision", async () => {
    const { remote, calls } = makeRemote({
      orchestrate: async () => ({ action: "none", text: "" }),
    });
    await remote.handle("   ");
    assert.strictEqual(calls.dispatched.length, 0);
    assert.strictEqual(calls.spoken.length, 0);
  });
});
