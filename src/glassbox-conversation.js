"use strict";

// Glass-box multi-turn conversation buffer (demo/kill-boring-loading, Phase 2).
//
// Voice chat used to be single-turn: every utterance went to the orchestrator
// with no memory of what was said before, so "再说一遍" or "那它呢？" had no
// referent. This keeps the recent back-and-forth so orchestrate() can prepend
// it (between the system prompt and the new user message) and the small model
// gets context.
//
// PURE: no I/O, no clock. The buffer is a plain in-memory list. Let it crash —
// no silent coercion of non-strings, the caller passes transcripts / replies.

// createConversation({ maxTurns }) -> buffer
//   A "turn" is a user+assistant pair, so the message cap is maxTurns*2. When a
//   new message pushes past the cap we drop the oldest messages first.
function createConversation({ maxTurns = 8 } = {}) {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error("createConversation: maxTurns must be a positive integer");
  }
  const cap = maxTurns * 2;
  let buffer = [];

  function append(role, text) {
    const content = String(text).trim();
    if (!content) return; // ignore empty / whitespace-only utterances
    buffer.push({ role, content });
    if (buffer.length > cap) buffer = buffer.slice(buffer.length - cap);
  }

  return {
    appendUser(text) {
      append("user", text);
    },
    appendAssistant(text) {
      append("assistant", text);
    },
    // Chronological copy (oldest -> newest), capped to the last maxTurns*2.
    messages() {
      return buffer.map((m) => ({ role: m.role, content: m.content }));
    },
    clear() {
      buffer = [];
    },
    size() {
      return buffer.length;
    },
  };
}

module.exports = { createConversation };
