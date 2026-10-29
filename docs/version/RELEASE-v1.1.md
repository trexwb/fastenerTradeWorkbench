# 版本发布日志 · v1.1

> 本文件按主版本组织：v1.1.x 的全部迭代日志集中于此（最新在前）。
> 命名规则：`RELEASE-v{主版本}.md`；次版本迭代追加到文件顶部新分节。

---

## v1.1.1 · 局域网数据同步（设备配对连接）+ AI 体验修复 + 状态机口径统一

> **状态**: ✅ 代码就绪
> **日期**: 2026-10-29
> **版本号**: 1.1.0 → **1.1.1**（新增「数据同步」功能属不同类新功能，经用户确认推进版本号；v1.1.0 发布后同日累积的修复批次一并随本版发布）

### 一、新功能：数据同步（仅桌面版，浏览器版优雅降级）

- **新增侧边栏「数据同步」视图**（`src/views/sync.js` · `viewSync()`）：设备身份（设备 ID / 昵称设置）、同步服务控制（启动 / 停止 / 连接码刷新，默认端口 19826）、连接对端（对方地址 + 6 位连接码配对，连接码 300s 有效期）、已连接设备管理（连接时长展示 / 断开）；入站配对请求经确认弹窗接受或拒绝
- **新增同步引擎**（`src/core/sync.js` · `window.SYNC`）：封装 Tauri 命令（sync_set_identity / sync_start / sync_stop / sync_refresh_code / sync_status / sync_accept / sync_disconnect）+ 事件监听分发；浏览器版检测非 Tauri 运行时自动降级为引导空态（指引前往数据管理使用本地文件同步 / 自动备份）
- **新增 Rust 同步服务**（`src-tauri/src/sync_server.rs`）：axum HTTP 服务，当前端点 `/api/sync/ping`（健康检查）与 `/api/sync/hello`（配对确认，客户端超时 130s）——**数据传输端点尚未上线，本版交付的是局域网设备配对与连接能力**
- **依赖变更**（`src-tauri/Cargo.toml`）：新增 axum 0.7 / tower-http 0.5（CORS）/ uuid（v4）/ rand 0.8；tokio 补 `net`/`sync` features

### 二、随本版一并发布的修复批次（详见下方各分节）

- 🎨 数据同步页 UI/UX 审查修复（功能性缺陷 3 / 交互文案 6 / 可访问性 2，审查报告 `docs/audit/2026-10-29-sync-uiux-review.md`）
- AI 引用跳转线上文章修复（误报「未找到该文件」）
- AI 表格渲染兼容 + 输入提示精简
- AI 回复外链修复（点击链接不再覆盖应用）
- 全面代码审查修复（订单状态机 UI/AI 口径统一 + UI 防重复锁定加固）

### 三、验证

- `node --check` 通过（validators.js / ui.js / router.js / ai-tools.js / orders.js）；状态机冒烟 26 用例全部通过；`npm run vite:build` 构建成功
- 数据同步页桌面态 UI 以 mock 数据在浏览器实际渲染取证（快照 + 计算样式探针）；改动逐项 grep 落盘核对

---

## v1.1.1 · 🎨 数据同步页 UI/UX 审查修复

> **状态**: ✅ 代码就绪（原标记「不推进版本号」，后经用户确认随 v1.1.1 一并发布）
> **日期**: 2026-10-29
> **审查对象**: 新增的「数据同步」视图（src/views/sync.js + src/core/sync.js + src-tauri/src/sync_server.rs）及数据管理页同族同步区块
> **详细清单**: `docs/audit/2026-10-29-sync-uiux-review.md`

### 一、功能性缺陷（3 条）

- **启动/停止按钮 loading 错位**：`_syncStartServer` 把 loading 挂到「连接对端」的连接按钮（syncConnectBtn 恒存在，原回退分支永不可达）；`_syncStopServer` 用 `querySelectorAll('.btn.danger')` 取末尾拿到的是已连接设备行的「断开」按钮——两处自身按钮均无反馈。改为各自 id 定位（syncStartBtn/syncStopBtn）
- **刷新后服务状态丢失**：页面刷新后 `window._syncStatus` 为空而 Rust 服务仍在运行，页面误显「未启动」，再次启动会报端口冲突——viewSync 渲染后立即异步拉取真实状态回填
- **已连接设备表永久滞留**：Rust 侧仅入站请求有事件，会话断开无通知，对端断开后本端列表不更新——同步视图可见时每 10s 轮询状态，会话变化时重渲染（离开视图自动停）

### 二、交互与文案（6 条）

- 端口输入补 1-65535 前端校验（此前非法值直接透传 Rust）；input 补 min/max
- 连接码过期后由孤立红字改为明确引导刷新（附原因说明文案）
- 浏览器版空态由死路改为有出路：说明原因 + 引导「前往数据管理」使用本地文件同步/自动备份
- `syncNow` 补失败 toast 与按钮 loading（此前写失败静默抛出，用户以为成功）；unbindFile 确认文案纠偏（主存储是 IndexedDB 而非 localStorage，原文案误导用户以为解绑会丢数据）
- 数据管理页 localStorage 标题 `style="data-section-hd"` 笔误改为 class（样式类从未生效）；「已同步」卡无时间时悬空「·」分隔符修复；`_renderWebDataLocation` 补 catch（不再永久停留「正在获取…」）
- 断开按钮改为显式传 `this`，不再依赖全局 event 隐式变量

### 三、可访问性（2 条）

- 同步页 5 组表单 label 补 for/id 关联（原全部无关联，违反 §12.2）
- 异步填充区（存储配额/数据所在位置）补 aria-live="polite"；.data-tab 补 ：focus-visible 焦点环

### 四、验证

- 未执行构建（按用户长期工作方式）；改动已逐项落盘核对（grep）；桌面态 UI 以 mock 数据在浏览器实际渲染取证（快照 + 计算样式探针），file:// 下的 CSP 报错经查为本审查面板自定义协议限制而非产物缺陷（dist 无 CSP meta，产物内 eval 可用）

---

## v1.1.1 · AI 引用跳转线上文章修复（误报「未找到该文件」）

> **状态**: ✅ 代码就绪
> **日期**: 2026-10-29
> **版本号**: 随 v1.1.1 发布（原标记 v1.1.0 内追加不推进，后经用户确认推进版本号）

### 一、修复内容

- **AI 回复中的「依据」引用芯片点击后提示「未在知识库中找到该文件」，但文章就在专业解读里**
  - 根因：AI 对线上文章（wiki.edtib.com）命中的引用约定是【依据：文章标题】，而引用芯片的 `kbShowFile` 只查本地目录知识库（KB.fileBlocks，存的是文件名），两库互不覆盖 → 线上文章引用必然未命中
  - `src/views/ai-chat.js`：`kbShowFile` 改为两级查找——先本地 KB（原行为不变），未命中回落 `WikiKB`（新增 `aiFindWikiArticle`：精确标题/URL → 归一化包含匹配，容忍模型增删引号/空白，取最短命中）；命中后 `go('wiki')` + `openWikiDocRemote(url)` 跳专业解读应用内阅读（与 navigate_view 一致不关 AI 抽屉；go() 会重置阅读态，须先 go 再 open）

### 二、验证

- 未执行构建（按用户长期工作方式）；`aiFindWikiArticle` 以注入假 WikiKB 的 node 用例验证：精确标题命中、去引号模糊命中、无关名拒绝、带前后缀命中

---

## v1.1.1 · AI 表格渲染兼容 + 输入提示精简

> **状态**: ✅ 代码就绪
> **日期**: 2026-10-29
> **版本号**: 随 v1.1.1 发布（原标记 v1.1.0 内追加不推进，后经用户确认推进版本号）

### 一、修复内容

- **AI 回复中的表格显示为纯文本（竖线裸露）**
  - 根因（用户实测截图定位）：模型输出的表格紧贴上一行正文、中间无空行——GFM 规定表格不能打断段落，markdown-it 将整块按普通段落渲染（竖线半角、分隔行均在，非全角/缺分隔行问题）
  - `src/views/ai-chat.js` 新增 `aiFixTableBlocks`：仅在「以 | 开头的行紧跟非表格正文行」时补一个空行让表格块成立；围栏代码块（```/~~~）与引用/缩进块内不处理，避免改动代码内容与块结构
- **AI 输入框底部提示移除（控件高度降低）**
  - 按用户要求移除底部提示行，输入卡片少一行、整体高度下降；按键说明并入输入框 placeholder：`例如：本月经营情况怎么样？（Enter 发送 · Ctrl/⌘/Shift+Enter 换行）`
  - 生成中「发送已暂停/可停止」反馈原靠提示行 CSS ::after 文案，随行移除后改由 placeholder 承载（setAISendingUI 切换常态/忙碌两套文案）
  - components.css 同步清理提示行遗留规则（含两处重复的忙碌态选择器）；桌面版正文写文件路径说明保留在「附件」按钮悬停提示与 query_help 帮助知识库中

### 二、验证

- 未执行构建（按用户长期工作方式）；`aiFixTableBlocks` 以真实 markdown-it 配置做过用例验证：正文贴表格（修复后出表）、代码块内表格行（不改动）、引用块（不插入）、正常空行分隔（不受影响）

---

## v1.1.1 · AI 回复外链修复（点击链接不再覆盖应用）

> **状态**: ✅ 代码就绪
> **日期**: 2026-10-29
> **版本号**: 随 v1.1.1 发布（原标记 v1.1.0 内追加不推进，后经用户确认推进版本号）

### 一、修复内容

- **AI 助手回复中的链接点击后整个 App 被链接页覆盖（无法返回）**
  - 根因：`renderAIMarkdown` 的 DOMPurify sanitize 默认白名单不含 `target` 属性（dompurify 3.4.17 实测仅含 popovertarget/targetx/targety），markdown-it `link_open` 设置的 `target="_blank"` 被剥离，外链退化为裸 `<a href>`，点击后在当前窗口/Webview 原地导航，应用被链接页替换；桌面版 router.js 原有的 `open_external` 拦截器也因匹配不到 `a[target="_blank"]` 而失效
  - `src/views/ai-chat.js`：sanitize `ADD_ATTR` 补 `target`，外链恢复新窗口语义（浏览器版新标签页打开，桌面版由 router.js 拦截调系统浏览器）
  - `src/core/router.js`：桌面版外链拦截从「仅 `a[target=_blank]`」放宽为「所有外部 http(s) 链接」（按链接协议判断，锚点/相对路径/mailto 不受影响），同类属性剥离问题不再致覆盖；打开失败时 toast 提示
  - 降级路径：markdown 依赖缺失/渲染失败退化为纯文本时，新增 `aiLinkifyPlain` 将 http(s) 裸链接包为可点击 `<a target="_blank">`（尾部标点不入链接）

### 二、验证

- 未执行构建/机检（按用户长期工作方式，验证待用户明确要求时进行）；关键改动经 read/grep 核对已落盘

---

## v1.1.1 · 全面代码审查修复（状态机口径统一 + UI 防重复锁定加固）

> **状态**: ✅ 代码就绪
> **日期**: 2026-10-29
> **版本号**: 随 v1.1.1 发布（原标记同版本内审查修复迭代不推进，后经用户确认推进版本号）
> **范围**: 订单状态机 UI/AI 双轨口径统一、终态改出防误改、更新弹窗防重锁、弹窗/抽屉异常路径加固、死代码清理

### 一、修复内容

- **〔审计 P2〕状态流转 UI 与共享状态机口径统一**
  - `NEXT_STATUS['报价中']` 补「异常」：详情页「标记异常」按钮覆盖报价中，此前 AI 工具被拒、UI 直接落库
  - 新增 `BACK_STATUS` 相邻回退表（寻货中→待确认、报价中→寻货中、签约完成→报价中、送货中→签约完成），`canFlowOrderStatus` 同时校验正向+回退边：此前 UI「上一步」全放行、AI 全拒绝
  - `orders.js changeOrderStatus` 接入 `canFlowOrderStatus` 校验，与 AI 工具 `flow_order_status` 同一口径；全部 13 个 UI 流转调用点逐一核对兼容（仅扩容未收紧，无按钮被误拒）
  - `ai-tools.js flow_order_status` schema 描述同步回退边新口径
- **〔审计 P3〕编辑表单终态改出二次确认**：订单编辑保存时，「异常/取消」终态改出经 `confirmModal` 确认后才落库（`saveOrder(skipTermConfirm)` 重入防重复弹窗），防下拉误选改状态
- **〔审计低危〕设置弹窗更新区防重锁**：`renderSetStatus` 600ms 轮询在状态 HTML 未变化时跳过重建，「下载并安装」按钮的 disabled 防重锁不再随 DOM 重建失效
- **〔审计低危〕modal/confirmModal 异常路径**：onOk 同步抛错不再被空 catch 吞掉后关窗（用户会误以为已保存成功），改为 toast 报错并留在弹窗
- **〔审计低危〕drawerOk 未保存提醒**：onOk 校验失败（返回 false / reject）留在抽屉时恢复 `_drawerDirty` 标记，此后 Esc/点遮罩关闭仍弹「未保存」确认，防已填输入丢失
- **〔审计卫生〕死代码清理**：移除 `orders.js` 零引用的 `deleteOrder` 函数与 `pmOnCheckChange` 内空语句

### 二、验证

- `node --check` 通过：validators.js / ui.js / router.js / ai-tools.js / orders.js
- 状态机冒烟测试：26 个流转用例全部通过（含 4 条回退边 + 报价中→异常 + 终态拒绝）
- `npm run vite:build` 构建成功（Node v24.21.0；Node v18 与 vite8/rolldown 不兼容为环境问题，与改动无关）
- UI 兼容性核对：`changeOrderStatus` 全部 13 个调用点在新状态机下均合法

---

> **状态**: ✅ 代码就绪
> **日期**: 2026-10-28
> **上一版本**: v1.0.57
> **版本范围**: wiki 模块云端同步架构重构 + 应用内阅读 + 串行加载优化

### 一、新功能

- **云端同步架构重构** — 只从云端 `list.json` 同步文章列表，本地不存储文档（云端优先、本地禁用）
- **应用内阅读** — 远程文章默认在应用内 iframe 打开，提供"在浏览器中打开"按钮（右上角外部链接图标）
- **串行加载** — 远程资源串行加载（list.json → WikiKB.sync），避免并发触发服务器限流
- **失败重试** — 每步失败后暂停，显示错误原因 + 重试按钮，用户点击后从失败步骤继续
- **进度反馈** — 加载过程显示阶段文案（正在加载文章清单… / 正在同步知识库…）+ 进度条动画

### 二、实现要点

- **加载流程**：Step 0 → Step 1 (list.json) → Step 2 (WikiKB.sync) → Step 5 (完成)
- **错误处理**：失败时 `_wikiLoadStep` 保持在当前步骤，不跳到完成状态
- **远程文章打开**：`openWikiDocRemote(url)` 应用内 iframe 打开，`openWikiExternal(url)` 浏览器新标签页打开
- **阅读态适配**：`_viewWikiReader()` 识别远程 URL，隐藏收藏/笔记功能（仅本地文档支持）
- **样式**：`.wiki-open-external` 绝对定位按钮（右上角），`.wiki-card` 已有 `position: relative`

### 三、变更文件

`src/views/wiki.js`、`src/styles/components.css`、`src/core/store.js`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json`、`AGENTS.md`、本文档

### 四、验证

- `node --check` 通过：wiki.js / store.js
- 串行加载逻辑验证：Step 1 失败 → 显示错误 + 重试按钮 → 点击重试 → 从 Step 1 继续
- 应用内阅读验证：点击远程文章卡片 → iframe 打开 → 显示顶栏（返回列表/复制链接/独立窗口）
- 浏览器打开验证：点击右上角外部链接图标 → 新标签页打开云端 URL

### 五、已知问题

- 云端 `index.js` 未部署（服务器只有 `list.json`），已调整代码不加载该文件
- CORS 配置需服务器支持 `Access-Control-Allow-Origin: *`

---
