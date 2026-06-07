"use strict";

// Speech ↔ pet liveliness (direction 3b). Two pure helpers:
//   - wavDurationMs: read a WAV's playback length from its header, so callers can
//     hold a "talking" animation for exactly as long as the pet is speaking
//     (qwen3-tts-flash returns only a WAV, no duration metadata).
//   - emotionToPetState / speechReflection: pick a shipped pet state to show
//     while the pet speaks, gated so it never stomps sleep / high-priority states.
// Pure + dependency-free so it's unit-tested; main.js applies via setState().

const { PROTECTED_STATES } = require("./state-phase-resolver");

// wavDurationMs(buffer) -> milliseconds, or 0 if the buffer isn't a usable WAV.
function wavDurationMs(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return 0;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return 0;

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt " && offset + 20 <= buffer.length) {
      byteRate = buffer.readUInt32LE(offset + 16); // byteRate sits 8 bytes into fmt data
    } else if (id === "data") {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (byteRate <= 0 || dataSize <= 0) return 0;
  return Math.round((dataSize / byteRate) * 1000);
}

const EMOTION_STATE = Object.freeze({
  positive: "notification",
  happy: "notification",
  concerned: "thinking",
  neutral: "attention",
});

function emotionToPetState(emotion) {
  return EMOTION_STATE[emotion] || "attention";
}

// speechReflection(emotion, currentState) -> petState | null
function speechReflection(emotion, currentState) {
  if (typeof currentState === "string" && PROTECTED_STATES.has(currentState)) return null;
  return emotionToPetState(emotion);
}

module.exports = { wavDurationMs, emotionToPetState, speechReflection };
