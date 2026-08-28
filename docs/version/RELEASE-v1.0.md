# 版本发布日志 · v1.0

> 本文件按主版本组织：v1.0.x 的全部迭代日志集中于此（最新在前）。
> 命名规则：`RELEASE-v{主版本}.md`；次版本迭代追加到文件顶部新分节。

---

## v1.0.26 · 📝 待发布

> **状态**: 📝 待发布（本地 vite 构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.25
> **版本范围**: 交互体验全面审查 — 修复「AI 操作提案弹窗关闭路径不回填导致 AI 发送永久锁死」

---

## 审查范围与方法

对全部用户操作路径做系统性审查：① 全局核对 `onclick/onchange/oninput` 引用与函数定义（防「点击无效」）；② 全部 `classList.toggle` 折叠/显隐切换点的类挂载模式；③ modal / drawer / combo 的全部关闭路径（X / 遮罩点击 / Esc / 取消按钮 / blur）；④ 状态文案与实际状态同步；⑤ 全部表单保存防重锁覆盖。

## 审查结论

| 审查项 | 结论 |
|--------|------|
| onclick 引用完整性 | ✅ 无缺失（filterPriceMatch / filterSpecVals 为 debounce const 定义，误报排除） |
| 折叠类挂载模式 | ✅ BOM 已修（v1.0.25）、units.js 祖先模式正确、侧栏/菜单切换正常 |
| 箭头/文案状态同步 | ✅ units 与 BOM 均随状态切换 |
| 保存防重锁 | ✅ units / bom / prices / settlements / invoices / orders 全覆盖 |
| modal 关闭路径 | ❌ **发现严重缺陷：AI 操作提案弹窗（Promise 型）的 X / 遮罩点击 / Esc 关闭不回填 Promise** |
| combo 关闭 | ✅ blur 关闭正常 |

## 变更

### 修复：AI 操作提案弹窗关闭导致 AI 发送永久锁死（src/views/ai-chat.js confirmOpsModal）

- **场景**：模型发起写入提案弹出确认窗后，用户点击右上角 × / 遮罩空白处 / 按 Esc——这三条路径只调 `closeModal()` 移除弹窗，**不会 resolve 等待中的 Promise**；`aiWriteLoop` 永久 `await onConfirm`，`AI.state.chatting` 锁死为 true，之后所有 AI 发送被「正在生成回复」拦截，只能刷新页面恢复
- **修复**：`settle` 唯一出口 + `settled` 防双回填；取消按钮 / X / 遮罩点击统一接管为「取消并回填」；全局 Esc（keyboard.js 调 `closeModal()` 直接移除弹窗）用 MutationObserver 监听弹窗移除后兑底取消——四条关闭路径全部闭环
- 附带收益：任何未来新增的关闭路径（如快捷键）也自动被兑底覆盖

## 版本号

- 五处同步 **v1.0.26**；构建通过（settle/MutationObserver 逻辑入产物）

---

## v1.0.25 · 📝 待发布

> **状态**: 📝 待发布（本地 vite 构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.24
> **版本范围**: BOM 表单「其他属性」折叠修复 — 折叠类挂在祖先容器，点击展开/收起恢复生效

---

## 问题背景

新建/编辑 BOM 表单中「其他属性」折叠条点击无效：内容始终展开，箭头与文案（▼ 点击展开）与实际状态不符。根因是折叠类 `sec-collapsed` 被切在 `.sec-body` 自身，而 CSS 规则 `.sec-collapsed .sec-body{display:none}` 以祖先选择器命中——自身带类永不匹配，折叠从未生效过；单位表单（units.js）的同机制因正确挂在父容器上而正常。

## 变更

1. 折叠类移到父容器 `.bom-specs-section`（初始 `sec-collapsed` 默认收起，符合「点击展开」语义）
2. `toggleBOMSpecsSection` 改用 `el.closest('.bom-specs-section')` 切换父容器类，箭头与文案随状态同步
3. combo 下拉为纯 CSS 布局，隐藏容器内初始化安全；展开后组件直接可用

## 版本号

- 五处同步 **v1.0.25**；构建通过

---

## v1.0.24 · 📝 待发布

> **状态**: 📝 待发布（本地 vite 构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.23
> **版本范围**: 数据管理页知识库区块排版对齐 — 开关行接入 ai-kb 样式体系，与 AI 设置弹窗统一

---

## 变更

- 数据管理页 `_kbRefreshBox` 的开关行（提问时检索知识库 / 注入 Top-N / 回答标注来源）从内联样式迁移到 `ai-opt`/`ai-kb-opts` 类体系：标签 `white-space:nowrap` 防逐字碎行，Top-N 下拉统一规格与 focus 主色
- 样式与 AI 设置弹窗完全同源（v1.0.23 已建），两处共用一套 CSS
- CI 工具修复（不改运行时版本）：`scripts/gen-latest-json.mjs` 改为递归扫描 artifact 目录——`actions/upload-artifact` 多路径上传保留「最小公共祖先」下的子目录结构（Windows 产物在 `nsis/`/`msi/` 子目录、macOS 产物嵌套在 `src-tauri/target/...` 深层），原顶层平铺扫描找不到带 .sig 的更新产物导致 `update-manifest` 失败；URL 一律取文件名平铺指向 Release 资产根；已用模拟 CI 布局端到端验证双平台 latest.json 生成正确
- 版本号五处同步 v1.0.24；构建通过

---

## v1.0.23 · 📝 待发布

> **状态**: 📝 待发布（本地 vite 构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.22
> **版本范围**: AI 设置弹窗知识库区块排版重构 — 修复开关标签被 flex 挤压逐字碎行的问题

---

## 问题背景

v1.0.22 重设计后，知识库区块内的开关行（提问时检索知识库 / AI 主动检索 / 自动注入兑底等）被 flex 容器压缩，中文标签无断词规则逐字折行，出现「AI 主 / 动检 / 索」孤字碎行。

## 变更

1. `kbrenderZone` 开关行重构为语义化栅格（`ai-kb-opts` / `ai-opt` 类）：标签统一 `white-space:nowrap`——空间不足时整项换行到下一行，标签内部永不逐字碎行
2. Top-N 数字输入纳入统一样式（宽度/边框/focus 主色）；KB 状态行、操作行、主动检索子分区全部去内联样式，改用类体系并支持深浅主题
3. 版本号五处同步 v1.0.23；构建通过

---

## v1.0.22 · 📝 待发布

> **状态**: 📝 待发布（本地 vite 构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.21
> **版本范围**: AI 设置弹窗重设计 — 状态摘要卡 + 三分组卡片信息架构，解决布局视觉混乱与用户不知道该做什么的问题

---

## 问题背景

AI 设置弹窗将「系统诊断 / 知识库 RAG / 检索策略 / 端点配置」四个维度的设置以扁平字段流堆叠：无分组、无层级，长说明与控件混杂，说明文字权重不当（最显眼位置是安全说明而非核心操作）。

## 变更（Layout Restructure，保留全部功能与项目视觉体系）

1. **顶部状态摘要卡**：当前模型名、端点域名、连接状态点、运行模式标签一屏看清；「API_KEY 仅保存在本机」安全说明降级为卡片角落小字
2. **三组分区**（分组标题 + 卡片容器，物理隔离）：
   - 模型服务：快捷预设 → 服务地址 → 模型名 → API_KEY，操作顺序自上而下一条线
   - 知识库：原 KB 区块卡片化包裹（状态/操作/开关保留，自刷新机制不变）
   - 数据：清空历史弱化为红框危险操作行 + 说明
3. **预设按钮升级为可选中 chips**：当前端点命中的预设自动高亮（active 态），点击即填入并同步高亮与提示
4. **说明文字按端点动态化**：原来一大段固定帮助文字（含全部服务商地址示例）改为单行动态提示，按当前 Base URL 自动推断服务商并显示对应的一句话指引（DeepSeek/OpenAI/通义/Ollama/oMLX/自定义）
5. **弹窗改宽幅 720px**；移动端摘要卡纵向堆叠、说明文字左对齐；全部颜色使用主题变量，深浅主题自适配

## 版本号

- 五处同步 **v1.0.22**；构建验证 `npm run vite:build` 通过；`ai-set-*` 新样式全部入产物

---

## v1.0.21 · 📝 待发布

> **状态**: 📝 待发布（本地 vite 构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.20
> **版本范围**: 知识库工具链修复 — 只读 KB 工具不再弹确认窗、未绑定知识库时工具不携带给模型、未知工具兑底不再打扰用户

---

## 问题背景

用户提问未命中知识库场景时，AI 发起 `list_kb_files` 调用却弹出「确认 AI 操作提案」窗，且窗内显示红色「校验失败：未知工具」——一个无法执行的提案打扰用户。用户诉求：未绑定知识库时不该有此类提示，直接不带知识库索引请求接口即可。

## 根因

| # | 缺陷 | 说明 |
|---|------|------|
| 1 | 工具分类只认 `query_` 前缀 | `list_kb_files` / `get_kb_file` / `search_kb_detail` 被误归为写入类 → 走确认弹窗（`query_knowledge` 恰好有前缀所以没暴露） |
| 2 | 校验器白名单未同步 | `validateOp` 的 validators 表没有 KB 工具条目 → 弹窗内报「未知工具」红字 |
| 3 | 工具静态全量携带 | 知识库未绑定/未启用时，KB 工具 schema 仍随请求发给模型 → 模型可发起注定失败的调用 |
| 4 | system prompt 的 KB 指引无条件携带 | 未绑定时模型仍被引导尝试 KB 工具 |

## 变更

1. **KB 只读工具白名单**（core/ai-tools.js）：新增 `KB_TOOL_NAMES`（query_knowledge / list_kb_files / get_kb_file / search_kb_detail），`validateOp` 对其直接放行（无副作用）；随导出暴露
2. **分类修正**（core/ai.js aiWriteLoop）：KB 只读工具与 `query_` 前缀同路——立即执行回填模型，不经确认弹窗
3. **工具动态携带**（core/ai.js）：KB 未绑定或未启用时，KB 工具 schema 从请求的 tools 数组中剔除——模型无从发起，不产生任何提案；同时 system prompt 的 KB 指引段同步条件化（`kbReady` 判定）
4. **未知工具兑底**（core/ai.js）：模型发起校验器不认识的调用时，不弹确认窗，直接回填错误 tool 消息让模型自我纠正，全流程不打扰用户

## 版本号

- 五处同步 **v1.0.21**（package.json / package-lock.json / tauri.conf.json / Cargo.toml / AGENTS.md 基准版本 + store.js 兑底值）
- 构建验证：`npm run vite:build` 通过

---

## v1.0.19 · 📝 待发布

> **状态**: 📝 待发布（本地 vite 构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.18
> **版本范围**: AI 助手交互体验优化 — 响应中禁止提交（视觉+行为闭环）、发送防抖与输入校验、失败/超时一键重新提交、请求超时保护

---

## 问题背景

AI 助手交互存在三个体验缺口：生成中虽已拦截发送但视觉无忙碌态（弹窗重开时按钮仍显示「发送」有误导）；Enter 连击/快速双击存在重复触发窗口；请求失败/超时后只能手动重新打字，无法一键重发。

## 变更

### 1. 响应中禁止提交（src/views/ai-chat.js）

- 新增 `setAISendingUI(on)`：生成中发送按钮切「停止」语义 + composer 加 `ai-busy` 忙碌标记（输入区降噪、提示条追加「AI 回复中，发送已暂停」）；结束/错误后自动恢复「发送」
- `openAIAssistant` 打开时若后台仍在生成（弹窗中途关过再重开），立即恢复忙碌态：按钮为「停止」（可中断后台流），Enter/点击发送均被拦截并 toast 提示
- `requestAISend` 的 chatting 拦截保持（含 Enter、快捷提问、openAIWithMessage 等所有入口）

### 2. 发送防抖 + 输入校验（src/views/ai-chat.js）

- 发送入口 300ms 防抖门槛：窗口内重复触发直接忽略（Enter 连击/快速双击不再产生重复请求）
- 提问长度校验：超过 8000 字给出明确 toast 提示并阻止发送
- 通用 `debounce(fn,delay)` 工具（core/utils.js）已存在，项目其他表单可复用同一工具逐步接入

### 3. 失败/超时一键重新提交（src/views/ai-chat.js + core/ai.js）

- 请求失败/超时/手动停止时，消息持久化 `retry` 字段（原始问题 + 原始快照 + 原因），气泡下渲染「⟳ 重新提交此问题」按钮
- `retryAIMessage(id)` 点击后用原始问题与快照重新走完整发送流程（含知识库检索、确认弹窗、防抖门）；弹窗未开时自动先打开
- web 直连分支新增 120 秒请求总超时（`REQUEST_TIMEOUT_MS`）：超时自动 abort 并区分文案「请求超时（120 秒未完成）」；`state.abortReason` 区分 manual/timeout；tauri 桌面版无原生中止能力，超时保护仅浏览器直连生效

## 版本号

- 工作区并行迭代（自动更新/知识库检索等）已将版本推进至 v1.0.18；本迭代在其基础上 +1 → **v1.0.19**（五处同步：package.json / package-lock.json / tauri.conf.json / Cargo.toml / AGENTS.md 基准版本 + store.js 兜底值）
- 构建验证：`npm run vite:build` 通过

---

## v1.0.15 · 📝 待发布

> **状态**: 📝 待发布（本地 vite 构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.14
> **版本范围**: AI 主动检索知识库 —— 把 KB 从「发请求前一次性注入」升级为「模型可按需调用的检索后端」

---

## 问题背景

v1.0.14 的知识库（`core/kb.js`）与 AI（`core/ai.js`）是「单向一次性」耦合：发送请求前由 `buildPromptBlock` 取 Top-N 片段拼入 system prompt，**模型本身感知不到 KB 的存在**。这导致四个短板：

1. 模型不能主动检索 —— 命中不准时无法换关键词再查一次；
2. 模型不能按文件定位原文 —— 无法核对上下文；
3. 无命中时模型不知道「没找到」，易凭空编造文件名；
4. 注入片段占用固定 token，与问题无关时浪费上下文。

## 变更

### 1. KB 侧新增主动检索接口（core/kb.js）

- 新增 `search(query, opts)`：复用现有 `tokenize`+`bmQuery`，返回结构化命中 `{ok,count,hits:[{file,rel,chapter,page,score,snippet}]}`，片段截断到 300 字符（`MAX_SNIPPET_CHARS`）省 token；支持 `topN` 覆盖与 `fileFilter` 限定文件内检索。`bmQuery` 加可选 `limit` 参数，`buildPromptBlock` 保持原行为不变。
- 新增 `listFiles(keyword)`：列出知识库全部/筛选文件元数据（名/rel/字符数/分块数/索引时间）。
- 新增 `getFileBlocks(nameOrRel, range)`：取某文件分块全文，累计超 `MAX_GETFILE_CHARS`(4000) 截断并标 `truncated`，`range=[start,end]` 支持翻页。**同步接口**（bootApp 已 init），供 runQuery 直接调用。
- state 新增 `activeRetrieval`(默认 true)/`autoInjectFallback`(默认 false) 两字段；init 恢复、persistMeta + indexDir 内联 kbPut(K_META) 同步持久化；新增 `setActiveRetrieval`/`setAutoInjectFallback` setter；summarize 输出两字段。

### 2. AI 工具协议新增 4 个检索工具（core/ai-tools.js）

- `query_knowledge(query, topN?, fileFilter?)`：常规检索，返回命中片段。
- `search_kb_detail(query, topN?, fileFilter?)`：深检版，在常规命中基础上为每条拼接相邻上下文块。
- `list_kb_files(keyword?)`：列出文件元数据。
- `get_kb_file(nameOrRel, range?)`：取某文件分块全文。
- 全部归入 `TOOL_META` 的 `kind:'query'`，自动执行不经弹窗；runQuery 在 `query_help` 后加 4 分支，统一优雅降级（KB 未加载/未绑定/未启用 → `ok:false` 让模型说明）。`get_kb_file` 复用 `KB.getFileBlocks` 同步接口，避免重复逻辑。

### 3. System prompt 注入知识库工具指引（core/ai.js buildSystemPrompt）

- 在硬性规则 9 后新增「知识库主动检索工具」段：说明 4 个工具的能力与参数、使用时机（用户问及「资料/文档/合同/规格书/历史记录」等先调 query_knowledge，不确定 KB 有什么先 list_kb_files，核对上下文用 get_kb_file，常规检索不用 search_kb_detail 省 token）。
- 硬约束：KB 命中且用于回答时句末必须标注 `【依据：文件名】`；可在同一对话多次调 query_knowledge 精炼关键词；未命中（count:0）明确说「未在知识库中找到」，禁止编造；KB 命中与业务快照冲突时以业务快照为准并说明。

### 4. AI 设置弹窗新增两个开关（views/ai-chat.js）

- `sendAIMessage` 的 KB 注入逻辑改为：仅当 `!activeRetrieval || autoInjectFallback` 时才发请求前注入 Top-N。主动检索开（默认）→ 由模型按需调工具，不再固定注入；关 → 回退旧自动注入模式；自动注入兜底开 → 双保险。
- `kbrenderZone` 新增 `aiRow`（虚线分隔）：「AI 主动检索」「自动注入兜底」两个 checkbox，未绑定时 disabled。
- 新增 `kbSetActiveRetrieval`/`kbSetAutoInjectFallback` setter。
- 引用渲染复用既有 `aiRenderCite`（已把 `【依据：xxx】` 渲染为可点击 chip 调 `kbShowFile` 显示原文），零新增 UI。

## 数据流

```
用户提问 → aiWriteLoop → chat(tools=[…, query_knowledge, list_kb_files, get_kb_file, search_kb_detail])
  → 模型调 query_knowledge(query) → AIT.runQuery → KB.search → hits
  → 模型基于 hits 回答(标【依据：文件名】) 或再精炼 / 调 get_kb_file 深查
  → ai-chat 渲染：【依据：file】 可点击 → kbShowFile 弹窗显示原文分块
```

## 验证

- `npm run vite:build` 通过（322 模块，dist/index.html + assets + vendor + images，file:// 可运行）
- grep 校验：kb.js（search/listFiles/getFileBlocks/setActiveRetrieval/setAutoInjectFallback/MAX_SNIPPET_CHARS/MAX_GETFILE_CHARS/activeRetrieval/autoInjectFallback 全部落盘）、ai-tools.js（4 工具名 + KB.search/listFiles/getFileBlocks 调用点）、ai.js（KB 工具指引段）、ai-chat.js（sendAIMessage 注入逻辑 + aiRow + 2 setter）

## 不在本版本范围（YAGNI，留作后续独立 spec）

- 向量/语义检索 + 混合排序 + OCR（路径 B）
- 业务数据联动（文档↔供应商/订单关联、合同结构化抽取、AI 结论回写）（路径 C）
- 预置行业知识库（GB/DIN/ISO 标准、强度等级、表面处理代号）（路径 D）

## 版本号

- `package.json` / `package-lock.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `AGENTS.md` 基准版本同步递增至 **v1.0.15**

---

## v1.0.14 · 📝 待发布

> **状态**: 📝 待发布（本地构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-27
> **上一版本**: v1.0.13
> **版本范围**: 知识库 PDF 解析收尾修复 — pdfjs-dist v6 API 差异（destroy）导致已提取成果整体作废

---

## 问题背景

v1.0.13 的失败明细提示定位到真实根因：8 个 PDF 全部报 `pdf.destroy is not a function`。
pdfjs-dist v6 的 `PDFDocumentProxy` 已移除 `destroy()`（仅保留 `cleanup()`），正确的资源释放入口是 `PDFDocumentLoadingTask.destroy()`。旧写法导致逐页文本**提取全部成功**后，在最后一步清理时报错，整个文件作废（0 文件 / 0 分块）。

## 变更

- parseFile PDF 分支重构：持有 loadingTask 引用；提取逻辑包入 try/finally；finally 中优先 `task.destroy()`，不可用时回退 `pdf.cleanup()`，任一清理失败仅 console 告警，绝不影响已提取结果
- 验证：node 单测 10/10 通过；`npm run vite:build` 通过
- 版本号五处同步（package.json / package-lock.json / tauri.conf.json / Cargo.toml / AGENTS.md 基准版本）

---

## v1.0.13 · 📝 待发布

> **状态**: 📝 待发布（本地构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-27
> **上一版本**: v1.0.12
> **版本范围**: 知识库可用性修复 — PDF 在 file:// 下解析失败兑底 + BM25 词频修正 + 定时增量更新 + 失败明细可见

---

## 问题背景

知识库绑定目录后索引结果为「0 个文件 · 0 个分块」，PDF 文件未被识别。

| # | 问题 | 根因 | 影响 |
|------|------|------|------|
| 1 | **PDF 全部解析失败**（file:// 双击运行时） | 浏览器禁止 `new Worker()`；pdf.js 降级主线程 fake worker 需要全局钩子 `globalThis.pdfjsWorker`，main.js 未提供 | getDocument reject，所有 PDF 报错且被界面吞掉，显示 0 文件 |
| 2 | **BM25 词频失效** | `tokenize` 内部对 token 去重，块内词频（tf）恒为 1、avgdl 失真 | 检索排序退化为纯 IDF，相关片段排不准 |
| 3 | **无定时更新** | 只有手动「重新索引」，目录新增/修改文件无法自动同步 | 违背需求「定时更新」项 |
| 4 | **失败被静默吞掉** | 目录读取异常直接 return、解析 errors 未在数据管理页展示、文件清单缺修改时间 | 出问题只能看到 0 个文件，无法定位 |

## 变更

### 1. PDF file:// 兑底（src/main.js + core/kb.js）

- main.js 新增 `import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs'` 并挂到 `globalThis.pdfjsWorker`：真环境仍走独立 Worker 加速，file:// 下自动降级为主线程解析（pdf.js 官方 bundler 集成钩子）
- parseFile 对 PDF/docx 解析器缺失与失败给出明确中文报错

### 2. BM25 词频修正（core/kb.js tokenize）

- 分词不再去重：真实 tf 与文档长度参与打分；查询侧去重由 bmQuery 内部保持；node 单测验证高频词块排序正确

### 3. 定时增量更新（core/kb.js）

- 绑定成功 / 启动恢复后自动开启每 5 分钟静默扫描（仅页面可见时），比对 lastModified+size，未变化的文件复用旧分块不重读盘，新增/变更/删除自动同步进索引
- 提问发送前距离上次索引超时则后台触发一次增量更新（不阻塞本次回答）；断开目录停止定时器
- 文件清单补充 lastModified 修改时间元数据；增量模式下 fileId/块 index 统一重排保持一致性

### 4. 失败明细可见（core/kb.js + views/data.js + views/ai-chat.js）

- 目录读取权限异常不再静默 return，记入错误清单并回传 UI
- 数据管理页与 AI 弹窗的索引结果 toast 统一展示：扫描到的受支持文件数、成功数、分块数与失败文件名明细（前 2 条）；扫到 0 个受支持文件时明确提示检查所选目录

## 版本号

- `package.json` / `src-tauri/tauri.conf.json` / `AGENTS.md` 基准版本同步递增至 **v1.0.13**
- AGENTS.md 豁免段更新：「唯一豁免」改为豁免清单，第 2 项登记 pdfjs-dist / mammoth 及其打包挂载方式与 pdfjsWorker 兑底钩子约束
- 构建验证：`npm run vite:build` 通过；kb.js 通过 node VM 单测（词频修复/BM25 排序/分块尺寸/归一化兼容）

---

## v1.0.12 · 📝 待发布

> **状态**: 📝 待发布（本地构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-27
> **上一版本**: v1.0.11
> **版本范围**: AI 升级一期 — 本地知识库 RAG（目录即知识库：多格式解析 → 本地 BM25 检索 → 带依据回答）

---

## 功能背景

AI 助手此前只基于脱敏经营快照回答，无法引用本地业务文档（规格书、质量手册、往来文件等）。一期引入「目录即知识库」的纯前端 RAG：绑定本机目录即完成知识库，提问时离线检索相关片段注入上下文，回答带源文件引用。

| 能力 | 方案 |
|------|------|
| 解析格式 | md/txt 直读（剥 BOM）；PDF 用 pdf.js 提文本层；docx 用 mammoth 提纯文本 |
| 分块 | 目标 500 字（400~600 区间），每块携带源元数据：**章节**（md 标题）/ **页码**（PDF 行级映射） |
| 存储 | 独立 IndexedDB 库 `wb_fastener_kb`（与业务库隔离）：目录句柄 + 文件清单 + 分块全文全量落库 |
| 检索 | 本地 BM25 纯前端计算（中文 bi-gram + 英文单词分词），不依赖 oMLX、不联网、不消耗 token |
| 注入 | Top-N（默认 4，可选 3~5）片段拼入 system prompt，随经营快照一起发给接口；相关度低于阈值（<0.6）不注入省 token |
| 引用 | 回答标注【依据：文件名】，可点击弹窗查看原文分块（含章节/页码） |

## 变更

### 1. 数据管理页新增「知识库」区块（src/views/data.js）

- 目录选择/重新索引/断开、已绑定目录、文件数·分块数·占用估算、最近索引时间、索引中状态、错误提示
- 检索开关「提问时检索知识库」、注入 Top-N（3/4/5）、回答来源标注开关
- 与 AI 设置弹窗内 `kbZone` 双入口共享同一 KB 状态，任一入口操作即时同步

### 2. 知识库核心模块（新文件 src/core/kb.js）

- 独立库 `wb_fastener_kb`（key 分层 meta/dir/files/blocks），接口：init/chooseDir/rescan/unbind/setEnabled/setTopN/setCite/buildPromptBlock/fileBlocks/summarize/tokenize/splitBlocks/isSupported/bmQuery
- 解析：`window.__KB_DEPS` 桥接 npm 依赖（pdfjs-dist 独立打包 worker、mammoth）；单文件超 200 万字符跳过，递归深度 ≤3
- 分块：md 标题追踪章节；PDF 逐页收集 → 按行映射页码 → 块记录块首行页码；兼容旧版纯字符串块自动归一化
- BM25：相关度阈值过滤后再取 Top-N（低分弱命中不注入）

### 3. 提问链路与引用（src/views/ai-chat.js）

- 提问时注入 `KB.buildPromptBlock()` 生成的【知识库参考】（命中片段含文件名/章节/页码标注）
- 回答中【依据：文件名】渲染为可点击按钮，弹窗按分块展示原文（新增章节/页码标注）
- main.js 挂载 __KB_DEPS 并设置 pdf.js worker 地址；App.vue SCRIPTS 注册 kb.js；app.js bootApp 挂载 KB.init()

### 4. 依赖（package.json）

- 新增 `pdfjs-dist ^6.2.108`、`mammoth ^1.12.1`

## 二期/三期预告

- 二期：图片 OCR（桌面 macOS Vision / 网页 Tesseract.js）+ 表格文件（xlsx）
- 三期：oMLX 本地 embedding 模型（如 bge-m3）做混合检索 + 对话传图视觉问答（需另装 VL 模型）

## 版本号

- `package.json` / `package-lock.json` / `src-tauri/tauri.conf.json` / `Cargo.toml` / `store.js` / `AGENTS.md` 六处同步递增至 **v1.0.12**
- 验证：`npm run vite:build` 通过；kb.js 算法单测 19/19 通过（分词/分块/章节/页码/BM25 排序/阈值过滤）

---

## v1.0.11 · 📝 待发布

> **状态**: 📝 待发布（本地构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-27
> **上一版本**: v1.0.10
> **版本范围**: AI 对话持久化修复 — 接口未返回时关闭弹窗/中途退出不再丢失对话内容

---

## 问题背景

AI 使用过程中，如果没有等接口返回（或接口没完全返回）就关闭了 AI 弹窗，再次进入 AI 助手时对话内容无法看到。

| 环节 | 修复前行为 | 后果 |
|------|-----------|------|
| 助手回复落盘时机 | 流式全部完成后才写入 DB | 未完成前 DB 里只有用户消息，界面出现无回复的空档 |
| 关闭弹窗后再完成 | 结果写入已被移除的旧 DOM 节点 | 重开的弹窗永远不显示该条回复 |
| 中途退出应用 | 未完成的回复未落盘 | 回复彻底丢失 |
| 点「停止」 | 整段丢弃已流出的内容，只存一句「已停止生成。」 | 已生成部分看不到 |

## 变更

### 1. 助手消息改为「创建即入库 + 流式增量防抖落盘」（src/views/ai-chat.js）

- 发送瞬间即创建带 `id` 的助手消息对象并推入 `DB.aiChats`（与用户消息顺序一致），随流式 chunk 更新内容并 `saveDBDebounced(800)` 增量落盘；完成后 `pending=false` 并 `saveDB()` 终态固化
- 关闭弹窗后台请求照常完成并已入库：重开弹窗即可看到完整回复；中途退出最多丢最后 <1s 的增量内容
- 流式渲染改为按 `data-ai-id` 实时定位气泡：弹窗关闭再打开也能命中新 DOM，边生成边可见（旧实现缓存节点，弹窗重建后写入失效节点）
- 「停止」/出错不再整段丢弃：保留已生成部分，仅在末尾追加「已停止生成，以上为已生成部分」或「请求失败：…」说明
- 进行中消息不可删除（删除按钮对 `pending` 消息隐藏）；回复生成期间重复发送给出明确 toast 提示

### 2. 加载时清理中断残留（src/core/store.js）

- `ensureDBFields()` 中清除 `aiChats` 内残留的 `pending` 标记（上次会话流式中断退出所致），避免重开后永久光标闪烁

### 3. 页面隐藏/关闭刷盘兜底（src/core/ai.js）

- 监听 `pagehide`：若流式仍在进行，把已入库内容再刷盘一次，最大限度保证退出应用不丢内容

## 版本号

- `package.json` / `src-tauri/tauri.conf.json` / `AGENTS.md` 基准版本同步递增至 **v1.0.11**
- 构建验证：`npm run vite:build` 通过（dist 产物可双击运行）

---

## v1.0.10 · 📝 待发布

> **状态**: 📝 待发布（本地构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-27
> **上一版本**: v1.0.9
> **版本范围**: 数据备份能力重构 — 备份提醒 + 自动快照（按天间隔）+ 保留份数自动清理 + 快照隔离目录

---

## 变更

### 1. 自动备份重构为分段式完整逻辑

| 能力 | 之前 | 现在 |
|------|------|------|
| 自动备份入口 | 单一周期下拉（关闭/每天/每周/每月）+ 开关 | **备份提醒** 与 **自动快照** 独立开关，各自可设间隔天数 |
| 备份间隔 | daily / weekly / monthly | **每 N 天**（1/3/7/14/30 可选，默认 7 天） |
| 备份提醒 | 无 | 独立「备份提醒」开关 + 间隔；超期未备份时应用启动后弹窗提醒（一键立即备份 / 稍后提醒），每个周期仅提醒一次（lastRemindAt 防重复） |
| 保留份数 | 无上限，无人值守清理 | **保留份数**（5/10/20/30/50 份，默认 20 份），超出自动删除最旧快照（pruneOldBackups 联动手动/自动备份） |
| 快照存放 | 桌面：数据目录根；网页：所选目录根 | 统一写入备份目录下 **`backups/` 子目录**，与数据文件隔离 |
| 调度 | 启动 3 秒检查 + 每分钟轮询（后台不轮询、失败冷却 10 分钟） | 不变；启动 3 秒同时检查「到期备份 + 备份提醒」 |
| 旧配置兼容 | — | period（daily/weekly/monthly/off）自动迁移为 intervalDays，保留 enabled / lastBackupAt，无需重新设置 |

**变更文件**：`src/core/store.js`（backupCfgGet 迁移逻辑 + setBackupEnabled / setBackupInterval / setKeepCount / setRemindEnabled / setRemindInterval + `_backupSnapDirHandle`（网页版快照子目录）+ `pruneOldBackups`（保留清理）+ `checkBackupReminder`（提醒）+ nowBackup / maybeAutoBackup 联动）、`src/views/data.js`（renderBackupSection 分段布局「上次备份·立即备份 / 备份提醒 / 自动快照 / 保留快照份数 / 备份目录」+ 各分段 handler）、`src-tauri/src/lib.rs`（backup_root → 应用数据目录 `backups/` 子目录，自动创建）

### 2. 验证

- `node --check` 语法通过；`vite build` 成功；`cargo check` 通过
- 旧配置迁移单测 6 用例全部通过（daily / weekly / monthly / off / 新版完整配置 / 损坏 JSON）
- 浏览器冒烟：数据管理-备份与恢复 4 分段齐全、勾选与下拉交互正常、无 JS 报错，截图归档 output/

---

## v1.0.9 · 📝 待发布

> **状态**: 📝 待发布（构建验证后改为 ✅ 已发布）
> **发布日期**: 2026-08-26
> **上一版本**: v1.0.7
> **版本范围**: 全局 AI 搜索 + 多模型接入 + 工具撤销回滚 + 本地模型认证适配 + AI 体验修复

---

## 变更

### 1. 全局 AI 搜索（⌘K 命令面板）

- ⌘K / topbar 搜索按钮唤起命令面板，六源搜索（订单 / 客户 / 报价 / BOM / 结算 / 发票），直达详情或对应视图
- 键盘导航：↑↓ 循环选择、Enter 打开、Tab 问 AI、Esc 关闭；`?`/`？` 前缀强制问 AI；空态一键问 AI
- 选中条目可作为上下文注入 AI 快照（askAIOnItem）
- 输入防抖 150ms + 结果 40 条上限 + 关键字高亮（原文定位，实体不错位）；样式与全站表单统一

**变更文件**：`src/views/search-panel.js`（新增）、`src/views/keyboard.js`（⌘K + Esc 优先级 + 快捷键说明）、`src/core/router.js`（topbar 按钮）、`src/App.vue`（SCRIPTS 注册）、`src/styles/components.css`（.cmd-* 样式）

### 2. 多模型接入（OpenAI 兼容格式）

| 项目 | 之前 | 现在 |
|------|------|------|
| 模型端点 | 硬编码 DeepSeek（api.deepseek.com/v1） | **设置中可配置 Base URL + 模型名**，任意 OpenAI 兼容端点（含 Base URL 格式校验） |
| 预置模型 | deepseek-v4-flash / pro | + gpt-4o-mini / gpt-4o / qwen-plus / glm-4-flash / llama3 / qwen2.5 + 自定义模型名 |
| 端点预设 | — | 一键按钮：DeepSeek / OpenAI / 通义千问 / 本地 Ollama / 本地 oMLX |
| 本地 Ollama | 不支持 | 支持（http://127.0.0.1:11434/v1，API_KEY 可留空） |
| 本地 oMLX | 不支持 | 支持（http://127.0.0.1:8000/v1，API_KEY 需与 oMLX 设置一致） |
| 端点显示 | 固定"DeepSeek" | providerLabel 按域名自动识别（DeepSeek/OpenAI/通义/智谱/本地模型） |

**变更文件**：`src/core/ai.js`（PRESET_MODELS / DEFAULT_BASE_URL / setProvider / apiChatUrl / webChat 动态端点 / probeProxy 本地免 Key）、`src-tauri/src/lib.rs`（base_url 参数 + URL 组装 + 模型校验放宽）、`src/views/ai-chat.js`（设置弹窗 + 端点预设 + 回显）

### 3. 工具执行撤销 / 回滚

| 项目 | 之前 | 现在 |
|------|------|------|
| 工具改动 | 确认弹窗 + diff 预览，执行后不可撤销 | **持久化批次撤销**：按 aiOps 审计反向回滚（创建→删除、修改→还原旧值、删除→恢复），刷新不失效、不误伤手动改动 |
| 撤销入口 | — | 消息下方「撤销本轮改动」按钮（支持一轮多批次，逗号分隔批量撤销）；数据管理-操作历史可追溯 |

**变更文件**：`src/core/ai.js`（lastBatchIds / undoLastBatch）、`src/views/ai-chat.js`（undoAIBatch + 撤销条）、aiOps 审计（undoBatch 持久化回滚）

### 4. 本地模型认证适配（Ollama / oMLX）

- **Ollama**：本地端点无 Key 时发送占位 `Bearer ollama`（其 OpenAI 兼容层要求 Authorization 头非空，空值 401 "API key required"）
- **oMLX**：**已保存的真实 Key 优先**（oMLX 校验 Key 与自身配置逐字一致，占位会被拒 "Invalid API key"）；修复此前"本地端点一律用占位导致 401"
- 错误显示增强：连接失败显示 URL + 原因；HTTP 错误附服务端原始响应；未知错误 JSON 兜底——不再出现"请求失败：undefined"

**变更文件**：`src/core/ai.js`（authKey 优先级 / fetch 网络错误包装 / SSE 兼容非 data: 行 / HTTP 原始响应）、`src-tauri/src/lib.rs`（Token 优先级修正：真实 Key > 本地占位 > 报错 / 文案通用化）、`src/views/ai-chat.js`（错误兜底 / oMLX 预设与提示）

### 5. AI 体验修复与打磨

- 欢迎区（"开始一段新对话"）发送消息后残留 → **发送时自动移除**
- 全局搜索审查修复（9 项）：全角问号触发、高亮实体错位、↑↓ 循环、订单金额搜索、遍历提前终止、多批次撤销、Base URL 格式校验、错误兜底显示
- 发送确认弹窗只弹一次（localStorage 记忆，延续 v1.0.7）

**变更文件**：`src/views/ai-chat.js`、`src/views/search-panel.js`、`src/core/ai.js`

### 6. AI 输入框快捷键调整

| 按键 | 之前 | 现在 |
|------|------|------|
| `Enter` | 换行 | **直接发送** |
| `⌘ / Ctrl + Enter` | 发送 | 换行 |
| `Shift + Enter` | 换行 | 换行（不变） |

**变更文件**：`src/views/ai-chat.js`（handleAIInputKey + 输入框提示文案）

---

## 版本号

v1.0.7 → v1.0.9（`package.json` / `src-tauri/tauri.conf.json` / `AGENTS.md` / `src/core/store.js` 四处同步）

## 📝 规划中 · AI 能力升级（待排期）

> **状态**: ✅ 三项已全部落地（v1.0.9，2026-08-26）；本分节保留作为计划历史
> **计划来源**: 2026-08-26 AI 升级路线评审

### 1. 全局 AI 搜索（⌘K 命令面板）

- 快捷键 ⌘K 唤起命令面板，搜索订单 / 客户 / 报价等业务数据
- 搜索结果可直接进入 AI 问答（选中条目作为上下文提问）

### 2. 多模型接入（OpenAI 兼容格式）

- 现状：模型与端点硬编码 DeepSeek（ALLOWED_MODELS / WEB_API_URL）
- 目标：支持任意 OpenAI 兼容端点（其他云模型 / 本地 Ollama），设置中可配置 Base URL + 模型列表

### 3. 工具执行撤销 / 回滚

- 现状：工具改动有确认弹窗 + diff 预览，但执行后不可撤销
- 目标：工具执行后提供一键还原（快照式撤销，含批量操作）

---

## v1.0.7 · ✅ 已发布

> **状态**: ✅ 已发布
> **发布日期**: 2026-08-26
> **上一版本**: v1.0.6
> **版本范围**: AI 助手常用提问区优化（空间压缩 + 对话后隐藏）

---

## 变更

### 常用提问区优化（AI 助手面板）

| 项目 | 之前 | 现在 |
|------|------|------|
| 布局 | 2 行 × 4 列网格（约占面板 15% 高度） | **单行横向滚动 chips**（约 30px，可左右滑动） |
| 显示条件 | 始终显示 | **仅冷启动（无对话历史）显示**；一旦有对话记录即隐藏 |
| 清空对话后 | 不恢复 | 恢复显示（clearAIHistory / 删除最后一条消息均触发） |

**变更文件**：`src/views/ai-chat.js`（openAIAssistant 条件渲染 + clearAIHistory/deleteAIMessage 恢复逻辑）、`src/styles/components.css`（ai-actions 单行滚动布局）

### AI 发送确认提示只弹一次（不递增版本号）

| 项目 | 之前 | 现在 |
|------|------|------|
| 发送确认弹窗 | 每次发送 AI 消息都弹出「确认发送数据」 | **仅首次发送弹出**，确认后记住（localStorage），后续发送直接进行，不再重复提醒 |

**变更文件**：`src/views/ai-chat.js`（requestAISend）

---

## v1.0.6 · ✅ 已发布

> **状态**: ✅ 已发布
> **发布日期**: 2026-08-26
> **上一版本**: v1.0.5
> **版本范围**: 回收站自动清理 + 功能层确认策略 + 统计报表 + AI 工具链路修复 + 系统帮助知识库 + 操作协助

---

## 一、版本概览

v1.0.5 后的批量增量（含三项规划优化 + 六项问题修复 + 两项能力扩展），聚焦数据安全、协议可靠性、AI 可用性与系统帮助体系：

- **回收站自动清理**：90 天保留期 + 超期自动清理（数据安全，防无限膨胀）
- **功能层工具确认策略**：三分流确认策略完善，导出操作纳入审计（可追溯）
- **AI 操作统计报表**：操作历史新增全量统计面板（可视化运营）
- **AI 工具链路修复**：HTTP 400 协议错误（tool_calls 透传）、设置弹窗无反应、确认弹窗渲染、执行后不刷新
- **AI 可用性增强**：API_KEY 编辑态回显与格式校验、上下文自动压缩、敏感字段策略简化
- **系统操作协助**：打开业务表单工具 + 浓缩操作指引 + 完整帮助知识库（query_help）

---

## 二、新增与优化

### 2.1 回收站自动清理

回收站从「永久保留 + 手动清空」升级为「90 天保留 + 自动清理」：

| 项目 | 设计 |
|------|------|
| 保留期 | `TRASH_RETENTION_DAYS = 90`（store.js 常量，可调） |
| 触发时机 | 应用启动（initApp 数据加载后，含降级模式）+ 打开回收站（renderTrash 渲染前） |
| 幂等 | 每天最多执行一次（localStorage `TRASH_CLEANUP_KEY` 记录上次清理时间），`force` 参数可绕过（供自检/手动） |
| 关联处理 | 清理时关联的未回滚 delete 类 aiOps 标记 `autoPurged`：操作历史显示「已自动清理」灰标、不提供回滚按钮；`undoAiOp` 对 autoPurged 记录直接拒绝（双保险） |
| 隔离边界 | 清理是系统平台行为，与「AI 与回收站隔离」原则不冲突——AI 仍无任何回收站操作能力 |
| 用户提示 | 自动清理时 toast「已自动清理 N 条超过 90 天的回收站记录」；回收站工具栏显示保留期说明 |

### 2.2 功能层工具确认策略

aiWriteLoop 三分流确认策略完善（功能层工具自动执行，导出纳入审计）：

| 工具类别 | 副作用 | 确认 | 审计 | 回滚 |
|---------|--------|:---:|:---:|:---:|
| 查询（query_*） | 无 | 自动执行 | 不记 | — |
| 功能层：navigate_view / open_*_drawer | 无（纯 UI） | 自动执行 | 不记 | — |
| 功能层：export_order_excel | 有（生成文件） | 自动执行 | ✅ 记 `op:'export'` | 不可回滚 |
| 写入/删除/流转 | 有（改数据） | ✅ 确认弹窗 | ✅ 记 aiOps | ✅ 可回滚 |

**核心原则**：功能层工具不打断对话流，但有副作用的导出必须可追溯。操作历史新增「导出」徽章（蓝色 info 样式），记录导出时间、订单、操作者（AI）；`undoAiOp` 增加 `case 'export'` 防御（抛错「导出操作不可回滚」）。

### 2.3 AI 操作统计报表

操作历史 tab 顶部新增 `renderOpsStats()` 统计面板（全量统计，不受筛选影响）：

- **六项指标卡**：总操作 / AI 操作（含占比）/ 用户操作 / 已回滚（含 AI 回滚率）/ 操作批次 / 自动清理
- **操作类型分布**：create/update/delete/restore/flow/assign/export × AI/用户拆分 + AI 占比条形图
- **数据域分布**：单位/属性/BOM/报价/订单/明细/结算/发票/导出 次数 + 占比条形图（降序）
- **近 7 天趋势**：每日操作数 CSS 柱状图（无图表库依赖，柱顶显示数值）

---

## 三、验证

- 回收站自动清理逻辑测试 8/8（过期清理/未过期保留/aiOps 标记/回滚拒绝/幂等）
- 统计报表逻辑测试 12/12（指标数值/分布/趋势渲染）
- vite build 通过（772KB）

---

## 四、变更文件

| 文件 | 变更 |
|------|------|
| `src/core/store.js` | TRASH_RETENTION_DAYS / autoPurgeTrash / undoAiOp autoPurged+export 防御 / initApp 触发 |
| `src/views/data.js` | renderTrash 触发清理 + 保留期提示 + renderOpsStats 统计报表 + autoPurged/导出展示 |
| `src/core/ai.js` | aiWriteLoop flow 分支导出审计 |
| `src/styles/components.css` | ops-stats 统计样式 |
| `docs/API.md` | 自动清理与确认策略说明 |

---

### 2.4 AI 工具链路修复

| 问题 | 根因 | 修复 |
|------|------|------|
| HTTP 400「Messages with role 'tool' must be...」 | chat() 序列化丢弃 assistant 的 `tool_calls` 与 Rust 端 ChatMessage 无对应字段、role 白名单不含 tool | 前端 webChat/tauri 分支透传 tool_calls/tool_call_id；Rust ChatMessage 扩展字段 + 白名单加 tool + tool 消息上限 200KB；aiWriteLoop 归一化 tool_calls id（缺失时 uid 生成） |
| 点击「设置」无反应 | ai.js 导出列表漏 getDeepseekToken（上一轮脚本中断遗留） | 补导出 + openAISettings try/catch 防御 |
| 确认弹窗 contacts 显示 [object Object] | fmtOpsVal 对对象数组用 join() 隐式转字符串 | 递归格式化（数组逐项/对象过滤空字段） |
| 执行后弹窗不关、列表不刷新 | confirmOpsModal 未 closeModal；sendAIMessage 未 render | 执行按钮先关弹窗；有成功操作时 render() 刷新当前视图 |

### 2.5 AI 可用性增强

- **API_KEY 编辑态回显**：新增 Rust 命令 `ai_deepseek_token_get`，设置弹窗回显真实 Key（编辑态可见，非编辑态不展示）；前后端 `sk-` 格式校验双保险
- **上下文自动压缩**：历史携带量 6→20 条；总字符超 20000 触发一次 AI 摘要压缩（[system + 摘要 + 当前问题]），失败降级不阻塞
- **敏感字段策略简化**：AI 直接提取对话中的电话/税号/银行/地址等（用户提供即授权），确认弹窗移除敏感字段输入区；schema 6 字段普通化

### 2.6 系统操作协助与帮助知识库

- **4 个打开表单工具**：open_unit_form / open_order_form / open_price_form / open_bom_form（AI 手把手引导录入）；功能层工具 4→8 个
- **浓缩操作指引注入 prompt**：九大模块操作要点（A-I）
- **完整帮助知识库**：`src/core/help-knowledge.js` 12 主题（概览/各模块/数据管理/AI 助手/常见问题），`query_help` 工具按关键词打分检索（标题3/关键词2/正文1），按需返回不占常规 token

### 2.7 版本日志规范（本次起生效）

**每次优化/修复：版本号 v1.0.x+1 递增（package.json / tauri.conf.json / AGENTS.md 三处同步）+ 写入 docs/version 日志分节**。v1.0.6 为规范起点，下一次 = v1.0.7。

### 后续规划（未来升级迭代方向）

- **行业知识库扩展**：将紧固件行业知识（材料牌号对照、热处理工艺、表面处理标准、螺纹规格体系、常见标准 GB/T/DIN/ISO 等）持续灌输到 `HELP_KNOWLEDGE` 知识库——AI 不仅能指导系统操作，还能作为**行业顾问**（选材建议、规格换算、标准查询、工艺答疑），配合现有 query_help 检索机制按需调用，不增加常规对话成本。新增主题只需在 `src/core/help-knowledge.js` 的 `HELP_KNOWLEDGE` 数组追加条目，零协议改动。

---

## v1.0.5 · ✅ 已发布

> **发布日期**: 2026-08-26
> **上一版本**: v1.0.4
> **版本范围**: AI 数据操控升级方案 · 阶段 4（功能层 + 打磨）+ 全面审查修复

---

## 一、版本概览

本次版本是「AI 数据操控升级方案」四个阶段全部完成后的功能层落地与代码打磨版本。

- **阶段 1**（数据模型 + 回收站 + 操作历史）→ v1.0.1
- **阶段 2**（Function Calling 协议）→ v1.0.2
- **阶段 3**（全量工具 + 订单复杂操作）→ v1.0.3
- **阶段 4**（功能层 + 打磨）→ v1.0.4
- **全面审查与修复**（P0/P1/P2/P3 共 12 项）→ **v1.0.5**

AI 现可对单位、属性、BOM、报价、订单、结算、发票数据进行增删改查（删除走回收站软删除），并支持视图导航、Excel 导出、打开抽屉等功能层动作。所有写入操作均生成操作日志，支持单条/整批回滚。

---

## 二、新增功能

### 2.1 功能层工具（4 个，自动执行不经弹窗）

| 工具名 | 用途 | 触发动作 |
|--------|------|---------|
| `navigate_view` | 视图导航 | 跳转到 dashboard/units/specs/bom/prices/orders/settlements/invoices/data 及细分视图 settle-receipt/settle-payment/inv-issue/inv-receive；viewName=orders 且提供 orderId 时导航到订单详情 |
| `export_order_excel` | 导出 Excel | 触发浏览器下载，按订单状态自动选择导出模板（待确认/寻货中/报价中/签约完成/送货中等） |
| `open_settlement_drawer` | 打开结算抽屉 | 调用 `openSettleDetail(unitId, tabType)`，tabType 支持 receipt/payment |
| `open_invoice_drawer` | 打开发票抽屉 | 调用 `openInvEdit(invoiceId)` 进入发票编辑 |

**设计原则**：功能层工具属 `kind:'flow'`，与查询类（query_*）一样自动执行，结果回填给模型，不经用户确认弹窗。

### 2.2 aiWriteLoop 三路分流

`ai.js` 的 `aiWriteLoop` 现按工具类型分流为三路：
- **查询类**（query_*）→ 自动执行，结果回填
- **功能层**（flow 类）→ 自动执行 UI 动作，结果回填
- **写入类**（write/delete）→ 走用户确认弹窗，批量执行写入 DB + aiOps

通过 `AIT.FLOW_TOOL_NAMES`（Set 集合）识别功能层工具，引入 `flowSet` 局部变量统一防护 AIT 未加载场景。

### 2.3 错误处理边界

新增 `_friendlyError(e)` 错误分类器，把底层异常转换为对用户友好的中文提示：

| 异常类型 | 转换结果 |
|---------|---------|
| AbortError（用户主动中止） | 透传，由调用方专门处理 |
| TypeError / `Failed to fetch` / `NetworkError` / `loadfailed` | 「网络连接失败，请检查网络后重试」 |
| 含 `tauri` / `invoke` / `非 Tauri 运行时` | 「AI 服务调用异常：...」 |
| 含 `stream` / `sse` / `eventsource` | 「AI 响应流中断，请重试」 |
| HTTP 4xx/5xx（已在 webChat 包装） | 原样透传 |

`chat()` 函数包裹 `_friendlyError`，所有网络/流式/tauri 异常在到达 ai-chat.js 之前已完成分类。

### 2.4 并发脏读检测

引入 `__beforeFingerprint` 机制，防止用户在确认弹窗期间数据被外部并发修改：

- **ai-chat.js** `confirmOpsModal` 在用户确认时，为每条 op 注入 `__beforeFingerprint`（基于 `validation.preview.before` 的 JSON 字符串）
- **ai-tools.js** `_checkDirty(op)` 重新调用 validator 拿当前 before，对比指纹
- **executeOp** 单独调用时检测，不一致返回「数据已被修改，请刷新后重试」
- **executeOps** 批量入口先做一次批量脏读检测，任一条不一致整批拒绝；通过后批量内顺序执行不再检测（避免前序 op 修改后续 op 数据误报）

### 2.5 操作历史筛选器

`data.js` 操作历史 tab 新增筛选条，支持三个维度筛选：

| 筛选维度 | 取值 |
|---------|------|
| 操作类型 | 全部 / 新增 / 修改 / 删除 / 恢复 / 流转 / 寻货 |
| 操作者 | 全部 / AI / 用户 |
| 批次 | 全部 / 前 20 个有未回滚 op 的批次（显示前 8 位） |

筛选状态保存在 `window._aiOpsFilter`，切换 tab 或刷新后丢失（属临时筛选）。筛选后无匹配记录时显示「重置筛选」快捷链接。

### 2.6 AI 操控系统自检

新增 `_aiOpsSelftest()` 函数与「自检」按钮（位于筛选条右侧），检查项包括：

1. **aiOps 数据结构** — 是否数组、条数
2. **操作记录字段完整** — id/timestamp/op/type 必备字段
3. **关键函数可用性** — 通过 `_AI_OPS_FNS`（store.js 导出）检查 recordAiOp/undoAiOp/undoBatch/softDelete/restoreFromTrash/purgeTrash/clearTrash 等
4. **AIT 模块加载** — TOOLS_DEFS/validateOp/executeOps/runQuery/runFlow/FLOW_TOOL_NAMES
5. **trash 数组结构** — 是否数组、条数

自检结果以 modal 弹窗展示，全部通过显示绿色「✓ 全部 N 项检查通过」，失败项红色醒目，并通过 toast 反馈摘要。

### 2.7 navigate_view 扩展细分视图

`navigate_view` 的 `viewName` enum 扩展支持 4 个细分视图，AI 可精确控制 tab 切换：
- `settle-receipt`（收款记录）
- `settle-payment`（付款记录）
- `inv-issue`（开票记录）
- `inv-receive`（收票记录）

---

## 三、优化与修复

### 3.1 P0 严重修复（1 项）

| 问题 | 位置 | 修复 |
|------|------|------|
| aiWriteLoop 中 `AIT.FLOW_TOOL_NAMES.has()` 防护不足，AIT 未加载时抛 TypeError | ai.js | 引入 `flowSet` 局部变量统一防护 |

### 3.2 P1 功能修复（5 项）

| 问题 | 位置 | 修复 |
|------|------|------|
| `_friendlyError` 正则 `network` 过宽，可能误判 | ai.js | 收紧为 `Failed to fetch\|\bNetworkError\b\|loadfailed` |
| 自检弹窗 `onOk=null` 导致「关闭」按钮无反应 | data.js | 改为 `function(){closeModal();}` |
| runFlow 异步导出反馈不准，模型可能基于「已导出」做后续推理 | ai-tools.js | 回填措辞改为「已触发 Excel 导出（异步执行，结果以浏览器下载为准）」 |
| navigate_view 副作用大，离开订单编辑模式无提示 | ai-tools.js | 若 `view!=='orders' && curOrder`，先 `closeModal()/closeDrawer()` 并 toast 提示「已离开订单编辑模式」 |
| 抽屉类工具未先关闭已有 modal/drawer，可能层叠 | ai-tools.js | open_settlement_drawer/open_invoice_drawer 调用前先 `closeModal();closeDrawer();` |
| 批量入口完全跳过脏读检测 | ai-tools.js | executeOps 入口先做一次批量脏读检测，任一条不一致整批拒绝；通过后批量内顺序执行不再检测 |

### 3.3 P2 体验优化（5 项）

| 问题 | 位置 | 修复 |
|------|------|------|
| batchUndoneCount 在筛选场景下计数偏小，与 undoBatchConfirm 不一致 | data.js | 改为遍历全量 allOps 统计 |
| navigate_view 缺少 tab 控制 | ai-tools.js | schema enum 与 validators VIEWS 同步扩展 4 个细分视图 |
| 自检按钮带 `icon('check')` 与旁边「重置」按钮风格不一致 | data.js | 去掉 icon，统一为纯文本 `btn sm` |
| `_aiOpsSelftest` 函数名硬编码，store.js 重命名需手动同步 | store.js / data.js | store.js 导出 `_AI_OPS_FNS` 数组，data.js 自检优先引用，降级 fallback 兼容旧版 |

### 3.4 P3 轻微改进（1 项）

| 问题 | 位置 | 修复 |
|------|------|------|
| 筛选下拉不支持按批次筛选 | data.js | 新增「批次」下拉（列出有未回滚 op 的前 20 个批次），renderOpsHistory 应用 batchId 过滤 |

---

## 四、文件改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/core/ai-tools.js` | 新增 + 修改 | 4 个功能层工具 schema/validator/runFlow；_checkDirty 脏读检测；executeOps 批量脏读检测；navigate_view enum 扩展 |
| `src/core/ai.js` | 修改 | aiWriteLoop 三路分流（flowSet 防护）；chat 函数包裹 _friendlyError；buildSystemPrompt 补充功能层工具说明与规则 8 |
| `src/core/store.js` | 新增 | 导出 `_AI_OPS_FNS` 函数名清单 |
| `src/views/ai-chat.js` | 修改 | confirmOpsModal 注入 `__beforeFingerprint` |
| `src/views/data.js` | 新增 + 修改 | renderOpsFilter/_setAiOpsFilter/_aiOpsSelftest；renderOpsHistory 按筛选过滤；batchUndoneCount 改全量统计；自检按钮风格统一 |
| `src/styles/components.css` | 新增 | `.ops-filter-bar` / `.ops-filter-item` / `.ops-filter-summary` / `.selftest-summary` 样式 |
| `package.json` | 版本号 | 1.0.4 → 1.0.5 |
| `src-tauri/tauri.conf.json` | 版本号 | 1.0.4 → 1.0.5 |
| `AGENTS.md` | 版本号 | 当前基准版本 v1.0.4 → v1.0.5 |

---

## 五、升级与验证

### 5.1 构建验证

```
npm run vite:build   ✅ 通过（33 modules，153ms，产物 762.66KB）
npm run tauri:build  ✅ 通过（紧固件贸易工作台.app 生成）
```

### 5.2 产物验证

- `dist/index.html` 双击可运行（零依赖，file:// 协议）
- `__APP_VERSION__` 注入 `v1.0.5`
- `dist/vendor/cpexcel.js` + `dist/vendor/xlsx.min.js` 本地可用（离线导出 Excel）

### 5.3 功能验证建议

| 验证项 | 操作方式 |
|--------|---------|
| 功能层工具 | 在 AI 助手中输入「导航到首页」「导出订单 XXX」「打开单位 YYY 的结算抽屉」等，确认自动执行不经弹窗 |
| 错误处理 | 断网后发起 AI 对话，确认提示「网络连接失败，请检查网络后重试」 |
| 并发脏读 | 在 AI 确认弹窗期间，另一个浏览器 tab 修改同一条记录，确认执行时提示「数据已被修改，请刷新后重试」 |
| 操作历史筛选 | 进入数据管理 → 操作历史 tab，分别按操作类型/操作者/批次筛选，确认计数与 undoBatchConfirm 一致 |
| 系统自检 | 点击「自检」按钮，确认弹窗显示检查项与结果，「关闭」按钮可正常关闭 |
| 回滚 | 单条回滚 / 整批回滚，确认数据恢复 + 操作记录标记「已回滚」 |

---

## 六、已知限制

1. **AI 不可调用回收站相关操作**：trash 表数据隔离，AI 工具不暴露 restore/purge 接口，回收站管理由用户手动操作
2. **批量内顺序修改不检测脏读**：批量入口仅做一次"弹窗→执行"期间的脏读检测，批量内前序 op 修改后续 op 数据属预期顺序执行
3. **筛选状态不持久化**：`_aiOpsFilter` 保存在 window 内存，切换 tab 或刷新后丢失（属临时筛选设计）
4. **Tauri 桌面版 tool_calls 降级**：Rust 侧 ai_deepseek_chat 暂未支持 tool_calls 解析，桌面版 AI 写入流程降级为只读模式，由浏览器版主力承载
5. **敏感字段不在 schema 暴露**：联系人电话/微信、税号、银行账号、单位地址等敏感字段由用户在确认弹窗手动补全

---

## 七、下一版本规划

- Tauri 桌面版 Rust 侧支持 tool_calls 解析，实现桌面版完整 Function Calling
- 操作历史筛选状态持久化（sessionStorage）
- 更多功能层工具（如批量导出、报表生成等）
- 性能监控与 AI 调用统计面板

---

*v1.0.5 · AI 数据操控升级方案完整落地*

---

## v1.0.4 · ✅ 已发布

> **状态**: ✅ 已发布
> **发布日期**: 2026-08-26
> **git 提交**: b79621d（阶段 1-4 代码合并落库）
> **版本范围**: AI 数据操控升级 · 阶段 4（功能层工具 + 打磨）+ 阶段 1-3 代码落库

---

## 一、版本概览

「AI 数据操控升级方案」阶段 4：功能层工具（纯系统动作）、并发脏读检测、自检脚本；同时 v1.0.1-v1.0.3 的本地迭代代码在此提交合并落库（36 个工具全量）。

## 二、新增功能

### 2.1 功能层工具（4 个，自动执行不经弹窗）

| 工具 | 用途 | 触发动作 |
|------|------|---------|
| navigate_view | 视图导航 | go(view) / goOrderView(orderId)，离开订单编辑模式先关弹窗/抽屉 |
| export_order_excel | 导出 Excel | 异步 exportOrder + toast 容错，回填「触发成功」语义 |
| open_settlement_drawer | 打开结算抽屉 | openSettleDetail(unitId, tabType) |
| open_invoice_drawer | 打开发票抽屉 | openInvEdit(invoiceId) |

`AIT.FLOW_TOOL_NAMES`（Set）识别功能层；aiWriteLoop 三路分流：query 自动 / flow 自动 / write 确认弹窗。

### 2.2 并发脏读检测

- 确认弹窗为每条 op 注入 `__beforeFingerprint`（before 快照 JSON）
- `_checkDirty` 执行前重新校验对比；不一致拒绝「数据已被修改，请刷新后重试」
- 批量入口先整体检测，通过后批量内顺序执行不再检测（防前序修改误报）

### 2.3 错误处理边界

- `_friendlyError` 错误分类器：网络失败/流中断/tauri 异常 → 友好中文提示
- 操作历史筛选器：操作类型 / 操作者 / 批次三维筛选

### 2.4 AI 操控系统自检

`_aiOpsSelftest()`：aiOps 结构、记录字段、关键函数可用性、AIT 模块、trash 结构——11 项检查，modal 展示结果

### 2.5 文档

- README「AI 助手」章节；API.md「前端 AI 工具协议」章节；方案/开发计划文档落库

---

## 三、验证

- 工具执行器测试 39/39 + 阶段 1 测试 30/30
- vite build / cargo check / tauri build 三构建通过

---

## 四、变更文件

- `src/core/ai.js`、`src/core/ai-tools.js`、`src/views/ai-chat.js`、`src/views/data.js`、`src-tauri/src/lib.rs`、`README.md`、`docs/API.md`、`AGENTS.md`

---

## v1.0.3 · ✅ 已发布

> **状态**: ✅ 已发布（本地迭代版本，代码随 v1.0.4 提交合并）
> **发布日期**: 2026-08-26
> **版本范围**: AI 数据操控升级 · 阶段 3（全量工具 + 订单复杂操作）

---

## 一、版本概览

「AI 数据操控升级方案」阶段 3：工具集扩展至 34+ 个，覆盖 7 类业务数据全 CRUD、订单寻货/状态流转，补全软删除工具与敏感字段处理。

## 二、新增功能

### 2.1 写入工具补齐（复用系统校验链）

| 工具 | 复用函数 | 要点 |
|------|---------|------|
| create/update_bom | saveBOMForm 校验 | sku 查重 |
| set_spec_value | specs 表单逻辑 | 幂等（已存在跳过） |
| create_order / update_order_meta | newOrder/saveOrder | buyerId 必须为采购商 |
| add/update_order_item | persistOrderItems 链路 | 平铺参数 |
| assign_supplier / add_manual_supplier / remove_sourcing_option | addMatchSupplier 逻辑 | 剩余量校验 + 供应商去重 |
| create/update_settlement | openNewSettlement | type/date/amount 校验 |
| create/update_invoice | openInvEdit | 类型/金额/日期校验 |

### 2.2 软删除工具（8 个）

delete_unit/bom/price/order/spec_value/settlement/invoice + remove_order_item——全部走 `softDelete` 进回收站（删除后即超出 AI 能力范围，原则 1）

### 2.3 敏感字段「待补」交互

- create_unit 确认弹窗显示敏感字段输入区（联系人/电话/税号/开户行/账号/地址）
- AI 不收集敏感信息（schema 声明留空），用户补全后并入执行参数，落库为 contacts/invoice 结构

### 2.4 批量执行与错误处理

- 批量逐条执行，单条失败不中断，汇总「成功 N / 失败 M + 原因」
- 状态流转违规（跳站）执行器强制拒绝；tool_calls 解析失败降级纯文本零执行

---

## 三、验证

- 工具执行器测试 39/39（BOM 查重/幂等/订单校验/寻货余量/软删除/敏感字段落库/批量隔离）

---

## 四、变更文件

- `src/core/ai-tools.js`、`src/views/ai-chat.js`、`src/styles/components.css`

---

## v1.0.2 · ✅ 已发布

> **状态**: ✅ 已发布（本地迭代版本，代码随 v1.0.4 提交合并）
> **发布日期**: 2026-08-26
> **版本范围**: AI 数据操控升级 · 阶段 2（Function Calling 协议接入）

---

## 一、版本概览

「AI 数据操控升级方案」阶段 2：接入 DeepSeek function calling 协议，AI 从「只读问答」升级为「可起草写入操作」，经用户逐条确认后落库。

## 二、新增功能

### 2.1 工具调用协议

- **流式 tool_calls 解析**：web 通道 delta 按 index 累积（id/name/arguments），tauri 通道由 Rust 解析后 emit 给前端同机制累积
- **Rust 代理透传**：lib.rs `UpstreamBody` 加 `tools` 字段、`UpstreamChoiceDelta` 解析 tool_calls、流式 emit `{text, toolCalls}`
- `chat(messages, onChunk, {tools})` 返回 `{content, toolCalls}`；`buildSystemPrompt` 升级为提案模式（工具不自动执行/敏感字段留空/状态机守则）

### 2.2 工具集（起步 5 个写入工具）

create_unit / update_unit / create_price / update_price / flow_order_status

- 校验规则复用业务逻辑：单位查重、供应商角色、价格>0、报价重复检测、BOM 存在性、状态机全路径（NEXT_STATUS）

### 2.3 确认弹窗（AI 操作提案）

- 操作列表：类型徽章 + 目标摘要 + 字段级 diff（旧值→新值）+ 复选框（默认全选）
- 删除项提示「进入回收站可恢复」；被引用实体预警
- 取消/执行选中 N 条（实时计数）；执行进度 toast

### 2.4 多轮工具循环

`aiWriteLoop`：chat(带 tools) → tool_calls → 确认 → 执行 → tool 响应回填 → 继续（上限 5 轮）；取消时回填「用户取消」；纯文本总结直接结束

---

## 三、验证

- 工具执行器测试 30/30（校验/执行/状态机/批量失败隔离/未知工具拒绝）
- cargo check + vite build + tauri build 通过

---

## 四、变更文件

- `src/core/ai.js`、`src/core/ai-tools.js`（新）、`src/views/ai-chat.js`、`src-tauri/src/lib.rs`

---

## v1.0.1 · ✅ 已发布

> **状态**: ✅ 已发布（本地迭代版本，代码随 v1.0.4 提交合并）
> **发布日期**: 2026-08-26
> **版本范围**: AI 数据操控升级 · 阶段 1（数据模型 + 回收站 + 操作历史）

---

## 一、版本概览

「AI 数据操控升级方案」阶段 1：为 AI 写入能力建设数据底座——回收站（软删除）与操作审计日志，全部功能先以手动操作为入口验证。

## 二、新增功能

### 2.1 数据模型扩展

- `DB.trash[]`：回收站隔离区（**隔离式软删除**，非 deletedAt 标记——业务表删除即移除，所有读路径零过滤改动）
- `DB.aiOps[]`：操作日志（审计 + 回滚依据，FIFO 2000 条上限）
- `ensureDBFields()` 补齐新字段；导出/文件同步**剥离 trash/aiOps**（saveToFile/loadFromFile/exportJSON/importJSON 四处）

### 2.2 软删除与回收站

- `softDelete(type, id)` / `softDeleteSpecOption` / `softDeleteOrderItem`：业务表 → trash（深拷贝 + originalId + 操作者）
- `restoreFromTrash`：originalId 原样塞回，关联引用自动恢复有效（uid 机制保证不冲突）
- `purgeTrash` / `clearTrash`：物理删除（仅用户手动，二次确认）

### 2.3 操作历史与回滚

- `recordAiOp`：每条操作记 before/after/batchId/operator
- `undoAiOp`：六种反向执行（create→删 / update→还原 / delete→恢复 / restore→再删 / flow→还原状态 / assign→还原 options）
- `undoBatch`：同批次逆序回滚；回滚单向（undone 标记）

### 2.4 UI

- 数据管理页三 tab：数据管理 / 操作历史 / 回收站
- 现有 7 处删除逻辑迁移为软删除（units/prices/bom/orders/specs/settlements，含批量入口）

---

## 三、验证

- 逻辑测试 30/30（软删除/恢复/六种回滚/整批回滚/FIFO/重复删除保护/恢复不冲突）

---

## 四、变更文件

- `src/core/store.js`、`src/views/data.js`、`src/views/units.js`、`src/views/prices.js`、`src/views/bom.js`、`src/views/orders.js`、`src/views/specs.js`、`src/views/settlements.js`

---

## v1.0.0 · ✅ 已发布

> **状态**: ✅ 已发布
> **发布日期**: 2026-08-26
> **git 标签**: v1.0.0（ae5cf76 Merge PR #1）

---

## 一、版本概览

项目基础版本：Vue3 + Vite 重构完成，AI 只读问答接入，Tauri 桌面封装与 CI 工作流就绪。

## 二、核心功能

### 2.1 业务功能（7 大模块）

- **概览**：今日待处理看板（逾期标红/今日到期/待确认）、统计卡片、最近订单入口
- **关联单位**：供应商/采购商统一管理（双角色）、联系人按角色区分、评级/账期
- **属性管理**：六维枚举（类型/标准/直径/硬度/表面处理/材质）
- **BOM 管理**：SKU 物料清单、批量导入
- **签约报价**：供应商×规格×单价、重复检查、批量删除
- **采购订单**：多供应商分配寻源、七状态流转、寻货弹窗（价格库匹配+手动录入）、收货/验货
- **对账结算 / 发票管理**：收款/付款、开票/收票、关联订单钻取

### 2.2 数据层

- IndexedDB 主存储 + localStorage 草稿 + File System Access API 本地文件同步
- JSON 导入/导出、CSV 导出、Excel 导出（xlsx-js-style 样式版）
- 表单草稿自动保存与恢复

### 2.3 AI 助手（DeepSeek，只读问答模式）

- 脱敏数据快照 + 上下文感知（按当前页面注入）+ 常用提问
- 双通道：浏览器版前端直连（CORS 放行）/ Tauri 桌面版 Rust 代理（API Key 存应用数据目录）
- 流式响应、SSE 解析、可中止

### 2.4 Tauri 桌面封装

- 本地文件存储（data.json 应用数据目录，macOS WKWebView IndexedDB 不可靠的替代方案）
- 应用图标、窗口配置、ad-hoc 签名打包（.app/.dmg）

### 2.5 CI 工作流

- GitHub Pages 在线版部署（vite build，base './' 相对路径）
- Release 自动打包（Windows NSIS+MSI / macOS app+dmg，GitHub Actions 矩阵）

---

## 三、验证

- `npm run build` 通过；`file://` 双击 `dist/index.html` 可用（零依赖运行原则）
- 浏览器版与桌面版双端手测通过

---

## 四、变更文件

- 完整项目初始化：src/（core/views/styles）、src-tauri/、docs/、.github/workflows/、scripts/
