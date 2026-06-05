"use strict";

// Glass-box voice intent router (demo/kill-boring-loading, D3).
//
// Maps a transcribed utterance to what the user wants to do *during a wait*:
// approve/deny a pending permission, answer a pending clarification, or kick
// off a new task. Pure + context-aware: the caller passes what's currently
// pending; ASR transport and the actual /permission call live elsewhere.

// Word lists kept short and unambiguous. Matched against the utterance with
// punctuation/whitespace stripped so "批准。" and "批 准" both hit.
const APPROVE_RE = /(批准|通过|同意|确认|允许|没问题|准了|可以|好的|行|继续|ok|okay|yes|approve)/i;
const DENY_RE = /(拒绝|驳回|不行|不可以|不要|别动|取消|算了|停一下|停下|no|deny|cancel)/i;

function normalize(text) {
  return String(text || "")
    .trim()
    .replace(/[\s，。！？、,.!?]+/g, "");
}

// route(text, ctx) -> { action, text }
//   action: "approve" | "deny" | "answer" | "task" | "none"
//   ctx: { permissionPending?: bool, clarificationPending?: bool }
// Precedence: a pending permission owns approve/deny words; a pending
// clarification takes any other speech as the answer; otherwise it's a new task.
// Deny is checked before approve so "不可以" doesn't get caught by "可以".
function routeVoiceCommand(rawText, ctx = {}) {
  const text = String(rawText || "").trim();
  if (!text) return { action: "none", text: "" };

  const norm = normalize(text);

  if (ctx.permissionPending) {
    if (DENY_RE.test(norm)) return { action: "deny", text };
    if (APPROVE_RE.test(norm)) return { action: "approve", text };
  }

  if (ctx.clarificationPending) {
    return { action: "answer", text };
  }

  return { action: "task", text };
}

module.exports = { routeVoiceCommand, APPROVE_RE, DENY_RE, normalize };
