"use strict";

// Glass-box "deep supervisor" commentary (demo/kill-boring-loading).
//
// The session-snapshot supervisor (glassbox-supervisor.js) only sees coarse
// badges/tools across snapshots; a *dispatched* run (claude -p / codex exec) is
// otherwise a black box. This module narrates what the dispatched run is
// actually DOING by reading its stdout/stderr ONE line at a time and emitting a
// short, friendly Chinese line at each milestone —装依赖 / 改文件 / 跑测试 /
// 报错 / 搞定.
//
// PRIVACY (load-bearing): we NEVER echo the raw line. A milestone maps to a
// fixed canned phrase from a bank; file paths, code, and secrets in the input
// never reach `say`. Output is purely category-derived.
//
// PURE: now() is injected; no I/O, no spawning. Throttling is wall-clock based
// (injected now) so it's unit-testable without a real clock. Let it crash — no
// try/catch swallowing; the Electron glue in main.js owns error isolation.
//
// Mirrors glassbox-supervisor's shape: a factory returning event-or-null, with
// rotated SAY banks so a repeated milestone doesn't sound like a recording, and
// tone matched to glassbox-phase-ui.

const DEFAULT_THROTTLE_MS = 4000;

// Short, human, highlight-only lines — fixed phrases, never derived from the
// raw line (privacy). Rotated within a category so a burst varies.
const SAY = {
  install: ["在装依赖…", "拉依赖中…", "装包呢…"],
  edit: ["动了几个文件", "在改文件", "改代码中…"],
  test: ["在跑测试", "跑测试呢…", "在验证一下"],
  build: ["在打包构建", "构建中…"],
  error: ["好像报错了", "撞到错了，我盯着", "这步有点不对劲"],
  done: ["这步搞定", "做完一截了", "这块完事"],
};

// finish verdicts are NOT rotated/throttled — one clear line per run.
const FINISH = {
  ok: "搞定",
  fail: "好像没成，去终端看看",
};

// Milestone detectors, checked in priority order. error wins over a co-occurring
// "done" word; install/edit/test/build are content categories. Each returns the
// SAY-bank key, NOT any captured text from the line.
//
// Anchored to command/log verbs (not bare nouns) to avoid firing on prose like
// "we will test the idea". All matching is on the line CONTENT only; nothing is
// extracted into the spoken phrase.
function classify(line) {
  const s = String(line);
  const low = s.toLowerCase();

  // Error / exception first — a failing line matters most.
  if (/\berror\b|\bexception\b|\btraceback\b|\bfailed\b|\bfatal\b|panic:/.test(low)) {
    return "error";
  }
  // Dependency install (package managers).
  if (/\b(npm|pnpm|yarn|pip|pip3|bundle|cargo|go)\s+(install|add|i|get)\b/.test(low)) {
    return "install";
  }
  // Running tests.
  if (/\bnpm\s+test\b|\b(running|run)\s+tests?\b|\bjest\b|\bpytest\b|\bvitest\b|\bmocha\b|\bnode\s+--test\b/.test(low)) {
    return "test";
  }
  // Build / compile.
  if (/\b(npm|pnpm|yarn)\s+run\s+build\b|\b(running|run)\s+build\b|\bwebpack\b|\btsc\b|\bvite\s+build\b|\bcompiling\b/.test(low)) {
    return "build";
  }
  // File create / edit (verb-anchored so it doesn't match arbitrary filenames).
  if (/\b(editing|creating|writing|wrote|created|edited|modifying|modified|patching|patched)\b/.test(low)) {
    return "edit";
  }
  // Completion markers.
  if (/\b(done|completed|complete|finished|success|all set|✓|✅)\b/.test(low)) {
    return "done";
  }
  return null;
}

// createCommentary({ now, throttleMs }) -> { observe(line), finish({ code }), reset() }
//   observe(line): { say } at a milestone (throttled), else null.
//   finish({ code }): { say } — success (code 0) vs failure. Never throttled.
//   reset(): clear throttle + rotation state for a new run.
function createCommentary(opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const throttleMs =
    Number.isFinite(opts.throttleMs) && opts.throttleMs > 0 ? opts.throttleMs : DEFAULT_THROTTLE_MS;

  const rotation = { install: 0, edit: 0, test: 0, build: 0, error: 0, done: 0 };
  let lastSayAt = null; // wall-clock of the last emitted observe say (null = never)

  function render(kind) {
    const bank = SAY[kind];
    const idx = rotation[kind] % bank.length;
    rotation[kind] += 1;
    return { kind, say: bank[idx] };
  }

  function observe(line) {
    const kind = classify(line);
    if (!kind) return null;

    const t = now();
    // Throttle: at most one say per window; coalesce bursts (drop, don't queue).
    if (lastSayAt !== null && t - lastSayAt < throttleMs) return null;
    lastSayAt = t;
    return render(kind);
  }

  function finish(info = {}) {
    const ok = Number(info.code) === 0;
    return { kind: ok ? "done" : "error", say: ok ? FINISH.ok : FINISH.fail };
  }

  function reset() {
    rotation.install = 0;
    rotation.edit = 0;
    rotation.test = 0;
    rotation.build = 0;
    rotation.error = 0;
    rotation.done = 0;
    lastSayAt = null;
  }

  return { observe, finish, reset };
}

module.exports = { createCommentary, classify, SAY, FINISH };
