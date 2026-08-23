# 数据管理 (Data) 流程说明文档

## 模块功能概述

数据管理模块是整个系统的数据持久化中枢，负责数据存储、备份恢复、文件同步等核心基础设施功能。系统采用三层存储架构确保数据安全和可移植性。

核心功能：
- **三层存储**：IndexedDB（主存储）+ File System Access API（本地 JSON 文件）+ localStorage（表单草稿）
- **文件绑定/解绑**：将数据 JSON 文件绑定到本地磁盘实现自动同步
- **本地文件同步**：绑定文件后每次修改自动写入，刷新页面不丢数据
- **导入导出**：JSON 文件导入/导出（支持跨设备迁移，含数据完整性校验）
- **存储监控**：展示浏览器存储配额和使用量（progress bar）
- **数据统计卡片**：实时显示单位数、价格记录数、订单数、数据大小

## 核心数据结构

### DB 全局状态对象
```javascript
let DB = {
  units: [],           // 关联单位列表
  specs: {},           // 六属性规格（对象，每个属性一个字符串数组）
  bom: [],             // BOM 物料清单
  prices: [],          // 报价库
  orders: [],          // 采购订单
  settlements: [],     // 对账结算
  invoices: [],        // 发票管理
  seq: 100,            // 通用序号生成器（uid 函数使用）
  orderSeq: 1,         // 订单专用序号生成器
  _savedAt: Date.now() // 最后保存时间戳（用于时间戳比对）
};
```

### 文件同步状态
```javascript
let fileHandle = null;       // 文件句柄（File System Access API）
let fileSync = false;        // true=已绑定且有权限, 'pending'=已绑定但需重新授权, false=未绑定
let fileLastSave = '';       // 最后写入时间字符串
```

### IndexedDB 状态
```javascript
const IDB_NAME = 'wb_fastener_idb';   // IndexedDB 数据库名
const FH_DB = 'wb_fastener_fh';       // 文件句柄存储数据库名
let idbStatus = 'idle';               // idle | ok | error
```

## 关键函数及调用链

### 三层存储架构

```
┌──────────────────────────────────────┐
│        IndexedDB（主存储）            │
│     wb_fastener_idb / data / main    │
│  -> 突破 localStorage 5MB 限制       │
│  -> 自动保存，所有数据操作后调用      │
└────────────┬─────────────────────────┘
             │ saveToFile() 同步写入
┌────────────▼─────────────────────────┐
│   File System Access API（文件备份）   │
│      紧固件贸易工作台_数据.json        │
│  -> 手动绑定本地文件                  │
│  -> 自动双向同步（时间戳比对）        │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│      localStorage（草稿缓存）          │
│        wb_fastener_draft_*           │
│  -> 仅用于表单草稿（临时缓存）        │
│  -> 提交后自动清除                    │
└──────────────────────────────────────┘
```

### 主视图（viewData）
```
viewData()
  ├── 计算 DB JSON 大小 → sizeStr（自动单位转换 B/KB/MB）
  ├── renderStorageStatus(sizeStr)      // 存储架构状态卡片
  ├── renderBackupSection()             // 备份与恢复操作区
  ├── renderFileSyncSection()           // 本地文件同步区
  └── renderDangerZone()                // 危险操作区
```

### 存储状态卡片（renderStorageStatus）
```
renderStorageStatus(sizeStr)
  ├── 数据统计卡片（4列）：关联单位/价格记录/采购订单/数据大小
  ├── IndexedDB 状态卡（绿/红/灰）
  ├── 本地 JSON 文件状态卡（已同步/待授权/未绑定）
  ├── 存储配额进度条（#storageQuota，动态获取）
  └── localStorage 说明（仅草稿缓存，不存业务数据）
```

### 备份与恢复（renderBackupSection / exportJSON / importJSON）
```
renderBackupSection()
  ├── 「导出 JSON 备份」按钮 → exportJSON()
  └── 「导入 JSON 恢复」按钮 → 触发 file input → importJSON()

exportJSON()
  ├── JSON.stringify(DB, null, 2) → Blob
  ├── URL.createObjectURL → 触发 <a> 点击下载
  └── 文件名：紧固件贸易工作台_备份_YYYYMMDD.json

importJSON(event)
  ├── FileReader.readAsText → JSON.parse
  ├── 数据完整性校验：
  │     ├── 必填字段：units / prices / orders（数组且完整）
  │     └── 校验失败 → toast 错误，不覆盖
  ├── 关联完整性检查：
  │     ├── settlements.unitId 是否在 units 中
  │     ├── settlements.orders[].orderId 是否在 orders 中
  │     └── invoices.settleId 是否在 settlements 中
  ├── 有缺失 → confirmModal 警告，用户确认后才导入
  └── 导入后：
        ├── ensureDBFields() 补齐缺失字段
        ├── migrateItems() 版本迁移
        └── saveDB() → closeModal() → render()
```

### 本地文件同步（renderFileSyncSection）
```
renderFileSyncSection()    // 根据 fileSync 状态展示不同内容
  ├── fileSync === true（已同步）：
  │     ├── 显示文件名 + 最后同步时间
  │     ├── 「立即同步」→ syncNow()
  │     └── 「解绑文件」→ unbindFile()
  │
  ├── fileSync === 'pending'（待授权）：
  │     ├── 显示文件名 + "需重新授权" 提示
  │     ├── 「重新授权连接」→ reconnectFile()
  │     └── 「解绑」→ unbindFile()
  │
  └── fileSync === false（未绑定）：
        ├── 说明文字（文件同步优势介绍）
        └── 「绑定本地文件」→ bindFile()
```

### 危险操作区（renderDangerZone）
```
renderDangerZone()
  └── 「清空全部数据」按钮 → clearAllData()
        ├── 第一次 confirmModal："您是否已导出最新的 JSON 备份？"
        ├── 第二次 confirmModal："⚠ 确认清空全部数据？"
        └── 重置 DB → saveDB() → render()
```

## 用户操作流程图

```
[数据管理页面]
    │
    ├── 数据统计卡片（4列）
    │     └── 关联单位 / 价格记录 / 采购订单 / 数据大小
    │
    ├── 存储架构状态
    │     ├── IndexedDB 状态卡（正常/异常）
    │     ├── 本地 JSON 文件状态卡（已同步/待授权/未绑定）
    │     ├── 存储配额进度条（动态获取浏览器配额）
    │     └── localStorage 说明（仅草稿缓存）
    │
    ├── 备份与恢复
    │     ├── 「导出 JSON 备份」→ exportJSON()
    │     │     └── 下载 .json 文件
    │     └── 「导入 JSON 恢复」→ importJSON()
    │           ├── 选择 JSON 文件
    │           ├── 完整性校验 + 关联检查
    │           └── 确认导入 → saveDB()
    │
    ├── 本地文件同步
    │     ├── 已同步状态：
    │     │     ├── 显示文件名 + 最后同步时间
    │     │     ├── 「立即同步」→ syncNow()
    │     │     └── 「解绑文件」→ unbindFile()
    │     │
    │     ├── 待授权状态：
    │     │     ├── 「重新授权连接」→ reconnectFile()
    │     │     └── 「解绑」→ unbindFile()
    │     │
    │     └── 未绑定状态：
    │           └── 「绑定本地文件」→ bindFile()
    │                 └── showSaveFilePicker 选择 .json 文件
    │
    └── 危险操作
          └── 「清空全部数据」→ clearAllData()
                ├── 第一次确认：是否已导出备份
                └── 第二次确认：⚠ 不可恢复
```

## 与其他模块的数据依赖关系

```
数据管理 (data) — 基础设施层
    │
    ├── 为所有模块提供数据读写
    │     ├── DB 对象：所有业务模块直接访问
    │     ├── saveDB()：所有模块的写入出口
    │     │     ├── dashboard.js 查看统计
    │     │     ├── units.js CRUD → saveDB()
    │     │     ├── specs.js 属性管理 → saveDB()
    │     │     ├── bom.js BOM 管理 → saveDB()
    │     │     ├── prices.js 报价管理 → saveDB()
    │     │     ├── orders.js 订单管理 → saveDB()
    │     │     ├── settlements.js 结算管理 → saveDB()
    │     │     └── invoices.js 发票管理 → saveDB()
    │     └── uid(prefix)：所有模块生成唯一 ID
    │
    ├── 数据层工具函数（utils.js）
    │     ├── _unitNameCache：pName()/pRating() 缓存
    │     ├── _bomCache：_getBom() 缓存
    │     └── saveDB() 失效以上缓存
    │
    └── 路由入口
          └── index.html → seed.js → utils.js → ui.js → store.js → ... → data.js → router.js → app.js
                └── <script defer> 按序加载
```
*（内容由AI生成，仅供参考）*
