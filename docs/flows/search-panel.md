# 全局搜索与命令面板 (Search Panel) 流程说明文档

> 对齐版本：**v1.0.57** · 源码：`src/views/search-panel.js`
> 流程文档索引：[README](README.md)

## 模块功能概述

全局搜索与命令面板（`⌘K`）：一个输入框聚合七源检索（订单 / 客户 / 报价 / BOM / 结算 / 发票 / 知识库），支持关键字高亮、键盘导航、结果为空时直接转问 AI、选中条目按 `Tab` 以该条为上下文问 AI。

## 核心数据结构

面板不持久化数据，结果由各 `DB.*` 集合实时计算：

| 数据源 | 匹配字段 | 结果类型 |
|--------|---------|---------|
| `DB.orders` | 单号 / 采购商 / 项目 / 产品规格 / 备注 | 订单 |
| `DB.units` | 名称 / 联系人 / 电话 | 客户（单位） |
| `DB.prices` | SKU / 供应商 / 规格 | 报价 |
| `DB.bom` | SKU / 名称 / 规格 | BOM |
| `DB.settlements` | 单位 / 关联订单 | 结算 |
| `DB.invoices` | 单位 / 发票号 | 发票 |

## 关键函数及调用链

```
openSearchPanel()            # ⌘K 或顶栏搜索按钮
  └── 渲染面板 + 聚焦输入框
        │
cmdInputChanged(v)           # 输入变更（防抖 + isComposing 防护）
  └── cmdSearch(q)
        ├── _cmdUnitName() / _cmdSpecOf() / _cmdMoney() / _cmdSales()
        │     └── 组装各源候选行
        └── cmdRender(rows)  # 最多 40 条，cmdHighlight() 关键字高亮
              │
用户交互
  ├── cmdInputKey(e)   # ↑↓ 导航 / Enter 打开 / Esc 关闭 / Tab 问 AI
  ├── cmdHover(i)      # 鼠标悬停选中
  ├── 无结果 + Enter → askAISearch(q)      # 直接问 AI
  ├── 输入 ? 开头    → askAISearch(q)      # 强制问 AI
  └── 选中 + Tab     → askAIOnItem(item)   # 带上下文问 AI
        └── openAIWithMessage(text)  → views/ai-chat.js
closeSearchPanel()
```

## 用户操作流程图

```
⌘K / 点击顶栏搜索按钮
    │
    ▼
[命令面板打开，输入框聚焦]
    │
    ├── 输入关键字 → 防抖检索 → 结果列表（分组 + 高亮）
    │
    ├── ↑ / ↓ 选择 → Enter 打开对应条目
    │       ├── 订单   → goOrderView(id)  订单详情
    │       ├── 客户   → 关联单位列表并高亮
    │       ├── 报价   → 签约报价列表并筛选
    │       ├── BOM    → BOM 列表并筛选
    │       ├── 结算   → openSettleDetail(unitId)
    │       └── 发票   → openInvEdit(invId)
    │
    ├── Tab        → 以当前选中条目为上下文问 AI
    ├── 无结果 Enter → 直接问 AI
    ├── ? 前缀      → 强制问 AI
    └── Esc        → closeSearchPanel()
```

## 与其他模块的数据依赖关系

```
search-panel.js（只读检索 + 路由跳转）
    ├── DB.*（七源，知识库源读 window.__WIKI_INDEX）─→ 只读，不产生写入
    ├── router.js ──────────→ go() / goOrderView() / goOrder()
    ├── settlements.js ─────→ openSettleDetail()
    ├── invoices.js ───────→ openInvEdit()
    └── ai-chat.js ────────→ openAIWithMessage()（AI 联动）
```

## 交互约定

- 搜索框 `Enter` 触发搜索，**不使用 `oninput` 实时搜索**（避免中文输入法冲突）
- 面板打开时 `Esc` 优先级最高（先关面板）
- 结果为空时给出「直接问 AI」引导，不显示空白列表
