"use strict";

// Renderer for the glass-box live card. Receives a card payload over IPC and
// paints one of the narrator's shapes (status / activity / chat / permission),
// or clears on hide. The activity list is the "visible terminal": each render
// appends new action lines and auto-scrolls to the bottom. Permission buttons
// send the approve/deny IPC back to main (which wires them to the real resolve).

const { ipcRenderer } = require("electron");

const card = document.getElementById("card");
const emojiEl = document.getElementById("emoji");
const statusEl = document.getElementById("status");
const speechEl = document.getElementById("speech");
const activityEl = document.getElementById("activity");
const chatEl = document.getElementById("chat");
const permSummaryEl = document.getElementById("perm-summary");
const permButtonsEl = document.getElementById("perm-buttons");
const approveBtn = document.getElementById("perm-approve");
const denyBtn = document.getElementById("perm-deny");

function showOnly(...els) {
  for (const el of [speechEl, activityEl, chatEl, permSummaryEl, permButtonsEl]) {
    el.classList.toggle("hidden", !els.includes(el));
  }
}

function clearActivity() {
  activityEl.textContent = "";
}

function appendLines(lines) {
  for (const raw of lines) {
    const text = String(raw == null ? "" : raw);
    if (!text) continue;
    const div = document.createElement("div");
    div.className = "act-line";
    div.textContent = text;
    activityEl.appendChild(div);
  }
  // Auto-scroll to the bottom so the latest action is always visible.
  activityEl.scrollTop = activityEl.scrollHeight;
}

ipcRenderer.on("glassbox-card-render", (_e, p) => {
  if (!p) return;
  const mode = p.mode || "status";
  emojiEl.textContent = p.emoji || "";
  statusEl.textContent = p.status || p.title || "";
  // The header row carries the emoji+status for every mode except chat, where
  // the reply is the content; keep the header for context but allow it empty.

  if (mode === "speech") {
    showOnly(speechEl);
    speechEl.textContent = String(p.text || p.status || "");
  } else if (mode === "activity") {
    showOnly(activityEl);
    if (p.reset) clearActivity();
    const lines = Array.isArray(p.lines) ? p.lines : (p.line != null ? [p.line] : []);
    appendLines(lines);
  } else if (mode === "chat") {
    showOnly(chatEl);
    chatEl.textContent = String(p.text || "");
    chatEl.scrollTop = 0;
  } else if (mode === "permission") {
    showOnly(permSummaryEl, permButtonsEl);
    permSummaryEl.textContent = String(p.summary || p.text || "");
    permSummaryEl.scrollTop = 0;
  } else {
    // status (default): emoji + (wrapping) text only.
    showOnly();
  }

  card.classList.add("show");
  card.classList.toggle("live", !p.terminal && mode !== "permission");
});

ipcRenderer.on("glassbox-card-hide", () => {
  card.classList.remove("show", "live");
  clearActivity();
  speechEl.textContent = "";
  chatEl.textContent = "";
  permSummaryEl.textContent = "";
  showOnly();
});

approveBtn.addEventListener("click", () => {
  ipcRenderer.send("glassbox-card-approve");
});
denyBtn.addEventListener("click", () => {
  ipcRenderer.send("glassbox-card-deny");
});
