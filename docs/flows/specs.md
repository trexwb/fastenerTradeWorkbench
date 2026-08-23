# 属性规格管理 (Specs) 流程说明文档

## 模块功能概述

属性规格管理模块维护紧固件产品的六维属性体系（类型/标准/直径/材质/硬度/表面处理），为 BOM 管理、报价管理、采购订单等模块提供统一的规格预设值。用户可在此页面增删属性值，系统自动追踪每个属性值在 BOM 中的引用次数。

核心功能：
- **六属性体系**：类型(type)、标准(standard)、直径(diameter)、材质(material)、硬度(hardness)、表面处理(surface)
- **预设值 CRUD**：每个属性下可添加/删除具体值
- **引用统计**：实时显示每个属性值在 BOM（`DB.bom`）中被引用的次数
- **自由输入**：combo 组件支持从预设值中选择或直接输入新值自动添加
- **默认值预设**：系统预置了常用紧固件规格值（DEFAULT_SPECS）

## 核心数据结构

```javascript
// DB.specs — 六属性对象，每个属性对应一个字符串数组
DB.specs = {
  type: ['螺栓', '螺母', '垫圈', ...],
  standard: ['GB/T', 'DIN', 'ISO', ...],
  diameter: ['M3', 'M4', 'M5', ...],
  hardness: ['4.8', '5.8', '6.8', ...],
  surface: ['本色', '镀锌(白)', '镀锌(彩)', ...],
  material: ['304', '316', '316L', ...]
};

// 常量定义（store.js）
const SPEC_FIELDS = ['type','standard','diameter','hardness','surface','material'];
const SPEC_LABELS = {type:'类型', standard:'标准', diameter:'直径', hardness:'硬度', surface:'表面处理', material:'材质'};
```

## 关键函数及调用链

### 视图入口
```
router.js render()
  └── case 'specs': viewSpecs()
        └── 读取 DB.specs → 计算引用计数 → 渲染属性表格
```

### 视图函数
```
viewSpecs()
  ├── 遍历 SPEC_FIELDS 六大属性
  ├── 每个属性渲染一个区块：
  │     ├── 属性名标题 + 值数量标签
  │     ├── 新增输入框（combo 组件，支持搜索+自由输入）
  │     └── 属性值列表
  │           ├── 值名称 + 删除按钮
  │           └── BOM 引用计数（灰色标签）
  └── 绑定 combo 组件（bindView 中完成）
```

### 新增属性值
```
bindView() → combo 绑定
  ├── SPEC_FIELDS.forEach(k → combo(el, ...))
  ├── 选择已有值 → 不重复添加（toast 提示）
  └── 输入新值 → 自动添加到 DB.specs[k]
        ├── DB.specs[k].push(v)
        ├── saveDB()
        └── render() 重新渲染
```

### 删除属性值
```
deleteSpec(field, value)
  ├── DB.specs[field] = DB.specs[field].filter(v => v !== value)
  ├── saveDB()
  └── render()
```

（注意：删除属性值不检查 BOM 引用，已在 BOM 中使用该值的条目不会受影响，因为 BOM 中存储的是字符串值而非引用。）

## 用户操作流程图

```
[属性管理页面]
    │
    ├── 六属性区块（type/standard/diameter/material/hardness/surface）
    │     │
    │     ├── 每个区块：
    │     │     ├── 顶部：属性名 + 值总数标签
    │     │     ├── 新增输入框（combo）
    │     │     │     ├── 输入关键词搜索已有值
    │     │     │     ├── 选中已有值 → 提示已存在，不添加
    │     │     │     └── 输入新值回车 → 自动添加到 DB.specs[k]
    │     │     │           └── saveDB() → render() → toast
    │     │     │
    │     │     └── 值列表（标签式排列）
    │     │           ├── 显示值名称
    │     │           ├── 显示 BOM 引用次数（如 "3 条BOM"）
    │     │           └── 删除按钮（×）
    │     │                 └── 直接删除，不检查引用
    │     │
    │     └── 所有属性块同时可见
    │
    └── 系统默认值
          └── DEFAULT_SPECS 在初始化和数据重置时作为种子数据
```

## 与其他模块的数据依赖关系

```
属性管理 (specs)
    │
    ├── 被依赖方（其他模块读取属性预设值）
    │     ├── bom.js：创建/编辑 BOM 时从 DB.specs[k] 读取下拉选项
    │     ├── prices.js：报价筛选从 DB.specs[k] 读取下拉选项
    │     ├── orders.js：产品编辑弹窗中从 DB.specs[k] 读取下拉选项
    │     └── utils.js：specMatch() 使用 SPEC_FIELDS 做属性匹配
    │
    ├── 依赖项
    │     └── DB.bom（仅用于引用计数展示）
    │
    └── 数据流说明
          ├── 属性管理 新增/删除 → saveDB() → 其他模块 combo 下拉自动刷新
          └── 属性值删除不影响已引用该值的 BOM/报价/订单记录
```

规格管理提供的是"预设值下拉选项"，而非外键约束。各业务模块中 combo 组件的下拉列表均从 `DB.specs[k]` 动态读取，属性管理中的增删会即时反映到所有模块的下拉选项中。
*（内容由AI生成，仅供参考）*
