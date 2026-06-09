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
      options: [["agent-native", "glassboxConfirmAgentNative"], ["always", "glassboxConfirmAlways"], ["writes-only", "glassboxConfirmWritesOnly"]],
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
    { group: "LLM 对话模型", key: "orchestratorModel", label: "模型", desc: "用于理解/规划派活的 OpenAI 兼容模型。", type: "text", placeholder: "留空 = qwen-plus" },
    { group: "LLM 对话模型", key: "orchestratorApiUrl", label: "基础地址", desc: "OpenAI 兼容 chat completions 地址。", type: "text", placeholder: "留空 = DashScope 兼容端点" },
    { group: "LLM 对话模型", key: "orchestratorApiKey", label: "API 密钥", desc: "留空时读取 BAILIAN_API_KEY / DASHSCOPE_API_KEY。", type: "password", placeholder: "不在代码里保存默认密钥" },
    { group: "TTS 语音播报", key: "ttsModel", label: "模型", desc: "用于 Agent 事件旁白。", type: "text", placeholder: "留空 = qwen3-tts-flash" },
    { group: "TTS 语音播报", key: "ttsApiUrl", label: "基础地址", desc: "DashScope TTS 生成接口地址。", type: "text", placeholder: "留空 = DashScope TTS 端点" },
    { group: "TTS 语音播报", key: "ttsVoice", label: "音色", desc: "TTS voice 参数。", type: "text", placeholder: "留空 = Cherry" },
    { group: "TTS 语音播报", key: "ttsApiKey", label: "API 密钥", desc: "留空时优先读取 DASHSCOPE_TTS_API_KEY，再回退共享密钥。", type: "password", placeholder: "可单独配置 TTS Key" },
    { group: "TTS 事件开关", key: "ttsEventStart", labelKey: "glassboxTtsEventStart", descKey: "glassboxTtsEventStartDesc", type: "toggle" },
    { group: "TTS 事件开关", key: "ttsEventFanout", labelKey: "glassboxTtsEventFanout", descKey: "glassboxTtsEventFanoutDesc", type: "toggle" },
    { group: "TTS 事件开关", key: "ttsEventWaiting", label: "等待确认时播报", desc: "权限/提问卡住时提醒你处理。", type: "toggle" },
    { group: "TTS 事件开关", key: "ttsEventCompacting", label: "压缩上下文时播报", desc: "说明它在清扫上下文，不是卡死。", type: "toggle" },
    { group: "TTS 事件开关", key: "ttsEventStuck", labelKey: "glassboxTtsEventStuck", descKey: "glassboxTtsEventStuckDesc", type: "toggle" },
    { group: "TTS 事件开关", key: "ttsEventError", label: "报错时播报", desc: "执行失败时提醒查看终端。", type: "toggle" },
    { group: "TTS 事件开关", key: "ttsEventDone", labelKey: "glassboxTtsEventDone", descKey: "glassboxTtsEventDoneDesc", type: "toggle" },
    { group: "TTS 文案", key: "ttsTextStart", label: "开始", desc: "留空使用内置随机短句。", type: "text", placeholder: "例如：收到，我开始拆这件事了" },
    { group: "TTS 文案", key: "ttsTextFanout", label: "并行", desc: "可用 {n} 表示子任务数量。", type: "text", placeholder: "例如：我兵分 {n} 路同时查" },
    { group: "TTS 文案", key: "ttsTextWaiting", label: "等待确认", desc: "权限/提问等待你的时候说。", type: "text", placeholder: "例如：它停在确认点了，需要你批一下" },
    { group: "TTS 文案", key: "ttsTextCompacting", label: "压缩上下文", desc: "压缩/清扫时说。", type: "text", placeholder: "例如：正在整理上下文，马上继续" },
    { group: "TTS 文案", key: "ttsTextLongRun", label: "执行较久", desc: "长时间同一工具无进展时说。", type: "text", placeholder: "例如：这步有点久，我还在盯着" },
    { group: "TTS 文案", key: "ttsTextError", label: "报错", desc: "失败或中断时说。", type: "text", placeholder: "例如：出岔子了，你看一眼终端" },
    { group: "TTS 文案", key: "ttsTextDone", label: "完成", desc: "任务完成时说。", type: "text", placeholder: "例如：搞定，结果给你了" },
    { group: "TTS 文案", key: "ttsTextDrag", label: "拖拽", desc: "被拖动时偶尔说。", type: "text", placeholder: "例如：好好好，换个地方站" },
    { group: "ASR 语音识别", key: "asrModel", label: "模型", desc: "配置远端时使用 Paraformer；本地 fallback 使用 Whisper。", type: "text", placeholder: "留空 = paraformer-realtime-v2 / local small" },
    { group: "ASR 语音识别", key: "asrApiUrl", label: "基础地址", desc: "DashScope ASR WebSocket 地址。", type: "text", placeholder: "留空 = DashScope ASR 端点或本地 ASR" },
    { group: "ASR 语音识别", key: "asrApiKey", label: "API 密钥", desc: "留空时优先读取 DASHSCOPE_ASR_API_KEY，再回退共享密钥。", type: "password", placeholder: "可单独配置 ASR Key" },
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
    label.textContent = spec.label || t(spec.labelKey);
    text.appendChild(label);
    if (spec.desc || spec.descKey) {
      const desc = document.createElement("span");
      desc.className = "row-desc";
      desc.textContent = spec.desc || t(spec.descKey);
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
    if (spec.type !== "textarea") input.type = spec.type === "password" ? "password" : "text";
    input.className = "hardware-buddy-text-input glassbox-text-input";
    input.value = gbValue(spec.key) || "";
    if (spec.placeholder || spec.placeholderKey) input.placeholder = spec.placeholder || t(spec.placeholderKey);
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

    const groups = new Map();
    for (const spec of SPEC) {
      const group = spec.group || "基础";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(buildRow(spec));
    }
    for (const [group, rows] of groups) {
      container.appendChild(helpers.buildSection(group, rows));
    }
  }

  function init(core) {
    core.tabs["glassbox"] = { render: renderGlassboxTab };
  }

  root.ClawdSettingsTabGlassbox = { init };
})(globalThis);
