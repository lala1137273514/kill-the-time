"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");

const {
  DEFAULT_REMOTE_ENDPOINT,
  FALLBACK_REMOTE_MODELS,
  resolveBinary,
  buildArgs,
  jsonOutputPath,
  parseTranscript,
  normalizeRemoteEndpoint,
  audioFormatFromPath,
  canUseLocalWhisper,
  isRemoteModelDenied,
  buildRemoteStartTask,
  extractRemoteText,
  transcribeRemote,
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
    // faster-whisper-xxl / whisper-ctranslate2 reject --print_progress (exit 2),
    // so it must NOT be in the default args.
    assert.ok(!args.includes("--print_progress"));
  });

  it("buildArgs model falls back to CLAWD_WHISPER_MODEL env, opts still wins", () => {
    const saved = process.env.CLAWD_WHISPER_MODEL;
    process.env.CLAWD_WHISPER_MODEL = "base";
    try {
      const envArgs = buildArgs("/a.wav", "/o", {});
      assert.strictEqual(envArgs[envArgs.indexOf("--model") + 1], "base");
      const optArgs = buildArgs("/a.wav", "/o", { model: "small" });
      assert.strictEqual(optArgs[optArgs.indexOf("--model") + 1], "small");
    } finally {
      if (saved === undefined) delete process.env.CLAWD_WHISPER_MODEL;
      else process.env.CLAWD_WHISPER_MODEL = saved;
    }
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

  it("normalizes remote endpoints and infers supported audio formats", () => {
    assert.strictEqual(normalizeRemoteEndpoint("https://dashscope.aliyuncs.com/api-ws/v1/inference/"), DEFAULT_REMOTE_ENDPOINT);
    assert.strictEqual(audioFormatFromPath("/tmp/a.ogg", "audio/ogg;codecs=opus"), "opus");
    assert.strictEqual(audioFormatFromPath("/tmp/a.wav"), "wav");
    assert.strictEqual(audioFormatFromPath("/tmp/a.webm"), "webm");
  });

  it("detects whether local whisper fallback is configured", () => {
    assert.strictEqual(canUseLocalWhisper({ bin: "whisper-faster" }), true);
    const saved = process.env.CLAWD_WHISPER_BIN;
    delete process.env.CLAWD_WHISPER_BIN;
    try {
      assert.strictEqual(canUseLocalWhisper({}), false);
    } finally {
      if (saved !== undefined) process.env.CLAWD_WHISPER_BIN = saved;
    }
  });

  it("recognizes remote model permission failures", () => {
    assert.strictEqual(FALLBACK_REMOTE_MODELS.includes("paraformer-realtime-v1"), true);
    assert.strictEqual(isRemoteModelDenied(new Error("remote Model access denied.")), true);
    assert.strictEqual(isRemoteModelDenied(new Error("network down")), false);
  });

  it("buildRemoteStartTask creates a DashScope realtime ASR run-task payload", () => {
    const p = buildRemoteStartTask({ taskId: "tid", model: "paraformer-realtime-v2", format: "opus", sampleRate: 16000 });
    assert.strictEqual(p.header.action, "run-task");
    assert.strictEqual(p.payload.task_group, "audio");
    assert.strictEqual(p.payload.task, "asr");
    assert.strictEqual(p.payload.function, "recognition");
    assert.strictEqual(p.payload.parameters.format, "opus");
  });

  it("extractRemoteText accepts common DashScope sentence shapes", () => {
    assert.strictEqual(extractRemoteText({ payload: { output: { sentence: { text: "你好" } } } }), "你好");
    assert.strictEqual(extractRemoteText({ payload: { output: { text: "世界" } } }), "世界");
    assert.strictEqual(extractRemoteText({ payload: { output: { sentences: [{ text: "你" }, { text: "好" }] } } }), "你好");
  });
});

describe("glassbox-asr remote transcribe", () => {
  it("runs the WebSocket task, sends audio after task-started, and returns generated text", async () => {
    const sockets = [];
    class FakeWs extends EventEmitter {
      constructor(url, opts) {
        super();
        this.url = url;
        this.opts = opts;
        this.sent = [];
        sockets.push(this);
        setImmediate(() => this.emit("open"));
      }
      send(data) {
        this.sent.push(data);
        if (typeof data === "string") {
          const msg = JSON.parse(data);
          if (msg.header.action === "run-task") {
            setImmediate(() => this.emit("message", JSON.stringify({ header: { event: "task-started" } })));
          } else if (msg.header.action === "finish-task") {
            setImmediate(() => {
              this.emit("message", JSON.stringify({ header: { event: "task-generated" }, payload: { output: { sentence: { text: "你好" } } } }));
              this.emit("message", JSON.stringify({ header: { event: "task-finished" } }));
            });
          }
        }
      }
      close() { this.closed = true; }
    }

    const text = await transcribeRemote("/tmp/a.ogg", {
      endpoint: "https://dashscope.aliyuncs.com/api-ws/v1/inference/",
      apiKey: "sk-test",
      model: "paraformer-realtime-v2",
      WebSocketImpl: FakeWs,
      readBinaryFn: () => Buffer.from("audio"),
      sendDelayMs: 0,
    });
    assert.strictEqual(text, "你好");
    assert.strictEqual(sockets[0].url, DEFAULT_REMOTE_ENDPOINT);
    assert.strictEqual(sockets[0].opts.headers.Authorization, "Bearer sk-test");
    assert.ok(sockets[0].sent.some((x) => Buffer.isBuffer(x)));
  });

  it("rejects webm because DashScope realtime ASR cannot consume it directly", async () => {
    await assert.rejects(
      () => transcribeRemote("/tmp/a.webm", {
        endpoint: DEFAULT_REMOTE_ENDPOINT,
        apiKey: "sk-test",
        WebSocketImpl: class {},
        readBinaryFn: () => Buffer.from("audio"),
      }),
      /does not accept webm/
    );
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

  it("falls back to local whisper for webm when remote ASR is configured", async () => {
    const child = fakeChild();
    let spawned = false;
    const p = transcribe("/rec/clip.webm", {
      endpoint: DEFAULT_REMOTE_ENDPOINT,
      apiKey: "sk-test",
      mime: "audio/webm",
      bin: "w.exe",
      outDir: "/o",
      spawnFn: () => { spawned = true; return child; },
      readFileFn: () => '{"text":"本地回退"}',
    });
    child.emit("close", 0);
    assert.strictEqual(await p, "本地回退");
    assert.strictEqual(spawned, true);
  });

  it("falls back from paraformer realtime v2 to v1 on model access denied", async () => {
    const models = [];
    class FakeWs extends EventEmitter {
      constructor() {
        super();
        this.sent = [];
        setImmediate(() => this.emit("open"));
      }
      send(data) {
        this.sent.push(data);
        if (typeof data !== "string") return;
        const msg = JSON.parse(data);
        if (msg.header.action === "run-task") {
          const model = msg.payload.model;
          models.push(model);
          if (model === "paraformer-realtime-v2") {
            setImmediate(() => this.emit("message", JSON.stringify({
              header: { event: "task-failed", error_message: "Model access denied." },
            })));
          } else {
            setImmediate(() => this.emit("message", JSON.stringify({ header: { event: "task-started" } })));
          }
        } else if (msg.header.action === "finish-task") {
          setImmediate(() => {
            this.emit("message", JSON.stringify({ header: { event: "task-generated" }, payload: { output: { sentence: { text: "回退成功" } } } }));
            this.emit("message", JSON.stringify({ header: { event: "task-finished" } }));
          });
        }
      }
      close() {}
    }
    const text = await transcribe("/tmp/a.wav", {
      endpoint: DEFAULT_REMOTE_ENDPOINT,
      apiKey: "sk-test",
      model: "paraformer-realtime-v2",
      WebSocketImpl: FakeWs,
      readBinaryFn: () => Buffer.from("audio"),
      sendDelayMs: 0,
    });
    assert.strictEqual(text, "回退成功");
    assert.deepStrictEqual(models, ["paraformer-realtime-v2", "paraformer-realtime-v1"]);
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
