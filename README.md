# 紧固件贸易工作台

面向紧固件贸易场景的离线工作台，覆盖关联单位管理、规格管理、价格管理、采购订单全流程，支持多供应商分配寻源。

> **当前版本：v1.0.0** — UX 交互体验优化：Drawer 关闭确认防丢失、订单保存防重、寻货过滤保留勾选、多 toast 合并

## 快速开始

用浏览器直接打开 `src/index.html` 即可使用。推荐使用 Chrome / Edge（完整支持 File System Access API 本地文件同步），Safari / Firefox 可使用全部核心功能但自动降级为手动导出导入。

> 历史单文件版可在 `紧固件贸易工作台.html` 找回，无需安装任何环境。

## 功能模块

### 1. 概览
- 今日待处理看板：逾期订单标红、今日到期、待确认订单
- 统计卡片：订单总数、待处理、本月签约额、供应商数
- 最近订单快捷入口

### 2. 关联单位管理
- 供应商 / 采购商统一管理，一个单位可同时具备两种角色
- 联系人按角色区分（供应商联系人 ≠ 采购商联系人）
- 支持名称、联系人、电话、角色、评级、账期检索
- 评级（S/A/B/C）、账期（天数）、备注

### 3. 规格管理
- 六个维度枚举：类型 / 标准 / 直径 / 硬度 / 表面处理 / 材质
- 每个维度可新增 / 删除枚举值
- 全局复用，价格管理和订单选规格时引用

### 4. 价格管理
- 供应商 × 规格 × 单价的报价记录
- 按供应商、规格维度筛选
- 记录联系人、报价有效期、备注
- 采购订单手动录入供应商时自动写入价格库

### 5. 采购订单管理
- **多供应商分配制**：一个产品规格可由多个供应商分别供货
  - 每个供应商分配数量（allocQty），系统自动汇总寻源进度
  - 寻源状态：待寻源 → 部分寻源 → 已确认
  - 分配进度条可视化（绿=满量，黄=部分）
- **七种状态流转**：待确认 → 寻货中 → 待签约 → 签约完成 → 完成 / 异常 / 取消
- 寻货弹窗：价格库自动匹配 + 手动录入（自动建供应商和报价）
- 订单详情页 / 编辑页，支持产品明细增删改

### 6. 数据管理
- **IndexedDB**（主力数据库，容量数百 MB+）
- **本地 JSON 文件同步**（File System Access API，持久备份）
- **localStorage**（仅表单草稿缓存，防填写中途丢失）
- JSON 导出 / 导入备份（不限条数）
- CSV 导出（订单明细）
- 二次确认清空

## 数据存储架构

```
┌─────────────────────────────────────────┐
│           IndexedDB（唯一数据库）          │
│         wb_fastener_idb / key            │
└──────────────┬──────────────────────────┘
               │  双向同步（时间戳对比）
┌──────────────┴──────────────────────────┐
│        本地 JSON 文件（持久备份）           │
│     File System Access API 句柄存 IDB     │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│      localStorage（仅表单草稿缓存）         │
│   wb_fastener_draft_unit / order / item   │
│   提交后自动清除，不存业务数据               │
└─────────────────────────────────────────┘
```

## 表单草稿系统

填写「新建关联单位」或「新建采购订单」时，表单数据自动保存到 localStorage 草稿。如遇退出、关闭、误操作，下次打开时弹窗提示恢复草稿或放弃。

## 技术特点

- **ES module 模块化架构**，按职责拆分 store / utils / ui / router / views，易于维护扩展
- **零外部依赖**，纯 HTML / CSS / JS，无需构建工具，直接浏览器打开即用
- **离线可用**，无需联网
- **响应式适配**，PC 侧边栏导航，移动端汉堡菜单 + 底部安全区
- **数据迁移**，旧版单供应商格式自动迁移为 options 数组格式
- **Combo 检索下拉**组件，支持搜索 + 手动输入新值

## 项目结构

```
FastenerTradeWorkbench/
├── src/                    ← 前端真源（浏览器版）
│   ├── index.html          ← 主 HTML（仅骨架 + <script type="module">入口）
│   ├── css/
│   │   ├── variables.css   ← CSS 变量 / 6 套主题定义
│   │   ├── layout.css      ← 布局（sidebar / topbar / main / content）
│   │   └── components.css  ← 组件（card / table / modal / drawer / tag / btn / form）
│   ├── js/
│   │   ├── store.js        ← DB 数据模型 + IndexedDB 存储层 + 文件同步
│   │   ├── utils.js        ← escHtml / escAttr / fmt / fmtN / icon / uid 等工具函数
│   │   ├── ui.js           ← combo / modal / drawer / toast / confirmModal 等 UI 组件
│   │   ├── router.js       ← view 路由 + AppState + render 入口
│   │   ├── views/
│   │   │   ├── dashboard.js ← 概览页
│   │   │   ├── units.js     ← 关联单位
│   │   │   ├── specs.js     ← 属性管理
│   │   │   ├── bom.js       ← BOM 管理
│   │   │   ├── prices.js    ← 报价管理
│   │   │   ├── orders.js    ← 采购订单（列表 / 详情 / 编辑）
│   │   │   └── data.js      ← 数据管理
│   │   └── app.js           ← 初始化入口（initApp + theme + 全局 handler 挂载）
│   └── images/              ← 图标 / favicon 等静态资源
├── docs/                    ← 项目文档
├── scripts/                 ← 构建 / 版本脚本
├── src-tauri/               ← Tauri 桌面封装
├── dist/                    ← copy-frontend 产物
└── 紧固件贸易工作台.html    ← 历史单文件版 v1.0.46（参考备份）
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `src/index.html` | 应用入口，加载 CSS 与 JS 模块 |
| `src/js/app.js` | 模块入口，导入全部依赖并挂载全局 handler |
| `src/js/store.js` | 数据层：DB 模型 + IndexedDB + 文件同步 |
| `src/js/utils.js` | 通用工具函数 |
| `src/js/ui.js` | 通用 UI 组件（弹窗 / 抽屉 / toast / combo） |
| `src/js/router.js` | 路由与全局状态 |
| `src/js/views/*.js` | 各业务模块视图 |
| `src/css/*.css` | 主题变量 / 布局 / 组件样式 |
| `src/js/seed.js` | 预置示例数据 |
| `紧固件贸易工作台.html` | 历史单文件版（v1.0.46 参考备份） |
| `README.md` | 本说明文档 |

## 浏览器兼容性

| 功能 | Chrome / Edge | Safari | Firefox |
|------|:---:|:---:|:---:|
| 基础功能 | ✅ | ✅ | ✅ |
| IndexedDB 存储 | ✅ | ✅ | ✅ |
| 本地文件同步 | ✅ | ❌ | ❌ |
| 表单草稿缓存 | ✅ | ✅ | ✅ |

> Safari / Firefox 不支持 File System Access API，会自动隐藏文件同步功能，回退到手动导出导入 JSON。
