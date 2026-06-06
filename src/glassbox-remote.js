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
    this.log = typeof deps.log === "function" ? deps.log : () => {};
  }

  async handle(transcript) {
    const text = String(transcript || "").trim();
    if (!text) return { action: "none" };

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
      decision = await this.orchestrate(text, ctx);
    } catch (err) {
      this.log(`glassbox-remote: orchestrate failed: ${err && err.message}`);
      return { action: "error", error: err && err.message };
    }

    switch (decision.action) {
      case "approve":
        this.resolvePermission("allow");
        return decision;
      case "deny":
        this.resolvePermission("deny");
        return decision;
      case "answer":
        this.onAnswer(decision);
        return decision;
      case "chat":
        if (decision.reply) this.speak(decision.reply);
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
      defaultCwd: this.defaultCwd,
      sessionIdle: sessionId ? !!this.getSessionIdle(sessionId) : false,
    });

    // Don't guess a directory (spec §6 risk). Ask before we even confirm.
    if (!plan.cwd) {
      this.speak("我不确定在哪个目录跑，帮我指一下");
      return;
    }

    // Recap out loud, then confirm before every dispatch — cheap insurance
    // against a misheard utterance burning a whole agent run (spec §6 risk).
    const recap = summarizeForSpeech(decision.refinedPrompt);
    if (recap) this.speak(`我要让它：${recap}，对吗？`);
    const ok = await this.confirmDispatch(decision);
    if (!ok) {
      this.speak("好，取消了");
      return;
    }

    try {
      this.dispatchFn(plan, {
        onComplete: (result) => {
          const summary = summarizeForSpeech(lastMeaningfulLine(result && result.output));
          this.speak(summary ? `搞定，${summary}` : "搞定了，结果在终端里");
        },
      });
    } catch (err) {
      this.log(`glassbox-remote: dispatch failed: ${err && err.message}`);
      this.speak("派活没成功，你看下终端");
      return;
    }
    this.speak(decision.reply || "好的，已经让它处理了");
  }
}

module.exports = { GlassboxRemote, summarizeForSpeech };
