"use strict";

// Pet-adjacent HUD renderer: three compact cards (agent status, usage, actions).
// Input stays outside the HUD; settings/model entrances are icon buttons.

const { ipcRenderer } = require("electron");
const { formatPct, formatCountdown, usageColor } = require("./quota");
const { classifySession, agentLabelOf } = require("./agent-supervisor-semantics");

const hud = document.getElementById("hud");
const statusDot = document.getElementById("statusDot");
const statusAgent = document.getElementById("statusAgent");
const statusPhase = document.getElementById("statusPhase");
const statusDetail = document.getElementById("statusDetail");
const statusRecent = document.getElementById("statusRecent");
const statusChip = document.getElementById("statusChip");
const usageMeta = document.getElementById("usageMeta");
const usageGrid = document.getElementById("usageGrid");
const toolbar = document.getElementById("toolbar");
let hudInteractive = null;

const ICONS = {
  chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>`,
  dashboard: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v5H4z"/><path d="M4 14h7v5H4z"/><path d="M15 14h5v5h-5z"/></svg>`,
  quota: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/></svg>`,
  llm: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="12" rx="2"/><path d="M9 7V4h6v3"/><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16h4"/></svg>`,
  tts: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-4h3l4-3v10l-4-3z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>`,
  asr: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M8 21h8"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3a2 2 0 1 1 0-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.08V3a2 2 0 1 1 4 0v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 9c.25.58.83.96 1.46 1H21a2 2 0 1 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15z"/></svg>`,
};

const BUTTONS = [
  { id: "chat", icon: ICONS.chat, tip: "输入" },
  { id: "dashboard", icon: ICONS.dashboard, tip: "会话总览" },
  { id: "quota", icon: ICONS.quota, tip: "刷新用量" },
  { id: "llm", icon: ICONS.llm, tip: "LLM 设置" },
  { id: "tts", icon: ICONS.tts, tip: "TTS 设置" },
  { id: "asr", icon: ICONS.asr, tip: "ASR 设置" },
  { id: "settings", icon: ICONS.settings, tip: "设置" },
];

for (const b of BUTTONS) {
  const el = document.createElement("button");
  el.className = "hud-btn";
  el.type = "button";
  el.title = b.tip;
  el.setAttribute("aria-label", b.tip);
  el.innerHTML = b.icon;
  el.addEventListener("click", () => ipcRenderer.send("glassbox-hud-action", b.id));
  toolbar.appendChild(el);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function isHudSession(session) {
  return !!session && !session.headless && session.state !== "sleeping" && !session.hiddenFromHud;
}

function titleFor(session) {
  return session.displayTitle || session.sessionTitle || session.id || "";
}

function orderedHudSessions(snapshot) {
  const sessions = Array.isArray(snapshot && snapshot.sessions) ? snapshot.sessions : [];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const ids = Array.isArray(snapshot && snapshot.orderedIds)
    ? snapshot.orderedIds
    : sessions.map((session) => session.id);
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map((session) => session.id));
  return ordered.concat(sessions.filter((session) => !seen.has(session.id))).filter(isHudSession);
}

function renderStatus(payload) {
  const snapshot = payload && payload.sessionSnapshot ? payload.sessionSnapshot : null;
  const sessions = orderedHudSessions(snapshot);
  const current = sessions[0] || null;
  const sem = classifySession(current);

  statusDot.className = `status-dot ${sem.dot || "quiet"}`;
  if (!current) {
    statusAgent.textContent = "Clawd";
    statusPhase.textContent = sem.phase;
    statusDetail.textContent = sem.detail;
    statusRecent.textContent = sem.recent;
    statusChip.textContent = sem.chip;
    return;
  }

  const more = sessions.length > 1 ? ` · +${sessions.length - 1}` : "";
  const agent = `${agentLabelOf(current)}${more}`;
  const title = titleFor(current) || agent;
  statusAgent.textContent = agent;
  statusAgent.title = title;
  statusPhase.textContent = sem.phase;
  statusPhase.title = sem.phase;
  statusDetail.textContent = sem.detail;
  statusDetail.title = sem.detail;
  statusRecent.textContent = sem.recent;
  statusRecent.title = `${title} · ${sem.recent}`;
  statusChip.textContent = sem.chip;
  statusChip.title = sem.animation;
}

function windowByKey(windows, key) {
  return windows.find((w) => w.key === key) || null;
}

function usageWindowRowHtml(service, label, w) {
  if (!w) return "";
  const pct = Math.max(0, Math.min(100, w.utilization));
  const reset = formatCountdown(w.resetsAt, Date.now());
  const meta = `${formatPct(w.utilization)}${reset ? ` · ${reset}` : ""}`;
  return `<div class="usage-row">
    <span class="usage-name">${escapeHtml(service)}</span>
    <span class="usage-window">${escapeHtml(label)}</span>
    <span class="usage-bar ${usageColor(w.utilization)}"><i style="width:${pct}%"></i></span>
    <span class="usage-meta" title="${escapeHtml(meta)}">${escapeHtml(formatPct(w.utilization))}</span>
  </div>`;
}

function renderUsage(u) {
  if (!u || u.status === "loading") {
    usageMeta.textContent = "加载中";
    usageGrid.innerHTML = `<div class="usage-note">正在读取已登录服务...</div>`;
    return;
  }

  const rows = [];
  if (u.status === "ok" || u.status === "stale") {
    const windows = Array.isArray(u.windows) ? u.windows : [];
    rows.push(
      usageWindowRowHtml("Claude", "5 小时", windowByKey(windows, "five_hour")),
      usageWindowRowHtml("Claude", "7 天", windowByKey(windows, "seven_day")),
      usageWindowRowHtml("Claude", "Opus", windowByKey(windows, "seven_day_opus")),
      usageWindowRowHtml("Claude", "Sonnet", windowByKey(windows, "seven_day_sonnet")),
    );
    if (u.status === "stale") rows.push(`<div class="usage-note">Claude 刷新失败，显示上次数据</div>`);
  }

  const codex = u.codex || null;
  const codexWindows = Array.isArray(codex && codex.windows) ? codex.windows : [];
  if (codex && (codex.status === "ok" || codex.status === "stale") && codexWindows.length > 0) {
    for (const window of codexWindows) {
      rows.push(usageWindowRowHtml("Codex", window.label || "额度", window));
    }
    if (codex.status === "stale") rows.push(`<div class="usage-note">Codex 刷新失败，显示上次数据</div>`);
  } else if (codex && codex.status && codex.status !== "not_logged_in") {
    const codexText = (codex.message || "已登录").replace(" · 暂无本地额度百分比", "");
    const codexMeta = codex.status === "expired" ? "过期"
      : codex.status === "error" ? "失败"
      : "OK";
    rows.push(`<div class="usage-row usage-row-static">
      <span class="usage-name">Codex</span>
      <span class="usage-window">本地</span>
      <span class="usage-note">${escapeHtml(codexText)}</span>
      <span class="usage-meta">${escapeHtml(codexMeta)}</span>
    </div>`);
  }

  const filtered = rows.filter(Boolean);
  if (filtered.length > 0) {
    usageMeta.textContent = `${filtered.length} 项`;
    usageGrid.innerHTML = filtered.join("");
    return;
  }

  usageMeta.textContent = "无已登录";
  const msg = u.status === "expired" ? "Claude 登录已过期"
    : u.status === "error" ? `刷新失败：${u.message || "接口错误"}`
    : "未检测到已登录服务";
  usageGrid.innerHTML = `<div class="usage-note">${escapeHtml(msg)}</div>`;
}

function setHudInteractive(on) {
  const next = !!on;
  if (hudInteractive === next) return;
  hudInteractive = next;
  ipcRenderer.send("glassbox-hud-interactive", next);
}

function updateInteractiveFromPoint(event) {
  const target = event && event.target;
  setHudInteractive(!!(target && target.closest && target.closest(".hud-card")));
}

document.documentElement.addEventListener("mouseenter", () => ipcRenderer.send("glassbox-hud-hover", true));
document.documentElement.addEventListener("mousemove", updateInteractiveFromPoint, true);
document.documentElement.addEventListener("pointermove", updateInteractiveFromPoint, true);
document.documentElement.addEventListener("mouseleave", () => {
  setHudInteractive(false);
  ipcRenderer.send("glassbox-hud-hover", false);
});

ipcRenderer.on("glassbox-hud-show", () => hud.classList.add("show"));
ipcRenderer.on("glassbox-hud-hide", () => {
  setHudInteractive(false);
  hud.classList.remove("show");
});
ipcRenderer.on("glassbox-hud-context", (_e, payload) => renderStatus(payload));
ipcRenderer.on("glassbox-hud-usage", (_e, u) => renderUsage(u));
