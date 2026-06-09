"use strict";

// Quota popup renderer. Receives `quota:data` (the createQuota result), renders
// the 5h window primary + weekly windows secondary, maps non-ok status to a
// verbatim message, and wires the refresh button. Runs in a nodeIntegration
// window so it can require the shared pure formatters from ./quota.

const { ipcRenderer } = require("electron");
const { formatPct, formatCountdown, usageColor } = require("./quota");

const elState = document.getElementById("state");
const elPrimary = document.getElementById("primary");
const elWeekly = document.getElementById("weekly");
const elCodex = document.getElementById("codex");

const STATUS_MSG = {
  loading: "加载中…",
  not_logged_in: "未登录 Claude",
  expired: "需重新登录",
  error: (m) => `刷新失败：${m || "接口错误"}`,
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function rowHtml(w, primary) {
  const color = usageColor(w.utilization);
  const pct = Math.max(0, Math.min(100, w.utilization));
  const reset = formatCountdown(w.resetsAt, Date.now());
  const resetText = reset ? `重置 ${reset}` : "";
  return `<div class="row ${primary ? "primary" : ""}">
    <div class="toprow"><span>${escapeHtml(w.label)} ${formatPct(w.utilization)}</span><span class="reset">${escapeHtml(resetText)}</span></div>
    <div class="bar ${color}"><i style="width:${pct}%"></i></div>
  </div>`;
}

function show(el, on) { el.classList.toggle("hidden", !on); }

function renderCodex(codex) {
  if (!codex) { show(elCodex, false); return; }
  const ok = codex.status === "ok" || codex.status === "stale";
  const windows = Array.isArray(codex.windows) ? codex.windows : [];
  const windowRows = windows.length > 0
    ? `<div class="codex-windows">${windows.map((w) => rowHtml({ ...w, label: `Codex ${w.label || "额度"}` }, false)).join("")}</div>`
    : "";
  const fallbackMessage = codex.status === "expired" ? "需重新登录"
    : codex.status === "error" ? (codex.message || "读取失败")
    : codex.status === "stale" ? "刷新失败，显示上次数据"
    : codex.message || "已登录";
  elCodex.innerHTML = `<div class="codex-row">
    <span class="codex-dot ${ok ? "ok" : ""}"></span>
    <div><div class="codex-title">Codex</div><div class="codex-msg">${escapeHtml(fallbackMessage)}</div></div>
  </div>${windowRows}`;
  show(elCodex, codex.status !== "not_logged_in");
}

function render(data) {
  if (!data || data.status === "loading") {
    elState.textContent = STATUS_MSG.loading; show(elState, true); show(elPrimary, false); show(elWeekly, false); show(elCodex, false); return;
  }
  renderCodex(data.codex);
  if (data.status === "ok" || data.status === "stale") {
    const ws = data.windows || [];
    const primary = ws.find((w) => w.key === "five_hour");
    const others = ws.filter((w) => w.key !== "five_hour");
    elPrimary.innerHTML = primary ? rowHtml(primary, true) : "";
    elWeekly.innerHTML = others.map((w) => rowHtml(w, false)).join("");
    show(elPrimary, !!primary);
    show(elWeekly, others.length > 0);
    if (data.status === "stale") { elState.textContent = "刷新失败（显示上次）"; show(elState, true); }
    else show(elState, false);
    return;
  }
  const m = STATUS_MSG[data.status];
  elState.textContent = typeof m === "function" ? m(data.message) : (m || "出错了");
  show(elState, true); show(elPrimary, false); show(elWeekly, false);
}

ipcRenderer.on("quota:data", (_e, data) => render(data));
document.getElementById("refresh").addEventListener("click", () => ipcRenderer.send("quota:refresh"));
