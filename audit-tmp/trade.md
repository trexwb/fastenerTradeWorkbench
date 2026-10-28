# 资金链路静态审查 — settlements.js / invoices.js / prices.js

- 日期：2026-10-28｜方式：只读静态审查（rg/sed/node 只读脚本，未改任何文件、未跑构建）
- 范围：src/views/settlements.js、src/views/invoices.js、src/views/prices.js，交叉核对 src/core/router.js（render/bindView/go、_settlePage/_pricePage、PAGE_SIZE）、src/core/ui.js（openDrawer/combo/confirmModal/markDrawerDirty/safeCloseDrawer）、src/core/utils.js（combo/buildPaging/checkDraftRestore/escJsStr/mergeBatchRows）、src/core/store.js（SPEC_FIELDS/STATUS_COLORS/softDelete）、src/App.vue（SCRIPTS 顺序 + 单次合并 eval）
- 已知问题未重复报：#settleUnitFilter/#invUnitFilter 未渲染、单位筛选 combo 绑定悬空（主线程修复中）
- 架构前提已验证：App.vue 把所有 core/views JS 拼接为**单次** `(0,eval)`，顶层 let/const（如 router.js 的 `_settlePage`、prices.js 的 `filterPrices`）全局共享——settlements.js 使用 `_settlePage` 合法，不构成问题。

## 统计

P0：0 条｜P1：2 条｜P2：6 条

---

## P1（功能无法操作 / 死链 / 数据完整性）

### 1. P1｜src/views/settlements.js:507｜结算记录 UI 无任何删除入口，delSettlement 是死代码
- **用户触发场景**：新增结算时录错金额/选错单位 → 打开「明细」抽屉，底部「结算记录」表只有 日期/金额/经手人/关联订单/备注 五列，没有删除按钮；全项目没有任何 onclick 调用 delSettlement。录错的资金记录 UI 上永远删不掉（softDelete('settlement') 的唯一另一入口是 AI 工具 ai-tools.js:1554，普通用户不可见）。
- **证据**：`function delSettlement(id){...}`（settlements.js:507，内含 v1.0.56 审计 M2 的发票级联勾选框 `delSettleInvChk`）；`rg -n "delSettlement" src/` 仅命中定义一处；docs/flows/settlements.md:166、docs/API.md:824 把它文档化为模块 API，docs/audit/2026-10-25-event-audit-e-views-commerce.md:72 称"删除走结算模块级联 delSettlement"——文档意图与代码现状冲突（函数在、入口无）。
- **最小修复建议**：openSettleDetail 的 recordRows 每行末尾加一列操作单元格 `<button class="btn xs danger" onclick="delSettlement('...id...')">删除</button>`（id 过 escJsStr/escAttr），即可让既有 delSettlement + 发票级联逻辑整体生效。

### 2. P1｜src/views/settlements.js:638、:690（combo allowCreate）+ :802（校验缺失）｜单位 combo 可自由输入 → 幽灵单位结算，金额从资金聚合中消失
- **用户触发场景**：工具栏「新增结算记录」→ 单位下拉（placeholder"搜索选择单位..."）不选候选而是直接键入一个不存在的单位名并回车（combo allowCreate=true → `select({id:raw,label:raw,isCustom:true})`，dataset.val=输入原文）→ 金额手填 → 保存：`if(!unitId)` 校验通过 → DB.settlements 写入 `unitId:'输入的文本'`。后果：settleReceiptData/settlePaymentData 汇总已收/已付时 `let b=buyerMap[s.unitId];if(b)...` 匹配不到任何单位，这笔钱在结算页**不进入任何聚合行**；而发票页 syncInvoices 按 s.unitId 生成发票并按 inv.unitId 分组，幽灵单位反而会出现在发票列表——结算与发票两页资金对不上。
- **证据**：settlements.js:638 `},'搜索选择单位...',true);`（onSettleTypeChange 重绑 :690 同样 true）；:802 `if(!unitId){toast('请选择单位','warning');return;}` 无存在性校验；utils.js combo 实现 `select(opt){...el.dataset.val=opt.id;...}` + Enter 分支 `else if(raw&&allowCreate){select({id:raw,label:raw,isCustom:true});}`；汇总侧 settlements.js `buyerMap[s.unitId]` / `supplierMap[s.unitId]` 取不到即静默跳过。
- **最小修复建议**：两处 st_unit 的 combo 第 5 参改 `false`（禁自由新建），并在 submitSettlement 增加一行 `if(!DB.units.some(u=>u.id===unitId)){toast('单位不存在，请重新选择','warning');return;}`。

---

## P2（健壮性与体验）

### 3. P2｜src/views/invoices.js:529-538｜openInvEdit 先改内存后校验，校验拦截时脏写已生效
- **用户触发场景**：编辑开票记录，状态选「已开票」但开票时间留空 → 点「保存」→ toast 报错留在抽屉，但 `inv.settleNote/invoiceNumber/invoiceDate/taxTitle/invoiceStatus='已开票'` 已经写进 DB.invoices 的内存对象；且 ui.js drawerOk() 在调用 onOk **之前**已把 `_drawerDirty=false`，此时点 X 直接关闭无确认；随后任意一次 saveDB（切换视图即触发 syncInvoices→saveDB）就把绕过校验的「已开票无日期」持久化。
- **证据**：:529-534 先赋值（`inv.settleNote=...; inv.invoiceNumber=...; if(isIssue){inv.invoiceDate=...; inv.taxTitle=...; inv.invoiceStatus=...;}`），:535 才 `if(inv.invoiceStatus==='已开票' && !inv.invoiceDate){toast(...);return;}`；ui.js drawerOk：`_drawerDirty=false; if(!_drawerOnOk)return; const r=_drawerOnOk();`。
- **最小修复建议**：回调内先把全部输入读入局部变量并完成校验，全部通过后再一次性赋给 inv。

### 4. P2｜src/views/prices.js:523（openPriceBatchAdd 未重置）｜批量导入报价 window._batchPriceData 跨会话残留
- **用户触发场景**：第一次批量导入解析 N 行并提交（或中途关闭抽屉），之后再次打开「批量导入」粘贴新的 1 行解析 → `mergeBatchRows(window._batchPriceData,parsed,...)` 把上一次的 N 行一并累加进预览表，用户不逐行核对就会把残留旧行再次提交入库。
- **证据**：parsePriceBatch `window._batchPriceData=window._batchPriceData||[];`（:523），openPriceBatchAdd 只重建抽屉 DOM（preview display:none）不重置该数组。
- **最小修复建议**：openPriceBatchAdd 开头加 `window._batchPriceData=[];`。

### 5. P2｜src/views/settlements.js:197（viewSettlements）、:361（settlePage）｜应收为 0 的单位落入「已收」子Tab，行内状态却标红「未结算」
- **用户触发场景**：采购商的签约后订单意向价未填（orderSales=0，明细抽屉会标「未定价」）且无收款 → gap=0 满足 `gap<=0` → 该单位计入「已收（N家）」子Tab，但行内 `pct=0` → 渲染 `<span class="tag err">未结算</span>` 红标。分类与状态自相矛盾，用户以为钱被吞了。
- **证据**：`return gap<=0;`（:197）把 0 应收+0 已收归入 paid 桶；状态标签 `pct>=100?'已结清':(pct>0?'部分结算':'未结算')`。
- **最小修复建议**：`gap<=0 && (应收+已收)<=0` 的单位归入「未收」桶，或对该情形显示灰色「无应收」标签。

### 6. P2｜src/views/settlements.js:244-245｜结算列表行 onclick 拼接 unitId 未过 escJsStr（同项目 invoices.js:306 用了 escJsStr，标准不一致）
- **用户触发场景**：单位 ID 含单引号（可经订单编辑页 tf_buyer combo allowCreate=true 自由输入产生 buyerId）时，点该单位行的「明细」「新增结算」按钮 → onclick 属性内 JS 语法错误 → 按钮点击无效（死按钮）。
- **证据**：`'<button class="btn xs" onclick="openSettleDetail(\''+d.unitId+'\',\''+type+'\')"...'`（:244，:245 新增结算按钮同模式）；对照 invoices.js:306 `onclick="openInvEdit(\''+escJsStr(inv.id)+'\')"`。
- **最小修复建议**：d.unitId 包一层 `escJsStr()`（或 escAttr，与 invoices 行一致）。

### 7. P2｜src/views/invoices.js:15-22｜saveDB 包装器把 _invSyncDirty 永久置真，脏标记防线失效
- **用户触发场景**：每次渲染发票页，viewInvoices + invoiceIssueData + invoiceReceiveData 共触发 3 次 syncInvoices；因为包装器在任何 saveDB 后都把 `_invSyncDirty` 置回 true，syncInvoices 的短路守卫 `if(!_invSyncDirty && ...) return;` 实际永不生效，每次渲染都全量重跑（首次/变更后还会连环多次 saveDB 放大 IndexedDB 写）；数据量大时发票页交互明显变慢。功能结果正确，纯性能/设计失效。
- **证据**：`saveDB=function(){_invSyncDirty=true;return _origSaveDBForInv.apply(this,arguments);}`（:18-21）与 syncInvoices 末尾 `if(changed)saveDB();`（把刚置 false 的标记又翻回 true）。
- **最小修复建议**：包装器改为在 `_origSaveDBForInv.apply` 返回后保持不变（去掉 `_invSyncDirty=true` 这行），由数据变更方自行置脏；或 syncInvoices 内 saveDB 后再 `_invSyncDirty=false`。

### 8. P2｜src/views/settlements.js:628、src/views/prices.js:243｜抽屉延时绑定回调无 null 防护
- **用户触发场景**：打开「新增结算」抽屉后 100ms 内（或「编辑报价」后 50ms 内）按 Esc 快速关闭 → 定时器触发时元素已随抽屉移除 → `document.getElementById('st_type').value` / `cEl.innerHTML=...` 抛 TypeError，仅控制台报错，无用户可见影响，但会中断同一回调里的后续绑定语句。
- **证据**：settlements.js:628 `let isReceipt=document.getElementById('st_type').value==='receipt';`（同回调内 bd/unitEl 均判空，唯独 st_type 不判）；prices.js:243 `cEl.innerHTML=contactOpts(uVal,'供应商');`（uEl 判空、cEl 未判空；对照 prices.js:296 `if(cEl)cEl.innerHTML=...` 是判空的）。
- **最小修复建议**：两处补判空 `if(!el)return;`。

---

## 已查且未发现问题的类别

- **A 卡死：未发现。** 三个视图的抽屉均有 X / 遮罩 / Esc / 底部取消四出口（openDrawer→safeCloseDrawer，脏表单还有二次确认，且确认弹窗已打开时 safeCloseDrawer 直接 return 防套娃）；confirmModal/modal z-index 1050 > drawer 1000（variables.css:31），确认弹窗不会被抽屉盖住；无 await/动态加载/无清不掉的 loading；防重锁（_settlementSaving/_invEditSaving/_priceFormSaving/_priceBatchSaving）500ms 自动释放不会卡死；分页 prev/next 有 disabled 边界，无同步大循环。
- **B 死链：除上述 P1-1/P1-2 外未发现。** 三文件全部 inline 处理器逐一核对均有全局定义（onSettleSearch/onSettleUnitFilter/drillSettleTab/switchSettleSubTab/openSettleDetail/openNewSettlement/toggleDrawerSection/onSettleTypeChange/submitSettlement/openInvEdit/switchInvSubTab/onInvSearch/onInvUnitFilter/invPage/settlePage/pricePage/newPrice/editPrice/delPrice/doPriceSearch/clearPriceFilter/toggleAllPrices/updatePriceBatchBtn/batchDeletePrices/togglePriceDropdown/closePriceDropdown/openPriceBatchAdd/parsePriceBatch/removePriceBatchRow/submitPriceBatch/updatePriceBatchBtn）；go('settlements')/inv-issue/inv-receive/settle-receipt/settle-payment 在 render() switch 均有分支（router.js:230-238）；buildPaging 的 onPage 名三个全部存在；filterPrices 仅 prices.js:166 一处 const 声明（无重复声明炸 boot 风险）；render('settlements') 传 `_settleTab`，工具栏 `openNewSettlement('',type)` 的 type 不会是 undefined。
- **C 无法操作：除上述 P2 外未发现。** bindView prices 分支要绑的每个 id 均有渲染对应：viewPrices 渲染 `#pf_unit`（toolbar）+ `#pf_type/#pf_standard/#pf_diameter/#pf_hardness/#pf_surface/#pf_material`（filter-bar，SPEC_FIELDS=store.js:26 六维）；`#pf_bom` 只出现在 bindView 的候选选择器里、无任何 getElementById('pf_bom') 绑定代码，无悬空副作用；`#pf_sku` 是普通 input 由 filterPricesData 直接 getElementById 读取，存在。combo 开关正常（focus 开 / Esc、blur+150ms、选中关），fitDrop 防容器裁剪；批量导入解析按钮 disabled 后随输入恢复（bindBatchPasteUX）；checkDraftRestore 恢复/放弃/取消三路都有出路；分页 _settlePage/_invPage/_pricePage 越界自动收敛。
- **新建结算向导路径**：实际为单抽屉三段式（类型/单位 → 勾选订单 → 金额），无分步前进/后退按钮；前进（勾选订单自动汇总金额 autoSumSettleAmount）、后退（改选单位 refreshSettleOrderList 重算）、取消（X/遮罩/Esc/取消键 + 脏确认）均有出路；类型切换 onSettleTypeChange 保留合法单位、清空非法单位并提示；单位已结清时订单列表显示"该单位暂无待结算订单"仍可继续做独立结算，无死路。
- **空态与按钮可达性**：金额 0/无结算记录 → viewSettlements 空态有「清除筛选」（有筛选时）+「新建结算」；无发票记录 → 空态「前往结算管理」go('settlements') 可达；无报价 → 「新增报价」可达；金额/单价为 0 的提交均有 toast 拦截（st_amount>0、ps_price>0），无静默失败。

## 待证项（未列入结论）

- orders.js tf_buyer（router.js:660 附近 combo allowCreate=true，placeholder 明示"或直接输入"）允许自由输入采购商 → buyerId 为非 DB.units 文本，与 P1-2 同源的幽灵 ID 风险是否在订单链路被后续逻辑兜住，超出本轮三文件范围，建议单独立项核对。
