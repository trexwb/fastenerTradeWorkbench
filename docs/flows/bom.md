# BOM 管理 (BOM) 流程说明文档

## 模块功能概述

BOM（物料清单）管理模块是产品的标准档案库，存储每种产品的 SKU、名称、规格属性和型号信息。BOM 是报价管理和采购订单的"产品字典"，其他模块通过 SKU 引用 BOM 来获取产品属性。

核心功能：
- **CRUD 操作**：新建、编辑、删除 BOM 条目
- **六属性规格**：每个 BOM 条目关联 type/standard/diameter/hardness/surface/material 六个属性
- **局部刷新**：筛选/搜索/分页均触发局部 DOM 刷新，不重渲染整页
- **fillSpecFromBOM 联动**：在报价、订单等模块中，选择 BOM 后自动填充六属性到表单
- **批量操作**：支持从 Excel 粘贴批量导入；支持勾选后批量删除（含引用检查提示）
- **SKU 唯一性**：sku 作为 BOM 的主键标识，新建时重复检查
- **BOM 匹配查询**：`_getBom(sku)` 通过内存缓存快速查找

## 核心数据结构

BOM 数据存储在 `DB.bom` 数组中：

```javascript
DB.bom = [
  {
    id: 'B101',            // 唯一标识（uid('B') 自动生成）
    sku: 'BOLT-M8-304',    // SKU 编码（唯一标识）
    name: 'M8 304螺栓',    // 产品名称
    spec: 'M8×30 304',     // 规格描述
    type: '螺栓',           // 类型
    standard: 'GB/T',      // 标准
    diameter: 'M8',        // 直径
    hardness: '8.8',       // 硬度
    surface: '镀锌(白)',    // 表面处理
    material: '304'        // 材质
  }
];
```

### BOM 缓存
```javascript
// utils.js
let _bomCache = null;
function _getBom(sku) {
  if (!_bomCache) { _bomCache = new Map(); DB.bom.forEach(b => _bomCache.set(b.sku, b)); }
  return _bomCache.get(sku);
}
// 缓存失效：saveDB() 中 _bomCache = null
```

## 关键函数及调用链

### 视图入口
```
router.js render()
  └── case 'bom': viewBOM()
        ├── filterBOMData()          // 数据层过滤
        ├── 分页 → pageData
        ├── 渲染：搜索框 + 六属性 combo + BOM 表格 + 分页器
        └── bindView() 绑定 combo 组件
```

### 数据层过滤（filterBOMData）
```
filterBOMData()
  ├── 读取搜索框 bf_sku 值（SKU/name/spec 模糊匹配，AND 逻辑）
  ├── 读取六个 bf_* combo → 按六属性筛选（AND 逻辑）
  ├── DB.bom.filter(...)
  └── 返回匹配数组

hasBOMFilter()
  └── 判断是否有任意筛选条件生效
```

### 渲染层局部刷新（refreshBOMTable）
```
refreshBOMTable()  // 局部刷新，不重渲染整页
  ├── filterBOMData() 取数据
  ├── 分页取 pageData
  ├── 构建 tbody HTML → DOM('#bomBody').innerHTML
  ├── 构建分页器 → DOM('#bomPaging').innerHTML
  └── 复选框状态保留
```

### 搜索与筛选操作
```
onBOMSearch(v)         // 点击搜索或回车触发，重置页码并刷新
  ├── 搜索框高亮切换
  ├── _bomPage = 1
  └── refreshBOMTable()

clearBOMFilter()       // 清除全部筛选条件
  ├── 清空 bf_sku 和六个 bf_* combo
  ├── _bomPage = 1
  └── refreshBOMTable()

bomPage(n)             // 分页跳转
  └── _bomPage = clamp → refreshBOMTable()
```

### 新增/编辑（抽屉表单）
```
openBOMForm(idx?)
  ├── 新建模式: _bomEditIdx=null，空表单
  ├── 编辑模式: 从 DB.bom 查找，回填表单
  ├── _openBOMDrawer(b, idx)
  │     ├── openDrawer('新建/编辑 BOM', bodyHTML, saveBOMForm)
  │     ├── 绑定六属性 combo（from DB.specs[k]）
  │     └── fillSpecFromBOM('bf') 编辑时自动预填
  └── bomValidateField(fld) → 实时字段校验

_openBOMDrawer(b, idx) // 内部：构建并打开 BOM 表单抽屉
saveBOMForm(idx)       // 校验并保存（新建/编辑共用）
  ├── bomValidateField() 逐字段校验
  ├── 新建: DB.bom.push({id: uid('B'), ...})
  ├── 编辑: Object.assign(existing, ...)
  └── saveDB() → closeDrawer() → render() → toast

bomValidateField(fld)  // 单字段实时校验（sku 唯一性等）
toggleBOMSpecsSection(el) // 折叠/展开规格属性区域

deleteBOM(idx)         // alias → confirmBOMDel(idx)
confirmBOMDel(idx)     // 确认后删除（含引用检查）
  ├── 检查 DB.prices 和 DB.orders 是否引用该 SKU
  └── DB.bom.splice(idx, 1) → saveDB() → render()
```

### 批量导入（Excel 粘贴）
```
openBOMBatchAdd()
  ├── 打开抽屉，提供 textarea 粘贴区域
  └── parseBOMBatch(text) → 解析并预览
        ├── 按换行分行，按 Tab 分列
        ├── 首行检测：包含关键词（序号/名称/SKU/规格）则跳过
        ├── 逐行解析：sku(必填)/name/spec/type/standard/diameter/hardness/surface/material
        ├── SKU 为空的行跳过
        └── 返回预览数组（含解析状态标记）

removeBatchRow(idx)    // 预览时逐行删除
submitBOMBatch(rows)   // 提交批量导入
  ├── 过滤已存在 SKU
  ├── DB.bom.push(...) 批量写入
  └── saveDB() → closeDrawer() → render() → toast
```

### 批量删除
```
toggleAllBOM(cb)       // 全选复选框切换
updateBOMBatchBtn()    // 更新批量删除按钮状态
batchDeleteBOM()
  ├── 收集勾选 ID
  ├── 关联检查：价格库、订单中是否有引用该 SKU
  ├── confirmModal → 确认
  └── DB.bom.filter(...) → saveDB() → render()
```

### fillSpecFromBOM 联动
```
fillSpecFromBOM(bomPrefix)
  ├── 根据 prefix（如 'bf_'、'pf_'、'm_'）定位表单元素
  ├── 读取对应 bom combo 的选中值 → sku
  ├── _getBom(sku) 获取 BOM 条目
  └── 将 BOM 的六个属性值自动填入对应的 combo 输入框
        ├── type/standard/diameter/hardness/surface/material
        └── 同时填入 sku 和 spec 字段
```

## 用户操作流程图

```
[BOM 管理列表页]
    │
    ├── 顶部工具栏
    │     ├── 搜索框 → onBOMSearch(v)
    │     ├── 角色/状态操作按钮
    │     ├── 全选复选框 → toggleAllBOM()
    │     ├── 批量删除按钮 → batchDeleteBOM()
    │     ├── 批量导入 → openBOMBatchAdd()
    │     └── 新增 BOM → openBOMForm()
    │
    ├── 筛选栏
    │     └── 六属性 combo（bf_type/bf_standard/...）→ 局部刷新
    │
    ├── BOM 表格（每页20条）
    │     ├── 列：SKU/名称/规格/类型/标准/直径/材质/硬度/表面处理/操作
    │     ├── 编辑按钮 → openBOMForm(idx)
    │     ├── 删除按钮 → deleteBOM(idx)
    │     └── 复选框（批量删除）
    │
    └── 分页器 → bomPage(n)

[新建/编辑 BOM 抽屉]
    │
    ├── 表单字段
    │     ├── SKU（必填，唯一标识，新建时重复检查）
    │     ├── 名称 / 规格描述
    │     ├── 六属性（combo 下拉，从 DB.specs[k] 读取）
    │     └── 折叠区：型号
    │
    ├── fillSpecFromBOM('bf') 联动
    │     └── 选择 BOM 引用后自动填入六属性（编辑模式）
    │
    └── 保存 → saveBOMForm()
          ├── 字段校验 bomValidateField
          ├── 新建/编辑分支
          └── saveDB() → closeDrawer() → render()

[批量导入抽屉]
    │
    ├── textarea 粘贴区
    │     └── 粘贴 Excel 数据 → parseBOMBatch() → 预览表格
    │
    ├── 预览表格
    │     ├── 每行：编号/SKU/名称/规格/属性/状态
    │     └── 可逐行删除 → removeBatchRow()
    │
    └── 提交 → submitBOMBatch() → saveDB()
```

## 与其他模块的数据依赖关系

```
BOM 管理 (bom)
    │
    ├── 被依赖方（其他模块引用 BOM 数据）
    │     ├── prices.js：报价关联 BOM → bomSku 引用
    │     │     ├── 创建报价时选择 BOM 后 fillSpecFromBOM('pf') 自动填属性
    │     │     └── 报价列表显示 bomSku 对应的 SKU
    │     ├── orders.js：产品项关联 BOM → bomSku 引用
    │     │     ├── 添加产品时选择 BOM → fillSpecFromBOM('m') 自动填属性
    │     │     ├── 批量添加时自动匹配 BOM → bomMatched 标记
    │     │     └── 未匹配的 SKU 可一键添加到 BOM 库
    │     └── utils.js：_getBom(sku) 缓存查询，specMatch() 属性匹配
    │
    ├── 依赖项
    │     └── DB.specs（六属性下拉选项来源）
    │
    └── 数据流说明
          ├── BOM 新增/修改 → saveDB() → _bomCache 失效
          ├── 其他模块通过 _getBom(sku) 缓存读取最新 BOM 数据
          └── BOM 删除：检查价格库/订单引用，提示用户但允许删除
```
*（内容由AI生成，仅供参考）*
