"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createConversation } = require("../src/glassbox-conversation");

describe("glassbox-conversation createConversation", () => {
  it("records interleaved user/assistant turns in chronological order", () => {
    const conv = createConversation({ maxTurns: 8 });
    conv.appendUser("帮我查下天气");
    conv.appendAssistant("北京今天晴，18 度");
    conv.appendUser("那明天呢？");
    conv.appendAssistant("明天有小雨");

    assert.deepStrictEqual(conv.messages(), [
      { role: "user", content: "帮我查下天气" },
      { role: "assistant", content: "北京今天晴，18 度" },
      { role: "user", content: "那明天呢？" },
      { role: "assistant", content: "明天有小雨" },
    ]);
    assert.strictEqual(conv.size(), 4);
  });

  it("trims oldest messages beyond maxTurns*2, keeping the most recent", () => {
    const conv = createConversation({ maxTurns: 2 }); // cap = 4 messages
    conv.appendUser("u1");
    conv.appendAssistant("a1");
    conv.appendUser("u2");
    conv.appendAssistant("a2");
    conv.appendUser("u3"); // pushes u1 out
    conv.appendAssistant("a3"); // pushes a1 out

    assert.strictEqual(conv.size(), 4);
    assert.deepStrictEqual(conv.messages(), [
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a3" },
    ]);
  });

  it("ignores empty / whitespace-only text (not appended)", () => {
    const conv = createConversation({ maxTurns: 8 });
    conv.appendUser("");
    conv.appendUser("   ");
    conv.appendAssistant("\n\t");
    assert.strictEqual(conv.size(), 0);
    assert.deepStrictEqual(conv.messages(), []);

    conv.appendUser("  有空格的内容  ");
    assert.deepStrictEqual(conv.messages(), [{ role: "user", content: "有空格的内容" }]);
  });

  it("clear() empties the buffer", () => {
    const conv = createConversation({ maxTurns: 8 });
    conv.appendUser("u1");
    conv.appendAssistant("a1");
    assert.strictEqual(conv.size(), 2);
    conv.clear();
    assert.strictEqual(conv.size(), 0);
    assert.deepStrictEqual(conv.messages(), []);
  });

  it("messages() returns a copy that cannot mutate the buffer", () => {
    const conv = createConversation({ maxTurns: 8 });
    conv.appendUser("u1");
    const out = conv.messages();
    out.push({ role: "user", content: "injected" });
    out[0].content = "tampered";
    assert.deepStrictEqual(conv.messages(), [{ role: "user", content: "u1" }]);
  });

  it("defaults maxTurns to 8 (cap = 16) when omitted", () => {
    const conv = createConversation();
    for (let i = 0; i < 20; i++) conv.appendUser("u" + i);
    assert.strictEqual(conv.size(), 16);
    assert.strictEqual(conv.messages()[0].content, "u4"); // oldest 4 trimmed
  });

  it("rejects an invalid maxTurns (let it crash)", () => {
    assert.throws(() => createConversation({ maxTurns: 0 }));
    assert.throws(() => createConversation({ maxTurns: -1 }));
    assert.throws(() => createConversation({ maxTurns: 1.5 }));
  });
});
