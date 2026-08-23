# 报价管理 (Prices) 流程说明文档

## 模块功能概述

报价管理模块维护供应商的产品报价信息，是采购寻货环节的核心数据源。每条报价记录关联一个供应商（关联单位）和一个 BOM 条目，并记录价格、有效期、联系人等信息。

核心功能：
- **CRUD 操作**：新建、编辑、删除报价记录
- **草稿自动保存**：表单填写自动缓存 localStorage，中断后可恢复
- **BOM 联动**：选择 BOM 后自动填入六属性（fillSpecFromBOM）
- **供应商匹配**：combo 下拉从关联单位中筛选「供应商」角色
- **重复检查**：同一供应商 + BOM SKU + 规格 + 属性组合不可重复添加
- **批量删除**：勾选后批量删除，支持订单寻源引用检查提示
- **多维筛选**：按供应商 + 六属性 + BOM SKU 多条件联合筛选，支持搜索框关键词搜索
- **局部刷新**：筛选/分页/搜索均触发局部 DOM 刷新，不重渲染整页

## 核心数据结构

报价数据存储在 `DB.prices` 数组中：

```javascript
DB.prices = [
  {
    id: 'PR201',            // 唯一标识（uid('PR') 自动生成）
    unitId: 'U101',         // 供应商 unit.id（引用 DB.units）
    contact: '张三',         // 联系人姓名
    bomSku: 'BOLT-M8-304',  // 关联 BOM 的 SKU（引用 DB.bom）
    spec: 'M8×30 304',      // 规格描述
    type: '螺栓',            // 类型
    standard: 'GB/T',       // 标准
    diameter: 'M8',         // 直径
    hardness: '8.8',        // 硬度
    surface: '镀锌(白)',     // 表面处理
    material: '304',        // 材质
    price: 0.15,            // 采购单价（元/千支）
    validFrom: '2026-01-15', // 有效期起始日期
    remark: '',             // 备注
    source: 'manual',       // 来源：'manual' 手动录入 / 'priceLibrary' 价格库
    createdAt: '2026-01-15' // 创建日期
  }
];
```

### 全局状态变量
```javascript
let _pricePage = 1;   // 当前页码（PAGE_SIZE=20）
```

## 关键函数及调用链

### 视图入口
```
router.js render()
  └── case 'prices': viewPrices()
        ├── filterPricesData()         // 数据层过滤（倒序排列）
        ├── 计算分页 + 取当前页数据
        ├── 渲染工具栏（含搜索框 + 供应商 combo + 六属性 combo）
        ├── 渲染报价表格 tbody + 分页器
        └── bindView() 绑定 combo 组件（pf_unit + 六个 pf_* combo）
```

### 数据层过滤（filterPricesData）
```
filterPricesData()
  ├── 读取搜索框 pf_sku 值（SKU 模糊匹配）
  ├── 读取 pf_unit combo → 按供应商筛选
  ├── 读取六个 pf_* combo → 按六属性筛选（AND 逻辑）
  ├── DB.prices.filter(...)
  └── 返回数组 → 按 validFrom + createdAt 倒序排列

hasPriceFilter()
  └── 判断是否有任意筛选条件生效（搜索框/供应商/六属性）
```

### 渲染层局部刷新（refreshPricesTable）
```
refreshPricesTable()  // 局部刷新，不重渲染整页
  ├── filterPricesData() 取数据
  ├── 分页取 pageData
  ├── 构建 tbody HTML → DOM('#priceBody').innerHTML
  ├── 构建分页器 → DOM('#pricesPaging').innerHTML
  └── 复选框状态不变（保留用户选中状态）
```

### 搜索与筛选操作
```
doPriceSearch()       // 点击搜索图标或回车触发，重置页码并刷新
  ├── 读取 pf_sku 值
  ├── 搜索框高亮切换（has-val class）
  ├── _pricePage = 1
  └── refreshPricesTable()

filterPrices()        // 六属性 combo 变更触发，重置页码并刷新
  └── _pricePage = 1 → refreshPricesTable()

clearPriceFilter()    // 清除全部筛选条件
  ├── 清空 pf_sku 输入框
  ├── 清空六个 pf_* combo
  ├── 清空 pf_unit combo
  ├── _pricePage = 1
  └── refreshPricesTable()

pricePage(n)          // 分页跳转
  └── _pricePage = clamp → refreshPricesTable()
```

### 新增/编辑（抽屉表单）
```
newPrice()
  ├── editingPriceId = null
  ├── checkDraftRestore('price', ...)  // 草稿恢复检测
  │     ├── 有草稿 → confirmModal → restorePriceDraft(d) → 绑定自动保存
  │     └── 无草稿 → 直接打开
  ├── openDrawer('新增报价', priceFormHTML(), savePriceDrawer)
  └── bindPriceFormCombos(null) → 绑定 BOM/属性/供应商 combo
        └── bindDraftSave(panel, collectPriceDraft, 'price') 自动保存草稿

priceFormHTML(p)      // 构建表单 HTML（含 BOM 引用、规格、供应商、属性、单价）
editPrice(id)         // 编辑模式：editingPriceId = id，回填表单，绑定 combo
  ├── openDrawer('编辑报价', priceFormHTML(p), savePriceDrawer)
  └── bindPriceFormCombos(p) + 回填联系人下拉

savePriceDrawer()     // 校验并保存（新建/编辑共用）
  ├── 必填校验：unitId、price > 0
  ├── 收集六属性：SPEC_FIELDS.forEach 读取 ps_* combo
  ├── isPriceDuplicate() → 重复则 toast 阻断
  ├── 新建: DB.prices.push({id: uid('PR'), ...})
  ├── 编辑: Object.assign(rec, {...})
  └── saveDB() → closeDrawer() → render() → toast

isPriceDuplicate(unitId, bomSku, spec, attrs, excludeId?)
  └── 检查 DB.prices 中是否存在相同供应商 + BOM SKU + 规格 + 属性的记录
```

### 删除
```
delPrice(id)
  ├── confirmModal → 确认
  ├── DB.prices = DB.prices.filter(x => x.id !== id)
  └── saveDB() → closeDrawer() → render()

batchDeletePrices()
  ├── 收集 .price-check:checked 的 ID
  ├── 订单寻源引用检查：
  │     ├── 遍历选中报价
  │     ├── 匹配 DB.orders 中引用的订单号
  │     └── 存在引用 → 警告提示"删除后寻源记录将显示为 ID"
  ├── confirmModal → 确认
  ├── DB.prices.filter(...) → saveDB() → render()
```

### 批量操作辅助
```
toggleAllPrices(cb)       // 全选复选框切换
updatePriceBatchBtn()     // 更新批量删除按钮状态（显示/隐藏 + 计数）
```

### 辅助函数
```
specMatch(price, item) — 来自 utils.js
  └── 宽松匹配：item 有值的属性才要求 price 对应属性相等
```

## 用户操作流程图

```
[报价管理列表页]
    │
    ├── 顶部工具栏
    │     ├── 搜索框 (pf_sku) → doPriceSearch()
    │     ├── 供应商 combo (pf_unit) → filterPrices()
    │     ├── 全选复选框 → toggleAllPrices()
    │     ├── 「批量删除」按钮 → batchDeletePrices()
    │     └── 「新增报价」→ newPrice()
    │
    ├── 筛选栏
    │     ├── 六个属性 combo (pf_type/pf_standard/...) → filterPrices()
    │     └── 「清除筛选」→ clearPriceFilter()
    │
    ├── 报价表格（每页20条）
    │     ├── 列：复选框/供应商/联系人/BOM SKU/规格/属性/单价/有效期/操作
    │     ├── 编辑按钮 → editPrice(id)
    │     ├── 删除按钮 → delPrice(id)
    │     └── 复选框 → updatePriceBatchBtn()
    │
    └── 分页器 → pricePage(n)

[新建/编辑报价抽屉]
    │
    ├── 表单字段
    │     ├── BOM 引用 (ps_bom_ref combo)
    │     │     └── 选择 BOM → fillSpecFromBOM('ps') → 自动填入六属性
    │     ├── 规格描述 (ps_spec input)
    │     ├── 供应商 (ps_unit combo，仅显示含"供应商"角色的单位)
    │     ├── 联系人 (ps_contact select，随供应商联动)
    │     ├── 六属性（六个 combo 下拉，from DB.specs[k]）
    │     ├── 采购单价（必填，number input）
    │     ├── 有效期（默认当天日期）
    │     └── 备注
    │
    ├── 草稿自动保存
    │     └── 绑定 bindDraftSave → localStorage 缓存表单状态
    │
    ├── 重复检查 → isPriceDuplicate()
    │     └── 相同供应商 + SKU + 规格 + 属性 → toast 阻断
    │
    └── 保存 → savePriceDrawer()
          └── saveDB() → closeDrawer() → render()
```

## 与其他模块的数据依赖关系

```
报价管理 (prices)
    │
    ├── 被依赖方（其他模块读取报价数据）
    │     ├── orders.js（寻货流程）:
    │     │     ├── buildSourceDrawerBody(idx) → 读取 DB.prices 做 specMatch
    │     │     ├── buildPriceMatchModalBody(idx) → 列出匹配的报价供应商
    │     │     ├── addMatchSupplier() → 从价格库引用报价（source='priceLibrary'）
    │     │     └── manualSupplier() → 手动录入时自动写入价格库（source='manual'）
    │     └── utils.js：specMatch(price, item) 用于订单寻货的属性匹配
    │
    ├── 依赖项
    │     ├── DB.units（供应商下拉选项，读取 roles 含"供应商"的单位）
    │     ├── DB.bom（BOM 下拉选项，fillSpecFromBOM 联动）
    │     └── DB.specs（六属性下拉选项）
    │
    └── 数据流说明
          ├── 报价管理 新增/修改 → saveDB() → 订单寻货界面 specMatch 实时反映
          ├── BOM 变更 → fillSpecFromBOM 联动更新
          └── 供应商单位变更 → combo 下拉自动刷新
```
*（内容由AI生成，仅供参考）*
