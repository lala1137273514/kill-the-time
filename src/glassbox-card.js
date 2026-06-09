"use strict";

// Glass-box live CARD — the bigger sibling of the thought bubble.
//
// The 220x60 bubble truncates the moment a step has more than a few words, so
// the card is a roomier (~320x200) frameless transparent window that floats on
// the pet and never truncates: it wraps status text, scrolls a live list of
// agent actions (the "visible terminal" during a dispatch), shows chat replies
// in full, and — in permission mode — becomes focusable with 批准 / 拒绝 buttons.
//
// Positioning mirrors computeGlassboxBubbleBounds (center on the visible pet,
// flip above/below, clamp). The bounds helper is pure so it's unit-tested under
// plain node; electron is required lazily.

const path = require("path");

const WIDTH = 320;
const HEIGHT = 200;
const SPEECH_HEIGHT = 84;
const STATUS_HEIGHT = 92;
const ACTIVITY_HEIGHT = 150;
const CHAT_HEIGHT = 142;
const PERMISSION_HEIGHT = 186;
const GAP = 8;
const MARGIN = 8;
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// Centered above the pet; flips below when there's no room; clamped to the work
// area. Pure so it's unit-tested without Electron. Mirrors the bubble helper.
function computeCardBounds({ petBounds, workArea, width, height, gap = GAP, margin = MARGIN }) {
  // Center on the pet's VISIBLE portion (clipped to the work area) so an
  // edge-docked / half-off-screen pet still gets the card by its visible part.
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

function initGlassboxCard(ctx = {}) {
  let card = null;
  let hideTimer = null;
  let currentHeight = STATUS_HEIGHT;

  function heightForPayload(payload) {
    const mode = payload && payload.mode;
    if (mode === "speech") return SPEECH_HEIGHT;
    if (mode === "permission") return PERMISSION_HEIGHT;
    if (mode === "activity") return ACTIVITY_HEIGHT;
    if (mode === "chat") return CHAT_HEIGHT;
    return STATUS_HEIGHT;
  }

  function ensure() {
    if (card && !card.isDestroyed()) return card;
    const { BrowserWindow } = require("electron");
    card = new BrowserWindow({
      width: WIDTH, height: STATUS_HEIGHT, show: false, frame: false, transparent: true,
      alwaysOnTop: true, resizable: false, skipTaskbar: true, hasShadow: false, focusable: false,
      ...(isMac ? { type: "panel" } : {}),
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
    });
    if (isWin) card.setAlwaysOnTop(true, "pop-up-menu");
    card.loadFile(path.join(__dirname, "glassbox-card.html"));
    card.on("closed", () => { card = null; });
    return card;
  }

  function position() {
    if (!card || card.isDestroyed()) return;
    if (typeof ctx.getPetWindowBounds !== "function" || typeof ctx.getNearestWorkArea !== "function") return;
    const pb = ctx.getPetWindowBounds();
    if (!pb) return;
    const wa = ctx.getNearestWorkArea(pb.x + pb.width / 2, pb.y + pb.height / 2);
    try { card.setBounds(computeCardBounds({ petBounds: pb, workArea: wa, width: WIDTH, height: currentHeight })); } catch {}
  }

  function render(payload) {
    if (ctx.petHidden) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    currentHeight = heightForPayload(payload);
    const win = ensure();
    // Permission mode needs the buttons to be clickable, so the card grabs
    // focus; every other mode stays inactive so it never steals the user's
    // current window.
    const wantsFocus = !!(payload && payload.mode === "permission");
    try { win.setFocusable(wantsFocus); } catch {}
    const send = () => {
      position();
      if (win && !win.isDestroyed()) {
        try { win.webContents.send("glassbox-card-render", payload); } catch {}
        try {
          if (wantsFocus) win.show();
          else win.showInactive();
        } catch {}
      }
    };
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
    else send();
    // Auto-dismiss so the card never sticks. Permission stays until resolved;
    // a terminal status clears fast; everything else has a safety-net timeout.
    const m = payload && payload.mode;
    const delay = m === "permission" ? 0
      : m === "speech" ? 5200
      : (m === "status" && payload && payload.terminal) ? 2500
      : m === "chat" ? 6000
      : 8000;
    if (delay > 0) hideTimer = setTimeout(hide, delay);
  }

  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (card && !card.isDestroyed()) {
      try { card.webContents.send("glassbox-card-hide"); } catch {}
      try { card.setFocusable(false); } catch {}
      try { card.hide(); } catch {}
    }
  }

  function reposition() { position(); }

  function cleanup() {
    if (hideTimer) clearTimeout(hideTimer);
    if (card && !card.isDestroyed()) card.destroy();
    card = null;
  }

  return { render, hide, reposition, cleanup, getWindow: () => card };
}

module.exports = initGlassboxCard;
module.exports.initGlassboxCard = initGlassboxCard;
module.exports.__test = { computeCardBounds };
