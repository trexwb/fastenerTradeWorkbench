# AGENTS.md — 紧固件贸易工作台 (FastenerTradeWorkbench)

## ⚠ 强制规范（所有 Agent 必须遵守）

**本项目采用 Vue3 + Vite 开发方式，打包产物 `dist/index.html` 是零依赖可双击运行的单页应用（SPA），任何人下载 dist 目录后直接双击 `dist/index.html` 即可在浏览器中打开使用，<u>不需要任何 HTTP 服务器</u>（不依赖 python3 -m http.server、Node.js、nginx 等任何本地服务）。开发时使用 `npm run dev` 启动 Vite 开发服务器。**

> 🔴 **所有 Agent 服务（包括 file-agent、browser-agent、computer-agent 等任何子 Agent）在本项目中执行任何任务时，必须无条件遵守本 `AGENTS.md` 文件中定义的所有规则，不得以任何理由违反。**

## 项目概述

紧固件贸易工作台是一个纯前端模块化 SPA，用于紧固件贸易企业的采购订单管理、寻货分配、规格管理和价格管理。
**开发入口**：`src/index.html`（Vite root，Vue3 挂载点 #app）→ `src/main.js`（样式加载 + createApp）→ `src/App.vue`（全局间接 eval 按序执行业务层 JS）。业务逻辑拆分到 `src/core/`（数据层/工具层/UI层）和 `src/views/`（各视图页面），保持 window.* 全局挂载，零算法改动。
**构建产物**：`dist/index.html`（iife 单 chunk + 相对路径 + module script 降级，双击可运行）。

## 核心规则

### 0. 版本号递增

每次对项目做出任何非临时性的编辑修改后，必须将版本号末位（x）加 1。**版本号单一来源：`package.json` 的 version 字段**，构建时由 Vite define 注入全局 `__APP_VERSION__`。需同步更新三处：
1. `package.json` 的 version 字段
2. `src-tauri/tauri.conf.json` 的 version 字段（Tauri 桌面版）
3. `AGENTS.md` 中的「当前基准版本」

当前基准版本：**v1.0.7**。

### 1. 零依赖运行原则（最高优先级）

本应用**开发阶段**采用 Vue3 + Vite，需要执行 `npm install` 安装依赖并使用 `npm run dev` 启动开发服务器；**最终交付物**是 `dist/` 目录中的打包产物——任何人下载 `dist/` 目录后直接双击 `dist/index.html` 即可在浏览器中打开使用，**不需要任何 HTTP 服务器**（不依赖 `python3 -m http.server`、Node.js、nginx 等任何本地服务）。

所有 Agent 服务在修改本项目时**必须无条件遵守**以下强制约束（针对**最终构建产物 dist/**）：

- **Vite 配置必须保持**：`vite.config.js` 中的 `base: './'`（相对路径）、`rollupOptions.output.format: 'iife'`（非 module 打包，避免 CORS）、`demoteModuleScripts()` 插件（将构建产物的 `<script type="module">` 降级为 `<script defer>`，file:// 下可加载）三项不得移除或更改
- **产物验证标准**：修改后的项目必须在 `npm run vite:build` 成功后，在任意现代浏览器中通过 `file://` 协议直接打开 `dist/index.html` 完全正常运行
- **禁止引入额外的运行时外部依赖**：不得引入 React、jQuery、lodash、CDN 脚本等非 Vue3 基础栈的运行时依赖（Vite 构建依赖仅用于开发阶段）
- **静态资源路径**：`src/public/` 下的资源（images、vendor）会被 Vite 原样复制到 `dist/` 根目录，引用路径需使用相对路径（如 `vendor/xlsx.min.js`）

> 以上约束适用于所有 Sub-Agent（file-agent、browser-agent、computer-agent 等），无论其在何种上下文中执行任务，均不得以任何理由违反。

**唯一豁免**：`src/core/exporter.js` 的 Excel 导出功能动态加载 `xlsx-js-style@1.2.0`（SheetJS 0.18.5 的支持样式 fork，暴露全局 `window.XLSX`，带 `style_version` 标记）。加载策略为**本地优先**（`src/public/vendor/cpexcel.js` + `src/public/vendor/xlsx.min.js`，构建后位于 `dist/vendor/`，离线可用）→ **CDN 兜底**（URL 见 `_CPEXCEL_CDN`/`_XLSX_CDN`），保持按需动态加载（非静态 `<script>` 引入，file:// 下可用）。加载顺序：`cpexcel.js`（设置全局 `cptable`，提供完整代码页/多语言编码支持）→ `xlsx.min.js`（主库，检测到 `cptable` 后自动启用）。**不得换回 `xlsx@0.18.5` 社区版**（其 write 端不写单元格样式），**不得删除本地 vendor 文件改为纯 CDN**（离线场景会失败），**不得省略 cpexcel.js**（xlsx.min.js 内部 `require("./cpexcel.js")` 在浏览器环境无法执行，需通过 `<script>` 标签预先加载 cpexcel.js 设置全局 `cptable`）。导出样式在单元格上以 `cell.s` 子对象写入，适配逻辑见 `_toStyleObj`/`_wc`。导出按订单状态分发（`exportOrder` 的 switch）：`_exportOrderPendingConfirm`（待确认·产品确认单）、`_exportOrderSourcing`（寻货中·寻源进度单）、`_exportOrderQuoting`（报价中/未成交·报价中报价单，产品明细为主行、供应商报价为子行，未满足需求数量的产品在「供应数量提醒」区红色醒目提示）、`_exportOrderSignedComplete`（签约完成·签约完成结算单，重点为采购商应收明细与供应商应付明细，含已收/已付/未结金额与红色结算提醒）、`_exportOrderDelivering`（送货中/完成·送货结算单，两状态内容一致仅文件名不同；除结算明细外含送货信息——快递至采购商的地址/单号/时间，及供应商邮寄信息——各供应商按联系人/电话/邮寄地址将产品快递至我方，链路：供应商→我方收货验货→采购商）、`_exportOrderGeneral`（其余状态·通用采购订单）。

### 2. 文件操作根目录

本项目所有文件操作默认以以下路径为根目录，**不得偏离**：
```
/Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/
```

### 3. 编辑策略

- **针对性修复优先**：UI bug、功能缺陷等采用最小改动修复，禁止重构或大范围重写
- **编辑后必须验证**：必须 grep/read_text 验证关键改动是否落盘
- **分区编辑**：每次 edit_file 只替换一个独立区块（如单个函数、CSS 块、表格行），避免多区块一次替换引发意外匹配
- **禁止假设**：不可凭记忆推测已有函数名、变量名、CSS 类名，修改前必须读取确认
- **版本号规则**：编辑 `src/views/*.js` 等模块文件后，`APP_VERSION` 末位 +1，同步更新三处

### 4. 架构约定

- **项目结构**：Vite root = `src`；`src/index.html` 入口 → `src/main.js`（CSS 引入 + createApp）→ `src/App.vue`（用 `import.meta.glob(?raw)` 读取 `src/core|views/**/*.js` 源码，间接 eval 全局执行，顺序：`seed → utils → ui → store → exporter → ai → help-knowledge → ai-tools → views/{dashboard,units,specs,bom,prices,orders,settlements,invoices,data,keyboard,ai-chat} → router → app`）；样式：`src/styles/{variables,layout,components}.css` 由 main.js 直接 module import；静态资源：`src/public/images|vendor` 原样复制到 dist/
- **存储体系**：IndexedDB（主存储，`DB` 对象） + localStorage（表单草稿，`DRAFT_PREFIX='wb_fastener_draft_'`） + 本地 JSON 文件（File System Access API 备份）
- **状态管理**：全局变量控制视图（`view`、`curOrder`、`curOrderView`、`_fMode`、`_fOrderId`、`_fItems`）
- **渲染函数**：`render()` 统一调度，`orders` 分支路由：`curOrder ? viewOrderEdit() : curOrderView ? viewOrderDetail() : viewOrders()`
- **基础框架**：Vue3 + Vite 为既定开发基础栈；禁止在此之外额外引入 React/jQuery/lodash 等运行时依赖
- **业务层零算法改动**：`src/core/` 与 `src/views/` 下的业务逻辑 JS 以「间接 eval 全局执行」方式加载，保持原 window.* 全局语义，不轻易将全局函数改写为 ES module import/export

### 5. 文件结构

```
FastenerTradeWorkbench/
├── src/                    ← Vite root（前端真源，浏览器版）
│   ├── index.html          ← 入口 HTML（Vue 挂载点 #app + <script type=module src=/main.js>）
│   ├── main.js             ← Vue 入口（import 样式 + createApp(App).mount）
│   ├── App.vue             ← 壳组件（import.meta.glob(?raw) 读取业务 JS，间接 eval 全局执行）
│   ├── styles/
│   │   ├── variables.css   ← CSS 变量 / 主题定义（原 src/css/variables.css，字节级一致）
│   │   ├── layout.css      ← 布局（sidebar / topbar / main / content）
│   │   └── components.css  ← 组件（card / table / modal / drawer / tag / btn / form）
│   ├── core/               ← 数据/工具/UI 层（原 src/js/*.js，业务零改动 → window.* 全局）
│   │   ├── seed.js         ← 预置示例数据
│   │   ├── utils.js        ← escHtml / escAttr / fmt / fmtN / icon / uid 等工具函数
│   │   ├── ui.js           ← combo / modal / drawer / toast / confirmModal 等 UI 组件
│   │   ├── store.js        ← DB 数据模型 + IndexedDB 存储层 + 文件同步 + APP_VERSION（构建注入）
│   │   ├── exporter.js     ← Excel 导出（xlsx-js-style 本地 vendor → CDN 兜底）
│   │   ├── ai.js           ← AI 可选增强（Tauri 走 Rust 命令；浏览器版前端直连 DeepSeek API，支持流式与 tool_calls）
│   │   ├── help-knowledge.js ← 系统使用知识库（HELP_KNOWLEDGE 数组，供 query_help 工具按需检索）
│   │   ├── ai-tools.js     ← AI Function Calling 工具协议（AIT：schema 定义 + 校验/预览/执行/审计适配层，写入工具均生成提案需用户逐条确认）
│   │   ├── router.js       ← view 路由 + AppState + render 入口
│   │   └── app.js           ← bootApp() 启动入口（theme + 全局 handler + initApp）
│   ├── views/              ← 视图层（原 src/js/views/*.js，业务零改动 → window.* 全局）
│   │   ├── dashboard.js     ← 概览页
│   │   ├── units.js         ← 关联单位管理
│   │   ├── specs.js         ← 规格管理
│   │   ├── bom.js           ← BOM 管理
│   │   ├── prices.js        ← 报价管理
│   │   ├── orders.js        ← 采购订单（列表 / 详情 / 编辑）
│   │   ├── settlements.js   ← 结算管理
│   │   ├── invoices.js      ← 发票管理
│   │   ├── keyboard.js      ← 快捷键
│   │   ├── ai-chat.js       ← AI 助手
│   │   └── data.js          ← 数据管理
│   └── public/             ← 静态资源（Vite 原样复制到 dist/ 根目录）
│       ├── images/          ← 图标 / favicon 等
│       └── vendor/          ← 第三方库（xlsx-js-style 本地化，离线可用）
│           ├── cpexcel.js   ← 代码页表（多语言编码支持）
│           └── xlsx.min.js  ← SheetJS 0.18.5 样式版 fork（主库）
├── vite.config.js          ← Vite 配置：base:'./' + iife + moduleScript降级 + 版本号define
├── package.json            ← 版本号单一来源（vue ^3.5 / vite ^8 + @vitejs/plugin-vue ^6）
├── README.md               ← 项目说明（浏览器版使用指引，版本信息以 package.json 为准）
├── docs/                    ← 项目文档（API.md / COVERAGE.md / 操作手册.md / flows 各模块流程 / version 发布记录 / screenshots 截图与历史单文件版）
├── scripts/                 ← 构建 / 版本脚本（bump-version / check-version / copy-frontend / serve / make-dmg）
├── src-tauri/               ← Tauri 桌面封装（Rust 源码 + tauri.conf.json，frontendDist=../dist）
└── dist/                    ← Vite 构建产物（双击 dist/index.html 可运行；结构：index.html + assets/js|css + vendor + images）
```

### 6. 关键函数清单（修改前必须确认）

| 函数 | 所在文件 | 用途 |
|------|---------|------|
| `viewOrders()` | orders.js | 采购订单列表页 |
| `viewOrderEdit()` | orders.js | 编辑/新建订单（表单 + 产品明细） |
| `viewOrderDetail()` | orders.js | 订单详情只读页（含寻货入口） |
| `render()` | router.js | 全局视图路由器 |
| `viewBOM()` | bom.js | BOM 列表页 |
| `viewUnits()` | units.js | 关联单位列表页 |
| `viewPrices()` | prices.js | 报价管理列表页 |
| `filterPrices()` | prices.js | 报价筛选渲染（含 checkbox） |
| `viewSettlements(type)` | settlements.js | 结算管理列表页（按类型筛选） |
| `openSettleDetail(unitId, tabType)` | settlements.js | 结算详情抽屉 |
| `openNewSettlement(presetUnitId, type)` | settlements.js | 新建结算 |
| `viewInvoices(type)` | invoices.js | 发票管理列表页（按类型筛选） |
| `openInvEdit(invId)` | invoices.js | 发票编辑抽屉 |
| `openDrawer()` | ui.js | 右侧抽屉组件 |
| `closeDrawer()` | ui.js | 关闭抽屉 |
| `modal()` | ui.js | 模态弹窗组件 |
| `closeModal()` | ui.js | 关闭弹窗 |
| `confirmModal()` | ui.js | 确认弹窗 |
| `combo()` | utils.js | 搜索下拉组件 |
| `icon(name, size)` | utils.js | SVG 图标渲染 |
| `fmt(val)` | utils.js | 金额格式化 |
| `fmtN(val)` | utils.js | 数字格式化 |
| `escHtml(str)` | utils.js | HTML 转义 |
| `escAttr(str)` | utils.js | 属性转义 |
| `saveDB()` | store.js | IndexedDB 落盘 |
| `uid(pref)` | utils.js | 唯一 ID 生成 |

### 7. CSS 约定

- **CSS 变量**：`--green`、`--line`、`--gray`、`--warn` 等，定义在 `src/styles/variables.css` 的 `:root` 中
- **表格**：`.table-wrap > table`，`th`/`td` 统一样式
- **`.td-act`** 类用于操作列单元格，仅设 `white-space:nowrap`（禁止 `display:flex`，会破坏 table-cell 对齐）
- **按钮**：`.btn` 基础 + `.btn.sm`（小号）/ `.btn.primary`（主色）
- **标签**：`.tag` + 颜色修饰（`.tag.green` / `.tag.warn` / `.tag.gray` / `.tag.purple` / `.tag.err`）
- **新增样式**统一写入 `src/styles/components.css`

### 8. 交互约定

- **搜索框**：回车（Enter）或点击图标触发搜索，禁止 `oninput` 实时搜索（避免中文输入法冲突）
- **批量操作**：抽屉方式弹出，先解析预览、确认后再提交（不静默写入）
- **批量删除**：复选框 + 全选 + 工具栏按钮，confirmModal 确认后执行
- **寻货入口**：仅在详情页 `viewOrderDetail()` 的「寻源状态」列，不足量时才显示按钮；不在列表页显示
- **寻货与编辑分离**：详情页寻货直接弹窗，不进编辑模式；编辑模式中寻货在 `viewOrderEdit()` 内完成
- **产品变更自动保存**：编辑模式下产品明细的添加/修改/删除/寻货分配均自动写 DB，无需手动「保存订单」
- **「保存订单」按钮**：仅用于保存表单字段（采购方、对接人、项目、交期等元信息）

### 9. 数据流

```
用户操作 → 修改 _fItems → refreshProductList() → saveOrderDraftFromItems() → persistOrderItems() → DB.orders 落盘
                                                                                    ↓
                                                                              saveDB() 写 IndexedDB
```

寻货操作（编辑模式）：
```
addMatchSupplier/manualSupplier/removeOption → _fItems 更新 → persistOrderItems() → DB.orders
```

寻货操作（详情模式）：
```
sourceItemFromDetail → sourceItem 弹窗 → addMatchSupplier/manualSupplier/removeOption → persistSourcingFromDetail() → DB.orders
```

### 10. AI 可选增强模块

- **双通道架构**：Tauri 桌面版走 Rust 命令（`src-tauri/src/lib.rs`：`ai_deepseek_token_write/has/get` 管理 token、`ai_deepseek_chat` 流式对话，事件名 `ai:deepseek:chunk`，token 存应用数据目录 `deepseek_token` 文件）；浏览器版（含 file://）前端直连 `https://api.deepseek.com/v1/chat/completions`（CORS 已实测放行），API Key 由用户主动输入并存 localStorage（键 `wb_fastener_ai_key`）。已废弃旧的 `tools/ai-proxy.js`（127.0.0.1:7842）代理方案。
- **模型白名单**：仅允许 `deepseek-v4-flash`（默认）/ `deepseek-v4-pro`，前端（`ALLOWED_MODELS`）与 Rust（`ALLOWED_MODELS`）双侧校验。
- **脱敏快照**：所有 AI 请求的上下文以脱敏快照（snapshot）注入 system prompt，金额、利润、余额、排名一律以本地快照为准，模型不得替代确定性计算，禁止编造单位/订单 ID。
- **Function Calling（`src/core/ai-tools.js`，AIT 对象）**：写入类工具（create_unit/update_unit/create_price/update_price/flow_order_status 等）只生成**提案**，前端要求用户逐条确认后才执行，写入记 `aiOps` 可回滚；查询类工具（query_*）读取脱敏数据；功能层工具（navigate_view/export_order_excel/open_settlement_drawer/open_invoice_drawer/open_unit_form/open_order_form/open_price_form/open_bom_form）触发 UI 动作。
- **帮助知识库（`src/core/help-knowledge.js`）**：`HELP_KNOWLEDGE` 数组覆盖各模块操作说明，供 `query_help` 工具检索。
- AI 代理未运行/无 Key 时必须优雅降级，不得影响 `file://` 核心功能。

### 11. 用户偏好

- 用户指令风格：直接给动作词（"修复"、"优化"、"审查"），期望 Agent 直接执行而非仅建议
- 偏好针对性局部修复，拒绝重构
- 涉及文件改动时默认直接动手，无需先征求确认
- **修复完成后不要主动执行 git commit**，由用户自行验证后再提交
- 版本号以用户手动操作为准（曾手动回退过版本号），Agent 递增版本号时以 package.json 当前值为基准

### 12. 前端编码规范

> 以下规范适用于本项目所有代码编写，所有 Agent 在新增或修改代码时必须遵守。

#### 12.1 命名规范

| 类别 | 规则 | 示例 |
|------|------|------|
| 文件命名 | 全小写，短横线分词 | `user-info.js`、`variables.css` |
| CSS 类名 | 短横线分词 | `.order-card`、`.nav-child` |
| 变量/函数 | 小驼峰 | `orderSearch`、`filterOrdersData()` |
| 常量 | 全大写下划线 | `PAGE_SIZE`、`MS_PER_DAY`、`ORDER_STATUSES` |
| 布尔变量 | is/has/should 开头 | `isVisible`、`hasPermission` |
| 函数命名 | 动词开头 | `getUserInfo()`、`renderOrderRow()` |
| 私有变量 | 下划线前缀 | `_fItems`、`_orderPage`、`_iconCache` |

#### 12.2 HTML 规范

- **语义化标签**：使用 `<header>`/`<main>`/`<section>`/`<aside>`/`<nav>`/`<footer>`，避免全 `<div>`
- **类名短横线**：`class="user-card"`，禁止下划线或驼峰类名
- **禁止冗余标签**：避免无意义的嵌套包裹层
- **行内样式**：尽量避免；JS 拼接 HTML 中不可避免时保持最小化
- **图片**：必须加 `alt` 属性，懒加载使用 `loading="lazy"`
- **表单**：`label` 与 `input` 关联（`for`/`id`），输入框需 `placeholder`

#### 12.3 CSS 规范

- **CSS 变量优先**：所有颜色、间距、圆角、阴影、z-index 必须使用 `src/styles/variables.css` 中定义的变量，禁止硬编码
- **z-index 统一管理**：使用 `--z-*` 变量（`--z-combo`/`--z-topbar`/`--z-sidebar`/`--z-overlay`/`--z-dropdown`/`--z-mask`/`--z-drawer`/`--z-toast`），禁止散落数字
- **选择器嵌套**：不超过 3 层
- **`!important` 禁止使用**：唯一例外是 `@media (prefers-reduced-motion)` 无障碍场景
- **命名**：BEM 思路或短横线，保持一致性
- **公共样式**：抽离到 `src/styles/variables.css`（变量）和 `src/styles/components.css`（组件），`src/styles/layout.css` 仅放布局
- **单位**：优先 `rem`/`vh`/`%`，固定像素场景（border-width、box-shadow）可用 `px`
- **重复规则**：禁止同一选择器定义两次，发现重复必须合并

#### 12.4 JavaScript 规范

- **禁止 `var`**：一律使用 `const`（默认）或 `let`（需重新赋值时）
- **魔法数字**：禁止在代码中直接写无含义数字，必须抽为命名常量
  ```javascript
  // ❌ 错误
  setTimeout(()=>d.remove(), 320);
  // ✅ 正确
  const DRAWER_CLOSE_DELAY = 320;
  setTimeout(()=>d.remove(), DRAWER_CLOSE_DELAY);
  ```
- **箭头函数**：回调优先使用箭头函数
- **异步**：优先 `async/await`，避免 `.then()` 链
- **嵌套深度**：不超过 3 层
- **数组操作**：优先 `map`/`filter`/`reduce`，避免 `for` 循环
- **console 语句**：生产代码禁止 `console.log`（调试日志）；`console.error`/`console.warn` 仅用于 catch 块中的错误处理
- **HTML 拼接**：JS 中拼接 HTML 字符串时，用户数据必须经过 `escHtml()`/`escAttr()` 转义
- **函数提取**：重复出现的代码逻辑（>10 行重复）必须提取为公共函数
- **单行函数**：禁止将多逻辑函数压缩为单行，影响可读性

#### 12.5 性能规范

- **防抖/节流**：高频事件（输入、滚动、resize）必须防抖或节流
- **搜索**：回车触发，禁止 `oninput` 实时搜索（避免中文输入法冲突）
- **缓存**：重复计算的结果应缓存（如 `_iconCache`、`_unitNameCache`）
- **大列表**：数据量大时使用分页（`PAGE_SIZE`），避免一次渲染过多 DOM
- **动画**：使用 CSS `transform`/`opacity`，避免触发 reflow
- **无障碍**：支持 `@media (prefers-reduced-motion: reduce)`

#### 12.6 安全规范

- **XSS 防护**：所有用户输入输出必须经过 `escHtml()`/`escAttr()` 转义
- **localStorage**：仅存储非敏感数据（表单草稿），禁止存储密钥/Token。**唯一例外**：浏览器版 AI 功能的 DeepSeek API Key（键 `wb_fastener_ai_key`），由用户在 AI 设置中主动输入保存（见 §10）
- **无外部 API**：本项目不调用外部接口，所有数据本地存储（IndexedDB）
- **无 `eval()`/`innerHTML` 用户数据**：禁止 `eval()`，`innerHTML` 赋值内容必须经过转义

#### 12.7 Git 提交规范

提交格式：`type(scope): content`

| type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 |
| `docs` | 文档 |
| `style` | 格式调整（不影响代码逻辑） |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试 |
| `chore` | 构建/工具 |

示例：`fix(orders): 修复订单列表分页跳转异常`
