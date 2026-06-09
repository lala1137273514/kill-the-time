"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { DEFAULT_GLASSBOX_SETTINGS, PERMISSION_MODES, normalizeGlassboxSettings, glassboxVoiceShouldSpeak } = require("../src/glassbox-settings");

describe("glassbox-settings defaults", () => {
  it("defaults every knob to an 'unset' value (false / empty = use env or built-in)", () => {
    assert.deepStrictEqual(DEFAULT_GLASSBOX_SETTINGS, {
      voiceEnabled: true,
      wakeWordEnabled: false,
      hotkey: "",
      orchestratorModel: "",
      orchestratorApiUrl: "",
      orchestratorApiKey: "",
      ttsModel: "",
      ttsApiUrl: "",
      ttsVoice: "",
      ttsApiKey: "",
      ttsEventStart: true,
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
      asrModel: "",
      asrApiUrl: "",
      asrApiKey: "",
      whisperModel: "",
      permissionMode: "",
      confirmMode: "agent-native",
      systemPrompt: "",
    });
  });

  it("keeps the LLM API override unset by default (prefs is plaintext)", () => {
    assert.strictEqual(DEFAULT_GLASSBOX_SETTINGS.orchestratorApiUrl, "");
    assert.strictEqual(DEFAULT_GLASSBOX_SETTINGS.orchestratorApiKey, "");
  });
});

describe("glassbox-settings normalizeGlassboxSettings", () => {
  it("returns a fresh default copy for missing / non-object input", () => {
    for (const bad of [undefined, null, "nope", 42, []]) {
      assert.deepStrictEqual(normalizeGlassboxSettings(bad, { ...DEFAULT_GLASSBOX_SETTINGS }), DEFAULT_GLASSBOX_SETTINGS);
    }
  });

  it("keeps valid values verbatim", () => {
    const v = normalizeGlassboxSettings({
      voiceEnabled: true,
      wakeWordEnabled: true,
      hotkey: "CommandOrControl+Shift+Space",
      orchestratorModel: "qwen-max",
      orchestratorApiUrl: "https://example.test/v1/chat/completions",
      orchestratorApiKey: "sk-local",
      ttsModel: "qwen3-tts-flash",
      ttsApiUrl: "https://example.test/tts",
      ttsVoice: "Ethan",
      ttsApiKey: "sk-tts",
      ttsEventStart: false,
      ttsEventFanout: true,
      ttsEventWaiting: false,
      ttsEventCompacting: true,
      ttsEventStuck: false,
      ttsEventError: true,
      ttsEventDone: true,
      ttsTextStart: "开始",
      ttsTextFanout: "并行 {n}",
      ttsTextWaiting: "等待",
      ttsTextCompacting: "压缩",
      ttsTextLongRun: "久等",
      ttsTextError: "报错",
      ttsTextDone: "完成",
      ttsTextDrag: "拖拽",
      asrModel: "paraformer-realtime-v2",
      asrApiUrl: "https://example.test/asr",
      asrApiKey: "sk-asr",
      whisperModel: "small",
      permissionMode: "acceptEdits",
      confirmMode: "writes-only",
      systemPrompt: "你是新的编排脑",
    }, { ...DEFAULT_GLASSBOX_SETTINGS });
    assert.strictEqual(v.voiceEnabled, true);
    assert.strictEqual(v.wakeWordEnabled, true);
    assert.strictEqual(v.hotkey, "CommandOrControl+Shift+Space");
    assert.strictEqual(v.orchestratorModel, "qwen-max");
    assert.strictEqual(v.orchestratorApiUrl, "https://example.test/v1/chat/completions");
    assert.strictEqual(v.orchestratorApiKey, "sk-local");
    assert.strictEqual(v.ttsModel, "qwen3-tts-flash");
    assert.strictEqual(v.ttsApiUrl, "https://example.test/tts");
    assert.strictEqual(v.ttsVoice, "Ethan");
    assert.strictEqual(v.ttsApiKey, "sk-tts");
    assert.strictEqual(v.ttsEventStart, false);
    assert.strictEqual(v.ttsEventFanout, true);
    assert.strictEqual(v.ttsEventWaiting, false);
    assert.strictEqual(v.ttsEventCompacting, true);
    assert.strictEqual(v.ttsEventStuck, false);
    assert.strictEqual(v.ttsEventError, true);
    assert.strictEqual(v.ttsEventDone, true);
    assert.strictEqual(v.ttsTextStart, "开始");
    assert.strictEqual(v.ttsTextFanout, "并行 {n}");
    assert.strictEqual(v.ttsTextWaiting, "等待");
    assert.strictEqual(v.ttsTextCompacting, "压缩");
    assert.strictEqual(v.ttsTextLongRun, "久等");
    assert.strictEqual(v.ttsTextError, "报错");
    assert.strictEqual(v.ttsTextDone, "完成");
    assert.strictEqual(v.ttsTextDrag, "拖拽");
    assert.strictEqual(v.asrModel, "paraformer-realtime-v2");
    assert.strictEqual(v.asrApiUrl, "https://example.test/asr");
    assert.strictEqual(v.asrApiKey, "sk-asr");
    assert.strictEqual(v.whisperModel, "small");
    assert.strictEqual(v.permissionMode, "acceptEdits");
    assert.strictEqual(v.confirmMode, "writes-only");
    assert.strictEqual(v.systemPrompt, "你是新的编排脑");
  });

  it("drops bad types back to unset defaults", () => {
    const v = normalizeGlassboxSettings({
      voiceEnabled: "yes",
      wakeWordEnabled: 1,
      hotkey: 42,
      orchestratorModel: null,
      orchestratorApiUrl: {},
      orchestratorApiKey: [],
      ttsModel: null,
      ttsApiUrl: 7,
      ttsVoice: {},
      ttsApiKey: 123,
      ttsEventStart: "no",
      ttsEventFanout: 1,
      ttsEventWaiting: null,
      ttsEventCompacting: "yes",
      ttsEventStuck: null,
      ttsEventError: 1,
      ttsEventDone: "yes",
      ttsTextStart: {},
      ttsTextFanout: [],
      ttsTextWaiting: false,
      ttsTextCompacting: 1,
      ttsTextLongRun: null,
      ttsTextError: 2,
      ttsTextDone: [],
      ttsTextDrag: {},
      asrModel: false,
      asrApiUrl: [],
      asrApiKey: {},
      permissionMode: "auto",   // not a valid mode
      confirmMode: "nope",      // not a valid mode
      systemPrompt: 123,
    }, { ...DEFAULT_GLASSBOX_SETTINGS });
    assert.strictEqual(v.voiceEnabled, true); // invalid "yes" → base default (now on)
    assert.strictEqual(v.wakeWordEnabled, false);
    assert.strictEqual(v.hotkey, "");
    assert.strictEqual(v.orchestratorModel, "");
    assert.strictEqual(v.orchestratorApiUrl, "");
    assert.strictEqual(v.orchestratorApiKey, "");
    assert.strictEqual(v.ttsModel, "");
    assert.strictEqual(v.ttsApiUrl, "");
    assert.strictEqual(v.ttsVoice, "");
    assert.strictEqual(v.ttsApiKey, "");
    assert.strictEqual(v.ttsEventStart, true);
    assert.strictEqual(v.ttsEventFanout, true);
    assert.strictEqual(v.ttsEventWaiting, true);
    assert.strictEqual(v.ttsEventCompacting, true);
    assert.strictEqual(v.ttsEventStuck, true);
    assert.strictEqual(v.ttsEventError, true);
    assert.strictEqual(v.ttsEventDone, true);
    assert.strictEqual(v.ttsTextStart, "");
    assert.strictEqual(v.ttsTextFanout, "");
    assert.strictEqual(v.ttsTextWaiting, "");
    assert.strictEqual(v.ttsTextCompacting, "");
    assert.strictEqual(v.ttsTextLongRun, "");
    assert.strictEqual(v.ttsTextError, "");
    assert.strictEqual(v.ttsTextDone, "");
    assert.strictEqual(v.ttsTextDrag, "");
    assert.strictEqual(v.asrModel, "");
    assert.strictEqual(v.asrApiUrl, "");
    assert.strictEqual(v.asrApiKey, "");
    assert.strictEqual(v.permissionMode, "");
    assert.strictEqual(v.confirmMode, "agent-native");
    assert.strictEqual(v.systemPrompt, "");
  });

  it("accepts every declared permission mode (including empty = unset)", () => {
    for (const m of PERMISSION_MODES) {
      assert.strictEqual(normalizeGlassboxSettings({ permissionMode: m }, { ...DEFAULT_GLASSBOX_SETTINGS }).permissionMode, m);
    }
    assert.ok(PERMISSION_MODES.includes("bypassPermissions"));
    assert.ok(PERMISSION_MODES.includes(""));
  });
});

describe("glassboxVoiceShouldSpeak", () => {
  it("is on by default (no env override, no setting)", () => {
    assert.strictEqual(glassboxVoiceShouldSpeak({ env: {}, glassbox: undefined }), true);
    assert.strictEqual(glassboxVoiceShouldSpeak({ env: {}, glassbox: {} }), true);
  });

  it("honors the voiceEnabled setting", () => {
    assert.strictEqual(glassboxVoiceShouldSpeak({ env: {}, glassbox: { voiceEnabled: false } }), false);
    assert.strictEqual(glassboxVoiceShouldSpeak({ env: {}, glassbox: { voiceEnabled: true } }), true);
  });

  it("CLAWD_GLASSBOX_VOICE=1 forces voice on even when the setting is off", () => {
    assert.strictEqual(glassboxVoiceShouldSpeak({ env: { CLAWD_GLASSBOX_VOICE: "1" }, glassbox: { voiceEnabled: false } }), true);
  });
});
