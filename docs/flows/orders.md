# 采购订单 (Orders) 流程说明文档

## 模块功能概述

采购订单模块是系统的核心业务流程模块，包含从订单创建到完成的完整生命周期管理。支持产品明细管理、多供应商寻货分配、订单状态流转、送货信息追踪等功能。

核心功能：
- **订单管理**：新建、编辑、查看、删除采购订单
- **产品明细**：添加/编辑/删除产品项，支持从 BOM 引用和 Excel 批量粘贴
- **供应商寻货**：多供应商分配模式，支持价格库匹配和手动录入两种方式
- **订单状态机**：9 种状态的严格流转（待确认→寻货中→报价中→签约完成→送货中→完成；分支：未成交可恢复、异常/取消为终态）
- **深度拷贝**：saveOrder 保存时对 items[].options[] 执行深拷贝避免引用污染
- **草稿恢复**：新建/编辑订单时自动保存草稿（localStorage），可恢复
- **批量删除**：勾选后批量删除，含结算/发票关联检查
- **独立序号**：使用 orderSeq 独立序号生成器，避免删除后序号重复

## 核心数据结构

订单数据存储在 `DB.orders` 数组中，`DB.orderSeq` 维护独立序号：

```javascript
DB.orders = [
  {
    id: 'PO260811-001',      // 订单编号（PO+日期+序号）
    buyerId: 'U101',          // 采购商 unit.id
    buyerContact: '张三',      // 对接联系人
    project: '设备装配',       // 项目背景
    delivery: '2026-08-20',   // 期望交货期
    status: '寻货中',          // 订单状态
    remark: '',               // 备注
    items: [                  // 产品明细
      {
        id: 'I501',           // 产品项 ID（uid('I')）
        sku: 'BOLT-M8-304',   // SKU
        name: 'M8 304螺栓',   // 名称
        spec: 'M8×30 304',    // 规格
        type: '螺栓',          // 类型
        standard: 'GB/T',     // 标准
        diameter: 'M8',       // 直径
        hardness: '8.8',      // 硬度
        surface: '镀锌(白)',   // 表面处理
        material: '304',      // 材质
        qty: 5000,            // 数量（千支）
        salePrice: 0.25,      // 销售单价（元/千支）
        usage: '',            // 用途
        remark: '',           // 备注
        bomSku: 'BOLT-M8-304',// 关联 BOM SKU
        options: [            // 供应商寻货分配
          {
            id: 'Q601',           // 分配记录 ID（uid('Q')）
            supplierId: 'U201',   // 供应商 unit.id
            contact: '李四',       // 联系人
            price: 0.15,          // 采购单价
            allocQty: 3000,       // 分配数量
            stockNote: '',        // 库存/交期备注
            source: 'priceLibrary', // 来源：priceLibrary/manual
            status: '已选'         // 状态
          }
        ]
      }
    ],
    createdAt: '2026-08-11 10:30',   // 创建时间
    updatedAt: '2026-08-11 10:35',   // 最后更新时间
    statusChangedAt: '2026-08-11'    // 状态变更时间
  }
];
```

### 状态机常量
```javascript
const ORDER_STATUSES = ['待确认','寻货中','报价中','未成交','签约完成','送货中','异常','完成','取消'];
const STATUS_COLORS = {'待确认':'gray','寻货中':'info','报价中':'warn','未成交':'gray','签约完成':'ok','送货中':'info','异常':'err','完成':'ok','取消':'gray'};
const STATUS_FLOW = ['待确认','寻货中','报价中','签约完成','送货中','完成'];  // 正向流转路径（不含未成交/异常/取消分支态）
```

### 视图状态
```javascript
// router.js 全局变量
let curOrder = null;       // 当前编辑订单（进入编辑模式时设为 '__new__' 或 order.id）
let curOrderView = null;   // 当前查看的订单 ID
let _fItems = [];          // 表单中正在编辑的产品列表
let _fMode = '';           // 'new' 或 'edit'
let _fOrderId = null;      // 编辑中的订单 ID
```

## 关键函数及调用链

### 路由分发
```
router.js render()
  └── case 'orders':
        ├── curOrder ? viewOrderEdit()     // 编辑/新建模式
        │   : curOrderView ? viewOrderDetail()  // 详情模式
        │   : viewOrders()                      // 列表模式
```

### 订单列表（viewOrders）
```
viewOrders()
  ├── filterOrdersData() → 按状态/关键词筛选，按 createdAt 倒序
  ├── 渲染：工具栏（搜索/状态筛选/新建/批量删除）+ 表格 + 分页
  ├── 表格列：订单号/采购商/项目/交货期/商品汇总/状态/利润/操作
  ├── 逾期/临近交货高亮标记
  ├── 操作按钮：
  │     ├── 查看 → goOrderView(id)
  │     ├── 编辑 → goOrderEdit(id)
  │     └── 删除 → deleteOrder(id)
  └── 批量删除：batchDeleteOrders()
        └── 检查结算/发票关联 → confirmModal → DB.orders.filter → saveDB()
```

### 新建订单（newOrder）
```
newOrder()
  ├── 初始化: _fMode='new', _fOrderId=null, _fItems=[]
  ├── 草稿检查: hasDraft(DRAFT_TYPES.order)?
  │     ├── 确认恢复 → restoreOrderDraft(d)
  │     └── 放弃 → clearDraft(DRAFT_TYPES.order)
  ├── render() → viewOrderEdit()
  └── setTimeout → bindOrderDraftSave() 绑定自动保存
```

### 编辑订单（goOrderEdit）
```
goOrderEdit(id)
  ├── 从 DB.orders 查找订单
  ├── _fMode='edit', _fOrderId=id
  ├── _fItems = o.items.map(it => ({...it}))  // 浅拷贝产品列表
  ├── render() → viewOrderEdit()
  └── bindOrderDraftSave()  // 编辑模式也绑定草稿
```

### 订单表单（viewOrderEdit）
```
viewOrderEdit()
  ├── 订单头部信息：采购商 combo + 联系人/项目/交货期/状态/备注
  ├── 产品明细卡片 (productCard)
  │     ├── 产品列表 (renderItemHTML)
  │     │     ├── 每行显示：SKU/规格/属性/需求数量/分配状态/进度条
  │     │     ├── 供应商详情（已分配列表）
  │     │     └── 操作按钮：编辑/寻货/删除
  │     └── 「添加产品」「批量添加」按钮
  └── 底部工具栏：返回/保存
```

### 产品项管理
```
addItem()              → openItemModal(-1)   // 新增
editItem(i)           → openItemModal(i)     // 编辑
delItem(i)            → confirmModal → splice → refreshProductList()

openItemModal(idx)
  ├── BOM 引用 combo（选 BOM 后 fillSpecFromBOM('m') 自动填属性）
  ├── SKU / 规格 输入框
  ├── 六属性 combo 下拉
  ├── 数量 / 销售单价 输入框
  ├── 用途 / 备注 输入框
  └── saveItemModal()
        ├── 收集表单数据
        ├── 数量/单价校验（>0）
        ├── 新建: _fItems.push({id:uid('I'),...options:[]})
        ├── 编辑: _fItems[_fEditIdx] = {...old, ...d}
        └── closeDrawer() → refreshProductList()
```

### 批量添加产品（Excel 粘贴）
```
openOrderBatchAdd() → 打开抽屉（textarea粘贴区域）
  └── parseOrderBatch()
        ├── 按换行分行，按 Tab 分列
        ├── 首行关键词检测（序号/名称/SKU/规格/表面处理/数量/单价）
        ├── 解析：sku/表面处理/规格/数量/单价 + 额外属性列
        ├── BOM 匹配：_getBom(sku) 自动填充属性
        ├── 展示预览表格（含编号/SKU/名称/规格/数量/单价/BOM状态）
        │     └── 支持逐行删除 (removeOrderBatchRow)
        └── submitOrderBatch()
              ├── 逐项 push 到 _fItems
              ├── 未匹配 BOM 的 SKU → 确认弹窗 → 一键添加到 BOM 库
              └── closeDrawer() → refreshProductList()
```

### 供应商寻货流程

```
sourceItem(idx) → 打开寻货抽屉
  │
  ├── buildSourceDrawerBody(idx)
  │     ├── 产品信息区（SKU/规格/属性/需求/已分配/剩余/销售价）
  │     ├── 已选供应商列表（可移除 removeOption）
  │     └── 两个入口按钮：
  │           ├── 「价格库匹配」→ openPriceMatchModal(idx)
  │           └── 「手动录入供应商」→ openManualSupplierModal(idx)
  │
  ├── [路径A] 价格库匹配
  │     ├── buildPriceMatchModalBody(idx, q)
  │     │     ├── DB.prices 中 specMatch 匹配的产品报价
  │     │     ├── 排除已添加的供应商
  │     │     └── 显示：供应商/联系人/价格/利润/分配数量输入框
  │     ├── 支持搜索过滤 filterPriceMatch
  │     └── submitPriceMatch(idx)
  │           ├── 收集勾选 + 分配数量 → entries[]
  │           ├── 过滤已存在供应商（去重）
  │           └── 逐个 addMatchSupplier(idx, priceId, qty)
  │                 ├── 超量检查（remain >= qty）
  │                 ├── 重复检查
  │                 └── it.options.push({supplierId, price, allocQty, source:'priceLibrary'})
  │                       └── saveOrderDraftFromItems() + persistOrderItems() + refresh
  │
  └── [路径B] 手动录入
        ├── buildManualSupplierModalBody(idx)
        │     ├── 供应商名称 combo（可新建）
        │     ├── 联系人/电话
        │     ├── 采购单价/分配数量/库存交期备注
        │     └── 自动写入价格库 + 关联单位
        └── manualSupplier(idx)
              ├── 超量检查
              ├── 查找或创建关联单位（DB.units.push）
              ├── 自动写入价格库（防重复 isPriceDuplicate）
              ├── 添加 options：{source:'manual'}
              └── saveDB() + refresh
```

### 保存订单（saveOrder）
```
async saveOrder()
  ├── 校验：采购商必选、产品数量>0、交货期必填、状态有效性
  ├── 重复 SKU+规格 检测（仅警示不阻塞）
  │     └── 同一 sku+spec 出现多次 → toast 警告
  │
  ├── [编辑模式] _fMode==='edit' && _fOrderId
  │     ├── Object.assign 更新字段：buyerId/contact/project/delivery/status/remark
  │     ├── 深拷贝 items：.map(it => ({...it, options: (it.options||[]).map(o => ({...o}))}))
  │     ├── clearDraft(DRAFT_TYPES.order)
  │     └── saveDB() → curOrder=null, curOrderView=_fOrderId → render()
  │
  └── [新建模式]
        ├── 生成订单号：'PO'+today(YYMMDD)+'-'+String(seq).padStart(3,'0')
        │     └── DB.orderSeq 独立自增，不受删除影响
        ├── 深拷贝 items
        ├── DB.orders.push({...})
        ├── clearDraft(DRAFT_TYPES.order)
        └── saveDB() → curOrder=null, curOrderView=id → render()
```

### 订单详情（viewOrderDetail）
```
viewOrderDetail()
  ├── 根据 curOrderView 查找订单
  ├── 头部信息区：订单号/采购商/联系人/项目/交货期/状态/备注
  ├── 产品明细表格（每行含供应商分配详情和利润）
  ├── 操作按钮：
  │     ├── changeOrderStatus(id, newStatus) → 状态流转
  │     ├── saveDeliveryInfo(id) → 保存送货信息 → 状态→送货中
  │     └── sourceItemFromDetail(idx) → 从详情页发起寻货
  └── 状态变更逻辑：
        ├── 按 STATUS_FLOW 正向流转（待确认→...→完成）
        ├── 任意状态可转为「取消」
        └── 状态变更记录 statusChangedAt
```

### 草稿系统
```
bindOrderDraftSave()       // 给 #app 下 input/select/textarea 绑定 input+change 自动保存
collectOrderDraft()        // 收集当前表单状态（buyerId/project/delivery/status/remark/items）
saveOrderDraftFromItems()  // 保存订单草稿（产品列表变更时调用）
restoreOrderDraft(d)       // 恢复草稿到表单
```

## 用户操作流程图

```
[采购订单列表]
    │
    ├── 新建订单 → newOrder()
    ├── 查看详情 → viewOrderDetail()
    ├── 编辑 → goOrderEdit()
    └── 删除 → deleteOrder()

[新建/编辑订单页面]
    │
    ├── 订单头部
    │     ├── 采购商（combo，必填）→ 联系人联动
    │     ├── 项目背景/交货期/状态/备注
    │     └── 草稿自动保存
    │
    ├── 产品明细卡片
    │     ├── 添加产品 (addItem)
    │     │     ├── 选择 BOM → fillSpecFromBOM('m') 自动填属性
    │     │     ├── 填写数量/销售单价
    │     │     └── 保存 → 添加到 _fItems
    │     │
    │     ├── 批量添加 (openOrderBatchAdd)
    │     │     ├── 粘贴 Excel → 解析
    │     │     ├── BOM 自动匹配
    │     │     └── 提交 → 添加到 _fItems
    │     │           └── 未匹配 SKU → 一键添加到 BOM
    │     │
    │     ├── 寻货 (sourceItem)
    │     │     ├── [价格库匹配]
    │     │     │     ├── 勾选供应商 + 分配数量
    │     │     │     └── 提交 → options.push(source:'priceLibrary')
    │     │     │
    │     │     └── [手动录入]
    │     │           ├── 填写供应商/价格/数量
    │     │           ├── 自动创建单位 + 价格库
    │     │           └── options.push(source:'manual')
    │     │
    │     └── 编辑/删除产品项
    │
    └── 保存订单 (saveOrder)
          ├── 新建 → 生成 PO 编号 → DB.orders.push
          └── 编辑 → Object.assign + 深拷贝 items.options
                └── saveDB() → 清除草稿

[订单详情页]
    │
    ├── 查看基本信息
    ├── 产品明细（含供应商分配详情、利润）
    ├── 状态流转
    │     ├── 按 STATUS_FLOW 正向推进
    │     └── 可转为「取消」
    ├── 送货信息 (saveDeliveryInfo)
    │     └── 状态 → 送货中
    └── 从详情页发起寻货 (sourceItemFromDetail)
```

## 与其他模块的数据依赖关系

```
采购订单 (orders)
    │
    ├── 被依赖方
    │     ├── settlements.js：结算按订单聚合 → settleOrders() 读取
    │     │     ├── 收款：按 buyerId 匹配 → 销售总额 orderSales(o)
    │     │     └── 付款：按 options[].supplierId 匹配 → 采购总额
    │     ├── invoices.js：发票按结算关联 → 反向追溯到订单产品明细
    │     ├── dashboard.js：订单统计（数量/总额/状态分布/逾期/利润）
    │     └── settlements.js：删除订单时检查结算/发票引用
    │
    ├── 依赖项
    │     ├── DB.units（采购商 combo → buyerId，手动寻货自动创建单位）
    │     ├── DB.bom（产品项 BOM 引用 → bomSku + fillSpecFromBOM）
    │     ├── DB.prices（寻货价格库匹配 → specMatch + addMatchSupplier）
    │     └── DB.specs（六属性下拉选项）
    │
    └── 深度拷贝说明
          saveOrder 中 items.options 执行深拷贝：
          _fItems.map(it => ({...it, options: (it.options||[]).map(o => ({...o}))}))
          避免 DB 存储对象引用，保证 IndexedDB 结构化克隆后数据一致。
```
*（内容由AI生成，仅供参考）*
