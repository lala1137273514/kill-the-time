"use strict";

// Glass-box light-model orchestrator (demo/kill-boring-loading, Phase 2).
//
// This is the first time clawd carries an LLM of its own. It's a SMALL, fast
// model whose only job is to turn a wait-time utterance into a decision:
//   - dispatch: send a refined prompt to a host agent (Claude/Codex)
//   - chat:     answer the user in-line while a dispatched run keeps going
//   - approve/deny/answer: handled by RULE (glassbox-intent), never the LLM,
//     because approving a tool you didn't mean to is the dangerous direction.
//
// Per REMOTE-CONTROL-SPEC §4 decision 2 the user picked a Bailian-hosted qwen
// model (reuse BAILIAN_API_KEY), via the DashScope OpenAI-compatible endpoint.
// Network + key are injected (fetchImpl, apiKey) so request/parse logic is
// unit-testable. Let it crash: missing key, HTTP error, or an unparseable
// decision throws — no silent fallback.

const { routeVoiceCommand } = require("./glassbox-intent");

const DEFAULT_ENDPOINT =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
// qwen-plus balances Chinese quality / latency for short orchestration turns;
// override with CLAWD_ORCHESTRATOR_MODEL (e.g. qwen-turbo for more speed).
const DEFAULT_MODEL = "qwen-plus";

function resolveApiKey(opts = {}) {
  const key = opts.apiKey || process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!key) {
    throw new Error("glassbox-orchestrator: missing API key (pass apiKey or set BAILIAN_API_KEY)");
  }
  return key;
}

function resolveModel(opts = {}) {
  return opts.model || process.env.CLAWD_ORCHESTRATOR_MODEL || DEFAULT_MODEL;
}

// One-line context the model needs to refine the prompt and decide capture.
function summarizeWindow(window) {
  if (!window || typeof window !== "object") return "前台窗口: 未知";
  const title = window.title || "(无标题)";
  if (window.sessionId) {
    const cwd = window.cwd ? `, cwd ${window.cwd}` : "";
    return `前台窗口: "${title}"（已匹配 agent 会话 ${window.sessionId}${cwd}）`;
  }
  return `前台窗口: "${title}"（未匹配到已知 agent 会话 / no known session）`;
}

function buildSystemPrompt() {
  return [
    "你是桌面宠物 clawd 的语音编排脑。用户在盯着某个窗口、动嘴让你把活派给一个编程 agent（Claude Code / Codex）去干。",
    "你只做三件事之一，绝不自己写代码或执行工具：",
    "1) dispatch：用户想派活。把口语优化成精确、可执行的 prompt（refinedPrompt）。如果任务和「当前窗口/这个/屏幕上」有关，把 needCapture 设为 true，并在 refinedPrompt 里用 @shot.png 引用截图。",
    "2) chat：用户在闲聊或问进度，不需要派活。把要说的话放进 reply（一句话，口语、像人）。",
    "判断 risk：如果优化后的任务会写文件/删文件/改代码/联网提交，risk=write；只读/总结/查看类 risk=read。",
    "只输出一个 JSON 对象，不要任何额外文字：",
    '{"action":"dispatch"|"chat","refinedPrompt":string,"needCapture":boolean,"risk":"read"|"write","reply":string}',
    "dispatch 时 reply 是一句简短回执（如「好的，已让 Claude 处理」）；chat 时 refinedPrompt 留空字符串。",
  ].join("\n");
}

function buildUserPrompt(transcript, ctx = {}) {
  const lines = [`用户说："${transcript}"`];
  if (ctx.window) lines.push(summarizeWindow(ctx.window));
  return lines.join("\n");
}

function buildRequest(transcript, ctx = {}, opts = {}) {
  const endpoint = opts.endpoint || process.env.DASHSCOPE_CHAT_ENDPOINT || DEFAULT_ENDPOINT;
  const payload = {
    model: resolveModel(opts),
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(transcript, ctx) },
    ],
    temperature: Number.isFinite(opts.temperature) ? opts.temperature : 0.2,
  };
  const headers = {
    Authorization: `Bearer ${resolveApiKey(opts)}`,
    "Content-Type": "application/json",
  };
  return { endpoint, payload, headers };
}

function extractContent(data) {
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const content = choice && choice.message && choice.message.content;
  return typeof content === "string" ? content : "";
}

const VALID_ACTIONS = new Set(["dispatch", "chat"]);

function coerceBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(true|yes|1|是|需要)$/i.test(value.trim());
  return Boolean(value);
}

// Lenient JSON extraction: model may wrap the object in ```json fences or
// surrounding prose. Pull the first balanced {...} and parse it.
function parseDecision(content) {
  const text = String(content || "").trim();
  let jsonText = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();
  if (!jsonText.startsWith("{")) {
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start !== -1 && end > start) jsonText = jsonText.slice(start, end + 1);
  }
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error(`glassbox-orchestrator: could not parse decision from model output`);
  }
  const action = data && typeof data.action === "string" ? data.action.trim() : "";
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`glassbox-orchestrator: unknown action "${action}"`);
  }
  return {
    action,
    refinedPrompt: typeof data.refinedPrompt === "string" ? data.refinedPrompt : "",
    needCapture: coerceBool(data.needCapture),
    risk: data.risk === "write" ? "write" : "read",
    reply: typeof data.reply === "string" ? data.reply : "",
  };
}

// orchestrate(transcript, ctx, opts) -> decision
//   ctx: { permissionPending?, clarificationPending?, window? }
//   decision: { action, refinedPrompt?, needCapture?, risk?, reply?, text? }
// Rule layer (intent.js) owns approve/deny/answer; everything else asks the
// light model. Deny is checked before approve inside routeVoiceCommand.
async function orchestrate(transcript, ctx = {}, opts = {}) {
  const text = String(transcript || "").trim();
  if (!text) return { action: "none", text: "" };

  if (ctx.permissionPending || ctx.clarificationPending) {
    const routed = routeVoiceCommand(text, ctx);
    if (routed.action !== "task") return routed;
    // A pending permission but the words weren't approve/deny: fall through to
    // the model so the user can still chat / dispatch.
  }

  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) throw new Error("glassbox-orchestrator: no fetch implementation available");

  const { endpoint, payload, headers } = buildRequest(text, ctx, opts);
  const resp = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`glassbox-orchestrator: chat HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const decision = parseDecision(extractContent(data));
  return { ...decision, text };
}

module.exports = {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  resolveApiKey,
  resolveModel,
  summarizeWindow,
  buildSystemPrompt,
  buildUserPrompt,
  buildRequest,
  extractContent,
  parseDecision,
  orchestrate,
};
