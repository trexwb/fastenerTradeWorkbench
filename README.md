# 紧固件贸易工作台

面向紧固件贸易场景的离线工作台，覆盖关联单位管理、规格管理、价格管理、采购订单全流程，支持多供应商分配寻源。

> **当前版本：v1.0.34** — 五轴代码审计安全修复（CSP / SSRF / XSS）+ 发布工作流修复

## 更新日志

- **v1.0.34** — 五轴代码审计安全修复：CSP 追加 object-src/base-uri/form-action/frame-src 收紧；lib.rs 新增 valid_upstream_base_url 防 SSRF（仅放行 https 与本地回环）；store.js 新增 sanitizeImportedIds、dashboard/invoices/units onclick id 改 escJsStr 防 XSS；发布工作流签名私钥迁移 variables 并修复变量引用错误
- **v1.0.33** — 修复 Coach 引导自动渲染空壳（遮罩锁死页面无法关闭）；dashboard / settlements 统计卡补键盘可达（role=button + Enter/空格激活）；P11 核实无手型误导；11 个视图 CDP 实测遮挡全部归零
- **v1.0.32** — 桌面端 UI/UX 深化（吸顶表头、毛玻璃、拖放导入 JSON）；修复列表页首行被 sticky 表头遮挡（top:54px → top:0）；四技能全量复查样式遮挡与点击无效
- **v1.0.31** — 统计卡 stat-static 分化、标题 cursor:default、12 处 Enter 输入法候选补 isComposing 防护；删除 .row-clickable 死代码、td-act 补 title/aria-label、备份/导入接 .btn.loading
- **v1.0.30** — 样式遮挡与点击无效审查修复：fitDrop() 下拉越界兜底、Coach 高亮孔透传、折叠菜单 tabindex、.ai-message-delete 指针、--z-cmd 层级

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

## AI 助手（DeepSeek 接入）

> 需在 AI 设置中填写 DeepSeek API_KEY（桌面版存应用数据目录，浏览器版存 localStorage）。

### 两种模式

| 模式 | 说明 |
|------|------|
| 只读分析 | 基于脱敏业务快照回答经营分析、催款建议、比价、话术生成等问题 |
| 工具调用（写入） | AI 起草 34 类数据操作（7 类数据 CRUD + 订单寻货/状态流转 + 视图导航/导出），**逐条经确认弹窗后执行** |

### 能力边界（硬性约束）

- **AI 与回收站完全隔离**：AI 不能查看/恢复/彻底删除回收站数据；AI 删除 = 软删除（进回收站）
- **AI 只产出参数，不直接改数据**：所有写入复用系统校验与保存链路（saveDB + 操作审计）
- **敏感字段**（电话/地址/税号/银行账户）AI 不收集，由用户在确认弹窗补全
- 订单状态流转必须遵守状态机（只能前进到下一站或终态分支）

### 审计与回滚

- 所有操作（含手动删除）记入「操作历史」（数据管理页），可单条/整批回滚
- 删除记录进入「回收站」（数据管理页），可恢复/彻底删除/清空
- 数据导出（JSON/文件同步）不含回收站与操作历史

### 运行形态

- 浏览器版（file://）：前端直连 DeepSeek（CORS 已放行），API_KEY 存 localStorage
- 桌面版（Tauri）：前端经 Rust 命令代理调用（API_KEY 存应用数据目录，前端不可读明文）

---

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
