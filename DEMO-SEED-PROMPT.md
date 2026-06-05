# 出片种子 Prompt — 稳定触发「三球杂耍 + 语音批准」

录 90 秒主片时，把下面的 prompt 贴进**装了 clawd hook 的 Claude Code 会话**里，让桌宠稳定演出：
①工具名实时刷 → ②3 个子代理并行（HUD 显示 `juggling ×3` + 三球杂耍动画）→ ③写文件触发权限气泡（可语音「批准」）。

> 前提：Claude Code 跑在**默认询问模式**（不是 `--dangerously-skip-permissions` / bypassPermissions / acceptEdits / plan 模式），否则写文件不会弹权限。

---

## 种子 A — 叙事版（贴合 90s 脚本，屏幕上"像真活"）

适合正式录制：内容是"对比三家公司"，和脚本旁白对得上，研究耗时天然撑出 ~30s 等待。

```
帮我对比 Anthropic、OpenAI、Google DeepMind 三家在企业级 AI 市场谁更值得长期下注。
要求：在同一条回复里用 Task 工具【并行】派出 3 个子代理，每个负责一家公司，分别查：
最新产品与定价、近三个月重要新闻、企业客户与生态。
三个子代理都返回后，把对比结论汇总写进一个新文件 comparison.md（这一步需要写文件权限）。
```

预期时间线（对齐 90s 脚本）：
- 派子代理瞬间 → HUD `juggling ×3` + 三球杂耍
- 子代理跑的 ~30s → 工具名条实时刷（WebSearch/WebFetch…）+ TTS 旁白「我兵分 3 路…」
- 收尾写 comparison.md → 权限气泡 → 按热键说「批准」→ 任务继续 → TTS「搞定，结果给你了」

## 种子 B — 铁稳版（出片兜底，纯本地、不联网、不靠运气）

现场网络抖 / 模型不肯并行时用这条。全程本地、确定性强，照样 3 球杂耍 + 写文件权限。

```
在同一条回复里用 Task 工具【并行】派出 3 个子代理，分别独立完成（互不依赖）：
- 子代理1：统计 src/ 目录下 .js 文件数量和总行数
- 子代理2：读 README 和 package.json，用三句话概括这个项目是干嘛的
- 子代理3：列出 hooks/ 目录里所有文件名并各用一句话说用途
三个都返回后，把结果汇总写进一个新文件 demo-summary.md（需要写文件权限）。
```

---

## 让"3 个子代理"稳定出现的要点

- clawd 是靠 `PreToolUse(Task)` 把每个子代理映射成 juggling 并计数（见 `hooks/clawd-hook.js` isTaskToolStart）。**关键是让 Claude 在一条消息里同时发起 3 个 Task**——prompt 里务必写「同一条回复里 / 并行 / 3 个」。
- 若某次 Claude 只串行发 1 个：重发一次，或在 prompt 末尾加「请务必一次性并行发起，不要一个一个来」。
- 子代理数 = 同时在跑的 Task 数。3 个并行 → `juggling ×3`；它们陆续结束后计数随之回落，直到本轮 Stop 归零。

## 触发权限气泡的备选动作（任选其一，写进 prompt 收尾）

- 写新文件（默认询问模式下最稳）：`把结果写进 xxx.md`
- 跑一条未授权 shell：`用 git 看一下最近 3 条提交`（视你的 allowlist 而定）
- 若你的 Claude Code allowlist 太宽导致不弹：临时用更严格的权限模式跑这次 demo。
