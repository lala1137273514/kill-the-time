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

function buildArgs(plan = {}) {
  const prompt = plan.prompt;
  if (plan.agent === "codex") {
    return ["exec", prompt];
  }
  if (plan.mode === "resume" && plan.sessionId) {
    return ["-r", plan.sessionId, "-p", prompt];
  }
  return ["-p", prompt];
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
  const spawnOpts = {
    cwd: plan.cwd || undefined,
    // claude/codex on Windows are .cmd shims; PATH resolution needs a shell.
    shell: process.platform === "win32",
    windowsHide: true,
    detached: false,
    stdio: "ignore",
    env: opts.env || process.env,
  };
  const child = spawnFn(command, args, spawnOpts);
  // Fire-and-forget: keep an unhandled 'error' from crashing the app. Callers
  // can observe via handle.onError(); progress otherwise arrives through hooks.
  const swallow = () => {};
  if (child && typeof child.on === "function") child.on("error", swallow);
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
