"use strict";

// Claude usage popup (功能1). A frameless transparent window near the pet that
// shows the usage card. Mirrors src/glassbox-bubble.js: the bounds helper is a
// pure unit-tested function; Electron is required lazily. Opened from the
// right-click menu + tray (single-click is already revealSessionHud).

const path = require("path");

const WIDTH = 260;
const HEIGHT = 248;
const GAP = 8;
const MARGIN = 8;
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// Centered above the pet's visible portion; flips below when there's no room;
// clamped to the work area. Pure so it's unit-tested without Electron.
function computeQuotaPopupBounds({ petBounds, workArea, width, height, gap = GAP, margin = MARGIN }) {
  const visLeft = Math.max(petBounds.x, workArea.x);
  const visRight = Math.min(petBounds.x + petBounds.width, workArea.x + workArea.width);
  const cx = visRight > visLeft ? (visLeft + visRight) / 2 : petBounds.x + petBounds.width / 2;
  let x = Math.round(cx - width / 2);
  x = Math.max(workArea.x + margin, Math.min(x, workArea.x + workArea.width - width - margin));
  const aboveY = petBounds.y - gap - height;
  let y = aboveY >= workArea.y + margin
    ? aboveY
    : Math.min(petBounds.y + petBounds.height + gap, workArea.y + workArea.height - height - margin);
  y = Math.max(workArea.y + margin, y);
  return { x, y, width, height };
}

module.exports = function initQuotaPopup(ctx = {}) {
  let win = null;

  function ensure() {
    if (win && !win.isDestroyed()) return win;
    const { BrowserWindow } = require("electron");
    win = new BrowserWindow({
      width: WIDTH, height: HEIGHT, show: false, frame: false, transparent: true,
      alwaysOnTop: true, resizable: false, skipTaskbar: true, hasShadow: false, focusable: true,
      ...(isMac ? { type: "panel" } : {}),
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
    });
    if (isWin) win.setAlwaysOnTop(true, "pop-up-menu");
    win.loadFile(path.join(__dirname, "quota-popup.html"));
    win.on("closed", () => { win = null; });
    win.on("blur", () => hide()); // click-away dismiss
    return win;
  }

  function position() {
    if (!win || win.isDestroyed()) return;
    if (typeof ctx.getPetWindowBounds !== "function" || typeof ctx.getNearestWorkArea !== "function") return;
    const pb = ctx.getPetWindowBounds();
    if (!pb) return;
    const wa = ctx.getNearestWorkArea(pb.x + pb.width / 2, pb.y + pb.height / 2);
    try { win.setBounds(computeQuotaPopupBounds({ petBounds: pb, workArea: wa, width: WIDTH, height: HEIGHT })); } catch {}
  }

  async function refresh(force) {
    const w = ensure();
    const sendLoading = () => { try { w.webContents.send("quota:data", { status: "loading" }); } catch {} };
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", sendLoading);
    else sendLoading();
    let result;
    try { result = await ctx.getUsage({ force: !!force }); }
    catch (e) { result = { status: "error", message: (e && e.message) || "error" }; }
    try { w.webContents.send("quota:data", result); } catch {}
  }

  function show() {
    if (ctx.petHidden) return;
    const w = ensure();
    position();
    try { w.showInactive(); w.focus(); } catch {}
    refresh(false);
  }

  function toggle() {
    if (win && !win.isDestroyed() && win.isVisible()) hide();
    else show();
  }

  function hide() { if (win && !win.isDestroyed()) { try { win.hide(); } catch {} } }
  function reposition() { position(); }
  function cleanup() { if (win && !win.isDestroyed()) win.destroy(); win = null; }

  return { show, hide, toggle, refresh, reposition, cleanup, getWindow: () => win };
};

module.exports.__test = { computeQuotaPopupBounds };
