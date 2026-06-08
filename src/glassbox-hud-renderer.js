"use strict";

// Hover HUD toolbar renderer. Builds icon-only buttons (emoji, matching the app's
// existing icon style — zero new deps) with hover tooltips, reports its own
// hover so main keeps the combined pet+HUD zone open, and sends each button's
// action to main (mapped there to existing features).

const { ipcRenderer } = require("electron");

const hud = document.getElementById("hud");

// id → existing feature (mapped in main.js). Icon-only + short tooltip.
const BUTTONS = [
  { id: "chat", icon: "💬", tip: "聊天" },
  { id: "quota", icon: "📊", tip: "用量" },
  { id: "pomodoro", icon: "🍅", tip: "番茄钟" },
  { id: "dashboard", icon: "🗂", tip: "会话" },
  { id: "settings", icon: "⚙", tip: "设置" },
  { id: "close", icon: "✕", tip: "收起" },
];

for (const b of BUTTONS) {
  const el = document.createElement("button");
  el.className = "hud-btn";
  el.type = "button";
  el.dataset.tip = b.tip;
  el.textContent = b.icon;
  el.addEventListener("click", () => ipcRenderer.send("glassbox-hud-action", b.id));
  hud.appendChild(el);
}

// Report this window's hover so main keeps the combined zone open while the
// cursor is on the HUD (and starts the dismiss timer when it leaves).
document.documentElement.addEventListener("mouseenter", () => ipcRenderer.send("glassbox-hud-hover", true));
document.documentElement.addEventListener("mouseleave", () => ipcRenderer.send("glassbox-hud-hover", false));

// Expand / collapse animations driven by main.
ipcRenderer.on("glassbox-hud-show", () => hud.classList.add("show"));
ipcRenderer.on("glassbox-hud-hide", () => hud.classList.remove("show"));
