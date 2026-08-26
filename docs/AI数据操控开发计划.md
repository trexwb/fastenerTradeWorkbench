# AI 数据操控升级 · 开发计划

> 依据：《AI数据操控升级方案》v0.2（docs/AI数据操控升级方案.md）
> 目标版本：v1.1.0（package.json / src-tauri/tauri.conf.json / AGENTS.md 三处同步递增）
> 总工作量估算：约 5-6 轮开发迭代

---

## 0. 总览

| 阶段 | 内容 | 轮次 | 前置 | 里程碑 |
|------|------|:---:|------|--------|
| 阶段 1 | 数据模型（trash/aiOps）+ 回收站 + 操作历史（纯手动） | 1-1.5 | 无 | 手动删除可进回收站、可恢复、可回滚 |
| 阶段 2 | Function Calling 协议 + 只读工具 + 5 个简单写入工具 | 1-1.5 | 阶段 1 | AI 起草→确认→落库全链路跑通 |
| 阶段 3 | 全量工具（订单/寻货/结算/发票/软删除）+ 回滚 + 错误处理 | 1.5-2 | 阶段 2 | 7 类数据全 CRUD + 订单流转 + 整批回滚 |
| 阶段 4 | 功能层工具 + 自检 + 打磨 + 版本发布 | 1 | 阶段 3 | v1.1.0 发布 |

**关键路径**：T1.1 → T1.3 → T2.1 → T2.2 → T3.1（框架先行，工具跟随）

---

## 1. 阶段 1 · 数据模型 + 回收站 + 历史（纯手动触发）

### T1.1 store.js：数据模型扩展

- `ensureDBFields()`（store.js:76）补 `DB.trash=[]` / `DB.aiOps=[]`
- 新增辅助函数：
  - `softDelete(type, record, reason)`：业务表移除 → `DB.trash` push（深拷贝 + originalId + operator:'user'）→ `saveDB()`
  - `restoreFromTrash(trashId)`：trash → 业务表（originalId 原样塞回）→ 删 trash 条目 → 记一条 `op:'restore'` 的 aiOps
  - `pushAiOp({op,type,targetId,before,after,batchId})`：写 aiOps，FIFO 2000 条滚动
  - `serializeBusinessDB()`：白名单序列化（units/specs/bom/prices/orders/settlements/invoices/aiChats + seq/orderSeq），**剥离 trash/aiOps**——`saveToFile()`（store.js:378）与 `exportJSON`（data.js:158）改用此函数
- 确认 importJSON（data.js:175 / store.js:407 附近）已丢弃文件中的 trash/aiOps（方案 §3.5）；不完整则补齐

**验证**：导出 JSON 不含 trash/aiOps；导入后本机两表为空（ensureDBFields 补齐）

### T1.2 data.js：新增「操作历史」「回收站」区块

- 现有区块式布局（存储架构/备份/文件同步/危险操作）后追加两个区块：
  - **回收站**：按类型分组列出（原始 id 摘要/删除时间/操作者/恢复按钮/物理删除按钮）；顶部按类型全部恢复/全部清空（confirmModal 二次确认）
  - **操作历史**：表格（时间/操作徽章/目标摘要/批次）；行展开 before/after 快照；整批回滚按钮
- 复用 `.table-wrap` / `.tag` / `modal()` / `confirmModal()` / `toast()`，零新 UI 框架

**验证**：手测清单 2/7（删除→回收站→恢复；清空二次确认）

### T1.3 现有删除逻辑迁移为软删除（7 个视图）

| 文件 | 函数 | 现状 |
|------|------|------|
| units.js | `delUnit`（:328） | filter 物理删除 → softDelete |
| prices.js | `delPrice`（:219） | filter 物理删除 → softDelete |
| bom.js | `deleteBOM`（:427） | filter 物理删除 → softDelete |
| orders.js | `deleteOrder`（:1674） | filter 物理删除 → softDelete |
| specs.js | `delSpecVal`（:202） | 从 `DB.specs[k]` 数组移除 → trash 存 `{field,value}` |
| settlements.js | `delSettlement` | filter 物理删除 → softDelete |
| invoices.js | 删除逻辑 | 物理删除 → softDelete |

- 删除被引用实体（如单位被订单引用）→ confirmModal 预警引用数（复用/扩展 `countSpecUsage` 思路）
- 批量删除入口（batchDeleteUnits/batchDeleteOrders 等）同步迁移

**验证**：手测清单 1/2；列表/统计/导出不受影响（trash 隔离式零过滤改动）

### T1.4 阶段 1 验收

- 手动删 → 回收站可见 → 恢复 → 业务表复原（originalId 不变，关联引用恢复有效）
- 历史可见每步操作；单条回滚反向执行正确
- `npm run build` 通过 + `file://` 打开正常

---

## 2. 阶段 2 · Function Calling 协议接入（只读 + 简单工具起步）

### T2.1 ai.js：tool_calls 流式解析 + 多轮循环

- `webChat`（:133）：delta 解析增加 `tool_calls` 分支——按 `index` 累积 `{id,name,argsStr}`，流结束 JSON.parse；content 照常走 onChunk
- Tauri 通道：Rust `ai_deepseek_chat` 透传 `tools` 参数（lib.rs `UpstreamBody` 加 `tools` 字段 + 前端参数）；SSE 行中 tool_calls delta 由 Rust 原样 emit → 前端同样按 index 累积
- `chat(messages, onChunk, opts)` 增加第三参 `{tools}`；返回结构扩展 `{content, toolCalls}`
- `buildSystemPrompt`（:91）升级：提案模式声明（工具不自动执行/逐条确认）、敏感字段留空、STATUS_FLOW 守则、金额以本地计算为准

**验证**：控制台打印累积的 tool_calls 与预期一致；纯文本对话行为不变（回归）

### T2.2 ai-tools.js（新文件）：工具 schema + 执行器

- `TOOLS_DEFS`：查询类 7 个（query_units/query_specs/query_bom/query_prices/query_orders/query_settlements/query_invoices）+ 简单写入 5 个（create_unit/update_unit/create_price/update_price/flow_order_status）
- 每个工具：`{schema, handler}`——schema 供 AI；handler 调现有视图函数（原则 2 适配层）
- `executeOps(ops)`：逐条校验（必填/类型/引用完整性/金额范围/STATUS_FLOW 合法性）→ 执行 → `pushAiOp`（before/after/batchId）→ 返回结果摘要
- `aiWriteLoop(messages, onChunk)`：多轮循环（限 N=8 轮防死循环），确认取消时回填「用户取消」继续对话

**验证**：5 个写入工具走通「起草→确认→执行→aiOps」

### T2.3 ai-chat.js：确认弹窗 `renderOpsList`

- `modal()` 弹「确认 AI 操作提案」：操作列表（类型徽章/目标摘要/diff 旧值→新值/复选框默认全选）；删除项标「进入回收站可恢复」；被引用实体预警引用数
- 敏感字段缺失 → 「待补」黄标（阶段 2 先实现展示，补全交互阶段 3）
- 底部：取消 / 执行选中 N 条（实时计数）；执行进度 toast

**验证**：手测清单 1/4/9（含 tool_calls 解析失败降级——阶段 2 先做 try/catch 兜底）

### T2.4 阶段 2 里程碑验证

- **模型 function calling 实测**（风险 1 的验证点）：用 `deepseek-v4-flash` 发起一次含 tools 的对话，确认返回 tool_calls；不支持则切换「AI 输出 JSON + 前端解析」备选方案（方案 §10）
- AI 起草单位/报价 → 确认 → 执行 → 列表可见 + aiOps 有记录
- 状态流转：合法（报价中→签约完成）成功；非法（报价中→完成跳站）被执行器拒绝

---

## 3. 阶段 3 · 全量工具 + 订单复杂操作

### T3.1 写入工具补齐（ai-tools.js）

| 工具 | 复用函数 | 要点 |
|------|---------|------|
| `create_bom` / `update_bom` | `saveBOMForm` 校验链 | sku 查重 |
| `add_spec_option` / `rename_spec_option` | specs 表单逻辑 | 查重 + countSpecUsage 影响提示 |
| `create_order` / `update_order_meta` | `newOrder` / saveOrder 校验 | buyerId 必须存在且未删除 |
| `add_order_item` / `update_order_item` | `persistOrderItems` 链路 | orderId 校验 |
| `assign_supplier` | `addMatchSupplier` | priceId 存在性；allocQty ≤ 需求余量 |
| `create_settlement` / `update_settlement` | `openNewSettlement` | type/unitId/amount 校验 |
| `create_invoice` / `update_invoice` | `openInvEdit` | 发票号查重 |

### T3.2 软删除工具补齐（8 个）

- `soft_delete_unit/bom/price/order/settlement/invoice` + `soft_delete_spec_option` + `soft_delete_order_item`
- 全部走 `softDelete`（业务表 → trash），执行器校验 targetId 存在且未删除

### T3.3 敏感字段「待补」交互 + 批量执行

- 确认弹窗：待补字段黄标 → 点击展开输入框 → 校验后并入执行参数
- 多操作执行：逐条 toast 进度，单条失败不中断，汇总「成功 N / 失败 M + 原因列表」

### T3.4 回滚逻辑（操作历史 tab 完善）

- `undoOp(op)`：create→删 after；update→还原 before；delete→恢复（trash→业务表）；flow→还原前状态；assign→还原 options
- 整批回滚（同 batchId 逆序逐条 undo）；回滚后 `undone=true`（单向）
- 历史 tab：类型筛选 / 批次分组 / 展开快照

### T3.5 错误处理边界落地（方案 §6 全 8 条）

- tool_calls 解析失败：修尾逗号/单引号 → 仍失败降级纯文本 + toast，零执行
- 并发脏读：执行前对比 before 与 DB 当前关键字段，不一致标失败「数据已被改动」
- 单条失败不中断其他；状态违规直接拒绝该条

**验证**：手测清单 3/4/5/6/9/10 全量；7 类数据 AI 全 CRUD

---

## 4. 阶段 4 · 功能层 + 打磨 + 发布

### T4.1 功能层工具（纯系统动作）

- `export_excel`（复用 `exportOrder`）/ 视图导航（`go(view)`）等，按方案 §1.2「功能层」边界
- 功能层工具无需确认弹窗？——按方案定义：纯系统动作，仍经执行器但提示级别可降低（实施时与用户确认策略）

### T4.2 自检脚本 + 打磨

- `window._aiOpsSelftest()`：合成场景（创建→删除→恢复→回滚），开发时 console 调用，不进生产路径
- aiOps FIFO 2000 验证；历史筛选/分组性能

### T4.3 版本与文档

- 三处版本递增：`package.json` / `src-tauri/tauri.conf.json` / `AGENTS.md` → v1.1.0
- 文档同步：`README.md`（AI 能力章节）、`docs/API.md`（新增命令/工具清单）、`docs/AI数据操控升级方案.md` 标记已实施

### T4.4 全量回归

- 手测清单 10 条全过
- `npm run build` 通过 + `file://` 打开正常 + Tauri 桌面版构建正常
- 浏览器版与桌面版行为一致性抽查

---

## 5. 风险与前置验证

| 风险 | 验证时机 | 应对 |
|------|---------|------|
| 模型 function calling 不支持 | 阶段 2 第一个任务后立即实测 | 备选：AI 输出 JSON + 前端解析（方案 §10） |
| Rust 通道透传 tools 需改 lib.rs | 阶段 2 T2.1 | `UpstreamBody` 加 `tools` 字段；`Cargo.toml` 无需新依赖 |
| 软删除迁移遗漏批量删除入口 | 阶段 1 T1.3 | 逐个 grep `DB.xxx.filter` 删除点；回归批量删除 UI |
| 序列化剥离遗漏 | 阶段 1 T1.1 | `serializeBusinessDB` 白名单 + 导出后人工检查 JSON |
| 订单状态机一致性 | 阶段 2/3 | 执行器复用 `STATUS_FLOW`（store.js:63）+ 终态分支（异常/取消）判断，与 UI `nextStepOrder` 对齐 |

---

## 6. 每阶段验收对照（方案 §11）

| 验收标准 | 对应阶段 |
|---------|---------|
| 1. 自然语言创建 7 类数据与手动一致 | 阶段 3 |
| 2. 写入类操作全部经确认弹窗，拒绝零变更 | 阶段 2 |
| 3. 寻货/状态流转合法可起草、非法被拒 | 阶段 3 |
| 4. 删除进回收站、恢复完整复原 | 阶段 1 |
| 5. 操作历史可追溯、单条/整批回滚 | 阶段 1/3 |
| 6. 导出不含 trash/aiOps、导入清空本机回收站 | 阶段 1 |
| 7. 浏览器版与桌面版一致 | 阶段 4 |
| 8. npm run build + file:// 双击正常 | 每阶段末 |
