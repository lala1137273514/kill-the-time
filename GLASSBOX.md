# Glass-box 语音遥控器 —— 交接 README

> 分支：`demo/kill-boring-loading` · 远程只推 `mine`（`kill-the-time`），**别推 `origin`**
> 这份文档是给"接手大工程的新会话"用的单篇交接。配套规格见 `REMOTE-CONTROL-SPEC.md`、`DEMO-PLAN.md`。

## 1. 这是什么

clawd 是个 Electron 桌宠，本身**没有 LLM、不跑 agent 循环**，只观察外部编程 agent（Claude Code / Codex…）的 hook 状态。本分支在它上面长出了一条"语音/文字遥控"链路：

> 动嘴或打字 → clawd 把指令优化成精确 prompt → 截图+抓当前窗口上下文 → **派一个 `claude -p` 去真干活** → 桌宠播报进度 + TTS 念结果。

clawd 由此**第一次拥有了自己的轻模型脑**（百炼 qwen），定位从"纯外壳"变成"带编排脑的遥控器"。

## 2. 现状（截至最新提交，全部已推 mine）

| 阶段 | 内容 | 状态 |
|---|---|---|
| D1 玻璃盒 | HUD 实时显示工具名 + 子代理 ×N | ✅ |
| D2 语音旁白 | 里程碑 TTS（百炼 qwen3-tts-flash） | ✅ 逻辑+测试 |
| D3 语音介入 | 本地 whisper → 意图 → 语音批准/拒绝 | ✅ 逻辑+测试 |
| **Phase 2 遥控器** | 文字/语音 → 编排 → 派活 → 回执 | ✅ **真机跑通** |
| 输入框入口 | Ctrl+Space 弹 Spotlight 输入框（替代不可控的纯语音 VAD） | ✅ 真机跑通 |

**已用真 key 端到端验证**：输入框打字 → 编排(qwen)判 chat/dispatch → chat 直接 TTS 念回复；dispatch 派 `claude -p`，监工边干边念（在装依赖…/动了几个文件/在跑测试/搞定）。
测试：`npm test` 全量 **3758 通过 / 0 失败**（3 个 pre-existing skip；偶发进程枚举/EPERM 是沙箱竞态，重跑即过）。

**本轮新增（全部已落地、测试覆盖、真机验证）**：玻璃盒默认开启（不再需要环境变量）+ `.env` 加载 key；监工深版（念派活真实进度）；桌宠阶段状态 + 思路气泡 + 完成撒彩屑；一键 Demo（Ctrl+Shift+D）；确认策略路由；唤醒词 "hey, cc"（默认关）；设置面板（原生样式 + 5 语言）；新角色 **Bloop**（手绘 CSS 动画）；首次启动引导。

## 3. 怎么跑 / 验证

**最简跑法**：把百炼 key 放进项目根 `.env`（照 `.env.example`），然后 `npm start`。玻璃盒**默认开启**，无需任何环境变量。

```powershell
copy .env.example .env       # 然后编辑 .env，填 BAILIAN_API_KEY=sk-...
npm start                    # 玻璃盒默认开；Ctrl+Space 唤起输入框
```

语音输入（🎙）还需要本地 whisper：`.env` 里加 `CLAWD_WHISPER_BIN`（faster-whisper-xxl.exe 路径）；只打字派活则不需要。要回退成原版 clawd 设 `CLAWD_GLASSBOX_DISABLE=1`。

**环境变量全表：**

| 变量 | 默认 | 作用 |
|---|---|---|
| `CLAWD_GLASSBOX_VOICE` | (默认已开) | 强制开 voice（向后兼容；现在默认就开，不用设） |
| `CLAWD_GLASSBOX_DISABLE` | — | `=1` 回退原版 clawd（关掉整条链路） |
| `BAILIAN_API_KEY` | — | 百炼 qwen 编排 + TTS；**放项目根 `.env` 即可**（DASHSCOPE_API_KEY 也认） |
| `CLAWD_WHISPER_BIN` | — | faster-whisper-xxl.exe（STT） |
| `CLAWD_WHISPER_MODEL` | small | whisper 模型（base/tiny 更快） |
| `CLAWD_GLASSBOX_HOTKEY` | `CommandOrControl+Space` | 唤起输入框（可能撞输入法，撞了就改） |
| `CLAWD_ORCHESTRATOR_MODEL` | qwen-plus | 轻模型 |
| `CLAWD_DISPATCH_PERMISSION_MODE` | bypassPermissions | 派出的 claude 的权限模式 |
| `CLAWD_SKIP_SIDECAR_FETCH` | — | 跳过 Telegram sidecar 预下载 |

**用法**：Ctrl+Space 弹输入框 → 打字 或 点 🎙 说话（whisper 把字填进框，可改）→ Enter → 桌宠复述 + 确认框 → 确认 → claude 真跑 → 念摘要。

**关键日志**：`%APPDATA%\clawd-on-desk\session-debug.log`（`glassbox-input: submit ...`、`glassbox-remote: ...`）。
注意：模块加载期（app ready 之前）的 `sessionLog` 会被丢弃，所以看不到 "Phase 2 enabled" 之类不代表没初始化。

## 4. 架构

**数据流（当前输入框路径）：**

```
Ctrl+Space ─▶ toggleGlassboxInput (main.js) ─▶ glassbox-input.html(可聚焦窗口)
                                                   │ 打字 或 🎙录音
                                                   │  └─clip─▶ main ─▶ glassbox-asr(whisper) ─transcript─▶ 回填输入框
                                                   ▼ Enter
                              ipc "glassbox-input-submit" ─▶ glassboxRemote.handle(text)
                                                   ▼
   getForegroundWindow(glassbox-capture: win32 PS 查前台窗口 + matchSession)
                                                   ▼
   orchestrate(glassbox-orchestrator: 百炼 qwen) ─▶ {action, refinedPrompt, needCapture, risk, reply}
                                                   ▼ action=dispatch
   needCapture? takeScreenshot(desktopCapturer, screen-only)
                                                   ▼
   复述 speak + confirmDispatch(dialog) ─▶ planDispatch(resume-if-idle/new)
                                                   ▼
   dispatch(glassbox-dispatch: spawn claude -p, prompt 走 stdin, --permission-mode bypass)
                                                   ▼ 进度走 D1/D2 hook 播报
   onComplete ─▶ summarizeForSpeech ─▶ TTS 念结果摘要
```

**模块表：**

| 文件 | 职责 | 单测 |
|---|---|---|
| `src/glassbox-capture.js` | 前台窗口(win32 PS) + desktopCapturer 截图 + 按 wtHwnd/pid 匹配会话 | ✅ |
| `src/glassbox-orchestrator.js` | 百炼 qwen 轻模型：dispatch/chat 判定 + prompt 优化 + risk + needCapture；approve/deny/answer 走规则不耗 LLM | ✅ |
| `src/glassbox-dispatch.js` | spawn `claude -p`/`-r`（prompt 走 stdin、no-shell、bypass perms）/ `codex exec`；可选 onComplete 捕获输出 | ✅ |
| `src/glassbox-remote.js` | Phase 2 流程编排（窗口→编排→截图→复述确认→派活→完成摘要）+ summarizeForSpeech | ✅ |
| `src/glassbox-listen.js` | D3 push-to-talk（转写→意图→批准/拒绝）；**输入框上线后基本休眠** | ✅ |
| `src/glassbox-intent.js` | 规则路由 approve/deny/answer/task | ✅ |
| `src/glassbox-asr.js` | faster-whisper sidecar 客户端 | ✅ |
| `src/glassbox-tts.js` | 百炼 qwen3-tts-flash 合成 | ✅ |
| `src/glassbox-voice.js` | D2 旁白宿主 + `speak(text)` | ✅ |
| `src/glassbox-narration.js` | 里程碑旁白控制器（节流/文案） | ✅ |
| `src/glassbox-input.html` | Spotlight 输入框 UI（nodeIntegration，**sandbox:false**） | 手动 |
| `src/main.js` | 接线：窗口管理、热键、IPC、给 remote 注入真实依赖 | 手动 |
| `src/preload.js` / `src/renderer.js` | 桌宠侧 glassbox 桥（pet-pill VAD 那条已休眠） | 手动 |

注入式风格：所有外部副作用（fetch/spawn/PS/desktopCapturer/dialog）都从 opts/deps 注入，纯逻辑可单测；main.js 注真实实现。遵循 **let-it-crash，不加降级兜底**。

## 5. 关键事实与踩过的坑（动手前必读）

1. **派活必须 prompt 走 stdin + no-shell**：`claude` 是真 `claude.exe`（240MB）。`shell:true` 会经 cmd.exe 把长中文 prompt 拼坏且不转发 stdin → 卡死。已改 `shell:false` 直接 spawn + prompt 写 stdin。
2. **派出的 `claude -p` 用 `--permission-mode bypassPermissions`**：否则首个工具调用卡在无人应答的权限提示。把关点是派活前的确认框（用户已确认）。可用 `CLAWD_DISPATCH_PERMISSION_MODE` 改。
3. **whisper 参数**：faster-whisper-xxl / whisper-ctranslate2 **不认 `--print_progress`**（exit 2）。`buildArgs` 已不带它。
4. **输入框窗口必须 `sandbox:false`**：否则 nodeIntegration 的 `require()` 失效，脚本静默挂，Enter/🎙 没反应。
5. **截图只抓 screen、限 ≤1600px、4 秒超时**：抓所有窗口全分辨率会让 WGC 逐窗超时（PrintWindow/BitBlt failed）卡死。抓不到就跳过、不阻塞派活。
6. **单实例锁 + auto-start**：开 Claude Code 时 auto-start hook 会拉起一个**不带 env** 的 clawd，占住单实例锁。验 demo 前要先 `Stop-Process "Clawd on Desk"` 再手动带 env `npm start`；之后别再新开 Claude 会话抢锁。
7. **百炼这把 key 的实时 ASR 全部 AccessDenied**，所以 STT 只能本地 whisper；TTS（qwen3-tts-flash）不受影响。
8. **架构诚实**：clawd 不能往**正在运行的 TUI** 注入（spec §2），派活一律 spawn 新 run；approve/deny 复用真权限通道；clarification answer 进剪贴板不伪造。

## 6. 升级路线图（用户提的 4 个方向）

> **状态：①②③④ 全部已落地。** ①中间态反馈（思路气泡+阶段状态）+唤醒词"hey, cc"；②提示词外置+监工深版（念派活真实进度）+确认策略路由；③桌宠状态多样+新角色 Bloop；④设置面板（原生+5语言、旋钮真生效）。下面保留原始落点供参考。

### ① 交互：中间态反馈 + 语音唤醒 "hey, cc"
- **中间态缺失**（当前痛点）：提交后到结果之间桌宠/输入框无反馈。
  - 落点：给 `glassbox-remote` 加一个 `onPhase(phase)` 注入回调（listening/transcribing/orchestrating/confirming/dispatching/running/done/error），main 把它转成桌宠状态或输入框/气泡文案。输入框提交后先别立刻关，或关后桌宠进"派活中"态。
- **唤醒词 "hey cc"**（二期，spec §4-5）：需常驻麦克风 + VAD + 关键词检测（openWakeWord / Porcupine / 本地小模型）。隐私/耗电敏感，要有开关。
  - 落点：新模块 `glassbox-wake.js`（注入音频源可单测的检测器），命中 → `toggleGlassboxInput()` 或直接起录音。

### ② 能力：升级为"监工 agent" + 提示词文件 + 路由系统
- 现在 orchestrator 的 system prompt **硬编码**在 `buildSystemPrompt()`。
  - 落点：提示词外置成文件（建 `prompts/` 目录，如 `prompts/orchestrator.md`、`prompts/supervisor.md`），运行时读取（注入式，便于测试与设置页编辑）。
- "监工" = 不只被动派活，还主动盯 agent 进度（D1/D2 已镜像 hook 状态）、阶段性插话/提醒、按事件决策。
  - 落点：在 narration/voice 之上加一个 supervisor 决策层 + 路由系统（intent/角色 → handler），可参考 loona 的 router 思路（多意图分流）。
- 路由系统：把 orchestrator 单一 prompt 拆成"路由 → 多角色提示词"，便于扩展（派活/监工/闲聊/总结…）。

### ③ 桌宠状态多样 + 触发灵活
- 现 glassbox 复用 narration/HUD，没有专门的"听令/派活中/复述/完成"等态。
  - 落点：`src/state.js` 状态机加新态 + 主题 SVG（`docs/guides/state-mapping.md` 是状态→动画权威表，`docs/project/theme-state-ui.md` 讲状态系统）；触发条件接 glassbox 各阶段（配合 ① 的 onPhase）和 hook 事件。

### ④ 设置页可调（TTS / 提示词 / 热键 / 模型…）
- 设置系统链路：`prefs.js`(schema) → `settings-controller.js`(**唯一写入者**) → `settings-store.js`(不可变快照) → `settings-actions.js`(副作用) → `settings-renderer.js`(UI)。**store 是唯一真相，别绕过 controller。**
  - 落点：把现在走 env 的开关改成读 prefs（env 作 fallback）：TTS 开关/音色/音量、orchestrator 模型、提示词、热键、whisper 模型/二进制、权限模式、唤醒词开关。prefs schema 加字段 → settings UI 加控件 → 各模块从 prefs 读。

## 7. 约束（务必遵守）

- **不擅自开分支 / worktree / 删文件 / 重置 git**；要先经用户同意。
- 远程**只推 `mine`，别推 `origin`**（origin 是原作者库）。
- **let-it-crash**：不加降级、兜底、启发式补丁。
- 每步改完跑 `npm test`；纯逻辑 TDD，Electron/UI 行为手动验。
- 设置改动走 controller，别绕 store。
- 这是 **clawd** 仓库，和 loona（persona/emotion/旅行卡）无关，别混。
