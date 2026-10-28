# 导出链路审查（exporter.js 全文 1965 行 + ai-files.js loadXLSX 复用对照）

- 日期：2026-10-28 ｜ 性质：静态只读审查 ｜ 工作区：`src/core/exporter.js`（全文通读）、`src/core/ai-files.js`、`src/core/utils.js`、`src/core/store.js`、`src/views/orders.js`、`src/views/ai-chat.js`
- 数量统计：**P0 = 2 ｜ P1 = 0 ｜ P2 = 4**；B（死链）/ 并发注入 / 文件名特殊字符已查，未发现问题（见「已查无问题」）。

---

## 问题清单

### P0-1 ｜ loadScript 无超时：网络挂起时 `await loadXLSX()` 永不 settle，导出永久卡死
- 文件:行：`src/core/exporter.js:49-63`（loadScript 仅挂 onload/onerror）、`:79-97`（本地→CDN 兜底链）、`:185`（exportOrder await）、`:178,183,200`（_exportBusy 仅在 finally 复位）
- 用户触发场景：dist 拷贝不完整导致 `vendor/cpexcel.js`/`xlsx.min.js` 本地 404，回退 CDN 时连接被代理/防火墙挂起（onerror 长时间不触发，浏览器对停滞请求无脚本级超时）。点「导出Excel」后**无任何 spinner/提示**，且 `_exportBusy` 永久为 true——此后所有导出点击只回「正在导出，请稍候…」，必须刷新页面才能恢复。
- 证据：`s.onerror = function () { rej(new Error('加载失败: ' + src)); };`（58 行）之后无任何超时/abort 机制。
- 最小修复：loadScript 内加超时（如 10s `setTimeout`→`rej` 并 `s.remove()`），reject 时清理已注入的 script 标签。
- 置信：代码结构确定（高置信）；触发依赖网络环境。

### P0-2 ｜ downloadWorkbook 用 async executor 包 Promise：同步异常的 rejection 被吞，外层 Promise 永远 pending
- 文件:行：`src/core/exporter.js:122-123`（`return new Promise(async function…)`，第一行 `window.XLSX.write` 在 try 之外）；六分支调用点 `:618 / :945 / :1127 / :1413 / :1795 / :1963`
- 用户触发场景：`XLSX.write` 序列化抛错（单元格数据异常、库内部错误、`new Blob`/`createObjectURL` 的 QuotaExceeded 等任何 try 块外异常）→ async executor 返回的 rejected promise 被 Promise 构造器忽略 → 各分支 `await downloadWorkbook` 永不返回 → exportOrder 的 catch/finally 均不执行 → **无错误 toast、无下载、_exportBusy 永久 true**，之后导出全部被挡，必须刷新。
- 证据：`return new Promise(async function (resolve, reject) {`（122）+ `let u8 = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });`（123，未包 try）。
- 最小修复：去掉 async executor——改为 `async function downloadWorkbook(...)` 内整段 try/catch，或至少把 123 行包进 try 并 `reject(e)`。
- 置信：rejection 丢失的结构性缺陷确定（高置信）；触发面较窄（正常链路数值均经 `parseFloat||0` 消毒），但一旦触发即静默卡死。

### P2-1 ｜ 六分支对 `o.items` 防护不一致：4 个分支在 items 缺失时 TypeError 中断
- 文件:行：无防护——pendingConfirm `:515,546,575,588`、sourcing `:715,732,803,884`（orderIntent/orderCost/orderSales/orderProfit 也直接 `o.items.reduce`，utils.js:582-601）、quoting `:1019,1077,1108`、general `:1871,1881,1909,1944`；有防护——signedComplete `:1177,1199`、delivering `:1468,1490`（`(o.items || [])`）
- 用户触发场景：仅导入/恢复旧版或手改备份可造出缺 `items` 的订单——importParsedData 只校验 `Array.isArray(data.orders)`（store.js:1432），ensureDBFields（store.js:76 起）与 migrateItems（store.js:828 `(o.items||[])`）均不补建 items。此后点导出 → toast「导出失败：Cannot read properties of undefined (reading 'length')」→ 导出中断（有提示、不卡死、可重试），但文案面向开发者；且六分支行为不一致。
- 证据：`'产品明细（共 ' + o.items.length + ' 项…`（515）vs `const recvRows = (o.items || []).map(…`（1177）。
- 最小修复：四分支统一 `(o.items||[])`；或 importParsedData 覆盖前补 `o.items=o.items||[]`。
- 补充：`items` 为空数组（非缺失）时六分支均正常导出 0 行明细，sourcing 汇总显示 0/0/0，不报错。

### P2-2 ｜ showSaveFilePicker 用户取消（AbortError）后静默回退 <a download> 自动下载
- 文件:行：`src/core/exporter.js:126-144`（catch 只区分 AbortError 决定是否 console.error，均继续向下）、`:145-165`（blob + `<a download>` 回退）
- 用户触发场景：用户在系统保存对话框点「取消」→ 浏览器又自动把文件下载到默认目录，与「取消」意图相悖，可能造成重复文件/覆盖困惑。
- 证据：`if (err.name !== 'AbortError') { console.error(…) }`（143-144）——取消与失败都落入同一回退路径。
- 最小修复：`err.name === 'AbortError'` 时直接 `return`（不 resolve 也不回退下载），其余错误才回退。

### P2-3 ｜ 导出全程无 loading 反馈
- 文件:行：`src/core/exporter.js:179-201`（exportOrder 无 spinner、不禁用按钮，仅结束/失败时 toast）
- 用户触发场景：首次点击到结果 toast 之间（本地加载通常快，CDN 兜底或大表构建时数秒）按钮「看起来没反应」；与 P0-1 叠加时用户完全无感知，是「点了导出没动静」投诉的直接来源。
- 证据：exportOrder 内无任何 DOM 反馈代码，仅 `toast('导出成功/失败…')`。
- 最小修复：`await loadXLSX()` 前 toast('正在生成文件…','info')，或利用已有 `_exportBusy` 把导出按钮置灰。

### P2-4 ｜ AF.ensureXLSX 与 loadXLSX 就绪门不一致 + loadXLSX 起手清空 window.XLSX（对照项）
- 文件:行：`src/core/ai-files.js:33-43`（门：`window.XLSX.utils && typeof read==='function'`）vs `src/core/exporter.js:36`（门：`window.XLSX.style_version`）、`:41`（`window.XLSX = undefined`）
- 用户触发场景：仅当全局存在**无 style_version** 的旧版 SheetJS 时两处判定分叉；此时导出触发的重载会瞬时清空 `window.XLSX`，若 AI 附件解析恰在进行中 → `XLSX.read` TypeError → 被 parseEntry 的整体 catch（ai-files.js:185-187）捕获，附件 toast 失败，**不会卡死**。本应用 window.XLSX 只来自 vendor xlsx-js-style（带 style_version），现状触发概率≈0，记录差异备查。
- 证据：`if(window.XLSX&&window.XLSX.utils&&typeof window.XLSX.read==='function')return Promise.resolve();`（ai-files.js:34）。
- 最小修复：ensureXLSX 门补 `&& window.XLSX.style_version`，与 exporter 对齐。

---

## 已查无问题（含审计要求逐项答复）

- **双失败后的用户反馈（正常断网）**：本地 onerror → CDN 兜底（exporter.js:74-77，CDN 带 SRI 校验 :66-68）→ 双失败 reject（:95-96）→ exportOrder catch → toast「导出失败：SheetJS 加载失败（本地与 CDN 均不可用）」（:197-199）→ finally 复位 busy（:200）。**不静默、不转圈、可重试**；卡死只发生在 P0-1/P0-2 两类场景。
- **file:// 动态注入错误处理**：`<script>` 相对路径 `vendor/…` 在 file:// 下缺失文件会触发 onerror（Chromium net::ERR_FILE_NOT_FOUND），兜底链完整；唯一缺口是无超时（P0-1）。
- **重复快速点击并发注入**：`_exportBusy`（:178-183，按钮与 AI 工具 ai-tools.js:1689 两个入口都经 exportOrder）+ `_xlsxLoading`（:13,37）双守卫，**不会并发注入多个 script**；失败后 `_xlsxLoading=null`（:90,95）可重试。
- **B 死链**：`exportOrder` 全局定义（exporter.js:179）；详情页按钮无条件渲染（orders.js:176，id 经 escJsStr）；依赖符号 pName/itemOpts/itemAllocSum/itemQuotePrice/itemSourcingStatus/itemProfit/specLabel/orderIntent/orderCost/orderSales/orderProfit/fmtN/toast/escJsStr 全部有全局定义（utils.js:466/547/553/565/575/576/582/588/594/601/478/651/454），eval 顺序 utils→exporter 在前；六状态 switch（:187-194）+ default 兜底覆盖 ORDER_STATUSES 全部枚举（store.js:51 含「异常/取消」→ general 分支）。
- **文件名特殊字符**：fname=`'采购订单_'+o.id+'_'+o.status`（:617 等）；o.id 来自 genOrderNo（store.js:110-115，`POyyMMddd-序号`）或导入时 SAFE_ID_RE=`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` 清洗（store.js:120-127）；status 为固定中文枚举。即使出现非法字符，showSaveFilePicker 的 TypeError 也被 catch（:142-144）回退 `<a download>`（浏览器自动净化文件名）。无风险。
- **六分支数据残缺（无供应商报价/无结算记录）**：signedComplete/delivering 对空 options、空 suppliers、`DB.settlements` 缺失均有防护并输出「本单暂无供应商分配记录」（:1690-1692、:1747-1750 一带）；settleMatched 用 `(DB.settlements||[])`（:1190,1481）。无抛错路径（items 缺失除外，见 P2-1）。
- **AI 附件复用侧**：parseEntry 整体 try/catch（ai-files.js:147-188）返回 status:'error'，ai-chat toast 提示（ai-chat.js:471-474），无挂起。

## 建议的下一步
1. 修 P0-1/P0-2（同属 downloadWorkbook/loadXLSX 的 Promise 骨架，可一次改动覆盖）。
2. 顺手统一六分支 `(o.items||[])`（P2-1 最小改动）。
