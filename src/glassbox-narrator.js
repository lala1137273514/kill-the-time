"use strict";

// Glass-box NARRATOR — the single coordinator every event source funnels through.
//
// Before this, five surfaces each decided on their own whether to talk: phase
// feedback, dispatch commentary, chat replies, permission prompts, and the OS
// sleep/wake machine. They shouted independently — over each other, over the
// sleeping pet, and double-spoke. The narrator is the one place that takes ALL
// of them and returns a SINGLE effect: which card to show, whether to speak, and
// what (if anything) the pet should reflect. main.js stops branching; it just
// feeds events in and applies the effect out.
//
// PURE: now() is injected; no I/O, no spawning. Throttling is wall-clock based
// (injected now) so the priority/throttle logic is unit-testable without a real
// clock. Let it crash — no try/catch swallowing; the Electron glue in main.js
// owns error isolation, exactly like glassbox-supervisor / glassbox-commentary.
//
// event  = { source, kind, text?, data? }
//   source ∈ "phase" | "commentary" | "chat" | "permission" | "native"
// effect = { card?, speak?, petState? }  (or null = nothing to do)
//   card.mode ∈ "status" | "activity" | "chat" | "permission" | "hide"
//     status     = { mode, emoji, text, terminal }   (glass-box phase)
//     activity   = { mode, text }                     (dispatch milestone)
//     chat       = { mode, text }                     (assistant reply)
//     permission = { mode, summary }                  (approval needed)
//     hide       = { mode }                           (clear the card)

const { phaseFeedback } = require("./glassbox-phase-ui");

const DEFAULT_SPEAK_THROTTLE_MS = 4000;

// SPARSE SPEAK — the whole point. Most phases are card-only (the bar/bubble
// already shows them); we only break silence for the moments that matter. Other
// phases (thinking/capturing/running/…) update the card but stay quiet.
const SPEAK_PHASES = new Set(["confirming", "dispatching", "done", "error", "chatting"]);

// createNarrator({ now, speakThrottleMs }) -> { observe(event), reset() }
function createNarrator(opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const speakThrottleMs =
    Number.isFinite(opts.speakThrottleMs) && opts.speakThrottleMs > 0
      ? opts.speakThrottleMs
      : DEFAULT_SPEAK_THROTTLE_MS;

  let asleep = false; // set by native sleep, cleared by native wake / reset
  let lastActivityAt = null; // wall-clock of the last emitted commentary card (null = never)

  function handlePermission(event) {
    // Permission OUTRANKS everything and passes through even while asleep — a
    // pending approval can't be hidden by sleep or a co-occurring phase.
    if (event.kind === "resolved") {
      return { card: { mode: "hide" } };
    }
    // kind === "request" (or any non-resolved permission event): demand a decision.
    return {
      card: { mode: "permission", summary: event.text },
      speak: "它要权限，批准吗？",
      petState: "notification",
    };
  }

  function handlePhase(event) {
    const phase = event.text;
    const fb = phaseFeedback(phase);
    const effect = {
      card: { mode: "status", emoji: fb.emoji, text: fb.status, terminal: fb.terminal },
      petState: fb.petState,
    };
    // Sparse speak: only the moments in SPEAK_PHASES break silence; the spoken
    // line is the phase's own microcopy. Everything else is card-only.
    if (SPEAK_PHASES.has(phase)) effect.speak = fb.status;
    return effect;
  }

  function handleCommentary(event) {
    // Dispatch milestone: card-only, NEVER speaks (commentary would be the
    // chatty spinner we're killing). Throttled so a burst coalesces to one card.
    const t = now();
    if (lastActivityAt !== null && t - lastActivityAt < speakThrottleMs) return null;
    lastActivityAt = t;
    return { card: { mode: "activity", text: event.text } };
  }

  function handleChat(event) {
    if (event.kind === "supervisor" || event.kind === "speech" || event.kind === "tts") {
      return {
        card: { mode: "speech", text: event.text, status: "Clawd 旁白" },
        speak: event.text,
      };
    }
    // The assistant's reply: show it AND say it.
    return { card: { mode: "chat", text: event.text }, speak: event.text };
  }

  function observe(event) {
    const source = event.source;

    // Permission is the top priority and is never suppressed by sleep.
    if (source === "permission") return handlePermission(event);

    // Native sleep/wake only flips the asleep flag — it never renders a card.
    if (source === "native") {
      if (event.kind === "sleep") asleep = true;
      else if (event.kind === "wake") asleep = false;
      return null;
    }

    // While asleep, nothing but permission may surface — never cover the sleep.
    if (asleep) return null;

    if (source === "phase") return handlePhase(event);
    if (source === "commentary") return handleCommentary(event);
    if (source === "chat") return handleChat(event);

    // Unknown source: stay quiet (the shape was valid, the source isn't ours).
    return null;
  }

  function reset() {
    asleep = false;
    lastActivityAt = null;
  }

  return { observe, reset };
}

module.exports = { createNarrator, SPEAK_PHASES };
