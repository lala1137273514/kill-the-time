"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { parseStreamLine, streamArgs } = require("../src/glassbox-stream");

// Real-ish `claude --output-format stream-json --verbose` lines. Each line is one
// JSON object. We turn it into a short, privacy-safe card line — fixed category
// phrases for tools, a short truncation of the assistant's OWN narration text.

describe("glassbox-stream parseStreamLine", () => {
  it("non-JSON / garbage -> null (tolerant)", () => {
    assert.strictEqual(parseStreamLine("not json at all"), null);
    assert.strictEqual(parseStreamLine(""), null);
    assert.strictEqual(parseStreamLine(null), null);
    assert.strictEqual(parseStreamLine("{ broken json"), null);
    assert.strictEqual(parseStreamLine("123"), null);
  });

  it("unrecognized event type -> null", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "abc" });
    assert.strictEqual(parseStreamLine(line), null);
  });

  it("assistant text message -> say with a short truncation of the assistant's own text", () => {
    const text =
      "我先看一下项目结构，然后开始修改路由文件，确保改动是最小且安全的，再补上测试。";
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text }] },
    });
    const ev = parseStreamLine(line);
    assert.ok(ev, "should parse");
    assert.strictEqual(ev.kind, "say");
    assert.ok(ev.text.length > 0, "has text");
    assert.ok(ev.text.length <= 41, "truncated to ~40 chars (plus ellipsis)");
    assert.ok(text.startsWith(ev.text.replace(/[…\.]+$/, "")), "is a prefix of the assistant text");
  });

  it("assistant message with ONLY tool_use (no text) -> tool line, not say", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } }],
      },
    });
    const ev = parseStreamLine(line);
    assert.ok(ev);
    assert.strictEqual(ev.kind, "tool");
    assert.strictEqual(ev.text, "在执行命令");
  });

  it("tool_use Bash -> 在执行命令 (never the command)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "rm -rf /tmp/x" } },
        ],
      },
    });
    const ev = parseStreamLine(line);
    assert.deepStrictEqual(ev, { kind: "tool", text: "在执行命令" });
  });

  it("tool_use Edit -> 在改文件", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/a/b.js", old_string: "x", new_string: "y" } },
        ],
      },
    });
    assert.deepStrictEqual(parseStreamLine(line), { kind: "tool", text: "在改文件" });
  });

  it("tool_use Write -> 在改文件", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "Write", input: { file_path: "/a/c.js", content: "secret" } }] },
    });
    assert.deepStrictEqual(parseStreamLine(line), { kind: "tool", text: "在改文件" });
  });

  it("tool_use Read/Grep/Glob -> 在看代码", () => {
    for (const name of ["Read", "Grep", "Glob"]) {
      const line = JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t", name, input: { path: "/a" } }] },
      });
      assert.deepStrictEqual(parseStreamLine(line), { kind: "tool", text: "在看代码" });
    }
  });

  it("tool_use other tool -> 在调用工具", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "WebFetch", input: { url: "https://x" } }] },
    });
    assert.deepStrictEqual(parseStreamLine(line), { kind: "tool", text: "在调用工具" });
  });

  it("tool_result (user message) -> tool_done", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "总共 42 个文件" }],
      },
    });
    assert.deepStrictEqual(parseStreamLine(line), { kind: "tool_done", text: "这步完成" });
  });

  it("result success -> done", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Done — all set.",
      session_id: "abc",
    });
    assert.deepStrictEqual(parseStreamLine(line), { kind: "done", text: "搞定" });
  });

  it("result error -> error", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: "abc",
    });
    assert.deepStrictEqual(parseStreamLine(line), { kind: "error", text: "好像报错了" });
  });

  // PRIVACY (load-bearing): a tool_use carrying a secret path/command must map to
  // the fixed category phrase only — the secret must NOT appear in .text.
  it("privacy: a tool_use with a secret path -> fixed phrase, secret absent", () => {
    const secret = "C:\\Users\\me\\repos\\secret-project\\src\\auth\\token.js";
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t", name: "Edit", input: { file_path: secret, old_string: "API_KEY=sk-supersecret-1234567890", new_string: "x" } },
        ],
      },
    });
    const ev = parseStreamLine(line);
    assert.deepStrictEqual(ev, { kind: "tool", text: "在改文件" });
    assert.ok(!ev.text.includes("secret-project"), "no path segment");
    assert.ok(!ev.text.includes("token.js"), "no filename");
    assert.ok(!ev.text.includes("sk-supersecret-1234567890"), "no secret");
    assert.ok(!ev.text.includes("API_KEY"), "no identifier");
  });

  it("privacy: a Bash tool_use with a secret command -> fixed phrase only", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t", name: "Bash", input: { command: "curl -H 'Authorization: Bearer sk-supersecret' https://api.example.com" } },
        ],
      },
    });
    const ev = parseStreamLine(line);
    assert.strictEqual(ev.text, "在执行命令");
    assert.ok(!ev.text.includes("sk-supersecret"));
    assert.ok(!ev.text.includes("Authorization"));
    assert.ok(!ev.text.includes("api.example.com"));
  });

  it("assistant say is the agent's OWN narration, truncated — not tool input", () => {
    // A line that has BOTH narration text and a following tool_use: say wins and
    // is the narration prefix; never the tool command.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "好的，我现在执行命令。" },
          { type: "tool_use", id: "t", name: "Bash", input: { command: "rm -rf /etc/passwd" } },
        ],
      },
    });
    const ev = parseStreamLine(line);
    assert.strictEqual(ev.kind, "say");
    assert.ok(ev.text.includes("好的"));
    assert.ok(!ev.text.includes("rm -rf"), "tool command must not leak into say");
    assert.ok(!ev.text.includes("/etc/passwd"));
  });

  it("empty assistant text -> falls through to null (nothing to say)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "   " }] },
    });
    assert.strictEqual(parseStreamLine(line), null);
  });
});

describe("glassbox-stream streamArgs", () => {
  it("returns the dispatch args to append for stream-json", () => {
    assert.deepStrictEqual(streamArgs(), ["--output-format", "stream-json", "--verbose"]);
  });
});
