"use strict";

const core = globalThis.ClawdSettingsCore;

const FULL_SIDEBAR_TABS = [
  { id: "general", icon: "\u2699", labelKey: "sidebarGeneral", available: true },
  { id: "agents", icon: "\u26A1", labelKey: "sidebarAgents", available: true },
  { id: "theme", icon: "\u{1F3A8}", labelKey: "sidebarTheme", available: true },
  { id: "animMap", icon: "\u{1F3AC}", labelKey: "sidebarAnimMap", available: true },
  { id: "animOverrides", icon: "\u{1F39E}", labelKey: "sidebarAnimOverrides", available: true },
  { id: "shortcuts", icon: "\u2328", labelKey: "sidebarShortcuts", available: true },
  { id: "telegram-approval", icon: "\u2708", labelKey: "sidebarTelegramApproval", available: true },
  { id: "remote-ssh", icon: "\u{1F50C}", labelKey: "sidebarRemoteSsh", available: true },
  { id: "mobile", icon: "\u{1F4F1}", labelKey: "sidebarMobile", available: true },
  { id: "glassbox", icon: "\u{1F50A}", labelKey: "sidebarGlassbox", available: true },
  { id: "about", icon: "\u2139", labelKey: "sidebarAbout", available: true },
];

const DEMO_SIDEBAR_TABS = [
  { id: "glassbox", icon: "\u25C9", label: "模型语音", available: true },
  { id: "general", icon: "\u25CE", label: "宠物行为", available: true },
  { id: "agents", icon: "\u25C7", label: "Agent 连接", available: true },
];
const DEMO_SETTINGS_MODE = !!(window.settingsAPI && window.settingsAPI.demoSettingsMode === true);
const SIDEBAR_TABS = DEMO_SETTINGS_MODE ? DEMO_SIDEBAR_TABS : FULL_SIDEBAR_TABS;
const VISIBLE_TAB_IDS = new Set(SIDEBAR_TABS.map((tab) => tab.id));
if (DEMO_SETTINGS_MODE) core.state.activeTab = "glassbox";

function renderSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.innerHTML = "";
  if (
    !DEMO_SETTINGS_MODE
    &&
    globalThis.ClawdSettingsDoctorModal
    && typeof globalThis.ClawdSettingsDoctorModal.renderSidebarIndicator === "function"
  ) {
    globalThis.ClawdSettingsDoctorModal.renderSidebarIndicator(sidebar, core);
  }
  for (const tab of SIDEBAR_TABS) {
    const item = document.createElement("div");
    item.className = "sidebar-item";
    if (!tab.available) item.classList.add("disabled");
    if (tab.id === core.state.activeTab) item.classList.add("active");
    item.innerHTML =
      `<span class="sidebar-item-icon">${tab.icon}</span>` +
      `<span class="sidebar-item-label">${core.helpers.escapeHtml(tab.label || core.helpers.t(tab.labelKey))}</span>` +
      (tab.available ? "" : `<span class="sidebar-item-soon">${core.helpers.escapeHtml(core.helpers.t("sidebarSoon"))}</span>`);
    if (tab.available) {
      item.addEventListener("click", () => {
        core.ops.selectTab(tab.id);
      });
    }
    sidebar.appendChild(item);
  }
}

function renderPlaceholder(parent) {
  const div = document.createElement("div");
  div.className = "placeholder";
  div.innerHTML =
    `<div class="placeholder-icon">\u{1F6E0}</div>` +
    `<div class="placeholder-title">${core.helpers.escapeHtml(core.helpers.t("placeholderTitle"))}</div>` +
    `<div class="placeholder-desc">${core.helpers.escapeHtml(core.helpers.t("placeholderDesc"))}</div>`;
  parent.appendChild(div);
}

function renderContent() {
  const content = document.getElementById("content");
  if (!content) return;
  core.ops.clearMountedControls();
  content.innerHTML = "";
  const tab = core.tabs[core.state.activeTab];
  if (tab && typeof tab.render === "function") {
    tab.render(content, core);
  } else {
    renderPlaceholder(content);
  }
}

core.ops.installRenderHooks({
  sidebar: renderSidebar,
  content: renderContent,
});

globalThis.ClawdSettingsTabGeneral.init(core);
globalThis.ClawdSettingsTabAgents.init(core);
globalThis.ClawdSettingsTabTheme.init(core);
globalThis.ClawdSettingsTabAnimMap.init(core);
globalThis.ClawdSettingsTabAnimOverrides.init(core);
globalThis.ClawdSettingsTabShortcuts.init(core);
if (globalThis.ClawdSettingsTabTelegramApproval) globalThis.ClawdSettingsTabTelegramApproval.init(core);
globalThis.ClawdSettingsTabAbout.init(core);
if (globalThis.ClawdSettingsTabRemoteSsh) globalThis.ClawdSettingsTabRemoteSsh.init(core);
if (globalThis.ClawdSettingsTabMobile) globalThis.ClawdSettingsTabMobile.init(core);
if (globalThis.ClawdSettingsTabGlassbox) globalThis.ClawdSettingsTabGlassbox.init(core);

if (window.settingsAPI && typeof window.settingsAPI.onChanged === "function") {
  window.settingsAPI.onChanged((payload) => core.ops.applyChanges(payload));
}

if (window.settingsAPI && typeof window.settingsAPI.onSelectTab === "function") {
  window.settingsAPI.onSelectTab((payload) => {
    const tabId = payload && payload.tabId;
    if (tabId && core.tabs[tabId] && (!DEMO_SETTINGS_MODE || VISIBLE_TAB_IDS.has(tabId))) core.ops.selectTab(tabId);
  });
}

if (window.settingsAPI && typeof window.settingsAPI.onAnimationPreviewPosterReady === "function") {
  window.settingsAPI.onAnimationPreviewPosterReady((payload) => core.ops.applyAnimationPreviewPoster(payload));
}

if (window.settingsAPI && typeof window.settingsAPI.onShortcutRecordKey === "function") {
  window.settingsAPI.onShortcutRecordKey((payload) => core.ops.handleShortcutRecordKey(payload));
}

if (window.settingsAPI && typeof window.settingsAPI.onShortcutFailuresChanged === "function") {
  window.settingsAPI.onShortcutFailuresChanged((failures) => core.ops.applyShortcutFailures(failures));
}

if (window.settingsAPI && typeof window.settingsAPI.getShortcutFailures === "function") {
  window.settingsAPI.getShortcutFailures().then((failures) => {
    core.ops.applyShortcutFailures(failures);
  }).catch((err) => {
    console.warn("settings: getShortcutFailures failed", err);
  });
}

if (window.settingsAPI && typeof window.settingsAPI.getSnapshot === "function") {
  window.settingsAPI.getSnapshot().then((snapshot) => {
    core.ops.applyBootstrap(snapshot);
  });
}

if (window.settingsAPI && typeof window.settingsAPI.listAgents === "function") {
  window.settingsAPI.listAgents().then((list) => {
    core.ops.applyAgentMetadata(list);
  }).catch((err) => {
    console.warn("settings: listAgents failed", err);
    core.ops.applyAgentMetadata([]);
  });
}
