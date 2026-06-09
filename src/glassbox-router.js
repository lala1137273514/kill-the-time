"use strict";

// Glass-box dispatch routing / policy (direction 2b — the "routing system").
//
// Pure decision: given the orchestrator's decision and a policy, must this
// dispatch be confirmed before it runs? Default "agent-native" matches the
// supervisor design: the pet assigns work, and tool approval remains in the
// agent's native/default permission flow. "always" / "writes-only" are optional
// extra pre-dispatch gates.
//
// Kept pure so the policy is unit-tested; main.js injects the result into
// GlassboxRemote via the shouldConfirm dep.

const CONFIRM_MODES = Object.freeze(["agent-native", "always", "writes-only"]);

function needsConfirmation(decision, policy = {}) {
  const raw = policy && policy.confirmMode;
  const mode = CONFIRM_MODES.includes(raw) ? raw : "agent-native";
  if (mode === "agent-native") return false;
  if (mode === "always") return true;
  return !!(decision && decision.risk === "write");
}

module.exports = { CONFIRM_MODES, needsConfirmation };
