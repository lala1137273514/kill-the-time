# 比赛 Demo 执行计划 — 杀死 Boring Loading

基于 clawd-on-desk 二开。挑战二：重新设计 AI 思考的 30 秒空白期。
约束：出片级，3–5 天，必接 ASR + TTS。

## 一、核心论点（写给评委）

Loading 之所以无聊，是因为它在**隐藏真相**：AI 明明在拆解、调工具、派子代理，却用一个 spinner 把这一切藏起来。
我们不假装更快，我们让等待变得 **透明 · 有生命 · 可介入 · 会说话**。

clawd 的不公平优势：它通过 hook 拿到了 agent 真实在干什么的 ground truth（`tool_name` / `Task` 子代理扇出），别人的 loading 是假动画，我们的是真遥测。

## 二、四层设计（与改动地图）

| 层 | 做什么 | 落点 / 现成度 |
|---|---|---|
| 透明（玻璃盒） | 桌宠旁实时露出"在调哪个工具 / 几个子代理并行 / 拆解到哪步" | 数据**已在** `clawd-hook.js:349` payload（tool_name/tool_input）；Task→juggling 已映射。净工作=渲染 `src/session-hud-renderer.js` |
| 有生命（情绪） | 思考/卡住/找到/完成几个节点切换表情，不是进度条是个角色 | 复用 cc-persona 情绪规则 → 映射到 4–5 个关键表情态（theme SVG） |
| 可介入 | 等待期能语音批准下一步、回答澄清 | `src/permission.js` + `/permission` 回包现成，接语音入口 |
| 会说话（语音） | TTS 实时旁白进度（你走开也听得到）+ ASR 唤起/插嘴 | TTS=百炼 qwen3-tts-flash(Cherry) BAILIAN_API_KEY；**ASR=本地 Whisper**（百炼所有实时 ASR 对此 key 均 Model.AccessDenied，已查证 loona-live/docs/research/01-dashscope-stt-tts.md，故 STT 走本地，非百炼） |

## 三、成功标准（可验证）

1. 一句语音发起任务 → 桌宠醒来接令（ASR 真听到）
2. 30 秒思考期内：玻璃盒实时显示真实工具名 + 三球杂耍=真 3 子代理并行
3. 走开听得到 TTS 旁白播报里程碑（开始/子代理派发/卡住/完成）
4. 中途真权限请求 → 语音"批准" → 任务继续（/permission 真回包）
5. 完成庆祝 + TTS 收尾 + 结果卡浮出
6. 连续跑 3 遍剧本不崩

## 四、逐日计划

### D0 · 预检门（半天）— 地基验证，失败就改剧本
- action：clawd 跑通 + 接真实 Claude Code，跑一个多 Task 子代理任务
- verify：肉眼看到①思考态 ②三球杂耍(真子代理) ③权限气泡 ④HUD/日志里 tool_name 真实出现
- 风险闸：若 Claude Code 当前版本 Task 扇出不稳定触发 juggling，立即固定一个稳定 fan-out 的种子 prompt

### D1 · 玻璃盒透明层
- action：把已在 payload 的 tool_name / Task 子代理数渲染成桌宠旁实时活动条
- files：`src/state.js`（snapshot 带 current tool）、`src/server-route-state.js`、`src/session-hud-renderer.js`
- verify：真任务跑起来，活动条实时显示"正在 WebSearch / 派出 3 个子代理"

### D2 · 语音 TTS 旁白
- action：Node 重写百炼 TTS 客户端（照搬 loona-live/agent/plugins/dashscope_tts.py 的一次性模式：POST 文本 → 拿 output.audio.url → 下 WAV → Electron 播）；新模块订阅 state 变化 → 里程碑模板生成播报句 → TTS 播
- 参考：端点/鉴权/payload 见 dashscope_tts.py；clawd 播放走 renderer 的 `<audio>` 或现有 sound 通道
- 节流：只播关键节点（开始/子代理派发/卡住/澄清/完成），不逐 state 念
- verify：走开能听到"三个方向都在查了…再等我十秒"

### D3 · 语音 ASR 唤起 + 可介入
- 逻辑层已实现+测：`glassbox-asr.js`(spawn faster-whisper 独立 exe 转写 WAV→JSON，CLAWD_WHISPER_BIN 指向)、`glassbox-intent.js`(转写→批准/拒绝/澄清/发起任务)、`glassbox-listen.js`(编排：转写→路由→动作)。
- **架构事实**：clawd 是观察者+权限应答者。语音"批准/拒绝"复用 `permission.js hotkeyResolve("allow"/"deny")` 真回包给 agent ✅；但 clawd **无法往 agent 注入新任务/澄清答复**(没 stdin 通道)——90s 脚本里"语音发起任务""语音答澄清"clawd 做不到，要么 demo 脚本演、要么另接输入注入。
- 接线已完成(flag 门控 CLAWD_GLASSBOX_VOICE=1)：热键(默认 Ctrl+Alt+Space，CLAWD_GLASSBOX_HOTKEY 可改)→renderer MediaRecorder 录音→clip 回 main→glassbox-asr 转写→listen 路由→批准/拒绝走 hotkeyResolve、task/answer 入剪贴板。已补 media 权限 handler(仅启用时放行麦克风)。
- 剩余=真机验：①装 faster-whisper 独立 exe(Purfview whisper-standalone)+模型，设 CLAWD_WHISPER_BIN ②跑起来按热键说"批准"看权限是否真回包。纯逻辑(asr/intent/listen)已 50 测全过；录音/识别/发声只能真机确认。
- files：新 voice 模块 + `src/permission.js` 决策入口
- verify：中途真权限请求，语音批准，任务继续

### D4 · 情绪层 + 串场
- action：思考/卡住/找到/完成 4–5 个表情变体（复用 cc-persona 映射）；固定 demo 剧本任务
- verify：剧本稳定 fan-out 3 子代理 + 触发 1 次权限 + 1 次澄清

### D5 · 出片
- action：录 90 秒主片 + 备份录屏；写"设计取舍说明"文档；兜底切换预案
- verify：成片 + 文档齐

## 五、90 秒拍摄脚本（最终）

| 秒 | 画面 | 声音 |
|---|---|---|
| 0–8 | 桌面只有桌宠在打盹 | 用户语音(ASR)："帮我对比这三家公司哪个适合投" |
| 8–12 | 桌宠惊醒接令，进入思考态 | TTS："收到，我拆一下" |
| 12–35 | 玻璃盒条「拆解→派出3子代理→A查财报/B查新闻/C查竞品」；三球杂耍=真子代理 | TTS（你起身走开）："三个方向都在查了…B 的财报有点意思" |
| 35–50 | 弹澄清卡"要不要把估值也算进去？" | 用户(ASR)："算" → TTS"好，加上估值" |
| 50–62 | 权限气泡（要写文件/联网） | 用户(ASR)："批准" → 任务继续 |
| 62–80 | 表情：找到关键数据眼睛一亮 → 完成庆祝 | TTS："对比好了，B 综合最优" |
| 80–90 | 结果卡浮出，桌宠满足 | 静 |

真/半真标注：桌宠+动画+三球杂耍+tool_name+**语音批准/拒绝权限回包**=**真**；情绪表情=**4–5 关键态**；玻璃盒文案=工具名真取、拆解步骤规则兜底；**语音"发起任务"/"答澄清"=半真**(clawd 无 stdin 注入通道，靠脚本演或另接)；订票类下游=**stub**。

## 六、设计取舍说明骨架（评分项）

| 取舍点 | 一端 | 另一端 | 取向 |
|---|---|---|---|
| 信息密度 | 全透明思考链 | 只露里程碑 | 里程碑为主，hover 看全（防过载） |
| 存在感 | 全程动画+语音 | 专注时闭嘴 | 你在就安静，你走开才主动旁白 |
| 拟人度 | 强情绪人格 | 工具信任 | 情绪只为传递进度，不为可爱 |
| 介入时机 | 主动追问 | 只在阻塞时弹卡 | 只弹真卡住的（权限/澄清） |
| 语音模态 | TEN 实时全双工 | 轻量 TTS+push-to-talk | 出片优先稳定，全双工留作升级 |

## 七、已确认

1. 语音：TTS=复用百炼 qwen3-tts-flash(Cherry)，BAILIAN_API_KEY 在 Desktop/loona-live/.env，Node 重写一次性 REST，不搬 LiveKit 流式栈。ASR=本地 Whisper（百炼 ASR 对此 key 全部 AccessDenied，已查证），不复用百炼那把 key
2. 分支：已建 `demo/kill-boring-loading`，二开改动隔离在此分支

## 八、关键风险与兜底（出片用，非代码降级）

- 现场任务跑飞 → 固定种子 prompt + 备份录屏，保证稳定 fan-out 3 子代理
- 百炼网络抖动 → TTS 预生成关键旁白音频缓存；ASR 失败回退本地 Whisper
- 真/半真要诚实标注，不做隐藏式代码兜底
