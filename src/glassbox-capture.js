"use strict";

// Glass-box context capture (demo/kill-boring-loading, Phase 2 remote-control).
//
// Before we dispatch a voice command to a host agent we grab two things about
// what the user is looking at: a screenshot, and the foreground window's
// identity (title / HWND / PID). The window identity lets us match the call back
// to a known agent session (cwd / sessionId) so we can RESUME it instead of
// blindly spawning a fresh run (REMOTE-CONTROL-SPEC §4 decision 1).
//
// Win32 query (PowerShell), screen capture (Electron desktopCapturer) and fs are
// all injected so the arg-building / parsing / matching is unit-testable without
// standing up Electron or touching the real desktop. Let it crash: a missing
// foreground window or a failed screenshot throws — no silent fallback.

const nodePath = require("node:path");

// Marker so we can pick our JSON line out of any PowerShell stdout noise — same
// pattern as focus.js's FOCUS_RESULT_PREFIX.
const FGWIN_PREFIX = "__CLAWD_FGWIN__ ";

// Minimal Add-Type: just the four P/Invokes we need to identify the foreground
// window. Keep this self-contained (focus.js's bigger type lives inside its
// factory closure and isn't importable).
function buildForegroundQueryCmd() {
  return `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ClawdFgWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int maxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public static string Title(IntPtr hWnd) {
        int len = GetWindowTextLength(hWnd);
        var sb = new StringBuilder(len + 1);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }
}
"@
$h = [ClawdFgWin]::GetForegroundWindow()
$procId = [uint32]0
[void][ClawdFgWin]::GetWindowThreadProcessId($h, [ref]$procId)
$payload = [ordered]@{
    hwnd = [string]$h.ToInt64()
    pid = [int]$procId
    title = [ClawdFgWin]::Title($h)
} | ConvertTo-Json -Compress
Write-Output ('${FGWIN_PREFIX}' + $payload)
`;
}

function parseForegroundResult(text) {
  const body = String(text || "");
  const idx = body.indexOf(FGWIN_PREFIX);
  if (idx === -1) return null;
  const after = body.slice(idx + FGWIN_PREFIX.length);
  const line = after.split(/\r?\n/)[0].trim();
  if (!line) return null;
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const hwnd = data.hwnd === null || data.hwnd === undefined ? null : String(data.hwnd);
  const pid = Number(data.pid);
  const title = typeof data.title === "string" ? data.title : "";
  if (!hwnd || !Number.isFinite(pid)) return null;
  return { hwnd, pid, title };
}

function screenshotPath(tmpDir, token, pathApi = nodePath) {
  return pathApi.join(tmpDir, `clawd-shot-${token}.png`);
}

// Sessions can arrive as an array or as an id->session map (state.js snapshots).
function sessionList(sessions) {
  if (Array.isArray(sessions)) return sessions;
  if (sessions && typeof sessions === "object") return Object.values(sessions);
  return [];
}

// Match the foreground window to a known agent session: HWND first (most
// precise — the hook reports wt_hwnd), then PID as a fallback. Returns the raw
// session object or null. No guessing beyond these two keys (spec §6 risk:
// "窗口↔会话匹配失败 → 回退，别瞎猜").
function matchSession(window, sessions) {
  if (!window) return null;
  const list = sessionList(sessions);
  if (!list.length) return null;
  const hwnd = window.hwnd ? String(window.hwnd) : null;
  if (hwnd) {
    const byHwnd = list.find((s) => s && s.wtHwnd && String(s.wtHwnd) === hwnd);
    if (byHwnd) return byHwnd;
  }
  const pid = Number(window.pid);
  if (Number.isFinite(pid) && pid > 0) {
    const byPid = list.find((s) => {
      const sp = Number(s && (s.sourcePid ?? s.agentPid));
      return Number.isFinite(sp) && sp === pid;
    });
    if (byPid) return byPid;
  }
  return null;
}

function defaultRunPs(cmd, timeoutMs) {
  const { execFile } = require("node:child_process");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NoLogo", "-NonInteractive", "-Command", cmd],
      { windowsHide: true, timeout: timeoutMs, encoding: "utf8" },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      }
    );
  });
}

// captureForegroundWindow(opts) -> { hwnd, pid, title }
// opts: { runPsFn, timeoutMs }
async function captureForegroundWindow(opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 3000;
  const runPsFn = opts.runPsFn || ((cmd) => defaultRunPs(cmd, timeoutMs));
  const stdout = await runPsFn(buildForegroundQueryCmd());
  const win = parseForegroundResult(stdout);
  if (!win) {
    throw new Error("glassbox-capture: no foreground window resolved");
  }
  return win;
}

function defaultToken() {
  return require("node:crypto").randomBytes(6).toString("hex");
}

// captureContext(opts) -> { screenshotPath, window }
//   window = { hwnd, pid, title, sessionId, cwd, agentId }
// opts: {
//   tmpDir, token?, sessions,
//   queryForegroundFn?, captureScreenFn (required), writeFileFn?,
//   runPsFn?, timeoutMs, pathApi?
// }
// captureScreenFn(window) -> Promise<Buffer> (PNG bytes). It receives the
// resolved foreground window so the real impl can pick the matching window
// source instead of the whole screen (spec §4 decision 7).
async function captureContext(opts = {}) {
  const pathApi = opts.pathApi || nodePath;
  const tmpDir = opts.tmpDir || require("node:os").tmpdir();
  const token = opts.token || defaultToken();
  const writeFileFn = opts.writeFileFn || ((p, buf) => require("node:fs").writeFileSync(p, buf));
  const captureScreenFn = opts.captureScreenFn;
  if (typeof captureScreenFn !== "function") {
    throw new Error("glassbox-capture: captureScreenFn is required");
  }
  const queryForegroundFn = opts.queryForegroundFn || ((o) => captureForegroundWindow(o));

  const window = await queryForegroundFn(opts);
  const shotPath = screenshotPath(tmpDir, token, pathApi);
  const buf = await captureScreenFn(window);
  writeFileFn(shotPath, buf);

  const session = matchSession(window, opts.sessions);
  return {
    screenshotPath: shotPath,
    window: {
      hwnd: window.hwnd,
      pid: window.pid,
      title: window.title,
      sessionId: (session && (session.sessionId ?? session.id)) || null,
      cwd: (session && session.cwd) || null,
      agentId: (session && session.agentId) || null,
    },
  };
}

module.exports = {
  FGWIN_PREFIX,
  buildForegroundQueryCmd,
  parseForegroundResult,
  screenshotPath,
  matchSession,
  captureForegroundWindow,
  captureContext,
};
