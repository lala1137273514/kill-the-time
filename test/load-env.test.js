"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { parseEnv, loadEnvFile } = require("../src/load-env");

describe("load-env parseEnv", () => {
  it("parses KEY=value lines", () => {
    assert.deepStrictEqual(parseEnv("A=1\nB=two"), { A: "1", B: "two" });
  });

  it("skips blank lines and # comments", () => {
    assert.deepStrictEqual(parseEnv("# a comment\n\nA=1\n   # indented comment\nB=2\n"), { A: "1", B: "2" });
  });

  it("strips surrounding single or double quotes", () => {
    assert.deepStrictEqual(parseEnv('A="hello"\nB=\'world\''), { A: "hello", B: "world" });
  });

  it("keeps '=' inside the value (splits on first =)", () => {
    assert.deepStrictEqual(parseEnv("URL=https://x?a=b&c=d"), { URL: "https://x?a=b&c=d" });
  });

  it("tolerates a leading 'export ' and trims whitespace", () => {
    assert.deepStrictEqual(parseEnv("export KEY = sk-123 \n"), { KEY: "sk-123" });
  });

  it("ignores lines without '='", () => {
    assert.deepStrictEqual(parseEnv("NOPE\nA=1"), { A: "1" });
  });
});

describe("load-env loadEnvFile", () => {
  it("returns [] and does not throw when the file is missing", () => {
    const env = {};
    const got = loadEnvFile("/no/such/.env", { env, readFileImpl: () => { throw Object.assign(new Error("nope"), { code: "ENOENT" }); } });
    assert.deepStrictEqual(got, []);
    assert.deepStrictEqual(env, {});
  });

  it("sets keys that are unset and never overrides an existing env var", () => {
    const env = { BAILIAN_API_KEY: "from-shell" };
    const got = loadEnvFile("/fake/.env", {
      env,
      readFileImpl: () => "BAILIAN_API_KEY=from-file\nCLAWD_WHISPER_MODEL=small",
    });
    assert.strictEqual(env.BAILIAN_API_KEY, "from-shell"); // shell wins
    assert.strictEqual(env.CLAWD_WHISPER_MODEL, "small");   // filled from file
    assert.deepStrictEqual(got.sort(), ["CLAWD_WHISPER_MODEL"]);
  });
});
