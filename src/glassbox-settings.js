"use strict";

// Glass-box settings block (direction 4). Persisted in clawd-prefs.json under
// `glassbox` and surfaced through the normal settings flow (prefs → controller →
// store; store is the single source of truth — never bypass the controller).
//
// Empty-string / false fields mean "unset — fall back to the env var or built-in
// default", so adding this block changes nothing until the user (or settings UI)
// sets a value. API key/url are optional local overrides for the glass-box LLM;
// clawd-prefs.json is plaintext, so env vars remain the safer default.

const PERMISSION_MODES = Object.freeze(["", "bypassPermissions", "acceptEdits", "plan", "default"]);
const CONFIRM_MODES = Object.freeze(["agent-native", "always", "writes-only"]);

const DEFAULT_GLASSBOX_SETTINGS = Object.freeze({
  voiceEnabled: true,     // master TTS switch — ON by default (this build's core); toggle off to mute narration
  wakeWordEnabled: false, // always-on "hey, cc"
  hotkey: "",             // "" = CLAWD_GLASSBOX_HOTKEY / CommandOrControl+Space
  orchestratorModel: "",  // "" = CLAWD_ORCHESTRATOR_MODEL / qwen-plus
  orchestratorApiUrl: "", // "" = DASHSCOPE_CHAT_ENDPOINT / OpenAI-compatible default
  orchestratorApiKey: "", // "" = BAILIAN_API_KEY or DASHSCOPE_API_KEY; shared by chat/TTS/ASR
  ttsModel: "",           // "" = CLAWD_TTS_MODEL / qwen3-tts-flash
  ttsApiUrl: "",          // "" = DASHSCOPE_TTS_ENDPOINT / DashScope TTS default
  ttsVoice: "",           // "" = built-in default (Cherry)
  ttsApiKey: "",          // "" = DASHSCOPE_TTS_API_KEY / shared Bailian key
  ttsEventStart: true,    // fixed event narration toggles
  ttsEventFanout: true,
  ttsEventWaiting: true,
  ttsEventCompacting: true,
  ttsEventStuck: true,
  ttsEventError: true,
  ttsEventDone: true,
  ttsTextStart: "",
  ttsTextFanout: "",
  ttsTextWaiting: "",
  ttsTextCompacting: "",
  ttsTextLongRun: "",
  ttsTextError: "",
  ttsTextDone: "",
  ttsTextDrag: "",
  asrModel: "",           // "" = CLAWD_ASR_MODEL / local whisper fallback
  asrApiUrl: "",          // reserved remote ASR endpoint override
  asrApiKey: "",          // "" = DASHSCOPE_ASR_API_KEY / shared Bailian key
  whisperModel: "",       // "" = CLAWD_WHISPER_MODEL / base
  permissionMode: "",     // "" = CLAWD_DISPATCH_PERMISSION_MODE / bypassPermissions
  confirmMode: "agent-native", // agent-native | always | writes-only
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
    orchestratorApiUrl: _str(value.orchestratorApiUrl),
    orchestratorApiKey: _str(value.orchestratorApiKey),
    ttsModel: _str(value.ttsModel),
    ttsApiUrl: _str(value.ttsApiUrl),
    ttsVoice: _str(value.ttsVoice),
    ttsApiKey: _str(value.ttsApiKey),
    ttsEventStart: _bool(value.ttsEventStart, base.ttsEventStart),
    ttsEventFanout: _bool(value.ttsEventFanout, base.ttsEventFanout),
    ttsEventWaiting: _bool(value.ttsEventWaiting, base.ttsEventWaiting),
    ttsEventCompacting: _bool(value.ttsEventCompacting, base.ttsEventCompacting),
    ttsEventStuck: _bool(value.ttsEventStuck, base.ttsEventStuck),
    ttsEventError: _bool(value.ttsEventError, base.ttsEventError),
    ttsEventDone: _bool(value.ttsEventDone, base.ttsEventDone),
    ttsTextStart: _str(value.ttsTextStart),
    ttsTextFanout: _str(value.ttsTextFanout),
    ttsTextWaiting: _str(value.ttsTextWaiting),
    ttsTextCompacting: _str(value.ttsTextCompacting),
    ttsTextLongRun: _str(value.ttsTextLongRun),
    ttsTextError: _str(value.ttsTextError),
    ttsTextDone: _str(value.ttsTextDone),
    ttsTextDrag: _str(value.ttsTextDrag),
    asrModel: _str(value.asrModel),
    asrApiUrl: _str(value.asrApiUrl),
    asrApiKey: _str(value.asrApiKey),
    whisperModel: _str(value.whisperModel),
    permissionMode: PERMISSION_MODES.includes(value.permissionMode) ? value.permissionMode : base.permissionMode,
    confirmMode: CONFIRM_MODES.includes(value.confirmMode) ? value.confirmMode : base.confirmMode,
    systemPrompt: _str(value.systemPrompt),
  };
}

// Whether glass-box TTS narration should play. `CLAWD_GLASSBOX_VOICE=1` force-on
// (back-compat / test override); otherwise the `voiceEnabled` setting decides,
// defaulting on. The single choke point gating every spoken line.
function glassboxVoiceShouldSpeak({ env, glassbox } = {}) {
  if (env && env.CLAWD_GLASSBOX_VOICE === "1") return true;
  if (glassbox && typeof glassbox.voiceEnabled === "boolean") return glassbox.voiceEnabled;
  return DEFAULT_GLASSBOX_SETTINGS.voiceEnabled;
}

module.exports = { DEFAULT_GLASSBOX_SETTINGS, PERMISSION_MODES, CONFIRM_MODES, normalizeGlassboxSettings, glassboxVoiceShouldSpeak };
