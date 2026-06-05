# Glass-box Demo 运行 / 验证清单（傻瓜版）

分支 `demo/kill-boring-loading`。功能全程 `CLAWD_GLASSBOX_VOICE=1` 才启用，不设就是原版 clawd。
所有命令在 **PowerShell**、仓库根 `C:\Users\QYL\repos\clawd-on-desk`。

---

## Part A · 验 D1+D2（5 分钟，零下载）

D1=HUD 实时工具名 + 子代理 ×N；D2=百炼 TTS 旁白。只需要一把 TTS key（D1 连 key 都不用）。

1. **确认 clawd hook 已接 Claude Code**（本机已接过：`~/.claude/settings.json` 里有 `clawd-hook.js`）。没接就先 `npm run install:claude-hooks`。
2. **设环境变量 + 启动**（同一个 PowerShell 窗口）：
   ```powershell
   $env:CLAWD_GLASSBOX_VOICE = "1"
   $env:BAILIAN_API_KEY = "<从 C:\Users\QYL\Desktop\loona-live\.env 里那把>"
   npm start
   ```
   首次 `npm start` 会拉 sidecar 二进制，属正常。
3. **另开一个 Claude Code 会话**（任意项目目录），贴 `DEMO-SEED-PROMPT.md` 里的**种子 A**。
4. **盯桌宠看**：
   - ✅ HUD 行状态 chip 后实时冒工具名（Read/WebSearch/Write…），随工具切换跳变 → **D1 工具名 OK**
   - ✅ 派子代理瞬间出现 `juggling ×3` + 三球杂耍 → **D1 子代理计数 OK**
   - ✅ 走开能听到旁白「我兵分 3 路…」「搞定，结果给你了」 → **D2 TTS OK**（听不到见下方排查）

> D1 不依赖 key，哪怕没设 BAILIAN_API_KEY，工具名 + ×N 也该出。

---

## Part B · 验 D3 语音批准（要下载 whisper）

D3=push-to-talk 录音 → 本地 whisper 转写 → 语音「批准」真回包给 agent。

1. **下载 faster-whisper 独立 exe**：Purfview `whisper-standalone-win`（含 ffmpeg），随便放一个目录，记下 `whisper-faster.exe` 全路径。首次会下模型（small 约几百 MB）。
2. **设环境变量 + 启动**：
   ```powershell
   $env:CLAWD_GLASSBOX_VOICE = "1"
   $env:BAILIAN_API_KEY = "<同上>"
   $env:CLAWD_WHISPER_BIN = "C:\path\to\whisper-faster.exe"
   # 可选改热键：$env:CLAWD_GLASSBOX_HOTKEY = "CommandOrControl+Alt+J"
   npm start
   ```
3. 贴种子 A，等它收尾写文件 → **弹权限气泡**时：
4. 按热键 **`Ctrl+Alt+Space`** → 对着麦说「**批准**」→ 再按一次热键停止录音（toggle）。
   - 首次会弹系统麦克风授权，允许。
   - ✅ 任务继续往下跑 = 语音批准真回包成功。说「拒绝」则任务被拒。
   - 非批准/拒绝的话（如直接说一段需求）→ 文本进**剪贴板**（clawd 没法替你打字进 agent，这是诚实行为不是 bug）。

---

## 排查（按现象查）

| 现象 | 多半是 | 处理 |
|---|---|---|
| 没工具名 chip | 任务没在跑 / hook 没接 | 确认 Claude Code 在跑用工具的任务；`npm run install:claude-hooks` |
| 不是 `×3`，只 `juggling` | Claude 没并行发 3 个 Task | 重发，或用种子 B；prompt 强调「同一条回复并行 3 个」 |
| 听不到旁白 | 没设 key / 网络 / 静音 | 查 key；看日志 `glassbox-voice: tts error`；确认系统没静音 |
| 不弹权限气泡 | Claude Code 权限太宽 | 别用 skip-permissions/acceptEdits；用默认询问模式 |
| 按热键没反应 | 热键冲突 | 看日志 `hotkey ... FAILED`；换 `CLAWD_GLASSBOX_HOTKEY` |
| 说话没识别 | whisper 路径/模型 | 查 `CLAWD_WHISPER_BIN` 路径；日志 `glassbox-voice: ... failed`；先单独跑一次 exe 确认能转写 |
| 麦克风没声 | 系统隐私/授权 | Windows 设置→隐私→麦克风允许桌面应用 |

**日志**：`%APPDATA%\clawd-on-desk\session-debug.log`（dev 模式），搜 `glassbox-voice`。

## 出片兜底（plan 第八节）
- 现场任务跑飞 → 改用种子 B（纯本地确定性）+ 备份录屏。
- 网络抖 → 关键旁白可预生成缓存；真/半真诚实标注（语音批准=真，语音发起任务/答澄清=半真）。
