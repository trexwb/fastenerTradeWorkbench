# 事件审计 · A 组「core 外壳层」（2026-10-25）

- 审计范围：`src/core/utils.js`、`src/core/ui.js`、`src/core/router.js`、`src/core/app.js`、`src/core/store.js`、`src/core/guide.js`、`src/App.vue`、`src/main.js`
- 任务性质：只读代码审计（未修改 src/，未运行构建/git）
- 审计依据：项目 AGENTS.md「所有操作/按钮/连接/事件必须有响应」；§12.5 高频事件（输入/滚动/resize）必须防抖或节流；§8 搜索框回车触发、禁止 oninput 实时搜索；写/异步提交按钮应有重复触发防护（禁用/冷却/防抖）
- 核验方法：8 个文件全文通读；所有 onclick/on* 与 addEventListener 逐一登记；被引用全局函数跨全 src 用 grep 核验存在性与非空（因业务 JS 经 App.vue 间接 eval 全局执行，处理函数可能定义在任何文件）；死交互特征（`onclick=""`、`href="#"` 无点击处理）对 8 文件 grep 扫描为 0 命中

## 一、违规清单

| 严重级 | 文件:行 | 事件/元素 | 问题描述 | 最小修复建议 |
|---|---|---|---|---|
| P2 | src/core/ui.js:51 | modal() `_modalOk`.onclick | onOk 返回 Promise 期间弹窗未关闭且无 in-flight 锁，重复点击「确定」会重复执行写回调（如 store.js 内异步确认路径），双击风险 | 点击后立即置 `okBtn.disabled=true`，Promise settle（then/catch/finally）后再关闭或恢复 |
| P2 | src/core/ui.js:85 | confirmModal() `_modalOk`.onclick | 同上：确认类弹窗是删除/导入/解绑等破坏性操作的共用入口（实例：store.js:381 解绑、store.js:1358 删备份、store.js:1416 导入覆盖、store.js:1305 备份提醒→nowBackup()），async onOk 未决期可重复触发 | 同上，_modalOk 点击即禁用；同步路径 closeModal 已兜底不受影响 |
| P2 | src/core/ui.js:142,169 | 抽屉底部「保存」`onclick="drawerOk()"` | drawerOk() 无冷却/禁用；onOk 为 async 时（未同步 closeDrawer）`_drawerOnOk` 仍非空，320ms 关闭动画期间按钮仍可点，双击=两次保存回调 | drawerOk 入口先 `btn.disabled=true`（或复用 `.btn.loading` pointer-events:none），onOk 完成后再 closeDrawer |
| P2 | src/core/utils.js:250-258 | bindDraftSave 容器 `input`+`change` 监听 | 每次按键都执行 collectFn()（多次 getElementById/querySelectorAll 整表收集）+ saveDraft()（JSON.stringify 全表 + localStorage.setItem 同步写），无防抖，违反 §12.5 | handler 包 `debounce(fn,300)`（utils.js:11 现成工具）；markDrawerDirty() 可保留同步 |
| P3 | src/core/utils.js:648 | bindBatchPasteUX textarea `input`→sync | 高频 input 无防抖，但 handler 仅切换按钮 disabled/透明度，开销可忽略（严格按 §12.5 字面属违规，按实害降级 P3，如需统一可包 debounce） | 可选：`const syncD=debounce(sync,150)`；或维持现状并在规范中明确「轻量状态切换豁免」 |
| P3 | src/core/utils.js:859 | buildPaging 分页按钮 `onclick="fn(p)"` | `let fn=onPage\|\|'page'` 的默认回调 `page` 全局未定义（全 src 无 `function page(`）；当前 10 处调用均显式传名未触发，属潜在死交互 | 删除 `\|\|'page'` 默认值改为必传，或定义兜底空实现并 console.warn |
| P3 | src/core/router.js:467 | 设置弹窗「下载并安装」#setDownloadBtn.onclick | 调 `window.Updater.download()` 后仅靠下一次 renderSetStatus 重绘移除按钮，双击瞬间窗口可重复触发下载；Updater 内部状态守卫（updater.js:31）不完全覆盖 download 入口 | onclick 内先 `db.disabled=true` 再调 download |

计数：**P1=0，P2=4，P3=3**（P1=死交互或 oninput 实时搜索：A 组无命中）。

## 二、逐文件核查明细（含已合规项）

### 1. src/core/utils.js（845 行）
| 位置 | 事件/元素 | 结论 |
|---|---|---|
| :11 / :28 | debounce/throttle 定义 | ✅ 合规：公共工具完备，带 .cancel()，A 组未新造轮子 |
| :250-258 | bindDraftSave input/change | ❌ P2（见清单） |
| :643-648 | bindBatchPasteUX input→sync | ⚠ P3（见清单） |
| :703-752 | combo：input→showDebounced | ✅ 合规：输入已防抖 100ms（已知线索核实属实：`const showDebounced=debounce(...,100)`）；focus/blur/keydown/mousedown/mouseenter 均单次或轻量；Enter/Esc 有处理且 isComposing 防输入法误触 |
| :845-880 | buildPaging 页码/上一页/下一页 | ✅ 基本合规：10 处调用（orders.js:47/85、units.js:72/152、prices.js:59/142、bom.js:62/190、settlements.js:256、invoices.js:308）回调名全部真实存在（unitPage/orderPage=router.js，pricePage/bomPage/settlePage/invPage=各视图）；越界 prev/next 带 disabled；⚠ P3 默认 `fn='page'` 见清单 |

### 2. src/core/ui.js（174 行）
| 位置 | 事件/元素 | 结论 |
|---|---|---|
| :42 | 弹窗右上 × `onclick="closeModal()"` | ✅ 合规：closeModal 存在且非空 |
| :51-56 | modal `_modalOk`.onclick | ❌ P2（异步 onOk 无锁） |
| :59 | `_modalExtra`.onclick | ✅ 合规：先 closeModal 再执行回调，无双击窗口 |
| :84-99 | confirmModal ×/确定/取消 | ❌ 确定键 P2（同上）；✅ 取消键合规；✅ 嵌套确认有 `after!==before` 防误关 |
| :110-117 | safeCloseDrawer | ✅ 合规：`if(document.getElementById('_mask'))return` 防确认弹窗叠加（重复触发防护的良好实现） |
| :139 / :142 | 抽屉遮罩 onclick、× 与「取消」`onclick="safeCloseDrawer()"` | ✅ 合规：safeCloseDrawer 存在且非空 |
| :142 / :169-171 | 「保存」`onclick="drawerOk()"` | ❌ P2（见清单）；drawerOk 函数本身存在非空 |

### 3. src/core/router.js（1140 行）
| 位置 | 事件/元素 | 结论 |
|---|---|---|
| :185 | window hashchange | ✅ 合规：仅 http/https 注册（file:// 规避），回调 restoreFromHash+render 均存在 |
| :215/:220/:258/:267 | 侧栏导航/遮罩/汉堡 `onclick="go(...)"" toggleSidebar()"` | ✅ 合规：go/toggleSidebar 本文件定义非空 |
| :227 | 面包屑返回链接 `href="javascript:void(0)" onclick="go('orders')"` | ✅ 合规：有点击处理，非死链 |
| :274-278 | 顶栏 5 个 shortcut-btn/theme-tgl | ✅ 合规：openSearchPanel=search-panel.js:171、openAIAssistant=ai-chat.js:325、showShortcutsModal=keyboard.js:61、openSettingsModal=router.js:388、switchTheme=router.js:362，全部存在非空 |
| :272/:287-289 | 「待授权」标签、同步横幅两链接与关闭按钮 | ✅ 合规：均有 onclick（go('data')/移除横幅+写 localStorage） |
| :302/:1095 | `__maybeShowModuleGuide` 钩子 | ✅ 合规：router.js:1095 定义（200ms 去抖 + 同模块幂等门闩）；typeof 守卫 |
| :425 | setAutoUpdate.onchange | ✅ 合规：Updater.setAutoEnabled 存在（updater.js） |
| :459-469 | renderSetStatus：检查更新/下载并安装/立即重启 | ✅ 基本：三按钮均 JS 绑定、函数存在；600ms 轮询在 box/upd 缺失时自清；⚠ P3「下载并安装」见清单 |
| :655/:661 | prices 页 combo onSelect `filterPrices()` | ✅ 合规（重点核验）：filterPrices 并非缺失——prices.js:168 `const filterPrices=debounce(_priceFilterNow,150)`，存在且带 150ms 防抖；AGENTS.md 函数清单未收录该 debounce 别名，属文档滞后，非代码缺陷 |
| :744 | document click 委托（Tauri 外链） | ✅ 合规：IS_TAURI_RUNTIME 守卫，preventDefault+invoke open_external，有 catch |
| :931/:950/:953-954 | Coach 关闭/跳过/上一步/下一步 | ✅ 合规：渲染时 addEventListener，Coach.prev/next/dismiss 均存在 |
| :981/:995 | Esc keydown / 遮罩点击关闭 | ✅ 合规：dismiss 中成对 removeEventListener；遮罩点击含高亮孔透传逻辑 |
| :1009-1010 | window resize/scroll(capture) → reposition | ✅ 合规：cancelAnimationFrame+rAF 合帧（等效节流），state._cleanup 在 dismiss 时移除两个监听 |
| — | `_settleTab`/`_invTab` 隐式全局 | 备注：render/bindView 中未声明即赋值，依赖 sloppy eval 全局语义可运行；非事件类问题，超出本次审计范围，仅记录 |

### 4. src/core/app.js（36 行）
- bootApp()/onAppReady()：无任何事件绑定与可交互元素。✅ 无违规。bootApp 由 App.vue boot() 调用（window.bootApp typeof 判断），initApp=store.js 提供，onAppReady 由 store.js initApp 各分支 `typeof onAppReady==='function'` 守卫调用，链路闭合。

### 5. src/core/store.js（1451 行）
| 位置 | 事件/元素 | 结论 |
|---|---|---|
| :236/:380/:1356/:1416/:1305 | bindFile/unbindFile/deleteBackup/importParsedData/checkBackupReminder 的 modal/confirmModal 回调 | ✅ 回调函数均存在非空；bindFile onOk 先 closeModal 无双击窗口；❌ 异步确认路径受 ui.js:85 P2 放大（解绑/删备份/导入覆盖/立即备份） |
| :888-890 | visibilitychange/pagehide/beforeunload → flushFileSave | ✅ 合规：仅清定时器+触发一次写盘，轻量；防抖窗口数据不丢的正确兜底 |
| :863/:874 | saveDBDebounced/_scheduleFileSave | ✅ 合规：300ms 防抖合并写（P3/R5 修复），带 _saveTimer/_fileSaveTimer 去重 |
| :1308-1315 | initAutoBackup setTimeout+setInterval(60s) | ✅ 合规：`if(_autoBackupTimer)return` 防重复注册；后台标签跳过轮询；失败 10 分钟冷却（_backupRetryAt） |
| :1259-1275 | nowBackup(btn) | ✅ 合规：data.js:102 以 `nowBackup(this)` 调用，`.btn.loading{pointer-events:none}`（components.css:123）构成触发中禁点；⚠ checkBackupReminder 路径调用 nowBackup() 无 btn，保护依赖 confirmModal（已计入 ui.js P2 影响） |

### 6. src/core/guide.js（62 行）
- ✅ 合规/无死交互：App.vue SCRIPTS 已移除本文件（App.vue:34-38 注释说明），运行时不执行；全 src 检索 `dismissModuleGuide` 仅 guide.js:33 自身定义、无任何活代码引用（grep 0 命中）→ 不存在引用未定义函数的死交互。文件为留档空壳适配器，行为与 App.vue 注释一致。

### 7. src/App.vue
- ✅ 无违规：模板为空壳 div，无任何可交互元素与事件绑定；boot() 仅设置加载态 innerHTML（无按钮）；boot 失败 catch 输出错误面板（无交互元素）；`window.bootApp/initApp` typeof 守卫调用。

### 8. src/main.js（35 行）
- ✅ 无违规：纯 module import（样式/markdown-it/dompurify/highlight.js/pdfjs/mammoth）+ 全局依赖挂载（__KB_DEPS/__MD_DEPS/pdfjsWorker 钩子）+ createApp(App).mount；无事件绑定、无可交互元素。

## 三、横切核验结论
1. **死交互（P1 类）**：8 文件 `onclick=""`/`href="#"` grep 为 0；所有 onclick 引用的全局函数经跨 src 核验全部存在非空；render() 引用的 11 个 viewXxx 渲染函数全部存在。**P1=0。**
2. **oninput 实时搜索（P1 类）**：A 组无搜索框；units.js:96-97 与 orders.js:50-52 的 onUnitSearch/onOrderSearch 均为 onkeydown Enter（含 isComposing 守卫）+ 图标 onclick，符合 §8（佐证 router.js 侧函数合规）。
3. **高频事件防抖**：combo 输入 ✅、Coach resize/scroll rAF 合帧 ✅、文件写盘 300ms 防抖 ✅；❌ bindDraftSave（P2）、⚠ bindBatchPasteUX（P3）。
4. **写按钮重复触发防护**：nowBackup（.btn.loading 禁点）✅、safeCloseDrawer 防重入 ✅、Updater 状态机部分覆盖 ✅；❌ modal/confirmModal 异步确定键、抽屉 drawerOk（P2）、下载并安装（P3）。
5. **已知线索核对**：bom.js/search-panel.js/specs.js/orders.js/ai-chat.js 的 oninput 线索属其他审计组文件范围，本组未重复审计；utils.js combo `showDebounced(100)` 线索核实为真（已合规）。

## 四、待证项 / 边界
- `window.Updater.download()` 入口内部是否有完整防重入守卫未逐行审计（updater.js 属其他组文件）：建议该组核验 updater.js:66 起 download 函数的 states 守卫。
- async onOk 双击实害取决于各视图 onOk 实现是否幂等；本组仅核验了 store.js 内 4 处受影响路径，views 组请按 ui.js:51/85/142 三个组件入口横向排查。
- `_settleTab`/`_invTab`/`_settleSubTab` 隐式全局、guide.js 死代码保留、AGENTS.md 函数清单缺 `filterPrices`（debounce 别名）条目：均非事件缺陷，建议文档/规范层面跟进。
