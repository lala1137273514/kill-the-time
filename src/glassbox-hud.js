"use strict";

// Hover HUD — a pet-adjacent panel that slides up ABOVE the pet on hover: live
// session status + usage strip + icon action toolbar in one window (one hover
// zone, no flicker). A separate frameless transparent always-on-top window
// (family of glassbox-bubble/card), focusable:false so it never steals focus but
// still clicks on Windows. Auto-dismisses on leave (no close button).
//
// Cross-window hover: the pet hit window reports pet enter/leave, this window
// reports its own enter/leave; main funnels both into show()/scheduleDismiss()/
// cancelDismiss(); a short delayed dismiss bridges the pet→HUD gap.
//
// Positioning is a pure unit-tested helper: centered ABOVE the pet, flip below
// when there's no room, clamped — mirrors the bubble/card.

const path = require("path");

const WIDTH = 340;
const HEIGHT = 244;        // three staggered cards: status + usage + actions
const GAP = 3;
const MARGIN = 8;
const DISMISS_MS = 700;    // generous bridge from pet to HUD; cancelled on HUD enter
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
  let interactive = false;

  function restorePetInputLayer() {
    if (typeof ctx.restorePetInputLayer === "function") {
      try { ctx.restorePetInputLayer(); } catch {}
    }
  }

  function setMousePassthrough(passThrough) {
    if (!win || win.isDestroyed() || typeof win.setIgnoreMouseEvents !== "function") return;
    try {
      win.setIgnoreMouseEvents(!!passThrough, { forward: true });
    } catch {
      try { win.setIgnoreMouseEvents(!!passThrough); } catch {}
    }
  }

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
    setMousePassthrough(true);
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

  function pointInRect(point, rect, pad = 0) {
    if (!point || !rect) return false;
    return point.x >= rect.x - pad
      && point.x <= rect.x + rect.width + pad
      && point.y >= rect.y - pad
      && point.y <= rect.y + rect.height + pad;
  }

  function cursorInCombinedZone() {
    try {
      const { screen } = require("electron");
      const cursor = screen.getCursorScreenPoint();
      if (win && !win.isDestroyed() && win.isVisible() && pointInRect(cursor, win.getBounds(), 10)) {
        return true;
      }
      if (typeof ctx.getPetWindowBounds === "function") {
        const petBounds = ctx.getPetWindowBounds();
        if (pointInRect(cursor, petBounds, 18)) return true;
      }
      if (typeof ctx.getExtraHoverBounds === "function") {
        const rects = ctx.getExtraHoverBounds();
        if (Array.isArray(rects)) {
          for (const rect of rects) {
            if (pointInRect(cursor, rect, 10)) return true;
          }
        }
      }
    } catch {}
    return false;
  }

  function show() {
    if (ctx.petHidden) return;
    cancelDismiss();
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
    const w = ensure();
    const send = () => {
      position();
      if (w && !w.isDestroyed()) {
        const sessionSnapshot = typeof ctx.getSessionSnapshot === "function"
          ? ctx.getSessionSnapshot()
          : null;
        try { w.webContents.send("glassbox-hud-context", { sessionSnapshot }); } catch {}
        try { w.showInactive(); } catch {}
        try { w.webContents.send("glassbox-hud-show"); } catch {}
        restorePetInputLayer();
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

  function refreshUsage(force) {
    if (typeof ctx.getUsage !== "function") return;
    const w = ensure();
    Promise.resolve(ctx.getUsage({ force: !!force })).then((u) => {
      try { if (w && !w.isDestroyed()) w.webContents.send("glassbox-hud-usage", u); } catch {}
    }).catch(() => {});
  }

  function setInteractive(on) {
    if (!win || win.isDestroyed()) return;
    interactive = !!on;
    setMousePassthrough(!interactive);
    try { win.setFocusable(interactive); } catch {}
    restorePetInputLayer();
  }

  function openPanel(panel) {
    const w = ensure();
    show();
    const send = () => {
      try { w.webContents.send("glassbox-hud-panel", { panel }); } catch {}
      if (panel === "chat") {
        setInteractive(true);
        try { w.focus(); } catch {}
      } else {
        setInteractive(false);
      }
    };
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", send);
    else send();
  }

  function renderCard(payload) {
    const w = ensure();
    show();
    const send = () => {
      try { w.webContents.send("glassbox-hud-card", payload); } catch {}
      if (payload && payload.mode === "permission") {
        setInteractive(true);
        try { w.focus(); } catch {}
      }
    };
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", send);
    else send();
  }

  function hideCard() {
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send("glassbox-hud-card-hide"); } catch {}
  }

  // Delayed collapse (combined-zone leave). Cancelled by any re-enter.
  function scheduleDismiss() {
    cancelDismiss();
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      if (cursorInCombinedZone()) {
        scheduleDismiss();
        return;
      }
      hide();
    }, DISMISS_MS);
  }

  function hide() {
    cancelDismiss();
    if (!win || win.isDestroyed()) return;
    setInteractive(false);
    try { win.webContents.send("glassbox-hud-hide"); } catch {}
    if (collapseTimer) clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      if (win && !win.isDestroyed()) { try { win.hide(); } catch {} }
    }, COLLAPSE_MS);
  }

  function reposition() { position(); }

  function refresh() {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    try {
      const sessionSnapshot = typeof ctx.getSessionSnapshot === "function"
        ? ctx.getSessionSnapshot()
        : null;
      win.webContents.send("glassbox-hud-context", { sessionSnapshot });
    } catch {}
  }

  function cleanup() {
    cancelDismiss();
    if (collapseTimer) clearTimeout(collapseTimer);
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }

  return {
    show,
    refreshUsage,
    openPanel,
    renderCard,
    hideCard,
    setInteractive,
    scheduleDismiss,
    cancelDismiss,
    hide,
    reposition,
    refresh,
    cleanup,
    getWindow: () => win,
  };
}

module.exports = initGlassboxHud;
module.exports.initGlassboxHud = initGlassboxHud;
module.exports.__test = { computeHudBounds };
