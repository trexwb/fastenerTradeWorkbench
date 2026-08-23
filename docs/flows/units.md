# 关联单位管理 (Units) 流程说明文档

## 模块功能概述

关联单位管理模块负责维护所有业务往来单位（采购商、供应商或双角色单位）的基础档案信息。它是其他业务模块（报价、订单、结算、发票）的基础数据源。

核心功能：
- **CRUD 操作**：新建、编辑、删除关联单位
- **局部刷新**：筛选/搜索/分页均触发局部 DOM 刷新，不重渲染整页
- **角色筛选 Tab**：全部 / 采购商 / 供应商 / 双角色，支持计数
- **评级筛选 Tab**：全部 / 主力 / 备选 / 新客
- **联系人管理**：每个单位支持多条联系人，含姓名、电话、微信号、供应/采购方向
- **发票信息**：单位可维护发票抬头信息（税号、地址、电话、开户行、账号），支持折叠
- **方向自动禁用**：根据单位角色（采购商/供应商）自动禁用不符合的联系人方向复选框
- **批量删除**：勾选多条单位后批量删除，支持订单/报价引用检查提示
- **草稿恢复**：表单填写中断后可通过 localStorage 草稿恢复

## 核心数据结构

关联单位存储在 `DB.units` 数组中，每条记录结构如下：

```javascript
{
  id: 'U101',              // 唯一标识（uid('U') 自动生成）
  name: 'XXX紧固件公司',    // 单位名称
  roles: ['采购商', '供应商'], // 角色数组
  sides: ['采购', '供应'],   // 业务方向
  term: '月结30天',         // 结算方式
  rating: '主力',           // 评级：主力/备选/新客
  contacts: [               // 联系人列表
    {
      name: '张三',
      phone: '13800138000',
      wechat: '',           // 微信号（新增字段）
      side: '采购商',        // 方向（单值，旧数据兼容）
      sides: ['采购']        // 方向（多值，新数据）
    }
  ],
  invoice: {                // 发票抬头信息
    taxId: '911101...',
    address: '北京市朝阳区...',
    phone: '010-12345678',
    bank: '中国银行...',
    accountNo: '6222...'
  }
}
```

## 关键函数及调用链

### 视图入口
```
router.js render()
  └── case 'units': viewUnits()
        ├── unitCounts()              // 统计各角色/评级数量
        ├── filterUnitsData()         // 数据层筛选（内部函数）
        ├── 分页 → pageData
        ├── 渲染：搜索框 + 角色/评级 Tab + 统计行 + 单位表格 + 分页器
        └── 无需 bindView（内部无 combo 绑定）
```

### 列表与筛选（局部刷新）
```
filterUnitsData()           // 内部数据层函数（不在全局作用域暴露）
  ├── _unitRoleFilter: ''/'采购商'/'供应商'/'双角色'
  ├── _unitRatingFilter: ''/'主力'/'备选'/'新客'
  ├── unitSearch: 模糊匹配名称/联系人
  └── 返回筛选后数组

refreshUnitList()           // 局部刷新（不重渲染整页）
  ├── filterUnitsData() 取数据
  ├── 分页取 pageData
  ├── 构建 tbody → DOM('#unitBody').innerHTML
  ├── 构建分页器 → DOM('#unitPaging').innerHTML
  ├── 更新计数标签 #unitCountTag
  └── refreshUnitTabs() 同步 Tab 激活状态

setUnitRoleFilter(v)        → _unitRoleFilter = v → refreshUnitList() + refreshUnitTabs()
setUnitRatingFilter(v)      → _unitRatingFilter = v → refreshUnitList() + refreshUnitTabs()
refreshUnitTabs()           // 同步筛选 Tab 的 .active 状态到 DOM

onUnitSearch(v)             // 搜索（绑定在搜索框 onkeydown + 搜索图标 onclick）
  ├── unitSearch = v → 搜索框高亮切换
  ├── _unitPage = 1
  └── refreshUnitList()

unitPage(n)                 // 分页（由 buildPaging 生成的分页链接调用）
  └── _unitPage = clamp → refreshUnitList()
```

### 新增/编辑（抽屉式表单）
```
newUnit()
  ├── editingUnitId = null（注意：新建用独立 onSave 闭包，不设全局变量）
  ├── checkDraftRestore('unit', ...)  // 草稿恢复检测
  │     ├── 有草稿 → confirmModal → restoreUnitDraft(d)
  │     └── 无草稿 → 直接打开
  ├── openDrawer('新建关联单位', unitForm(null), onSave)
  ├── updateContactSides() // 根据默认角色禁用方向复选框
  └── bindDraftSave(panel, collectUnitDraft, 'unit') 自动保存草稿

editUnit(id)                // 编辑模式
  ├── 从 DB.units 查找
  ├── openDrawer('编辑关联单位', unitForm(p), onSave)
  └── bindDraftSave(panel, collectUnitDraft, 'unit') + updateContactSides()

unitForm(p)                 // 构建表单 HTML
  ├── 基本信息区：名称 / 角色（role-opt on/off）/ 评级 / 结算账期
  ├── 发票信息区：税号 / 电话 / 开户银行 / 账号 / 地址（折叠）
  ├── 联系人区：联系人行列表 + 添加按钮
  └── toggleInvoiceSection(el) → 折叠/展开发票区域

validateAndCollectUnitForm(editingId)  // 验证并收集表单数据
  ├── 名称非空检查
  ├── 角色至少选一个
  ├── 读取联系人（readContacts）
  └── 返回 {data} 或 {error}

saveUnit/onSave（闭包内）
  ├── validateAndCollectUnitForm()
  ├── 新建: DB.units.push({id: uid('U'), ...})
  ├── 编辑: Object.assign(p, data)
  └── clearDraft('unit') → saveDB() → closeDrawer() → render() → toast

deleteUnit(id)              // 删除（含引用检查提示）
  ├── 检查 DB.orders 和 DB.prices 是否引用该单位
  ├── confirmModal → 确认
  ├── DB.units = DB.units.filter(...)
  └── saveDB() → closeModal() → render()
```

### 联系人管理
```
contactRow(c, i)            // 渲染单条联系人行（姓名/电话/微信号/供应复选框/采购复选框）
addCRow()                   // 追加一行空白联系人行
delCRow(btn)                // 删除指定联系人行

updateContactSides()        // 根据单位角色自动禁用方向复选框
  ├── 若无供应商角色 → 禁用所有"供应"复选框
  ├── 若无采购商角色 → 禁用所有"采购"复选框
  └── 禁用时自动取消勾选

readContacts()              // 从 DOM 读取所有联系人行数据
  ├── 遍历 #contactsBox 中所有 [data-c="name"]
  ├── 读取姓名/电话/微信/方向（sides 数组）
  └── 返回 contacts 数组，过滤空姓名行

contactOpts(pid, side)      // 生成联系人 option HTML（用于其他模块下拉）
  ├── 根据 pid 找到单位
  ├── 按 side 过滤联系人（供应商→'供应'，采购商→'采购'）
  └── 返回 <option> 列表
```

### 批量操作
```
toggleAllUnits(cb)          // 全选复选框切换
updateUnitBatchBtn()        // 更新批量删除按钮状态
batchDeleteUnits()
  ├── 收集勾选 ID（.unit-check:checked）
  ├── 逐一检查关联引用（订单/报价）
  │     ├── 订单引用：buyerId 匹配 + options[].supplierId 匹配
  │     └── 报价引用：unitId 匹配
  ├── 引用检查聚合后警告提示
  ├── confirmModal → 确认
  └── DB.units 批量过滤 → saveDB() → render()
```

### 草稿系统
```
collectUnitDraft()      // 收集表单当前状态 → saveDraft('unit',...)
restoreUnitDraft(d)     // 恢复草稿到表单
bindDraftSave(container, collectUnitDraft, 'unit') // 绑定 input/change 自动保存
```

## 用户操作流程图

```
[关联单位列表页]
    │
    ├── 顶部工具栏
    │     ├── 搜索框 → onUnitSearch(v) → 实时局部刷新
    │     ├── 计数标签（当前筛选匹配数 / 总数）
    │     ├── 「批量删除」按钮 → batchDeleteUnits()
    │     └── 「新建关联单位」→ newUnit()
    │
    ├── 角色筛选 Tab
    │     └── 全部(n) / 采购商(n) / 供应商(n) / 双角色(n)
    │
    ├── 评级筛选 Tab（同一行）
    │     └── 全部 / 主力 / 备选 / 新客
    │
    ├── 统计行（按全部数据统计，不受筛选影响）
    │     └── 全部 n 家 · 采购商 n 家 · 供应商 n 家 · 无联系人 n 家
    │
    ├── 单位列表（表格，局部刷新）
    │     ├── 列：复选框/名称/角色/结算账期/评级/联系人/操作
    │     ├── 编辑按钮 → editUnit(id)
    │     ├── 删除按钮 → deleteUnit(id)
    │     └── 复选框（批量删除）
    │
    └── 分页器（局部刷新）→ unitPage(n)

[新建/编辑关联单位抽屉]
    │
    ├── 基本信息区
    │     ├── 单位名称（必填）
    │     ├── 角色（采购商/供应商，可多选）→ updateContactSides()
    │     ├── 合作评级（下拉）
    │     └── 结算账期（下拉）
    │
    ├── 发票信息区（折叠）
    │     ├── toggleInvoiceSection(el) 展开/收起
    │     └── 税号/电话/开户银行/账号/地址
    │
    ├── 联系人区
    │     ├── 每行：姓名/电话/微信号/供应☑/采购☑/删除按钮
    │     ├── 添加联系人 → addCRow()
    │     └── updateContactSides() 根据角色禁用方向
    │
    ├── 草稿自动保存
    │     └── bindDraftSave → localStorage 缓存
    │
    └── 保存 → validateAndCollectUnitForm() → saveDB()
```

## 与其他模块的数据依赖关系

```
关联单位 (units)
    │
    ├── 被依赖方（其他模块引用单位数据）
    │     ├── orders.js：采购商选择 → buyerId 引用 unit.id
    │     ├── prices.js：供应商选择 → unitId 引用，rating 展示
    │     ├── settlements.js：收款/付款单位 → unitId 引用
    │     ├── invoices.js：开票/收票单位 → unitId 引用
    │     └── orders.js（寻货）：手动录入时自动创建/扩展单位
    │
    └── 依赖项
          └── 无依赖（关联单位是基础数据层，不依赖其他模块）
```

关联单位删除/修改时会触发下游模块的关联检查：订单、报价、结算、发票中引用该单位的数据会成为"失配"状态（不会自动清理），系统会提示用户但允许继续操作。
*（内容由AI生成，仅供参考）*
