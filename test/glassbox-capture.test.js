"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildForegroundQueryCmd,
  parseForegroundResult,
  screenshotPath,
  matchSession,
  captureForegroundWindow,
  captureContext,
  FGWIN_PREFIX,
} = require("../src/glassbox-capture");

describe("glassbox-capture helpers", () => {
  it("buildForegroundQueryCmd emits a win32 query that prints the marker", () => {
    const cmd = buildForegroundQueryCmd();
    assert.ok(cmd.includes("GetForegroundWindow"));
    assert.ok(cmd.includes("GetWindowThreadProcessId"));
    assert.ok(cmd.includes("GetWindowText"));
    assert.ok(cmd.includes(FGWIN_PREFIX));
  });

  it("parseForegroundResult pulls the marked JSON line", () => {
    const text = `noise\n${FGWIN_PREFIX}{"hwnd":"12345","pid":6789,"title":"成都5天 — Claude Code"}\ntail`;
    const win = parseForegroundResult(text);
    assert.deepStrictEqual(win, { hwnd: "12345", pid: 6789, title: "成都5天 — Claude Code" });
  });

  it("parseForegroundResult normalizes hwnd to string and pid to number", () => {
    const text = `${FGWIN_PREFIX}{"hwnd":99,"pid":"42","title":"x"}`;
    const win = parseForegroundResult(text);
    assert.strictEqual(win.hwnd, "99");
    assert.strictEqual(win.pid, 42);
  });

  it("parseForegroundResult returns null without the marker", () => {
    assert.strictEqual(parseForegroundResult("just some text"), null);
    assert.strictEqual(parseForegroundResult(""), null);
    assert.strictEqual(parseForegroundResult(`${FGWIN_PREFIX}not-json`), null);
  });

  it("screenshotPath joins tmpDir with a png name", () => {
    const p = screenshotPath("/tmp", "abc123").replace(/\\/g, "/");
    assert.strictEqual(p, "/tmp/clawd-shot-abc123.png");
  });

  it("matchSession matches by hwnd first", () => {
    const sessions = [
      { sessionId: "s1", cwd: "/a", agentId: "claude-code", wtHwnd: "111", agentPid: 10 },
      { sessionId: "s2", cwd: "/b", agentId: "codex", wtHwnd: "222", agentPid: 20 },
    ];
    const m = matchSession({ hwnd: "222", pid: 999 }, sessions);
    assert.strictEqual(m.sessionId, "s2");
  });

  it("matchSession falls back to pid when hwnd misses", () => {
    const sessions = [
      { sessionId: "s1", cwd: "/a", wtHwnd: "111", agentPid: 10 },
      { sessionId: "s2", cwd: "/b", wtHwnd: "222", sourcePid: 20 },
    ];
    const m = matchSession({ hwnd: "999", pid: 20 }, sessions);
    assert.strictEqual(m.sessionId, "s2");
  });

  it("matchSession returns null on no match or bad input", () => {
    assert.strictEqual(matchSession({ hwnd: "5", pid: 5 }, []), null);
    assert.strictEqual(matchSession(null, [{ wtHwnd: "1" }]), null);
    assert.strictEqual(matchSession({ hwnd: "5", pid: 5 }, null), null);
  });

  it("matchSession accepts a sessions map (id -> session)", () => {
    const sessions = {
      s1: { cwd: "/a", wtHwnd: "111" },
      s2: { cwd: "/b", wtHwnd: "222" },
    };
    const m = matchSession({ hwnd: "111", pid: 0 }, sessions);
    assert.strictEqual(m.cwd, "/a");
  });
});

describe("glassbox-capture captureForegroundWindow", () => {
  it("runs the PS query and returns the parsed window", async () => {
    let ranCmd = null;
    const win = await captureForegroundWindow({
      runPsFn: async (cmd) => {
        ranCmd = cmd;
        return `${FGWIN_PREFIX}{"hwnd":"7","pid":8,"title":"T"}`;
      },
    });
    assert.deepStrictEqual(win, { hwnd: "7", pid: 8, title: "T" });
    assert.ok(ranCmd.includes("GetForegroundWindow"));
  });

  it("throws when the query yields no usable window", async () => {
    await assert.rejects(
      captureForegroundWindow({ runPsFn: async () => "garbage" }),
      /no foreground window/
    );
  });
});

describe("glassbox-capture captureContext", () => {
  it("captures the window, writes the screenshot, and merges the matched session", async () => {
    const writes = [];
    let captureArg = null;
    const out = await captureContext({
      tmpDir: "/tmp",
      token: "tok",
      sessions: [{ sessionId: "s9", cwd: "/work", agentId: "claude-code", wtHwnd: "7" }],
      queryForegroundFn: async () => ({ hwnd: "7", pid: 8, title: "T" }),
      captureScreenFn: async (win) => { captureArg = win; return Buffer.from("PNGDATA"); },
      writeFileFn: (p, buf) => writes.push({ p: p.replace(/\\/g, "/"), buf }),
    });

    assert.strictEqual(out.screenshotPath.replace(/\\/g, "/"), "/tmp/clawd-shot-tok.png");
    assert.strictEqual(out.window.sessionId, "s9");
    assert.strictEqual(out.window.cwd, "/work");
    assert.strictEqual(out.window.title, "T");
    assert.strictEqual(captureArg.hwnd, "7");
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].p, "/tmp/clawd-shot-tok.png");
    assert.strictEqual(writes[0].buf.toString(), "PNGDATA");
  });

  it("returns a null session when nothing matches but still screenshots", async () => {
    const out = await captureContext({
      tmpDir: "/tmp",
      token: "t2",
      sessions: [],
      queryForegroundFn: async () => ({ hwnd: "1", pid: 2, title: "Stranger" }),
      captureScreenFn: async () => Buffer.from("X"),
      writeFileFn: () => {},
    });
    assert.strictEqual(out.window.sessionId, null);
    assert.strictEqual(out.window.cwd, null);
    assert.strictEqual(out.window.title, "Stranger");
    assert.ok(out.screenshotPath.endsWith("clawd-shot-t2.png"));
  });

  it("lets a screenshot failure crash (no silent fallback)", async () => {
    await assert.rejects(
      captureContext({
        tmpDir: "/tmp",
        token: "t3",
        sessions: [],
        queryForegroundFn: async () => ({ hwnd: "1", pid: 2, title: "T" }),
        captureScreenFn: async () => { throw new Error("desktopCapturer boom"); },
        writeFileFn: () => {},
      }),
      /desktopCapturer boom/
    );
  });
});
