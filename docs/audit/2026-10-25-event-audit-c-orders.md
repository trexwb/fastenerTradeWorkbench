# 事件绑定审计 · C 组「订单模块」（orders.js / search-panel.js）

- 审计日期：2026-10-25
- 审计范围：`src/views/orders.js`（2227 行）、`src/views/search-panel.js`（202 行）
- 依据：AGENTS.md「所有操作、按钮、连接、事件必须有响应」、§8 交互约定（搜索框回车触发）、§12.5 性能规范（高频事件防抖/节流）
- 方法：正则枚举两文件全部 `on*` 内联绑定与 `addEventListener`（含 onmouseenter），提取 handler 名后跨整个 `src/` 用 `rg` 反查定义（`function fn(` / `const fn=` / `window.fn=`），再逐个读实现核验防抖与重入防护
- 性质：只读审计，未修改任何 `src/` 代码

## 结论摘要

- 共核查 **66 处事件绑定**：orders.js 60 处（含 4 处 addEventListener）、search-panel.js 6 处（含 1 处 addEventListener）。
- **P1 = 0**：无死交互（61 个 handler 全部在 src 内找到真实定义，6 个跨文件），无 `oninput` 实时搜索违规。
- **P2 = 2**、**P3 = 3**。

## 一、违规清单

| 严重级 | 文件:行 | 事件/元素 | 问题描述 | 最小修复建议 |
|---|---|---|---|---|
| P2 | src/views/orders.js:176（实现 src/core/exporter.js:177） | `onclick="exportOrder(id)"` · 详情页「导出Excel」按钮 | `exportOrder` 为 `async` 且内部 `await loadXLSX()`（首次需动态注入 xlsx-js-style 脚本），函数与按钮均无重入锁、无禁用/冷却，双击会并发发起两次导出（两次下载、重复构建 workbook） | 在 exporter.js 增加模块级 `_exporting` 标志：进入置 true、`finally` 置 false，重入时 `toast('正在导出，请稍候…')` 后 return；若需按钮态，可在 orders.js 导出按钮上按 `_exporting` 渲染 `disabled` |
| P2 | src/views/orders.js:918 | `oninput="pmOnAllocInput(idx)"` · 价格库匹配弹窗分配数量输入框 | `pmOnAllocInput`（orders.js:2227）直接转调 `pmUpdateHint`，无防抖/节流；每次按键执行 `querySelectorAll` 全量扫描 `#pmList` 复选框并重写 `#pmHint` innerHTML。**不写库、不整页重渲，实际开销小**，但按 §12.5「输入必须防抖」的字面要求属未防护 | `const pmUpdateHintDebounced=debounce(pmUpdateHint,120)`，`pmOnAllocInput` 改为调用它；直接复用 `utils.js` 的 `debounce`，勿新造轮子 |
| P3 | src/views/orders.js:1001 | `const filterPriceMatch=debounce(filterPriceMatchNow,150)` | 该防抖包装**零调用**：`runPriceMatchFilter`（:933）与 `clearPriceMatchFilter`（:938）均直调 `filterPriceMatchNow`，注释「价格库匹配搜索防抖入口」与实际不符；当前因 pmSearch 只绑 Enter 而无实时输入路径，属悬空死代码 | 二选一：删除该未用常量与注释；或让未来任何 `oninput` 路径统一走 `filterPriceMatch`，避免下一位维护者误以为已有防抖 |
| P3 | src/views/orders.js:982（`submitPriceMatch` 循环调用 :1130 `addMatchSupplier`） | 价格库匹配弹窗「确定」提交链路 | 勾选 N 个供应商时循环调用 `addMatchSupplier`，每次内部 `persistSourcingChange({idx})` → `refreshProductList()` + `refreshSourceDrawer()`，即**每次提交触发 N 次整列表重渲**（供应商多时可见卡顿；正确性不受影响） | 循环内只更新 `_fItems` 并收集，循环结束后调用一次 `persistSourcingChange({idx})`（或给 `addMatchSupplier` 加 `silent` 参数跳过刷新） |
| P3 | src/views/search-panel.js:181 | `oninput="cmdInputChanged(this.value)"` · ⌘K 命令面板输入框 | 有手写 150ms 尾沿防抖（合规），但无 `isComposing` 守卫：中文/日文输入法组合期间每次拼音上屏前都会在 150ms 后重渲染结果区，中间态字母短暂进入查询。Enter 路径（`cmdInputKey`）已正确守卫 `e.isComposing`，故仅影响观感 | `cmdInputChanged` 内先判 `event.isComposing`（或改传 event 对象），组合中直接 return；不改变已有防抖 |

## 二、orders.js 逐绑定核查表（含已合规项）

| 行 | 事件 | 处理函数 | 存在性（定义位置） | 结论 |
|---|---|---|---|---|
| 11 | onchange | `updateOrderBatchBtn` | orders.js:1963 | 合规：纯读 DOM 更新按钮态 |
| 19 | onclick | `goOrderView` / `goOrderEdit` | core/router.js:（导出）/ orders.js: | 合规：导航类，同步 |
| 31 | onclick | `onOrderSearch('')`；`orderStatusFilter=''`；`onOrderStatusFilter('')` | core/router.js | 合规：清除筛选，多语句均可达 |
| 32 | onclick | `newOrder` | orders.js | 合规：进入新建态，无写库 |
| 50 | onclick | `onOrderSearch(...)`（`<a href="javascript:void(0)">` 图标） | core/router.js | 合规：§8 图标触发搜索；非死链（有 handler） |
| 51 | onkeydown | Enter → `onOrderSearch(this.value)` | core/router.js | 合规：§8 回车触发，且 `!event.isComposing` 守卫中文输入法 |
| 52 | onclick | `onOrderSearch('')`（清除 ×） | core/router.js | 合规 |
| 54 | onchange | `onOrderStatusFilter(this.value)` | core/router.js | 合规：下拉单次触发 |
| 60 | onclick | `batchDeleteOrders` | orders.js:1958 | 合规：经 `confirmModal` 二次确认后才 `softDelete`，危险操作不静默 |
| 62/65 | onclick | `newOrder` / `closeOrderDropdown();newOrder()` | orders.js | 合规 |
| 63 | onclick | `toggleOrderDropdown(event)`（含 `e.stopPropagation`） | orders.js:2169 | 合规 |
| 66 | onclick | `closeOrderDropdown();openOrderImport()` | orders.js:2070 | 合规 |
| 70 | onchange | `toggleAllOrders(this)` | orders.js:1949 | 合规：全选仅改 DOM 勾选 |
| 132/133 | onclick | `sourceItemFromDetail(i)` | orders.js:559 | 合规：仅打开寻货抽屉；写库发生在抽屉内确认链路 |
| 157 | onclick | `cancelOrderConfirm` | orders.js:415 | 合规：`confirmModal` 确认后 `changeOrderStatus` |
| 158 | onclick | `markOrderAbnormal` | orders.js:426 | 合规：`confirmModal` 确认 |
| 160/710 | onclick | `go('orders')` | core/router.js | 合规 |
| 163 | onclick | `confirmOrderComplete` | orders.js:1932 | 合规：`confirmModal` 确认 |
| 168 | onclick | `nextStepEnterDelivery` | orders.js:350 | 合规：未全收货时先 `confirmModal` 提示，确认后切换 |
| 176 | onclick | `exportOrder` | core/exporter.js:177 | **P2：async 无重入锁**（见违规清单） |
| 177 | onclick | `goOrderEdit` | orders.js | 合规 |
| 178 | onclick | `copyOrder` | orders.js:523 | 合规：`confirmModal` 确认后才 `genOrderNo()+push` |
| 197 | onclick | `enterEditDelivery` | orders.js:456 | 合规：仅切换编辑态 |
| 208/224 | onclick | `saveDeliveryInfo` | orders.js:437 | 合规（备注）：同步读表单→写 `o.delivery`→`saveDB()`→`render()`，按钮随重渲销毁，天然单次；无显式锁但同步链路无法并发 |
| 209 | onclick | `cancelEditDelivery` | orders.js | 合规 |
| 235 | onclick | `openSupplierQuoteImport` | orders.js:1622 | 合规：开抽屉 |
| 236 | onclick | `openGenerateQuote` | orders.js:1740 | 合规：开弹窗 |
| 278 | onclick | `nextStepStartSourcing` | orders.js:295 | 合规（备注）：校验失败 toast 拦截；成功走同步 `changeOrderStatus`（`saveDB();render()`），按钮随重渲销毁，双击第二次落在新 DOM 上不再命中 |
| 281 | onclick | `nextStepFinishSourcing` | orders.js:306 | 合规（备注）：同上，且前置"未寻满"清单拦截 |
| 285 | onclick | `nextStepConfirmSign` | orders.js:325 | 合规：`confirmModal` 确认 |
| 286 | onclick | `markOrderNoDeal` | orders.js:335 | 合规：`confirmModal` 确认 |
| 290 | onclick | `restoreOrderQuoting` | orders.js:345 | 合规（备注）：同步状态切换+重渲，同 278 |
| 381 | onclick | `prevStepOrder` | orders.js:393 | 合规：跨结算状态回退有 `confirmModal` 关联警告 |
| 614 | addEventListener input+change | 匿名 `handler=debounce(...,300)` | orders.js:612 | 合规：`tf_` 前缀表单字段草稿保存**已有 300ms 防抖**，见 §四 |
| 655/876 | onclick | `removeOption(i, optId)` | orders.js:1228 | 合规（备注）：同步删除已选供应商+`persistSourcingChange`，可逆操作、无确认弹窗，符合既有交互 |
| 667 | onclick | `editItem(i)` | orders.js:767 | 合规：开抽屉 |
| 668 | onclick | `sourceItem(i)` | orders.js:1107 | 合规：开抽屉 |
| 669 | onclick | `delItem(i)` | orders.js:773 | 合规：`confirmModal` 确认后 splice |
| 691/733 | onclick | `addItem()` | orders.js | 合规：开抽屉 |
| 692/734 | onclick | `toggleOrderItemDropdown(event)` | orders.js:1323 | 合规 |
| 694/695/736/737 | onclick | `closeOrderItemDropdown();addItem()` / `...;openOrderBatchAdd()` | orders.js | 合规 |
| 712 | onclick | `saveOrder`（`async`） | orders.js:1249 | 合规：**`_orderSaving` 重入锁**（:747 声明、:1250 拦截、:1317 `finally` 复位），重入时 toast 提示 |
| 809 | addEventListener input+change | `()=>markDrawerDirty()` | core/ui.js:106 | 合规：仅置位布尔 `_drawerDirty=true`（单赋值），无重绘/写库，无需防抖；见 §四 |
| 892 | onclick | `openPriceMatchModal(idx)` | orders.js:944 | 合规：开弹窗 |
| 893 | onclick | `openManualSupplierModal(idx)` | orders.js:1004 | 合规：开弹窗 |
| 916 | onchange | `pmOnCheckChange(idx,pid)` | orders.js:2207 | 合规：勾选联动收窄默认分配量，纯内存/DOM |
| 918 | oninput | `pmOnAllocInput(idx)` | orders.js:2227 | **P2：无防抖**（见违规清单；仅刷提示行，风险低） |
| 924 | onclick | `runPriceMatchFilter(idx)`（🔍 图标） | orders.js:933 | 合规：§8 图标触发 |
| 925 | onkeydown | Enter → `runPriceMatchFilter(idx)` | orders.js:933 | 合规：§8 回车触发 + `!event.isComposing`；该框**无 oninput**，不违反 §8 |
| 926 | onclick | `clearPriceMatchFilter(idx)` | orders.js:938 | 合规 |
| 1078/1079 | onclick | `sourceItemFromDetail(idx)` | orders.js:559 | 合规：同 132 |
| 1330/2180 | addEventListener click {once:true} | `closeOrderItemDropdown` / `closeOrderDropdown` | orders.js | 合规：一次性监听，触发即自动移除；`setTimeout(...,0)` 规避同一次点击冒泡误关 |
| 1348 | onclick | `parseOrderBatch()` | orders.js:1355 | 合规：只读解析+预览渲染，不写库，重复点击幂等（有去重合并） |
| 1422/1462/1492 | onclick | `removeOrderBatchRow(i)` | orders.js | 合规：仅删预览行数组 |
| 1433/1470/1503/1650/2127 | onclick | `closeDrawer()` | core/ui.js | 合规 |
| 1434/1471/1504 | onclick | `submitOrderBatch()` | orders.js:1508 | 合规：**`_batchOrderSaving` 锁+500ms 冷却**（:753/:1509-1511），重入 toast |
| 1588 | onclick | `parseSupplierQuote()` | orders.js:1595 | 合规：只读解析，重复粘贴按 key 合并去重 |
| 1642 | onclick | `removeQuoteRow(i)` | orders.js | 合规：仅删预览行 |
| 1651 | onclick | `submitSupplierQuote()` | orders.js:1687 | 合规：**`_supplierQuoteSaving` 锁+500ms 冷却**（:755/:1688-1690） |
| 1805–1810 | onchange ×6 | `updateReceiveField(optId, field, value)` | orders.js:1826 | 合规：`onchange` 非逐键；写库走 `saveDBDebounced()`，整页重渲走 `_receiveRenderDebounced=debounce(render,150)`（:1824） |
| 2081 | onclick | `parseOrderImport()` | orders.js:2089 | 合规：只读解析 |
| 2128 | onclick | `submitOrderImport()` | orders.js:2142 | 合规：**`_orderImportSaving` 锁+500ms 冷却**（:2002/:2143-2145） |
| 抽屉 OK（modal 回调，非内联） | — | `saveItemModal` | orders.js:828 | 合规：**`_itemSaving` 锁+500ms 冷却**（:749/:829-831） |
| 弹窗 OK（modal 回调） | — | `submitPriceMatch` / `saveGeneratedQuote` / `manualSupplier` | orders.js:952/1767/1149 | `submitPriceMatch`、`saveGeneratedQuote` 合规（同步写+先行 `closeModal()`，按钮即销毁）；`manualSupplier` 合规：**`_manualSupSaving` 锁+500ms**（:751/:1150-1151） |

## 三、search-panel.js 逐绑定核查表

| 行 | 事件 | 处理函数 | 存在性 | 结论 |
|---|---|---|---|---|
| 84 | onclick | `askAISearch()`（无结果区「问 AI」） | search-panel.js（本文件） | 合规：空文本直接 return，有兜底 toast |
| 95 | onmouseenter | `cmdHover(idx)` | 本文件 | 合规：仅置 `_cmdSel` + class 切换，`mouseenter` 非逐像素高频，无需节流 |
| 95 | onclick | `cmdOpen(idx)` | 本文件 | 合规：先关面板再执行 action（`go(...)` 导航） |
| 181 | onkeydown | `cmdInputKey(event)` | 本文件 | 合规：`isComposing` 守卫 + Esc/↑/↓/Enter/Tab 全分支，`preventDefault` 到位 |
| 181 | oninput | `cmdInputChanged(this.value)` | 本文件 | 合规（防抖）：手写 `clearTimeout(_cmdTimer); setTimeout(cmdRender,150)`，150ms 尾沿防抖；**P3**：缺 `isComposing` 守卫（见违规清单） |
| 182 | onclick | `closeSearchPanel()` | 本文件 | 合规：`_cmdOpen` 幂等守卫 |
| 187 | addEventListener mousedown | 匿名（点遮罩关闭） | 本文件 | 合规：仅真实点击触发（非 mousemove），`e.target===wrap` 精确判定，无高频风险 |

> 附：`askAIOnItem(i)`（Tab 键路径，:172）为 JS 内部调用而非内联绑定，函数存在且 `_cmdRendered[i]` 空值守卫完整，不属死交互。

## 四、addEventListener 专项（5 处）

| 位置 | 监听 | 频率 | 结论 |
|---|---|---|---|
| orders.js:614 | `input` + `change`（`tf_*` 表单字段） | 逐键 | 合规：共享一个 `debounce(...,300)` 句柄（:612），300ms 内合并，写 localStorage 草稿 |
| orders.js:809 | `input` + `change`（产品抽屉 `.drawer-bd`，委托） | 逐键 | 合规：回调只执行 `_drawerDirty=true`（ui.js:106 单赋值），无 DOM 重建/无 I/O，防抖无收益 |
| orders.js:1330 | `click`（document，`{once:true}`） | 点击级 | 合规：`once` 触发即卸载；`setTimeout 0` 避免开启菜单的同一次点击立即关闭 |
| orders.js:2180 | `click`（document，`{once:true}`） | 点击级 | 合规：同上 |
| search-panel.js:187 | `mousedown`（overlay） | 点击级 | 合规：仅判断 `e.target===wrap` 后关面板 |

## 五、oninput 专项

| 位置 | 现状 | 判定 |
|---|---|---|
| orders.js:918 `pmOnAllocInput` | 无防抖；仅重算 `#pmHint` 文案（不写 DB、不重渲） | **P2**（按 §12.5 字面）；实际性能风险低 |
| search-panel.js:181 `cmdInputChanged` | 手写 150ms 尾沿防抖 | 合规；P3 建议补 `isComposing` |
| orders.js:51 / :925 搜索框 | 仅 `onkeydown` Enter（+`isComposing` 守卫），无 oninput | 合规（§8） |
| orders.js:1001 `filterPriceMatch` | debounce 150ms 已定义但无调用点 | **P3** 死代码 |

## 六、写操作重复触发防护专项

| 写函数 | 触发点 | 防护 | 判定 |
|---|---|---|---|
| `saveOrder`（async） | orders.js:712 | `_orderSaving` 重入锁 + `finally` 复位 | 合规 |
| `saveItemModal` | 产品抽屉 OK | `_itemSaving` + 500ms 冷却 | 合规 |
| `submitOrderBatch` | :1434/:1471/:1504 | `_batchOrderSaving` + 500ms | 合规 |
| `submitSupplierQuote` | :1651 | `_supplierQuoteSaving` + 500ms | 合规 |
| `submitOrderImport` | :2128 | `_orderImportSaving` + 500ms | 合规 |
| `manualSupplier` | 手动供应商弹窗 OK | `_manualSupSaving` + 500ms | 合规 |
| `saveDeliveryInfo` | :208/:224 | 无锁，但同步写+立即 `render()` 销毁按钮 | 合规（备注） |
| `saveGeneratedQuote` | 生成报价弹窗 OK | 无锁，同步写+先 `closeModal()` | 合规（备注） |
| `submitPriceMatch`（分配提交） | 价格库匹配弹窗 OK | 无锁，同步校验+先 `closeModal()` | 合规（备注）；性能见 P3（:982 N 次重渲） |
| `exportOrder`（async 导出） | orders.js:176 | **无锁、无禁用** | **P2** |
| `changeOrderStatus` 直连按钮（278/281/290） | 详情页状态按钮 | 无锁，但同步 `saveDB();render()` 自限 | 合规（备注） |
| 危险操作（取消/异常/未成交/签约/完成/复制/删除/批量删除/回退） | 多行 | 全部 `confirmModal` 二次确认 | 合规 |

## 七、已合规要点汇总

1. **无死交互**：orders.js 55 个 + search-panel.js 6 个 handler 名全部在 `src/` 内找到真实定义；其中 `go`、`goOrderView`、`onOrderSearch`、`onOrderStatusFilter` 定义于 `src/core/router.js`，`closeDrawer` 于 `src/core/ui.js`，`exportOrder` 于 `src/core/exporter.js`，其余均在本文件；无空串 onclick、无 `href="#"` 无处理死链（两处 `javascript:void(0)` 均带 onclick）。
2. **写提交六把锁**：`_orderSaving`/`_itemSaving`/`_batchOrderSaving`/`_supplierQuoteSaving`/`_orderImportSaving`/`_manualSupSaving` 声明集中在 orders.js:747–755，均为「重入即 toast 返回」，四个批量类另加 500ms 冷却。
3. **破坏性/状态类操作零静默**：取消、异常、未成交、签约、完成、复制、删除、批量删除、跨结算回退全部经 `confirmModal`。
4. **5 处 addEventListener 全部合规**：2 处 `{once:true}` 自动卸载、1 处布尔置位、1 处 300ms 防抖、1 处点击级 mousedown。
5. **收货字段高频链路防护正确**：`onchange` 触发 + `saveDBDebounced()`（索引库）+ `_receiveRenderDebounced`（150ms 整页渲），三层解耦。
6. **§8 搜索交互合规**：订单列表搜索（:51）与价格库匹配搜索（:925）均为 Enter/图标触发 + `!event.isComposing`；全文件仅 1 处 oninput（:918 分配数量），不存在列表搜索逐键触发。
7. **⌘K 命令面板**：150ms 防抖 + 40 条结果上限 + 分组截断 5 条，DOM 体量可控。

## 八、边界与待证

- `exportOrder` 修复落在 `src/core/exporter.js`（本组范围外），本次仅记录按钮侧证据与最小改法，未改动代码。
- `submitPriceMatch` 的 N 次重渲（P3）在勾选供应商数量少于 3 时无可感影响，建议与下一次该弹窗改动合并处理，不做单独提交。
- 未审计 `src/core/ui.js` 的 `modal()/confirmModal()` 自身按钮防双击（同步回调 + 立即 `closeModal()` 已构成自限），如后续出现异步确认回调需单独复核。
