"use strict";

// Glass-box active "supervisor" policy (demo/kill-boring-loading).
//
// A pure decision function fed the SAME session-snapshot stream the voice host
// and HUD already consume. It watches the primary running session across
// successive snapshots and decides when to *actively* speak up: it nudges when a
// run appears stalled (same tool, no fan-out, for > stuckMs), and it announces
// the verdict on completion / failure. Playback, TTS, IPC and the bubble live in
// main.js — this module never does I/O.
//
// Why a separate module from glassbox-narration: narration is a passive
// milestone announcer (start / fan-out / done) keyed off transitions. The
// supervisor is *time-aware* — it fires on the ABSENCE of progress (a wall-clock
// stall the snapshot stream alone can't express), which is the "active
// supervision" the demo wants. Keeping it pure + injected (stuckMs, now) makes
// the stall logic unit-testable without a clock, Electron, or a real agent.
//
// Snapshot session shape (state-session-snapshot.js):
//   { id, badge: "running"|"done"|"interrupted"|"idle", state, currentTool, subagentCount }
// badge is the load-bearing field: "done"/"interrupted" are terminal; "running"
// is the only state we time for a stall.

const DEFAULT_STUCK_MS = 20000;

// Short, human, highlight-only lines (no restating the screen). Rotated so a
// repeated stall / completion doesn't sound like a recording. Matches the tone
// of glassbox-narration's LINES bank.
const SAY = {
  stuck: [
    "这步卡了一会儿了，我盯着，需要的话喊我",
    "这里有点久，我还在看，没死",
    "这块磨蹭了一下，我继续守着",
  ],
  done: [
    "盯完了，搞定收工",
    "好，跑完了，结果在终端",
    "看着它做完了，没问题",
  ],
  error: [
    "出岔子了，你瞅一眼终端",
    "这趟没成，卡在中间了，去看看",
    "翻车了，得你来接手一下",
  ],
};

function badgeOf(session) {
  return (session && session.badge) || "idle";
}
function toolOf(session) {
  return (session && session.currentTool) || null;
}
function subagentsOf(session) {
  const n = Number(session && session.subagentCount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Same primary-pick rule as glassbox-voice.pickPrimary: prefer the HUD's last
// focused session, else the first running one. Kept local so the supervisor has
// no dependency on the voice host.
function pickPrimary(snapshot) {
  const sessions = Array.isArray(snapshot && snapshot.sessions) ? snapshot.sessions : [];
  const id = snapshot && snapshot.hudLastSessionId;
  if (id) {
    const found = sessions.find((s) => s && s.id === id);
    if (found) return found;
  }
  return sessions.find((s) => s && badgeOf(s) === "running") || null;
}

// createSupervisor({ stuckMs, now }) -> { note(session)->event|null,
//                                         noteSnapshot(snapshot)->event|null }
// event: { kind: "stuck"|"done"|"error", say }   (null = nothing to surface)
//
// "progress" is intentionally NOT emitted as an event — progress is the silent
// case: it just RESETS the stall clock (a fresh tool / new fan-out). Surfacing a
// line on every tool change would be the chatty spinner we're trying to kill.
function createSupervisor(opts = {}) {
  const stuckMs = Number.isFinite(opts.stuckMs) && opts.stuckMs > 0 ? opts.stuckMs : DEFAULT_STUCK_MS;
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();

  const rotation = { stuck: 0, done: 0, error: 0 };
  // Per-primary-session memory. We only ever track one primary at a time; if the
  // primary id changes we reset, so a new run starts with a clean stall clock.
  let trackedId = null;
  let lastTool = null;
  let lastSubs = 0;
  let progressAt = 0;     // wall-clock of the last observed progress (tool/fan-out change)
  let stuckArmed = true;  // false after a stuck warning fires, re-armed by progress
  let terminalFired = false; // guards done/error to once per run

  function render(kind) {
    const bank = SAY[kind];
    const idx = rotation[kind] % bank.length;
    rotation[kind] += 1;
    return { kind, say: bank[idx] };
  }

  function reset(session, t) {
    trackedId = session && session.id;
    lastTool = toolOf(session);
    lastSubs = subagentsOf(session);
    progressAt = t;
    stuckArmed = true;
    terminalFired = false;
  }

  function note(session) {
    const id = session && session.id;
    if (!id) return null;
    const t = now();

    // New primary (or first ever) — establish a baseline, decide nothing yet.
    if (id !== trackedId) {
      reset(session, t);
      return null;
    }

    const badge = badgeOf(session);

    // Terminal verdicts win over everything and fire once per run.
    if (badge === "done") {
      if (terminalFired) return null;
      terminalFired = true;
      return render("done");
    }
    if (badge === "interrupted") {
      if (terminalFired) return null;
      terminalFired = true;
      return render("error");
    }

    // Only a running session can be "stuck". Anything else (idle/sleeping after
    // a run, or pre-start) is just quiet — and resets the stall baseline so a
    // later resume doesn't inherit a stale clock.
    if (badge !== "running") {
      lastTool = toolOf(session);
      lastSubs = subagentsOf(session);
      progressAt = t;
      stuckArmed = true;
      return null;
    }

    // Progress = the live tool changed, or a new subagent fanned out. Either
    // resets the stall clock and re-arms the warning (silent — see header).
    const curTool = toolOf(session);
    const curSubs = subagentsOf(session);
    if (curTool !== lastTool || curSubs !== lastSubs) {
      lastTool = curTool;
      lastSubs = curSubs;
      progressAt = t;
      stuckArmed = true;
      return null;
    }

    // Stalled: same tool, no fan-out, for longer than the budget — and we
    // haven't already warned about THIS stall.
    if (stuckArmed && t - progressAt > stuckMs) {
      stuckArmed = false; // one warning per stall; re-armed only by real progress
      return render("stuck");
    }

    return null;
  }

  function noteSnapshot(snapshot) {
    const primary = pickPrimary(snapshot);
    if (!primary) return null;
    return note(primary);
  }

  return { note, noteSnapshot };
}

module.exports = { createSupervisor, pickPrimary, SAY };
