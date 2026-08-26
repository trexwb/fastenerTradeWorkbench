# AI 数据操控升级方案

> 版本：v0.2（设计稿，待评审）
> 日期：2026-08-26
> 范围：7 类业务数据（units/specs/bom/prices/orders/settlements/invoices）的 AI 读写控制 + 订单寻货/状态流转；删除走回收站
> 目标代码版本：v1.1.0（实施时递增，同步 `package.json`/`src-tauri/tauri.conf.json`/`AGENTS.md` 三处）
> 相对 v0.1 的变更：软删除改 `trash[]` 隔离式；范围扩到 7 类全 CRUD；订单状态流转本轮开放；审计表 `aiOps` 支持回滚

---

## 0. 设计原则（硬性约束，不可违反）

### 原则 1：AI 与回收站完全隔离

- 回收站是**用户专属区域**：AI 不能查看、不能恢复、不能彻底删除、不能清空回收站中的任何数据
- AI 只能对**正常数据**发起软删除；数据一旦进入回收站，即超出 AI 能力边界
- 所有 AI 工具（含查询工具）**永不返回回收站数据**；即使 AI 在参数中试图触及（传入已删除 id），执行器一律拒绝

### 原则 2：AI 只产出参数，不直接改数据

- AI 的输出仅是**工具调用参数**（数据意图描述），任何数据变更必须经**系统现有 JS 逻辑**执行：现有校验/收集函数 → `saveDB()` 统一保存链路
- 执行器是「AI 参数 → 系统函数」的**适配层**：AI 不直接操作 `DB` 对象、不绕过校验、不自行构造保存逻辑
- 系统 JS 逻辑是唯一的数据修改入口（AI 与用户手动操作走同一条代码路径），复用 `newUnit`/`editUnit`/`saveBOMForm`/`newPrice`/`editPrice`/`persistOrderItems`/`addMatchSupplier` 等

### 原则 3：操作历史 AI 只读

- `DB.aiOps`（操作日志）AI 只读，可作为上下文；AI **不能回滚**操作（回滚仅用户手动，防 AI 误撤销）
- 审计日志只增不删；回滚是写入一条「反向操作」记录，不删原记录

### 原则 4：工具协议可扩展

- 新增工具 = 注册 schema + 实现 handler，不改协议本身
- 远期持续扩展覆盖系统能力清单（导出 Excel、视图导航、创建结算发票等纯系统动作），最终覆盖系统绝大部分能力（回收站除外）

---

## 1. 目标与边界

### 1.1 目标

在现有「AI 只读问答」基础上，升级为 **AI 可操作业务数据**：用户用自然语言让 AI 新增、修改、查询、软删除 7 类业务数据，并对订单执行寻货分配与状态流转；AI 执行前展示变更预览、用户逐条确认后落库，全程审计可回滚。

### 1.2 能力边界

| 数据域 | 查询 | 新增 | 修改 | 删除 |
|--------|:---:|:---:|:---:|:---:|
| 关联单位 units | ✅ | ✅ | ✅ | 软删除（回收站） |
| 属性枚举 specs | ✅ | ✅（增枚举值） | ✅（改名） | 软删除（回收站） |
| BOM bom | ✅ | ✅ | ✅ | 软删除（回收站） |
| 报价 prices | ✅ | ✅ | ✅ | 软删除（回收站） |
| 采购订单 orders | ✅ | ✅ | ✅（含明细行增删改） | 软删除（回收站） |
| 订单寻货 assign_supplier | — | ✅（给明细分配供应商报价） | — | — |
| 订单状态 flow_order_status | — | — | ✅（守 `STATUS_FLOW`） | — |
| 结算 settlements | ✅ | ✅ | ✅ | 软删除（回收站） |
| 发票 invoices | ✅ | ✅ | ✅ | 软删除（回收站） |

**功能层（纯系统动作，阶段 4 增量，非本轮 v0.2 范围）**：导出 Excel、视图导航、文件同步触发等。

**AI 永不触碰**（硬编码拒绝）：
- 回收站内的一切数据与操作（查看/恢复/彻底删除/清空，见原则 1）
- 物理删除（仅用户手动，回收站内操作）
- `DB.aiOps` 的回滚（仅用户手动，见原则 3）
- API Key 管理、设置项

---

## 2. 架构与数据流

```
用户对话(AI 抽屉) ──→ DeepSeek chat API(带 tools 定义)
                        ↓ 流式返回 content + tool_calls
                   前端按 index 累积 tool_calls
                        ↓
                   确认弹窗(逐条勾选,敏感字段待补)
                        ↓ 用户确认
                   操作执行器 ──→ 复用现有视图层写入函数
                        │           ├ 增/改:写 DB.{table}
                        │           ├ 删:移出业务表 → DB.trash[](保留 originalId)
                        │           └ 每条记 DB.aiOps(batchId/before/after)
                        ↓
                   结果作为 tool 响应回传模型 ──→ 可继续多轮链式
                        ↓
                   data.js 新增 tab:操作历史(回滚) / 回收站(恢复·清空)
```

写入场景的脱敏调整：现有 `buildPreview` 隐去电话/地址/税号/银行账户（适合只读分析）。写入场景模型需识别「改哪个单位/报价属于谁」，故写入快照**保留可识别但非敏感字段**（单位名/规格/金额），敏感字段仍脱敏；模型起草的工具参数只能填它能看到的非敏感字段，敏感字段留空，由用户在确认弹窗里手动补全（弹窗高亮「待补」字段）。

---

## 3. 数据模型扩展

### 3.1 回收站 `DB.trash[]`（隔离式软删除）

**不采用 `deletedAt` 字段标记**，改用独立 `trash[]` 数组隔离。理由：现有所有查询（`DB.units.filter`/`DB.orders.find`/结算统计/导出快照）**零改动**——删除即从业务表移除、塞入 `trash[]`；恢复即移回业务表。若用 `deletedAt` 标记，需在所有读路径加 `!deletedAt` 过滤，改动面大且易漏。

```js
// store.js: ensureDBFields() 补齐
if (!DB.trash) DB.trash = [];
if (!DB.aiOps) DB.aiOps = [];

// 回收站条目结构
{
  id: 'TR_xxx',                 // 回收站条目 id
  type: 'unit|spec|bom|price|order|order_item|settlement|invoice',
  originalId: '原始记录 id',     // 恢复时塞回原 id，关联引用自动恢复有效
  data: { /* 被删时的完整深拷贝 */ },
  deletedAt: 1693000000000,
  operator: 'ai|user',
  reason: 'AI 起草理由（可选）',
  aiBatchId: 'AO_batch_xxx'    // 关联本次 AI 批次，便于整批撤销
}
```

### 3.2 操作日志 `DB.aiOps[]`

```js
{
  id: 'AO_xxx',
  batchId: 'AO_batch_xxx',      // 同一次确认的多条操作共享，整批回滚用
  op: 'create|update|delete|restore|flow|assign',
  type: 'unit|spec|bom|price|order|order_item|settlement|invoice',
  targetId: '目标记录 id',
  before: { /* 前快照，create 时 null */ },
  after:  { /* 后快照，delete 时 null */ },
  operator: 'ai',
  timestamp: 1693000000000,
  aiChatId: '关联 AI 对话消息 id',  // 追溯当时模型看到了什么
  undone: false,
  undoneAt: null
}
```

### 3.3 恢复语义与关联完整性

- uid 全局唯一，恢复时用 `originalId` 直接塞回业务表，不冲突
- 订单 `PO+date+seq` 编号：恢复时编号不变（`orderSeq` 不回退），因 uid 机制保证原 id 不会被新订单占用
- 删除被引用实体（删单位时仍有订单引用）：允许软删除，确认弹窗预警「该单位被 N 个订单引用，删除后引用悬空，可恢复」；恢复后引用自动恢复有效
- 物理清空回收站：悬空引用永久断（`confirmModal` 二次确认，可接受）

### 3.4 specs 特殊性

`DB.specs` 是字典不是数组 `{type:[...],standard:[...]}`。删除规格选项时 `data` 存 `{field:'diameter', value:'M8'}`，恢复塞回对应字段数组。规格枚举值被引用时禁止删除（沿用 `countSpecUsage` 影响提示），未引用可软删除。

### 3.5 导出/导入边界（用户明确约束）

- `saveDB()` → IndexedDB：**全量**保存（含 `trash`/`aiOps`，本机运行态需要）
- 文件同步 / 导出 JSON（`saveToFile` 等）：**只序列化业务表**（`units`/`specs`/`bom`/`prices`/`orders`/`settlements`/`invoices`/`aiChats` + `seq`/`orderSeq`），剥离 `trash` + `aiOps`
- 导入 / 绑定目录合并：导入数据不含回收站，本机 `trash`/`aiOps` 清空，`ensureDBFields()` 补齐空表（换机/恢复场景下旧回收站无意义）
- Excel 订单导出（`exporter.js`）：本就只导订单快照，不受影响

### 3.6 上限

- `aiOps` 保留最近 2000 条（FIFO 滚动，超量丢弃最旧）
- `trash` 永久保留 + 用户手动清空（本地业务量小，不自动清理）

---

## 4. Function Calling 工具协议

DeepSeek API 兼容 OpenAI function calling 格式。`tools` 数组，每个 `{type:'function',function:{name,description,parameters(JSON schema)}}`。工具 description 统一声明：「此工具生成**提案**，前端将要求用户逐条确认，不会自动执行」。

### 4.1 工具清单（三分类，约 34 个）

**查询类（自动执行，结果脱敏，不经确认弹窗）**

| 工具 | 参数 | 说明 |
|------|------|------|
| `query_units` | keyword, role, rating | 复用 units 筛选，返回摘要 |
| `query_specs` | dimension | 六维枚举值列表 |
| `query_bom` | keyword, sku | BOM 列表 |
| `query_prices` | unitId, spec | 报价列表（脱敏） |
| `query_orders` | status, keyword | 订单摘要（复用 `orderRow`） |
| `query_settlements` | type, unitId | 结算列表 |
| `query_invoices` | type, unitId | 发票列表 |

**写入类（均需用户逐条确认）**

| 工具 | 参数要点 | 校验来源 |
|------|---------|---------|
| `create_unit` / `update_unit` | name, roles[], rating?；敏感字段(电话/地址/税号/银行账户)留空 | 复用 `newUnit`/`editUnit` 校验 |
| `add_spec_option` / `rename_spec_option` | field, value, newValue | 枚举合法性 + 查重 + `countSpecUsage` |
| `create_bom` / `update_bom` | BOM 字段 | 复用 `saveBOMForm` 校验 |
| `create_price` / `update_price` | type/standard/diameter/hardness/surface/material, unitId, price, moq? | 复用 `newPrice`/`editPrice` 校验 + 重复检查 |
| `create_order` / `update_order_meta` | buyerId, projectId?, deliveryDate?, items[{sku?,name,qty,remark?}] | 复用 `newOrder` 校验，buyerId 必须存在 |
| `add_order_item` / `update_order_item` | orderId, item{...} | 复用 `persistOrderItems` 链路 |
| `assign_supplier` | orderItemId, priceId, qty | 复用 `addMatchSupplier`，priceId 必须存在 |
| `flow_order_status` | orderId, toStatus | 执行器校验 `toStatus` 须为 `STATUS_FLOW` 下一站或终态分支（异常/取消） |
| `create_settlement` / `update_settlement` | type, unitId, amount, ... | 复用 `openNewSettlement` 校验 |
| `create_invoice` / `update_invoice` | type, unitId, ... | 复用 `openInvEdit` 校验 |

**软删除类（用户确认，入回收站）**

| 工具 | 参数 | 说明 |
|------|------|------|
| `soft_delete_unit` / `soft_delete_bom` / `soft_delete_price` / `soft_delete_order` / `soft_delete_settlement` / `soft_delete_invoice` | id | 移出业务表 → `DB.trash[]`；**删除后即超出 AI 能力范围** |
| `soft_delete_spec_option` | field, value | 从 `DB.specs[field]` 移除，`data` 存 `{field,value}` |
| `soft_delete_order_item` | orderId, itemId | 从订单 items 移除入 trash，`data` 含原 item + orderId |

> ⚠️ 按原则 1：AI **不提供**恢复/彻底删除/清空回收站工具——回收站内数据仅限用户手动操作。

### 4.2 流式 tool_calls 解析

DeepSeek 流式响应里 `tool_calls` 是增量 delta，需按 `index` 累积：

```js
// 每个 chunk.choices[0].delta 可能同时含 content 和 tool_calls
const acc = []; // {index, id, name, argsStr}
delta.tool_calls?.forEach(tc => {
  const slot = acc[tc.index] || (acc[tc.index] = {index: tc.index, id:'', name:'', argsStr:''});
  if (tc.id) slot.id = tc.id;
  if (tc.function?.name) slot.name = tc.function.name;
  if (tc.function?.arguments) slot.argsStr += tc.function.arguments;
});
// 流结束后: acc.map(s => ({id:s.id, name:s.name, arguments: JSON.parse(s.argsStr)}))
// content 照常走现有 onChunk 渲染分析文本
```

需改 `ai.js` 的 `webChat`/tauri 流式分发：delta 里既有 `content`（给对话区流式显示）又有 `tool_calls`（累积，不显示）。

### 4.3 多轮工具调用循环

```js
async function aiWriteLoop(initialMessages, onChunk) {
  const messages = [...initialMessages];
  while (true) {
    const res = await AI.chat(messages, onChunk, {tools: TOOLS_DEFS});
    if (!res.toolCalls?.length) {
      persistMessage('assistant', res.content);   // 纯文本总结，结束
      break;
    }
    const approved = await confirmOpsModal(res.toolCalls);  // 逐条勾选
    if (approved.cancelled) {
      messages.push({role:'user', content:'用户取消了本次操作'});
      continue;
    }
    const results = await executeOps(approved.ops);  // 逐条执行，写 DB + trash + aiOps
    messages.push(...results.map(r => ({role:'tool', tool_call_id:r.id, content:JSON.stringify(r.summary)})));
    // 继续下一轮，模型可能再调工具或给总结
  }
}
```

### 4.4 system prompt 升级（`buildSystemPrompt`）

现有「只读、禁止补造」改为：
- 仍是紧固件贸易助手，可调用工具起草写入操作（7 类 CRUD + 订单寻货 + 状态流转）
- **工具调用是提案**，前端将要求用户逐条确认，不自动执行
- 金额/利润/余额仍以本地计算为准，不自行重算
- 状态流转必须守 `STATUS_FLOW`（只能前进，不能跳站）
- 敏感字段（电话/地址/税号/银行账户）工具参数留空，由用户补
- 仍依据脱敏快照，数据缺失时明确说明，禁止补造

### 4.5 三层防线（安全设计）

1. **校验层（AI 无法绕过）**：所有写入工具复用现有表单校验函数；引用完整性（订单→单位/BOM 必须存在未删除）；规格枚举值必须存在于 `DB.specs`；金额/数量范围上限防幻觉
2. **确认层（人机共同决策）**：写入/删除类必须经确认弹窗，含操作对象+字段 diff+引用影响；可拒绝
3. **审计层（可追溯）**：`DB.aiOps` 每条操作记录 before/after/batchId，用户可单条/整批回滚

---

## 5. UI 交互

### 5.1 起草确认弹窗（AI 抽屉内 `modal()`）

- AI 流式返回 `tool_calls` 累积完毕 → 在 AI 抽屉弹 `modal()`「确认 AI 操作提案」
- 操作列表，每条：类型徽章（新增/修改/流转/删除/寻货）+ 目标摘要 + diff（旧值→新值）+ 复选框（默认全选）
- 敏感字段缺失 → 「待补」黄标，点击展开输入框手动补全
- 删除项明确提示「将进入回收站，可恢复」；删除被引用实体时预警引用数
- 底部：取消 / 执行选中 N 条（实时计数）
- 执行后逐条写入，`toast` 进度，对话区追加 assistant 汇总消息

### 5.2 操作历史 tab（data.js 新增）

- 表格（`.table-wrap` 风格）：时间 / 操作徽章 / 目标摘要 / 批次 / 操作菜单
- 行可折叠展开 before/after 快照
- 工具栏：按类型筛选 / 按批次分组 / 整批回滚（同 `batchId` 一起撤销）
- 单条回滚：反向执行（create→删、update→还原 before、delete→恢复、flow→还原前状态、assign→还原 options），回滚后标 `undone=true`（单向，不可再回滚）

### 5.3 回收站区块（数据管理页内，用户专属）

- 数据管理页（`data.js`）新增「回收站」区块（与「操作历史」并列）
- 按类型分组（units/specs/bom/prices/orders/settlements/invoices）
- 每条：原始 id 摘要 / 删除时间 / 删除者（AI/批次）/ 恢复按钮 / 物理删除按钮
- 顶部：按类型全部恢复 / 全部清空（`confirmModal` 二次确认，不可恢复）
- 恢复 → 移回业务表 + 记一条 `restore` 的 aiOps（可再回滚 = 再删）
- **AI 完全隔离**（原则 1）：该区块无任何 AI 入口，AI 工具集无回收站工具

复用现有组件：`modal()`/`confirmModal()`/`toast()`/`.table-wrap`/`.tag` 颜色修饰，零新 UI 框架。

---

## 6. 错误处理边界

| 场景 | 处理 |
|------|------|
| tool_calls 解析失败（argsStr JSON.parse 报错） | 先尝试修复尾随逗号/单引号；仍失败→降级纯文本显示，`toast`「工具参数解析失败，请重试」，**不执行任何操作** |
| 单条工具执行异常（找不到 targetId / 状态违规 / 关联不存在） | 该条标失败+记原因，**不中断其他选中条**，最后汇总「成功 N / 失败 M」，失败原因列表展示 |
| 并发脏读（AI 起草后、执行前用户手动改了同一记录） | 执行前对比 before 快照与 DB 当前关键字段，不一致→该条标失败「数据已被改动，请重新起草」 |
| 状态流转违规（`flow_order_status` 跳站） | 执行器强制校验 `toStatus` 须为 `STATUS_FLOW` 下一站或终态分支（异常/取消），违规直接拒绝该条 |
| 删除被引用实体 | 允许软删除，确认弹窗预警「该实体被 N 条记录引用，删除后引用悬空，可恢复」 |
| AI 代理未运行（无 API_KEY） | 沿用 `probeProxy`，`toast` 提示设置，不进入写入流程 |
| 回收站清空 | `confirmModal` 二次确认，不可恢复；清空后悬空引用永久断（可接受） |

---

## 7. 测试策略（项目无单测框架）

- **关键路径手动验证清单**（10 条）：
  1. 单位新增 → 确认弹窗 → 执行 → 列表可见 + aiOps 有记录
  2. 单位删除 → 进回收站 → 恢复 → 列表恢复 + 引用订单名恢复
  3. 报价批量新增（5 条）→ 确认 → 执行 → 全部可见
  4. 订单状态流转合法（报价中→签约完成）→ 成功；非法（报价中→完成，跳过签约）→ 拒绝
  5. 寻货分配 → 明细 options 更新 + 订单详情可见
  6. 整批回滚 → 5 条报价消失 + aiOps 标 `undone`
  7. 回收站清空 → 二次确认 → trash 清空
  8. 导出 JSON → 不含 trash/aiOps；导入 → 本机回收站清空
  9. tool_calls 解析失败 → 降级纯文本，不执行
  10. 敏感字段缺失 → 弹窗高亮待补，补全后执行
- **构建验证**：每次改动后 `npm run build` 通过 + `file://` 打开 `dist/index.html` 正常（零依赖运行原则）
- **可选自检**：`window._aiOpsSelftest()` 跑合成场景（创建→删除→恢复→回滚），开发时 console 调用，不进生产路径

---

## 8. 分阶段实施

### 阶段 1 · 数据模型 + 回收站 + 历史（纯手动触发）

- `store.js`：加 `DB.trash`/`aiOps`，`ensureDBFields` 补齐；序列化剥离 trash/aiOps（导出/导入边界）
- `data.js`：加「操作历史」「回收站」两 tab（此时无 AI 数据，先用手动删除走回收站验证）
- 现有 `deleteOrder`/`deleteUnit`/`delPrice`/`deleteBOM`/`delSpecVal` 等改为软删除（入 trash）+ 记 aiOps
- 验证：手动删 → 回收站可见 → 恢复 → 历史可见 → 回滚

### 阶段 2 · Function Calling 协议接入（只读 + 简单工具起步）

- `ai.js`：改 `webChat`/tauri 流式解析 tool_calls delta，加多轮循环；`buildSystemPrompt` 升级
- 先上查询类 7 个 + 5 个简单写入工具：`create_unit`/`update_unit`/`create_price`/`update_price`/`flow_order_status`
- 确认弹窗 `renderOpsList` + `executeOps`（接现有 `newUnit`/`editPrice`）
- 验证：AI 起草 → 确认 → 执行 → 落库 + aiOps

### 阶段 3 · 全量工具 + 订单复杂操作

- 补齐剩余写入/软删除工具（BOM/属性/订单明细/寻货/删除类/结算/发票）
- 敏感字段「待补」交互；整批回滚逻辑
- 验证：全 ~32 工具路径 + 回滚 + 寻货 + 状态流转校验

### 阶段 4 · 功能层 + 打磨

- 功能层工具：导出 Excel（`exportOrder`）/ 视图导航 / 创建结算发票（纯系统动作）
- 错误处理边界全落地；并发脏读检测；历史筛选/分组视图；`_aiOpsSelftest`
- 版本号递增 v1.0.0 → v1.1.0（同步三处）

---

## 9. 前端变更清单

| 文件 | 变更 |
|------|------|
| `src/core/store.js` | `DB.trash`/`aiOps` 字段 + `ensureDBFields` 补齐；序列化剥离 trash/aiOps；软删除辅助 |
| `src/core/ai.js` | `chat()` 支持 `tools` 参数透传 + tool_calls delta 流式解析 + 多轮循环；`buildSystemPrompt` 升级 |
| `src/core/ai-tools.js`（新） | 工具 schema 定义 + 执行器（校验/预览/执行/审计/回填/回滚） |
| `src/views/ai-chat.js` | 写入类操作弹「AI 操作确认」弹窗（`renderOpsList`）；多轮循环入口 |
| `src/views/data.js` | 「操作历史」tab（AI 操作记录 + 回滚） |
| `src/views/trash.js`（新） | 回收站独立视图：分组列表 / 恢复 / 物理删除 / 清空 |
| `src/styles/components.css` | 确认弹窗操作卡片、操作徽章、回收站/历史表格样式 |

---

## 10. 风险与约束

| 风险 | 对策 |
|------|------|
| 模型 function calling 支持 | DeepSeek 官方 API 支持 OpenAI 兼容 tools；先小规模实测 `deepseek-v4-flash`；不支持则降级为「AI 输出 JSON + 前端解析」模式（方案 2 备选） |
| AI 幻觉数据 | 三层防线：校验复用表单规则 + 用户逐条确认 + 审计可回滚 |
| token 成本 | 工具 schema 随请求体发送（约 3-5KB）；查询工具返回结果限制长度（截断/摘要） |
| 与手动操作的一致性 | AI 写入走与用户完全相同的校验与保存链路，不另起炉灶（原则 2） |
| 软删除迁移风险 | 现有物理删除点逐个迁移并回归测试列表/统计/导出 |
| 回收站膨胀 | 本地业务量小，永久保留 + 手动清空；`aiOps` 2000 条 FIFO |

---

## 11. 验收标准

1. 自然语言创建单位/BOM/报价/结算/发票成功且数据与手动创建一致
2. 写入类操作全部经过确认弹窗，拒绝后数据零变更
3. 订单寻货分配与状态流转（合法）可由 AI 起草；非法跳站被拒绝
4. 删除操作后记录进入回收站，列表/统计/导出不可见，恢复后完整复原
5. 所有 AI 操作可在「操作历史」追溯，可单条/整批回滚
6. 导出 JSON 不含 trash/aiOps；导入后本机回收站清空
7. 浏览器版（`file://`）与桌面版（Tauri）行为一致
8. `npm run build` 通过 + `dist/index.html` 双击正常运行（零依赖运行原则）
