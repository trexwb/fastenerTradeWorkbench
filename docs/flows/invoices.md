# 发票管理 (Invoices) 流程说明文档

## 模块功能概述

发票管理模块基于结算记录自动生成发票台账，区分「开票记录」（向采购商开票）和「收票记录」（从供应商收票）两种类型。系统通过 syncInvoices 函数自动将结算数据同步为发票，并追踪开票状态和收票状态。

核心功能：
- **开票/收票双视图**：通过 viewInvoices('issue') / viewInvoices('receive') 切换
- **子 Tab 状态筛选**：未开票/已开票（issue）或未收票/已收票（receive）
- **统计卡片**：实时显示应收/已收/未收总额（或应付/已付/未付）
- **syncInvoices 自动同步**：从 DB.settlements 创建/更新发票记录
- **编辑发票**：补充更新发票号、日期、金额、企业抬头等信息
- **局部刷新**：分页/搜索/Tab 切换均触发局部刷新，不重渲染整页

## 核心数据结构

发票数据存储在 `DB.invoices` 数组中：

```javascript
DB.invoices = [
  {
    id: 'INV001',              // 唯一标识（uid('INV')）
    settleId: 'S301',          // 关联结算 ID（来自 DB.settlements.id）
    type: 'issue',             // 类型：'issue' 开票（向采购商）/ 'receive' 收票（从供应商）
    unitId: 'U101',            // 关联单位 ID
    unitName: '采购商A公司',    // 单位名称（冗余存储）
    amount: 12500.00,          // 已收/已付金额
    receivable: 12500.00,      // 应收金额（issue 类型有效）
    payable: 0,                // 应付金额（receive 类型有效）
    remark: 'BOLT-M8×20×500×0.15；...', // 产品明细摘要（从关联订单提取）
    settleNote: '',            // 结算备注
    settleDate: '2026-08-10',  // 结算日期
    invoiceDate: '',           // 开票日期（issue）
    invoiceNumber: '',         // 发票号
    invoiceStatus: '未开票',    // 开票状态（issue）：未开票 / 已开票
    taxTitle: '',              // 企业抬头（issue）
    receiveStatus: '未收票',    // 收票状态（receive）：未收票 / 已收票
    receiveDate: '',           // 收票日期（receive）
    createdAt: '2026-08-10'    // 创建日期
  }
];
```

### 全局状态变量
```javascript
let _invTab = 'issue';          // 当前主视图: 'issue'/'receive'
let _invSubTab = 'unpaid';      // 当前子 Tab: 'unpaid'(未开/未收)/'paid'(已开/已收)
let _invSearch = '';            // 搜索关键词
let _invUnitFilter = '';        // 单位筛选
let _invPage = 1;               // 当前页码
```

## 关键函数及调用链

### 路由分发
```
router.js render()
  ├── case 'invoices':     viewInvoices('issue')
  ├── case 'inv-issue':    viewInvoices('issue')
  └── case 'inv-receive':  viewInvoices('receive')

bindView() → case 'invoices'/'inv-issue'/'inv-receive':
  └── 无固定 combo 绑定（viewInvoices 内部渲染搜索框）
```

### 主视图（viewInvoices）
```
viewInvoices(type)
  ├── _invTab = type (issue/receive)
  ├── syncInvoices()                  // 同步结算数据到发票
  ├── invoiceIssueData() / invoiceReceiveData()  // 聚合数据
  ├── 子 Tab 过滤（unpaid/paid）
  ├── 搜索 + 单位筛选
  ├── 分页 → pageData
  ├── 渲染：
  │     ├── 搜索框
  │     ├── 统计卡片（应收/已收/未收 总计）
  │     ├── 子 Tab（未开/已开 或 未收/已收）
  │     └── 发票列表表格（按单位聚合，每行含多张发票明细）
  └── invPage(n) 分页
```

### syncInvoices 自动同步
```
syncInvoices()
  ├── 遍历 DB.settlements
  ├── 按 settleId 查找 DB.invoices 是否已存在对应发票
  │
  ├── 收款结算 (receipt) → issue 开票
  │     ├── 无对应发票 → 创建新记录
  │     │     ├── id = uid('INV'), settleId = s.id
  │     │     ├── type = 'issue', invoiceStatus = '未开票'
  │     │     └── amount = s.amount（直接取结算金额，不重复计算）
  │     └── 已有发票 → 更新金额/单位名称
  │
  ├── 付款结算 (payment) → receive 收票
  │     ├── 无对应发票 → 创建新记录
  │     │     ├── type = 'receive', receiveStatus = '未收票'
  │     │     └── amount = s.amount
  │     └── 已有发票 → 更新金额/单位名称
  │
  ├── 自动生成 remark：
  │     ├── 从关联订单提取 SKU × 数量 × 单价
  │     └── 无关联订单 → "独立结算单" 提示
  └── changed → saveDB()
```

### 数据聚合（invoiceIssueData / invoiceReceiveData）
```
invoiceIssueData()       // 开票聚合：按采购商分组
  ├── syncInvoices()
  ├── 从 DB.orders 聚合应收总额（orderSales × 订单数）
  ├── 从 DB.invoices 聚合已收金额（type='issue' 的 amount 之和）
  ├── 追加独立结算单的应收（无关联订单的 receipt 结算）
  └── 返回：[{unitId, unitName, records[], totalReceivable, totalReceived}]

invoiceReceiveData()     // 收票聚合：按供应商分组
  ├── syncInvoices()
  ├── 从 DB.orders + itemOpts 聚合应付总额（按 supplierId）
  ├── 从 DB.invoices 聚合已付金额（type='receive' 的 amount 之和）
  └── 返回：[{unitId, unitName, records[], totalPayable, totalPaid}]
```

### Tab 切换与筛选
```
switchInvSubTab(sub)     → 子 Tab 切换 unpaid/paid，重置页码并 render()
onInvUnitFilter(val)     → 单位筛选，置空则显示全部
onInvSearch(v)           → 搜索关键词（含搜索框高亮切换）
invPage(n)               → 分页跳转（完整聚合后重新筛选分页）
```

### 编辑发票（openInvEdit）
```
openInvEdit(invId)
  ├── 从 DB.invoices 查找发票记录
  ├── 从关联单位读取发票抬头信息（taxTitle 自动生成）
  ├── 从关联订单实时读取产品明细（productRows）
  ├── 打开抽屉表单：
  │     ├── 开票(issue)：开票时间/发票号/开票状态/结算备注/企业抬头
  │     └── 收票(receive)：收票日期/发票号/收票状态/结算备注
  └── 保存回调：
        ├── 校验已开票必须填开票时间
        ├── 校验已收票建议填收票日期
        ├── Object.assign → saveDB() → closeDrawer() → render()
```

## 用户操作流程图

```
[发票管理页面]
    │
    ├── 搜索框
    │     └── onInvSearch(v) → render()
    │
    ├── 统计卡片（按当前主视图）
    │     ├── issue：应开发票总额 / 已开票总额 / 未开票总额
    │     └── receive：应付总额 / 已付总额 / 未付总额
    │
    ├── 子 Tab 状态筛选
    │     ├── issue：未开票（n家）/ 已开票（n家）
    │     └── receive：未收票（n家）/ 已收票（n家）
    │
    ├── 发票列表（按单位聚合）
    │     ├── 列：结算日期 / 公司名称 / 应收金额 / 已收金额 / 未收金额 / 状态 / 操作
    │     └── 编辑 → openInvEdit(invId)
    │
    └── 分页器 → invPage(n)

[编辑发票抽屉]
    │
    ├── 关联单位 + 结算日期/金额（只读）
    │
    ├── 产品明细表格（SKU/规格/数量/单价/金额）
    │     └── 从关联订单实时读取，不依赖 remark 字段
    │
    ├── 开票表单（issue 类型）
    │     ├── 开票时间 / 发票号 / 开票状态（下拉）
    │     ├── 结算备注（textarea）
    │     └── 企业抬头（textarea，自动从单位 invoice 填充）
    │
    ├── 收票表单（receive 类型）
    │     ├── 收票日期 / 发票号 / 收票状态（下拉）
    │     └── 结算备注（textarea）
    │
    └── 保存 → Object.assign → saveDB()
```

## 与其他模块的数据依赖关系

```
发票管理 (invoices)
    │
    ├── 被依赖方
    │     ├── dashboard.js：发票状态统计（待开票/待收票数量）
    │     └── data.js：importJSON/clearAllData 处理 invoices 字段
    │
    ├── 依赖项
    │     ├── DB.settlements（syncInvoices 同步源）
    │     │     ├── receipt → issue 开票（amount 直接取结算金额）
    │     │     └── payment → receive 收票
    │     ├── DB.orders（invoiceIssueData/invoiceReceiveData 聚合应收应付）
    │     │     ├── orderSales(o) → 应收金额（按 buyerId 聚合）
    │     │     └── items[].options → 应付金额（按 supplierId 聚合）
    │     ├── DB.units（单位 combo 下拉 + 发票抬头信息）
    │     └── utils.js：fmt(n), orderSales(o), itemOpts(it), itemQuotePrice(it)
    │
    └── 数据流说明
          ├── syncInvoices 在 viewInvoices() 渲染时自动调用
          │     └── 新增结算 → 自动创建对应发票记录（去重：按 settleId）
          ├── 发票编辑时从关联订单实时读取产品明细
          ├── 发票状态独立追踪，不依赖结算状态
          │     ├── issue: invoiceStatus (未开票/已开票)
          │     └── receive: receiveStatus (未收票/已收票)
          └── 删除结算不自动删除对应发票（发票独立维护）
```
*（内容由AI生成，仅供参考）*
