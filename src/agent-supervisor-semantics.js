"use strict";

// Shared "supervisor" semantics for HUD + narration. The state machine keeps
// the canonical animation state; this module turns the same session snapshot
// into human-facing Chinese labels so every surface describes the work the same
// way.

const WAITING_EVENTS = new Set(["PermissionRequest", "Elicitation"]);
const INPUT_EVENTS = new Set(["Notification"]);
const COMPACTING_EVENTS = new Set(["PreCompact", "PreCompress"]);
const COMPACTED_EVENTS = new Set(["PostCompact", "event_msg:context_compacted"]);
const ERROR_EVENTS = new Set(["PostToolUseFailure", "StopFailure", "ApiError"]);
const DONE_EVENTS = new Set(["Stop", "PostCompact", "event_msg:task_complete"]);

const AGENT_LABELS = Object.freeze({
  "claude-code": "Claude Code",
  codex: "Codex",
  "copilot-cli": "Copilot",
  "gemini-cli": "Gemini",
  "cursor-agent": "Cursor",
  "codebuddy": "CodeBuddy",
  "kiro-cli": "Kiro",
  "kimi-cli": "Kimi",
  "qwen-code": "Qwen Code",
  opencode: "opencode",
  "antigravity-cli": "Antigravity",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  pi: "Pi",
});

const EVENT_LABELS = Object.freeze({
  SessionStart: "会话开始",
  UserPromptSubmit: "收到任务",
  PreToolUse: "准备调用工具",
  PostToolUse: "工具返回",
  PostToolUseFailure: "工具失败",
  Stop: "任务完成",
  StopFailure: "执行中断",
  ApiError: "接口报错",
  PermissionRequest: "请求权限",
  Elicitation: "需要你回答",
  Notification: "等待输入",
  SubagentStart: "子任务启动",
  SubagentStop: "子任务结束",
  PreCompact: "压缩上下文",
  PreCompress: "压缩上下文",
  PostCompact: "压缩完成",
  WorktreeCreate: "准备工作区",
  "event_msg:task_complete": "任务完成",
  "event_msg:context_compacted": "上下文已压缩",
});

function rawEventOf(session) {
  return session && session.lastEvent && typeof session.lastEvent.rawEvent === "string"
    ? session.lastEvent.rawEvent
    : null;
}

function truncate(value, max = 24) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}...` : s;
}

function agentLabelOf(session) {
  const id = session && session.agentId;
  if (!id) return "Agent";
  return AGENT_LABELS[id] || id;
}

function toolLabelOf(session) {
  const tool = truncate(session && session.currentTool, 22);
  return tool || "";
}

function eventLabelOf(rawEvent) {
  if (!rawEvent) return "";
  return EVENT_LABELS[rawEvent] || rawEvent;
}

function recentTextOf(session) {
  const raw = rawEventOf(session);
  const event = eventLabelOf(raw);
  const tool = toolLabelOf(session);
  if (event && tool) return `${event} · ${tool}`;
  return event || tool || "观察中";
}

function classifySession(session) {
  if (!session) {
    return {
      kind: "idle",
      phase: "待命",
      chip: "idle",
      dot: "quiet",
      headline: "Clawd 待命",
      detail: "鼠标靠近就会醒来",
      recent: "眼动 / 呼吸 / 睡眠序列就绪",
      animation: "idle",
      waiting: false,
    };
  }

  const raw = rawEventOf(session);
  const state = session.state || "idle";
  const badge = session.badge || "idle";
  const agent = agentLabelOf(session);
  const tool = toolLabelOf(session);
  const subagents = Number.isFinite(session.subagentCount) ? session.subagentCount : 0;
  const recent = recentTextOf(session);

  if (WAITING_EVENTS.has(raw)) {
    return {
      kind: "waiting",
      phase: raw === "Elicitation" ? "等待回答" : "等待确认",
      chip: raw === "Elicitation" ? "需回答" : "待确认",
      dot: "attention",
      headline: `${agent} 等你处理`,
      detail: raw === "Elicitation" ? "需要补充答案后才能继续" : "需要批准或拒绝工具权限",
      recent,
      animation: "permission/waiting",
      waiting: true,
    };
  }

  if (INPUT_EVENTS.has(raw) && badge !== "running") {
    return {
      kind: "waiting",
      phase: "等待输入",
      chip: "等你",
      dot: "attention",
      headline: `${agent} 等你继续`,
      detail: "上一轮已停下，需要你的下一步指令",
      recent,
      animation: "permission/waiting",
      waiting: true,
    };
  }

  if (ERROR_EVENTS.has(raw) || badge === "interrupted" || state === "error") {
    return {
      kind: "error",
      phase: "报错 / 检查",
      chip: "error",
      dot: "bad",
      headline: `${agent} 卡住了`,
      detail: tool ? `最近失败在 ${tool}` : "需要看一下终端里的错误",
      recent,
      animation: "error/debugging",
      waiting: false,
    };
  }

  if (COMPACTING_EVENTS.has(raw) || state === "sweeping") {
    return {
      kind: "compacting",
      phase: "压缩上下文",
      chip: "清扫",
      dot: "running",
      headline: `${agent} 正在清理上下文`,
      detail: "在压缩/整理历史，稍后会继续",
      recent,
      animation: "compacting",
      waiting: false,
    };
  }

  if (COMPACTED_EVENTS.has(raw)) {
    return {
      kind: "compacted",
      phase: "压缩完成",
      chip: "done",
      dot: "done",
      headline: `${agent} 压缩好了`,
      detail: "上下文已整理，可以继续派活",
      recent,
      animation: "done",
      waiting: false,
    };
  }

  if (badge === "done" || DONE_EVENTS.has(raw)) {
    return {
      kind: "done",
      phase: "完成",
      chip: "done",
      dot: "done",
      headline: `${agent} 完成了`,
      detail: "结果已回到会话里，等你查看",
      recent,
      animation: "done",
      waiting: false,
    };
  }

  if (subagents >= 2 || (state === "juggling" && subagents >= 2)) {
    return {
      kind: "subagent-multi",
      phase: "多子任务编排",
      chip: `x${subagents}`,
      dot: "running",
      headline: `${agent} 正在编排 ${subagents} 个子任务`,
      detail: "我在盯并行进度，等它们收束",
      recent,
      animation: "subagent multi",
      waiting: false,
    };
  }

  if (state === "juggling" || subagents === 1) {
    return {
      kind: "subagent-single",
      phase: "子任务执行",
      chip: "sub",
      dot: "running",
      headline: `${agent} 派出一个子任务`,
      detail: "后台分支在查，我继续监工",
      recent,
      animation: "subagent single",
      waiting: false,
    };
  }

  if (state === "thinking") {
    return {
      kind: "thinking",
      phase: "思考 / 规划",
      chip: "thinking",
      dot: "running",
      headline: `${agent} 在拆解任务`,
      detail: "先判断路径和风险，再动手",
      recent,
      animation: "thinking",
      waiting: false,
    };
  }

  if (state === "working") {
    return {
      kind: "working",
      phase: tool ? `执行 ${tool}` : "执行中",
      chip: tool || "working",
      dot: "running",
      headline: `${agent} 正在干活`,
      detail: tool ? `当前工具：${tool}` : "正在调用工具或写入改动",
      recent,
      animation: "working",
      waiting: false,
    };
  }

  if (state === "carrying") {
    return {
      kind: "preparing",
      phase: "准备工作区",
      chip: "setup",
      dot: "running",
      headline: `${agent} 在搬运上下文`,
      detail: "正在准备工作区或下载更新",
      recent,
      animation: "dragging/carrying",
      waiting: false,
    };
  }

  return {
    kind: "idle",
    phase: "待命",
    chip: "idle",
    dot: "quiet",
    headline: `${agent} 暂时空闲`,
    detail: "没有正在执行的步骤",
    recent,
    animation: "idle",
    waiting: false,
  };
}

function isWaitingSession(session) {
  return classifySession(session).waiting === true;
}

function isCompactingSession(session) {
  const kind = classifySession(session).kind;
  return kind === "compacting" || kind === "compacted";
}

function inferDisplayHintFromTool({ state, event, toolName, displayHintMap = {} } = {}) {
  if (state !== "working" && state !== "thinking" && state !== "juggling") return undefined;
  const name = String(toolName || "").toLowerCase();
  const candidates = [];
  if (
    event === "PostToolUseFailure"
    || /debug|diagnostic|test|lint|grep|glob|search|read|web|inspect|check/.test(name)
  ) {
    candidates.push("clawd-working-debugger.svg");
  }
  if (/bash|shell|exec|build|compile|write|edit|patch|apply/.test(name)) {
    candidates.push("clawd-working-building.svg");
  }
  for (const candidate of candidates) {
    if (displayHintMap && displayHintMap[candidate] != null) return candidate;
  }
  return undefined;
}

module.exports = {
  WAITING_EVENTS,
  INPUT_EVENTS,
  COMPACTING_EVENTS,
  COMPACTED_EVENTS,
  ERROR_EVENTS,
  DONE_EVENTS,
  AGENT_LABELS,
  rawEventOf,
  agentLabelOf,
  eventLabelOf,
  recentTextOf,
  classifySession,
  isWaitingSession,
  isCompactingSession,
  inferDisplayHintFromTool,
};
