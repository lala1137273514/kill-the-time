"use strict";

// Hover HUD — a TermiPet-style panel that slides up ABOVE the pet on hover: a
// compact usage strip + an icon action toolbar, in one window (one hover zone,
// no flicker). A separate frameless transparent always-on-top window (family of
// glassbox-bubble/card), focusable:false so it never steals focus but still
// clicks on Windows. Auto-dismisses on leave (no close button).
//
// Cross-window hover: the pet hit window reports pet enter/leave, this window
// reports its own enter/leave; main funnels both into show()/scheduleDismiss()/
// cancelDismiss(); a short delayed dismiss bridges the pet→HUD gap.
//
// Positioning is a pure unit-tested helper: centered ABOVE the pet, flip below
// when there's no room, clamped — mirrors the bubble/card.

const path = require("path");

const WIDTH = 240;
const HEIGHT = 110;        // usage strip + toolbar row
const GAP = 8;
const MARGIN = 8;
const DISMISS_MS = 140;    // snappy: delay before collapse after leaving the zone
const COLLAPSE_MS = 150;   // matches the renderer's collapse animation
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// Centered above the pet's visible portion; flip below if no room; clamp. Pure.
function computeHudBounds({ petBounds, workArea, width, height, gap = GAP, margin = MARGIN }) {
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
      // Usage strip data (cached, cheap) — pushed in so it shows with the toolbar.
      if (typeof ctx.getUsage === "function" && w && !w.isDestroyed()) {
        Promise.resolve(ctx.getUsage({})).then((u) => {
          try { if (w && !w.isDestroyed()) w.webContents.send("glassbox-hud-usage", u); } catch {}
        }).catch(() => {});
      }
    };
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", send);
    else send();
  }

  // Delayed collapse (combined-zone leave). Cancelled by any re-enter.
  function scheduleDismiss() {
    cancelDismiss();
    dismissTimer = setTimeout(hide, DISMISS_MS);
  }

  function hide() {
    cancelDismiss();
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send("glassbox-hud-hide"); } catch {}
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
