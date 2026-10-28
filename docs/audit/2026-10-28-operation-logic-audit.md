# 全量操作逻辑审查报告

> **日期**: 2026-10-28 ｜ **基准**: 工作区当前状态（v1.0.57，含未提交的 wiki 云端同步改动）
> **目标**: 用户要求「全面审查一遍操作逻辑，不要出现卡死、死链、无法操作的操作」——即 A 卡死 / B 死链 / C 无法操作 三类缺陷清零。
> **性质**: 静态审查（只读）+ 主线程逐条核实 + 最小化修复。**未运行构建/类型检查/lint/测试（按用户长期工作方式约定），改动未构建验证。**

---

## 一、审查方式与范围

- **7 路并行子审查**（各模块全文通读 + 交叉核对），明细见 `audit-tmp/`：
  | 分组 | 文件 | 明细 |
  |---|---|---|
  | 订单主链路 | orders.js、validators.js | audit-tmp/orders.md |
  | 资金链路 | settlements / invoices / prices.js | audit-tmp/trade.md |
  | 档案链路 | units / specs / bom / dashboard.js | audit-tmp/masters.md |
  | 数据与知识 | data.js、kb.js、wiki.js、wiki-kb.js、search-panel.js | audit-tmp/data-kb.md |
  | AI 链路 | ai-chat.js、ai.js、ai-tools.js、ai-files.js、help-knowledge.js | audit-tmp/ai.md |
  | 基础设施 | router / ui / utils / store / app / guide / updater、keyboard.js、main.js、App.vue、index.html、variables.css | audit-tmp/infra.md |
  | 导出链路 | exporter.js（全文）+ ai-files.js 复用对照 | audit-tmp/export.md |
- **主线程机械对账**：全部 inline 事件处理器 ↔ 全局函数定义对账（1310 个定义 / 225 个引用名）、`go()` 目标 ↔ render() 分支对照、`getElementById` 目标 ↔ id 定义对照、href 空链扫描——除下文已列项外无悬空。
- 所有 P0/P1 结论均经主线程读源码二次核实后才修复；每处修复在代码内带 `v1.0.57 修复` 注释。

## 二、结论总览

| 级别 | 发现 | 已修复 | 仅记录 |
|---|---|---|---|
| P0（卡死/数据丢失） | 5 | 5 | 0 |
| P1（功能无法操作/死链） | 17 | 17 | 0 |
| P2（健壮性/体验） | 39 | 28 | 11 |

修复涉及 22 个源文件 + `src/index.html`，发布记录见 `docs/version/RELEASE-v1.0.md` 顶部「未发布 · 🛡 全量操作逻辑审查与修复（不推进版本号）」分节。

## 三、P0（5 条，全部修复）

1. **编辑模式产品链无限递归**（orders.js）— `persistSourcingChange → refreshProductList（尾部 persistOrderItems）→ persistOrderItems → persistSourcingChange` 反向重入；编辑模式下寻货分配/产品增删改/批量提交全部触发，页面冻结数秒后 `RangeError`，价格库匹配多选只进第 1 家、后续 toast 全丢。修复：`_persistSourcingBusy` 重入门闩（重入调用只会重复已完成的落库与刷新，跳过无行为缺口；保留 AGENTS.md §9 既有数据流）。
2. **概览页入口串单覆盖**（router.js goOrder）— 只设 `curOrder` 对象、不设 `_fMode/_fOrderId/_fItems`：dashboard「处理/查看」要么落空白新建页，要么在编辑过订单 A 后渲染 A 的编辑页而面包屑显示 B 单号，保存即整单覆盖 A。修复：goOrder 转调 `goOrderEdit(id)`（含状态四件套与草稿绑定）；「查看」语义按钮（最近订单表）改调 `goOrderView`。
3. **回收站恢复假成功**（store.js restoreFromTrash）— 所属订单已不存在时恢复明细静默丢弃数据、仍删回收站条目并提示「已恢复」。修复：抛错保留条目，`restoreTrashItem` 的 catch toast 具体原因。
4. **AI 回滚毁单**（ai-tools.js update_order_meta）— before 为 4 字段部分快照，undoAiOp 的 update 分支整行替换订单对象，回滚后丢 id/status/items。修复：`before=_snap(o)` 整对象快照（与其余 update 执行器口径一致）。
5. **导出双卡死**（exporter.js）— ① loadScript 无超时：vendor 缺失 + CDN 连接挂起时 `await loadXLSX()` 永不 settle，`_exportBusy` 永久 true，之后所有导出被「正在导出，请稍候…」挡死；② downloadWorkbook 用 `new Promise(async executor)` 包裹，`XLSX.write` 等同步异常的 rejection 被构造器吞掉，外层永远 pending 且无错误提示。修复：10s 超时（reject 并清理 script 标签）+ 改 async 函数整段 try/catch。

## 四、P1（17 条，全部修复）

| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| 1 | 单位筛选整条死功能：`#settleUnitFilter`/`#invUnitFilter` 从未渲染，bindView 绑定悬空，过滤逻辑三处不可达 | settlements.js / invoices.js / router.js | 两页工具栏照报价页 `filt-combo` 惯例补渲染 combo 容器（`data-val` 回填现有筛选状态） |
| 2 | ⌘K 订单结果永远落列表（curOrderView 先设后被 go() 清空） | search-panel.js:47 | action 改 `goOrderView(o.id)` |
| 3 | wiki 全文搜索命中线上文章点击/回车无反应（`openWikiDoc('')` 直接 return） | wiki.js _wikiHitRow | 按 `d.url` 分流 `openWikiExternal` |
| 4 | 操作历史假回滚：order_item 更新类（assign_supplier 等 4 工具）被静默跳过却标已回滚；spec/order_item 的 create 回滚必抛错被行内 onclick 吞掉 | store.js undoAiOp / data.js | update 分支按 targetId 全库定位明细用 before 快照整体还原；create 分支定向移除；data.js 新增 `undoAiOpSafe` 包装（失败 toast 原因） |
| 5 | confirmModal 右上角 × 不走 onCancel：导入/恢复确认框点 × 后 `await` 永挂、导入按钮 loading 永不清除 | ui.js:137 | × 改为模拟点击 `_modalCancel`（与 Esc 路径一致） |
| 6 | 首个会话（空库初始化）所有删除静默失效：initApp 三个空库分支缺 `trash/aiOps/wikiMeta` 且未调 ensureDBFields，softDelete→`DB.trash.unshift` TypeError 被吞 | store.js initApp | 三处补调 `ensureDBFields()`（与 importParsedData 收口对齐） |
| 7 | modal() 兜底关闭破坏「校验失败留在弹窗」契约：价格库匹配/手动供应商校验失败时内联错误随弹窗销毁、输入全丢 | ui.js + orders.js | onOk 显式返回 `false` 时跳过兜底 closeModal；submitPriceMatch（2 处）/manualSupplier（5 处）校验分支改 `return false` |
| 8 | combo 下拉 Esc 不阻断冒泡，收下拉同时连带关闭宿主弹窗/抽屉（输入全丢） | utils.js | Esc 分支补 preventDefault+stopPropagation |
| 9 | BOM 六维筛选选中即失效：onSelect 调 render() 全量重建筛选栏，data-val 硬编码清空，AND 组合不可能、翻页即清 | router.js bindView + bom.js | 改 `refreshBOMTable()` 局部刷新 + 新增 `_bfVals` 状态持久与回填；clearBOMFilter 同步重置 |
| 10 | 单位联系人删中间行后保存：name 按位置、phone/sides 按 data-i 匹配，交叉错乱 | units.js readContacts | 改按 `[data-crow]` 行容器收集 |
| 11 | BOM 批量导入 `.filter(c=>c.trim())` 压缩空列，中间空格致后续字段整体左移错位 | bom.js | 改 map 保留空位 + 整行全空跳过（与 units.js 导入对齐） |
| 12 | 结算记录无删除入口：delSettlement 全仓无调用点，录错的资金记录 UI 上删不掉（发票级联勾选随之不可达） | settlements.js | 明细抽屉「结算记录」表补「操作」列删除按钮（id 过 escJsStr） |
| 13 | 新建结算幽灵单位：单位 combo allowCreate=true 可自由输入不存在的单位，金额从结算页聚合消失、发票页出现孤儿，两页对不上 | settlements.js | 两处 allowCreate 改 false + submitSettlement 增加单位存在性校验 |
| 14 | read_local_file（v1.0.57 桌面版新只读工具）路由断裂：落 writeOps 必弹确认且执行必报「未知工具」 | ai.js:725 + ai-tools.js | queryOps 条件追加 FILE_TOOL_NAMES（writeOps 同步排除）+ AIT 导出 FILE_TOOL_NAMES |
| 15 | AI 写入成功/计划创建后 render() 全量重建 #app 销毁打开中的 AI 抽屉：「撤销本轮改动」条与执行计划卡永不显示（undoAIBatch 主路径死功能） | ai-chat.js | 抽屉打开中推迟 render（置 `window._pendingRenderOnDrawerClose`），closeDrawer 钩子在关闭后补刷背景 |
| 16 | 桌面版「停止生成」完全无效：tauri 分支从不创建 AbortController、Rust 无中止命令 | ai.js | 流监听检测 `abortReason==='manual'` 丢弃后续块；invoke 返回后二次拦截以 AbortError 收尾 |
| 17 | `_sourcingCtx` 全仓无声明：未开过寻货抽屉时首次读取 ReferenceError，编辑模式产品变更不落库、toast/补录弹窗丢失（并掩盖 #1 的递归） | orders.js | 补 `let _sourcingCtx=null;` |

## 五、P2（39 条：28 已修复 / 11 仅记录）

### 已修复（28 条，按文件归组）

- **exporter.js**：导出全程补「正在生成 Excel 文件…」反馈；保存对话框取消（AbortError）不再静默回退 `<a download>` 自动下载。
- **store.js**：ensureDBFields 补订单 `items` 空数组兜底（导出六分支/概览统计的 TypeError 免疫，单点收口替代 16 处散改）；saveDB 的 `p.finally()` 补 catch 消除 Uncaught (in promise) 噪音；performBackup/restoreBackup/listBackups 前置 `fhPerm` 授权守卫（失效给明确指引而非 NotAllowedError 原文，列表不再误报「暂无备份文件」）。
- **utils.js**：orderProfit/orderSales/orderCost/orderIntent 补 `(o.items||[])`；roleBadge 补 roles 空防护。
- **dashboard.js**：roles 缺失时裸调 `.includes` 整页白屏 → `||[]`；「查看」按钮改 goOrderView（只读详情语义）。
- **router.js**：restoreFromHash 放行 `wiki`（刷新不再回落 dashboard、面包屑补齐）+ 无 oid 订单路由清理三模式残留（hash 与 localStorage 两条路径）；goOrderEdit 补 updateHash、curOrder 改克隆对象（面包屑单号恢复、hash 语义对齐）；面包屑取值补 `_fOrderId`；render() 重置 body 滚动锁（⌥ 导航销毁抽屉后整页不可滚动的兜底）。
- **keyboard.js**：Esc 链顶部 Coach 蒙层守卫（不再「关引导+退列表」叠加）；弹窗 Esc 改模拟点击取消键（onCancel 语义与 confirmModal 内建一致）；⌥ 导航弹层守卫；⌘S 帮助文案与实现对齐（仅抽屉生效）。
- **search-panel.js**：面板 Esc stopPropagation（详情页关面板不再连带导航回列表）。
- **settlements.js**：列表行 onclick unitId 过 escJsStr（含单引号 ID 不再产生死按钮）；抽屉延时绑定回调补 st_type 判空。
- **invoices.js**：openInvEdit 改先读输入校验、通过后再一次性写 inv（拦截后脏写不再被持久化）；syncInvoices 收尾复位 `_invSyncDirty`（守卫恢复生效，渲染不再每次全量重跑三次）。
- **prices.js**：openPriceBatchAdd 重置 `_batchPriceData`（跨会话残留不再重复入库）；联系人下拉判空。
- **bom.js**：clearBOMFilter 同步重置 `_bfVals`。
- **units.js**：delUnit/batchDeleteUnits 引用提示补结算/发票计数；editUnit 不再写 unit 草稿（避免「新建单位」误恢复他人数据）。
- **specs.js**：移除永久隐藏的 `sgu_` 引用统计死元素（顺带省一遍全库扫描）。
- **orders.js**：批量预览字段错位（r.price→r.salePrice、金额 NaN）；`_batchOrderData`/`_quoteImportData` 提交后清空（重复入库/统计污染）；refreshOrderList 同步搜索框与状态下拉显示（清除筛选后控件不再显示旧值）；toast 'warn'→'warning'（图标 undefined）；列表 checkbox data-id 补 escAttr。
- **ai.js**：首块到达前手动停止不再误报「无法连接模型服务」；上下文压缩失败降级为截断最近 6 条（按既有注释承诺）。
- **ai-tools.js**：update_order_item 改 `_pick` 字段白名单（模型附带字段不再整体写入明细破坏寻货数据）；add_manual_supplier 自动创建的单位/价格补记 aiOps（整批撤销无孤儿残留）。
- **ai-files.js**：ensureXLSX 就绪门补 `style_version`（与 exporter 对齐）。
- **kb.js**：批量选择文件取消（AbortError）捕获并返回 cancelled（与 chooseDir 语义一致）；rescan 防并发守卫。
- **wiki.js**：openWikiExternal 去掉 'noopener' 第三参（返回值恒 null 导致每次误弹「被拦截」提示）；云端索引脚本加载 10s 超时（finish 幂等，挂起后会话内不再永不重试）。
- **data.js**：操作历史「回滚」按钮改走 `undoAiOpSafe`（失败有 toast）。
- **index.html**：`#app` 内置加载文案（dist 不完整/极旧浏览器时不再纯白屏）。

### 仅记录待后续（11 条，未改）

1. **订单状态机双轨**：changeOrderStatus 不接 canFlowOrderStatus、NEXT_STATUS 无反向边（「上一步」UI 可流、AI 拒绝）——对齐方向需产品决策（补反向边 or UI 接校验）。
2. **「上一步」的结算回退保护为不可达死分支**（locked 状态不渲染 prev 按钮，FROM_SETTLE 校验形同虚设）。
3. **编辑表单状态下拉近似无限制**可跳状态（跳到「签约完成」且无分配时「进入送货」按钮不渲染，入口条件与函数守卫不一致）。
4. **订单草稿单键互覆**：编辑覆盖未提交的新建草稿、详情寻货误清——需按 `order_new`/`order_edit_<id>` 拆键。
5. **新建订单模式无法经 hash/localStorage 恢复**（刷新丢表单，草稿只有再次点新建才提示）。
6. **settle 0 应收单位落入「已收」子Tab却标红「未结算」**（分类与状态标签自相矛盾）。
7. **WikiKB 文章 id 按 list.json 下标生成**：服务端顺序变化后分块归属串文章——需改 url 派生稳定 id + 旧库迁移。
8. **WikiKB 全量同步无进度**、单篇 30s 超时串行批次，断网时按钮长时间禁用。
9. **KB 网页版目录读取失败误报「没有受支持文件」**（walkDir errs 被丢弃）。
10. **Coach 子路由不触发父模块引导、重看引导无 UI 入口**（归并逻辑一行可修，入口需设计）。
11. **AI 附件 Excel 同步解析阻塞主线程**（大文件冻结 UI，需 worker/分表 yield 方案）；`read_local_file` 的 `__rfCache` 无上限无过期。

## 六、已核实无问题的类别（审查覆盖说明）

- **路由完整性**：go() 全部目标在 render() switch 均有分支（dashboard/units/specs/bom/prices/orders/settle-*/settlements/invoices/inv-*/data/wiki），无死路由。
- **弹层生命周期**：modal/confirmModal/drawer 四路关闭齐全、z-index 链正确（modal 1050 > drawer 1000）、async onOk 防双击、dirty 关闭二次确认、confirmOpsModal 五路 settle。
- **渲染与存储**：无渲染死循环、无主线程同步大循环（分页 PAGE_SIZE=20）；IndexedDB 5s 超时兜底、配额满一次性 toast、启动失败有错误界面（本轮再加 #app 加载文案）。
- **注入面**：用户数据出口均过 escHtml/escAttr/escJsStr（本轮补齐 2 处遗漏）；系统 id 受 SAFE_ID_RE 清洗闭环。
- **AI 提案链**：脏提案校验+checkbox 禁用、全无效以取消语义回填、执行失败不产生 aiOps、浏览器版无 Key 全入口拦截、附件解析永不 reject。

## 七、验证声明（如实）

- **已做**：7 路静态审查 + 主线程逐条核实（P0/P1 全部读源码确认）；全部改动落盘核对（grep）；关键结构性改动（persistSourcingChange try/finally、undoAiOp switch 重写、downloadWorkbook 重写）回读复核。
- **未做**：按用户长期工作方式约定，本轮**未运行** `npm run vite:build`、类型检查、lint、测试等任何验证——以上修复**未构建验证**。
- **风险提示**：全部业务 JS 经 App.vue 以单次间接 eval 执行，任何一处语法错误都会导致启动失败。建议合并前 `npm run vite:build` 一次并双击 `dist/index.html` 冒烟，重点路径：①订单编辑→价格库匹配多选（原递归点）②概览页「处理/查看」③⌘K 搜订单跳详情④导出 Excel⑤BOM 六维组合筛选⑥结算/发票页单位筛选⑦AI 提案执行后撤销条显示。

## 八、附录

- 分模块审查明细：`audit-tmp/{orders,trade,masters,data-kb,ai,infra,export}.md`（7 份）
- 机械对账脚本：`audit-tmp/scan.mjs`（inline 处理器/路由/id 对账，可复用）
- 发布记录：`docs/version/RELEASE-v1.0.md` 顶部「未发布 · 🛡 全量操作逻辑审查与修复（不推进版本号）」
