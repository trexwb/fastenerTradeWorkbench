# 对账结算 (Settlements) 流程说明文档

## 模块功能概述

对账结算模块是财务对账的核心，负责管理收款记录（向采购商收）和付款记录（向供应商付）。系统自动基于订单计算应收/应付金额，支持按单位汇总对账和按订单逐笔分配结算两种模式。

核心功能：
- **收款/付款双视图**：主 Tab 切换收款（receipt）和付款（payment）
- **子 Tab 状态筛选**：未收(unpaid)/已收(paid) 或 未付(unpaid)/已付(paid)
- **统计卡下钻**：应收/应付、已收/已付、未收/未付三个统计卡可点击跳转到对应子 Tab
- **自动计算金额**：收款按订单销售总额（orderSales）汇总；付款按产品寻货分配金额汇总
- **按单位汇总对账**：列表按采购商/供应商聚合显示，显示应收/已收/未收金额及进度条
- **订单关联分配**：一笔结算可关联多个订单，金额按比例分配到各订单
- **明细抽屉三区块**：关联订单 + 产品明细 + 结算记录，三个可折叠区块
- **自动填入金额**：勾选订单后自动汇总未结金额填充到结算金额输入框

## 核心数据结构

结算数据存储在 `DB.settlements` 数组中：

```javascript
DB.settlements = [
  {
    id: 'ST001',               // 唯一标识（uid('ST')）
    type: 'receipt',           // 类型：'receipt' 收款 / 'payment' 付款
    unitId: 'U101',            // 关联单位 ID
    date: '2026-08-10',        // 结算日期
    amount: 12500.00,          // 结算金额
    person: '赵六',             // 经手人（收款=付款人，付款=收款人）
    note: 'Q3 季度结算',        // 备注
    orders: [                  // 关联订单分配明细
      {
        orderId: 'PO260811-001', // 订单 ID
        amount: 12500.00         // 该笔结算分配到该订单的金额（按比例分配）
      }
    ],
    createdAt: '2026-08-10'   // 创建时间
  }
];
```

### 全局状态变量
```javascript
let _settleTab = 'receipt';      // 当前主视图: 'receipt'/'payment'
let _settleSubTab = 'unpaid';    // 当前子 Tab: 'unpaid'/'paid'
let _settleSearch = '';          // 搜索关键词
let _settleUnitFilter = '';      // 单位筛选
let _settlePage = 1;             // 当前页码
```

## 关键函数及调用链

### 路由分发
```
router.js render()
  ├── case 'settle-receipt': viewSettlements('receipt')
  ├── case 'settle-payment': viewSettlements('payment')
  └── case 'settlements':    viewSettlements(_settleTab)
```

### 主视图（viewSettlements）
```
viewSettlements(type)
  ├── _settleTab = type (receipt/payment)
  ├── settleReceiptData() / settlePaymentData()   // 聚合数据
  ├── 子 Tab 过滤（unpaid/paid，按 gap > 0 判断）
  ├── 搜索 + 单位筛选
  ├── 分页 → pageData
  ├── 渲染：
  │     ├── 搜索框
  │     ├── 统计卡片（可点击下钻到 unpaid/paid 子 Tab）
  │     ├── 子 Tab（未收/已收 或 未付/已付）
  │     └── 结算列表表格（按单位聚合，含进度条）
  └── settlePage(n) 分页
```

### 数据聚合
```
settleOrders()          // 获取符合条件的订单（签约完成/送货中/完成）

settleReceiptData()     // 收款聚合：按采购商分组
  ├── 遍历订单，按 buyerId 分组
  ├── 汇总 totalReceivable = Σ orderSales(o)
  ├── 汇总 totalReceived = Σ settlement.amount (type='receipt')
  └── 返回：[{unitId, unitName, orders[], totalReceivable, totalReceived, totalPaid}]

settlePaymentData()     // 付款聚合：按供应商分组
  ├── 遍历订单产品项，按 supplierId 分组
  ├── 汇总 totalPayable = Σ (op.price × op.allocQty)
  ├── 汇总 totalPaid = Σ settlement.amount (type='payment')
  └── 返回：[{unitId, unitName, orders[], totalPayable, totalPaid}]

settleUnitOrderDetails(unitId, type)  // 获取指定单位的订单明细
settleRecords(unitId, type)           // 获取指定单位的结算记录列表
```

### Tab 切换与筛选
```
drillSettleTab(sub)         → 统计卡点击下钻，重置页码并 render()，滚动到表格
switchSettleSubTab(sub)     → 子 Tab 切换 unpaid/paid，重置页码并 render()
onSettleUnitFilter(val)     → 单位筛选，置空则显示全部
onSettleSearch(v)           → 搜索关键词（含搜索框高亮切换）
settlePage(n)               → 分页跳转（完整聚合后重新筛选分页）
```

### 新增结算（openNewSettlement）
```
openNewSettlement(presetUnitId, type)
  ├── tabType = type || _settleTab（自动识别当前 tab）
  ├── openDrawer('新增结算记录', body, submitSettlement)
  │
  ├── 表单字段：
  │     ├── 结算类型（下拉：收款/付款）→ onSettleTypeChange()
  │     ├── 采购商/供应商 combo（角色过滤）
  │     ├── 结算日期（默认当天）
  │     ├── 结算金额（可手动输入或自动汇总）
  │     ├── 经手人 / 备注
  │     └── 关联订单列表（勾选复选框）
  │
  └── 绑定单位下拉后 → refreshSettleOrderList()

onSettleTypeChange()        // 切换结算类型时重新绑定单位下拉并清空金额
  ├── 清空经手人/金额/备注
  ├── 重新绑定单位下拉（角色过滤）
  └── 清空订单列表

refreshSettleOrderList()    // 根据所选单位和结算类型刷新待结算订单列表
  ├── type='receipt' → 按 buyerId 匹配订单
  ├── type='payment' → 按 items[].options[].supplierId 匹配
  ├── 显示：订单号 / 状态标签 / 未结金额
  └── 绑定 change 事件 → autoSumSettleAmount()

autoSumSettleAmount()       // 勾选订单后自动汇总未结金额
  ├── 收集 .settle-order-chk:checked 的订单
  ├── 累加 data-max 属性（未结金额）
  ├── 填充到 st_amount 输入框
  └── toast 提示汇总结果

submitSettlement()          // 校验并提交结算
  ├── 必填校验：unitId / date / amount > 0
  ├── 勾选订单金额校验：amount ≤ 勾选订单未结总额
  ├── 按比例分配：amount × (max/totalMax) → 各订单分配金额
  ├── 组装确认 HTML → confirmModal
  │     ├── 展示：类型/单位/日期/金额/经手人/备注/订单分配明细
  │     └── 用户确认 → 保存
  └── 保存：
        ├── DB.settlements.push({id: uid('ST'), type, unitId, date, amount, person, note, orders, createdAt})
        └── saveDB() → closeDrawer() → render()
```

### 查看/删除结算
```
openSettleDetail(unitId, tabType)
  ├── settleRecords() → 结算记录列表
  ├── settleUnitOrderDetails() → 订单明细
  ├── settleProductRows() → 产品明细（按订单分组合并单元格）
  ├── 打开抽屉（三个折叠区块）：
  │     ├── 关联订单区块（折叠）
  │     ├── 产品明细区块（折叠）
  │     └── 结算记录区块
  └── toggleDrawerSection(hd) → 折叠/展开

delSettlement(id)
  ├── 检查是否有发票关联（DB.invoices 中 settleId 匹配）
  │     └── 有发票 → 警告提示"删除后发票数据会失配"
  ├── confirmModal → 确认
  ├── DB.settlements = DB.settlements.filter(...)
  └── saveDB() → render()
```

### 抽屉区块折叠
```
toggleDrawerSection(hd)
  ├── 切换 hd.nextElementSibling 的 display
  ├── 翻转 .sec-arrow 的 collapsed class
  └── 切换 chevronUp / chevronDown 图标
```

## 用户操作流程图

```
[对账结算页面]
    │
    ├── 搜索框
    │     └── onSettleSearch(v) → render()
    │
    ├── 统计卡片（可点击下钻）
    │     ├── 应收/应付总额（被动）
    │     ├── 已收/已付总额 → drillSettleTab('paid')
    │     └── 未收/未付总额 → drillSettleTab('unpaid')
    │
    ├── 子 Tab 筛选
    │     ├── 收款：未收（n家）/ 已收（n家）
    │     └── 付款：未付（n家）/ 已付（n家）
    │
    ├── 结算列表表格（按单位聚合）
    │     ├── 列：单位名称 / 应收应付 / 已收已付 / 未收未付 / 状态+进度条 / 操作
    │     ├── 明细按钮 → openSettleDetail(unitId, type)
    │     └── 新增结算按钮 → openNewSettlement(unitId, type)
    │
    └── 分页器 → settlePage(n)

[新增结算记录抽屉]
    │
    ├── 结算类型选择（收款/付款）→ onSettleTypeChange()
    │
    ├── 采购商/供应商选择（角色联动）
    │     └── 选择后 → refreshSettleOrderList() 加载关联订单
    │
    ├── 结算日期 / 结算金额
    │
    ├── 经手人 / 备注
    │
    ├── 关联订单列表（可多选勾选）
    │     ├── 勾选后 → autoSumSettleAmount() 自动填入金额
    │     └── 显示：订单号 / 状态标签 / 未结金额
    │
    ├── 确认保存 → submitSettlement()
    │     ├── 勾选订单按比例分配金额
    │     ├── 确认弹窗展示分配明细
    │     └── DB.settlements.push(...) → saveDB() → render()

[结算明细抽屉]
    │
    ├── 汇总信息（应收/已收/未收）
    │
    ├── 关联订单区块（折叠）
    │     └── 订单号 / 状态 / 应收应付 / 已收已付 / 未收未付 / 结算状态
    │
    ├── 产品明细区块（折叠）
    │     └── 按订单号分组合并单元格：订单号 / SKU / 规格 / 属性 / 单价 / 数量 / 总额
    │
    └── 结算记录区块
          └── 日期 / 金额 / 经手人 / 关联订单 / 备注
```

## 与其他模块的数据依赖关系

```
对账结算 (settlements)
    │
    ├── 被依赖方
    │     ├── invoices.js：syncInvoices() 基于结算创建/更新发票
    │     │     ├── 收款结算(settlement) → issue 开票
    │     │     └── 付款结算(settlement) → receive 收票
    │     ├── dashboard.js：应收/应付金额统计
    │     └── data.js：importJSON/clearAllData 处理 settlements 字段
    │
    ├── 依赖项
    │     ├── DB.orders（按单位匹配订单，计算金额）
    │     │     ├── receipt: orders.filter(o => o.buyerId === unitId)
    │     │     └── payment: orders.filter(o => o.items.some(it => it.options.some(opt => opt.supplierId === unitId)))
    │     ├── DB.units（单位 combo 下拉）
    │     └── utils.js：orderSales(o), itemOpts(it), STATUS_COLORS
    │
    └── 数据流说明
          ├── 结算创建/修改 → saveDB() → 发票管理 syncInvoices 重新计算开票状态
          ├── 结算删除 → 有发票关联时警告但不阻止
          └── 订单状态变更不影响已建结算（结算独立存储金额快照）
```
*（内容由AI生成，仅供参考）*
