# 版本发布日志 · v1.0

> 本文件按主版本组织：v1.0.x 的全部迭代日志集中于此（最新在前）。
> 命名规则：`RELEASE-v{主版本}.md`；次版本迭代追加到文件顶部新分节。

---

## v1.0.6 · 📝 待发布

> **状态**: 📝 待发布（内容已实现，版本号未递增）
> **发布日期**: 2026-08-26
> **上一版本**: v1.0.5
> **版本范围**: 回收站自动清理 + 功能层工具确认策略 + AI 操作统计报表

---

## 一、版本概览

v1.0.5 全面审查修复后的三项增量优化，聚焦数据安全、操作可追溯与可视化：

- **回收站自动清理**：90 天保留期 + 超期自动清理（数据安全，防无限膨胀）
- **功能层工具确认策略**：三分流确认策略完善，导出操作纳入审计（可追溯）
- **AI 操作统计报表**：操作历史新增全量统计面板（可视化运营）

---

## 二、新增与优化

### 2.1 回收站自动清理

回收站从「永久保留 + 手动清空」升级为「90 天保留 + 自动清理」：

| 项目 | 设计 |
|------|------|
| 保留期 | `TRASH_RETENTION_DAYS = 90`（store.js 常量，可调） |
| 触发时机 | 应用启动（initApp 数据加载后，含降级模式）+ 打开回收站（renderTrash 渲染前） |
| 幂等 | 每天最多执行一次（localStorage `TRASH_CLEANUP_KEY` 记录上次清理时间），`force` 参数可绕过（供自检/手动） |
| 关联处理 | 清理时关联的未回滚 delete 类 aiOps 标记 `autoPurged`：操作历史显示「已自动清理」灰标、不提供回滚按钮；`undoAiOp` 对 autoPurged 记录直接拒绝（双保险） |
| 隔离边界 | 清理是系统平台行为，与「AI 与回收站隔离」原则不冲突——AI 仍无任何回收站操作能力 |
| 用户提示 | 自动清理时 toast「已自动清理 N 条超过 90 天的回收站记录」；回收站工具栏显示保留期说明 |

### 2.2 功能层工具确认策略

aiWriteLoop 三分流确认策略完善（功能层工具自动执行，导出纳入审计）：

| 工具类别 | 副作用 | 确认 | 审计 | 回滚 |
|---------|--------|:---:|:---:|:---:|
| 查询（query_*） | 无 | 自动执行 | 不记 | — |
| 功能层：navigate_view / open_*_drawer | 无（纯 UI） | 自动执行 | 不记 | — |
| 功能层：export_order_excel | 有（生成文件） | 自动执行 | ✅ 记 `op:'export'` | 不可回滚 |
| 写入/删除/流转 | 有（改数据） | ✅ 确认弹窗 | ✅ 记 aiOps | ✅ 可回滚 |

**核心原则**：功能层工具不打断对话流，但有副作用的导出必须可追溯。操作历史新增「导出」徽章（蓝色 info 样式），记录导出时间、订单、操作者（AI）；`undoAiOp` 增加 `case 'export'` 防御（抛错「导出操作不可回滚」）。

### 2.3 AI 操作统计报表

操作历史 tab 顶部新增 `renderOpsStats()` 统计面板（全量统计，不受筛选影响）：

- **六项指标卡**：总操作 / AI 操作（含占比）/ 用户操作 / 已回滚（含 AI 回滚率）/ 操作批次 / 自动清理
- **操作类型分布**：create/update/delete/restore/flow/assign/export × AI/用户拆分 + AI 占比条形图
- **数据域分布**：单位/属性/BOM/报价/订单/明细/结算/发票/导出 次数 + 占比条形图（降序）
- **近 7 天趋势**：每日操作数 CSS 柱状图（无图表库依赖，柱顶显示数值）

---

## 三、验证

- 回收站自动清理逻辑测试 8/8（过期清理/未过期保留/aiOps 标记/回滚拒绝/幂等）
- 统计报表逻辑测试 12/12（指标数值/分布/趋势渲染）
- vite build 通过（772KB）

---

## 四、变更文件

| 文件 | 变更 |
|------|------|
| `src/core/store.js` | TRASH_RETENTION_DAYS / autoPurgeTrash / undoAiOp autoPurged+export 防御 / initApp 触发 |
| `src/views/data.js` | renderTrash 触发清理 + 保留期提示 + renderOpsStats 统计报表 + autoPurged/导出展示 |
| `src/core/ai.js` | aiWriteLoop flow 分支导出审计 |
| `src/styles/components.css` | ops-stats 统计样式 |
| `docs/API.md` | 自动清理与确认策略说明 |

---

### 后续规划（未来升级迭代方向）

- **行业知识库扩展**：将紧固件行业知识（材料牌号对照、热处理工艺、表面处理标准、螺纹规格体系、常见标准 GB/T/DIN/ISO 等）持续灌输到 `HELP_KNOWLEDGE` 知识库——AI 不仅能指导系统操作，还能作为**行业顾问**（选材建议、规格换算、标准查询、工艺答疑），配合现有 query_help 检索机制按需调用，不增加常规对话成本。新增主题只需在 `src/core/help-knowledge.js` 的 `HELP_KNOWLEDGE` 数组追加条目，零协议改动。

---

## v1.0.5 · ✅ 已发布

> **发布日期**: 2026-08-26
> **上一版本**: v1.0.4
> **版本范围**: AI 数据操控升级方案 · 阶段 4（功能层 + 打磨）+ 全面审查修复

---

## 一、版本概览

本次版本是「AI 数据操控升级方案」四个阶段全部完成后的功能层落地与代码打磨版本。

- **阶段 1**（数据模型 + 回收站 + 操作历史）→ v1.0.1
- **阶段 2**（Function Calling 协议）→ v1.0.2
- **阶段 3**（全量工具 + 订单复杂操作）→ v1.0.3
- **阶段 4**（功能层 + 打磨）→ v1.0.4
- **全面审查与修复**（P0/P1/P2/P3 共 12 项）→ **v1.0.5**

AI 现可对单位、属性、BOM、报价、订单、结算、发票数据进行增删改查（删除走回收站软删除），并支持视图导航、Excel 导出、打开抽屉等功能层动作。所有写入操作均生成操作日志，支持单条/整批回滚。

---

## 二、新增功能

### 2.1 功能层工具（4 个，自动执行不经弹窗）

| 工具名 | 用途 | 触发动作 |
|--------|------|---------|
| `navigate_view` | 视图导航 | 跳转到 dashboard/units/specs/bom/prices/orders/settlements/invoices/data 及细分视图 settle-receipt/settle-payment/inv-issue/inv-receive；viewName=orders 且提供 orderId 时导航到订单详情 |
| `export_order_excel` | 导出 Excel | 触发浏览器下载，按订单状态自动选择导出模板（待确认/寻货中/报价中/签约完成/送货中等） |
| `open_settlement_drawer` | 打开结算抽屉 | 调用 `openSettleDetail(unitId, tabType)`，tabType 支持 receipt/payment |
| `open_invoice_drawer` | 打开发票抽屉 | 调用 `openInvEdit(invoiceId)` 进入发票编辑 |

**设计原则**：功能层工具属 `kind:'flow'`，与查询类（query_*）一样自动执行，结果回填给模型，不经用户确认弹窗。

### 2.2 aiWriteLoop 三路分流

`ai.js` 的 `aiWriteLoop` 现按工具类型分流为三路：
- **查询类**（query_*）→ 自动执行，结果回填
- **功能层**（flow 类）→ 自动执行 UI 动作，结果回填
- **写入类**（write/delete）→ 走用户确认弹窗，批量执行写入 DB + aiOps

通过 `AIT.FLOW_TOOL_NAMES`（Set 集合）识别功能层工具，引入 `flowSet` 局部变量统一防护 AIT 未加载场景。

### 2.3 错误处理边界

新增 `_friendlyError(e)` 错误分类器，把底层异常转换为对用户友好的中文提示：

| 异常类型 | 转换结果 |
|---------|---------|
| AbortError（用户主动中止） | 透传，由调用方专门处理 |
| TypeError / `Failed to fetch` / `NetworkError` / `loadfailed` | 「网络连接失败，请检查网络后重试」 |
| 含 `tauri` / `invoke` / `非 Tauri 运行时` | 「AI 服务调用异常：...」 |
| 含 `stream` / `sse` / `eventsource` | 「AI 响应流中断，请重试」 |
| HTTP 4xx/5xx（已在 webChat 包装） | 原样透传 |

`chat()` 函数包裹 `_friendlyError`，所有网络/流式/tauri 异常在到达 ai-chat.js 之前已完成分类。

### 2.4 并发脏读检测

引入 `__beforeFingerprint` 机制，防止用户在确认弹窗期间数据被外部并发修改：

- **ai-chat.js** `confirmOpsModal` 在用户确认时，为每条 op 注入 `__beforeFingerprint`（基于 `validation.preview.before` 的 JSON 字符串）
- **ai-tools.js** `_checkDirty(op)` 重新调用 validator 拿当前 before，对比指纹
- **executeOp** 单独调用时检测，不一致返回「数据已被修改，请刷新后重试」
- **executeOps** 批量入口先做一次批量脏读检测，任一条不一致整批拒绝；通过后批量内顺序执行不再检测（避免前序 op 修改后续 op 数据误报）

### 2.5 操作历史筛选器

`data.js` 操作历史 tab 新增筛选条，支持三个维度筛选：

| 筛选维度 | 取值 |
|---------|------|
| 操作类型 | 全部 / 新增 / 修改 / 删除 / 恢复 / 流转 / 寻货 |
| 操作者 | 全部 / AI / 用户 |
| 批次 | 全部 / 前 20 个有未回滚 op 的批次（显示前 8 位） |

筛选状态保存在 `window._aiOpsFilter`，切换 tab 或刷新后丢失（属临时筛选）。筛选后无匹配记录时显示「重置筛选」快捷链接。

### 2.6 AI 操控系统自检

新增 `_aiOpsSelftest()` 函数与「自检」按钮（位于筛选条右侧），检查项包括：

1. **aiOps 数据结构** — 是否数组、条数
2. **操作记录字段完整** — id/timestamp/op/type 必备字段
3. **关键函数可用性** — 通过 `_AI_OPS_FNS`（store.js 导出）检查 recordAiOp/undoAiOp/undoBatch/softDelete/restoreFromTrash/purgeTrash/clearTrash 等
4. **AIT 模块加载** — TOOLS_DEFS/validateOp/executeOps/runQuery/runFlow/FLOW_TOOL_NAMES
5. **trash 数组结构** — 是否数组、条数

自检结果以 modal 弹窗展示，全部通过显示绿色「✓ 全部 N 项检查通过」，失败项红色醒目，并通过 toast 反馈摘要。

### 2.7 navigate_view 扩展细分视图

`navigate_view` 的 `viewName` enum 扩展支持 4 个细分视图，AI 可精确控制 tab 切换：
- `settle-receipt`（收款记录）
- `settle-payment`（付款记录）
- `inv-issue`（开票记录）
- `inv-receive`（收票记录）

---

## 三、优化与修复

### 3.1 P0 严重修复（1 项）

| 问题 | 位置 | 修复 |
|------|------|------|
| aiWriteLoop 中 `AIT.FLOW_TOOL_NAMES.has()` 防护不足，AIT 未加载时抛 TypeError | ai.js | 引入 `flowSet` 局部变量统一防护 |

### 3.2 P1 功能修复（5 项）

| 问题 | 位置 | 修复 |
|------|------|------|
| `_friendlyError` 正则 `network` 过宽，可能误判 | ai.js | 收紧为 `Failed to fetch\|\bNetworkError\b\|loadfailed` |
| 自检弹窗 `onOk=null` 导致「关闭」按钮无反应 | data.js | 改为 `function(){closeModal();}` |
| runFlow 异步导出反馈不准，模型可能基于「已导出」做后续推理 | ai-tools.js | 回填措辞改为「已触发 Excel 导出（异步执行，结果以浏览器下载为准）」 |
| navigate_view 副作用大，离开订单编辑模式无提示 | ai-tools.js | 若 `view!=='orders' && curOrder`，先 `closeModal()/closeDrawer()` 并 toast 提示「已离开订单编辑模式」 |
| 抽屉类工具未先关闭已有 modal/drawer，可能层叠 | ai-tools.js | open_settlement_drawer/open_invoice_drawer 调用前先 `closeModal();closeDrawer();` |
| 批量入口完全跳过脏读检测 | ai-tools.js | executeOps 入口先做一次批量脏读检测，任一条不一致整批拒绝；通过后批量内顺序执行不再检测 |

### 3.3 P2 体验优化（5 项）

| 问题 | 位置 | 修复 |
|------|------|------|
| batchUndoneCount 在筛选场景下计数偏小，与 undoBatchConfirm 不一致 | data.js | 改为遍历全量 allOps 统计 |
| navigate_view 缺少 tab 控制 | ai-tools.js | schema enum 与 validators VIEWS 同步扩展 4 个细分视图 |
| 自检按钮带 `icon('check')` 与旁边「重置」按钮风格不一致 | data.js | 去掉 icon，统一为纯文本 `btn sm` |
| `_aiOpsSelftest` 函数名硬编码，store.js 重命名需手动同步 | store.js / data.js | store.js 导出 `_AI_OPS_FNS` 数组，data.js 自检优先引用，降级 fallback 兼容旧版 |

### 3.4 P3 轻微改进（1 项）

| 问题 | 位置 | 修复 |
|------|------|------|
| 筛选下拉不支持按批次筛选 | data.js | 新增「批次」下拉（列出有未回滚 op 的前 20 个批次），renderOpsHistory 应用 batchId 过滤 |

---

## 四、文件改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/core/ai-tools.js` | 新增 + 修改 | 4 个功能层工具 schema/validator/runFlow；_checkDirty 脏读检测；executeOps 批量脏读检测；navigate_view enum 扩展 |
| `src/core/ai.js` | 修改 | aiWriteLoop 三路分流（flowSet 防护）；chat 函数包裹 _friendlyError；buildSystemPrompt 补充功能层工具说明与规则 8 |
| `src/core/store.js` | 新增 | 导出 `_AI_OPS_FNS` 函数名清单 |
| `src/views/ai-chat.js` | 修改 | confirmOpsModal 注入 `__beforeFingerprint` |
| `src/views/data.js` | 新增 + 修改 | renderOpsFilter/_setAiOpsFilter/_aiOpsSelftest；renderOpsHistory 按筛选过滤；batchUndoneCount 改全量统计；自检按钮风格统一 |
| `src/styles/components.css` | 新增 | `.ops-filter-bar` / `.ops-filter-item` / `.ops-filter-summary` / `.selftest-summary` 样式 |
| `package.json` | 版本号 | 1.0.4 → 1.0.5 |
| `src-tauri/tauri.conf.json` | 版本号 | 1.0.4 → 1.0.5 |
| `AGENTS.md` | 版本号 | 当前基准版本 v1.0.4 → v1.0.5 |

---

## 五、升级与验证

### 5.1 构建验证

```
npm run vite:build   ✅ 通过（33 modules，153ms，产物 762.66KB）
npm run tauri:build  ✅ 通过（紧固件贸易工作台.app 生成）
```

### 5.2 产物验证

- `dist/index.html` 双击可运行（零依赖，file:// 协议）
- `__APP_VERSION__` 注入 `v1.0.5`
- `dist/vendor/cpexcel.js` + `dist/vendor/xlsx.min.js` 本地可用（离线导出 Excel）

### 5.3 功能验证建议

| 验证项 | 操作方式 |
|--------|---------|
| 功能层工具 | 在 AI 助手中输入「导航到首页」「导出订单 XXX」「打开单位 YYY 的结算抽屉」等，确认自动执行不经弹窗 |
| 错误处理 | 断网后发起 AI 对话，确认提示「网络连接失败，请检查网络后重试」 |
| 并发脏读 | 在 AI 确认弹窗期间，另一个浏览器 tab 修改同一条记录，确认执行时提示「数据已被修改，请刷新后重试」 |
| 操作历史筛选 | 进入数据管理 → 操作历史 tab，分别按操作类型/操作者/批次筛选，确认计数与 undoBatchConfirm 一致 |
| 系统自检 | 点击「自检」按钮，确认弹窗显示检查项与结果，「关闭」按钮可正常关闭 |
| 回滚 | 单条回滚 / 整批回滚，确认数据恢复 + 操作记录标记「已回滚」 |

---

## 六、已知限制

1. **AI 不可调用回收站相关操作**：trash 表数据隔离，AI 工具不暴露 restore/purge 接口，回收站管理由用户手动操作
2. **批量内顺序修改不检测脏读**：批量入口仅做一次"弹窗→执行"期间的脏读检测，批量内前序 op 修改后续 op 数据属预期顺序执行
3. **筛选状态不持久化**：`_aiOpsFilter` 保存在 window 内存，切换 tab 或刷新后丢失（属临时筛选设计）
4. **Tauri 桌面版 tool_calls 降级**：Rust 侧 ai_deepseek_chat 暂未支持 tool_calls 解析，桌面版 AI 写入流程降级为只读模式，由浏览器版主力承载
5. **敏感字段不在 schema 暴露**：联系人电话/微信、税号、银行账号、单位地址等敏感字段由用户在确认弹窗手动补全

---

## 七、下一版本规划

- Tauri 桌面版 Rust 侧支持 tool_calls 解析，实现桌面版完整 Function Calling
- 操作历史筛选状态持久化（sessionStorage）
- 更多功能层工具（如批量导出、报表生成等）
- 性能监控与 AI 调用统计面板

---

*v1.0.5 · AI 数据操控升级方案完整落地*

---

## v1.0.4 · ✅ 已发布

> **状态**: ✅ 已发布
> **发布日期**: 2026-08-26
> **git 提交**: b79621d（阶段 1-4 代码合并落库）
> **版本范围**: AI 数据操控升级 · 阶段 4（功能层工具 + 打磨）+ 阶段 1-3 代码落库

---

## 一、版本概览

「AI 数据操控升级方案」阶段 4：功能层工具（纯系统动作）、并发脏读检测、自检脚本；同时 v1.0.1-v1.0.3 的本地迭代代码在此提交合并落库（36 个工具全量）。

## 二、新增功能

### 2.1 功能层工具（4 个，自动执行不经弹窗）

| 工具 | 用途 | 触发动作 |
|------|------|---------|
| navigate_view | 视图导航 | go(view) / goOrderView(orderId)，离开订单编辑模式先关弹窗/抽屉 |
| export_order_excel | 导出 Excel | 异步 exportOrder + toast 容错，回填「触发成功」语义 |
| open_settlement_drawer | 打开结算抽屉 | openSettleDetail(unitId, tabType) |
| open_invoice_drawer | 打开发票抽屉 | openInvEdit(invoiceId) |

`AIT.FLOW_TOOL_NAMES`（Set）识别功能层；aiWriteLoop 三路分流：query 自动 / flow 自动 / write 确认弹窗。

### 2.2 并发脏读检测

- 确认弹窗为每条 op 注入 `__beforeFingerprint`（before 快照 JSON）
- `_checkDirty` 执行前重新校验对比；不一致拒绝「数据已被修改，请刷新后重试」
- 批量入口先整体检测，通过后批量内顺序执行不再检测（防前序修改误报）

### 2.3 错误处理边界

- `_friendlyError` 错误分类器：网络失败/流中断/tauri 异常 → 友好中文提示
- 操作历史筛选器：操作类型 / 操作者 / 批次三维筛选

### 2.4 AI 操控系统自检

`_aiOpsSelftest()`：aiOps 结构、记录字段、关键函数可用性、AIT 模块、trash 结构——11 项检查，modal 展示结果

### 2.5 文档

- README「AI 助手」章节；API.md「前端 AI 工具协议」章节；方案/开发计划文档落库

---

## 三、验证

- 工具执行器测试 39/39 + 阶段 1 测试 30/30
- vite build / cargo check / tauri build 三构建通过

---

## 四、变更文件

- `src/core/ai.js`、`src/core/ai-tools.js`、`src/views/ai-chat.js`、`src/views/data.js`、`src-tauri/src/lib.rs`、`README.md`、`docs/API.md`、`AGENTS.md`

---

## v1.0.3 · ✅ 已发布

> **状态**: ✅ 已发布（本地迭代版本，代码随 v1.0.4 提交合并）
> **发布日期**: 2026-08-26
> **版本范围**: AI 数据操控升级 · 阶段 3（全量工具 + 订单复杂操作）

---

## 一、版本概览

「AI 数据操控升级方案」阶段 3：工具集扩展至 34+ 个，覆盖 7 类业务数据全 CRUD、订单寻货/状态流转，补全软删除工具与敏感字段处理。

## 二、新增功能

### 2.1 写入工具补齐（复用系统校验链）

| 工具 | 复用函数 | 要点 |
|------|---------|------|
| create/update_bom | saveBOMForm 校验 | sku 查重 |
| set_spec_value | specs 表单逻辑 | 幂等（已存在跳过） |
| create_order / update_order_meta | newOrder/saveOrder | buyerId 必须为采购商 |
| add/update_order_item | persistOrderItems 链路 | 平铺参数 |
| assign_supplier / add_manual_supplier / remove_sourcing_option | addMatchSupplier 逻辑 | 剩余量校验 + 供应商去重 |
| create/update_settlement | openNewSettlement | type/date/amount 校验 |
| create/update_invoice | openInvEdit | 类型/金额/日期校验 |

### 2.2 软删除工具（8 个）

delete_unit/bom/price/order/spec_value/settlement/invoice + remove_order_item——全部走 `softDelete` 进回收站（删除后即超出 AI 能力范围，原则 1）

### 2.3 敏感字段「待补」交互

- create_unit 确认弹窗显示敏感字段输入区（联系人/电话/税号/开户行/账号/地址）
- AI 不收集敏感信息（schema 声明留空），用户补全后并入执行参数，落库为 contacts/invoice 结构

### 2.4 批量执行与错误处理

- 批量逐条执行，单条失败不中断，汇总「成功 N / 失败 M + 原因」
- 状态流转违规（跳站）执行器强制拒绝；tool_calls 解析失败降级纯文本零执行

---

## 三、验证

- 工具执行器测试 39/39（BOM 查重/幂等/订单校验/寻货余量/软删除/敏感字段落库/批量隔离）

---

## 四、变更文件

- `src/core/ai-tools.js`、`src/views/ai-chat.js`、`src/styles/components.css`

---

## v1.0.2 · ✅ 已发布

> **状态**: ✅ 已发布（本地迭代版本，代码随 v1.0.4 提交合并）
> **发布日期**: 2026-08-26
> **版本范围**: AI 数据操控升级 · 阶段 2（Function Calling 协议接入）

---

## 一、版本概览

「AI 数据操控升级方案」阶段 2：接入 DeepSeek function calling 协议，AI 从「只读问答」升级为「可起草写入操作」，经用户逐条确认后落库。

## 二、新增功能

### 2.1 工具调用协议

- **流式 tool_calls 解析**：web 通道 delta 按 index 累积（id/name/arguments），tauri 通道由 Rust 解析后 emit 给前端同机制累积
- **Rust 代理透传**：lib.rs `UpstreamBody` 加 `tools` 字段、`UpstreamChoiceDelta` 解析 tool_calls、流式 emit `{text, toolCalls}`
- `chat(messages, onChunk, {tools})` 返回 `{content, toolCalls}`；`buildSystemPrompt` 升级为提案模式（工具不自动执行/敏感字段留空/状态机守则）

### 2.2 工具集（起步 5 个写入工具）

create_unit / update_unit / create_price / update_price / flow_order_status

- 校验规则复用业务逻辑：单位查重、供应商角色、价格>0、报价重复检测、BOM 存在性、状态机全路径（NEXT_STATUS）

### 2.3 确认弹窗（AI 操作提案）

- 操作列表：类型徽章 + 目标摘要 + 字段级 diff（旧值→新值）+ 复选框（默认全选）
- 删除项提示「进入回收站可恢复」；被引用实体预警
- 取消/执行选中 N 条（实时计数）；执行进度 toast

### 2.4 多轮工具循环

`aiWriteLoop`：chat(带 tools) → tool_calls → 确认 → 执行 → tool 响应回填 → 继续（上限 5 轮）；取消时回填「用户取消」；纯文本总结直接结束

---

## 三、验证

- 工具执行器测试 30/30（校验/执行/状态机/批量失败隔离/未知工具拒绝）
- cargo check + vite build + tauri build 通过

---

## 四、变更文件

- `src/core/ai.js`、`src/core/ai-tools.js`（新）、`src/views/ai-chat.js`、`src-tauri/src/lib.rs`

---

## v1.0.1 · ✅ 已发布

> **状态**: ✅ 已发布（本地迭代版本，代码随 v1.0.4 提交合并）
> **发布日期**: 2026-08-26
> **版本范围**: AI 数据操控升级 · 阶段 1（数据模型 + 回收站 + 操作历史）

---

## 一、版本概览

「AI 数据操控升级方案」阶段 1：为 AI 写入能力建设数据底座——回收站（软删除）与操作审计日志，全部功能先以手动操作为入口验证。

## 二、新增功能

### 2.1 数据模型扩展

- `DB.trash[]`：回收站隔离区（**隔离式软删除**，非 deletedAt 标记——业务表删除即移除，所有读路径零过滤改动）
- `DB.aiOps[]`：操作日志（审计 + 回滚依据，FIFO 2000 条上限）
- `ensureDBFields()` 补齐新字段；导出/文件同步**剥离 trash/aiOps**（saveToFile/loadFromFile/exportJSON/importJSON 四处）

### 2.2 软删除与回收站

- `softDelete(type, id)` / `softDeleteSpecOption` / `softDeleteOrderItem`：业务表 → trash（深拷贝 + originalId + 操作者）
- `restoreFromTrash`：originalId 原样塞回，关联引用自动恢复有效（uid 机制保证不冲突）
- `purgeTrash` / `clearTrash`：物理删除（仅用户手动，二次确认）

### 2.3 操作历史与回滚

- `recordAiOp`：每条操作记 before/after/batchId/operator
- `undoAiOp`：六种反向执行（create→删 / update→还原 / delete→恢复 / restore→再删 / flow→还原状态 / assign→还原 options）
- `undoBatch`：同批次逆序回滚；回滚单向（undone 标记）

### 2.4 UI

- 数据管理页三 tab：数据管理 / 操作历史 / 回收站
- 现有 7 处删除逻辑迁移为软删除（units/prices/bom/orders/specs/settlements，含批量入口）

---

## 三、验证

- 逻辑测试 30/30（软删除/恢复/六种回滚/整批回滚/FIFO/重复删除保护/恢复不冲突）

---

## 四、变更文件

- `src/core/store.js`、`src/views/data.js`、`src/views/units.js`、`src/views/prices.js`、`src/views/bom.js`、`src/views/orders.js`、`src/views/specs.js`、`src/views/settlements.js`

---

## v1.0.0 · ✅ 已发布

> **状态**: ✅ 已发布
> **发布日期**: 2026-08-26
> **git 标签**: v1.0.0（ae5cf76 Merge PR #1）

---

## 一、版本概览

项目基础版本：Vue3 + Vite 重构完成，AI 只读问答接入，Tauri 桌面封装与 CI 工作流就绪。

## 二、核心功能

### 2.1 业务功能（7 大模块）

- **概览**：今日待处理看板（逾期标红/今日到期/待确认）、统计卡片、最近订单入口
- **关联单位**：供应商/采购商统一管理（双角色）、联系人按角色区分、评级/账期
- **属性管理**：六维枚举（类型/标准/直径/硬度/表面处理/材质）
- **BOM 管理**：SKU 物料清单、批量导入
- **签约报价**：供应商×规格×单价、重复检查、批量删除
- **采购订单**：多供应商分配寻源、七状态流转、寻货弹窗（价格库匹配+手动录入）、收货/验货
- **对账结算 / 发票管理**：收款/付款、开票/收票、关联订单钻取

### 2.2 数据层

- IndexedDB 主存储 + localStorage 草稿 + File System Access API 本地文件同步
- JSON 导入/导出、CSV 导出、Excel 导出（xlsx-js-style 样式版）
- 表单草稿自动保存与恢复

### 2.3 AI 助手（DeepSeek，只读问答模式）

- 脱敏数据快照 + 上下文感知（按当前页面注入）+ 常用提问
- 双通道：浏览器版前端直连（CORS 放行）/ Tauri 桌面版 Rust 代理（API Key 存应用数据目录）
- 流式响应、SSE 解析、可中止

### 2.4 Tauri 桌面封装

- 本地文件存储（data.json 应用数据目录，macOS WKWebView IndexedDB 不可靠的替代方案）
- 应用图标、窗口配置、ad-hoc 签名打包（.app/.dmg）

### 2.5 CI 工作流

- GitHub Pages 在线版部署（vite build，base './' 相对路径）
- Release 自动打包（Windows NSIS+MSI / macOS app+dmg，GitHub Actions 矩阵）

---

## 三、验证

- `npm run build` 通过；`file://` 双击 `dist/index.html` 可用（零依赖运行原则）
- 浏览器版与桌面版双端手测通过

---

## 四、变更文件

- 完整项目初始化：src/（core/views/styles）、src-tauri/、docs/、.github/workflows/、scripts/
