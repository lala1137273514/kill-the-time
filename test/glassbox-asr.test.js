"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");

const {
  resolveBinary,
  buildArgs,
  jsonOutputPath,
  parseTranscript,
  transcribe,
} = require("../src/glassbox-asr");

// Fake child process: emits close/error on demand; stdout/stderr are emitters.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  return child;
}

describe("glassbox-asr helpers", () => {
  it("resolveBinary prefers explicit bin then env", () => {
    assert.strictEqual(resolveBinary({ bin: "C:/w.exe" }), "C:/w.exe");
    const saved = process.env.CLAWD_WHISPER_BIN;
    process.env.CLAWD_WHISPER_BIN = "C:/env.exe";
    try {
      assert.strictEqual(resolveBinary({}), "C:/env.exe");
    } finally {
      if (saved === undefined) delete process.env.CLAWD_WHISPER_BIN;
      else process.env.CLAWD_WHISPER_BIN = saved;
    }
  });

  it("resolveBinary throws when nothing is set", () => {
    const saved = process.env.CLAWD_WHISPER_BIN;
    delete process.env.CLAWD_WHISPER_BIN;
    try {
      assert.throws(() => resolveBinary({}), /no whisper binary/);
    } finally {
      if (saved !== undefined) process.env.CLAWD_WHISPER_BIN = saved;
    }
  });

  it("buildArgs emits whisper-style JSON-output args", () => {
    const args = buildArgs("/tmp/a.wav", "/tmp/out", { model: "small", language: "zh" });
    assert.strictEqual(args[0], "/tmp/a.wav");
    assert.ok(args.includes("--output_format") && args.includes("json"));
    assert.ok(args.includes("--language") && args.includes("zh"));
    assert.ok(args.includes("--output_dir") && args.includes("/tmp/out"));
  });

  it("buildArgs honors a custom override", () => {
    const args = buildArgs("/tmp/a.wav", "/tmp/out", { buildArgs: (w) => ["X", w] });
    assert.deepStrictEqual(args, ["X", "/tmp/a.wav"]);
  });

  it("jsonOutputPath swaps the extension and joins outDir", () => {
    assert.strictEqual(
      jsonOutputPath("/rec/clip.wav", "/rec/out").replace(/\\/g, "/"),
      "/rec/out/clip.json"
    );
  });

  it("parseTranscript pulls and trims .text", () => {
    assert.strictEqual(parseTranscript('{"text":"  你好世界 "}'), "你好世界");
    assert.strictEqual(parseTranscript('{"segments":[]}'), "");
  });
});

describe("glassbox-asr transcribe", () => {
  it("spawns, waits for clean exit, and returns the transcript", async () => {
    const child = fakeChild();
    let spawnedArgs = null;
    const p = transcribe("/rec/clip.wav", {
      bin: "whisper-faster.exe",
      outDir: "/rec/out",
      spawnFn: (bin, args) => { spawnedArgs = { bin, args }; return child; },
      readFileFn: (pth) => {
        assert.strictEqual(pth.replace(/\\/g, "/"), "/rec/out/clip.json");
        return '{"text":"帮我对比这三家公司"}';
      },
      unlinkFn: () => {},
    });
    child.emit("close", 0);
    const text = await p;
    assert.strictEqual(text, "帮我对比这三家公司");
    assert.strictEqual(spawnedArgs.bin, "whisper-faster.exe");
  });

  it("rejects on a non-zero exit with stderr context", async () => {
    const child = fakeChild();
    const p = transcribe("/rec/clip.wav", {
      bin: "w.exe", outDir: "/o",
      spawnFn: () => child,
      readFileFn: () => "{}",
    });
    child.stderr.emit("data", "model not found");
    child.emit("close", 3);
    await assert.rejects(p, /exited 3/);
  });

  it("rejects when the transcript file cannot be read", async () => {
    const child = fakeChild();
    const p = transcribe("/rec/clip.wav", {
      bin: "w.exe", outDir: "/o",
      spawnFn: () => child,
      readFileFn: () => { throw new Error("ENOENT"); },
    });
    child.emit("close", 0);
    await assert.rejects(p, /could not read transcript/);
  });

  it("rejects on spawn error", async () => {
    const child = fakeChild();
    const p = transcribe("/rec/clip.wav", {
      bin: "w.exe", outDir: "/o",
      spawnFn: () => child,
      readFileFn: () => "{}",
    });
    child.emit("error", new Error("EACCES"));
    await assert.rejects(p, /spawn failed/);
  });

  it("times out when the process never closes", async () => {
    const child = fakeChild();
    await assert.rejects(
      transcribe("/rec/clip.wav", {
        bin: "w.exe", outDir: "/o", timeoutMs: 20,
        spawnFn: () => child,
        readFileFn: () => "{}",
      }),
      /timed out/
    );
    assert.strictEqual(child.killed, true);
  });
});
