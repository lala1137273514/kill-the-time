"use strict";

// Hover HUD renderer: a compact usage strip + an icon toolbar. Buttons are
// icon-only (emoji — the app's existing icon style, zero deps) with native title
// tooltips (no clipping in a small window). Reports its own hover so main keeps
// the combined pet+HUD zone open; sends each action to main. No close button —
// the HUD auto-dismisses when the cursor leaves.

const { ipcRenderer } = require("electron");
const { formatPct, formatCountdown, usageColor } = require("./quota");

const hud = document.getElementById("hud");
const usageEl = document.getElementById("usage");
const toolbar = document.getElementById("toolbar");

// id → existing feature (mapped in main.js).
const BUTTONS = [
  { id: "chat", icon: "💬", tip: "聊天" },
  { id: "quota", icon: "📊", tip: "用量详情" },
  { id: "pomodoro", icon: "🍅", tip: "番茄钟" },
  { id: "dashboard", icon: "🗂", tip: "会话" },
  { id: "settings", icon: "⚙", tip: "设置" },
];

for (const b of BUTTONS) {
  const el = document.createElement("button");
  el.className = "hud-btn";
  el.type = "button";
  el.title = b.tip; // native tooltip — no clipping in a small window
  el.textContent = b.icon;
  el.addEventListener("click", () => ipcRenderer.send("glassbox-hud-action", b.id));
  toolbar.appendChild(el);
}

function renderUsage(u) {
  if (!u || u.status === "loading") { usageEl.className = "usage muted"; usageEl.textContent = "加载中…"; return; }
  if (u.status === "ok" || u.status === "stale") {
    const w = (u.windows || []).find((x) => x.key === "five_hour");
    if (!w) { usageEl.className = "usage muted"; usageEl.textContent = "无 5h 用量数据"; return; }
    const pct = Math.max(0, Math.min(100, w.utilization));
    const reset = formatCountdown(w.resetsAt, Date.now());
    usageEl.className = "usage";
    usageEl.innerHTML =
      `<span class="u-label">5h</span>` +
      `<span class="u-bar ${usageColor(w.utilization)}"><i style="width:${pct}%"></i></span>` +
      `<span class="u-val">${formatPct(w.utilization)}</span>` +
      (reset ? `<span class="u-reset">· ${reset}</span>` : "");
    return;
  }
  const msg = u.status === "not_logged_in" ? "未登录 Claude" : u.status === "expired" ? "需重新登录" : "用量获取失败";
  usageEl.className = "usage muted";
  usageEl.textContent = msg;
}

// Keep the combined zone open while the cursor is on the HUD.
document.documentElement.addEventListener("mouseenter", () => ipcRenderer.send("glassbox-hud-hover", true));
document.documentElement.addEventListener("mouseleave", () => ipcRenderer.send("glassbox-hud-hover", false));

ipcRenderer.on("glassbox-hud-show", () => hud.classList.add("show"));
ipcRenderer.on("glassbox-hud-hide", () => hud.classList.remove("show"));
ipcRenderer.on("glassbox-hud-usage", (_e, u) => renderUsage(u));
