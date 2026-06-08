"use strict";

// Glass-box voice settings tab (direction 4 UI). Self-contained so it loads as a
// plain <script> in the settings window (no require/contextIsolation issues): it
// inlines the row spec and writes each nested glassbox.* field through the generic
// settings command `setGlassboxField` (validated server-side in settings-actions).
//
// buildSwitchRow (settings-ui-core) is wired to TOP-LEVEL prefs via
// settingsAPI.update(key, ...). The glassbox fields are nested under glassbox.*
// and saved via settingsAPI.command("setGlassboxField", ...), so we build the
// row markup with the same native classes (.row / .switch / .segmented) but wire
// our own change handlers.
(function initSettingsTabGlassbox(root) {
  let helpers = null;
  let state = null;

  // Mirrors glassbox-settings-section.buildGlassboxSettingsSpec(); the server
  // validates every write, so a stale label here can never corrupt prefs.
  // Labels/options resolve through helpers.t(...) so the tab follows the UI language.
  const SPEC = [
    { key: "voiceEnabled", labelKey: "glassboxVoiceEnabled", descKey: "glassboxVoiceEnabledDesc", type: "toggle" },
    { key: "wakeWordEnabled", labelKey: "glassboxWakeWord", descKey: "glassboxWakeWordDesc", type: "toggle" },
    {
      key: "confirmMode", labelKey: "glassboxConfirmMode", descKey: "glassboxConfirmModeDesc", type: "select",
      options: [["always", "glassboxConfirmAlways"], ["writes-only", "glassboxConfirmWritesOnly"]],
    },
    {
      key: "permissionMode", labelKey: "glassboxPermissionMode", descKey: "glassboxPermissionModeDesc", type: "select",
      options: [
        ["", "glassboxPermissionFollowEnv"],
        ["bypassPermissions", "glassboxPermissionBypass"],
        ["acceptEdits", "glassboxPermissionAcceptEdits"],
        ["plan", "glassboxPermissionPlan"],
        ["default", "glassboxPermissionDefault"],
      ],
    },
    { key: "orchestratorModel", labelKey: "glassboxOrchModel", descKey: "glassboxOrchModelDesc", type: "text", placeholderKey: "glassboxOrchModelPlaceholder" },
    { key: "ttsVoice", labelKey: "glassboxTtsVoice", descKey: "glassboxTtsVoiceDesc", type: "text", placeholderKey: "glassboxTtsVoicePlaceholder" },
    {
      key: "whisperModel", labelKey: "glassboxWhisperModel", descKey: "glassboxWhisperModelDesc", type: "select",
      options: [
        ["", "glassboxWhisperFollowEnv"],
        ["tiny", "glassboxWhisperTiny"],
        ["base", "glassboxWhisperBase"],
        ["small", "glassboxWhisperSmall"],
        ["medium", "glassboxWhisperMedium"],
        ["large", "glassboxWhisperLarge"],
      ],
    },
    { key: "hotkey", labelKey: "glassboxHotkey", descKey: "glassboxHotkeyDesc", type: "text", placeholderKey: "glassboxHotkeyPlaceholder" },
    { key: "systemPrompt", labelKey: "glassboxSystemPrompt", descKey: "glassboxSystemPromptDesc", type: "textarea", placeholderKey: "glassboxSystemPromptPlaceholder" },
  ];

  function t(key) {
    return helpers.t(key);
  }

  function gbValue(key) {
    const snap = (state && state.snapshot) || {};
    const gb = (snap.glassbox && typeof snap.glassbox === "object") ? snap.glassbox : {};
    return gb[key];
  }

  function save(field, value) {
    if (!window.settingsAPI || typeof window.settingsAPI.command !== "function") return;
    Promise.resolve(window.settingsAPI.command("setGlassboxField", { field, value })).catch(() => {});
  }

  function buildRowShell(spec) {
    const row = document.createElement("div");
    row.className = "row";
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t(spec.labelKey);
    text.appendChild(label);
    if (spec.descKey) {
      const desc = document.createElement("span");
      desc.className = "row-desc";
      desc.textContent = t(spec.descKey);
      text.appendChild(desc);
    }
    row.appendChild(text);
    const ctrl = document.createElement("div");
    ctrl.className = "row-control";
    row.appendChild(ctrl);
    return { row, ctrl };
  }

  function buildToggle(spec, ctrl) {
    const sw = document.createElement("div");
    sw.className = "switch";
    sw.setAttribute("role", "switch");
    sw.tabIndex = 0;
    const on = gbValue(spec.key) === true;
    sw.classList.toggle("on", on);
    sw.setAttribute("aria-checked", on ? "true" : "false");
    const toggle = () => {
      const next = !sw.classList.contains("on");
      sw.classList.toggle("on", next);
      sw.setAttribute("aria-checked", next ? "true" : "false");
      save(spec.key, next);
    };
    sw.addEventListener("click", toggle);
    sw.addEventListener("keydown", (ev) => {
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        toggle();
      }
    });
    ctrl.appendChild(sw);
  }

  function buildSelect(spec, ctrl) {
    // Many options overflow a segmented control (it squishes the row label to
    // vertical) — use a native dropdown for >3, keep segmented for 2-3.
    if (spec.options.length > 3) {
      const sel = document.createElement("select");
      sel.className = "glassbox-select hardware-buddy-text-input";
      const curv = gbValue(spec.key) || "";
      for (const [val, lblKey] of spec.options) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = t(lblKey);
        if (curv === val) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => save(spec.key, sel.value));
      ctrl.appendChild(sel);
      return;
    }
    const segmented = document.createElement("div");
    segmented.className = "segmented";
    segmented.setAttribute("role", "tablist");
    const cur = gbValue(spec.key) || "";
    for (const [val, lblKey] of spec.options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.value = val;
      btn.textContent = t(lblKey);
      btn.classList.toggle("active", cur === val);
      btn.addEventListener("click", () => {
        if (btn.classList.contains("active")) return;
        for (const other of segmented.querySelectorAll("button")) {
          other.classList.toggle("active", other === btn);
        }
        save(spec.key, val);
      });
      segmented.appendChild(btn);
    }
    ctrl.appendChild(segmented);
  }

  function buildTextInput(spec, ctrl) {
    const input = document.createElement(spec.type === "textarea" ? "textarea" : "input");
    if (spec.type !== "textarea") input.type = "text";
    input.className = "hardware-buddy-text-input glassbox-text-input";
    input.value = gbValue(spec.key) || "";
    if (spec.placeholderKey) input.placeholder = t(spec.placeholderKey);
    let timer = null;
    input.addEventListener("input", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => save(spec.key, input.value), 500);
    });
    input.addEventListener("blur", () => {
      if (timer) { clearTimeout(timer); timer = null; }
      save(spec.key, input.value);
    });
    const wrap = document.createElement("div");
    wrap.className = "hardware-buddy-text-control glassbox-text-control";
    wrap.appendChild(input);
    ctrl.appendChild(wrap);
  }

  function buildRow(spec) {
    const { row, ctrl } = buildRowShell(spec);
    if (spec.type === "toggle") buildToggle(spec, ctrl);
    else if (spec.type === "select") buildSelect(spec, ctrl);
    else buildTextInput(spec, ctrl);
    return row;
  }

  function renderGlassboxTab(container, core) {
    helpers = core.helpers;
    state = core.state;

    const heading = document.createElement("h1");
    heading.textContent = t("glassboxTabTitle");
    container.appendChild(heading);

    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("glassboxTabDesc");
    container.appendChild(subtitle);

    const rows = SPEC.map((spec) => buildRow(spec));
    container.appendChild(helpers.buildSection("", rows));
  }

  function init(core) {
    core.tabs["glassbox"] = { render: renderGlassboxTab };
  }

  root.ClawdSettingsTabGlassbox = { init };
})(globalThis);
