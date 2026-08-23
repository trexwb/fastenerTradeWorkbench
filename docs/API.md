# 紧固件贸易工作台 API 文档

> 本文档为 **v1.1.174** 版本的代码 API 参考手册，基于 `src/js/` 目录下各模块的实际代码生成。

---

## 1. 项目概述

### 1.1 架构说明

紧固件贸易工作台是一个**零依赖单页应用（SPA）**，下载后双击 `src/index.html` 即可在浏览器中运行，无需 HTTP 服务器、Node.js、npm 或任何构建步骤。

- **入口**：`src/index.html`（HTML 骨架 + `<script defer>` 加载）
- **无 ES Module / import/export**：所有 JS 文件通过 `<script defer src="js/xxx.js">` 加载，挂载到 `window` 全局作用域
- **无外部依赖**：纯原生 JavaScript，本地化后零网络依赖（SheetJS 导出库本地优先、CDN 兜底）

### 1.2 模块依赖顺序

```
seed.js    → 预置示例数据（DB 初始化）
utils.js   → 工具函数（escHtml/icon/fmt/uid 等）
ui.js      → UI 组件（modal/drawer/combo/toast）
store.js   → IndexedDB 数据层 + File System Access API
exporter.js → Excel 导出引擎（SheetJS，基于 xlsx-js-style fork）
views/     → 各视图页面（dashboard/units/specs/bom/prices/orders/settlements/invoices/data）
router.js  → 路由 + render() + 状态变量
app.js     → initApp() 初始化入口
```

### 1.3 存储体系

| 存储方式 | 用途 | 容量 | 持久性 |
|---------|------|------|--------|
| IndexedDB (`wb_fastener_idb`) | 主数据存储（units/specs/bom/prices/orders/settlements/invoices） | 无限制 | 永久（浏览器内） |
| localStorage | 表单草稿缓存（仅表单草稿，不存业务数据） | ~5MB | 永久（浏览器内） |
| File System Access API | 本地 JSON 文件双向同步 | 无限制 | 永久（用户文件系统） |

---

## 2. 数据模型

### 2.1 DB 全局对象

```javascript
let DB = {
  units:       [],       // 关联单位数组
  specs:       {},       // 属性选项字典 {type:[...], standard:[...], ...}
  bom:         [],       // BOM 物料数组
  prices:      [],       // 报价记录数组
  orders:      [],       // 采购订单数组
  settlements: [],       // 结算记录数组
  invoices:    [],       // 发票记录数组
  seq:         100,      // ID 自增序号计数器
  orderSeq:    1,        // 订单序号计数器（独立于 seq，不受删除影响）
  _savedAt:    Date.now() // 最后保存时间戳（用于文件同步时间戳对比）
};
```

### 2.2 关键实体结构

#### Unit（关联单位）
```javascript
{
  id:       'U1',           // 唯一ID
  name:     '华东机械制造有限公司',
  roles:    ['采购商'],      // 角色：'采购商' / '供应商' / 两者兼有
  term:     '月结30天',     // 账期
  rating:   '主力',          // 评级：主力 / 备选 / 新客
  contacts: [{             // 联系人数组
    name:   '王经理',
    phone:  '138-0001-001',
    side:   '采购商',       // 采购商侧 / 供应商侧
    sides:  ['采购']        // 扩展字段
  }],
  invoice: {               // 开票信息
    taxId:    '',
    address:  '',
    phone:    '',
    bank:     '',
    accountNo:''
  }
}
```

#### Order（采购订单）
```javascript
{
  id:           'PO260805-001',  // 订单号，格式 PO{YYMMDD}-{SEQ}
  buyerId:      'U1',             // 采购商单位ID
  buyerContact: '王经理',
  project:      'A厂区设备改造',
  delivery:     '2026-08-05',    // 交货日期（支持对象 {time, note}）
  status:       '待确认',         // 见 ORDER_STATUSES
  remark:       '',
  createdAt:    '2026-07-28',
  updatedAt:    '2026-07-28',
  items: [                         // 订单行项目数组
    {
      id:    'I1',
      type: '螺栓', standard: 'GB/T', diameter: 'M8',
      hardness: '8.8', surface: '本色', material: '304',
      qty: 5000,                   // 需求量（千支）
      salePrice: 1.20,             // 销售单价（元/千支）
      usage: '设备装配',
      remark: '',
      bomSku: 'SKU001',           // 关联 BOM SKU（可选）
      options: [                   // 寻源选项数组
        {
          id:         'Q1',        // 寻源选项唯一ID
          supplierId: 'U2',        // 供应商ID
          contact:    '李工',
          price:      0.95,       // 采购单价
          allocQty:   3000,        // 分配数量
          stockNote:  '',          // 库存备注
          source:     'priceLibrary', // 来源：priceLibrary / manual
          status:     '已选'       // 寻源状态：已选 / 待确认
        }
      ]
    }
  ]
}
```

#### SourcingOption（寻源选项）
```javascript
{
  id:         'Q1',
  supplierId: 'U2',     // 供应商 ID
  contact:    '李工',    // 联系人
  price:      0.95,     // 采购单价（元/千支）
  allocQty:   3000,     // 分配数量
  stockNote:  '',       // 库存备注
  source:     'priceLibrary', // 来源：priceLibrary / manual
  status:     '已选'    // 寻源状态
}
```

#### Price（报价）
```javascript
{
  id:       'PR1',
  unitId:   'U2',       // 供应商ID
  contact:  '李工',
  type:     '螺栓', standard: 'GB/T', diameter: 'M8',
  hardness: '8.8', surface: '本色', material: '304',
  price:    0.95,        // 单价（元/千支）
  bomSku:   'SKU001',   // BOM 关联 SKU
  spec:     'M8×30',    // 规格文本
  validFrom:'2026-06-01',
  remark:   '',
  createdAt: '2026-07-20'
}
```

#### BOM（BOM 物料）
```javascript
{
  id:    'B001',
  sku:   'SKU001',
  name:  '六角螺栓 M8',
  spec:  'M8×30',
  type: '螺栓', standard: 'GB/T', diameter: 'M8',
  hardness: '8.8', surface: '本色', material: '304'
}
```

#### Settlement（结算）
```javascript
{
  id:      'S001',
  unitId:  'U1',           // 结算对方单位ID
  type:    'receipt',       // 'receipt'（收款）/ 'payment'（付款）
  amount:  12500.00,        // 结算金额
  date:    '2026-08-05',    // 结算日期
  orders:  ['PO260805-001'], // 关联订单ID数组
  remark:  '',
  createdAt: '2026-08-05'
}
```

#### Invoice（发票）
```javascript
{
  id:       'INV001',
  type:     'issue',    // 'issue'（开票）/ 'receive'（收票）
  unitId:   'U1',
  amount:   12500.00,
  taxRate:  13,
  no:       'FP12345678',  // 发票号
  date:     '2026-08-05',
  status:   '已开具',       // issue: 已开具/已红冲; receive: 已收票/已核销
  createdAt: '2026-08-05'
}
```

---

## 3. 核心 API

### 3.1 数据层（store.js）

> 主存储：IndexedDB（`wb_fastener_idb`），突破 localStorage 5MB 限制

#### 初始化
```javascript
/**
 * 应用启动初始化：从 IndexedDB 加载数据 → 补齐字段 → 格式迁移 → 保存 → 渲染 → 恢复文件同步。
 * @returns {Promise<void>}
 */
async function initApp()
```

#### IndexedDB 操作
```javascript
/**
 * 打开主数据 IndexedDB，首次访问时自动建库建表。
 * @returns {Promise<IDBDatabase>}
 * @throws {Error} 数据库被其他连接阻塞时 reject
 */
function idbOpen()

/**
 * 将 DB 对象异步写入 IndexedDB 主存储。
 * @returns {Promise<void>}
 */
async function idbSave()

/**
 * 从 IndexedDB 主存储读取 DB 对象。
 * @returns {Promise<Object|null>}
 */
async function idbLoad()

/**
 * 查询浏览器存储配额与用量。
 * @returns {Promise<{usage:number, quota:number}|null>}
 */
async function storageEstimate()
```

#### 双写保存
```javascript
/**
 * 保存数据到 IndexedDB + 本地文件（双写），同时失效单位/BOM 缓存。
 * @returns {Promise<void>}
 */
function saveDB()

/**
 * 防抖版 saveDB，合并频繁写入。
 * @param {number} [ms=300] 延迟毫秒数
 */
function saveDBDebounced(ms)
```

#### 数据迁移
```javascript
/**
 * 旧数据格式迁移：订单行项扁平字段 → options数组 / 结算补 orders 字段 / 发票补 timestamp 字段 / BOM 补 id。
 * @returns {boolean} 是否发生了迁移
 */
function migrateItems()
```

#### 文件同步（FSA API）
```javascript
/**
 * 检测浏览器是否支持 File System Access API。
 * @returns {boolean}
 */
function fsaSupported()

/**
 * 打开文件句柄持久化用的 IndexedDB，首次访问时自动建库建表。
 * @returns {Promise<IDBDatabase>}
 */
function fhOpen()

async function fhSave(h)   // 将文件句柄持久化到 IndexedDB
async function fhLoad()    // 从 IndexedDB 读取持久化的文件句柄
async function fhDelete()  // 从 IndexedDB 删除文件句柄
async function fhPerm(h, rw) // 检查并请求文件句柄读写权限

/**
 * 弹出系统保存对话框绑定本地 JSON 文件，绑定后数据将双向同步。
 * @returns {Promise<void>}
 * @throws {'AbortError'} 用户取消选择
 */
async function bindFile()

/**
 * 解绑本地文件同步。
 * @returns {Promise<void>}
 */
async function unbindFile()

/**
 * 刷新页面后重新获取文件句柄权限并加载数据。
 * @returns {Promise<void>}
 */
async function reconnectFile()

/**
 * 将 DB 对象写入绑定的本地文件。
 * @returns {Promise<void>}
 */
async function saveToFile()

/**
 * 从本地文件读取数据，基于时间戳对比决定加载方向。
 * @returns {Promise<boolean>} 文件数据被加载返回 true
 */
async function loadFromFile()

/**
 * 页面加载时恢复文件句柄，自动尝试重连并加载数据。
 * @returns {Promise<void>}
 */
async function initFileHandle()

/**
 * 手动触发立即同步到本地文件。
 * @returns {Promise<void>}
 */
async function syncNow()

/**
 * 调用 seed.js 的 _seedData 填充演示数据。
 */
function seedData()
```

---

### 3.2 Excel 导出层（exporter.js）

> 基于 xlsx-js-style fork（SheetJS 0.18.5 样式版），支持单元格样式（边框/背景色/字体），本地 `src/js/vendor/` 优先、CDN 兜底

```javascript
/**
 * 动态加载 SheetJS 脚本，首次调用后缓存。
 * @returns {Promise<void>}
 */
async function loadXLSX()

/**
 * 将工作表对象转换为 Excel 文件并触发浏览器下载。
 * @param {Object} wb   - SheetJS 工作簿对象
 * @param {string} fname - 下载文件名（不含扩展名）
 * @returns {Promise<void>}
 */
function downloadWorkbook(wb, fname)

/**
 * 导出采购订单为 Excel（根据订单状态分发到对应导出模板）。
 * @param {string} orderId - 订单 ID
 * @returns {Promise<void>}
 */
async function exportOrder(orderId)
```

**导出模板分发逻辑**：
| 状态 | 导出函数 |
|------|---------|
| 待确认 | `_exportOrderPendingConfirm` |
| 寻货中 | `_exportOrderSourcing` |
| 待签约 | `_exportOrderPendingSign` |
| 签约完成 | `_exportOrderSignedComplete` |
| 送货中 / 完成 | `_exportOrderDelivering` |
| 其他 | `_exportOrderGeneral` |

**内部辅助函数**：
```javascript
function _autoFitCols(ws, totalCols) // 自动列宽
function _normColor(v)               // 颜色名规范化
function _toStyleObj(style)          // 样式对象转换
function _wc(ws, addr, style, value) // 写单元格（带样式）
function _fillMergeBorders(ws)       // 合并单元格边框修复
```

---

### 3.3 工具层（utils.js）

#### 格式化
```javascript
fmt(n)        // 金额格式化：'¥1,200.00'
fmtN(n)       // 数字千分位：'1,200'
today()       // 当前日期：'YYYY-MM-DD'
now()         // 当前时间：'YYYY-MM-DD HH:mm'
toDate(s)     // 日期字符串 → Date 对象
daysUntil(d)  // 距目标日期天数（向上取整）
```

#### 安全转义
```javascript
/**
 * HTML 转义（防 XSS）。
 * @param {*} s - 待转义值
 * @returns {string}
 */
escHtml(s)

/**
 * HTML 属性值转义。
 * @param {*} s - 待转义值
 * @returns {string}
 */
escAttr(s)
```

#### 单位缓存
```javascript
_buildUnitCache()  // 重建 _unitNameCache（id → {name, rating} 映射）
pName(id)          // 根据单位ID获取名称
pRating(id)        // 根据单位ID获取评级
```

#### 规格工具
```javascript
specLabel(it)          // 规格属性值拼接：'螺栓 · GB/T · M8'
specTags(it)           // 规格属性渲染为 HTML 标签
specMatch(price, item) // 规格宽松匹配（item 已填字段必须一致）
_getBom(sku)           // 根据 SKU 查找 BOM 记录
priceBomSku(p)         // 报价关联的 BOM SKU
priceSpec(p)           // 报价规格描述
priceAttrCol(p)        // 报价属性列 HTML
```

#### 草稿系统
```javascript
const DRAFT_TYPES = {unit:'unit', order:'order', bom:'bom', price:'price'}

saveDraft(type, data)   // 保存草稿到 localStorage
loadDraft(type)          // 读取草稿
clearDraft(type)         // 清除草稿
hasDraft(type)           // 检查草稿存在

collectUnitDraft()     // 收集单位表单草稿
restoreUnitDraft(d)     // 恢复单位草稿
collectOrderDraft()      // 收集订单表单草稿
restoreOrderDraft(d)    // 恢复订单草稿
bindDraftSave()         // 绑定表单自动保存
checkDraftRestore()     // 检测并询问恢复草稿
collectBOMDraft()        // 收集 BOM 草稿
restoreBOMDraft(d)      // 恢复 BOM 草稿
collectPriceDraft()      // 收集报价草稿
restorePriceDraft(d)    // 恢复报价草稿
```

#### 订单计算
```javascript
itemOpts(it)             // 获取已选寻源选项
itemAllocSum(it)         // 已分配数量总计
isItemSourced(it)        // 是否已完成寻源
itemSourcingStatus(it)   // 寻源状态 ['已确认'|'部分寻源'|'待寻源', CSS类]
itemProfit(it)          // 行项目利润（售价-采购价）× 已分配量
orderProfit(o)          // 订单总利润
orderSales(o)           // 订单总销售额
orderCost(o)            // 订单总采购成本
roleBadge(roles)        // 角色徽章 HTML
```

#### 日期判断
```javascript
isOverdue(o)       // 逾期（交期 < 今天 且状态非完成/取消）
isApproaching(o)    // 临期（距交期 0-3 天）
```

#### Toast 提示
```javascript
/**
 * 显示浮动提示。
 * @param {string} text - 提示文案
 * @param {string} [type='info'] - success/error/warning/info
 * @returns {void}
 */
toast(text, type)
```

#### Combo 检索下拉
```javascript
/**
 * 初始化 combo 检索下拉组件。
 * @param {Element} el - combo 容器元素
 * @param {Array} options - 候选选项 [{id, label, tag?}]
 * @param {Function} onSelect - 选中回调
 * @param {string} [placeholder] - 占位文字
 * @param {boolean} [allowCreate=true] - 是否允许输入新建
 */
function combo(el, options, onSelect, placeholder, allowCreate)
comboFilter(input, options)  // 按输入文本过滤选项
getComboVal(id)              // 读取 combo 选中值
```

#### 图标 / ID 生成 / 分页
```javascript
icon(name, size)                          // 获取 SVG 图标 HTML（带缓存）
uid(pref)                                  // 生成唯一ID
buildPaging(total, page, totalPages, fn)  // 分页组件 HTML
```

---

### 3.4 UI 组件层（ui.js）

```javascript
/**
 * 弹出模态对话框。
 * @param {string} title - 标题
 * @param {string|Element} body - 内容
 * @param {string} [okText='确定']
 * @param {Function} [onOk]
 * @param {boolean} [wide]
 */
function modal(title, body, okText, onOk, wide)

function closeModal()  // 关闭模态对话框

/**
 * 弹出确认对话框（含确认/取消按钮）。
 * @param {string} msg - 确认提示文案
 * @param {Function} onOk - 点击确认按钮回调
 * @param {string} [okText='确认操作']
 * @param {string} [cancelText='取消']
 * @param {Function} [onCancel]
 */
function confirmModal(msg, onOk, okText, cancelText, onCancel)

/**
 * 从右侧滑出抽屉面板。
 * @param {string} title - 抽屉标题
 * @param {string} html - 抽屉主体 HTML
 * @param {Function} [onOk] - 保存回调
 * @param {boolean} [wide]
 * @param {boolean} [noFooter]
 */
function openDrawer(title, html, onOk, wide, noFooter)

/** 关闭抽屉（带动画延迟 320ms） */
function closeDrawer()

/** 触发抽屉面板的保存回调 */
function drawerOk()
```

---

### 3.5 路由层（router.js）

#### 路由核心
```javascript
/**
 * 路由切换，更新视图并重新渲染。
 * @param {string} v - 目标视图 key
 */
function go(v)

/** 渲染整个应用界面，包括侧栏、面包屑和内容区 */
function render()

// 视图状态变量
view          // 当前视图 key
curOrder      // 当前编辑中的订单对象
curOrderView  // 当前查看详情的订单ID
_fItems       // 编辑模式下的订单行项目数组
_fMode        // 'edit' | 'new'
_fOrderId     // 当前编辑订单ID
```

#### 导航
```javascript
toggleSidebar()      // 切换侧栏展开/收起
toggleNavParent(k)   // 切换二级导航展开/收起
switchTheme()        // 切换主题（默认 ↔ 奶油白）
```

#### 列表筛选
```javascript
onUnitSearch(v)        // 关联单位搜索 → 刷新列表
onOrderSearch(v)       // 订单搜索 → 刷新列表
onOrderStatusFilter(v) // 订单状态筛选 → 刷新列表
filterUnitsData()       // 【数据层】按角色/评级/关键词筛选
filterOrdersData()     // 【数据层】按状态/关键词筛选（含规格属性+备注搜索）
unitPage(n)            // 单位分页
orderPage(n)           // 订单分页
```

#### 视图跳转
```javascript
goOrderView(id)  // 跳转订单详情
goOrder(id)      // 跳转订单编辑
```

#### 视图事件绑定
```javascript
/**
 * 渲染后绑定 combo/init 事件（每次 render 后自动调用）。
 * @since v1.0
 */
function bindView()
```

---

### 3.6 视图层（views/*.js）

#### 概览（dashboard.js）
```javascript
viewDashboard()         // 渲染概览仪表盘（统计卡片/待办列表/近期订单）
gotoPendingOrders()    // 跳转并弹出今日待办汇总 toast
```

#### 属性管理（specs.js）
```javascript
viewSpecs()              // 属性选项管理主视图
renderSpecGroup(k)      // 渲染单个属性维度管理面板
countSpecUsage(k,v)     // 统计属性值引用次数（BOM 引用）
toggleSpecGroup(k)       // 展开/折叠属性维度
filterSpecVals(k,v)     // 搜索过滤属性值
delSpecVal(k,i)         // 删除属性值（含二次确认）
clearSpecFilter(k)       // 清除筛选条件
openBatchImportSpec(k)  // 批量导入抽屉（单维/全维）
exportAllSpecs()         // 导出全部属性为 CSV
```

#### 报价管理（prices.js）— 已扩展至 18 个函数
```javascript
viewPrices()              // 报价列表视图（含搜索/筛选/分页）
refreshPricesTable()      // 局部刷新报价表格（不重渲染整个页面）
pricePage(n)              // 分页
doPriceSearch()           // 处理搜索输入
filterPrices()            // 【数据层】按供应商/BOM/六属性 AND 过滤
clearPriceFilter()        // 清除所有筛选条件
hasPriceFilter()         // 判断是否设置了筛选条件
newPrice()               // 新建报价（打开抽屉表单）
isPriceDuplicate(...)     // 报价重复检查
editPrice(id)            // 编辑报价
delPrice(id)             // 删除报价（单项）
priceFormHTML(p)         // 报价表单 HTML 构建
bindPriceFormCombos(p)   // 绑定报价表单 combo 组件
savePriceDrawer()        // 保存报价抽屉
toggleAllPrices(cb)      // 全选/取消全选
updatePriceBatchBtn()    // 更新批量操作按钮状态
batchDeletePrices()      // 批量删除报价
```

#### 关联单位（units.js）— 21 个函数
```javascript
viewUnits()               // 关联单位列表
newUnit()                 // 新建单位
editUnit(id)             // 编辑单位
delUnit(id)              // 删除单位
validateAndCollectUnitForm(editingId) // 收集+校验单位表单
unitForm(p)              // 单位表单 HTML
toggleInvoiceSection(el)  // 展开/折叠开票信息区块
contactRow(c,i)           // 联系人行 HTML
addCRow()                 // 添加联系人行
delCRow(btn)             // 删除联系人行
updateContactSides()      // 更新联系人的 side 字段
readContacts()            // 读取联系人数据
contactOpts(pid, side)    // 联系人选项
toggleAllUnits(cb)        // 全选/取消全选
updateUnitBatchBtn()       // 更新批量操作按钮
batchDeleteUnits()        // 批量删除单位
```

#### BOM管理（bom.js）— 22 个函数
```javascript
viewBOM()                 // BOM 列表视图
openBOMForm(idx)          // 打开 BOM 表单
_openBOMDrawer(b, idx)    // BOM 表单抽屉构建
bomValidateField(fld)     // BOM 字段校验
toggleBOMSpecsSection(el) // 展开/折叠规格属性区
saveBOMForm(idx)          // 保存 BOM
deleteBOM(idx)            // 删除 BOM
confirmBOMDel(idx)        // 删除确认
openBOMBatchAdd()         // 批量添加 BOM
parseBOMBatch()           // 解析 Excel 粘贴的 BOM 数据
removeBatchRow(idx)       // 移除批量添加行
submitBOMBatch()          // 提交批量 BOM
fillSpecFromBOM(prefix)  // 选择 BOM 后自动填六属性到表单
toggleAllBOM(cb)          // 全选/取消全选
updateBOMBatchBtn()        // 更新批量操作按钮
batchDeleteBOM()          // 批量删除 BOM
```

#### 采购订单（orders.js）— 72 个函数（核心模块）

**列表视图**：
```javascript
viewOrders()              // 订单列表视图
refreshOrderList()         // 局部刷新订单列表
fmtDelivery(d)            // 格式化交货日期（兼容对象/字符串）
renderOrderRow(o)         // 订单行渲染
renderOrderEmptyRow()     // 空状态行
toggleAllOrders(cb)       // 全选/取消全选
updateOrderBatchBtn()     // 更新批量按钮
batchDeleteOrders()       // 批量删除（含关联检查）
```

**新建/编辑**：
```javascript
newOrder()                // 新建订单入口
goOrderEdit(id)           // 跳转订单编辑
viewOrderEdit()           // 订单编辑/新建表单视图
addItem()                 // 添加产品项
editItem(i)              // 编辑产品项
delItem(i)               // 删除产品项
openItemModal(idx)        // 打开产品项表单抽屉
saveItemModal()           // 保存产品项
```

**寻货流程**：
```javascript
sourceItem(idx)            // 打开寻货抽屉（入口）
sourceItemFromDetail(idx)  // 从订单详情页发起寻货
buildSourceDrawerBody(idx) // 构建寻货抽屉内容
buildPriceMatchModalBody(idx, q) // 价格库匹配弹窗内容
openPriceMatchModal(idx)  // 打开价格库匹配弹窗
submitPriceMatch(idx)     // 提交价格库匹配
filterPriceMatch(idx, q)  // 过滤价格库匹配结果
buildManualSupplierModalBody(idx) // 手动录入供应商弹窗
openManualSupplierModal(idx) // 打开手动录入弹窗
initSourceModalCombo()    // 初始化寻货抽屉 combo
refreshSourceDrawer(idx)  // 刷新寻货抽屉
addMatchSupplier(idx, priceId, q) // 从价格库添加供应商
manualSupplier(idx)       // 手动录入供应商
removeOption(idx, optId)  // 移除已选供应商
```

**批量操作**：
```javascript
openOrderBatchAdd()       // 打开批量添加产品抽屉
parseOrderBatch()         // 解析 Excel 粘贴数据
removeOrderBatchRow(idx)  // 移除批量行
submitOrderBatch()        // 提交批量产品
```

**供应商报价导入**（新增）：
```javascript
quoteSupplierComboOptions()           // 供应商报价 combo 选项
openSupplierQuoteImport()            // 打开供应商报价导入抽屉
parseSupplierQuote()                 // 解析供应商报价文件
renderSupplierQuotePreview()         // 渲染报价预览
initQuoteSupplierCombos()            // 初始化供应商报价 combo
removeQuoteRow(idx)                 // 移除报价行
findQuoteItemIndex(items, r)        // 查找报价项索引
submitSupplierQuote()                // 提交供应商报价
openGenerateQuote()                 // 打开生成报价弹窗
saveGeneratedQuote()                 // 保存生成的报价
```

**收货/验货管理**（新增）：
```javascript
receiveManageSection(o, locked)     // 收货管理区块
updateReceiveField(optId, field, v) // 更新收货字段
renderInspectionSection(o)          // 验货区块
confirmOrderComplete(id)           // 确认订单完成
```

**状态流转**：
```javascript
changeOrderStatus(id, status)        // 变更订单状态
nextStepButton(o) / nextStepStartSourcing(id)
nextStepFinishSourcing(id)           // 完成寻货
nextStepConfirmSign(id)              // 确认签约
nextStepEnterDelivery(id)            // 进入送货
prevStepButton(o)                   // 后退按钮
prevStepOrder(id, target)           // 后退到指定状态
cancelOrderConfirm(id)              // 取消订单
```

**送货信息**：
```javascript
saveDeliveryInfo(id)                // 保存送货信息 → 状态流转
enterEditDelivery(id)               // 编辑送货信息
cancelEditDelivery(id)             // 取消编辑送货信息
```

**保存**：
```javascript
async saveOrder()                  // 保存订单（新建/编辑）
persistOrderItems()                // 持久化产品明细到 _fItems
saveOrderDraftFromItems()          // 保存草稿
bindOrderDraftSave()              // 绑定草稿自动保存
renderItemHTML()                  // 产品行 HTML 渲染
refreshProductList()              // 刷新产品列表
toggleOrderItemDropdown(e)        // 产品行下拉展开/收起
closeOrderItemDropdown()          // 关闭下拉
contactTooltip(supplierId)        // 供应商联系人提示
deleteOrder(id)                   // 删除订单
```

#### 结算管理（settlements.js）— 20 个函数
```javascript
viewSettlements(type)           // 收款/付款列表视图
drillSettleTab(sub)             // 钻取结算子标签
switchSettleSubTab(sub)         // 切换未结/已结子标签
onSettleUnitFilter(val)         // 单位筛选
onSettleSearch(v)              // 搜索
settlePage(n)                  // 分页
settleProductRows(unitId, type) // 结算产品明细行
openSettleDetail(unitId, tabType) // 打开结算详情抽屉
delSettlement(id)               // 删除结算
openNewSettlement(presetUnitId, type) // 新建结算
onSettleTypeChange()           // 结算类型变更
refreshSettleOrderList()       // 刷新结算关联订单列表
autoSumSettleAmount()         // 自动汇总结算金额
submitSettlement()            // 提交结算
toggleDrawerSection(hd)        // 展开/折叠抽屉内的区块
```

#### 发票管理（invoices.js）— 9 个函数
```javascript
syncInvoices()               // 同步发票数据（从结算聚合）
invoiceIssueData()           // 开票数据
invoiceReceiveData()         // 收票数据
viewInvoices(type)           // 开票/收票列表（type: 'issue'/'receive'）
switchInvSubTab(sub)         // 切换未结/已结子标签
onInvUnitFilter(val)        // 单位筛选
onInvSearch(v)              // 搜索
invPage(n)                  // 分页
openInvEdit(invId)          // 打开发票编辑抽屉
```

#### 数据管理（data.js）— 8 个函数（新增）
```javascript
viewData()                   // 数据管理主视图
renderStorageStatus(sizeStr)  // 存储状态卡片
renderBackupSection()        // 备份区块（JSON 导出）
renderFileSyncSection()      // 文件同步状态区块
renderDangerZone()          // 危险操作区块（清空数据）
exportJSON(event)           // JSON 导出
importJSON(event)           // JSON 导入
clearAllData()              // 清空所有数据
```

---

## 4. 存储体系详解

### 4.1 IndexedDB（主存储）

**数据库名**：`wb_fastener_idb`  
**Store 名**：`data`  
**数据键**：`DB` 全局对象（JSON）

```javascript
idbSave()   // 异步写入 IndexedDB
idbLoad()   // 异步读取
saveDB()    // 防抖版：合并频繁写入，默认延迟 300ms
```

### 4.2 localStorage（仅表单草稿）

**前缀**：`wb_fastener_draft_`  
**用途**：表单填写中途退出时的数据恢复  
**草稿类型**：`unit` | `order` | `bom` | `price`

```javascript
saveDraft(type, data)   // 保存草稿
loadDraft(type)         // 读取草稿
clearDraft(type)         // 清除草稿
hasDraft(type)          // 检查草稿存在
```

### 4.3 File System Access API（本地文件同步）

**适用浏览器**：Chrome / Edge（桌面版）  
**绑定方式**：用户手动选择本地 JSON 文件路径  
**同步策略**：基于 `_savedAt` 时间戳对比，**最新数据优先**写入文件  
**文件句柄持久化**：IndexedDB 独立库 `wb_fastener_fh`

```javascript
bindFile()       // 弹出保存对话框绑定文件
unbindFile()     // 解绑
reconnectFile()  // 刷新后重连授权
saveToFile()     // 写入文件
loadFromFile()   // 读取文件（时间戳对比后决定加载方向）
syncNow()        // 手动触发同步
```

---

## 5. 事件流图

### 5.1 寻货操作数据流

```
用户点击「寻货」
  → sourceItem(idx) 弹窗
    → 从价格库 DB.prices 中 specMatch 匹配
    → 按供应商分组渲染可选列表（排除已添加）
  → 用户选择
    ├─ [价格库匹配] → addMatchSupplier() → source='priceLibrary'
    └─ [手动录入]   → manualSupplier()   → source='manual'
       → _fItems[idx].options 更新
       → saveOrderDraftFromItems() + persistOrderItems() + saveDB()
       → refreshProductList() 刷新列表
```

### 5.2 订单编辑保存数据流

```
用户修改表单字段
  → 自动触发 DOM input/change 事件
    → bindDraftSave() → collectOrderDraft() → saveDraft() → localStorage
  → 产品明细变更
    → refreshProductList() → persistOrderItems() → saveDB() → IndexedDB
  → 点击「保存订单」
    → saveOrderDraftFromItems() → 更新订单元信息 → saveDB()
```

### 5.3 草稿恢复数据流

```
页面加载 → initApp() → render()
  → checkDraftRestore('order', restoreOrderDraft, openOrderEdit, '采购订单')
    → 检测到草稿 → confirmModal 询问
      → 恢复：restoreOrderDraft() → 回填表单
      → 放弃：clearDraft() → 清空草稿
```

### 5.4 文件同步数据流

```
页面加载
  → initFileHandle() → fhLoad() 恢复文件句柄
    → 检查权限
      → 已授权：loadFromFile() → 时间戳对比 → 加载最新数据 → render()
      → 未授权：fileSync='pending' → 显示「待授权」标签
  → 用户点击「重新授权」→ reconnectFile()

运行中 saveDB()
  → idbSave() 写入 IndexedDB（主存储）
  → fileSync==='pending'？→ saveToFile() 写入本地文件
    → 写入失败 → fileSync='pending' → toast 提示
```

### 5.5 订单导出数据流（新增）

```
用户点击「导出」
  → exportOrder(orderId)
    → loadXLSX() 动态加载 SheetJS（本地优先/CDN兜底）
    → 按订单状态分发到对应导出函数
      → buildOrderSheet() 构建工作表
      → _autoFitCols() 自动列宽
      → downloadWorkbook(wb, fname)
        → showSaveFilePicker（Chrome 86+，file:// 也支持）
          → 用户选位置 → 直接写入文件
          → 失败/取消 → 回退 <a download> 传统方式
```

---

## 6. 版本变更记录

| 版本 | 日期 | 更新内容 | 编辑人 |
|------|------|---------|--------|
| v1.1.1 | — | 项目初始化 | — |
| v1.1.100 | — | 持续迭代 | — |
| v1.1.124 | 2026-08-12 | 批量补充 JSDoc 注释（core 模块） | Agent |
| **v1.1.174** | **2026-08-16** | **全面更新文档**：新增 exporter.js / data.js 模块；orders.js 扩展至 72 函数（供应商报价导入/收货管理/验货）；prices.js 扩展至 18 函数；更新所有 flow 文档；API.md 全面重写 | Agent |

---

## 附录：SPEC_FIELDS 与 SPEC_LABELS

```javascript
const SPEC_FIELDS = ['type','standard','diameter','hardness','surface','material'];
const SPEC_LABELS = {
  type:     '类型',
  standard: '标准',
  diameter: '直径',
  hardness: '硬度',
  surface:  '表面处理',
  material: '材质'
};
```

## 附录：ORDER_STATUSES

```javascript
['待确认','寻货中','待签约','签约完成','送货中','异常','完成','取消']
```
