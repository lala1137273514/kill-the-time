"use strict";

// Decides whether (and how) a glass-box phase should be reflected on the pet
// itself, as a TRANSIENT overlay on top of the session-driven state machine.
//
// Loose-coupled + pure so the policy is unit-tested; main.js applies the result
// via the sanctioned setState() (which already gates DND). We additionally refuse
// to stomp the sleep family (never wake the pet for a phase) or high-priority
// machine-owned states. Phase→petState comes from the shared phase-ui mapping,
// so the pet and the input-bar "glass box" always agree.

const { phaseFeedback } = require("./glassbox-phase-ui");

const PROTECTED_STATES = new Set([
  // sleep sequence — a transient phase must never wake the pet
  "sleeping", "dozing", "collapsing", "waking", "yawning",
  // loud one-shots the state machine owns; mid-tier states (sweeping/carrying/
  // working) are reflection targets the flow may overwrite as it advances.
  "error", "notification",
]);

// resolvePhaseReflection(phase, currentState) -> petState string | null
//   null  => don't touch the pet (idle-mapped phase, or a protected current state)
function resolvePhaseReflection(phase, currentState) {
  const fb = phaseFeedback(phase);
  if (!fb.petState || fb.petState === "idle") return null;
  if (typeof currentState === "string" && PROTECTED_STATES.has(currentState)) return null;
  return fb.petState;
}

module.exports = { PROTECTED_STATES, resolvePhaseReflection };
