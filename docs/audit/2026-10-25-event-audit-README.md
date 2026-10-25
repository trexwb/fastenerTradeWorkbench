# 事件与交互全量审计 · 汇总（2026-10-25）

> 审计目标：验证 AGENTS.md「所有操作、按钮、连接、事件必须有响应」+ §12.5（高频事件必须防抖/节流）+ §8（搜索回车触发、禁止 oninput 实时搜索）+ 写按钮防重复触发。
> 方式：5 个审计组并行（core 外壳 / core 服务 / 订单 / 主视图 / 结算·发票·AI），全量枚举约 240 处 `onclick`、60 处 `addEventListener`、8 处内联 `oninput`，处理函数跨全 src 反查存在性，逐个读实现核验防抖/防重/二次确认。
> 性质：只读审计；修复为后续针对性小修（见下「修复台账」），无业务算法改动。

## 一、结果总表

| 审计组 | 明细文件 | P1 | P2 | P3 |
|---|---|---|---|---|
| A core 外壳层（utils/ui/router/app/store/guide/App.vue/main.js） | [2026-10-25-event-audit-a-core-shell.md](2026-10-25-event-audit-a-core-shell.md) | 0 | 4 | 3 |
| B core 服务层（exporter/ai/ai-tools/kb/updater/sw 等） | [2026-10-25-event-audit-b-core-services.md](2026-10-25-event-audit-b-core-services.md) | 0 | 1 | 3 |
| C 订单模块（orders/search-panel） | [2026-10-25-event-audit-c-orders.md](2026-10-25-event-audit-c-orders.md) | 0 | 2 | 3 |
| D 主视图（dashboard/units/specs/bom/prices/keyboard/data） | [2026-10-25-event-audit-d-views-main.md](2026-10-25-event-audit-d-views-main.md) | 0 | 6 | 4 |
| E 结算/发票/AI 助手（settlements/invoices/ai-chat） | [2026-10-25-event-audit-e-views-commerce.md](2026-10-25-event-audit-e-views-commerce.md) | 1 | 0 | 4 |
| **合计** | — | **1** | **13** | **17** |

合规面（未列入违规的绝大多数绑定）：无空 `onclick`、无 `href="#"` 死链；全部搜索框为 Enter/图标触发且含 `isComposing` 守卫（§8）；orders/units/prices/bom/settlements/invoices 的写提交均有既有防重锁（`_xxxSaving`）或 `confirmModal` 门控；AI 流式渲染为自适应节流、`saveDBDebounced` 用法正确且终态硬写收口；`combo()` 输入已有 100ms 防抖；kb 索引有 `indexing` 守卫与超时兜底。

## 二、修复台账（2026-10-25 当轮完成）

### P1（1/1 已修）
| 位置 | 问题 | 修复 |
|---|---|---|
| invoices.js:343 | 空态「新增发票」`openInvEdit('')` 必命中「记录不存在」守卫，按钮承诺的功能不存在 | 改为「前往结算管理」`go('settlements')`（发票由结算自动生成，无手动建票链路） |

### P2（13/13 已修）
| 位置 | 问题 | 修复 |
|---|---|---|
| ui.js modal() / confirmModal() | async onOk 未决期可重复点击确定，删除/导入/解绑等破坏性确认可双击重入 | 确定键未决期 `disabled`，catch 恢复可重试 |
| ui.js drawerOk() | 抽屉保存键 async onOk 期间可双击 | 保存键加 `id="_drawerOk"`，未决期禁用、settle 后恢复 |
| utils.js bindDraftSave | 每键整表收集 + localStorage 同步写，无防抖 | 落盘 300ms 防抖；markDrawerDirty 保持同步 |
| exporter.js exportOrder | async 导出无重入锁，连击并发两趟构建+两次下载 | `_exportBusy` 标志 + finally 复位 |
| bom.js:324/328/331 | 必填校验 oninput 无防抖 | `bomValidateFieldDebounced`（150ms）包装，三处 oninput 改调 |
| specs.js:87 | 高亮 oninput O(n) 无防抖；:83 注释声称防抖与实现不符 | `highlightSpecValsDebounced`（120ms）包装；注释同步纠偏 |
| keyboard.js:117 | 全局快捷键 0 处 `e.repeat` 检查，按住连发 ⌘S/⌥⇧E 等 | 处理器入口 `if(e.repeat)return` |
| data.js exportJSON | 下载类写操作无防重 | 1.5s 冷却（`EXPORT_JSON_COOLDOWN_MS`） |
| specs.js exportAllSpecs | 下载类写操作无防重 | 1.5s 冷却（`SPEC_EXPORT_COOLDOWN_MS`） |
| store.js syncNow | 异步写文件期间无进行中禁用 | `_fileSyncing` 标志 + finally 复位 |
| orders.js:918 pmOnAllocInput | 分配数量 oninput 无防抖 | `_pmUpdateHintDebounced`（120ms）；勾选联动仍同步 |

### P3（13 项已修 + 1 项部分修复 + 3 项明确不改）
已修：utils.js bindBatchPasteUX（120ms 防抖）；router.js setDownloadBtn 点击即禁用；updater.js download() 补 downloading 守卫；sw.js 后台 cache.put 挂 `event.waitUntil`；orders.js 删除零调用 `filterPriceMatch`；search-panel.js cmdInputChanged 补 `isComposing`；data.js 导入按钮补 `id="importBtn"` 激活既有 loading 防护；prices.js 删除零调用 `_priceFilterDebounced`；dashboard.js 统计卡改调 `setUnitRoleFilter`（修复死分支）；keyboard.js Enter 兜底 `window.event`→`e`；settlements.js 移除 `#st_orderList` 重复 change 绑定；ai-chat.js 草稿落盘 300ms 防抖；ai-chat.js 移除冗余 setProvider 双调 + kbBindDir/kbPickFiles 补 indexing disabled。
部分修复：sw.js 的「无缓存且网络失败的离线兜底页」不改（行为变更收益低，主场景 file:// SW 不生效）。

## 三、明确不改（已接受风险）

1. `buildPaging` 的 `onPage||'page'` 潜在兜底 —— 全 src 10 处调用均显式传回调名，当前不可触发。
2. `AI.chat()` 核心层无重入拒绝 —— 视图层四重防护（chatting 检查/300ms 门槛/按钮态切换/_wfRunning）已覆盖真实入口；核心层贸然 throw 可能影响内部合法调用链。
3. `submitPriceMatch` 勾选 N 家供应商触发 N 次整列表重渲 —— 正确性无损，审计建议与该弹窗下次改动合并处理。

## 四、验证记录（修复当轮）

- 18 个改动文件 `node --check` 全部通过；`npm run vite:build` 通过（仅既有 chunk 体积警告）。
- 浏览器实测（`vite preview` + http）：应用正常启动；specs 防抖高亮生效；invoices 空态按钮为「前往结算管理」；dashboard 统计卡 onclick 含 `setUnitRoleFilter`；`exportOrder` 无效 ID toast「未找到订单」；AI 设置弹窗连点 3 次保存仅执行 1 次（按钮立即禁用、结算后关窗一次）。
- file:// 直开在自动化浏览器窗格内被窗格注入的 CSP 禁 eval 拦截（`dist/index.html` 本身无 meta CSP，见其内注释；本次改动未触碰 index.html/main.js/App.vue/vite.config.js），故交互验证在 http 环境完成；常规浏览器双击 `dist/index.html` 不受影响。

> 版本号维持 1.0.57（不推进，AGENTS.md §0）；发布记录见 [docs/version/RELEASE-v1.0.md](../version/RELEASE-v1.0.md) 顶部「v1.0.57 · 🔧 事件与交互合规修复（不推进版本号）」分节。
