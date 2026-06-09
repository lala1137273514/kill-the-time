"use strict";

// Glass-box phase → UI/pet feedback mapping (direction 1: middle-state feedback).
//
// GlassboxRemote emits semantic phases during the silent gap between "submit"
// and "result". This pure module turns each phase into:
//   - status:   short Chinese microcopy for the Ctrl+Space "glass box" input bar
//   - emoji:    a small glyph to make the status glanceable
//   - petState: an EXISTING shipped pet state to reflect (so it degrades on any
//               theme without new SVGs); the renderer overlays it transiently
//   - terminal: whether this phase ends the flow (bar can dismiss, pet settles)
//
// Kept pure + dependency-free so the whole mapping is unit-tested; main.js only
// does the Electron glue (IPC relay + window lifecycle).

const FEEDBACK = Object.freeze({
  thinking:      { status: "在想怎么干…",     emoji: "💭", petState: "thinking",     terminal: false },
  capturing:     { status: "看一眼屏幕…",     emoji: "📸", petState: "sweeping",     terminal: false },
  confirming:    { status: "等原生确认…",     emoji: "⏸️", petState: "attention",    terminal: false },
  dispatching:   { status: "派给 agent…",     emoji: "🚀", petState: "carrying",     terminal: false },
  running:       { status: "监工中…",         emoji: "⏳", petState: "working",      terminal: false },
  done:          { status: "搞定！",          emoji: "✅", petState: "notification", terminal: true },
  approved:      { status: "批准了",          emoji: "✅", petState: "notification", terminal: true },
  denied:        { status: "拒绝了",          emoji: "🛑", petState: "attention",    terminal: true },
  answered:      { status: "记下了",          emoji: "📝", petState: "attention",    terminal: true },
  chatting:      { status: "说话中…",         emoji: "💬", petState: "attention",    terminal: true },
  cancelled:     { status: "取消了",          emoji: "⚪", petState: "idle",         terminal: true },
  "needs-input": { status: "在哪个目录跑？",  emoji: "📂", petState: "attention",    terminal: true },
  error:         { status: "出了点问题",      emoji: "⚠️", petState: "error",        terminal: true },
});

const PHASES = Object.freeze(Object.keys(FEEDBACK));

const FALLBACK = Object.freeze({ status: "", emoji: "", petState: "idle", terminal: true });

// phaseFeedback(phase) -> { status, emoji, petState, terminal }
// Unknown / empty / non-string input degrades to a safe idle-terminal result.
function phaseFeedback(phase) {
  if (typeof phase !== "string") return { ...FALLBACK };
  const hit = FEEDBACK[phase];
  return hit ? { ...hit } : { ...FALLBACK };
}

module.exports = { PHASES, phaseFeedback };
