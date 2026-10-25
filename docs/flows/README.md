# 模块流程说明文档索引

> 对齐版本：**v1.0.57** · 每个文档统一结构：`模块功能概述` → `核心数据结构` → `关键函数及调用链` → `用户操作流程图` → `近期版本关键变更` → `与其他模块的数据依赖关系`
> 配套：使用说明见 [../操作手册.md](../操作手册.md)，接口见 [../API.md](../API.md)，迭代记录见 [../version/RELEASE-v1.0.md](../version/RELEASE-v1.0.md)

## 业务模块（侧栏导航顺序）

| 文档 | 模块 | 源码 | 路由 key |
|------|------|------|---------|
| [dashboard.md](dashboard.md) | 概览看板 | `src/views/dashboard.js` | `dashboard` |
| [units.md](units.md) | 关联单位管理 | `src/views/units.js` | `units` |
| [specs.md](specs.md) | 属性规格管理 | `src/views/specs.js` | `specs` |
| [bom.md](bom.md) | BOM 管理 | `src/views/bom.js` | `bom` |
| [prices.md](prices.md) | 签约报价 | `src/views/prices.js` | `prices` |
| [orders.md](orders.md) | 采购订单 | `src/views/orders.js` | `orders` |
| [settlements.md](settlements.md) | 对账结算 | `src/views/settlements.js` | `settlements` / `settle-receipt` / `settle-payment` |
| [invoices.md](invoices.md) | 发票管理 | `src/views/invoices.js` | `invoices` / `inv-issue` / `inv-receive` |
| [data.md](data.md) | 数据管理 | `src/views/data.js` | `data` |

## 横切模块（无独立侧栏入口）

| 文档 | 模块 | 源码 |
|------|------|------|
| [ai-chat.md](ai-chat.md) | AI 助手（对话 / 工具调用 / 知识库 / 附件） | `src/views/ai-chat.js` + `src/core/ai*.js` + `kb.js` |
| [keyboard.md](keyboard.md) | 键盘快捷键 | `src/views/keyboard.js` |
| [search-panel.md](search-panel.md) | 全局搜索与命令面板（⌘K） | `src/views/search-panel.js` |

## 维护约定

- 新增/修改业务视图函数后，同步更新对应流程文档的「关键函数及调用链」
- 版本相关行为变更追加到「近期版本关键变更」表格，不改写历史条目
- 函数名以源码为准，禁止凭记忆书写（文档中的函数均来自 `src/views/*.js` 实际声明）
