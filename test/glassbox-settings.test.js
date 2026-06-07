"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { DEFAULT_GLASSBOX_SETTINGS, PERMISSION_MODES, normalizeGlassboxSettings } = require("../src/glassbox-settings");

describe("glassbox-settings defaults", () => {
  it("defaults every knob to an 'unset' value (false / empty = use env or built-in)", () => {
    assert.deepStrictEqual(DEFAULT_GLASSBOX_SETTINGS, {
      voiceEnabled: false,
      wakeWordEnabled: false,
      hotkey: "",
      orchestratorModel: "",
      ttsVoice: "",
      whisperModel: "",
      permissionMode: "",
      confirmMode: "always",
      systemPrompt: "",
    });
  });

  it("does not carry any secret/API-key field (prefs is plaintext)", () => {
    for (const k of Object.keys(DEFAULT_GLASSBOX_SETTINGS)) {
      assert.ok(!/(api.?key|access.?key|secret|token|password)/i.test(k), `unexpected secret-ish field: ${k}`);
    }
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
      ttsVoice: "Ethan",
      whisperModel: "small",
      permissionMode: "acceptEdits",
      confirmMode: "writes-only",
      systemPrompt: "你是新的编排脑",
    }, { ...DEFAULT_GLASSBOX_SETTINGS });
    assert.strictEqual(v.voiceEnabled, true);
    assert.strictEqual(v.wakeWordEnabled, true);
    assert.strictEqual(v.hotkey, "CommandOrControl+Shift+Space");
    assert.strictEqual(v.orchestratorModel, "qwen-max");
    assert.strictEqual(v.ttsVoice, "Ethan");
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
      ttsVoice: {},
      permissionMode: "auto",   // not a valid mode
      confirmMode: "nope",      // not a valid mode
      systemPrompt: 123,
    }, { ...DEFAULT_GLASSBOX_SETTINGS });
    assert.strictEqual(v.voiceEnabled, false);
    assert.strictEqual(v.wakeWordEnabled, false);
    assert.strictEqual(v.hotkey, "");
    assert.strictEqual(v.orchestratorModel, "");
    assert.strictEqual(v.ttsVoice, "");
    assert.strictEqual(v.permissionMode, "");
    assert.strictEqual(v.confirmMode, "always");
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
