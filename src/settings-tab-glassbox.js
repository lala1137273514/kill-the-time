"use strict";

// Glass-box voice settings tab (direction 4 UI). Self-contained so it loads as a
// plain <script> in the settings window (no require/contextIsolation issues): it
// inlines the row spec and writes each nested glassbox.* field through the generic
// settings command `setGlassboxField` (validated server-side in settings-actions).
(function initSettingsTabGlassbox(root) {
  let helpers = null;
  let state = null;

  // Mirrors glassbox-settings-section.buildGlassboxSettingsSpec(); the server
  // validates every write, so a stale label here can never corrupt prefs.
  const SPEC = [
    { key: "voiceEnabled", label: "语音总开关", type: "toggle" },
    { key: "wakeWordEnabled", label: "唤醒词「hey, cc」", type: "toggle" },
    { key: "confirmMode", label: "执行确认策略", type: "select", options: [["always", "每次都确认"], ["writes-only", "仅写操作时确认"]] },
    { key: "permissionMode", label: "派发权限模式", type: "select", options: [["", "跟随环境变量（默认）"], ["bypassPermissions", "全部放行（bypass）"], ["acceptEdits", "自动接受编辑"], ["plan", "仅规划"], ["default", "默认（逐项询问）"]] },
    { key: "orchestratorModel", label: "编排模型", type: "text", placeholder: "留空 = 默认 qwen-plus" },
    { key: "ttsVoice", label: "语音音色（TTS）", type: "text", placeholder: "留空 = 默认 Cherry" },
    { key: "whisperModel", label: "Whisper 识别模型", type: "select", options: [["", "跟随环境变量（默认 base）"], ["tiny", "tiny（最快）"], ["base", "base"], ["small", "small"], ["medium", "medium"], ["large", "large（最准）"]] },
    { key: "hotkey", label: "呼出快捷键", type: "text", placeholder: "留空 = Ctrl+Space" },
    { key: "systemPrompt", label: "系统提示词", type: "textarea", placeholder: "留空 = 用内置提示词文件" },
  ];

  function gbValue(key) {
    const snap = (state && state.snapshot) || {};
    const gb = (snap.glassbox && typeof snap.glassbox === "object") ? snap.glassbox : {};
    return gb[key];
  }

  function save(field, value) {
    if (!window.settingsAPI || typeof window.settingsAPI.command !== "function") return;
    Promise.resolve(window.settingsAPI.command("setGlassboxField", { field, value })).catch(() => {});
  }

  function buildRow(row) {
    const wrap = document.createElement("div");
    wrap.className = "settings-row glassbox-row";
    wrap.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:10px 2px;border-bottom:1px solid rgba(128,128,128,0.15);";
    const label = document.createElement("label");
    label.className = "settings-row-label";
    label.style.cssText = "font-size:13px;padding-top:5px;white-space:nowrap;";
    label.textContent = row.label;
    wrap.appendChild(label);

    let control;
    if (row.type === "toggle") {
      control = document.createElement("input");
      control.type = "checkbox";
      control.checked = gbValue(row.key) === true;
      control.addEventListener("change", () => save(row.key, control.checked));
    } else if (row.type === "select") {
      control = document.createElement("select");
      const cur = gbValue(row.key) || "";
      for (const [val, lbl] of row.options) {
        const opt = document.createElement("option");
        opt.value = val; opt.textContent = lbl;
        if (cur === val) opt.selected = true;
        control.appendChild(opt);
      }
      control.addEventListener("change", () => save(row.key, control.value));
    } else {
      control = document.createElement(row.type === "textarea" ? "textarea" : "input");
      if (row.type !== "textarea") control.type = "text";
      control.value = gbValue(row.key) || "";
      if (row.placeholder) control.placeholder = row.placeholder;
      let timer = null;
      control.addEventListener("input", () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => save(row.key, control.value), 500);
      });
      control.addEventListener("blur", () => { if (timer) { clearTimeout(timer); timer = null; } save(row.key, control.value); });
    }
    control.className = "glassbox-control";
    if (row.type === "text" || row.type === "select") control.style.cssText = "min-width:240px;max-width:320px;";
    if (row.type === "textarea") control.style.cssText = "min-width:240px;max-width:320px;min-height:64px;";
    wrap.appendChild(control);
    return wrap;
  }

  function renderGlassboxTab(container, core) {
    helpers = core.helpers;
    state = core.state;

    const section = document.createElement("div");
    section.className = "settings-tab-section";

    const title = document.createElement("h3");
    title.textContent = "玻璃盒语音设置";
    section.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "settings-tab-desc";
    desc.textContent = "桌宠语音遥控的开关与参数。留空 = 用环境变量 / 内置默认；改动即时生效（热键需重启）。需以 CLAWD_GLASSBOX_VOICE=1 启动。";
    section.appendChild(desc);

    for (const row of SPEC) section.appendChild(buildRow(row));

    container.appendChild(section);
  }

  function init(core) {
    core.tabs["glassbox"] = { render: renderGlassboxTab };
  }

  root.ClawdSettingsTabGlassbox = { init };
})(globalThis);
