"use strict";

// Glass-box listen orchestrator (demo/kill-boring-loading, D3). Ties one
// push-to-talk utterance to an action: transcribe (local whisper) -> route
// intent -> act.
//
// ARCHITECTURE REALITY: clawd observes the agent via hooks and can RESOLVE a
// pending permission prompt (the same path as the approve/deny hotkey —
// permission.js hotkeyResolve), but it has no channel to inject a new task or a
// clarification answer into the agent's stdin. So only approve/deny actually
// drives the agent here; task/answer are handed to onText for the caller to
// surface (e.g. copy to clipboard / speak "我只能在你等批准时搭把手"), never faked.
//
// All side effects injected (transcribe, getPending, resolvePermission, onText,
// log) so the flow is unit-testable without a mic, a binary, or Electron.

const { routeVoiceCommand } = require("./glassbox-intent");

class GlassboxListener {
  constructor(deps = {}) {
    if (typeof deps.transcribe !== "function") throw new Error("GlassboxListener needs transcribe()");
    if (typeof deps.resolvePermission !== "function") throw new Error("GlassboxListener needs resolvePermission()");
    this.transcribe = deps.transcribe;
    this.resolvePermission = deps.resolvePermission; // (behavior: "allow"|"deny") => void
    this.getPending = typeof deps.getPending === "function" ? deps.getPending : () => ({});
    this.onText = typeof deps.onText === "function" ? deps.onText : () => {};
    this.onTranscript = typeof deps.onTranscript === "function" ? deps.onTranscript : () => {};
    this.onError = typeof deps.onError === "function" ? deps.onError : () => {};
    this.log = typeof deps.log === "function" ? deps.log : () => {};
  }

  // Process one recorded clip. Returns the routed decision (or {action:"error"}).
  async onUtterance(wavPath) {
    let text;
    try {
      text = await this.transcribe(wavPath);
    } catch (err) {
      this.log(`glassbox-listen: transcribe failed: ${err && err.message}`);
      try { this.onError(err); } catch {}
      return { action: "error", error: err && err.message };
    }

    // Echo what we heard (UI bubble) so the user can catch mis-hears.
    try { this.onTranscript(text); } catch {}

    const pending = this.getPending() || {};
    const route = routeVoiceCommand(text, pending);
    this.log(`glassbox-listen: "${(text || "").slice(0, 40)}" -> ${route.action}`);

    switch (route.action) {
      case "approve":
        this.resolvePermission("allow");
        break;
      case "deny":
        this.resolvePermission("deny");
        break;
      case "answer":
      case "task":
        // clawd can't inject into the agent — surface it, don't fake it.
        this.onText(route);
        break;
      default:
        break; // "none" (silence) — do nothing
    }
    return route;
  }
}

module.exports = { GlassboxListener };
