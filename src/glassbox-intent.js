"use strict";

// Glass-box voice intent router (demo/kill-boring-loading, D3).
//
// Maps a transcribed utterance to what the user wants to do *during a wait*:
// approve/deny a pending permission, answer a pending clarification, or kick
// off a new task. Pure + context-aware: the caller passes what's currently
// pending; ASR transport and the actual /permission call live elsewhere.

// Approving a tool the user didn't mean to is the dangerous direction (it runs
// real commands), so APPROVE only fires on strong, unambiguous words — NOT on
// conversational fillers like 好的/行/可以/ok, which whisper readily hallucinates
// from near-silence. DENY is checked first and includes the negated forms
// (不批准/不同意…) so "不批准" denies instead of matching the embedded "批准".
const DENY_RE = /(不批准|别批准|不同意|不通过|不允许|拒绝|驳回|否决|不行|不可以|不要|别动|取消|算了|停一下|停下|no|deny|cancel)/i;
const APPROVE_RE = /(批准|通过|同意|确认|授权|允许|approve|allow)/i;

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
