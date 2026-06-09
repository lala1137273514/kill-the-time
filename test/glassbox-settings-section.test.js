"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildGlassboxSettingsSpec,
  GLASSBOX_FIELD_VALIDATORS,
  validateGlassboxField,
} = require("../src/glassbox-settings-section");
const { DEFAULT_GLASSBOX_SETTINGS, PERMISSION_MODES, CONFIRM_MODES } = require("../src/glassbox-settings");

describe("buildGlassboxSettingsSpec — shape", () => {
  it("returns a non-empty array of row specs", () => {
    const spec = buildGlassboxSettingsSpec();
    assert.ok(Array.isArray(spec), "spec must be an array");
    assert.ok(spec.length > 0, "spec must not be empty");
  });

  it("covers exactly the glassbox knobs, in a stable order", () => {
    const keys = buildGlassboxSettingsSpec().map((r) => r.key);
    assert.deepStrictEqual(keys, [
      "voiceEnabled",
      "wakeWordEnabled",
      "confirmMode",
      "permissionMode",
      "orchestratorModel",
      "orchestratorApiUrl",
      "orchestratorApiKey",
      "ttsModel",
      "ttsApiUrl",
      "ttsVoice",
      "ttsApiKey",
      "ttsEventStart",
      "ttsEventFanout",
      "ttsEventWaiting",
      "ttsEventCompacting",
      "ttsEventStuck",
      "ttsEventError",
      "ttsEventDone",
      "ttsTextStart",
      "ttsTextFanout",
      "ttsTextWaiting",
      "ttsTextCompacting",
      "ttsTextLongRun",
      "ttsTextError",
      "ttsTextDone",
      "ttsTextDrag",
      "asrModel",
      "asrApiUrl",
      "asrApiKey",
      "whisperModel",
      "hotkey",
      "systemPrompt",
    ]);
  });

  it("only references keys that exist in DEFAULT_GLASSBOX_SETTINGS", () => {
    const allowed = new Set(Object.keys(DEFAULT_GLASSBOX_SETTINGS));
    for (const row of buildGlassboxSettingsSpec()) {
      assert.ok(allowed.has(row.key), `unknown glassbox key in spec: ${row.key}`);
    }
  });

  it("surfaces local API key overrides as password fields", () => {
    for (const key of ["orchestratorApiKey", "ttsApiKey", "asrApiKey"]) {
      const row = buildGlassboxSettingsSpec().find((r) => r.key === key);
      assert.strictEqual(row.type, "password", `${key} should be password`);
    }
  });

  it("returns a fresh array each call (pure, no shared mutable state)", () => {
    const a = buildGlassboxSettingsSpec();
    const b = buildGlassboxSettingsSpec();
    assert.notStrictEqual(a, b, "must not return the same array instance");
    a[0].label = "MUTATED";
    assert.notStrictEqual(b[0].label, "MUTATED", "rows must not be shared between calls");
  });
});

describe("buildGlassboxSettingsSpec — per-row contracts", () => {
  function rowFor(key) {
    return buildGlassboxSettingsSpec().find((r) => r.key === key);
  }

  it("every row has key, label (zh, non-empty string) and a valid type", () => {
    const validTypes = new Set(["toggle", "select", "text", "password"]);
    for (const row of buildGlassboxSettingsSpec()) {
      assert.strictEqual(typeof row.key, "string");
      assert.ok(row.key.length > 0);
      assert.strictEqual(typeof row.label, "string");
      assert.ok(row.label.trim().length > 0, `empty label for ${row.key}`);
      // zh labels must contain CJK characters (design language is Chinese)
      assert.ok(/[一-鿿]/.test(row.label), `label for ${row.key} is not Chinese: ${row.label}`);
      assert.ok(validTypes.has(row.type), `bad type for ${row.key}: ${row.type}`);
    }
  });

  it("boolean knobs render as toggles", () => {
    assert.strictEqual(rowFor("voiceEnabled").type, "toggle");
    assert.strictEqual(rowFor("wakeWordEnabled").type, "toggle");
    assert.strictEqual(rowFor("ttsEventStart").type, "toggle");
    assert.strictEqual(rowFor("ttsEventFanout").type, "toggle");
    assert.strictEqual(rowFor("ttsEventWaiting").type, "toggle");
    assert.strictEqual(rowFor("ttsEventCompacting").type, "toggle");
    assert.strictEqual(rowFor("ttsEventStuck").type, "toggle");
    assert.strictEqual(rowFor("ttsEventError").type, "toggle");
    assert.strictEqual(rowFor("ttsEventDone").type, "toggle");
  });

  it("free-text knobs render as text", () => {
    for (const key of ["orchestratorModel", "orchestratorApiUrl", "ttsModel", "ttsApiUrl", "ttsVoice", "ttsTextStart", "ttsTextFanout", "ttsTextWaiting", "ttsTextCompacting", "ttsTextLongRun", "ttsTextError", "ttsTextDone", "ttsTextDrag", "asrModel", "asrApiUrl", "hotkey", "systemPrompt"]) {
      assert.strictEqual(rowFor(key).type, "text", `${key} should be text`);
    }
  });

  it("confirmMode is a select whose option values match CONFIRM_MODES exactly", () => {
    const row = rowFor("confirmMode");
    assert.strictEqual(row.type, "select");
    assert.ok(Array.isArray(row.options));
    assert.deepStrictEqual(row.options.map((o) => o.value), [...CONFIRM_MODES]);
    for (const opt of row.options) {
      assert.strictEqual(typeof opt.label, "string");
      assert.ok(opt.label.trim().length > 0);
    }
  });

  it("permissionMode is a select whose option values match PERMISSION_MODES exactly (incl. '' = unset)", () => {
    const row = rowFor("permissionMode");
    assert.strictEqual(row.type, "select");
    assert.ok(Array.isArray(row.options));
    assert.deepStrictEqual(row.options.map((o) => o.value), [...PERMISSION_MODES]);
    const unset = row.options.find((o) => o.value === "");
    assert.ok(unset, "permissionMode must offer an explicit '' (unset) option");
    assert.ok(/[一-鿿]/.test(unset.label), "unset option label should be Chinese");
  });

  it("whisperModel is a select with non-empty option values (plus an unset choice)", () => {
    const row = rowFor("whisperModel");
    assert.strictEqual(row.type, "select");
    assert.ok(Array.isArray(row.options) && row.options.length > 1);
    assert.ok(row.options.some((o) => o.value === ""), "whisperModel must offer an unset choice");
    assert.ok(row.options.some((o) => o.value === "base"), "whisperModel must offer 'base'");
  });

  it("text rows do not carry an options array", () => {
    for (const row of buildGlassboxSettingsSpec()) {
      if (row.type === "text" || row.type === "password" || row.type === "toggle") {
        assert.strictEqual(row.options, undefined, `${row.key} (${row.type}) must not have options`);
      }
    }
  });

  it("select rows always carry an options array", () => {
    for (const row of buildGlassboxSettingsSpec()) {
      if (row.type === "select") {
        assert.ok(Array.isArray(row.options) && row.options.length > 0, `${row.key} select missing options`);
      }
    }
  });
});

describe("GLASSBOX_FIELD_VALIDATORS — one validator per knob", () => {
  it("has exactly one validator per glassbox knob", () => {
    assert.deepStrictEqual(
      Object.keys(GLASSBOX_FIELD_VALIDATORS).sort(),
      Object.keys(DEFAULT_GLASSBOX_SETTINGS).sort()
    );
  });

  it("each validator is a pure function returning { status }", () => {
    for (const [field, fn] of Object.entries(GLASSBOX_FIELD_VALIDATORS)) {
      assert.strictEqual(typeof fn, "function", `${field} validator must be a function`);
      const r = fn(DEFAULT_GLASSBOX_SETTINGS[field]);
      assert.ok(r && typeof r.status === "string", `${field} validator must return { status }`);
    }
  });
});

describe("validateGlassboxField — strict, let-it-crash (no silent fallback)", () => {
  it("accepts every default value", () => {
    for (const [field, value] of Object.entries(DEFAULT_GLASSBOX_SETTINGS)) {
      assert.strictEqual(validateGlassboxField(field, value).status, "ok", `default rejected for ${field}`);
    }
  });

  it("rejects unknown fields rather than silently ignoring them", () => {
    const r = validateGlassboxField("notAField", true);
    assert.strictEqual(r.status, "error");
  });

  it("boolean knobs reject non-boolean input", () => {
    assert.strictEqual(validateGlassboxField("voiceEnabled", "yes").status, "error");
    assert.strictEqual(validateGlassboxField("wakeWordEnabled", 1).status, "error");
    assert.strictEqual(validateGlassboxField("voiceEnabled", true).status, "ok");
    assert.strictEqual(validateGlassboxField("ttsEventStart", false).status, "ok");
    assert.strictEqual(validateGlassboxField("ttsEventWaiting", false).status, "ok");
    assert.strictEqual(validateGlassboxField("ttsEventCompacting", false).status, "ok");
    assert.strictEqual(validateGlassboxField("ttsEventError", false).status, "ok");
    assert.strictEqual(validateGlassboxField("ttsEventDone", "yes").status, "error");
  });

  it("string knobs reject non-string input but accept empty string (= unset)", () => {
    for (const key of ["hotkey", "orchestratorModel", "orchestratorApiUrl", "orchestratorApiKey", "ttsModel", "ttsApiUrl", "ttsVoice", "ttsApiKey", "ttsTextStart", "ttsTextFanout", "ttsTextWaiting", "ttsTextCompacting", "ttsTextLongRun", "ttsTextError", "ttsTextDone", "ttsTextDrag", "asrModel", "asrApiUrl", "asrApiKey", "systemPrompt"]) {
      assert.strictEqual(validateGlassboxField(key, 42).status, "error", `${key} should reject number`);
      assert.strictEqual(validateGlassboxField(key, "").status, "ok", `${key} should accept '' as unset`);
      assert.strictEqual(validateGlassboxField(key, "x").status, "ok", `${key} should accept a string`);
    }
  });

  it("confirmMode accepts only declared modes", () => {
    for (const m of CONFIRM_MODES) assert.strictEqual(validateGlassboxField("confirmMode", m).status, "ok");
    assert.strictEqual(validateGlassboxField("confirmMode", "nope").status, "error");
    assert.strictEqual(validateGlassboxField("confirmMode", "").status, "error"); // no implicit unset here
  });

  it("permissionMode accepts only declared modes (including '' = unset)", () => {
    for (const m of PERMISSION_MODES) assert.strictEqual(validateGlassboxField("permissionMode", m).status, "ok");
    assert.strictEqual(validateGlassboxField("permissionMode", "auto").status, "error");
  });

  it("whisperModel accepts the spec's offered values and rejects junk", () => {
    const offered = buildGlassboxSettingsSpec().find((r) => r.key === "whisperModel").options.map((o) => o.value);
    for (const v of offered) assert.strictEqual(validateGlassboxField("whisperModel", v).status, "ok", `rejected ${v}`);
    assert.strictEqual(validateGlassboxField("whisperModel", 7).status, "error");
  });
});
