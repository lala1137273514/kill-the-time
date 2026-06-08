"use strict";

// Hover HUD — a TermiPet-style action toolbar that slides out beside the pet on
// hover (item 4). A separate frameless transparent always-on-top window (same
// family as glassbox-bubble/card), focusable:false so it never steals the user's
// window but still receives clicks on Windows.
//
// Cross-window hover: the pet's hit window reports pet enter/leave, this window
// reports its own enter/leave; main funnels both into show()/scheduleDismiss()/
// cancelDismiss(). A single delayed dismiss timer bridges the pet→HUD gap so the
// HUD never flickers while the cursor travels between them.
//
// Positioning is a pure, unit-tested helper: anchored to the SIDE of the pet
// (right if room, else left), vertically centered, clamped — never covers the pet.

const path = require("path");

const WIDTH = 276;
const HEIGHT = 84; // toolbar row + headroom so the hover tooltip isn't clipped
const GAP = 10;
const MARGIN = 8;
const DISMISS_MS = 160;     // delay before collapse after leaving the combined zone
const COLLAPSE_MS = 200;    // time for the renderer's collapse animation before we hide
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// Anchor beside the pet's VISIBLE portion: right if it fits, else left; centered
// vertically; clamped to the work area so it never spills off-screen. Pure.
function computeHudBounds({ petBounds, workArea, width, height, gap = GAP, margin = MARGIN }) {
  const visLeft = Math.max(petBounds.x, workArea.x);
  const visRight = Math.min(petBounds.x + petBounds.width, workArea.x + workArea.width);
  const visTop = Math.max(petBounds.y, workArea.y);
  const visBottom = Math.min(petBounds.y + petBounds.height, workArea.y + workArea.height);

  const rightX = visRight + gap;
  let x;
  if (rightX + width <= workArea.x + workArea.width - margin) {
    x = rightX; // room on the right
  } else {
    const leftX = visLeft - gap - width;
    x = leftX >= workArea.x + margin ? leftX : rightX; // prefer left; clamp handles overflow
  }
  x = Math.round(Math.max(workArea.x + margin, Math.min(x, workArea.x + workArea.width - width - margin)));

  const cy = (visTop + visBottom) / 2;
  let y = Math.round(cy - height / 2);
  y = Math.max(workArea.y + margin, Math.min(y, workArea.y + workArea.height - height - margin));

  return { x, y, width, height };
}

function initGlassboxHud(ctx = {}) {
  let win = null;
  let dismissTimer = null;
  let collapseTimer = null;

  function ensure() {
    if (win && !win.isDestroyed()) return win;
    const { BrowserWindow } = require("electron");
    win = new BrowserWindow({
      width: WIDTH, height: HEIGHT, show: false, frame: false, transparent: true,
      alwaysOnTop: true, resizable: false, skipTaskbar: true, hasShadow: false, focusable: false,
      ...(isMac ? { type: "panel" } : {}),
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
    });
    if (isWin) win.setAlwaysOnTop(true, "pop-up-menu");
    win.loadFile(path.join(__dirname, "glassbox-hud.html"));
    win.on("closed", () => { win = null; });
    return win;
  }

  function position() {
    if (!win || win.isDestroyed()) return;
    if (typeof ctx.getPetWindowBounds !== "function" || typeof ctx.getNearestWorkArea !== "function") return;
    const pb = ctx.getPetWindowBounds();
    if (!pb) return;
    const wa = ctx.getNearestWorkArea(pb.x + pb.width / 2, pb.y + pb.height / 2);
    try { win.setBounds(computeHudBounds({ petBounds: pb, workArea: wa, width: WIDTH, height: HEIGHT })); } catch {}
  }

  function cancelDismiss() {
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
  }

  function show() {
    if (ctx.petHidden) return;
    cancelDismiss();
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
    const w = ensure();
    const send = () => {
      position();
      if (w && !w.isDestroyed()) {
        try { w.showInactive(); } catch {}
        try { w.webContents.send("glassbox-hud-show"); } catch {}
      }
    };
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", send);
    else send();
  }

  // Start the delayed collapse (combined-zone leave). Cancelled by any re-enter.
  function scheduleDismiss() {
    cancelDismiss();
    dismissTimer = setTimeout(hide, DISMISS_MS);
  }

  function hide() {
    cancelDismiss();
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send("glassbox-hud-hide"); } catch {}   // play collapse anim
    if (collapseTimer) clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      if (win && !win.isDestroyed()) { try { win.hide(); } catch {} }
    }, COLLAPSE_MS);
  }

  function reposition() { position(); }

  function cleanup() {
    cancelDismiss();
    if (collapseTimer) clearTimeout(collapseTimer);
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }

  return { show, scheduleDismiss, cancelDismiss, hide, reposition, cleanup, getWindow: () => win };
}

module.exports = initGlassboxHud;
module.exports.initGlassboxHud = initGlassboxHud;
module.exports.__test = { computeHudBounds };
