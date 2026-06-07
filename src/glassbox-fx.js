"use strict";

// Glass-box celebration FX (a genuinely new animation). A transient transparent
// overlay centered ON the pet that bursts confetti + a pop glyph when a dispatch
// finishes (done / approved), then auto-hides. Mirrors the bubble pattern;
// positioning is a pure unit-tested helper, electron is required lazily.

const path = require("path");

const WIDTH = 280;
const HEIGHT = 200;
const MARGIN = 8;
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// Centered on the pet's center, clamped to the work area. Pure.
function computeFxBounds({ petBounds, workArea, width, height, margin = MARGIN }) {
  // Center on the pet's VISIBLE portion so the burst stays on an edge-docked pet.
  const visLeft = Math.max(petBounds.x, workArea.x);
  const visRight = Math.min(petBounds.x + petBounds.width, workArea.x + workArea.width);
  const visTop = Math.max(petBounds.y, workArea.y);
  const visBottom = Math.min(petBounds.y + petBounds.height, workArea.y + workArea.height);
  const cx = (visRight > visLeft ? (visLeft + visRight) / 2 : petBounds.x + petBounds.width / 2);
  const cy = (visBottom > visTop ? (visTop + visBottom) / 2 : petBounds.y + petBounds.height / 2);
  let x = Math.round(cx - width / 2);
  let y = Math.round(cy - height / 2);
  x = Math.max(workArea.x + margin, Math.min(x, workArea.x + workArea.width - width - margin));
  y = Math.max(workArea.y + margin, Math.min(y, workArea.y + workArea.height - height - margin));
  return { x, y, width, height };
}

module.exports = function initGlassboxFx(ctx = {}) {
  let fx = null;
  let hideTimer = null;

  function ensure() {
    if (fx && !fx.isDestroyed()) return fx;
    const { BrowserWindow } = require("electron");
    fx = new BrowserWindow({
      width: WIDTH, height: HEIGHT, show: false, frame: false, transparent: true,
      alwaysOnTop: true, resizable: false, skipTaskbar: true, hasShadow: false, focusable: false,
      ...(isMac ? { type: "panel" } : {}),
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
    });
    if (isWin) fx.setAlwaysOnTop(true, "pop-up-menu");
    fx.loadFile(path.join(__dirname, "glassbox-fx.html"));
    fx.on("closed", () => { fx = null; });
    return fx;
  }

  function position() {
    if (!fx || fx.isDestroyed()) return;
    if (typeof ctx.getPetWindowBounds !== "function" || typeof ctx.getNearestWorkArea !== "function") return;
    const pb = ctx.getPetWindowBounds();
    if (!pb) return;
    const wa = ctx.getNearestWorkArea(pb.x + pb.width / 2, pb.y + pb.height / 2);
    try { fx.setBounds(computeFxBounds({ petBounds: pb, workArea: wa, width: WIDTH, height: HEIGHT })); } catch {}
  }

  function celebrate(kind) {
    if (ctx.petHidden) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const win = ensure();
    const send = () => {
      position();
      if (win && !win.isDestroyed()) {
        try { win.webContents.send("glassbox-fx-burst", { kind: kind || "done" }); } catch {}
        try { win.showInactive(); } catch {}
      }
    };
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
    else send();
    hideTimer = setTimeout(hide, 1800);
  }

  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (fx && !fx.isDestroyed()) { try { fx.hide(); } catch {} }
  }

  function reposition() { position(); }

  function cleanup() {
    if (hideTimer) clearTimeout(hideTimer);
    if (fx && !fx.isDestroyed()) fx.destroy();
    fx = null;
  }

  return { celebrate, hide, reposition, cleanup, getWindow: () => fx };
};

module.exports.__test = { computeFxBounds };
