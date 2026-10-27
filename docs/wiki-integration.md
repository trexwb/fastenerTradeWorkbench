---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 16825e3339a4e87ec3619b4c10842061_4cb2cc20d0f311f1acb8525400638852
    ReservedCode1: xFpO5X+OWuwlnWfEGK08uVIl0FlCLDmcibr9im8WC3A9gpPsTifswoJWVKh75kzyZspZNasVcLfJBFudOyGiSPJyoSlmzf1uqQitwhwSu5Gu/gnRv9xBBkDb78vl8Btx3MEhRU1ZHHnr0re079Qk+HTMgXTMxrHNXpimdWhC/aQ/DFFYZUo7f+ct9kI=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 16825e3339a4e87ec3619b4c10842061_4cb2cc20d0f311f1acb8525400638852
    ReservedCode2: xFpO5X+OWuwlnWfEGK08uVIl0FlCLDmcibr9im8WC3A9gpPsTifswoJWVKh75kzyZspZNasVcLfJBFudOyGiSPJyoSlmzf1uqQitwhwSu5Gu/gnRv9xBBkDb78vl8Btx3MEhRU1ZHHnr0re079Qk+HTMgXTMxrHNXpimdWhC/aQ/DFFYZUo7f+ct9kI=
---

# 专业解读 · 本地互动文档集成说明

> 适用版本：v1.0.57 之后的代码改动（**不推进版本号**，见 `docs/version/RELEASE-v1.0.md`）
> 涉及文件：`src/views/wiki.js`、`src/public/wiki/`、`scripts/gen-wiki-index.mjs`、`src/core/router.js`、`src/App.vue`、`src/public/sw.js`、`src-tauri/tauri.conf.json`、`src/styles/components.css`、`vite.config.js`

## 一、这是什么

侧栏新增的一级入口「专业解读」，用于在应用内阅读产品/材料方向的深度长页（如 17-4PH 沉淀硬化、氢脆、2A12-T4 自冲摩擦铆焊等）。

展示方式为 **iframe 内嵌**：文档保持自身的排版、主题与交互，应用只提供外框（返回列表 / 复制链接 / 独立窗口打开）。**不对文档内容做任何改写**，也不转成 Markdown 或 Vue 组件。

## 二、四层结构

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 文档层 | `src/public/wiki/*.html` | 单文件、内联 CSS、零外部依赖的互动长页；构建时由 Vite 原样复制到 `dist/wiki/`，不参与打包编译 |
| 索引层 | `src/public/wiki/index.js` | **自动生成**，内容为 `window.__WIKI_INDEX = { docs: [...] }`；禁止手工编辑 |
| 视图层 | `src/views/wiki.js` | 卡片列表 + iframe 阅读器；全局函数 `viewWiki()` / `openWikiDoc()` / `closeWikiDoc()` / `copyWikiLink()` |
| 入口层 | `src/core/router.js` | `NAV` 新增 `{k:'wiki'}`，`switch` 分发到 `viewWiki()`；`go()` 切走时调用 `__wikiReset()` 回到列表态 |

## 三、新增一篇文档（三步）

1. 把 `.html` 文件放进 `src/public/wiki/`（文件名建议英文短横线，中文亦可，前端会自动 `encodeURI`）。
2. 索引自动重建：
   - `npm run dev` 期间：插件监听到 `.html` 增删改 → 自动重建 + 页面刷新；
   - 构建：`vite build` 的 `buildStart` 阶段自动重建；
   - 手动：`npm run wiki:index`。
3. 刷新页面，「专业解读」列表即出现新卡片。

## 四、卡片元数据（可选）

索引生成器从 `<head>` 提取以下信息，缺失时自动兜底：

| 来源 | 用途 | 缺失时 |
| --- | --- | --- |
| `<title>` | 卡片标题 | 回退文件名 |
| `<meta name="description" content="...">` | 卡片摘要 | 自动截取正文首个 `<p>`（≤96 字） |
| `<meta name="wiki-category" content="...">` | 分组名 | 「专业解读」 |
| `<meta name="wiki-tags" content="a,b">` | 标签，逗号分隔 | 不显示标签 |
| `<meta name="wiki-order" content="10">` | 排序权重，越小越靠前 | 按标题拼音排序 |

篇幅（`≈ N 分钟`）由文件字节数估算，无需手工填写。

## 五、为什么索引是 JS 而不是 JSON

`dist/index.html` 要支持 **file:// 双击直接运行**，此时页面 `origin` 为 `null`，`fetch('wiki/index.json')` 会被 CORS 拦截而失败；而动态 `<script src>` 不受同源策略限制。

因此索引产出为 `window.__WIKI_INDEX = {...}`，由 `views/wiki.js` 注入 `<script>` 加载（与 `core/exporter.js` 加载 `vendor/xlsx.min.js` 同一策略）。**改回 fetch JSON 会在 file:// 下失效。**

## 六、三处环境适配（改动前必看）

1. **CSP**：`src-tauri/tauri.conf.json` 的 `frame-src` 由 `'none'` 改为 `'self'`——否则 Tauri 桌面端 iframe 直接空白。
2. **Service Worker**：`src/public/sw.js` 对 `pathname` 含 `/wiki/` 的 `navigate` 请求单独放行（缓存优先→网络），不再回退 `index.html`——否则离线打开文档会显示应用首页。iframe 加载 HTML 正是 `navigate` 模式。
3. **路径基准**：文档 URL 一律由 `new URL('wiki/'+encodeURI(file), document.baseURI)` 生成，自动适配 dev（`http://localhost:1421/`）、构建后（`file://` / GitHub Pages 子路径 / `tauri.localhost`）。

## 七、排错清单

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 列表显示「未找到文档索引」 | `src/public/wiki/index.js` 缺失或加载失败 | 执行 `npm run wiki:index` 后刷新 |
| 桌面端 iframe 空白，控制台报 CSP | `frame-src` 仍为 `'none'` | 改 `tauri.conf.json` 并重新打包 |
| 离线/部署后 iframe 显示应用首页 | SW 把文档请求当导航回退 | 确认 `sw.js` 的 `/wiki/` 放行分支存在，并清一次缓存（版本号变更会自动换缓存名） |
| 中文文件名 404 | 未编码 | 前端已 `encodeURI`；手工拼链接时同样需要编码 |
| 新增文档不显示 | 索引未重建 | dev 重启或 `npm run wiki:index` |

## 八、与根目录 `wiki/` 的区别

- 根目录 `wiki/`：GitHub Wiki 页面的 **Markdown 源**，推送到仓库 Wiki，与应用无关。
- `src/public/wiki/`：**应用内**阅读的互动长页 HTML，随构建产物一起分发。

两者互不影响，注意别放错目录。

## 九、知识库能力（2026-10-27 深化）

专业解读模块深化为「内置知识库」，索引升级为 version 2（新增 `docs[i].text` 全文纯文本，构建期提取，上限 2 万字/篇）：

| 能力 | 说明 |
| --- | --- |
| 站内全文检索 | 列表顶部搜索框，回车触发（§8 约定）；标题/摘要/标签/正文全文，支持空格分隔多关键词（AND），命中片段高亮 + 命中次数 |
| 筛选 chips | 全部 / 收藏 / 未读 / 有笔记，带实时计数；与搜索 AND 组合 |
| 收藏 | 卡片右上角星标、阅读页顶栏「收藏」按钮；阅读态切换只原地更新按钮，不重建 iframe（不丢阅读位置） |
| 阅读进度 | 打开即记已读、次数、最近时间；列表顶部「继续阅读」条直达最近 3 篇；卡片显示未读/上次阅读 |
| 阅读笔记 | 阅读页底部「我的笔记」，停止输入约 900ms 自动保存（防抖），也可点「保存笔记」；离开阅读态前冲刷 |
| 全局搜索接入 | ⌘K 面板新增「知识库」源（第七源），命中正文片段，Enter 直达文档 |
| AI 帮助 | `help-knowledge.js` 新增 wiki 条目，`query_help` 可检索 |
| 首次引导 | Coach 新增 wiki 模块三步引导 |

阅读元数据存储于 `DB.wikiMeta[file] = {star, read, readCount, lastReadAt, notes}`，随 DB 一起进 IndexedDB 与本地文件同步/备份（`mergeFileData` 按“本地优先”合并）。`_wikiMetaGet()` 只读不创建（渲染/筛选路径），`_wikiMeta()` 懒创建（写入路径）。

检索实现要点：关键词高亮先把文本按关键词切分、逐段过 `escHtml` 再拼 `mark`，用户数据不直接进 HTML；`gen-wiki-index.mjs` 提取全文时剔除 `script`/`style`/注释，不改动文档本体。

*（内容由AI生成，仅供参考）*
