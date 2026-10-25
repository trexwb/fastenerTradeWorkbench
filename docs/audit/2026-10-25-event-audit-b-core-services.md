# 事件绑定审计 · B 组「core 服务层」

- **日期**：2026-10-25
- **审计范围**：`src/core/exporter.js`、`src/core/ai.js`、`src/core/ai-tools.js`、`src/core/help-knowledge.js`、`src/core/kb.js`、`src/core/updater.js`、`src/core/validators.js`、`src/core/ai-files.js`、`src/public/sw.js`（sw.js 仅查事件注册合规性，不查 UI）
- **审计依据**：AGENTS.md ①「所有操作、按钮、连接、事件必须有响应」（死交互=onclick 空串/href="#" 无处理/无绑定）；② §12.5 高频事件（输入/滚动/resize）必须防抖节流、§8 禁止 oninput 实时搜索；③ 写操作/异步提交按钮（保存/导出/创建/删除/确认）应有重复触发防护
- **方法**：只读审计。逐文件通读 + `grep -n "addEventListener|onclick|oninput|onchange|oncancel|<button|<a |confirmModal|busy|indexing|..."` 全量扫描；处理函数存在性跨全 `src/` 用 rg 核实。未修改任何 `src/` 代码，未运行构建与 git。

## 总计数

| 级别 | 数量 | 说明 |
|------|------|------|
| P1 | **0** | 无死交互；B 组 9 文件均不产 oninput 实时搜索类交互 |
| P2 | **1** | exporter.js 异步导出入口无重复触发防护 |
| P3 | **3** | updater/ai 核心入口重入守卫缺失（调用方已兜底）、sw.js 后台缓存写入未挂 waitUntil |

## 违规与建议明细

| 严重级 | 文件:行 | 事件/元素 | 问题描述 | 最小修复建议 |
|--------|---------|-----------|----------|--------------|
| P2 | src/core/exporter.js:177 | `exportOrder(orderId)` 异步导出入口（用户调用点：views/orders.js:176 详情页「导出Excel」按钮 onclick） | 导出全程无重复触发防护：入口无 busy 标志，:194 失败 toast 后也不留冷却；视图按钮 orders.js:176 无禁用/冷却。连击将并发跑两趟 loadXLSX+构建+下载，弹两次保存对话框/落两份文件 | 入口加模块级 `let _exporting=false`：首行 `if(_exporting){toast('正在导出…');return}`，try/finally 置位复位（与 loadXLSX 的 `_xlsxLoading` 同款模式） |
| P3 | src/core/updater.js:66 | `download(update)`（桌面版「下载并安装」按钮 router.js:467 绑定） | 函数级无重入检查（对照 :31 check() 有 `downloading/checking/ready` 三态守卫）；现仅靠 renderSetStatus 在 downloading 态不渲染按钮兜底（router.js:447-450），autoFlow 自动下载与手动点击存在理论并发窗口 → 并发 downloadAndInstall | download() 首行加 `if(state.status==='downloading')return state`，与 check() 守卫对齐 |
| P3 | src/core/ai.js:470 | `chat(messages,onChunk,options)` 对话入口 | 核心层无 `state.chatting` 重入拒绝（:478 直接置 true）；防重复发送完全依赖视图层 ai-chat.js:474 拦截 + :475-476 300ms 发送防抖。其他调用方直连 chat() 可绕过，造成并发双请求 | chat() 首行加 `if(state.chatting){throw new Error('AI 正在处理其他请求')}`，或注释固化「仅视图层可调」约定 |
| P3 | src/public/sw.js:45,60,65 | fetch 事件内后台缓存写入 / SWR 兜底 | ① `caches.open().then(cache.put)`（:45/:60）未并入 `event.waitUntil`，SW 可能在写缓存完成前被回收；② SWR 分支 `return cached || network`（:65）：无缓存且网络失败时 respondWith 解析为 undefined，等同裸网络错误，无离线兜底页 | ① 将缓存写 Promise 用 `event.waitUntil` 包裹；② network.catch 兜底返回简单离线提示 Response |

## 逐文件核查结论（含「已合规」项）

### 1. src/core/exporter.js（1959 行）
- ❌ **P2** :177 `exportOrder` — 见上表。
- ✅ :35-37 `loadXLSX()` 用 `_xlsxLoading` 缓存 Promise，防并发重复加载（重入防护的正面样板）。
- ✅ :57-58 动态 `<script>` `onload`/`onerror` 均绑定，失败 reject 并带文件名，资源加载事件有响应。
- ✅ :126-165 `downloadWorkbook`：showSaveFilePicker 失败回退 `<a download>`；:161-165 click 后延迟 3000ms 才 `revokeObjectURL`（v1.0.42 修 WebView2 0 字节竞态），资源清理有响应。
- ✅ :194 导出异常 `catch` → console.error + `toast('导出失败…')`，操作有响应。
- ✅ 全文件无 onclick/oninput/addEventListener 用户事件绑定、不产交互 HTML（`<a>` 为程序化触发下载，非死交互）。

### 2. src/core/ai.js（962 行）
- ✅ :953 `window.addEventListener('pagehide', …)`：chatting 中退出自动 `saveDB()` 落盘，注册有 try/catch 包裹，仅注册一次（模块顶层），用途合规。
- ✅ :261-282 `_ensureStreamListener` 先 `_cleanupStreamListener()` 再 listen，防 Tauri 流事件重复注册；:280 `removeStreamListener` 正确清理。
- ✅ :519-525 AbortController 供用户手动停止；:927 `abort()` 置 `abortReason='manual'` 并 abort；:535 `finally` 复位 chatting/abortController，不锁死。
- ✅ :392-394 流式空闲超时看门狗（setTimeout）有明确 abortReason='timeout' 语义并 reject 上抛，非静默挂起。
- ⚠ **P3** :470 `chat()` 无核心层重入拒绝 — 见上表。

### 3. src/core/ai-tools.js（1881 行）
- ✅ 全文件 **0 个** DOM 事件绑定、0 个交互 HTML（grep `addEventListener|onclick|oninput|<button|<a ` 无命中）——纯工具协议层，交互在视图层（属其他组范围）。
- ✅ :6 写工具统一 `PROPOSAL_NOTE`「此工具生成提案，前端将要求用户逐条确认，不会自动执行」，符合 AGENTS.md §10「写入类只生成提案、逐条确认」约定。
- ✅ :1651-1658 `export_order_excel`：先 `typeof exportOrder!=='function'` 检查（未加载返回 ok:false 的错误响应），异步执行带 `.catch` → toast 兜底，触发/失败均有响应。
- ✅ :1661-1668 `open_settlement_drawer` 先 closeModal+closeDrawer 防弹层层叠；同类功能层工具（goOrderView/openSettleDetail/openInvEdit 等）均有「未加载」守卫，不存在引用不存在函数的死交互。

### 4. src/core/help-knowledge.js（80 行）
- ✅ 纯数据（HELP_KNOWLEDGE 数组）+ `helpSearch()` 纯检索函数（同步、返回 JSON 字符串）。无事件、无 DOM、无交互元素，无可违规项。

### 5. src/core/kb.js（1090 行）
- ✅ :74/:85/:96/:106 IndexedDB open/事务 `onerror` 全部 reject 有响应，无静默失败。
- ✅ :502-556 file:// 降级目录选择：隐藏 `<input webkitdirectory>` :517 `onchange` 与 :550 `oncancel` 双事件绑定；:516 `settled` 标志防 onchange/oncancel/超时三路重复 settle；:552 5 分钟超时兜底（防浏览器 cancel 事件不触发导致「永远无响应」）；完成后 `inp.remove()` 清理。事件注册合规且有防重入。
- ✅ :730 `if(state.indexing)return;` 手动索引重入守卫；:705-708 自动重扫定时器有 `indexing||!bound` 守卫；:697 结束复位。索引入口无并发双跑风险。
- ✅ :923-925 file:// 快照模式绑定后 `toast` 说明限制（操作有反馈）。
- ✅ 无 onclick/oninput/交互 HTML。

### 6. src/core/updater.js（122 行）
- ✅ :31 `check()` 状态守卫（downloading/checking/ready 直接 return）防重复检查。
- ✅ 全文件无 DOM 事件绑定；导出 API `check/download/relaunch/autoEnabled/setAutoEnabled`（:118）与 router.js:425/465/467/469 的绑定一一对应存在（跨文件核实）；设置弹窗仅在 `isDesktop` 分支渲染并绑定（router.js:415-425），浏览器版 window.Updater 为 undefined 时相关 UI 不渲染，**不产生死交互**。
- ⚠ **P3** :66 `download()` 无函数级重入检查 — 见上表。
- ✅ :103-108 relaunch 失败兜底 setTimeout exit(0)，重启动作有后备响应。

### 7. src/core/validators.js（106 行）
- ✅ 纯函数校验库（window.FTValidators），零 window/DB 依赖、零事件、零交互元素、零 DOM 操作；无可违规项。

### 8. src/core/ai-files.js（220 行）
- ✅ 纯解析模块（window.AF），无事件绑定、无交互元素、无 HTML 生成。
- ✅ :64-73 `ensureXLSX` 复用 exporter.js `loadXLSX`（内部 `_xlsxLoading` 已防并发）；不可用时 reject 带明确中文错误。
- ✅ `parseEntry` 全路径 try/catch，失败返回 `{status:'error',error}` 结构化结果，不静默。
- ✅ 生成中禁止添加附件由视图层 ai-chat.js:429 `AI.state.chatting` 拦截（跨文件核实），链路闭合。

### 9. src/public/sw.js（68 行，仅查事件注册）
- ✅ :16 `install` / :24 `activate` / :32 `fetch` 三个事件均以 `self.addEventListener` 注册，各注册一次，无重复、无拼写错误、无遗漏关键事件（无需 message 事件：skipWaiting 已在 install 内直接调用，不走 SKIP_WAITING 消息通道）。
- ✅ install：`event.waitUntil(预缓存 → skipWaiting)`；activate：`event.waitUntil(清理旧缓存 → clients.claim)`——标准合规写法。
- ✅ fetch：仅拦截同源 GET（`method!=='GET'`、跨域直接 return 放行默认行为）；导航请求网络优先+缓存回退；静态资源 SWR。
- ⚠ **P3** :45/:60/:65 后台 cache.put 未挂 waitUntil、SWR 双失败无兜底 — 见上表。

## 交叉核验（处理函数存在性，跨全 src/）

- B 组文件生成的 HTML 中**没有任何** onclick/oninput 引用（exporter 的 `<a download>` 与 kb 的隐藏 input 均为程序化元素并即时移除），故不存在「引用不存在函数」的死交互。
- router.js:425/465/467/469 → `window.Updater.setAutoEnabled/check/download/relaunch`：✅ updater.js:118 全部导出；且仅桌面模式渲染绑定。
- ai-tools.js:1655 → `exportOrder`：✅ exporter.js:177；ai-tools.js:1647/1664 等功能层工具调用前均有 typeof 守卫。
- 与 B 组直接相关的视图层兜底：ai-chat.js:474 发送前 `AI.state.chatting` 拦截、:475-476 300ms 发送防抖、:429 附件入口拦截 —— 均有效。
- 批次共享线索（bom.js:324/328/331、search-panel.js:181、specs.js:87、orders.js:918、ai-chat.js:1146 的 oninput）**不在 B 组文件清单内**，未在本报告展开，归对应视图组核验；本组仅核对了与其交叉的调用守卫。

## 结论

B 组 9 文件整体事件合规度高：核心服务层几乎不直接持有用户交互事件（仅 ai.js pagehide、kb.js 隐藏文件选择、sw.js 三个 SW 事件），均已正确绑定、有防重入/清理/兜底；资源与异步错误均有响应（toast/reject/结构化 error）。唯一 P2 为 **exporter.js:177 导出入口缺重复触发防护**（建议入口加 busy 标志，视图按钮同步禁用）；3 项 P3 均为纵深防御类建议（updater/ai 核心入口自守卫、sw.js waitUntil 与离线兜底）。
