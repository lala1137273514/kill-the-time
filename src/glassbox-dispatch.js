"use strict";

// Glass-box dispatcher (demo/kill-boring-loading, Phase 2).
//
// Sends the orchestrator's refined prompt to a host agent by spawning a fresh,
// independent run — `claude -p "<prompt>"` (or `-r <sid> -p` to resume a known
// idle session), `codex exec "<prompt>"`. Injecting into a RUNNING TUI is not
// supported (spec §2), so we always spawn. Progress comes back through the
// existing hooks (D1/D2), so this is fire-and-forget: we don't parse stdout.
//
// REMOTE-CONTROL-SPEC §4 decision 1: resume the matched session ONLY when it's
// idle; a busy session would have two processes fighting over its state, so we
// start a fresh run instead.
//
// spawn is injected so command/arg/cwd assembly is unit-testable. Let it crash
// on an empty prompt; a spawn failure surfaces on the handle (fire-and-forget),
// not as a synchronous throw.

const AGENT_BY_ID = {
  "claude-code": "claude",
  claude: "claude",
  codex: "codex",
};

function resolveAgent(agentId) {
  return AGENT_BY_ID[agentId] || "claude";
}

function commandFor(agent, opts = {}) {
  if (agent === "codex") return opts.codexBin || "codex";
  return opts.claudeBin || "claude";
}

// Append `@<screenshotPath>` so the agent reads the image — unless it's already
// referenced or there's no screenshot.
function appendScreenshot(prompt, screenshotPath) {
  const base = String(prompt || "");
  const shot = screenshotPath ? String(screenshotPath) : "";
  if (!shot) return base;
  if (base.includes(`@${shot}`)) return base;
  return `${base} @${shot}`.trim();
}

// planDispatch({ window, decision, screenshotPath, defaultCwd, sessionIdle })
//   -> { agent, mode: "resume"|"new", sessionId, cwd, prompt }
// Only claude supports resume here; codex always runs a fresh exec.
function planDispatch({ window = {}, decision = {}, screenshotPath = "", defaultCwd = null, sessionIdle = false } = {}) {
  const agent = resolveAgent(window.agentId);
  const canResume = agent === "claude" && !!window.sessionId && sessionIdle === true;
  const mode = canResume ? "resume" : "new";
  const sessionId = canResume ? window.sessionId : null;
  const cwd = window.cwd || defaultCwd || null;
  const prompt = appendScreenshot(decision.refinedPrompt, screenshotPath);
  return { agent, mode, sessionId, cwd, prompt };
}

// The prompt is fed over stdin (see dispatch), NOT as a CLI arg — long/CJK
// prompts with quotes would otherwise be mangled. So args carry only safe,
// short flags. The dispatched run is headless and the user already confirmed
// it, so claude runs with permissions bypassed; otherwise its first tool use
// hangs forever on a permission prompt nobody can answer. Overridable via
// CLAWD_DISPATCH_PERMISSION_MODE (e.g. acceptEdits, default, plan).
function dispatchPermissionMode(override) {
  const o = typeof override === "string" ? override.trim() : "";
  return o || process.env.CLAWD_DISPATCH_PERMISSION_MODE || "bypassPermissions";
}

function buildArgs(plan = {}) {
  if (plan.agent === "codex") {
    return ["exec"];
  }
  const perm = ["--permission-mode", dispatchPermissionMode(plan.permissionMode)];
  if (plan.mode === "resume" && plan.sessionId) {
    return ["-r", plan.sessionId, "-p", ...perm];
  }
  return ["-p", ...perm];
}

function defaultSpawn(cmd, args, spawnOpts) {
  return require("node:child_process").spawn(cmd, args, spawnOpts);
}

// dispatch(plan, opts) -> handle { command, args, cwd, mode, sessionId, agent, child, onError }
// opts: { spawnFn, claudeBin, codexBin, env }
function dispatch(plan = {}, opts = {}) {
  const prompt = String(plan.prompt || "").trim();
  if (!prompt) {
    throw new Error("glassbox-dispatch: empty prompt — refusing blind dispatch");
  }
  const command = commandFor(plan.agent, opts);
  const args = buildArgs(plan);
  const spawnFn = opts.spawnFn || defaultSpawn;
  // Capture stdout only when a completion callback wants it (for the spoken
  // result summary). Otherwise stay fully detached.
  const wantOutput = typeof opts.onComplete === "function";
  const spawnOpts = {
    cwd: plan.cwd || undefined,
    // NO shell: claude ships as a real claude.exe, which libuv resolves on PATH
    // and which accepts the prompt over stdin. shell:true would route through
    // cmd.exe, which both mangles long/CJK prompt args AND fails to forward
    // stdin — so headless runs hung. (A .cmd-shim agent like an npm-installed
    // codex can't be spawned without a shell on modern Node and will surface via
    // onError; the user's path is claude.exe.)
    shell: false,
    windowsHide: true,
    detached: false,
    // stdin is always piped so we can feed the prompt over it (avoids shell
    // arg-escaping). stdout/stderr piped only when a completion callback wants it.
    stdio: ["pipe", wantOutput ? "pipe" : "ignore", wantOutput ? "pipe" : "ignore"],
    env: opts.env || process.env,
  };
  const child = spawnFn(command, args, spawnOpts);
  // Fire-and-forget: keep an unhandled 'error' from crashing the app. Callers
  // can observe via handle.onError(); progress otherwise arrives through hooks.
  const swallow = () => {};
  if (child && typeof child.on === "function") child.on("error", swallow);

  // Feed the prompt over stdin, then close it so the agent starts.
  try {
    if (child && child.stdin && typeof child.stdin.write === "function") {
      child.stdin.on && child.stdin.on("error", swallow); // ignore EPIPE
      child.stdin.write(prompt);
      child.stdin.end();
    }
  } catch {}

  if (wantOutput) {
    let output = "";
    if (child && child.stdout && typeof child.stdout.on === "function") {
      child.stdout.on("data", (d) => { output += String(d); });
    }
    if (child && child.stderr && typeof child.stderr.on === "function") {
      child.stderr.on("data", () => {}); // drain so the pipe never stalls
    }
    if (child && typeof child.on === "function") {
      child.on("close", (code) => {
        try { opts.onComplete({ code, output: output.trim() }); } catch {}
      });
    }
  }
  if (child && typeof child.unref === "function") child.unref();

  return {
    command,
    args,
    cwd: plan.cwd || null,
    mode: plan.mode,
    sessionId: plan.sessionId || null,
    agent: plan.agent,
    child,
    onError(cb) {
      if (child && typeof child.on === "function") child.on("error", cb);
    },
  };
}

module.exports = {
  resolveAgent,
  commandFor,
  appendScreenshot,
  planDispatch,
  buildArgs,
  dispatch,
};
