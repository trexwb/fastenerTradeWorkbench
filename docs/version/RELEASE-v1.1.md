# 版本发布日志 · v1.1

> 本文件按主版本组织：v1.1.x 的全部迭代日志集中于此（最新在前）。
> 命名规则：`RELEASE-v{主版本}.md`；次版本迭代追加到文件顶部新分节。

---

## v1.1.0 · 专业解读云端同步深化

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
