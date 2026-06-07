"use strict";

// Glass-box settings section — PURE declarative builder (direction 4 UI).
//
// This module owns the *shape* of the in-app settings section for the glass-box
// voice-remote knobs. It is deliberately transport-free and DOM-free: it returns
// a plain spec the renderer turns into rows, and a set of per-field validators
// the controller side (settings-actions.js) wires into the write path. Keeping it
// pure means it unit-tests under plain `node --test` with no electron, no jsdom.
//
// Single source of truth for the field set / allowed values stays in
// glassbox-settings.js (DEFAULT_GLASSBOX_SETTINGS / PERMISSION_MODES /
// CONFIRM_MODES). We import those instead of re-declaring them so the UI can
// never drift from what prefs actually stores. Secrets (API keys) are absent by
// construction — they live in env, never in plaintext prefs.

const {
  DEFAULT_GLASSBOX_SETTINGS,
  PERMISSION_MODES,
  CONFIRM_MODES,
} = require("./glassbox-settings");

// Whisper model sizes the bundled ASR sidecar understands. "" = unset → fall
// back to CLAWD_WHISPER_MODEL / built-in "base".
const WHISPER_MODELS = Object.freeze(["", "tiny", "base", "small", "medium", "large"]);

// zh labels for the unset / mode option values. Kept here (not i18n keys)
// because this section ships as a self-contained Chinese-first block matching
// the demo's design language; promote to the i18n table later if needed.
const PERMISSION_MODE_LABELS = Object.freeze({
  "": "跟随环境变量（默认）",
  bypassPermissions: "全部放行（bypass）",
  acceptEdits: "自动接受编辑",
  plan: "仅规划",
  default: "默认（逐项询问）",
});

const CONFIRM_MODE_LABELS = Object.freeze({
  always: "每次都确认",
  "writes-only": "仅写操作时确认",
});

const WHISPER_MODEL_LABELS = Object.freeze({
  "": "跟随环境变量（默认 base）",
  tiny: "tiny（最快）",
  base: "base（默认）",
  small: "small",
  medium: "medium",
  large: "large（最准）",
});

function _options(values, labels) {
  return values.map((value) => ({ value, label: labels[value] }));
}

// Ordered so the section reads top-down: master switches → policy → models →
// input → prompt. Each entry is the minimal declarative contract the renderer
// consumes: { key, label(zh), type: 'toggle'|'select'|'text', options? }.
function buildGlassboxSettingsSpec() {
  return [
    { key: "voiceEnabled", label: "语音总开关", type: "toggle" },
    { key: "wakeWordEnabled", label: "唤醒词「hey, cc」", type: "toggle" },
    {
      key: "confirmMode",
      label: "执行确认策略",
      type: "select",
      options: _options(CONFIRM_MODES, CONFIRM_MODE_LABELS),
    },
    {
      key: "permissionMode",
      label: "派发权限模式",
      type: "select",
      options: _options(PERMISSION_MODES, PERMISSION_MODE_LABELS),
    },
    { key: "orchestratorModel", label: "编排模型", type: "text" },
    { key: "ttsVoice", label: "语音音色（TTS）", type: "text" },
    {
      key: "whisperModel",
      label: "Whisper 识别模型",
      type: "select",
      options: _options(WHISPER_MODELS, WHISPER_MODEL_LABELS),
    },
    { key: "hotkey", label: "呼出快捷键", type: "text" },
    { key: "systemPrompt", label: "系统提示词", type: "text" },
  ];
}

// ── Per-field validators ──
//
// One pure validator per glassbox knob. Each takes the candidate value and
// returns { status: 'ok' } | { status: 'error', message }. No side effects, no
// snapshot needed — a single field's validity never depends on the others.
// These mirror the strict checks in normalizeGlassboxSettings but, per
// let-it-crash, they REJECT bad input instead of coercing it back to a default
// (normalize is the load-time hand-edit safety net; this is the runtime gate).
//
// Empty-string is a first-class "unset" value for the free-text + permission
// knobs (it means "fall back to env / built-in"). confirmMode has no unset —
// it always carries a concrete policy.

function okBoolean(field) {
  return (value) =>
    typeof value === "boolean"
      ? { status: "ok" }
      : { status: "error", message: `glassbox.${field} must be a boolean` };
}

function okString(field) {
  return (value) =>
    typeof value === "string"
      ? { status: "ok" }
      : { status: "error", message: `glassbox.${field} must be a string ("" = unset)` };
}

function okEnum(field, allowed) {
  return (value) =>
    allowed.includes(value)
      ? { status: "ok" }
      : { status: "error", message: `glassbox.${field} must be one of: ${allowed.map((v) => (v === "" ? "''" : v)).join(", ")}` };
}

const GLASSBOX_FIELD_VALIDATORS = Object.freeze({
  voiceEnabled: okBoolean("voiceEnabled"),
  wakeWordEnabled: okBoolean("wakeWordEnabled"),
  hotkey: okString("hotkey"),
  orchestratorModel: okString("orchestratorModel"),
  ttsVoice: okString("ttsVoice"),
  whisperModel: okEnum("whisperModel", WHISPER_MODELS),
  permissionMode: okEnum("permissionMode", PERMISSION_MODES),
  confirmMode: okEnum("confirmMode", CONFIRM_MODES),
  systemPrompt: okString("systemPrompt"),
});

// Strict single-field gate used by the controller's setGlassboxField command.
// Unknown field → error (never silently dropped).
function validateGlassboxField(field, value) {
  const validator = GLASSBOX_FIELD_VALIDATORS[field];
  if (!validator) {
    return { status: "error", message: `unknown glassbox field: ${field}` };
  }
  return validator(value);
}

// Sanity: the spec must reference exactly the fields prefs stores. Crash at
// require-time if someone adds a knob to DEFAULT_GLASSBOX_SETTINGS but forgets
// the spec/validator (or vice-versa) — no silent partial UI.
(function assertCoverage() {
  const stored = Object.keys(DEFAULT_GLASSBOX_SETTINGS).sort();
  const specKeys = buildGlassboxSettingsSpec().map((r) => r.key).sort();
  const validatorKeys = Object.keys(GLASSBOX_FIELD_VALIDATORS).sort();
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (!eq(stored, specKeys)) {
    throw new Error(`glassbox-settings-section: spec keys drift from prefs: spec=${specKeys} prefs=${stored}`);
  }
  if (!eq(stored, validatorKeys)) {
    throw new Error(`glassbox-settings-section: validator keys drift from prefs: validators=${validatorKeys} prefs=${stored}`);
  }
})();

module.exports = {
  buildGlassboxSettingsSpec,
  GLASSBOX_FIELD_VALIDATORS,
  validateGlassboxField,
  WHISPER_MODELS,
};
