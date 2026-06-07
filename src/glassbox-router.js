"use strict";

// Glass-box dispatch routing / policy (direction 2b — the "routing system").
//
// Pure decision: given the orchestrator's decision and a policy, must this
// dispatch be confirmed before it runs? Default "always" preserves the safe
// current behavior (every dispatch confirms). "writes-only" lets safe read-only
// voice commands run without a confirm dialog — faster — while anything that
// writes/deletes/hits the network still gets the confirm gate.
//
// Kept pure so the policy is unit-tested; main.js injects the result into
// GlassboxRemote via the shouldConfirm dep.

const CONFIRM_MODES = Object.freeze(["always", "writes-only"]);

function needsConfirmation(decision, policy = {}) {
  const mode = policy && policy.confirmMode === "writes-only" ? "writes-only" : "always";
  if (mode === "always") return true;
  return !!(decision && decision.risk === "write");
}

module.exports = { CONFIRM_MODES, needsConfirmation };
