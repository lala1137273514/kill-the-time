"use strict";

// TDD for glassbox-config: the pure resolver that turns a normalized glassbox
// settings block + an env map into concrete, usable values, applying the
// precedence settings(non-empty) > env > built-in default. No electron, no I/O.

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { resolveGlassboxConfig, BUILTIN_DEFAULTS } = require("../src/glassbox-config");

// Built-in defaults must mirror the existing use sites so removing every
// settings/env value reproduces today's behavior exactly.
describe("glassbox-config built-in defaults", () => {
  it("matches the values hardwired at each use site", () => {
    assert.deepStrictEqual(BUILTIN_DEFAULTS, {
      hotkey: "CommandOrControl+Space",
      orchestratorModel: "qwen-plus",
      orchestratorApiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      orchestratorApiKey: "",
      ttsModel: "qwen3-tts-flash",
      ttsApiUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      ttsVoice: "Cherry",
      ttsApiKey: "",
      asrModel: "small",
      asrApiUrl: "",
      asrApiKey: "",
      whisperModel: "small",
      permissionMode: "default",
    });
  });

  it("falls back to built-in defaults when settings AND env are empty", () => {
    const cfg = resolveGlassboxConfig({}, {});
    assert.deepStrictEqual(cfg, { ...BUILTIN_DEFAULTS });
  });

  it("falls back to built-in defaults for missing / non-object settings & env", () => {
    for (const bad of [undefined, null, "nope", 42, []]) {
      assert.deepStrictEqual(resolveGlassboxConfig(bad, bad), { ...BUILTIN_DEFAULTS });
    }
  });
});

describe("glassbox-config env layer", () => {
  it("reads each env var when settings are empty", () => {
    const env = {
      CLAWD_GLASSBOX_HOTKEY: "CommandOrControl+Shift+Space",
      CLAWD_ORCHESTRATOR_MODEL: "qwen-turbo",
      DASHSCOPE_CHAT_ENDPOINT: "https://llm.example/v1/chat/completions",
      BAILIAN_API_KEY: "sk-bailian",
      CLAWD_TTS_MODEL: "qwen3-tts-flash",
      DASHSCOPE_TTS_ENDPOINT: "https://tts.example/generation",
      DASHSCOPE_TTS_API_KEY: "sk-tts",
      CLAWD_ASR_MODEL: "paraformer",
      DASHSCOPE_ASR_ENDPOINT: "https://asr.example/transcribe",
      DASHSCOPE_ASR_API_KEY: "sk-asr",
      CLAWD_WHISPER_MODEL: "base",
      CLAWD_DISPATCH_PERMISSION_MODE: "acceptEdits",
    };
    const cfg = resolveGlassboxConfig({}, env);
    assert.strictEqual(cfg.hotkey, "CommandOrControl+Shift+Space");
    assert.strictEqual(cfg.orchestratorModel, "qwen-turbo");
    assert.strictEqual(cfg.orchestratorApiUrl, "https://llm.example/v1/chat/completions");
    assert.strictEqual(cfg.orchestratorApiKey, "sk-bailian");
    assert.strictEqual(cfg.ttsModel, "qwen3-tts-flash");
    assert.strictEqual(cfg.ttsApiUrl, "https://tts.example/generation");
    assert.strictEqual(cfg.ttsApiKey, "sk-tts");
    assert.strictEqual(cfg.asrModel, "paraformer");
    assert.strictEqual(cfg.asrApiUrl, "https://asr.example/transcribe");
    assert.strictEqual(cfg.asrApiKey, "sk-asr");
    assert.strictEqual(cfg.whisperModel, "base");
    assert.strictEqual(cfg.permissionMode, "acceptEdits");
    // ttsVoice has no env var; it stays on the built-in default.
    assert.strictEqual(cfg.ttsVoice, "Cherry");
  });
});

describe("glassbox-config precedence settings > env > default", () => {
  it("non-empty settings win over env and default", () => {
    const settings = {
      hotkey: "Alt+Space",
      orchestratorModel: "qwen-max",
      orchestratorApiUrl: "https://settings.example/v1/chat/completions",
      orchestratorApiKey: "sk-settings",
      ttsModel: "qwen3-tts-flash",
      ttsApiUrl: "https://settings.example/tts",
      ttsVoice: "Ethan",
      ttsApiKey: "sk-settings-tts",
      asrModel: "paraformer",
      asrApiUrl: "https://settings.example/asr",
      asrApiKey: "sk-settings-asr",
      whisperModel: "medium",
      permissionMode: "plan",
    };
    const env = {
      CLAWD_GLASSBOX_HOTKEY: "CommandOrControl+Shift+Space",
      CLAWD_ORCHESTRATOR_MODEL: "qwen-turbo",
      DASHSCOPE_CHAT_ENDPOINT: "https://env.example/v1/chat/completions",
      DASHSCOPE_API_KEY: "sk-env",
      CLAWD_WHISPER_MODEL: "base",
      CLAWD_DISPATCH_PERMISSION_MODE: "acceptEdits",
    };
    assert.deepStrictEqual(resolveGlassboxConfig(settings, env), {
      hotkey: "Alt+Space",
      orchestratorModel: "qwen-max",
      orchestratorApiUrl: "https://settings.example/v1/chat/completions",
      orchestratorApiKey: "sk-settings",
      ttsModel: "qwen3-tts-flash",
      ttsApiUrl: "https://settings.example/tts",
      ttsVoice: "Ethan",
      ttsApiKey: "sk-settings-tts",
      asrModel: "paraformer",
      asrApiUrl: "https://settings.example/asr",
      asrApiKey: "sk-settings-asr",
      whisperModel: "medium",
      permissionMode: "plan",
    });
  });

  it("settings on some knobs, env on the rest — each resolves independently", () => {
    const settings = { orchestratorModel: "qwen-max", ttsVoice: "Ethan" };
    const env = {
      CLAWD_GLASSBOX_HOTKEY: "Alt+Q",
      CLAWD_ORCHESTRATOR_MODEL: "qwen-turbo", // overridden by settings
      DASHSCOPE_CHAT_ENDPOINT: "https://env.example/v1/chat/completions",
      DASHSCOPE_API_KEY: "sk-env",
      CLAWD_DISPATCH_PERMISSION_MODE: "plan",
    };
    assert.deepStrictEqual(resolveGlassboxConfig(settings, env), {
      hotkey: "Alt+Q",                 // env
      orchestratorModel: "qwen-max",   // settings beats env
      orchestratorApiUrl: "https://env.example/v1/chat/completions",
      orchestratorApiKey: "sk-env",
      ttsModel: "qwen3-tts-flash",
      ttsApiUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      ttsApiKey: "",
      ttsVoice: "Ethan",               // settings (no env exists)
      asrModel: "small",
      asrApiUrl: "",
      asrApiKey: "",
      whisperModel: "small",           // built-in default
      permissionMode: "plan",          // env
    });
  });
});

describe("glassbox-config bad / empty values", () => {
  it("treats empty-string and whitespace-only settings as unset (fall through)", () => {
    const settings = { hotkey: "", orchestratorModel: "   ", orchestratorApiUrl: "", orchestratorApiKey: " ", ttsModel: "", ttsApiUrl: " ", ttsVoice: "\t", ttsApiKey: "", asrModel: "", asrApiUrl: "", asrApiKey: "", whisperModel: "", permissionMode: "" };
    const env = { CLAWD_GLASSBOX_HOTKEY: "Alt+Z", CLAWD_ORCHESTRATOR_MODEL: "qwen-turbo", DASHSCOPE_API_KEY: "sk-env" };
    const cfg = resolveGlassboxConfig(settings, env);
    assert.strictEqual(cfg.hotkey, "Alt+Z");            // env, settings was empty
    assert.strictEqual(cfg.orchestratorModel, "qwen-turbo"); // env, settings was whitespace
    assert.strictEqual(cfg.orchestratorApiKey, "sk-env");
    assert.strictEqual(cfg.ttsModel, "qwen3-tts-flash");
    assert.strictEqual(cfg.ttsApiUrl, "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
    assert.strictEqual(cfg.ttsApiKey, "");
    assert.strictEqual(cfg.ttsVoice, "Cherry");          // default, whitespace settings + no env
    assert.strictEqual(cfg.asrModel, "small");
    assert.strictEqual(cfg.asrApiUrl, "");
    assert.strictEqual(cfg.asrApiKey, "");
    assert.strictEqual(cfg.whisperModel, "small");       // default
    assert.strictEqual(cfg.permissionMode, "default"); // default
  });

  it("ignores non-string settings values and empty/whitespace env (fall through)", () => {
    const settings = { hotkey: 42, orchestratorModel: null, orchestratorApiUrl: {}, orchestratorApiKey: [], ttsModel: null, ttsApiUrl: 7, ttsVoice: {}, ttsApiKey: 1, asrModel: false, asrApiUrl: [], asrApiKey: {}, whisperModel: [], permissionMode: true };
    const env = { CLAWD_GLASSBOX_HOTKEY: "   ", CLAWD_DISPATCH_PERMISSION_MODE: "" };
    assert.deepStrictEqual(resolveGlassboxConfig(settings, env), { ...BUILTIN_DEFAULTS });
  });

  it("trims a usable settings value before returning it (concrete, ready to use)", () => {
    const cfg = resolveGlassboxConfig({ ttsVoice: "  Serena  ", hotkey: "  Alt+Space  " }, {});
    assert.strictEqual(cfg.ttsVoice, "Serena");
    assert.strictEqual(cfg.hotkey, "Alt+Space");
  });

  it("trims a usable env value before returning it", () => {
    const cfg = resolveGlassboxConfig({}, { CLAWD_ORCHESTRATOR_MODEL: "  qwen-turbo  " });
    assert.strictEqual(cfg.orchestratorModel, "qwen-turbo");
  });
});

describe("glassbox-config defaults to process.env when no env passed", () => {
  it("uses process.env as the env source when the 2nd arg is omitted", () => {
    const saved = process.env.CLAWD_ORCHESTRATOR_MODEL;
    try {
      process.env.CLAWD_ORCHESTRATOR_MODEL = "qwen-from-process-env";
      const cfg = resolveGlassboxConfig({});
      assert.strictEqual(cfg.orchestratorModel, "qwen-from-process-env");
    } finally {
      if (saved === undefined) delete process.env.CLAWD_ORCHESTRATOR_MODEL;
      else process.env.CLAWD_ORCHESTRATOR_MODEL = saved;
    }
  });
});
