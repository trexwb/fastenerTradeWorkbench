# 版本发布说明 · v1.0.5

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
