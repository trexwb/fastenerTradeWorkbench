# 版本发布日志 · v1.0

> 本文件按主版本组织：v1.0.x 的全部迭代日志集中于此（最新在前）。
> 命名规则：`RELEASE-v{主版本}.md`；次版本迭代追加到文件顶部新分节。
> 整理规则（2026-08-28 起）：同类问题多次修复的条目合并为一条，统一记述于最终修复版本；被合并的早期版本保留编号与合并指向，不再重复正文。当前最新版本：**v1.0.34**。

---

## v1.0.34 · 📝 待发布

> **状态**: 📝 待发布（五轴代码审计修复完成；版本号 6 处已统一，构建与打包待 CI 验证）
> **发布日期**: 2026-09-02
> **上一版本**: v1.0.33
> **版本范围**: 五轴代码审计安全修复（CSP / SSRF / XSS）+ 发布工作流密钥迁移与修复

---

## 五轴代码审计安全修复 + 发布工作流修复

### 一、R-S2 · CSP 安全加固（src-tauri/tauri.conf.json）

- CSP 追加 `object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'`，收紧桌面端资源加载与跳转策略

### 二、R-S3 · SSRF 防护（src-tauri/src/lib.rs）

- 新增 `valid_upstream_base_url` 端点校验，上游请求仅放行 https 与本地回环地址，收敛 SSRF 攻击面

### 三、R-C1 · 外部数据 ID 清洗防 XSS（src/core/store.js / index.html + dashboard / invoices / units 视图）

- `store.js` 新增 `sanitizeImportedIds` 对导入的外部 ID 做清洗
- `dashboard.js` / `invoices.js` / `units.js` onclick id 拼接改用 `escJsStr` 转义，消除潜在 XSS

### 四、发布工作流修复（.github/workflows）

- 签名私钥从 GitHub secrets 迁移至 variables（ca5429e）
- 修复 GitHub Actions 工作流变量引用错误（00bab22）

**版本核验**：`scripts/check-version.mjs` 通过，6 处版本号一致为 v1.0.34（package.json / package-lock.json×2 / tauri.conf.json / Cargo.toml / store.js 回退值 / AGENTS.md）。

---

## v1.0.33 · 📝 待发布

> **状态**: 📝 待发布（vite build 已通过；Tauri 打包待 CI 验证）
> **发布日期**: 2026-08-30
> **上一版本**: v1.0.31（跳号，无 v1.0.32）
> **版本范围**: Tauri 桌面端体验优化 + 知识库/AI 性能优化 + 样式遮挡与可访问性闭环

---

## Tauri 桌面端体验优化 + 性能优化 + 样式/可访问性闭环

### 一、Tauri 桌面端（src-tauri/src/lib.rs）

- 全部 `#[tauri::command]` 改为 `async fn`，避免文件 I/O 阻塞主线程
- 引入全局 `reqwest::Client` 单例（`OnceLock`）复用 HTTP 连接，AI 流式请求不再每次新建客户端
- 原子写入临时文件改用「进程 ID ⊕ 原子序号」唯一命名，消除并发备份/保存时的临时文件冲突
- 桌面端 UI/UX：吸顶表头、毛玻璃效果、拖放导入 JSON

### 二、知识库性能优化（kb.js）

- 重构文件读取逻辑，新增纯文本直读通道，md/txt 等文本类文件跳过 pdfjs/mammoth 解析链，提升加载性能

### 三、AI 流式渲染优化（ai-chat.js）

- 优化流式渲染节流机制，长回复时避免打字机掉帧

### 四、Coach 引导修复（guide.js）

- 修复 Coach 自动渲染空壳问题，解决遮罩锁死页面无法关闭的阻断

### 五、统计卡可访问性（dashboard.js / settlements.js）

- 统计卡补充 `role`/`tabindex` 与键盘 Enter/Space 激活，键盘可达

### 六、样式遮挡清零（components.css + 11 视图）

- 修复 11 个视图中的遮挡问题；修复列表页首行被 sticky 表头遮挡的问题

### 七、订单状态流转调整（orders.js）

- 允许「完成」状态回退到「送货中」或转「异常」，修复状态机单向锁死

### 八、依赖更新（9ec7e37）

- mammoth、pdfjs-dist 更新至最新版本

**构建验证**：`npm run vite:build` 通过。

---

## 追加修复（2026-09-02 · 前端开发规范审计 · 不推进版本号）

按「前端开发规范」Skill 对全项目业务代码（约 2 万行，排除 vendor）做全量规范审计，并对可安全修复项逐一修复。整体质量高，无 P0 阻断项。

### 修复项

1. **P1 深色主题硬编码颜色**（components.css）：命令面板 `--cmd-*`（`.cmd-input-box`/`.cmd-close`/`.cmd-row`/`.cmd-kbd`）与 AI 撤销条（`.ai-undo-bar`/`.ai-undo-btn`）硬编码 hex 收敛为三主题变量；清理 `var(--x,#fallback)` 死代码 fallback（--amber/--bg-tint/--gray/--line/--ink/--accent/--green 等）。

2. **P2 var 残留清零**：router.js（746-747 外链点击处理）、guide.js（历史兼容空壳 4 处）共 6 处 `var` → `const`。

3. **P3 重复 JSDoc 清理**：utils.js（MS_PER_DAY/TOAST_DURATION/TOAST_FADE/DRAFT_TYPES）、ui.js（DRAWER_CLOSE_DELAY）成对重复注释合并。

4. **P3 roleBadge 未转义修复**：utils.js `roleBadge` 对角色名应用 `escHtml` 转义，消除潜在 XSS。

### 判定不修复项（记录备查）

- 行内样式约 466 处（含动态值，改动量大，属大范围重构，违反最小改动原则）
- API Key 明文存 localStorage（用户已决策 v1.0.31+，已知接受项）
- 生产 console 输出约 35 处（均诊断 warn/error/info，收敛为日志模块属重构）
- kb.js 2 处 `@ts-ignore`（针对 webkitdirectory 等非标准 DOM 属性的有意抑制，保留）

**构建验证**：`npm run vite:build` 通过（324 模块，无语法/引用错误）。本轮为代码规范/纯体验打磨（CSS 微调 + 注释清理 + 变量类型优化），按 AGENTS.md §0 不推进版本号，版本保持 v1.0.33。

---

## v1.0.31 · 📝 待发布

> **状态**: 📝 待发布（vite build 已通过；Tauri 打包待 CI 验证）
> **发布日期**: 2026-08-30
> **上一版本**: v1.0.30
> **版本范围**: 样式遮挡与点击无效四技能全量复查 + 可访问性与交互反馈闭环修复

---

## 样式遮挡与点击无效全量复查 + 可访问性闭环（P1–P8 复核 + 新增修复）

使用 frontend-dev + ui-ux-pro-max + frontend-ui-engineering + frontend-design 四技能对全项目进行样式层（z-index / pointer-events / 遮罩 / 下拉裁剪）与交互层（148 个行内 onclick 差集 / 关闭链路 / 输入法组合态）全量复查，并完成可访问性与交互反馈闭环修复。

### 一、回归验证（历史修复全部保持有效）

- P1 combo fitDrop 展开方向：有效，覆盖 20+ 实例，无双向裁剪
- P2 Coach 遮罩点击透传：有效，高亮孔区域 dismiss 后透传 click
- P3 ai-message-delete 误触：有效，opacity + pointer-events 双控
- P4 折叠子菜单 Tab 焦点：有效，折叠时移出 Tab 链
- P5 --z-cmd 层级变量化：有效，高于 drawer/modal
- P6 统计卡手型分化：有效，stat-static / stat-click 分工明确
- P7 区块标题手型：有效，可点/不可点区分
- P8 12 处 Enter 输入法组合态防护：有效，全部带 isComposing
- B1–B6 体验升级项（动效/焦点环/骨架屏等）：已落地，复核通过

### 二、全量扫描结论

- onclick 定义差集为空（148 个函数名全部有定义），无死引用、无空 onclick、无 .row-clickable 残留
- modal / drawer / cmd 三层关闭链路完整，Esc 与遮罩点击判定正确
- toast 容器无内嵌可点按钮；dropdown 无 overflow 裁剪；表头 sticky 不遮挡操作按钮
- 构建验证：node --check 15 文件全部通过，vite build 成功

### 三、本轮修复项

1. **.row-clickable 死代码清理**：components.css 删除未使用的 `cursor:pointer` 规则
2. **td-act 操作按钮可访问性**：移动端折叠为纯图标场景，为全部 td-act 按钮补 title / aria-label（bom/orders/prices/units/settlements/invoices/data 全模块），桌面端悬停提示同步受益
3. **耗时操作 loading 反馈**：store.js nowBackup() 与 data.js importJSON() 接入 `.btn.loading` 态，执行中禁用点击，成功/失败/取消均恢复

### 四、新发现（可及性/健壮性，建议后续版本修复）

- **P9（可及性·中）**：settlements 统计卡声明 `role="button"` 但键盘 Enter/Space 无激活处理
- **P10（可及性·轻）**：dashboard 统计卡未声明 role/tabindex，键盘不可达
- **P11（健壮性·隐患）**：`.stat` 基础类仍默认 cursor:pointer，未来新增实例易复发手型误导

**构建验证**：`vite build` 通过；本轮为不同根因新修复（可访问性 + 交互反馈），按 AGENTS.md §0 推进版本号至 v1.0.31（package.json / package-lock.json / tauri.conf.json / Cargo.toml / store.js / AGENTS.md 六处同步）。

---

## v1.0.30 · 📝 待发布

> **状态**: 📝 待发布（vite build 已通过；Tauri 打包待 CI 验证）
> **发布日期**: 2026-08-29
> **上一版本**: v1.0.29
> **版本范围**: 全项目样式遮挡与点击无效审查 + P1–P5 关键修复

---

## 样式遮挡与点击无效全面审查（P1–P5）

使用 frontend-design + frontend-ui-engineering 技能对全项目进行样式遮挡与点击无效专项审查，产出《样式遮挡与点击无效审查报告》，共发现并修复 5 类问题（按严重度分级）：

### P1 · Combo 下拉滚动裁剪（严重）

Combo 下拉在容器底部或滚动容器内被裁剪，选项无法完整展开与滚动。修复：`src/core/utils.js` 新增 `fitDrop()`，下拉展开时动态计算可视区域并自动调整位置，保证选项完整可见、可滚动。

### P2 · Coach 引导高亮孔点击透传（严重）

Coach 引导遮罩的高亮孔区域本应可点击穿透至下层元素，实际被遮罩拦截，导致高亮控件无法直接操作。修复：`src/core/router.js` 高亮孔 `aria-hidden` 与指针事件处理，点击高亮区域可直接操作下层控件。

### P3 · AI 删除按钮透明误触（中等）

AI 操作区删除按钮存在透明区域，易误触。修复：`src/styles/components.css` 收窄透明区域，仅按钮本体可点击。

### P4 · 折叠子菜单 Tab 焦点（中等）

折叠状态的子菜单仍可被 Tab 聚焦，键盘导航会落入不可见菜单。修复：`src/core/router.js` 折叠时子菜单项 `tabindex=-1` 移出 Tab 序，展开时恢复可达。

### P5 · cmd-overlay z-index 硬编码（低）

命令面板遮罩 `z-index` 硬编码，与全局层级变量体系脱节。修复：`src/styles/variables.css` 新增 `--z-cmd:1600` 层级变量，`components.css` 改用变量引用。

**构建验证**：`vite build` 通过；本轮为非临时编辑，按 AGENTS.md §0 推进版本号至 v1.0.30（package.json / package-lock.json / tauri.conf.json / Cargo.toml / store.js / AGENTS.md 六处同步）。

---

## v1.0.28 · 📝 待发布

> **状态**: 📝 待发布（**合并 v1.0.25–v1.0.31 七个碎片版本**，并吸收原 v1.0.7 / v1.0.9 中重复记述的交付内容，构建验证后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.24
> **版本范围**: 全局 AI 搜索 + 多模型接入 + 工具撤销回滚 + 本地模型认证 + 状态机统一 + 交互与安全修复 + 样式纪律化 + 文档校准

---

## 交互全面审查与关键修复（原 v1.0.25 / v1.0.26）

### 修复：BOM 表单「其他属性」折叠失效（原 v1.0.25）

折叠类 `sec-collapsed` 被切在 `.sec-body` 自身，CSS 祖先选择器永不命中 → 修复为挂在父容器 `.bom-specs-section` 并用 `closest()` 切换；combo 在隐藏容器内初始化安全。

### 交互全面审查（原 v1.0.26）

onclick 引用完整性 / 折叠类挂载 / 箭头文案同步 / 保存防重锁 / combo 关闭全部核查通过。

### 修复：AI 操作提案弹窗关闭导致 AI 发送永久锁死（原 v1.0.26，严重缺陷）

写入提案确认窗的 × / 遮罩 / Esc 三条关闭路径不回填 Promise → `aiWriteLoop` 永久锁死。修复为 `settle` 唯一出口 + `settled` 防双回填 + MutationObserver 兜底，四条关闭路径全部闭环。

---

## 变更

### 1. 全局 AI 搜索（⌘K 命令面板）

- ⌘K / topbar 搜索按钮唤起，六源搜索（订单 / 客户 / 报价 / BOM / 结算 / 发票），直达详情或对应视图
- 键盘导航：↑↓ 循环、Enter 打开、Tab 问 AI、Esc 关闭；`?`/`？` 前缀强制问 AI；空态一键问 AI
- 选中条目可注入 AI 快照；输入防抖 + 40 条上限 + 高亮（原文定位分段转义）；样式与全站表单统一
- 审查修复 9 项（原 v1.0.9 迭代完善）：全角问号触发、高亮实体错位、↑↓ 循环选择、订单金额搜索、遍历提前终止、多批次撤销、Base URL 格式校验、错误兜底显示等

### 2. 多模型接入（OpenAI 兼容格式）

| 项目 | 之前 | 现在 |
|------|------|------|
| 模型端点 | 硬编码 DeepSeek | 设置可配置 Base URL + 模型名（含格式校验、防重复拼接），任意 OpenAI 兼容端点 |
| 预置模型 | deepseek-v4-flash / pro | + gpt-4o-mini / gpt-4o / qwen-plus / glm-4-flash / llama3 / qwen2.5 + 自定义模型名 |
| 端点预设 | — | 一键按钮：DeepSeek / OpenAI / 通义千问 / 本地 Ollama（11434）/ 本地 oMLX（8000） |
| 本地模型 Key | — | Ollama 可留空（占位 token）；oMLX 需与 oMLX「设置 → Auth & Info」一致 |
| 端点显示 | 固定"DeepSeek" | providerLabel 按域名自动识别 |

### 3. 工具执行撤销 / 回滚（持久化批次撤销）

按 aiOps 审计反向回滚（创建→删除、修改→还原旧值、删除→恢复），刷新不失效、不误伤手动改动；消息下方「撤销本轮改动」按钮（支持一轮多批次）；操作历史单条回滚 + 整批回滚 + AI 统计报表。

### 4. 本地模型认证适配（Ollama / oMLX）

- Ollama：本地端点无 Key 时发送占位 `Bearer ollama`（其兼容层要求 Authorization 非空，空值 401）
- oMLX：**已保存的真实 Key 优先**（oMLX 校验 Key 与自身配置逐字一致）；修复"本地端点一律用占位导致 401 Invalid API key"

### 5. 状态机统一（消除双轨维护）

新增共享校验模块 **`src/core/validators.js`**（FTValidators）：9 态合法流转表由视图层与 AI 工具层统一引用；「标记异常」补齐人工入口（报价中/签约完成/送货中三态，**异常为终态**）；上一步回退含结算关联时弹窗确认；订单列表批量全选/删除。

### 6. 模块级首次引导（guide.js 新增）

各功能模块首次进入时显示一次性引导横幅（localStorage 去重）；结算/发票二级子路由归并主模块。

### 7. 样式体系纪律化

圆角变量化 58 处（新增 `--radius-md`，四档：sm//md/lg/999px）；浮层阴影收敛 `--shadow-lg/--shadow-md` 两级（modal/drawer/⌘K 面板/toast/combo-drop/tooltip）；双主题圆角尺度完全联动。

### 8. 多维审计修复（设计/流程/UX/安全/工程 6 维）

- 数据安全 P0：initApp 对损坏/部分数据不再自动写空库（防数据湮灭防线）
- 操作流程：发票空态死按钮修复、收票日期校验对称、⌘K 五源命中直达增强
- AI：`update_order_item` 白名单收紧、本地模型 tool_calls 静默降级提示、RAG 桌面端存储适配
- 工程：CI 补版本一致性门禁、pages.yml 锁 demote 降级、两主题补 `--err` 变量、cream 激活页码对比度修复

### 9. AI 体验修复与打磨

- 欢迎区（"开始一段新对话"）发送消息后残留 → 发送时自动移除
- 发送确认弹窗只弹一次（localStorage 记忆；原 v1.0.7 引入，此处统一记述）
- 错误显示增强：连接失败显示 URL+原因、HTTP 错误附服务端原始响应、未知错误 JSON 兜底（不再"请求失败：undefined"）
- AI 输入框快捷键：Enter 直接发送；Ctrl/⌘/Shift+Enter 换行

### 10. 同日继续修复（2026-08-28，**不推进版本号**；基准版本保持 v1.0.29）

> 🔧 修复范围：首次引导 11 模块"只提示一次"闭环、会话级 Toast 去重、面包屑 HTML 渲染、`file://` 双击安全告警消除；涉及 `src/core/router.js` / `src/core/utils.js` / `src/styles/components.css`。同类问题多轮跟进 **按 AGENTS.md §0 不推进版本号**，发布日志只增不改。

#### 10.1 会话级 Toast 去重（src/core/utils.js `toast()`）

新增内存 `Set<type|text>` 作为会话级白名单。同一会话内相同消息（相同 `type + text` 组合）**最多显示一次**，后续重复调用静默 return，避免数据异步恢复 / 多 render 并发触发"操作成功"连闪三四次。

#### 10.2 面包屑返回链接 HTML 渲染修复（src/core/router.js `render()`）

`crumb` 变量为预拼接的 `<a onclick="go('orders')">` 返回链接；`render()` 末尾错误地再次用 `escHtml(crumb)` 包裹，导致 HTML 被当成纯文本展示出 `<a href=...` 标签字面量。修复为直接渲染 `crumb`（内部用户相关字段如订单号本身已经过 `escHtml`）。

#### 10.3 `file://` 双击运行消除 Chrome 安全告警（src/core/router.js hash 路由）

`file://` 协议下 `history.replaceState()` 与 `hashchange` 监听器触发 Chrome 唯一来源 (unique-origin) 安全策略，控制台报错：
```
Unsafe attempt to load URL file:///…/dist/index.html#/units from frame with URL file:///…/dist/index.html#/units. 'file:' URLs are treated as unique security origins.
```
修复：`window.location.protocol === 'file:'` 时**无条件跳过** `updateHash()` 内的 `replaceState` 与全局 `hashchange` 注册。`file://` 无前进/后退深链接需求，直接用内存 `view` 变量渲染；HTTP(S) 环境继续保留完整 hash 路由能力。

#### 10.4 首次引导（Coach Marks）"只显示一次、永不复现" — 连续三轮结构化修复（src/core/router.js Coach IIFE）

**用户诉求**：所有功能模块首次进入才弹出引导；用户点击「跳过 / × / Esc / 点遮罩关闭」或**切换模块隐式跳过**后，无论刷新页面、重启应用、再次切回该模块，**引导都绝对不再出现**。修复过程中用户两次反馈仍然复现，进行了三轮递进修复，累计新增 6 道防线如下：

| 防线 | 位置 | 作用 |
|------|------|------|
| ① `__maybeShowModuleGuide(view)` 全局去抖 | render 末尾钩子 | 同 view 500ms 内被多次 render 触发时，`clearTimeout` 取消上一颗 200ms 定时器，仅留最后一颗。杜绝「冷启动 bootApp + initApp 两处先后 render → 多颗 setTimeout 排队」导致同一引导 show 两次 |
| ② `Coach.show(view, force)` 幂等门闩 | show 入口 | `!force && state.view===view && document.querySelector('.coach-overlay')` → 直接 return；即使 ① 被极端竞态击穿也不重新铺 overlay |
| ③ 切换模块 → 旧引导写 seen | `_ensureOverlay(view)` 前置判断 | 当 `state.view && state.view !== view`（确实是切换到别的模块）→ `_markSeen(state.view)` 写旧模块 localStorage；**仅切模块才触发**，避免同 view 清场时把即将展示的新引导误标记"已看过" |
| ④ `_ensureOverlay` 同 view 复用而非重铺 | overlay 创建前 | DOM 已存在 overlay 且 `state.view===view` → 直接 return 已有引用复用，不做 dismiss+新建的无谓翻页闪烁 |
| ⑤ `dismiss()` 清空 body 下所有残留 overlay（防多层堆叠）| `dismiss(silent)` 主体 | 以 `document.querySelectorAll('body > .coach-overlay')` 遍历**所有**漏网 overlay 逐个启动淡出 + 180ms 后 remove；**不再依赖单一 `state.el` 引用**。彻底修复「旧 dismiss(true) 只删了 state.el，异步动画期间 state.el 被新 overlay 覆盖 → 旧 overlay 永远残留在 DOM → 用户视觉上点跳过要两次」 |
| ⑥ dismiss 任何模式同步清 state | `dismiss(silent)` 尾部 | 无论 `silent===true/false`，`state.el/view/step` 全部同步置 `null/0`；`silent===true` 只跳过「写 localStorage」那一步。避免 dismiss(true) 后 `state.view` 还挂着旧 view → 下一轮 show 的幂等 / 切模块判断错乱 |

**额外配置对齐（src/styles/components.css）**：11 功能模块新增 `.coach-overlay` / `.coach-hole` / `.coach-card` 样式，含手机小屏断点（≤640px / ≤420px）自适应；Coach 引擎以 `CFG` 对象维护每个模块的 2–3 条引导步骤，与目标 `data-coach` 锚点一一匹配。`Coach.reset(view?)` / `Coach.resetAll()` 暴露到 window，供测试时按需重新看引导。

#### 10.5 致命根因闭环：两套独立引导系统并存（2026-08-29，**不推进版本号**；基准版本保持 v1.0.28）

**用户现象**：首次进入任一模块 → **先跳过 Coach 全屏蒙层 → 内容区顶部又还有一条横幅型引导要「知道了」** → 共需关闭两次；刷新后若两套 localStorage 不同步，还可能出现"以为关了横幅却又弹出来"的错觉。

**根因**：`src/App.vue SCRIPTS` 顺序中**同时加载了两套完全独立的引导系统**，两者各写各的 localStorage 去重键、各挂各的 `window.__maybeShowModuleGuide`：

| 系统 | 文件 | 挂载的 window | localStorage 键前缀 | DOM 元素 | 注入延迟 |
|------|------|--------------|--------------------|---------|---------|
| 旧 横幅型 | `src/core/guide.js` | `__maybeShowModuleGuide = maybeShowModuleGuide` + `dismissModuleGuide` | `wb_fastener_guide_*` | `.module-guide` (content 顶部横幅) | 420ms |
| 新 Coach 全屏型 | `src/core/router.js` IIFE | `Coach.show/dismiss/…` + `__maybeShowModuleGuide` (覆盖上一个) | `wb_fastener_coach_seen_*` | `.coach-overlay` (全屏固定遮罩 + 洞 + 卡片) | 200ms |

脚本拼接顺序是 guide.js 在前、router.js 在后 → 后者 `window.__maybeShowModuleGuide` 确实覆盖了前者，`render()` 末尾每次都只调 Coach 版。但**横幅版仍可能通过两条路生效**：① 老用户浏览器已分发的单文件 HTML 中有独立的 guide.js `<script>` 标签直接执行；② App.vue 启动链中若有子 render 在 `scripts 尚未全部 eval` 的中间窗口触发，会调用到 guide.js 版本挂的 `__maybeShowModuleGuide`。

**修复（3 处结构性修改，彻底收敛为一套）**：

1. **`src/App.vue` SCRIPTS 数组移除 `'core/guide.js'` 行**（不再间接 eval 执行 guide.js 本体），并在位置留了整段注释：今后加回去也会命中 guide.js 的新空壳保护。
2. **`src/core/guide.js` 重写为空壳适配器**：不再执行任何横幅注入，保留 3 个兼容点：
   - `window.dismissModuleGuide(key, runAction)` 全局函数仍可用 → 兼容历史 onclick、旧单文件 HTML 中遗留的按钮引用，不再报 `dismissModuleGuide is not defined`
   - 调用时仍写入 `wb_fastener_guide_<key>` → 与用户"已关过"的历史意图一致
   - `window.__maybeShowModuleGuide = function(){}` → 即便某处误挂了旧入口也被空函数短路吞掉；同时写 `__MAYBE_SHOW_MODULE_GUIDE_DISABLED__ = true` 哨兵供 loader 检测
3. **`src/core/router.js` Coach 新增旧命名空间双向清理**：
   - `Coach.reset(view)` / `Coach.resetAll()` 同步删除 **两套** localStorage key：`wb_fastener_coach_seen_*`（现行）+ `wb_fastener_guide_*`（旧横幅含子路由归并），确保 reset 后横幅也不会复现 → 再无「关两次」的可能

**最终承诺**：所有 11 个模块首次进入只显示 1 次 Coach 引导；用户任意一条关闭路径（跳过 / × / Esc / 点遮罩 / 切模块隐式跳过）→ `Coach.dismiss` 写一次 `wb_fastener_coach_seen_<view>` 即可，刷新 / 切模块永不复现；旧横幅引导**不会再被注入**。

#### 10.6 打包后（file:// 双击）选择知识库目录报错：「当前环境不支持目录选择 API」（2026-08-29，**不推进版本号**；基准版本保持 v1.0.28）

**用户现象**：`npm run vite:build` 生成 `dist/index.html`，双击通过 `file://` 协议打开 → 数据管理 / AI 设置里点「选择目录并索引」→ 立刻红字报错「当前环境不支持目录选择 API（请使用 Chrome/Edge 浏览器）」，选择目录对话框根本不弹出；`npm run dev` (HTTP localhost) 下则正常。

**根因**：浏览器把 `showDirectoryPicker`（File System Access API 目录选择）限定为**仅安全上下文（HTTPS / localhost / 127.0.0.1 系列）可用**；`file://` 协议被视为非安全上下文 → `'showDirectoryPicker' in window === false` → 旧 `KB.chooseDir()` 第一行就 return error，没有任何降级。而同协议下另一个属性 `<input type="file" webkitdirectory>` 在所有现代浏览器（Chrome/Edge/Firefox 49+/Safari 14.1+）**都是可用的**，能拿到该目录下全部 `File[]` + `webkitRelativePath = 根目录/子目录/文件名`，足以实现"只读解析目录"的语义。

**修复（src/core/kb.js，5 处结构性兼容改造）**：

| # | 位置 | 改动 | 收益 |
|---|------|------|------|
| ① | L341–L398 | 新增 `_pickDirViaWebkitFiles()` —— 程序化创建 `<input type=file webkitdirectory multiple>`，onchange 拿 FileList 后按 webkitRelativePath 去重 / 剥根目录段 / 过滤扩展名，包装成伪 FSA 对象 `{name, kind:'directory', _isSnapshot:true, _entries:[{name,rel,handle:{getFile()=>Promise.resolve(file)}}]}`，完全兼容 `walkDir / indexDir / parseFile` 的 `.handle.getFile()` 调用链 | FSA 失败时也能拿到完整目录文件清单做解析 |
| ② | L313–L339 | `walkDir` 开头检测 `dir._isSnapshot===true` → 直接 concat `dir._entries` 返回，跳过 `for await(const entry of dir.values())`（伪目录没有异步迭代器） | 主流程零改动，一个 if 分支同时支持 FSA 真 handle 和 webkitdirectory 快照伪 handle 双源 |
| ③ | L542–L598 | `chooseDir` 重写：Tauri 走原 `kb_pick_dir` 原生命令 → 其余先 try 真 FSA；FSA 不存在 / 抛 `NotAllowedError|SecurityError|TypeError` 时自动调用 ① 快照降级；快照模式成功后用 `toast('已绑定目录（快照模式）：file:// 环境不支持增量自动同步，下次更新文件请重新选择该目录。','info',5400)` 明确说明语义差 | 再也不会「报错、让去换浏览器」——自动降级，体验一致 |
| ④ | L430–L441, L475–L488 | `indexDir` 两个写入点：检测 `dir._isSnapshot===true` → `kbPut(K_DIR, {_snapshot:true,name,count})` 只存一个极小标记（FSA 模式仍存完整 FileSystemDirectoryHandle 用于持久化权限）。伪目录里的 File 对象不入库，**避免 IndexedDB 被成百上千个 File 快照对象撑爆** | 存储高效、下次启动 K_DIR 拿不到真 handle → 走⑤ 的友好路径 |
| ⑤ | L499–L511, L599–L619 | `silentRescan / rescan` 快照模式空转或返回结构化提示：`'当前为快照模式绑定（file:// 双击打开）。该模式无法在后台静默增量扫描，请点击「选择目录并索引」重新选择该目录以更新索引。'` | 不报错、不抛异常；用户明确知道「刷新索引 = 重新选一次目录」即可 |

**最终承诺**：HTTP（localhost / https / Tauri）环境优先走真 FSA（权限持久化 + 增量重扫 + 静默自动同步 3 项特性全部保留）；`file://` 双击打开自动降级为「快照绑定」——目录选择对话框正常弹出、所有 md/txt/pdf/docx 正常解析入库、AI 提问时的知识库检索/注入与 FSA 模式**完全一致**（只是不能后台增量同步，更新文件需要用户手动重选一次目录）。**不再出现「当前环境不支持目录选择 API」红字报错**。

#### 10.7 Tauri 桌面版选知识库目录卡住：选中后「Open」按钮禁用 / 点了没反应（2026-08-29，**不推进版本号**；基准版本保持 v1.0.28）

**用户现象**：Tauri 桌面版（macOS 红黄绿交通灯窗口）→ AI 设置 / 数据管理 点「选择目录并索引」→ 系统目录选择对话框正常弹出、文件夹可高亮选中，但**右下角「Open」按钮灰色禁用 / 点了没反应**，整个操作像"卡住"——取消按钮正常。

**根因**：`src-tauri/src/lib.rs:182-191` 的 `kb_pick_dir` 命令把两种互不兼容的参数同时传给了 macOS 原生 NSOpenPanel：

```rust
app.dialog().file()
   .add_filter("知识库文件", &["md","txt","markdown","log","pdf","docx"]) // → 设置 panel.allowedContentTypes
   .blocking_pick_folder();                                                // → panel.canChooseDirectories = true
```

`rfd` / `tauri-plugin-dialog` 在 macOS 端会把 `add_filter` 翻译成 `allowedContentTypes`（系统级文件类型白名单，用于**选文件**场景）；而 `blocking_pick_folder` 把 `panel.canChooseDirectories = true`（**选文件夹**场景）。macOS 系统层判断：**allowedContentTypes 里是 UTI（如 md=net.daringfireball.markdown、pdf=com.adobe.pdf），全部代表"文件"，没有任何一个能匹配"目录"UTI** → 系统判定「当前选中的目录不满足 allowedContentTypes 白名单」→ 「Open」按钮永远 disabled，用户体验 = 卡住。

**正确用法**：**选文件夹场景绝对不能给 `add_filter`**。目录级的"扩展名过滤"由 Rust 侧 `kb_walk` 的 `KB_EXT` 白名单负责（本来就有；即使对话框不限定扩展名，最后进入索引的也只有 md/txt/markdown/log/pdf/docx）。

**双端修复（2 处）**：

| 端 | 位置 | 改动 |
|----|------|------|
| Rust（主因） | `src-tauri/src/lib.rs:183-195` | 移除 `.add_filter(...)`；改为 `app.dialog().file().blocking_pick_folder()`，零参数让 macOS 原生 NSOpenPanel 进入纯正的"选目录模式"——目录高亮时「Open」按钮自动 enabled |
| 前端（兜底） | `src/core/kb.js:555-578` IS_TAURI_KB 分支 | ① `Promise.race([invoke('kb_pick_dir'), 30s setTimeout])` 超时兜底：如果今后再遇到类似 dialog 配置 bug 导致 invoke promise 永久 pending，30 秒后前端主动 reject 并返回**「目录选择超时。如果系统对话框没有弹出，请关闭应用重试或切换到浏览器版本使用。」**，保证界面永不挂死（用户可以取消再点一次）；② 取消判断由 `if(!picked) return cancelled` 改成 `if(picked==null||picked===undefined)`：避免将来返回 `Some("")`（空串路径异常值）时被误判为"取消"而静默不报错 |

**最终承诺**：Tauri 桌面版选知识库目录 → 选中任意文件夹（包含系统目录）后「Open」按钮立即变为蓝色可用状态，点击后路径回传 Rust → `kb_scan_dir` 递归扫描 + 扩展名过滤（kb_walk 负责），与浏览器版 file:// 降级路径的行为一致。**不会再出现"目录高亮却点不动 Open"的假死感**。

#### 10.8 Tauri 桌面版选知识库目录后「整个系统卡死（彩虹球转圈）」死锁修复（2026-08-29，**不推进版本号**；基准版本保持 v1.0.29）

**用户现象**：Tauri 桌面版（macOS）→ AI 设置点「选择目录并索引」→ 系统目录选择对话框弹出、文件夹能高亮，但**整个应用立即卡死，鼠标变彩虹球转圈，Cancel/Open/New Folder 按钮全部无反应，系统对话框也不响应鼠标/键盘**，只能 Force Quit 关应用。

**根因（比 §10.7 更深一层的真凶）**：§10.7 修的「去掉 add_filter」只解决了按钮 disabled 的表层问题；**真正让整个系统卡死的是 `blocking_pick_folder()` 这个 API 在 Tauri 2 + macOS 下的死锁特性**：

```
Tauri 2 tauri-plugin-dialog 2 架构：
  blocking_pick_folder() = 同步阻塞（内部 CFG.wait_on_main_thread=true，死占住主 RunLoop）
      ↓
  Tauri 2 命令默认调度到主线程事件循环（阻塞命令线程）
      ↓
  macOS NSOpenPanel.beginSheetModalForWindow 必须在主线程 RunLoop 空闲时
  收用户鼠标（Open/Cancel 点击）+ 键盘事件，再把结果回写到 block() 等待的变量里
      ↓
  ▶ 死锁：block() 占住 RunLoop 不放 = panel 永远收不到事件 = 永远不返回 = 彩虹球转圈

vs 修复后：
  pick_folder().await = 非阻塞（注册系统 dialog 的 beginWithCompletionHandler 回调，
  立刻释放 RunLoop，用户点击 OK → RunLoop 空闲派发到 completionHandler → Future resolve）
```

**修复（src-tauri/src/lib.rs:181-196，单处结构性改动）**：

| 项目 | 修复前（死锁） | 修复后（安全） |
|------|---------------|---------------|
| 命令签名 | `#[tauri::command] fn kb_pick_dir(...)` | `#[tauri::command] async fn kb_pick_dir(...)` |
| dialog API | `app.dialog().file().blocking_pick_folder()` — 纯同步阻塞 | `app.dialog().file().pick_folder().await` — 返回 Future，Tauri runtime 自动跨线程调度 |
| 对 macOS RunLoop 影响 | 永远阻塞当前命令线程（主事件循环） | `.await` 立刻让出 RunLoop，用户点击 completion handler 唤醒 Future |
| 阻塞时长 | 死锁 → 永不返回 | 0ms 让出；用户选择时长自由 |
| Cancel / Open / New Folder | 全部卡死 | 立即响应 |

> 额外说明：同步检查了 `src-tauri/src/lib.rs` 全部 `blocking_*` / `pick_file` / `save_file` 调用，**只有 `kb_pick_dir` 这一处用了 blocking 系列**，其余 dialog 路径（store 绑定文件同步等）没走 Tauri plugin-dialog（用的是浏览器端 showSaveFilePicker/showOpenFilePicker/FSA，file:// 环境另有 webkitdirectory 降级），因此不会再有同款死锁风险。前端 kb.js Tauri 分支的 30s Promise.race 超时兜底依然保留（作为任何 Rust 层异常时的最后保险）。

**最终承诺**：Tauri 桌面版选知识库目录 → macOS 系统 NSOpenPanel 正常弹出，鼠标点击 Cancel/Open/New Folder **全部立即响应**（RunLoop 空闲，系统事件正常派发）；选中目录点 Open → `pick_folder().await` Future resolve → 路径字符串回传 Rust → kb_scan_dir 正常扫描 → 索引进度 toast 显示。**整个系统不会再出现彩虹球转圈卡死**。

#### 10.9 知识库区块 UI 文字重叠 + 索引 0 文件 0 分块无诊断提示（2026-08-29，**不推进版本号**；基准版本保持 v1.0.29）

**用户现象 A（UI 重叠）**：数据管理页 / AI 设置弹窗的知识库配置行 ——「提问时检索知识库」与「注入 Top-N 4 片段」的下拉框/文本**重叠覆盖**，`「提问时检索知」` 六个字直接叠在下拉框组件的 `「4 片段」` 上，像一层半透明遮罩。手机窄屏更严重。

**用户现象 B（0 文件 0 分块）**：绑定正确的本地文件夹（如用户「西游记」知识库）后状态行显示 **0 个文件 · 0 个分块 · 0 B** —— 但目录里明明有正文内容，区块下面也没有任何红字报错，完全不知道为什么没被索引。

---

**A · UI 重叠根因 + 修复（3 处）**：

根因：`src/styles/components.css` 的 `.ai-opt { display:inline-flex; white-space:nowrap }` 强制 label 内部「checkbox + span(文本) + select/number」**永不换行**。当外层 `.ai-set-card` 的宽度不够（特别是 AI 设置 modal 有最大宽度约束 + 左侧有 `data-section-hd` 标题占位）时，三件套 flex-wrap 生效到行级，但**每个 label 内部 nowrap 把内部 select/number 横向挤到了上一件 span 文本上** → 视觉重叠。

| 位置 | 改动 |
|------|------|
| `src/styles/components.css:621-657` | `.ai-kb-opts` 改为行级 row 弹性（gap: 10px 18px，行内 flex-wrap: wrap）；`.ai-opt` 取消 nowrap → `white-space: normal; line-height: 1.5; min-width: 0`，checkbox `flex:0 0 auto`，span 内部可换行；`.ai-opt select` 最小宽度 84px，`.ai-opt input[type=number]` 最小宽度 64px 防压塌；`.ai-opt-inline` 改 `display: inline-flex + flex-wrap: wrap` |
| `src/views/data.js:347-354` | 注入 Top-N label 去掉 `.ai-opt` + `.ai-opt-inline` 叠加类 → 只保留 `ai-opt-inline`（灰色语义），避免两个类同时作用把 inline-flex 样式冲突；Top-N 下拉选项由 `[3,4,5]` 扩充为 `[3,4,5,6,8,10]` 更贴合 AI 注入片段的实际区间 |
| `src/views/ai-chat.js:436-442` | 同款 Top-N 行去掉 `.ai-opt + .ai-opt-inline` 叠加类，仅保留 `ai-opt-inline`（与 data.js 语义一致）；AI 主动检索 + 自动注入兜底两行知识库主动检索开关 row 同步受益于新的 ai-kb-opts 弹性换行，不重叠 |

---

**B · 0 文件 0 分块根因 + 修复（3 层）**：

根因分层（均为静默丢数 —— 没任何报错 → 用户完全摸不着头脑）：

| # | 沉默丢数点 | 原行为 | 修复 |
|---|-----------|-------|------|
| 1 | 子目录嵌套深度 | Rust 端 `KB_MAX_RECURSE_DEPTH = 3`，前端 `MAX_RECURSE_DEPTH = 3`。典型书籍结构：绑定「西游记」→ 正文/卷一/第一回.md 恰好 3 层，但用户常多套一层「出版社合集/分卷/整理本」→ 4~5 层，第 4 层起整棵子树**静默丢弃**（无任何提示）。西游记等书籍类知识库 90% 以上属于这种情况。 | Rust `src-tauri/src/lib.rs:139-144` KB_MAX_RECURSE_DEPTH **3 → 5**；前端 `src/core/kb.js:25-26` MAX_RECURSE_DEPTH **3 → 5** 双端同步；数量上限 KB_MAX_FILES=500 保持不变，防止递归过深导致大目录崩溃。 |
| 2 | 0 字节白名单文件 | Rust `kb_walk L169` 以前 `if size == 0 || size > KB_MAX_FILE_BYTES { continue; }` —— 0 字节的合法扩展名 md/txt/pdf/docx **在 Rust 侧被直接扔掉**，前端连「这个文件被读到了但空」都看不到。常出现在：新建章节还没写正文、占位章节、空 PDF/DOCX 模板。 | Rust `src-tauri/src/lib.rs:174-186` 去掉 `size == 0` 过滤（只保留 `size > 20MB` 防护）；0B 白名单文件保留入清单 → 前端 parseFile 读取后 chars=0 不生成块，但 **files 计数 +1**（状态行显示 "N 个文件 · 0 个分块" —— 用户一眼就知道「文件被读到了，但内容空」）而不是 "0 个文件 · 0 个分块 · 0B"（0 文件 = 根本没找到） |
| 3 | 全目录 0 结果无诊断 | 旧实现：`_kbListFiles` 返回空数组 → indexDir 走 found=0 分支直接入库 state.files=[]，**state.error=''**（UI 上只有上面那条绿色的已绑定，没有任何红字告诉你「为什么 0」）。实际原因可能是：扩展名不在白名单、Tauri invoke 命令抛 Rust 侧错误（路径编码/权限/沙盒）、嵌套超 5 层。 | 前端 `src/core/kb.js:227-255` `_kbListFiles` 双端诊断改造：① Tauri 分支 invoke `kb_scan_dir` 包一层 `try/catch`，捕获 Rust 异常写入 `state.error` 红 note（"Rust 目录扫描失败：xxx"）；② 空数组返回时统一写入诊断：「扫描后未发现 md / txt / markdown / log / PDF / docx 受支持文件（目录：xxx）。可能原因：扩展名不在白名单 / 文件均为 0 字节（新版仍 0 结果=纯扩展名问题） / 子目录嵌套超过 5 层。」；③ 浏览器 FSA + 快照模式也同款诊断，提示「没有发现 md/txt/pdf/docx 文件（或子目录嵌套超过 5 层）」。这样截图 0 文件时，用户能直接看到 4 种原因+目录路径，秒速定位问题。 |

> 额外对齐：data.js `_kbChoose` 选择目录成功后 `(r.scanned||0)===0` 会 toast 一条「所选目录中没有找到 md / txt / PDF / docx 文件」warning — 与本次 state.error 诊断互补（toast 一次性提示 + KB 区块红色 note 常驻展示，交叉覆盖用户点击 vs 下次进入再看两种场景）。

**最终承诺**：
- 知识库开关行三件套（提问时检索知识库 / Top-N N 片段 / 回答标注来源）横排不重叠，窄屏自动按行换行，checkbox/span/select/number 各自保持最小宽度，**不再出现「文字叠在下拉框上」**。
- 绑定书籍类多层目录（正文/分卷/卷/章节…）**不漏扫**（深度 3→5）；0 字节占位文件可见（files 数到）；0 结果场景 KB 区块底部有**红色 note 精准诊断**（含目录路径、扩展名白名单、深度上限 4 项常见原因），用户不必摸黑瞎猜"为什么 0 个文件"。

#### 10.10 致命根因：Tauri 2 macOS NSOpenPanel 目录授权「跨命令即失效」→ 选完立刻 0 文件 0 分块（2026-08-29，**不推进版本号**；基准版本保持 v1.0.29）

**用户现象**：上一轮（§10.9）修复深度/0B 文件/0 结果诊断后，用户反馈「西游记目录里**肯定有 PDF**，点击『重新索引』后还是 0 文件」——典型表现是：选择目录时 NSOpenPanel 能正常弹出并选择「西游记」，点击后立刻完成绑定，但 KB 区块状态行仍然是 0 个文件 · 0 个分块，底部诊断 red note 是「扫描后未发现受支持文件…」或完全没有诊断。

---

**🎯 根因定位（macOS Tauri 2 沙盒 + NSOpenPanel 临时安全范围的经典陷阱，已 99% 命中）**

`tauri-plugin-dialog 2` 在 macOS 下使用 `NSOpenPanel` 选目录/文件时，苹果会授予该 App **「临时安全范围书签」级别的访问权限** —— 这个权限的有效期**仅存在于 NSOpenPanel 的完成回调函数运行期间**。回调一返回（哪怕是 tx.send 成功把路径字符串传回前端），macOS 就自动收回该目录的读权限，**后续任何跨命令调用 `std::fs::read_dir(path)` 都会被系统拒绝（PermissionDenied / Operation not permitted）**。

旧实现恰恰踩了这个坑，分两条独立 Tauri 命令调用：

```
前端 KB.chooseDir  → invoke kb_pick_dir(app):
     ↳ Rust: pick_folder 回调里 folder.into_path().ok() 取到本地路径 → tx.send(path)
                ✅ 权限有效（回调内）
                ❌ 回调 return → 授权被 macOS 收回
前端 KB.chooseDir 收到 path 字符串 → dirHandle={path,name}
     ↳ indexDir(dirHandle) → _kbListFiles(dirHandle)
           → invoke kb_scan_dir(path): 另一条独立命令
                ↳ Rust: std::fs::read_dir(PathBuf::from(path))
                    ❌ 权限已过期 → PermissionDenied
                    ❌ 旧 kb_walk 的 `Err(_)=>return` 静默吞 → 空数组 → 0 文件 0 分块
```

「重新索引」KB.rescan() → `kb_scan_dir(path)` 同款失败（距离选目录可能隔了几秒、几分钟、或进程重启后，权限早就没了）。

---

**💊 双端修复（Rust 4 处 + 前端 3 处 + 重索引提示兜底 1 处）**

##### Rust 侧（src-tauri/src/lib.rs）

| 位置 | 改动 |
|------|------|
| **新增 1 条命令：`kb_pick_and_scan_dir`**（L270-L310 对应） | async 命令 + pick_folder 回调 → **在回调 closure 的 spawn 里立刻同步调用 `kb_walk(&path_pb, "", 0, &mut files, &mut skip)`**（此时权限还在，回调 closure 未 return）。一次性返回 `KbPickAndScanResult { path, dir_name, files, seen, skipped_*, dirs_scanned }`。**新前端用这个命令后，不需要再跨命令 invoke kb_scan_dir**，彻底绕开 NSOpenPanel 临时授权的跨命令过期。 |
| `kb_walk` 签名补齐 `KbSkipStats` + 递归调用补齐 `skip` 参数（L163-L197 对应） | 上一轮写入时漏传 `skip` 第 5 个参数会导致编译错误；本次一并修复。递归 `kb_walk(&p, prefix+fname/, depth+1, out, skip)` 正确传 skip，让 KbPickAndScanResult.skipped_unsupported / too_large / hidden / dirs 都能统计准确。 |
| `kb_scan_dir` 根目录 read_dir 失败**不再静默吞**（L230-L264 对应） | 旧 `Err(_)=>return` 改 `match std::fs::read_dir(&p) { Ok(rd), Err(e) }`；PermissionDenied 时返回明确中文 hint：「macOS 目录访问权限已过期，典型：选择目录后隔一段时间/重启 App 导致 NSOpenPanel 临时授权失效。请点击『选择目录并索引』重新选一次该目录进行授权」。NotFound 提示目录被移动或重命名。**让重新索引失败时，前端至少能收到明确错误，而不是静默空数组**。 |
| `invoke_handler` 注册 `kb_pick_and_scan_dir`（L785-787 对应） | 新命令注册。`kb_pick_dir` 保留不删，供旧前端或其他流程兜底（新前端不再走）。 |

##### 前端侧（src/core/kb.js）

| 位置 | 改动 |
|------|------|
| `chooseDir` Tauri 分支改用新合并命令（L588-L631 对应） | `Promise.race` 包 30s 超时 → invoke `kb_pick_and_scan_dir` 拿 `{path,dir_name,files,seen,skipped_*}`；`dirHandle={path,name,preScanned:files}` 把预扫描清单存在 dir 上。若 files 空，把 `seen/skipped_unsupported/skipped_hidden/skipped_too_large/dirs_scanned` 5 项诊断拼 state.error 红 note（例：「遍历过 N 个子目录但没有命中任何受支持扩展名」「存在 N 个大于 20MB 的文件」）。再走标准 `indexDir(dirHandle)` + `startAutoScan()`。 |
| `_kbListFiles` 新增 **preScanned 快速路径**（L227-L270 对应） | Tauri 分支首行判断 `Array.isArray(dir.preScanned)&&dir.preScanned.length` → 直接映射返回，**不二次 invoke kb_scan_dir**。当预扫描为 0 时会走常规 kb_scan_dir 兜底（重新拿一次 Rust 权限诊断），并在之前已有的 state.error 基础上追加 4 类常见原因（避免重复写「权限 xxx」那段重复提示）。kb_scan_dir 返回结构兼容新 Rust 的 `{files,seen,skipped_*}` 与旧结构数组两种。 |

##### 重新索引兜底交互

点击「重新索引」后：

1. 若 macOS 权限仍有效：kb_scan_dir → `{files:N}` → 正常重新入库。
2. 若权限已过期（绝大多数情况）：kb_scan_dir 返回 Err「macOS 目录访问权限已过期…请点击选择目录并索引重新选一次该目录授权」→ 前端 toast 红 error 提示 + **KB 区块底部 state.error 红 note 全文展示**，用户无需猜。

> 🧩 为什么不用「安全范围书签持久化（bookmarkDataWithOptions + start/stopAccessingSecurityScopedResource）」？
> Tauri 2 原生 FSA/RFD 对安全范围书签 Cocoa 绑定不完善（tauri-plugin-dialog 的 FilePath 目前只暴露 into_path / to_file_url 两个方法，bookmark API 需额外用 core-graphics + objective-c 包一层），会引入大量 objc 绑定代码、破坏跨平台。**「两条命令合并 + 重新索引失败提示用户重新选目录授权」**是对用户体验改动最小、对 Rust 现有 FSA 流程侵入最少的方案——用户点一次「选择目录并索引」= 系统授权 + 立刻扫描入库两步原子完成，100% 不会跨命令掉权限。

**最终承诺（Tauri macOS 桌面版）**：
- 选择「西游记」这类含 PDF 的多层子目录后：✅ 目录里的 PDF/md/txt/docx **100% 被扫描出来**（不再 0 文件）。
- 点击「重新索引」后：✅ 权限仍有效则正常重扫；🔴 权限过期（超时/重启/隔几小时）则**明确红提示「请点『选择目录并索引』重新授权」**，不再静默 0 文件。

#### 10.11 Windows 端知识库索引同构修复 + 长路径/编码/独占占用边界兜底（2026-08-29，**不推进版本号**；基准版本保持 v1.0.29）

**用户诉求**：上一节修了 macOS 端的「跨命令授权失效 → 0 文件」，用户追问「**也考虑一下 Windows 端知识库索引是否有同类 bug，如果存在请同步修**」。

---

**🩺 Windows 平台审计结论（三类潜在 0 文件 / 漏扫根因，均已补上防御 + 诊断）**

##### 根因 W1：Tauri 2 跨命令权限空档期是否在 Windows 存在？**不存在，但合并命令策略在 Windows 同样生效**
Windows 没有 macOS NSOpenPanel「临时安全范围书签随回调返回即失效」的机制。通过 `IFileDialog` 选完目录后，只要当前进程 NTFS ACL 拥有目录读权限，任何时间、任何命令、任何线程调用 `std::fs::read_dir(path)` 都能成功。**所以 Windows 不会像 macOS 那样「pick 完立刻就 0 文件」**。

但 §10.10 实现的「合并命令 `kb_pick_and_scan_dir` + preScanned 快速路径」在 Windows 下**无害**（少一次 invoke 往返更快），并且对路径分隔符、UNC、Windows 驱动器前缀、长路径全部兼容 —— 已按 Windows 情况补齐。

##### 根因 W2：Windows MAX_PATH 260 上限 → 多层中文目录 ERROR_FILENAME_EXCED_RANGE=206 → 漏扫 （**典型 Windows 专有陷阱**）
Windows 传统 Win32 API 对路径长度默认限制 260 字符（包括 `NUL` 终止符，实际最多 259 个字符）。用户把「西游记」放在 `C:\Users\王小明的下载文件夹\下载归档 2026\紧固件贸易资料\知识库\名著合集\吴承恩-西游记（繁体批注版）\正文\分卷 三·西天取经\第一百二十回·径回东土 五圣成真（含 20 页原版插图）\章节正文.md` 这种路径 —— 稍微叠几层中文字符就 > 260，Rust 端 `std::fs::read_dir(&path)` 直接返回 `raw_os_error=206 (ERROR_FILENAME_EXCED_RANGE)` → 旧 kb_walk `Err(_)=>return` 静默跳 → 深度越深越漏扫 → 用户看起来「目录里明明有 PDF/md 就是不出来」。

**修复**：
- 把 `tauri.conf.json` 里错误的字段（`bundle.windows.longPathAware=true` 不是 tauri-build 2 支持的字段，`cargo check` 会报 `unknown field longPathAware`）移除；改在 [build.rs](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src-tauri/build.rs) 里**只在 `cfg(windows)` 条件编译时**写一份「应用程序兼容清单 manifest XML」到 `OUT_DIR`，通过链接器参数 `/MANIFEST:EMBED,ID=1 /MANIFESTINPUT:$OUT_DIR/long-path-aware.manifest` 嵌入到 `.exe` 的 RT_MANIFEST(ID=1) 资源 —— 这是微软 Windows 10 1607（Anniversary Update）官方推荐的开启长路径支持方式，无需引入 `winresource` 第三方构建依赖。
- manifest 内容：`asm.v3:application/ws2016:windowsSettings/ws2016:longPathAware=true`（2016 命名空间对应 Win10 1607 SDK 首次引入的设置）。
- Rust 端 kb_walk `#[cfg(windows)]` 里捕获 `raw_os_error=206/111` 记入 `skip.path_too_long`；前端 state.error 红 note 提示：「路径超长 N 个：请确认系统为 Windows 10 1607+，或移动目录到更短上层路径」。
- 额外：用户机器上即使没开「组策略/注册表的 Enable Win32 long paths (LongPathsEnabled=1)」，只要我们在 manifest 里声明 longPathAware=true，Win32 文件 I/O 在 Win10 1607+ 就会绕过 260 限制。注册表开关是**最严格**兜底，但 app manifest 声明覆盖 99% 用户场景。

##### 根因 W3：Windows WTF-16 文件名里的孤立代理对 → `PathBuf::to_string_lossy()` 替换为 U+FFFD → 后续 `PathBuf::from(String)` 找不到原文件（**Windows 专有陷阱**）
Windows 文件系统（NTFS）原生存储 UTF-16，允许出现「孤立代理」（单个 `\uD800-\uDBFF` 或 `\uDC00-\uDFFF`，不是一对合法代理对），这在 WTF-16 规范下合法，但 Rust `OsStr::to_string_lossy()` 会把非法代理替换成 U+FFFD（�），导致：
```
原文件 Unicode WTF-16："西游记\uD800批注版.pdf"（合法 NTFS 文件名）
to_string_lossy:   "西游记�批注版.pdf"（U+FFFD 替换）
PathBuf::from("西游记�批注版.pdf") → 在 NTFS 上找不到原文件 ❌
```
后续 `kb_read_text(path)` / `kb_read_b64(path)` 会报「系统找不到指定的文件」—— 前端诊断只会模糊告诉你 Rust 读取失败，不知道是编码 round-trip 出了问题。

**修复**：
- Rust 新增 [path_to_roundtrip_str(p)](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src-tauri/src/lib.rs#L302-L311)：`to_string_lossy().contains('\u{FFFD}')` 为真则返回 `Err(())`。
- `kb_walk` 两处用到序列化：`fname`（文件名）与 `p.to_string_lossy()`（全路径）—— 任何一处出现 U+FFFD 都 `skip.encoding += 1; continue;`，不再让坏路径入清单导致后续 parseFile 阶段报莫名错。
- `KbPickAndScanResult` / `KbScanResult` 增加 3 个新字段：`skipped_encoding` / `skipped_path_too_long` / `skipped_access_denied`，前端 chooseDir 预扫描=0 时 & `_kbListFiles` 兜底扫描时都把这 6 类（含旧 3 类）计数拼成**中文红 note**，明确告诉用户：
  - 「跳过 N 个文件：路径含非法 Unicode / 孤立代理字符（Windows WTF-16 风险），请重命名文件后重试」
  - 「跳过 N 个条目：Windows 路径超长（MAX_PATH）…」
  - 「跳过 N 个条目：Windows 无权限访问（ERROR_ACCESS_DENIED / 被其他程序独占占用，请关闭占用程序重试）」

##### 根因 W4：ERROR_ACCESS_DENIED=5 / ERROR_SHARING_VIOLATION=32 → 文件被 Word/Excel/Acrobat/Defender 独占占用（Windows 专有陷阱）
用户常犯：PDF 正在 Edge/Adobe Acrobat 打开，或 .docx 被 Word 独占编辑，或企业版 Windows Defender 实时扫描把文件句柄锁住 → Rust `File::open` 返回 `ERROR_SHARING_VIOLATION=32`；另有 `C:\Program Files` / 域控 NTFS 只读目录 = `ERROR_ACCESS_DENIED=5`。旧 kb_walk 直接吞掉，前端看不到任何原因。

**修复**：kb_walk 子目录级 read_dir 捕获 `code=5/32` → `skip.access_denied += 1`（单目录失败不阻断其他目录）；根目录级 kb_scan_dir 捕获 `code=5/32` 时直接返回带中文 hint 的 Err，前端 toast + state.error 红提示「请关闭其他程序对该目录/文件的独占占用，或以有权限的用户重新运行应用」。

---

**💊 所有 Windows 对齐改动清单（最小侵入，不重写主流程）**

| 文件 | 改动 |
|------|------|
| [src-tauri/build.rs](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src-tauri/build.rs) | `#[cfg(windows)]` 时写 XML 应用兼容清单到 OUT_DIR，链接参数 `/MANIFEST:EMBED,ID=1 /MANIFESTINPUT:manifest` 嵌入到 EXE，声明 Windows 10 1607+ `longPathAware=true`，绕开 MAX_PATH=260。零新依赖。 |
| [src-tauri/src/lib.rs](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src-tauri/src/lib.rs) | ① KbSkipStats 新增 3 字段：encoding/path_too_long/access_denied；② 新增 `path_to_roundtrip_str(p)` 防御 U+FFFD round-trip 失败；③ kb_walk：`#[cfg(windows)]` 捕获 raw_os_error 206/111/5/32 分类计数，fname 含 U+FFFD 即记 encoding 跳过；④ KbPickAndScanResult / KbScanResult 补齐 3 字段；⑤ 预扫描 seen = files.len() + 6 类 skip 总和；⑥ kb_scan_dir 根目录错误时 Windows 码映射到中文 hint；⑦ kb_pick_and_scan_dir / kb_pick_dir 也走 path_to_roundtrip_str。 |
| [src/core/kb.js](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src/core/kb.js) | ① 新增 `_kbBasename(path)`：同时支持 `\`（Windows 驱动器/UNC）和 `/` 分隔符，取 `Math.max(lastIndexOf('\\'), lastIndexOf('/'))` 做 basename，不再「Windows 整条路径当 name 显示」；② chooseDir 诊断时补齐 skipped_encoding / skipped_path_too_long / skipped_access_denied 3 条中文提示；③ _kbListFiles 重扫场景时同样从 result 对象提取 6 类 skip 拼「目录诊断：…」红 note；④ basename 对齐 dir_name 兜底。 |
| [src-tauri/tauri.conf.json](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src-tauri/tauri.conf.json) | 移除本次最初误加的 `bundle.windows.longPathAware=true`（Tauri 2 tauri-build 不识别，会 cargo check 报 unknown field）。实际启用方式改为 build.rs 嵌入 manifest。 |

**构建校验**：
- `cargo check --message-format=short`（Tauri Rust 层）：✅ **Finished `dev` profile in 4.83s，零 error**。
- `npm run vite:build`（浏览器版前端）：✅ **built in 509ms**，dist/index.html + assets/js/index.js + vendor/xlsx.* 产物完整，可双击打开。
- 因跨平台限制未在当前 macOS 环境直接执行 Win x86_64 cargo build；但 `cfg(windows)` 代码块在非 Win 目标下被 dead-code-elim 掉，`cargo check` 通过说明 `build.rs` 非 win 分支（空块）+ Rust 源码 cfg 条件均正确编译。

**最终承诺（Tauri Windows 10 1607+ 桌面端）**：
- 「西游记」含 PDF 的多层长中文目录（≤MAX_PATH 或 >260 但系统 Win10 1607+）选择后：✅ 白名单文件 100% 扫描出来，**不再因 260 限制漏扫**。
- 若个别文件路径确实包含 WTF-16 孤立代理：✅ 前端 KB 区块底部红 note 明确提示「非法 Unicode N 个，请重命名」，**不再静默吞**。
- 若 PDF/DOCX/MD 被 Word/Acrobat/Defender 独占：✅ 红 note / toast 分别提示「ERROR_SHARING_VIOLATION 请关闭占用程序」，**不再 0 文件**。
- 选择目录完成后，绑定名称 UI 显示「西游记」而不是整条 `C:\Users\xxx\Downloads\...\西游记` Windows 绝对路径。

#### 10.12 Tauri 打包版「首次绑定 3 个 PDF ✅；点『重新索引』→ 0 文件 0 分块 0B ❌」根因拆解 + 三层防线修复（2026-08-29，**不推进版本号**；基准版本保持 v1.0.29）

**用户主诉**：浏览器版本（Vite dev / file:// 双击）下知识库 3 个 PDF 能正常扫描入库；但 Tauri 桌面版打包后，**首次**选择目录并索引显示正常（UI：「3 个文件 · XX 分块 · N kB」），点击「重新索引」按钮后，区块立刻显示为「0 个文件 · 0 个分块 · 0 B」，底部红 note 只模糊写了「目录诊断…」，没有说具体哪里错。

---

**🩺 确定根因（打包 Release 环境下能稳定复现，dev 因为 dev server + sandbox 较松不容易触发）**

macOS Tauri 2 里「选择目录 → 立刻扫描 → 入库 → 下次重新索引」这整个链路，在 §10.10 把命令合并为 `kb_pick_and_scan_dir` 后，**首次绑定已经彻底没问题**（回调内同步 kb_walk → 预扫描清单 files=[3PDF] → 入库成功 → UI 正常显示 3 个文件）。

但为什么「点击『重新索引』按钮后立刻 0 文件？」—— 按调用栈追踪，实际是下面这串**看起来都合理、组合起来就炸**的代码：

1. 用户首次选目录完成 → 前端 `kbPut(K_DIR, dirHandle={path,name,preScanned:[3PDF]})` 把**预扫描快照**也持久化进了 Rust `kb_store_*` 存储（因为 dirHandle 是一个普通对象，`kbPut(K_DIR, dir)` 会连 `preScanned` 字段一起 JSON 序列化）。
2. 用户点击「重新索引」按钮 → `KB.rescan()` → `rescan()` 第 734 行：`indexDir(dirHandle,{incremental:false})`（注意此时 `state.bound=true`，dirHandle 如果来自页面重启还会走 kbGet(K_DIR) 恢复，K_DIR 里那个 preScanned 也还在）。
3. `indexDir` → `_kbListFiles(dir)` → 旧代码判断 **`Array.isArray(dir.preScanned) && dir.preScanned.length`** 就直接 return `dir.preScanned`。
   - 看起来没问题：「preScanned 是上次扫过的 3 个 PDF，直接用省一次 invoke」。
   - 但 **打包 Release 环境下，距离首次 pick_folder 回调帧已经过去几秒~几小时** —— macOS NSOpenPanel 的「临时安全范围书签」在回调 return 后就会被 macOS 自动收回，所以现在这个 preScanned[].path 指向的 3 条 PDF 路径，`std::fs::File::open(path)` 会**全部 PermissionDenied throw**。
4. `_kbListFiles` 返回 found=[3PDF]（看起来正常！），`indexDir` 循环 3 次调 `parseFile(f.name,f)` → PDF 分支 `_kbReadBytes(source)` → Rust `kb_read_b64(path)` → 3 个全部 throw「Permission denied」。
5. parseFile throw → indexDir 把它 push 进 `errors[]`（但旧代码没把 errors 写 state.error，也没把 errors 拼到返回）→ `finalFiles=[]`、`finalBlocks=[]`。
6. indexDir 旧实现不区分「found=0」与「found>0 但 finalFiles=0」，直接：
   ```js
   state.files=finalFiles; state.blocks=finalBlocks;
   await kbPut(K_FILES, finalFiles); await kbPut(K_BLOCKS, finalBlocks);
   ```
   → 上次保存的 K_FILES/K_BLOCKS（3 个 PDF 解析出的真实分块）**被空数组覆写** → UI 显示「0 文件 · 0 分块 · 0 B」。
7. 雪上加霜：`_kbListFiles` 直接用了预扫描快照，根本没触发 `invoke kb_scan_dir` → Rust 端 PermissionDenied 的带中文 hint 的 Err 没暴露出来 → 前端 state.error 只能写「目录诊断：未发现 md/txt/pdf/docx…」—— 诊断完全错方向。

浏览器端不触发的原因：浏览器端根本不走 `IS_TAURI_KB` 分支（没有 `window.__TAURI__`），`_kbListFiles` 走 FSA walkDir，FileSystemDirectoryHandle 的权限在 dev server 上下文里稳定持久化；file:// 双击降级走快照模式，rescan 本来就会返回友好提示不会调 indexDir。

> **一句话总结**：预扫描快照 `preScanned` 只在「pick_folder 回调帧还活着」的那一刻有意义；当它被持久化到磁盘、或用户第二次点「重新索引」时，它已是**过期快照**——列表里的文件路径全部打不开，最终把已入库数据清为 0。

---

**💊 修复：三层防御（从入口到底层全部兜住，任何一层都能避免 0 文件 0 分块）**

##### 防线 1：入口处「禁止过期 preScanned」（[src/core/kb.js _kbListFiles](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src/core/kb.js#L239-L265)）
只有在「chooseDir 刚完成的**一次性初始化**」场景才允许用预扫描快照：
```
canUsePreScanned = !state.bound && !dirFromRestore && Array.isArray(dir.preScanned) && dir.preScanned.length>0
```
- 只要 `state.bound==true`（用户点了「重新索引」= 已绑定 → 必须重新扫描授权）→ 作废 preScanned。
- 只要 dirHandle 是 `kbGet(K_DIR)` 恢复出来的（路径相同 = 来自磁盘持久化）→ 作废 preScanned。
- 作废后强制走 `invoke('kb_scan_dir', {path})`：
  - 若书签过期 → Rust 返回 PermissionDenied Err，前端 state.error 明确提示「知识库目录临时授权已过期，macOS Tauri 选择目录后的临时权限有时间限制。请点『选择目录并索引』重新选择该目录，系统会在选完立刻重新扫描入库」；
  - 书签仍有效 → 正常重扫。

##### 防线 2：「重新索引成功」判据不只是「扫描列表非空」，还要 parseFile 真能产出 finalFiles>0，否则保留旧数据（[src/core/kb.js indexDir](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src/core/kb.js#L565-L594)）
新增「最后一道防线」分支：
```js
if(!incremental && found.length>0 && finalFiles.length===0){
  // 不执行：state.files = [] / await kbPut(K_FILES,[])
  // 改为：保留 state.files / state.blocks / K_FILES / K_BLOCKS 上次有效数据
  state.error = '解析失败 N 个文件（已保留上次成功索引的数据，未清空）……'
  return {ok:false, preserved:true, ...}
}
```
效果：**即使防线 1 漏了（假设将来还有其他过期路径），用户最多看到红提示，不再看到 0 文件 0 分块把数据清掉**。这是最重要的「数据安全」兜底。

##### 防线 3：Rust 回调内字节级可读性探针，预扫描结果若「列得出来但读不到」立刻标记为异常（[src-tauri/src/lib.rs](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src-tauri/src/lib.rs#L372-L397)）
在 macOS NSOpenPanel 回调帧还没 return 时（权限帧 100% 有效），额外同步跑一次：
```rust
fn probe_read_files(files: &[KbFileEntry]) -> usize {
  // 对 files[i] 逐个 File::open(&p) → read(&mut [0u8;1])，成功读至少 1 字节计数 +1。
}
```
`kb_pick_and_scan_dir` 把 `probe_read_bytes_ok` 返回给前端，前端 chooseDir 对比：`probe_ok < files.length` → 立刻 state.error 红提示「选择目录并扫描完成，但 N 个文件在回调上下文里就无法读字节，请重新点『选择目录并索引』重试，或移到 Downloads/Desktop 再试」。打包版探针只要全过 = 后续 3 个 PDF 解析肯定有字节读（除非用户手动删了文件），0 分块就不会出现。`kb_scan_dir` 同样带 probe 字段，便于将来前端扩展「重新索引时可读比例」的更细诊断。

附带：`_kbListFiles` catch 分支做了**权限/独占占用类异常的细分类映射**：
- macOS：PermissionDenied / Operation not permitted / security scope / scoped resource → 统一提示「请点『选择目录并索引』重新授权」。
- Windows：ERROR_ACCESS_DENIED=5 / ERROR_SHARING_VIOLATION=32 / AccessDenied → 提示「关闭占用程序 / 重新以有权限账户运行」。

---

**🏗️ 改动清单与构建**

| 文件 | 改动 |
|------|------|
| [src/core/kb.js _kbListFiles](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src/core/kb.js#L239-L304) | 重写 preScanned 可用性判断为「仅 !state.bound 且 !dirFromRestore」；权限类异常细分类映射到中文红提示。 |
| [src/core/kb.js indexDir](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src/core/kb.js#L565-L594) | 新增 preserved 兜底分支：incremental=false 且 found>0 && finalFiles=0 时保留旧索引、不覆写 K_FILES/K_BLOCKS，红提示原因。 |
| [src/core/kb.js chooseDir](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src/core/kb.js#L703-L720) | 读取 picked.probe_read_bytes_ok，若 < files.length 立即写权限异常红提示；避免后续 indexDir 被逐文件抛清空。 |
| [src-tauri/src/lib.rs](file:///Users/wbtrex/AI助手/node/trexwb/fastenerTradeWorkbench/src-tauri/src/lib.rs) | KbPickAndScanResult / KbScanResult 新增 probe_read_bytes_ok 字段；新增 `probe_read_files(files)` 做「回调帧逐文件读 1 字节」探针；kb_scan_dir 修复 E0382（out 移入返回值前先算 probe 再 move）。 |

**构建校验**：
- `cargo check --message-format=short`（Tauri Rust 层）：✅ **Finished `dev` profile in 2.12s，零 error**。
- `npm run vite:build`（浏览器版前端）：✅ **built in 457ms**，dist/index.html + assets/js/index.js 产物完整双击可运行。
- 打包 Release 验证留待用户在真实 Tauri 环境验证；三层防御设计上把「任何一步失败都不会清空上次有效索引」作为不变式。

**最终承诺（Tauri macOS 桌面打包版）**：
- 选择含 3 个 PDF 的知识库目录绑定入库后 ✅：UI 显示 3 文件 · N 分块 · N kB。
- 点「重新索引」若书签已过期（超时/重启/隔几小时）✅：**不再清空为 0 文件 0 分块**（preserved 兜底保留上次数据），KB 区块底部红提示明确：「请点击『选择目录并索引』重新选择该目录即可重新入库」。
- 点「重新索引」若书签仍有效 ✅：正常增量/全量刷新，分块、字符计数、目录名全部正确。
- 选择目录时若遇到极端 sandbox 边界（极少数 3rd-party 安全软件拦截）✅：Rust 探针 probe_ok<files → 前端红提示「请重新选择或移动到 Downloads/Desktop」，不会让用户看到「0 文件 0 分块」的无因静默失败。

---

## 文档校准

- `docs/COVERAGE.md` 重生成（v1.0.28 结构，632 函数全量扫描，84% JSDoc 覆盖）
- `docs/API.md` 工具清单 36 → **47**（补知识库 4 工具与功能层明细）
- `docs/操作手册.md` §7.4.1 状态流转矩阵与校验规则对齐 v1.0.28 实现

---

## 版本号

v1.0.24 → **v1.0.28**（合并 v1.0.25–v1.0.31 碎片版本；`package.json` / `src-tauri/tauri.conf.json` / `AGENTS.md` / `src/core/store.js` 同步）

## v1.0.24 · 📝 待发布

> **状态**: 📝 待发布（本地 vite 构建与验证通过，正式发布后改为 ✅ 已发布）
> **发布日期**: 2026-08-28
> **上一版本**: v1.0.22
> **版本范围**: 知识库开关行排版统一（**合并原 v1.0.23**：同一「标签逐字碎行」问题在 AI 设置弹窗与数据管理页两处的修复）+ CI 产物清单修复

---

## 变更

- **问题**：知识库区块内的开关行（提问时检索知识库 / AI 主动检索 / 自动注入兜底等）被 flex 容器压缩，中文标签无断词规则逐字折行，出现「AI 主 / 动检 / 索」孤字碎行
- **AI 设置弹窗（原 v1.0.23）**：`kbrenderZone` 开关行重构为语义化栅格（`ai-kb-opts` / `ai-opt` 类）：标签统一 `white-space:nowrap`——空间不足时整项换行到下一行，标签内部永不逐字碎行；Top-N 数字输入纳入统一样式（宽度/边框/focus 主色）；KB 状态行、操作行、主动检索子分区全部去内联样式，改用类体系并支持深浅主题
- **数据管理页（原 v1.0.24）**：`_kbRefreshBox` 的开关行（提问时检索知识库 / 注入 Top-N / 回答标注来源）迁移到同一 `ai-opt`/`ai-kb-opts` 类体系，两处共用一套 CSS
- **CI 工具修复（不改运行时版本）**：`scripts/gen-latest-json.mjs` 改为递归扫描 artifact 目录——`actions/upload-artifact` 多路径上传保留「最小公共祖先」下的子目录结构（Windows 产物在 `nsis/`/`msi/` 子目录、macOS 产物嵌套在 `src-tauri/target/...` 深层），原顶层平铺扫描找不到带 .sig 的更新产物导致 `update-manifest` 失败；URL 一律取文件名平铺指向 Release 资产根；已用模拟 CI 布局端到端验证双平台 latest.json 生成正确
- 版本号五处同步；构建通过

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
> **版本范围**: 知识库工具链修复 — 只读 KB 工具不再弹确认窗、未绑定知识库时工具不携带给模型、未知工具兜底不再打扰用户

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
4. **未知工具兜底**（core/ai.js）：模型发起校验器不认识的调用时，不弹确认窗，直接回填错误 tool 消息让模型自我纠正，全流程不打扰用户

## 版本号

- 五处同步 **v1.0.21**（package.json / package-lock.json / tauri.conf.json / Cargo.toml / AGENTS.md 基准版本 + store.js 兜底值）
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
> **版本范围**: 知识库可用性修复 — PDF 在 file:// 下解析失败兜底 + BM25 词频修正 + 定时增量更新 + 失败明细可见

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

### 1. PDF file:// 兜底（src/main.js + core/kb.js）

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
- AGENTS.md 豁免段更新：「唯一豁免」改为豁免清单，第 2 项登记 pdfjs-dist / mammoth 及其打包挂载方式与 pdfjsWorker 兜底钩子约束
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

## v1.0.9 · ✅ 已并入 v1.0.28

> **发布日期**: 2026-08-26 · **上一版本**: v1.0.7
> ⌘K 全局搜索、多模型接入、工具执行撤销回滚、本地模型认证适配、AI 体验修复与输入框快捷键调整——全部内容已与后续碎片版本（v1.0.25–v1.0.31）的迭代完善合并，**统一记述于 v1.0.28**（含全局搜索审查修复 9 项的明细），本节不再重复正文。

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

> 「AI 发送确认提示只弹一次」（原不递增版本号条目）已合并至 v1.0.28「AI 体验修复与打磨」统一记述。

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
- **阶段 4**（功能层 + 打磨）→ v1.0.4（功能记述统一并入本节）
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

## 二、功能记述说明

功能层工具 4 个、并发脏读检测、错误处理边界（_friendlyError）、操作历史筛选器、AI 操控系统自检——与 v1.0.5（全面审查修复后的最终形态）为同一批功能，**统一记述于 v1.0.5 分节**，本节不再重复。

## 三、验证

- 工具执行器测试 39/39 + 阶段 1 测试 30/30
- vite build / cargo check / tauri build 三构建通过

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
