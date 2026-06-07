"use strict";

// Glass-box settings block (direction 4). Persisted in clawd-prefs.json under
// `glassbox` and surfaced through the normal settings flow (prefs → controller →
// store; store is the single source of truth — never bypass the controller).
//
// Empty-string / false fields mean "unset — fall back to the env var or built-in
// default", so adding this block changes nothing until the user (or settings UI)
// sets a value. Secrets are intentionally absent: clawd-prefs.json is plaintext,
// so the Bailian API key stays in env (BAILIAN_API_KEY), per AGENTS.md.

const PERMISSION_MODES = Object.freeze(["", "bypassPermissions", "acceptEdits", "plan", "default"]);

const DEFAULT_GLASSBOX_SETTINGS = Object.freeze({
  voiceEnabled: false,    // master switch (mirrors CLAWD_GLASSBOX_VOICE)
  wakeWordEnabled: false, // always-on "hey, cc"
  hotkey: "",             // "" = CLAWD_GLASSBOX_HOTKEY / CommandOrControl+Space
  orchestratorModel: "",  // "" = CLAWD_ORCHESTRATOR_MODEL / qwen-plus
  ttsVoice: "",           // "" = built-in default (Cherry)
  whisperModel: "",       // "" = CLAWD_WHISPER_MODEL / base
  permissionMode: "",     // "" = CLAWD_DISPATCH_PERMISSION_MODE / bypassPermissions
  systemPrompt: "",       // "" = the externalized prompt file (glassbox-prompts)
});

function _str(v) {
  return typeof v === "string" ? v : "";
}

function _bool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}

function normalizeGlassboxSettings(value, defaultsValue) {
  const base = defaultsValue && typeof defaultsValue === "object" && !Array.isArray(defaultsValue)
    ? defaultsValue
    : DEFAULT_GLASSBOX_SETTINGS;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...base };
  return {
    voiceEnabled: _bool(value.voiceEnabled, base.voiceEnabled),
    wakeWordEnabled: _bool(value.wakeWordEnabled, base.wakeWordEnabled),
    hotkey: _str(value.hotkey),
    orchestratorModel: _str(value.orchestratorModel),
    ttsVoice: _str(value.ttsVoice),
    whisperModel: _str(value.whisperModel),
    permissionMode: PERMISSION_MODES.includes(value.permissionMode) ? value.permissionMode : base.permissionMode,
    systemPrompt: _str(value.systemPrompt),
  };
}

module.exports = { DEFAULT_GLASSBOX_SETTINGS, PERMISSION_MODES, normalizeGlassboxSettings };
