# Glass-box 遥控器 — 需求 Spec（交接版）

> 状态：需求/可行性已定，待另一会话实现。基于 `demo/kill-boring-loading` 分支续作。
> 一句话：把 clawd 从「观察者 + 权限应答器」升级成「语音遥控器」——动嘴让宿主 agent（Claude Code / Codex）干活，clawd 负责听、采集上下文、优化指令、派活、播报。

## 0. 背景（给没看过上文的会话）

clawd 是个 Electron 桌宠，靠 hook 实时镜像外部 AI 编程 agent 的状态。它**本身没有 LLM、没有 agent 循环**，只做两件事：观察（hook 上报）+ 权限应答（allow/deny 回包）。

本分支已建好（flag `CLAWD_GLASSBOX_VOICE=1`）：
- **D1 玻璃盒**：HUD 实时显示工具名 + 子代理 `×N`（默认开）
- **D2 语音旁白**：TTS 念里程碑（百炼 qwen3-tts-flash），`src/glassbox-narration|tts|voice.js`
- **D3 语音介入**：push-to-talk → 本地 whisper(`CLAWD_WHISPER_BIN`) → 意图路由 → 语音批准/拒绝权限。`src/glassbox-asr|intent|listen.js`

本 spec = 在 D3 之上加「派活」闭环。

## 1. 目标能力（用户故事）

> 当我盯着某个窗口、懒得打字时，我按热键（或喊醒桌宠）说"帮我整理一下当前窗口的内容"，桌宠截图+识别当前窗口、把我的话优化成精确指令、派给一个 Claude/Codex 去执行；执行中我还能跟它对话，它回"好的，已经让 Claude 处理了"，这样我动动嘴就把活派出去了。

拆成可观察的成功标准：

| # | 验收（可观察、可复现） |
|---|---|
| 1 | 热键或唤醒词唤起桌宠进入"听令"态 |
| 2 | 一句语音 → 本地 whisper 转写正确 |
| 3 | 桌宠截当前屏 + 抓到当前前台窗口标题/HWND/（若是 agent 终端则匹配到其 session+cwd） |
| 4 | 轻模型把口语 query 优化成精确 prompt（带上截图引用/窗口上下文） |
| 5 | `claude -p`/`-r` 在正确 cwd 派活成功，宿主 agent 真的开始执行 |
| 6 | 派活瞬间 TTS 回"好的，已让 Claude 处理"，且桌宠进入播报态（复用 D1/D2 hook 进度） |
| 7 | 执行中用户再说话，桌宠用轻模型即时对话回应（不打断派出去的活） |
| 8 | 任务完成 TTS 收尾 + 结果落地（落到哪见 §4 决策3） |
| 9 | 危险操作（写文件/联网/删除）派活前有确认（语音或气泡），不裸奔 |

## 2. 可行性结论（已查证，别再 research）

| 能力 | 结论 | 命令/接口 |
|---|---|---|
| 派活给 agent 跑 | ✅ 一次性 headless | `claude -p "<prompt>" --output-format stream-json`；`codex exec "<prompt>"` |
| 续已知会话上下文 | ✅ 独立进程跑，hook 照常触发 | `claude -r <session_id> -p "..."` / `--continue` / `--session-id <uuid>` |
| 喂截图 | ✅ | prompt 里 `@C:/path/shot.png`，agent 自己读图 |
| 注入**正在运行的 TUI** | ❌ 官方不支持（只有键盘注入 hack）→ **放弃**，一律 spawn 新 run | — |
| 截屏 | ✅ 复用 | Electron `desktopCapturer`（`src/telegram-companion.js` 已用）|
| 抓前台窗口/HWND/标题 | ✅ 复用 | `src/focus.js` win32：`GetForegroundWindow`/`GetWindowText`/`GetWindowThreadProcessId` |
| 窗口↔agent会话关联 | ✅ 已有 | hook 带 `wt_hwnd`，state 里按 HWND 存了 session（拿 cwd/session_id）|
| spawn 子进程 | ✅ 有先例 | `src/focus.js` 用 `child_process` spawn/execFile/powershell |

> ⚠️ 待二次确认的旁支（claude-code-guide 给的、但我没亲验）：`--bg` 后台会话、`claude attach`/`claude agents` 子命令、Claude **Agent SDK**（`@anthropic-ai/claude-agent-sdk`）能否驱动会话。**别让实现依赖这些**；先用稳的 `claude -p` / `-r` / `--session-id`。SDK 路线如要用，先单独验证。

## 3. 架构（在现有件上搭，别另造）

```
唤醒(热键/唤醒词) ─▶ 录音(MediaRecorder, 已建) ─▶ 本地 whisper(glassbox-asr, 已建)
        │                                                      │ transcript
        ▼                                                      ▼
   桌宠"听令"态                              【轻模型 Orchestrator(新)】= 快/小模型
                                            ├─ 意图: 派活? 对话? 批准?(复用 glassbox-intent)
                                            ├─ 要不要采集上下文(截图/窗口)
                                            └─ query 优化 → 精确 prompt
        ┌───────────────────────────────────────────┘
        ▼
  上下文采集(新): desktopCapturer 截图 + focus.js 抓前台窗口 → 匹配 agent 会话(cwd/session_id)
        ▼
  派活(新, dispatcher): spawn `claude -p "<优化prompt> @shot.png"` (在 cwd, 或 -r <sid>)
        ▼
  宿主 agent 执行 ──hook──▶ 桌宠播报(D1/D2 已建) + TTS 回执(D2)
        ▼
  执行中对话(新): 用户说话→whisper→Orchestrator 即时回(TTS)，不阻塞派出去的 run
        ▼
  结果落地(新, 见 §4-决策3)
```

**新增模块（建议命名，沿用 glassbox- 前缀 + 注入式可单测）：**
- `glassbox-orchestrator.js`：调轻模型，输入 transcript(+窗口上下文摘要) → 输出 `{action: dispatch|chat|approve|deny, refinedPrompt?, needCapture?, reply?}`。注入 LLM client 可测。
- `glassbox-capture.js`：截图(desktopCapturer) + 前台窗口信息(复用 focus.js) → `{screenshotPath, window:{title,hwnd,sessionId?,cwd?}}`。
- `glassbox-dispatch.js`：构造并 spawn `claude`/`codex` 命令（注入 spawn 可测），返回派出的 run 句柄；进度靠现有 hook，无需自己解析 stream（除非要做 dispatcher 内部进度）。
- main.js 串起来：唤醒→录音→whisper→orchestrator→capture→dispatch→TTS 回执。

## 4. 必须先拍的灰区决策（每条给了我的推荐）

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 派活目标 | A 全新 run；B 续当前窗口对应的 agent 会话(`-r <sid>`) | **B 优先**（前台若是已知 agent 终端就续它，保上下文）；匹配不到则 A 新 run，cwd 取窗口对应或问用户 |
| 2 | 轻模型选谁 + key 放哪 | Haiku 4.5 / gemini-flash / 本地小模型 | **Haiku 4.5**（中文好、快、tool-use 强）；key 走 env，与 D2 的 BAILIAN 分开 |
| 3 | 结果落到哪 | a 续到那个 session 用户自己看；b 摘要 TTS + 落剪贴板；c 弹结果卡 | **a+b**：续会话让结果留在 agent 里 + TTS 念一句摘要；别在小屏堆全文 |
| 4 | 危险操作确认 | 每次确认 / 仅写操作确认 / 信任清单 | **仅写/删/联网类确认**（语音"要改文件吗"→批准走 D3 那套），读类直接跑 |
| 5 | 唤醒方式 | 仅热键 / 热键+唤醒词 | **先热键**（稳、出活快）；唤醒词(如"Clawd")作二期，要常驻麦克风+VAD，耗电且隐私敏感 |
| 6 | 同时多任务 | 串行 / 允许并行多个派出的 run | **先串行**（一次一个，避免桌宠播报错乱）；并行留二期 |
| 7 | 上下文采集范围 | 仅前台窗口截图 / 全屏 / OCR 文本 | **前台窗口截图**起步，让 agent 读图；OCR/选区作增强 |

## 5. 非目标（明确不做，防膨胀）

- 不在 clawd 里自己跑编码 agent / 自己执行工具（重活永远派给宿主 agent）。
- 不注入用户正在用的 TUI（技术不支持）。
- 不做通用语音助手；只服务"把活派给编程 agent"这一条主线。
- 轻模型只做编排/改写/对话，不做长链推理。

## 6. 风险

- **隐私**：截屏 + 麦克风。要显式开关、本地处理优先（whisper 本地；截图不上传第三方，只喂给用户自己的 agent）。
- **误派活**：优化后的 prompt 跑偏 → 浪费一次 agent run。缓解：派活前 TTS 复述"我要让它做 X，对吧？"可一键叫停。
- **窗口↔会话匹配失败**：前台不是已知 agent 终端时 cwd 不确定 → 回退到"问用户/默认目录"，别瞎猜。
- **轻模型也要 key**：多一个外部依赖；离线场景退化为"原话直接派、不优化"。
- **clawd 首次拥有 LLM**：架构定位从"纯外壳"变"带编排脑的外壳"，README/定位要同步更新。

## 7. 给实现会话的起步清单

1. 读 `src/focus.js`(win32 窗口) + `src/telegram-companion.js`(desktopCapturer) 摸清可复用面。
2. 先写 `glassbox-capture.js` + 单测（截图存临时文件 + 返回前台窗口信息；win32 调用可注入）。
3. 写 `glassbox-orchestrator.js` + 单测（注入 fake LLM，验意图分流 + query 优化 prompt 构造）。
4. 写 `glassbox-dispatch.js` + 单测（注入 spawn，验 `claude -p`/`-r` 命令拼装、cwd、@图片引用）。
5. main.js 串链路（flag 门控），真机验：说一句 → 看 agent 真跑起来 + 桌宠播报 + TTS 回执。
6. 决策 §4 逐条与用户确认后再固化。
