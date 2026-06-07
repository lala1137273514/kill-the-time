"use strict";

// Glass-box thought bubble (direction 1/3 — put the live status ON the pet).
//
// A tiny frameless transparent window that floats just above the pet and shows
// the current glass-box step ("💭 在想怎么干…" → "🚀 交给 Claude…" → "✅ 搞定！"),
// so the steps live on the character instead of vanishing with the input bar.
// Mirrors the update-bubble pattern; positioning is a pure, unit-tested helper.
// Electron is required lazily so the pure helper is testable under plain node.

const path = require("path");

const WIDTH = 220;
const HEIGHT = 60;
const GAP = 8;
const MARGIN = 8;
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// Centered above the pet; flips below when there's no room; clamped to the work
// area. Pure so it's unit-tested without Electron.
function computeGlassboxBubbleBounds({ petBounds, workArea, width, height, gap = GAP, margin = MARGIN }) {
  // Center on the pet's VISIBLE portion (clipped to the work area) so an
  // edge-docked / half-off-screen pet still gets the bubble by its visible part.
  const visLeft = Math.max(petBounds.x, workArea.x);
  const visRight = Math.min(petBounds.x + petBounds.width, workArea.x + workArea.width);
  const cx = (visRight > visLeft ? (visLeft + visRight) / 2 : petBounds.x + petBounds.width / 2);
  let x = Math.round(cx - width / 2);
  x = Math.max(workArea.x + margin, Math.min(x, workArea.x + workArea.width - width - margin));
  const aboveY = petBounds.y - gap - height;
  let y;
  if (aboveY >= workArea.y + margin) {
    y = aboveY;
  } else {
    const belowY = petBounds.y + petBounds.height + gap;
    y = Math.min(belowY, workArea.y + workArea.height - height - margin);
  }
  y = Math.max(workArea.y + margin, y);
  return { x, y, width, height };
}

module.exports = function initGlassboxBubble(ctx = {}) {
  let bubble = null;
  let hideTimer = null;

  function ensure() {
    if (bubble && !bubble.isDestroyed()) return bubble;
    const { BrowserWindow } = require("electron");
    bubble = new BrowserWindow({
      width: WIDTH, height: HEIGHT, show: false, frame: false, transparent: true,
      alwaysOnTop: true, resizable: false, skipTaskbar: true, hasShadow: false, focusable: false,
      ...(isMac ? { type: "panel" } : {}),
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
    });
    if (isWin) bubble.setAlwaysOnTop(true, "pop-up-menu");
    bubble.loadFile(path.join(__dirname, "glassbox-bubble.html"));
    bubble.on("closed", () => { bubble = null; });
    return bubble;
  }

  function position() {
    if (!bubble || bubble.isDestroyed()) return;
    if (typeof ctx.getPetWindowBounds !== "function" || typeof ctx.getNearestWorkArea !== "function") return;
    const pb = ctx.getPetWindowBounds();
    if (!pb) return;
    const wa = ctx.getNearestWorkArea(pb.x + pb.width / 2, pb.y + pb.height / 2);
    try { bubble.setBounds(computeGlassboxBubbleBounds({ petBounds: pb, workArea: wa, width: WIDTH, height: HEIGHT })); } catch {}
  }

  function showPhase(payload) {
    if (ctx.petHidden) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const win = ensure();
    const send = () => {
      position();
      if (win && !win.isDestroyed()) {
        try { win.webContents.send("glassbox-bubble-show", payload); } catch {}
        try { win.showInactive(); } catch {}
      }
    };
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
    else send();
    if (payload && payload.terminal) hideTimer = setTimeout(hide, 1800);
  }

  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (bubble && !bubble.isDestroyed()) {
      try { bubble.webContents.send("glassbox-bubble-hide"); } catch {}
      try { bubble.hide(); } catch {}
    }
  }

  function reposition() { position(); }

  function cleanup() {
    if (hideTimer) clearTimeout(hideTimer);
    if (bubble && !bubble.isDestroyed()) bubble.destroy();
    bubble = null;
  }

  return { showPhase, hide, reposition, cleanup, getWindow: () => bubble };
};

module.exports.__test = { computeGlassboxBubbleBounds };
