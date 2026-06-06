"use strict";

// Glass-box voice narration controller (demo/kill-boring-loading).
//
// Turns the session snapshot stream into spoken milestones so a user who walks
// away still *hears* progress, instead of a silent spinner. Pure logic: it
// takes a primary running session entry + a clock, decides whether a milestone
// just happened, throttles chatter, and returns the line to speak (or null).
// Playback / TTS / IPC live elsewhere — this module never does I/O.

const MILESTONES = {
  START: "start",
  FANOUT: "fanout",
  STUCK: "stuck",
  DONE: "done",
};

// Human, short, highlight-only lines (no restating what's on screen). Rotated
// per-milestone so repeated runs don't sound like a recording.
const LINES = {
  start: [
    "收到，我开始拆这件事了",
    "好，我这就上手",
    "明白，我先理一下思路",
  ],
  fanout: [
    (n) => `我兵分 ${n} 路同时查，省点时间`,
    (n) => `${n} 个方向一起开搞了`,
    (n) => `派了 ${n} 个分身并行处理`,
  ],
  stuck: [
    "这里有点绕，我换个法子",
    "卡了一下，让我再想想",
    "这步不太顺，我绕一下",
  ],
  done: [
    "搞定，结果给你了",
    "好了，弄完了",
    "这就完事，收工",
  ],
};

const DEFAULT_MIN_INTERVAL_MS = 4000;

function badgeOf(session) {
  return (session && session.badge) || "idle";
}
function stateOf(session) {
  return (session && session.state) || "idle";
}
function subagentsOf(session) {
  const n = Number(session && session.subagentCount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

class NarrationController {
  // opts.minIntervalMs: floor between two spoken lines (done bypasses it).
  constructor(opts = {}) {
    this.minIntervalMs = Number.isFinite(opts.minIntervalMs)
      ? opts.minIntervalMs
      : DEFAULT_MIN_INTERVAL_MS;
    this.lastSpokeAt = -Infinity;
    this.rotation = { start: 0, fanout: 0, stuck: 0, done: 0 };
    // Per-session memory of the fields we diff transitions against.
    this.prev = new Map(); // sessionId -> { badge, state, subagentCount }
  }

  // Detect which milestone (if any) this session just crossed. Returns
  // { milestone, count } or null. Pure read of prev vs cur.
  _detect(session) {
    const id = session && session.id;
    if (!id) return null;
    const prev = this.prev.get(id) || { badge: "idle", state: "idle", subagentCount: 0, started: false };
    const curBadge = badgeOf(session);
    const curState = stateOf(session);
    const curSubs = subagentsOf(session);

    let result = null;
    let started = prev.started;
    if (curBadge === "done" && prev.badge !== "done") {
      result = { milestone: MILESTONES.DONE };
    } else if (curBadge === "interrupted" && prev.badge !== "interrupted") {
      // Failures surface as badge "interrupted" — state "error" is a one-shot
      // that updateSession stores as idle, so it never reaches the snapshot.
      result = { milestone: MILESTONES.STUCK };
    } else if (curSubs >= 2 && curSubs > prev.subagentCount) {
      result = { milestone: MILESTONES.FANOUT, count: curSubs };
    } else if (curBadge === "running" && !prev.started) {
      // START fires once per session, not on every idle->running turn flip.
      result = { milestone: MILESTONES.START };
      started = true;
    }

    this.prev.set(id, { badge: curBadge, state: curState, subagentCount: curSubs, started });
    return result;
  }

  _render(milestone, count) {
    const bank = LINES[milestone];
    const idx = this.rotation[milestone] % bank.length;
    this.rotation[milestone] += 1;
    const pick = bank[idx];
    return typeof pick === "function" ? pick(count) : pick;
  }

  // Feed the primary running session entry from a snapshot. Returns the line to
  // speak now, or null. `nowMs` is injected so the throttle is testable.
  next(session, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    const hit = this._detect(session);
    if (!hit) return null;

    // Only FANOUT can rapid-fire (count 2->3->4 in quick succession), so it is
    // the only milestone the floor throttles. START is once-per-session, STUCK
    // and DONE are once-per-run — they always speak and are never dropped.
    if (hit.milestone === MILESTONES.FANOUT && now - this.lastSpokeAt < this.minIntervalMs) {
      return null;
    }

    this.lastSpokeAt = now;
    return { milestone: hit.milestone, text: this._render(hit.milestone, hit.count) };
  }

  // Drop tracking for sessions no longer present (called by the host on snapshot).
  prune(activeIds) {
    const keep = new Set(activeIds || []);
    for (const id of [...this.prev.keys()]) {
      if (!keep.has(id)) this.prev.delete(id);
    }
  }
}

module.exports = { NarrationController, MILESTONES, LINES };
