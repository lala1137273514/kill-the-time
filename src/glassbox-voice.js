"use strict";

// Glass-box voice host (demo/kill-boring-loading). Ties the snapshot stream to
// spoken narration: pick the primary running session, ask the NarrationController
// whether a milestone just fired, and if so synthesize + play a line.
//
// All side effects are injected (synth, play, now, log) so the orchestration is
// unit-testable and main.js owns the real TTS + Electron playback. A single
// in-flight guard keeps lines from piling up; TTS failures are logged, never
// fatal — a narration hiccup must not take down the pet.

const { NarrationController } = require("./glassbox-narration");

function pickPrimary(snapshot) {
  const sessions = Array.isArray(snapshot && snapshot.sessions) ? snapshot.sessions : [];
  const id = snapshot && snapshot.hudLastSessionId;
  if (id) {
    const found = sessions.find((s) => s && s.id === id);
    if (found) return found;
  }
  return sessions.find((s) => s && s.badge === "running") || null;
}

class GlassboxVoice {
  // deps: { synth(text)->Promise<Buffer|null>, play(audio)->void, now()->ms,
  //         log(msg)->void, controller? }
  constructor(deps = {}) {
    if (typeof deps.synth !== "function") throw new Error("GlassboxVoice needs synth()");
    if (typeof deps.play !== "function") throw new Error("GlassboxVoice needs play()");
    this.synth = deps.synth;
    this.play = deps.play;
    this.now = typeof deps.now === "function" ? deps.now : () => 0;
    this.log = typeof deps.log === "function" ? deps.log : () => {};
    this.controller = deps.controller || new NarrationController(deps.controllerOpts || {});
    this.speaking = false;
    this._inflight = null; // exposed for tests to await
  }

  onSnapshot(snapshot) {
    try {
      const sessions = Array.isArray(snapshot && snapshot.sessions) ? snapshot.sessions : [];
      this.controller.prune(sessions.map((s) => s && s.id).filter(Boolean));
      // While a line is mid-flight, don't run the controller — that would
      // CONSUME the transition (advance prev-state/throttle) and silently drop
      // the milestone, including the "done" payoff. Skipping leaves it pending
      // so the next snapshot re-detects it once we're free.
      if (this.speaking) return;
      const primary = pickPrimary(snapshot);
      if (!primary) return;
      const line = this.controller.next(primary, this.now());
      if (!line) return;
      this._speak(line.text);
    } catch (err) {
      this.log(`glassbox-voice snapshot error: ${err && err.message}`);
    }
  }

  // Speak an arbitrary line on demand (e.g. a dispatch receipt), outside the
  // snapshot/milestone path. Returns the in-flight promise so callers can await.
  speak(text) {
    const t = String(text || "").trim();
    if (!t) return Promise.resolve();
    this._speak(t);
    return this._inflight || Promise.resolve();
  }

  _speak(text) {
    if (this.speaking) return;
    this.speaking = true;
    this._inflight = Promise.resolve()
      .then(() => this.synth(text))
      .then((audio) => { if (audio) this.play(audio); })
      .catch((err) => this.log(`glassbox-voice tts error: ${err && err.message}`))
      .finally(() => { this.speaking = false; });
  }
}

module.exports = { GlassboxVoice, pickPrimary };
