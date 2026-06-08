"use strict";

// Glass-box stream-json PARSER (demo/kill-boring-loading, Phase 3).
//
// A dispatched `claude -p` run is a black box unless we ask it to stream. With
// `--output-format stream-json --verbose` claude emits ONE JSON object per stdout
// line (an event in the Anthropic Agent SDK / claude-code stream schema). This
// module turns one such line into a short, human, privacy-safe card line so the
// live card shows what the agent is actually doing.
//
// It sits BETWEEN glassbox-dispatch's onLine (raw lines) and the narrator: the
// raw JSON line goes in, a { kind, text } (or null) comes out. main.js forwards
// the result into narrator.observe({ source:"commentary", kind, text }).
//
// PRIVACY (load-bearing, mirrors glassbox-commentary): for a tool call we emit a
// FIXED category phrase keyed only on the tool NAME — the tool input (command,
// file path, content, secrets) NEVER reaches `text`. The single exception is the
// assistant "say", which is a short truncation of the assistant's OWN narration
// text (what it chose to tell the user), not any tool input.
//
// PURE: no I/O, no clock, no state. One line in, one event out. Let it crash is
// not the rule here — the input is untrusted stdout, so a non-JSON / unknown /
// garbage line must map to null (tolerant), NOT throw. The dispatch glue already
// isolates onLine throws, but a parser that throws on every junk line would spam.

// Fixed, human, highlight-only phrases — keyed on category, never derived from
// the raw event content (privacy).
const TOOL_TEXT = {
  cmd: "在执行命令",   // Bash and other shell-running tools
  edit: "在改文件",    // Edit / Write / MultiEdit / NotebookEdit
  read: "在看代码",    // Read / Grep / Glob (and other read/search tools)
  other: "在调用工具", // anything else
};

const RESULT_TEXT = {
  toolDone: "这步完成",
  done: "搞定",
  error: "好像报错了",
};

// ~40 chars of the assistant's own narration, with an ellipsis when truncated.
const SAY_MAX = 40;

// Map a tool NAME (only) to a fixed category phrase. Case-insensitive; unknown
// tools fall back to the generic "在调用工具". Returns ONLY a phrase from
// TOOL_TEXT — never the tool input.
function toolPhrase(name) {
  const n = String(name || "").toLowerCase();
  if (n === "bash") return TOOL_TEXT.cmd;
  if (n === "edit" || n === "write" || n === "multiedit" || n === "notebookedit") {
    return TOOL_TEXT.edit;
  }
  if (n === "read" || n === "grep" || n === "glob") return TOOL_TEXT.read;
  return TOOL_TEXT.other;
}

// Short truncation of the assistant's OWN narration text (privacy: this is the
// assistant's words to the user, not tool input). Collapses whitespace so a
// multi-line narration stays a one-line card.
function shorten(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= SAY_MAX) return s;
  return s.slice(0, SAY_MAX) + "…";
}

// Pull the first non-empty text block and the first tool_use from an assistant
// message's content array (claude streams an assistant turn as content blocks).
function readAssistantBlocks(content) {
  let text = "";
  let toolName = null;
  if (!Array.isArray(content)) return { text, toolName };
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && !text) {
      const t = String(block.text || "").trim();
      if (t) text = block.text;
    } else if (block.type === "tool_use" && !toolName) {
      toolName = block.name || "";
    }
  }
  return { text, toolName };
}

// parseStreamLine(line) -> { kind, text } | null
//   line: ONE line of `claude --output-format stream-json` (a JSON object).
// kinds: "say" | "tool" | "tool_done" | "done" | "error". Unknown/garbage -> null.
function parseStreamLine(line) {
  if (typeof line !== "string" || !line.trim()) return null;

  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return null; // non-JSON stdout (banners, progress dots) -> ignore
  }
  if (!ev || typeof ev !== "object") return null;

  const type = ev.type;

  // Final result event: success vs error.
  if (type === "result") {
    const isError = ev.is_error === true || (typeof ev.subtype === "string" && ev.subtype !== "success");
    return isError
      ? { kind: "error", text: RESULT_TEXT.error }
      : { kind: "done", text: RESULT_TEXT.done };
  }

  // Assistant turn: narration text wins (say); else a tool call (tool).
  if (type === "assistant") {
    const msg = ev.message || {};
    const { text, toolName } = readAssistantBlocks(msg.content);
    if (text) {
      const short = shorten(text);
      return short ? { kind: "say", text: short } : null;
    }
    if (toolName != null) {
      return { kind: "tool", text: toolPhrase(toolName) };
    }
    return null;
  }

  // tool_result comes back as a user message carrying a tool_result block.
  if (type === "user") {
    const content = ev.message && ev.message.content;
    if (Array.isArray(content) && content.some((b) => b && b.type === "tool_result")) {
      return { kind: "tool_done", text: RESULT_TEXT.toolDone };
    }
    return null;
  }

  // system/init and anything else: not card-worthy.
  return null;
}

// The dispatch args that make claude emit the stream this parser reads. The
// integration appends these to the claude run's args; `--verbose` is required by
// claude for stream-json on a -p (print) run.
function streamArgs() {
  return ["--output-format", "stream-json", "--verbose"];
}

module.exports = { parseStreamLine, streamArgs, TOOL_TEXT, RESULT_TEXT };
