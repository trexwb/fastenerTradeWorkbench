# 概览看板 (Dashboard) 流程说明文档

## 模块功能概述

概览看板是系统的首页视图，负责聚合展示全局关键业务指标与待办事项。它不涉及数据写入，仅从 DB 中读取各模块数据做统计计算，向用户提供"一眼掌握全局"的能力。

核心功能：
- **统计卡片**：展示订单数量/金额、结算应收应付、发票状态的汇总数据
- **图表数据聚合**：基于订单、结算、发票数据计算趋势与占比
- **导航入口**：通过侧栏切换至各业务模块

## 核心数据结构

dashboard 模块无独立数据结构，所有数据均从全局 `DB` 对象读取：

| 数据来源 | 字段 | 用途 |
|---------|------|------|
| `DB.orders` | `status`, `items`, `delivery`, `createdAt` | 订单统计、总额、状态分布 |
| `DB.settlements` | `type`, `amount`, `unitId`, `orders` | 收款/付款统计 |
| `DB.invoices` | `type`, `invoiceStatus`, `receiveStatus`, `amount` | 开票/收票状态统计 |
| `DB.units` | `roles`, `rating` | 关联单位数量统计 |
| `DB.prices` | `validFrom` | 报价数量与有效期 |

## 关键函数及调用链

```
viewDashboard()
  ├── 统计卡片的计算（内联）
  │     ├── DB.orders 聚合 → 订单总数/总额/状态分布
  │     ├── DB.settlements 聚合 → 应收/应付/已收/已付
  │     └── DB.invoices 聚合 → 开票/收票状态统计
  ├── 待办事项计算（内联）
  │     ├── 待确认订单筛选 (status==='待确认')
  │     ├── 逾期订单筛选 (isOverdue(o))
  │     ├── 待结算统计
  │     └── 待开票/收票统计
  └── 渲染 HTML 字符串 → app.innerHTML
```

**使用到的工具函数**（来自 utils.js）：
- `fmt(n)` — 金额格式化（¥格式）
- `fmtN(n)` — 数值格式化
- `isOverdue(o)` — 判断订单是否逾期
- `isApproaching(o)` — 判断交货期临近（≤3天）
- `orderSales(o)` — 计算订单销售总额
- `orderProfit(o)` — 计算订单利润

## 用户操作流程图

```
进入系统 / 点击侧栏「概览」
    │
    ├── 系统初始化 (initApp)
    │     ├── IndexedDB 加载数据
    │     ├── 恢复文件同步 (initFileHandle)
    │     └── render() → viewDashboard()
    │
    ▼
[概览看板页面]
    │
    ├── 统计卡片区域
    │     ├── 订单总数/总额
    │     ├── 待处理订单数
    │     ├── 应收/应付金额
    │     └── 待开票/收票数量
    │
    ├── 待办事项列表
    │     ├── 逾期订单提醒
    │     ├── 待确认/寻货中订单
    │     └── 待结算/待开票项
    │
    └── 用户操作
          ├── 点击统计数字 → 无直接跳转（仅展示）
          ├── 点击侧栏菜单 → go('orders')/go('settlements') 等
          └── 点击逾期订单 → goOrderView(id) 进入订单详情
```

## 与其他模块的数据依赖关系

```
dashboard (只读聚合)
    │
    ├── DB.orders ──────→ 由 orders.js 模块维护
    │   ├── status: 订单状态分布
    │   ├── items[].salePrice × qty: 订单总额
    │   ├── delivery: 逾期/临近判断
    │   └── items[].options: 利润计算
    │
    ├── DB.settlements ─→ 由 settlements.js 模块维护
    │   ├── type: 'receipt'/'payment' 区分收款/付款
    │   ├── amount: 结算金额
    │   └── orders[]: 关联订单汇总
    │
    ├── DB.invoices ────→ 由 invoices.js 模块维护
    │   ├── type: 'issue'/'receive' 区分开票/收票
    │   ├── invoiceStatus: 开票状态
    │   └── receiveStatus: 收票状态
    │
    └── DB.units ───────→ 由 units.js 模块维护
        └── roles: 采购商/供应商数量
```

dashboard 模块是纯消费者，不产生任何写入操作，所有数据变更依赖其他模块通过 `saveDB()` 持久化后，dashboard 在下次 `render()` 时自动反映最新状态。
*（内容由AI生成，仅供参考）*
