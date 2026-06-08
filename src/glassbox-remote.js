"use strict";

// Glass-box remote-control flow (demo/kill-boring-loading, Phase 2).
//
// One push-to-talk utterance, after transcription, becomes an action:
//   transcript
//     -> resolve the foreground window (cheap win32 query + session match)
//     -> light model (orchestrate): dispatch | chat | approve | deny | answer
//     -> dispatch: screenshot only when needed; confirm write/delete/network
//        first; resume an idle matched session else fresh run; speak a receipt.
//
// This is the "main.js 串起来" logic from REMOTE-CONTROL-SPEC §3/§7-5, pulled
// out as a class (mirroring D3's GlassboxListener) so every side effect is
// injected and the branching is unit-testable without Electron, a mic, or a key.
//
// Architecture honesty (spec §2 / §4): approve/deny reuse the real permission
// channel; an "answer" to a running TUI still can't be injected, so it's handed
// to onAnswer, never faked; a dispatch only ever spawns a NEW run.

const { planDispatch } = require("./glassbox-dispatch");
const { createConversation } = require("./glassbox-conversation");

// Collapse a long prompt / agent output into one short spoken line. Used for the
// pre-dispatch recap ("我要让它：… 对吗？") and the completion summary — the small
// screen / TTS shouldn't replay a wall of text (spec §4-3).
function summarizeForSpeech(text, maxLen = 50) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length <= maxLen ? s : s.slice(0, maxLen) + "…";
}

function lastMeaningfulLine(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

class GlassboxRemote {
  constructor(deps = {}) {
    const need = (name) => {
      if (typeof deps[name] !== "function") {
        throw new Error(`GlassboxRemote needs ${name}()`);
      }
      return deps[name];
    };
    this.orchestrate = need("orchestrate");           // (text, ctx) -> decision
    this.getForegroundWindow = need("getForegroundWindow"); // () -> Promise<window|null>
    this.takeScreenshot = need("takeScreenshot");     // (window) -> Promise<path>
    this.dispatchFn = need("dispatchFn");             // (plan, {onComplete}) -> handle
    this.resolvePermission = need("resolvePermission"); // ("allow"|"deny") -> void
    this.speak = need("speak");                       // (text) -> void
    this.confirmDispatch = need("confirmDispatch");   // (decision) -> Promise<bool>
    this.getSessionIdle = typeof deps.getSessionIdle === "function" ? deps.getSessionIdle : () => false;
    this.onAnswer = typeof deps.onAnswer === "function" ? deps.onAnswer : () => {};
    this.getPending = typeof deps.getPending === "function" ? deps.getPending : () => ({});
    this.defaultCwd = deps.defaultCwd || null;
    // A function lets main resolve a sensible default at dispatch time (e.g. the
    // most-recent tracked session's cwd); falls back to the static defaultCwd.
    this.getDefaultCwd = typeof deps.getDefaultCwd === "function" ? deps.getDefaultCwd : () => this.defaultCwd;
    this.getDefaultAgent = typeof deps.getDefaultAgent === "function" ? deps.getDefaultAgent : () => "claude";
    this.log = typeof deps.log === "function" ? deps.log : () => {};
    // Semantic phase callback for middle-state feedback (direction 1). The pet /
    // input bar map these phases to visible state; default no-op keeps it
    // optional and the branching unit-testable.
    this.onPhase = typeof deps.onPhase === "function" ? deps.onPhase : () => {};
    // Dispatch confirm policy. Default is agent-native: no extra pre-dispatch
    // dialog; tool approvals stay in the agent's own permission flow.
    this.shouldConfirm = typeof deps.shouldConfirm === "function" ? deps.shouldConfirm : () => false;
    // Multi-turn voice chat context (功能3). Injectable so main shares one buffer;
    // defaults to its own so the unit tests work standalone.
    this.conversation = deps.conversation || createConversation({});
  }

  async handle(transcript) {
    const text = String(transcript || "").trim();
    if (!text) return { action: "none" };

    this.onPhase("thinking");
    this.conversation.appendUser(text);

    // Resolve the foreground window first (cheap — no screenshot yet) so the
    // model has context to refine the prompt. Failure is non-fatal: permission
    // words still work without it.
    let window = null;
    try {
      window = await this.getForegroundWindow();
    } catch (err) {
      this.log(`glassbox-remote: foreground query failed: ${err && err.message}`);
    }

    const pending = this.getPending() || {};
    const ctx = { ...pending, window: window || undefined };

    let decision;
    try {
      decision = await this.orchestrate(text, ctx, { history: this.conversation.messages() });
    } catch (err) {
      this.log(`glassbox-remote: orchestrate failed: ${err && err.message}`);
      this.onPhase("error");
      return { action: "error", error: err && err.message };
    }

    this.log(`glassbox-remote: decision=${decision.action}` + (decision.action === "dispatch" ? ` risk=${decision.risk} needCapture=${decision.needCapture}` : ""));
    switch (decision.action) {
      case "approve":
        this.resolvePermission("allow");
        this.onPhase("approved");
        return decision;
      case "deny":
        this.resolvePermission("deny");
        this.onPhase("denied");
        return decision;
      case "answer":
        this.onAnswer(decision);
        this.onPhase("answered");
        return decision;
      case "chat":
        this.onPhase("chatting");
        if (decision.reply) { this.conversation.appendAssistant(decision.reply); this.speak(decision.reply); }
        return decision;
      case "dispatch":
        await this._dispatch(decision, window);
        return decision;
      default:
        return decision; // "none" / unknown — stay quiet
    }
  }

  async _dispatch(decision, window) {
    // Screenshot only when the task actually references the screen (spec §4-7).
    let screenshotPath = "";
    if (decision.needCapture) {
      this.onPhase("capturing");
      try {
        screenshotPath = await this.takeScreenshot(window || {});
      } catch (err) {
        this.log(`glassbox-remote: screenshot failed: ${err && err.message}`);
        screenshotPath = "";
      }
    }

    const sessionId = window && window.sessionId;
    const plan = planDispatch({
      window: window || {},
      decision,
      screenshotPath,
      defaultCwd: this.getDefaultCwd(),
      defaultAgent: this.getDefaultAgent(),
      sessionIdle: sessionId ? !!this.getSessionIdle(sessionId) : false,
    });

    // Don't guess a directory (spec §6 risk). Ask before we even confirm.
    if (!plan.cwd) {
      this.log("glassbox-remote: no cwd (foreground isn't a tracked agent session) — asking, not dispatching");
      this.onPhase("needs-input");
      this.speak("我不确定在哪个目录跑，帮我指一下");
      return;
    }

    // Confirm policy (direction 2b): by default recap + confirm before every
    // dispatch (cheap insurance against a misheard run, spec §6). A policy may
    // let safe read-only tasks skip the dialog for a faster voice flow.
    if (this.shouldConfirm(decision)) {
      const recap = summarizeForSpeech(decision.refinedPrompt);
      if (recap) this.speak(`我要让它：${recap}，对吗？`);
      this.onPhase("confirming");
      const ok = await this.confirmDispatch(decision);
      this.log(`glassbox-remote: confirm=${ok ? "yes" : "cancel"}`);
      if (!ok) {
        this.onPhase("cancelled");
        this.speak("好，取消了");
        return;
      }
    }

    try {
      this.onPhase("dispatching");
      this.log(`glassbox-remote: dispatching cwd=${plan.cwd}`);
      this.dispatchFn(plan, {
        onComplete: (result) => {
          const summary = summarizeForSpeech(lastMeaningfulLine(result && result.output));
          this.speak(summary ? `搞定，${summary}` : "搞定了，结果在终端里");
          this.onPhase("done");
        },
      });
      this.onPhase("running");
    } catch (err) {
      this.log(`glassbox-remote: dispatch failed: ${err && err.message}`);
      this.onPhase("error");
      this.speak("派活没成功，你看下终端");
      return;
    }
    this.speak(decision.reply || "好的，已经让它处理了");
  }
}

module.exports = { GlassboxRemote, summarizeForSpeech };
