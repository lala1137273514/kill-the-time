"use strict";

// Glass-box config resolver (direction 4). PURE: given a normalized glassbox
// settings block (from the store, see glassbox-settings.js) and an env map,
// produce the concrete, ready-to-use value for every knob.
//
// Precedence per knob: settings(non-empty) > env > built-in default. "Empty"
// means an unset settings field — empty string, whitespace, or a non-string —
// which falls through to env, then to the hardwired default. This mirrors the
// "" / false convention in DEFAULT_GLASSBOX_SETTINGS.
//
// The built-in defaults below are the SAME literals each use site hardcodes
// today (glassbox-tts DEFAULT_VOICE, glassbox-asr CLAWD_WHISPER_MODEL fallback,
// glassbox-dispatch CLAWD_DISPATCH_PERMISSION_MODE fallback, glassbox-orchestrator
// DEFAULT_MODEL, main.js CLAWD_GLASSBOX_HOTKEY fallback) — so with no settings
// and no env, the resolver reproduces today's behavior exactly.
//
// No electron, no I/O: env is injected (defaults to process.env) so this is
// unit-testable under plain node. Let it crash on programmer error; there are no
// silent fallbacks beyond the documented precedence chain.

const BUILTIN_DEFAULTS = Object.freeze({
  hotkey: "CommandOrControl+Space",     // main.js: CLAWD_GLASSBOX_HOTKEY fallback
  orchestratorModel: "qwen-plus",       // glassbox-orchestrator: DEFAULT_MODEL
  orchestratorApiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  orchestratorApiKey: "",
  ttsModel: "qwen3-tts-flash",          // glassbox-tts: DEFAULT_MODEL
  ttsApiUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
  ttsVoice: "Cherry",                   // glassbox-tts: DEFAULT_VOICE
  ttsApiKey: "",
  asrModel: "small",                    // glassbox-asr local fallback
  asrApiUrl: "",
  asrApiKey: "",
  whisperModel: "small",                // glassbox-asr: CLAWD_WHISPER_MODEL fallback
  permissionMode: "default",            // glassbox-dispatch: native/default permission flow
});

// Which env var (if any) backs each knob, and its built-in default. ttsVoice has
// no env var — it goes settings -> built-in default.
const KNOBS = Object.freeze([
  { key: "hotkey", env: "CLAWD_GLASSBOX_HOTKEY" },
  { key: "orchestratorModel", env: "CLAWD_ORCHESTRATOR_MODEL" },
  { key: "orchestratorApiUrl", env: "DASHSCOPE_CHAT_ENDPOINT" },
  { key: "orchestratorApiKey", env: ["BAILIAN_API_KEY", "DASHSCOPE_API_KEY"] },
  { key: "ttsModel", env: "CLAWD_TTS_MODEL" },
  { key: "ttsApiUrl", env: "DASHSCOPE_TTS_ENDPOINT" },
  { key: "ttsVoice", env: null },
  { key: "ttsApiKey", env: ["DASHSCOPE_TTS_API_KEY", "BAILIAN_TTS_API_KEY"] },
  { key: "asrModel", env: "CLAWD_ASR_MODEL" },
  { key: "asrApiUrl", env: "DASHSCOPE_ASR_ENDPOINT" },
  { key: "asrApiKey", env: ["DASHSCOPE_ASR_API_KEY", "BAILIAN_ASR_API_KEY"] },
  { key: "whisperModel", env: "CLAWD_WHISPER_MODEL" },
  { key: "permissionMode", env: "CLAWD_DISPATCH_PERMISSION_MODE" },
]);

// A usable value is a non-empty string once trimmed; anything else is "unset".
function usable(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

// resolveGlassboxConfig(settingsGlassbox, env) ->
//   { hotkey, orchestratorModel, orchestratorApiUrl, orchestratorApiKey,
//     ttsModel, ttsApiUrl, ttsVoice, asrModel, asrApiUrl, whisperModel, permissionMode }
// settingsGlassbox: a glassbox settings block (or anything; non-objects ignored).
// env: an env map (defaults to process.env); non-objects ignored.
function resolveGlassboxConfig(settingsGlassbox, env = process.env) {
  const s = settingsGlassbox && typeof settingsGlassbox === "object" && !Array.isArray(settingsGlassbox)
    ? settingsGlassbox
    : {};
  const e = env && typeof env === "object" && !Array.isArray(env) ? env : {};

  const out = {};
  for (const { key, env: envName } of KNOBS) {
    const fromSettings = usable(s[key]);
    if (fromSettings) { out[key] = fromSettings; continue; }
    const envNames = Array.isArray(envName) ? envName : (envName ? [envName] : []);
    const fromEnv = envNames.map((name) => usable(e[name])).find(Boolean) || "";
    if (fromEnv) { out[key] = fromEnv; continue; }
    out[key] = BUILTIN_DEFAULTS[key];
  }
  return out;
}

module.exports = { BUILTIN_DEFAULTS, resolveGlassboxConfig };
