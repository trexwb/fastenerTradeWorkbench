# 采购订单主链路审计（orders.js + validators.js）

- 范围：src/views/orders.js（2228 行全文）+ src/core/validators.js（全文），交叉核对 router.js / ui.js / utils.js / store.js / App.vue / dashboard.js / ai-tools.js。
- 方法：只读静态审查；递归环用 node 以源码原样抽取函数复现（edit/new/detail 三模式对照）。
- 基线：工作区与 HEAD 一致（仅 audit-tmp 下无关未跟踪文件），package.json version 1.0.57。
- 严重级：P0×1，P1×2，P2×10。每条按「severity｜文件:行｜触发场景｜证据｜最小修复」组织。

---

## P0

### 1. 编辑模式「产品明细自动保存链」无限递归 → RangeError 栈溢出 + 主线程长阻塞
- **severity**: P0（卡死 / 批量操作部分丢失）
- **位置**: src/views/orders.js:595（`if(_fMode==='edit')refreshProductList();`）＋ orders.js:701（refreshProductList 尾部 `persistOrderItems();`）＋ orders.js:603-605（`persistOrderItems(){ persistSourcingChange(); }`）→ persistSourcingChange(571) 又回到 595 行，三函数互调无任何重入门闩。
- **触发场景**: 进入某订单「编辑」→ ①在寻货抽屉里用「价格库匹配」勾选供应商点确定（orders.js:982 `filtered.forEach` 第一家就递归爆栈，勾选多家只进第 1 家）；②手动录入供应商、移除分配；③保存/删除产品弹窗（856、776）；④批量提交（1539）。即编辑模式下一切产品明细变更。前置条件：本会话开过一次寻货抽屉（见 P1-2，未开过时先触发 ReferenceError 掩盖本条）。
- **症状**: 每层递归做一次 productCard 全量 innerHTML 重渲染 + 两次 localStorage 草稿写，数千层 → 页面冻结数秒 → `RangeError: Maximum call stack size exceeded`，后续 `toast('产品已保存')` 等全部丢失。
- **证据（复现）**: node 按 grep 行号从源码原样抽取 persistSourcingChange / persistOrderItems / saveOrderDraftFromItems / refreshProductList 四函数 + 最小桩：`edit 模式: RangeError: Maximum call stack size exceeded`；`new 模式 / detail 模式: returned normally`。new（_fMode='new'）与 detail（'__detail__'）模式因 595 行守卫不进入递归。
- **最小修复**: 删除 orders.js:701 的 `persistOrderItems();`（持久化已由各调用方经 persistSourcingChange 单向触发，草稿保存由 refreshProductList 内 saveOrderDraftFromItems 覆盖，无行为缺口）；或在 persistSourcingChange 入口加重入门闩（`if(_persisting)return; _persisting=true; try{...}finally{_persisting=false;}`）。

## P1

### 2. `_sourcingCtx` 全仓无声明，首次读取 ReferenceError → 编辑模式产品变更不落库
- **severity**: P1（自动保存断链 / 提示丢失）
- **位置**: 读取于 orders.js:574、594；首次赋值 orders.js:1117（sourceItem 内）；`grep -rn '_sourcingCtx' src` 全仓仅此 4 处，无任何 `let/var` 声明。App.vue 将全部脚本拼成单次 sloppy 间接 eval，读取未声明标识符抛 ReferenceError。
- **触发场景**: 新开会话、从未打开寻货抽屉时，在新建/编辑订单里第一次添加/删除产品：saveItemModal(856)/delItem(776) → refreshProductList(701) → persistOrderItems(604) → persistSourcingChange 在 574 行 `(_sourcingCtx&&...)` 抛 ReferenceError。编辑模式下 isEditMode 分支（583-590，`o.items=_fItems`）不执行 → 产品变更不写 DB；改动仅存 300ms 防抖草稿（saveDraft），而草稿恢复入口只存在于 newOrder(477)，编辑模式刷新后改动丢失。新建模式无 DB 写需求，仅丢 `toast('产品已保存')`（857）与 submitOrderBatch 的「BOM 一键补录」确认弹窗（1541 后代码被异常跳过）。
- **证据**: `views/orders.js:574: const isDetailMode=(_sourcingCtx&&_sourcingCtx.mode==='detail')||...`（赋值仅 orders.js:1117）。注：此异常发生在 595 行之前，会掩盖 P0-1 的递归；开过寻货抽屉后全局被赋值，递归立即显现——两条同链路，需一并修。
- **最小修复**: 在 router.js 顶部（`let _fOrderId=null;` 旁）补 `let _sourcingCtx=null;`。

### 3. 概览页入口 goOrder 进入错误的「编辑」态（死链级路由错配）
- **severity**: P1（功能走不下去 / 数据展示错乱）
- **位置**: src/core/router.js:602-609 `goOrder(id)` 只设 `curOrder=JSON.parse(JSON.stringify(o))`，不设 `_fMode/_fOrderId/_fItems`；调用方 dashboard.js:58（今日待办行点击）、:63（「处理」按钮）、:100（最近订单「查看」）。render 分支 `case 'orders': content=curOrder?viewOrderEdit():...`（router.js:259 附近）以 curOrder 为准进 viewOrderEdit。
- **触发场景**: 概览页点任一待办「处理」→ 渲染的是**空白「新建订单」表单**：viewOrderEdit 内 `const o=_fMode==='edit'?DB.orders.find(...):null`（orders.js:708 附近），_fMode 为初始 '' → o=null，表单字段全空（725 行状态下拉回落「待确认」）、面包屑却显示「编辑订单 · PO-xxx」；产品明细渲染的是**上一次编辑会话残留的 _fItems**（全局未清）；且 goOrder 不调 bindOrderDraftSave，草稿自动保存未绑定；点「保存订单」因 _fMode!=='edit' 走新建分支，被 validateOrderInput「请选择采购商」拦截——用户无法从概览到达目标订单。
- **证据**: `core/router.js:602: function goOrder(id){ const o=...; curOrder=o?JSON.parse(JSON.stringify(o)):null; curOrderView=null; ... }`（无 _fMode/_fOrderId/_fItems 赋值）。
- **最小修复**: goOrder 改为转调 `goOrderView(id)`（router.js:597）；如需直达编辑则对齐 goOrderEdit(orders.js:511) 的四件套赋值并补 `setTimeout(bindOrderDraftSave,100)`。

## P2

### 4. 状态机双轨：视图层流转完全绕过 canFlowOrderStatus，UI 可流 ≠ AI 可流
- **severity**: P2（一致性）
- **位置**: changeOrderStatus(orders.js:253) 直接改 status，不调校验；全仓 `canFlowOrderStatus` 仅 ai-tools.js:1016（AI flow_order_status）调用。validators.js:11-24 `NEXT_STATUS` 无任何回退边，而 UI：
  - 「上一步」按钮（orders.js:156,162 + prevStepButton:377）允许 寻货中→待确认、报价中→寻货中；
  - 「标记异常」按钮含「报价中」（orders.js:158），NEXT_STATUS['报价中'] 无 '异常'（validators.js:14）。
- **触发场景**: 详情页点「上一步（待确认）」立即成功；同一操作让 AI 执行则被 `非法流转：寻货中 → 待确认` 拒绝。无「按钮渲染了却流不过去」的情况（视图层根本不校验）；「能流过去却没有按钮」见 P2-6。
- **最小修复**: 二选一对齐——NEXT_STATUS 补反向边，或 changeOrderStatus 接入 canFlowOrderStatus（后者改动面大，建议前者+注释）。

### 5. 「上一步」的结算回退保护为不可达死分支
- **severity**: P2（健壮性）
- **位置**: viewOrderDetail 的 locked=['签约完成','送货中']（orders.js:102）时 prevBtnHTML 不渲染（orders.js:162 `(locked?'':prevBtnHTML)`）；而 prevStepOrder 的结算孤儿校验 `FROM_SETTLE=['签约完成','送货中','完成']`（orders.js:396-408）恰好只对这些状态有意义。「完成」另被 prevStepButton:379 与 prevStepOrder:394 双重拦截。
- **触发场景**: 签约完成/送货中订单有结算记录时，UI 上根本不存在可触发该保护的按钮，防孤儿结算逻辑形同虚设（console 手动调用除外）。
- **最小修复**: 若产品上确需回退入口则放开 locked 对 prev 的限制（保留校验）；否则删除 prevStepOrder 的 FROM_SETTLE 分支与注释，避免误导后续维护。

### 6. 编辑表单状态下拉近似无限制，可绕过状态机；跳状态后「进入送货」按钮消失
- **severity**: P2（流程口径）
- **位置**: orders.js:725 tf_status 列出除「未成交」外全部 ORDER_STATUSES（store.js:51）；saveOrder 仅特判未成交（orders.js:1288-1293）。签约完成且无任何供应商分配时，「进入送货」按钮的 IIFE `if(!rows.length)return''`（orders.js:163-171）不渲染，而 nextStepEnterDelivery:354 本身支持空分配（`if(!rows.length){changeOrderStatus(id,'送货中');return;}`）——入口条件与函数守卫不一致。
- **触发场景**: 把「待确认」订单经编辑表单直接改成「签约完成」→ 详情页无「进入送货」、无「上一步」（locked）、「取消订单」也不显示（157 行白名单不含签约完成），仅剩「标记异常」（终态）或再进编辑改状态。同类：能流过去（AI 可 完成→送货中/异常，NEXT_STATUS['完成']）但 UI 无按钮——由编辑表单兜底，属设计声明，仅记录。
- **最小修复**: tf_status 的选项按 `FTValidators.canFlowOrderStatus(o.status, s).ok` 过滤；「进入送货」按钮渲染条件与 nextStepEnterDelivery 守卫对齐（去掉 rows.length 条件）。

### 7. 批量添加产品：预览列字段错位 + 提交后数据残留导致重复入库
- **severity**: P2（显示错误 + 重复数据）
- **位置**: parseOrderBatch 行对象字段为 `salePrice`（orders.js:1427 附近 `row.salePrice=...`），随后 renderOrderBatchPreviewAppend 用 `fmt(r.price)` / `fmt(r.amount||(r.qty*r.price))` 渲染（orders.js:1457-1458）→ 单价恒 `¥0.00`、金额 `¥NaN`（fmt 对 NaN 输出 '¥NaN'，utils.js）。且 `window._batchOrderData` 提交成功后不清空（submitOrderBatch:1506 起无置空；1435 仅 `||[]` 初始化）。
- **触发场景**: 首次批量添加提交后，再次打开「批量添加」并粘贴新数据 → 旧行仍在（mergeBatchRows 累加）→ 再次提交把已入库行重复 push 进 _fItems。
- **最小修复**: renderOrderBatchPreviewAppend 字段统一为 r.salePrice / qty×salePrice；submitOrderBatch 成功后 `window._batchOrderData=[]`。

### 8. 批量导入供应商报价：提交后 `_quoteImportData` 残留
- **severity**: P2（同 P2-7 的残留半边）
- **位置**: submitSupplierQuote（orders.js:1685-1757）成功后不清空 `window._quoteImportData`（1617 仅初始化）。
- **触发场景**: 导入一次后重开抽屉粘贴新数据，旧行参与合并与提交；靠 supplierId/已选去重（1712）才未重复写 options，但 unmatched 统计与提示被旧行污染。
- **最小修复**: submitSupplierQuote 成功收尾处 `window._quoteImportData=[]`（closeDrawer 前后均可）。

### 9. 订单草稿单键互覆：编辑会覆盖未提交的新建草稿，详情寻货也会误清
- **severity**: P2（草稿数据丢失，可恢复性差）
- **位置**: 草稿单键 `DRAFT_PREFIX+'order'`（store.js:17, utils.js:150）；goOrderEdit(orders.js:511) 不检查也不区分草稿；编辑页 tf_ 输入（bindOrderDraftSave:608）与任何产品操作（saveOrderDraftFromItems:618-623）把**已有订单**内容写进公共键；详情页寻货落库无条件 `clearDraft(DRAFT_TYPES.order)`（orders.js:581）。
- **触发场景**: ①新建订单填一半（草稿已存）→ 转去编辑任一订单 → 新建草稿被静默覆盖；之后再点「新建订单」，恢复到的是那张已有订单的副本。②有新建草稿时在任意订单详情页做一次寻货 → 新建草稿被清。
- **最小修复**: 草稿键按模式拆分（`order_new` / `order_edit_<id>`），或编辑模式/详情落库前判断 `_fMode` 再决定读写键。

### 10. 列表筛选 UI 失同步：清除筛选后下拉与搜索框显示不同步
- **severity**: P2（体验/看起来坏了）
- **位置**: 空态「清除筛选」`onclick="onOrderSearch('');orderStatusFilter='';onOrderStatusFilter('')"`（orders.js:31）只改状态并 refreshOrderList（73-84 仅重绘 tbody/paging/countTag），不重置 `#orderStatusFilter` 的 select 显示；搜索框 × 同理 `onOrderSearch('')` 不清 `orderSearchInput.value`。
- **触发场景**: 选了状态筛选 + 输入关键词 → 结果为空点「清除筛选」→ 列表恢复全量，但状态下拉仍显示旧状态、搜索框仍留着关键词；再按一次回车又变回空结果。
- **最小修复**: refreshOrderList 内同步 `orderStatusFilter.selectedIndex=0` 与 `orderSearchInput.value=orderSearch`（含 has-val class）。

### 11. 弹窗框架两处关闭语义缺陷（影响订单页 3 个入口）
- **severity**: P2（体验）
- **位置/场景**:
  - a) modal() 确定按钮在 onOk 同步返回后无条件兜底 `closeModal()`（ui.js:92-99）→ 价格库匹配弹窗「未勾选任何供应商」校验失败（orders.js:954 toast+return）后弹窗仍被关闭，需重开重选。
  - b) confirmModal 右上角 × 直连 `closeModal()`（ui.js:137、161 只在 _modalCancel 上调 onCancel）→ newOrder 草稿确认弹窗（orders.js:477-503）点 × 后既不恢复也不清草稿，且 render() 只在两个回调里执行，底层停留旧视图（curOrder 已被改成 '__new__'）。
- **最小修复**: a) ui.js 约定 onOk 返回 false 时不兜底关闭；b) × 的 onclick 改为 `document.getElementById('_modalCancel').click()`。

### 12. toast 类型 'warn' 无效，图标显示 "undefined"
- **severity**: P2（提示显示）
- **位置**: orders.js:1270 `toast('⚠ 检测到 '+dupCount+' 条相同 SKU+规格...','warn')`；toast 实现仅支持 success/error/warning/info（utils.js:651-668，`icons[type]` 无 'warn' → `<i>undefined</i>`，`.msg.warn` 无样式类）。
- **触发场景**: 编辑订单里存在重复 SKU+规格行时点「保存订单」→ 提示条图标为 "undefined"。
- **最小修复**: 改为 `'warning'`。

### 13. 注入面核查结论（已查，未发现可利用缺口）
- **severity**: P2（仅记录小瑕疵）
- **证据**: 用户数据出口均过转义——renderOrderRow:13-24（escHtml/escJsStr）、renderItemHTML:637-672、contactTooltip:1889-1901、buildPriceMatchModalBody（905-940）、renderOrderImportPreview（2040 附近，逐列 escHtml）、openGenerateQuote、initQuoteSupplierCombos（escAttr）；escJsStr 连续做 JS 层+HTML 层双重转义（utils.js:454）。系统生成 id（PO-xxx/Uxxx/PRxx）直接拼入 DOM id 与 onclick（如 orders.js:14 `data-id="'+o.id+'"`、110 行 `delivery-readonly-'+o.id`），依赖 store.js:120 `SAFE_ID_RE` 在导入/恢复/绑定入口统一清洗，闭环成立。
- **小瑕疵**: renderOrderRow:13 checkbox 的 `data-id` 未 escAttr——同受 SAFE_ID_RE 保护，当前无害；若未来放宽 id 清洗需补。
- **最小修复**: 顺手补 escAttr(o.id)，无紧迫性。

---

## 已查无发现的类别（按任务三类口径）

- **A 卡死（除 P0-1 外）**: 无其他发现。await 仅 saveOrder:1247 `await saveDB()`（IndexedDB 本地写，store.js:864 返回 promise 且有 _checkIdbErrorToast 兜底），orders.js 无动态脚本加载/无未清理定时器（_setTimer 在 router.js、_receiveRenderDebounced/_pmUpdateHintDebounced 均正常）；弹层关闭路径齐全——drawer 的 Esc/遮罩点击/×/取消统一走 safeCloseDrawer（ui.js:193-257），dirty 时有二次确认，modal/confirmModal 的 Esc 分别映射 closeModal/_modalCancel.click，焦点圈闭 _trapDialogFocus 正常；z-index 梯度正确（--z-modal 1050 > --z-drawer 1000，寻货抽屉内的价格库/手动录入弹窗可正常盖住抽屉，variables.css:31）；combo 下拉开/关正常（focus 开、blur 150ms 延迟关、Esc 关、mousedown 防先blur）。
- **B 死链（除 P1-3 外）**: 无其他发现。orders.js 全部 inline onclick 引用的函数逐一核对存在定义（含跨文件：isPriceDuplicate→prices.js:215、fillSpecFromBOM→bom.js:710、markDrawerDirty→ui.js:168、exportOrder→exporter.js、goOrderView/newOrder/softDelete/genOrderNo/buildPaging→orderPage 等）；go('orders') 在 render 有分支；viewOrderDetail 对已删订单有兜底（orders.js:99 `if(!o){view='orders';return viewOrders();}`）；哈希/localStorage 路由恢复（restoreFromHash）对 edit 态正确设置 _fMode/_fOrderId/_fItems。orders.js:1881 deleteOrder 无调用方，属死代码而非死链。
- **C 无法操作（除 P1-2/3、P2-10/11 外）**: 无其他发现。bindView 无悬空绑定（tf_buyer 在 viewOrderEdit 必渲染且 dataset.bound 防重）；表单校验拦截均有 toast（saveOrder 走 validateOrderInput、产品数量/分配量/手动供应商走 msErr 区或 toast）；收货管理 disabled 字段有恢复路径（切换「是/否」即解除 disabled，updateReceiveField）；分页 _orderPage 夹取正常（viewOrders:64、refreshOrderList:73、orderPage:router）；搜索回车含 isComposing 防 IME 误触。

## 待证项（本轮未定论，附查法）

- P0-1 在真实浏览器中的首帧卡顿时长取决于订单明细规模（每层递归做 innerHTML+JSON.stringify+localStorage.setItem），建议修复后用 50+ 行明细订单实测一次编辑链路。
- git log -S 显示相关行早经 ea037ce/919dad5 提交（docs 类型提交夹带），精确引入版本未逐 commit 二分——对修复无阻塞，若需定责可 `git log -L 595,605:src/views/orders.js`。
