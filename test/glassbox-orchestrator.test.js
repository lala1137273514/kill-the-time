"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  resolveApiKey,
  resolveModel,
  summarizeWindow,
  buildSystemPrompt,
  buildRequest,
  extractContent,
  parseDecision,
  orchestrate,
} = require("../src/glassbox-orchestrator");

describe("glassbox-orchestrator helpers", () => {
  it("resolveApiKey prefers opts then BAILIAN_API_KEY", () => {
    assert.strictEqual(resolveApiKey({ apiKey: "k1" }), "k1");
    const saved = process.env.BAILIAN_API_KEY;
    process.env.BAILIAN_API_KEY = "envk";
    try {
      assert.strictEqual(resolveApiKey({}), "envk");
    } finally {
      if (saved === undefined) delete process.env.BAILIAN_API_KEY;
      else process.env.BAILIAN_API_KEY = saved;
    }
  });

  it("resolveApiKey throws when nothing is set", () => {
    const saved = process.env.BAILIAN_API_KEY;
    const savedD = process.env.DASHSCOPE_API_KEY;
    delete process.env.BAILIAN_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    try {
      assert.throws(() => resolveApiKey({}), /missing API key/);
    } finally {
      if (saved !== undefined) process.env.BAILIAN_API_KEY = saved;
      if (savedD !== undefined) process.env.DASHSCOPE_API_KEY = savedD;
    }
  });

  it("resolveModel honors opts then env then default", () => {
    assert.strictEqual(resolveModel({ model: "qwen-max" }), "qwen-max");
    const saved = process.env.CLAWD_ORCHESTRATOR_MODEL;
    process.env.CLAWD_ORCHESTRATOR_MODEL = "qwen-turbo";
    try {
      assert.strictEqual(resolveModel({}), "qwen-turbo");
    } finally {
      if (saved === undefined) delete process.env.CLAWD_ORCHESTRATOR_MODEL;
      else process.env.CLAWD_ORCHESTRATOR_MODEL = saved;
    }
    delete process.env.CLAWD_ORCHESTRATOR_MODEL;
    assert.ok(resolveModel({}).startsWith("qwen"));
  });

  it("summarizeWindow describes a matched session and an unmatched one", () => {
    const matched = summarizeWindow({ title: "成都5天 — Claude Code", sessionId: "s1", cwd: "C:/work/loona" });
    assert.ok(matched.includes("成都5天"));
    assert.ok(matched.includes("s1"));
    assert.ok(matched.includes("C:/work/loona"));

    const unmatched = summarizeWindow({ title: "Notepad", sessionId: null, cwd: null });
    assert.ok(unmatched.includes("Notepad"));
    assert.ok(/未匹配|no.*session/i.test(unmatched));
  });

  it("buildSystemPrompt asks for JSON with the decision fields", () => {
    const sys = buildSystemPrompt();
    assert.ok(/json/i.test(sys));
    assert.ok(sys.includes("dispatch"));
    assert.ok(sys.includes("chat"));
    assert.ok(sys.includes("refinedPrompt"));
    assert.ok(sys.includes("risk"));
    assert.ok(sys.includes("needCapture"));
  });

  it("buildSystemPrompt honors an injected systemPrompt override", () => {
    assert.strictEqual(buildSystemPrompt({ systemPrompt: "OVERRIDE" }), "OVERRIDE");
  });

  it("buildRequest targets DashScope compatible chat completions with the transcript", () => {
    const { endpoint, payload, headers } = buildRequest(
      "帮我整理当前窗口的内容",
      { window: { title: "Claude Code", sessionId: "s1", cwd: "/w" } },
      { apiKey: "kk", model: "qwen-plus" }
    );
    assert.ok(/compatible-mode\/v1\/chat\/completions/.test(endpoint));
    assert.strictEqual(payload.model, "qwen-plus");
    assert.strictEqual(payload.messages[0].role, "system");
    assert.strictEqual(payload.messages[1].role, "user");
    assert.ok(payload.messages[1].content.includes("帮我整理当前窗口的内容"));
    assert.ok(payload.messages[1].content.includes("Claude Code"));
    assert.strictEqual(headers.Authorization, "Bearer kk");
  });

  it("extractContent reads choices[0].message.content", () => {
    assert.strictEqual(
      extractContent({ choices: [{ message: { content: "hi" } }] }),
      "hi"
    );
    assert.strictEqual(extractContent({}), "");
  });

  it("parseDecision parses clean JSON and normalizes fields", () => {
    const d = parseDecision('{"action":"dispatch","refinedPrompt":"P","needCapture":true,"risk":"write","reply":"好的"}');
    assert.strictEqual(d.action, "dispatch");
    assert.strictEqual(d.refinedPrompt, "P");
    assert.strictEqual(d.needCapture, true);
    assert.strictEqual(d.risk, "write");
    assert.strictEqual(d.reply, "好的");
  });

  it("parseDecision strips code fences and surrounding prose", () => {
    const d = parseDecision('好的：\n```json\n{"action":"chat","reply":"在的"}\n```\n');
    assert.strictEqual(d.action, "chat");
    assert.strictEqual(d.reply, "在的");
  });

  it("parseDecision coerces needCapture to boolean and defaults risk to read", () => {
    const d = parseDecision('{"action":"dispatch","refinedPrompt":"P","needCapture":"yes"}');
    assert.strictEqual(d.needCapture, true);
    assert.strictEqual(d.risk, "read");
  });

  it("parseDecision throws on an unusable response (no silent fallback)", () => {
    assert.throws(() => parseDecision("totally not json"), /could not parse/);
    assert.throws(() => parseDecision('{"action":"banana"}'), /unknown action/);
  });
});

describe("glassbox-orchestrator orchestrate", () => {
  it("resolves approve/deny by rule when a permission is pending — no LLM call", async () => {
    let called = false;
    const fetchImpl = async () => { called = true; throw new Error("should not fetch"); };

    const approve = await orchestrate("批准", { permissionPending: true }, { fetchImpl, apiKey: "k" });
    assert.strictEqual(approve.action, "approve");

    const deny = await orchestrate("不批准", { permissionPending: true }, { fetchImpl, apiKey: "k" });
    assert.strictEqual(deny.action, "deny");

    assert.strictEqual(called, false);
  });

  it("treats speech during a pending clarification as an answer — no LLM call", async () => {
    let called = false;
    const fetchImpl = async () => { called = true; throw new Error("nope"); };
    const out = await orchestrate("用第二个方案", { clarificationPending: true }, { fetchImpl, apiKey: "k" });
    assert.strictEqual(out.action, "answer");
    assert.strictEqual(out.text, "用第二个方案");
    assert.strictEqual(called, false);
  });

  it("calls the light model for a normal utterance and returns the refined dispatch", async () => {
    let sentBody = null;
    const fetchImpl = async (url, init) => {
      sentBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"action":"dispatch","refinedPrompt":"整理 @shot.png 中窗口的要点为 markdown","needCapture":true,"risk":"read","reply":"好的，已让 Claude 处理"}' } }],
        }),
      };
    };
    const out = await orchestrate(
      "帮我整理一下当前窗口的内容",
      { window: { title: "Claude Code", sessionId: "s1", cwd: "/w" } },
      { fetchImpl, apiKey: "k", model: "qwen-plus" }
    );
    assert.strictEqual(out.action, "dispatch");
    assert.ok(out.refinedPrompt.includes("markdown"));
    assert.strictEqual(out.needCapture, true);
    assert.strictEqual(out.risk, "read");
    assert.ok(sentBody.messages[1].content.includes("帮我整理一下当前窗口的内容"));
  });

  it("passes a chat reply straight through", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"chat","reply":"它还在跑，再等等"}' } }] }),
    });
    const out = await orchestrate("它弄好了吗", {}, { fetchImpl, apiKey: "k" });
    assert.strictEqual(out.action, "chat");
    assert.strictEqual(out.reply, "它还在跑，再等等");
  });

  it("throws on an HTTP error (let it crash)", async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await assert.rejects(
      orchestrate("做点事", {}, { fetchImpl, apiKey: "k" }),
      /HTTP 429/
    );
  });
});
