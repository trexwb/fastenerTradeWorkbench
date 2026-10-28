# 基础设施审计报告（audit-tmp/infra.md）

- 审计日期：2026-10-28（以工作区未提交文件为准，非 HEAD）
- 审计方式：只读静态审查 + rg/grep 交叉对照；未修改任何文件、未运行构建/测试
- 通读文件：src/core/router.js、ui.js、utils.js、store.js、app.js、guide.js、updater.js、src/views/keyboard.js、search-panel.js（交叉）、orders.js（交叉）、src/main.js、src/App.vue、src/index.html、src/styles/variables.css（z-index 表）
- 问题统计：**P0=0，P1=4，P2=12**

---

## 一、已查且未发现问题的项（按任务七重点逐项）

1. **render() view 分支完整性——无缺失分支（已查，通过）**。收集到全部路由目标：`go('x')` 字面量 7 个（orders/wiki/units/settlements/prices/invoices/bom，grep 去重统计）＋ NAV 数组动态生成的 go（dashboard/units/specs/bom/prices/orders/settlements/data 及 4 个子键）＋ `view='x'` 赋值（dashboard 初始、orders 三处）＋ ai-tools `navigate_view` 枚举 13 个 + search-panel 6 个 go 目标。render() switch（router.js:264-285）覆盖 dashboard/units/specs/bom/prices/orders/settle-receipt/settle-payment/settlements/invoices/inv-issue/inv-receive/data/wiki 全部 14 个键，无落空目标。`viewWiki`/`__wikiReset`（wiki.js:806/499）、`_settleTab/_settleSubTab`（settlements.js:5-6）、`_invTab`（invoices.js:5）均有声明，无 ReferenceError 风险。
2. **modal/drawer/toast 打开-关闭配对**：modal 开前先移除旧 `_mask`、confirmModal 同、drawer 开前先移除旧 wrap；modal 背景点击故意不关闭（有注释）；drawer 有 dirty 确认（safeCloseDrawer）；async onOk 防双击（禁用确定键）；toast 自动淡出+同文案去重（_TOAST_SHOWN Map，淡出后解锁）。配对本身无泄漏。发现的问题见 P1-3、P1-4、P2-1、P2-2、P2-9。
3. **z-index 层叠**：variables.css:30 全表 combo 40 < topbar 50 < combo-over 60 < overlay 99 < sidebar/dropdown 100 < drawer 1000 < modal 1050 < tooltip 1500 < cmd 1600 < toast 2000；coach-overlay=calc(overlay+10)=109（components.css:1331），dropOverlay=modal+10。menu-overlay(99) 在 sidebar(100) 之下、抽屉遮罩在面板之下，均正确；toast 永远在最上。未发现遮挡点击的层叠错误。combo 下拉有 fitDrop 向上展开防容器裁剪（utils.js）。
4. **快捷键输入框防护与 repeat**：keyboard.js keydown 首行 `if(e.repeat)return` 防连发；`isInInput()` 判定 input/textarea/select/contentEditable，`/`、`?`、⌥ 系列在输入框内全部透传；⌘K/⌘S 设计为输入框内也触发；搜索框 Enter 有 `!e.isComposing` 输入法守卫；combo 方向键/回车有 `e.isComposing` 守卫。发现的问题见 P2-3（⌥ 不检查弹层）、P2-12（⌘S 文案与实现不符）。
5. **IndexedDB 打不开/配额满降级**：idbOpen 有 5 秒超时兜底（store.js:662-665，防 WKWebView 永不回调）；initApp catch 降级内存模式并 toast 提示「刷新将丢失，请导出备份」；写失败经 idbStatus='error' → `_checkIdbErrorToast` 全局一次性红色 toast（store.js:873-878）。发现的问题见 P1-1、P2-8。
6. **启动失败白屏兜底**：App.vue boot() 全链路 try/catch——资源缺失抛错、eval 失败包装重抛、onMounted catch 渲染统一错误界面（含错误摘要，App.vue `onMounted(async...)` P3/R4 修复）；bootApp 内 KB/WikiKB/AI 健康检查均有独立 try/catch。发现的问题见 P2-10（main.js 静态 import 阶段无兜底）。
7. **guide 引导 Coach**：guide.js 已空壳化且不在 App.vue SCRIPTS（注释明确）；`window.__maybeShowModuleGuide` 由 router.js Coach IIFE 挂载（200ms 去抖防「弹两次」）；Coach.show 幂等门闩、dismiss 双向清 localStorage、残留 overlay 全量清理、Esc/遮罩/跳过/走完四路关闭、事件监听与 rAF/scroll 监听均在 dismiss 清理。发现的问题见 P2-2、P2-11。

---

## 二、P0（卡死 / 数据丢失）

无。未发现 await 永不 resolve、渲染死循环、或必然的数据丢失路径。

---

## 三、P1（功能无法操作 / 死链）

### P1-1｜首个会话（空库初始化）所有删除操作静默失败
- **severity**：P1（B/C 类：操作无效，无任何提示）
- **文件:行**：src/core/store.js:792、799、811（根因）；store.js:958/975/994（崩溃点）；src/views/units.js:372、orders.js:1883、prices.js:253、bom.js:275、settlements.js:521/524（受害调用方）
- **触发场景**：全新浏览器首次打开应用（IndexedDB 无数据）→ 新建一个单位/订单/BOM → 点删除并确认 → 记录未被删除、无任何提示；批量删除、AI 删除、回滚同理。同一会话内持续复现，刷新页面后才自愈。
- **证据**：store.js:799 `DB={units:[],specs:...aiWorkflows:[]}` —— 三个初始化分支（部分数据清空 / 首次使用 / IDB 不可用内存降级）重建的 DB 均缺 `trash/aiOps/wikiMeta/_savedAt`（模块级初始对象 store.js:69 有这些字段，但被整体替换），且这三个分支**均未调用 ensureDBFields()**；而 `softDelete` 第一步就 `DB.trash.unshift(trashEntry)`（store.js:958）→ TypeError。confirmModal 的 onOk 同步抛错被 `catch(e){}` 吞掉后仍执行兜底 closeModal（ui.js:96-97）→ 弹窗关闭、无 toast。旁证：store.js importParsedData 注释自述 v1.0.44 已修复「导入覆盖后 trash/aiOps 缺失导致首次删除 TypeError」的**同族缺口**，但 initApp 三个分支漏修。
- **最小修复**：在 store.js:792/799/811 三处 `DB={...}` 赋值后各加一行 `ensureDBFields();`（或在字面量中补 `trash:[],aiOps:[],wikiMeta:{}`），与 importParsedData 的收口方式对齐。

### P1-2｜⌘K 全局搜索点击订单结果永远落在列表页（死链）
- **severity**：P1（B 类死链）
- **文件:行**：src/views/search-panel.js:47（根因）；src/core/router.js:196（被 go() 清空）
- **触发场景**：任意页面按 ⌘K → 输入订单号 → 点击命中的订单结果 → 期望进入该订单详情，实际总是落在采购订单**列表**页。
- **证据**：search-panel.js:47 `action:function(){curOrderView=o.id;go('orders');}` —— 先赋 `curOrderView`，紧接着 `go(v){view=v;curOrder=null;curOrderView=null;...}`（router.js:196）将其清空 → render 的 orders 分支 `curOrder?viewOrderEdit():curOrderView?viewOrderDetail():viewOrders()` 落到 viewOrders()。
- **最小修复**：改为 `action:function(){goOrderView(o.id);}`（router.js:597 已有该函数，语义完全一致）。

### P1-3｜modal() 的兜底关闭破坏「校验失败留在弹窗」契约，表单输入被销毁
- **severity**：P1（C 类：校验拦截保存，提示随弹窗一起消失，输入全丢）
- **文件:行**：src/core/ui.js:96-97（根因）；src/views/orders.js:1147-1166（manualSupplier 5 处校验 return）、orders.js:953/976（submitPriceMatch 2 处校验 return）
- **触发场景**：订单寻货 →「手动录入供应商」→ 采购单价留空或分配数量超需 → 点「确定」→ 内联错误（msErr）刚渲染就被整体关闭的弹窗带走 → 用户看到的现象是「点了确定什么都没发生」，已填的名称/电话/价格全部丢失。「价格库匹配」弹窗在未勾选供应商或分配合计超量时同理。
- **证据**：ui.js:96 `if(onOk){try{const r=onOk();if(r&&...then...){...return;}}catch(e){}}` 后第 97 行无条件 `closeModal();` —— 同步 onOk 返回 undefined（校验失败 return）也会被兜底关闭。而 ui.js 注释自述「各 modal 的 onOk 内部已经会自行调 closeModal()，这里的 closeModal 只是兜底」，即契约是 onOk 校验失败时不关窗，实现与之矛盾。manualSupplier 成功路径末尾自会 closeModal，失败路径依赖不关窗，被兜底击穿。
- **最小修复**：modal() 仅在 onOk 返回 `false`（显式信号）时跳过兜底 closeModal，或约定校验型 onOk 返回 Promise；两个调用方可先行把校验分支改为 `return false` 并在 modal() 加 `if(r===false)return;` 判断（ui.js:96 一处 + 调用方各一行）。

### P1-4｜combo 下拉的 Esc 不阻断冒泡，连带关闭宿主弹窗/抽屉
- **severity**：P1（C 类：弹层关不掉的反向问题——用户只想关下拉，结果弹窗整个没了）
- **文件:行**：src/core/utils.js:816（根因）；src/core/ui.js:87（modal mask keydown）、ui.js:196-198（drawer panel keydown）
- **触发场景**：在含 combo 的弹窗（如「手动录入供应商」ms_name、订单编辑抽屉的 BOM/属性 combo）中展开下拉后按 Esc 想收起下拉 → 下拉收起的同时 Esc 冒泡到 `.mask`/`.drawer-panel` 的 keydown → 整个 modal 被 closeModal 销毁（输入丢失）；抽屉场景触发 safeCloseDrawer（未 dirty 时直接关闭）。
- **证据**：utils.js:816 `else if(e.key==='Escape'){closeDrop();}` —— 无 `e.stopPropagation()`/`e.preventDefault()`；事件冒泡到 ui.js:87 `if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeModal();return;}`。
- **最小修复**：utils.js:816 改为 `else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeDrop();}`（一行）。

---

## 四、P2（健壮性与体验）

### P2-1｜⌘K 面板的 Esc 先移除自身再冒泡，订单详情页按 Esc 关面板会连带导航回列表
- **文件:行**：src/views/search-panel.js:207（`wrap.addEventListener('keydown',...Escape→closeSearchPanel()` 无 stopPropagation）；src/views/keyboard.js:112-118（document 级 Esc 链）
- **触发场景**：在订单详情/编辑页按 ⌘K 打开面板 → 按 Esc 关面板 → 面板关闭的同时 keyboard.js 的 document Esc 处理器继续执行（此刻 `getElementById('cmdPanel')` 已为 null）→ 命中「订单详情/编辑页 Esc→返回列表」分支 → 意外导航。
- **证据**：keyboard.js Esc 顺序：cmdPanel → _mask → drawer-wrap → `if(view==='orders'&&(curOrderView||curOrder)){kbdNav('orders');return;}`。
- **最小修复**：search-panel.js:207 的 Esc 分支加 `e.stopPropagation()`。

### P2-2｜Coach 引导的 Esc 与全局 Esc 叠加：详情页首次引导时按 Esc「关引导+退列表」同时发生
- **文件:行**：src/core/router.js Coach `_ensureOverlay` 的 `document.addEventListener('keydown',onKey)`（约 :846）；src/views/keyboard.js:112-118
- **触发场景**：首次进入采购订单详情页（orders 模块引导未看过，Coach 蒙层覆盖详情页）→ 按 Esc 想只关引导 → keyboard.js（先注册）先执行 `kbdNav('orders')` 导航回列表，Coach 处理器随后 dismiss。
- **证据**：两个 document 级 keydown 都不 stopPropagation；keyboard.js 按 eval 顺序（views/keyboard.js 先于 core/router.js）先触发。
- **最小修复**：Coach 的 onKey 里 `e.stopPropagation()`，或 keyboard.js Esc 链顶部加 `if(document.querySelector('.coach-overlay'))return;`。

### P2-3｜⌥ 系列导航不检查弹层：抽屉打开时按 ⌥+O 等会销毁抽屉并永久锁死页面滚动
- **文件:行**：src/views/keyboard.js:188（⌥ 分支无 hasOverlay 守卫）；src/core/ui.js:221（openDrawer `document.body.style.overflow='hidden'`）
- **触发场景**：抽屉打开（焦点在抽屉内非输入元素或 body）→ 按 ⌥+O/⌥+U 等导航键 → go()→render() 用 innerHTML 重建 #app，挂在 #app 里的 `.drawer-wrap` 被连同销毁，但 body 的 `overflow='hidden'` 无人恢复 → 此后整页无法滚动，直到下次打开并正常关闭抽屉。
- **证据**：keyboard.js ⌥ 分支仅判 `inp`；openDrawer 设置 overflow 后只有 closeDrawer（ui.js:232）恢复，render() 销毁 DOM 不触发 closeDrawer。
- **最小修复**：⌥ 导航前加 `if(hasOverlay())return;`（keyboard.js:188 前一行）；或 render() 开头兜底 `document.body.style.overflow='';`。

### P2-4｜goOrderEdit 不更新 hash 且 curOrder 语义不一致（字符串 id vs 对象）
- **文件:行**：src/views/orders.js:511-519；src/core/router.js:226-227（面包屑 `curOrder.id`）、router.js restoreFromHash（hash 恢复路径 `curOrder=JSON.parse(JSON.stringify(o))`）
- **触发场景**：详情页点「编辑」进入编辑模式 → 地址栏 hash 仍是 `#/orders/ID`（无 /edit 后缀）→ 刷新后回到**详情**模式（编辑状态丢失，靠草稿兜底）；且面包屑「编辑订单 · 」后订单号为空（字符串 id 无 .id 属性），而通过 hash 恢复进入编辑时面包屑正常。
- **证据**：orders.js:516-518 `curOrder=id;curOrderView=null;render();` —— 无 updateHash 调用；router.js 面包屑 `escHtml((curOrder&&curOrder.id)||'')`。
- **最小修复**：goOrderEdit 补 `if(typeof updateHash==='function')updateHash();` 并将 `curOrder=o`（对象）与 hash 恢复语义对齐（或面包屑改用 `_fOrderId`）。

### P2-5｜「新建订单」模式无法经 hash/localStorage 恢复，刷新静默丢表单
- **文件:行**：src/core/router.js updateHash（`oid:curOrderView||_fOrderId||null`，新建时 _fOrderId=null → hash 无 oid、无 /edit）；restoreFromHash 两个分支均 `if(...&&saved.oid)` 才恢复
- **触发场景**：新建订单填写到一半 → 刷新/误关 → 直接回到订单列表；草稿虽已存 localStorage，但只有再次点「新建订单」才会弹出恢复确认，用户无从得知。
- **证据**：newOrder（orders.js:477-479）`_fOrderId=null; curOrder='__new__'`，updateHash 拼出 `#/orders`（无编辑标记）。
- **最小修复**：updateHash/restore 对 `edit&&!oid` 的情况写入并恢复 `{view:'orders',edit:true}` 标记，恢复时若 curOrder 缺失则引导「继续未完成的订单草稿」。

### P2-6｜`#/wiki` 不在恢复白名单：刷新后回落 dashboard，且面包屑为空
- **文件:行**：src/core/router.js restoreFromHash `validView=NAV.some(...)`（NAV 无 wiki 项）；render() 面包屑 `crumb=(NAV.find(n=>n.k===view)||{}).label||''`
- **触发场景**：在专业解读页刷新 → 回到概览页；wiki 页面包屑空白。
- **证据**：NAV（router.js:73-92）仅 9 个主键+4 子键；`go('wiki')` 与 render 的 `case 'wiki'` 均存在，唯独恢复校验没放行。
- **最小修复**：restoreFromHash 的 validView 判定追加 `|| targetView==='wiki'`，面包屑加 wiki 兜底文案「专业解读」。

### P2-7｜restoreFromHash 对无 oid 的 `#/orders` 不清理三订单模式残留
- **文件:行**：src/core/router.js restoreFromHash（`view=targetView;` 后仅 `if(targetView==='orders'&&orderId){...}` 恢复，无 else 清理）
- **触发场景**：处于订单详情（curOrderView 已设）→ 手动把地址栏 hash 改回 `#/orders`（或外链带入）→ render 仍按 curOrderView 渲染详情，hash 与实际视图不符。
- **证据**：恢复代码只在「有 orderId 且订单存在」时设置/清理模式变量，缺省路径不动 curOrder/curOrderView。
- **最小修复**：`targetView==='orders'&&!orderId` 时清 `curOrder=null;curOrderView=null;_fMode='';_fOrderId=null;_fItems=[];`。

### P2-8｜saveDB 的 `p.finally()` 产生未处理的 Promise 拒绝
- **文件:行**：src/core/store.js:869
- **触发场景**：IndexedDB 写失败（配额满/隐私模式）时，除一次性 toast 外，每次写失败都在控制台产生 Uncaught (in promise) 噪音，掩盖真实错误定位。
- **证据**：`const p=idbSave();p.finally(()=>_checkIdbErrorToast());` —— finally 返回的新 promise 无人 catch；多数调用方也不接收 saveDB 返回值。
- **最小修复**：改为 `p.catch(()=>{}).finally(()=>_checkIdbErrorToast())`（或 `p.then(...,err=>_checkIdbErrorToast())`）。

### P2-9｜confirmModal 的 onCancel 在「焦点不在弹窗内按 Esc」时被跳过
- **文件:行**：src/core/ui.js confirmModal（Esc 内建处理仅挂在 `_mask` 元素上）；src/views/keyboard.js Esc 分支（直接 closeModal）
- **触发场景**：confirmModal 打开后焦点因点击遮罩/程序渲染落到 body → 按 Esc → 走 keyboard.js 直接 closeModal，取消语义（如 checkDraftRestore 的「放弃草稿」清理、onCancel 回调）不执行，留下与 UI 状态不一致的残留。
- **证据**：confirmModal 的 keydown 监听在 mask 元素上（焦点在内才触发）；document 级 Esc 分支只判 `document.getElementById('_mask')` 存在即 closeModal，无 onCancel 调用。
- **最小修复**：keyboard.js Esc 的 _mask 分支改为模拟点击 `_modalCancel`（`const c=document.getElementById('_modalCancel');c?c.click():closeModal();`），与 confirmModal 内建 Esc 行为一致。

### P2-10｜main.js 静态 import 失败时无任何兜底 UI（白屏早于 App.vue 错误界面）
- **文件:行**：src/main.js（顶层 `import MarkdownIt/DOMPurify/hljs/pdfjs-dist/mammoth`）；src/index.html（body 仅空 `#app`，无 noscript/兜底文案）
- **触发场景**：dist 产物不完整（assets/js 缺文件）、或极旧浏览器不支持 ES module 时，模块图加载失败，App.vue 的启动错误界面永远不会挂载，用户看到纯白页。
- **证据**：index.html `<div id="app"></div>` 无初始内容；main.js 顶层静态 import 任一失败即整图失败。
- **最小修复**：index.html 的 `#app` 内放静态加载文案（「正在加载…若长时间无响应请刷新」），加载成功后会被 boot 覆盖。

### P2-11｜Coach 子路由不触发父模块引导；重触发引导无 UI 入口
- **文件:行**：src/core/router.js `__maybeShowModuleGuide(view)` 只接受 CFG 键；CFG 无 settle-receipt/settle-payment/inv-issue/inv-receive；`window.Coach.reset/resetAll` 仅控制台可用
- **触发场景**：首次进入应用直接落在「收款记录」（如从仪表盘待办直达）→ 不触发结算模块引导；想重新看引导只能开控制台调 `Coach.resetAll()`。
- **证据**：`__maybeShowModuleGuide` 首行 `if(!view||!CFG[view])return;`，子路由键直接返回；_GUIDE_PARENT 映射只用于 reset 清键，未用于 show 归并。
- **最小修复**：`__maybeShowModuleGuide` 里用 `_GUIDE_PARENT[view]||view` 归并后再查 CFG；后续可在「设置」弹窗加「重看功能引导」按钮调用 Coach.resetAll。

### P2-12｜⌘S 帮助文案写「保存当前抽屉/弹窗中的表单」，实现只支持抽屉
- **文件:行**：src/views/keyboard.js ⌘S 分支（`document.querySelector('.drawer-wrap')` 才调 drawerOk）；getShortcutsHTML 的 ⌘S 描述
- **触发场景**：在「价格库匹配」「手动录入供应商」等 modal 弹窗内按 ⌘S → 无任何动作（仅阻止浏览器默认保存），与快捷键说明不符。
- **证据**：keyboard.js `if(typeof drawerOk==='function'&&document.querySelector('.drawer-wrap')){drawerOk();}` —— 无 _mask 分支。
- **最小修复**：二选一——文案改为「保存当前抽屉中的表单」；或 ⌘S 在 `_mask` 存在时模拟点击 `_modalOk`。

---

## 五、审计覆盖说明

- **A 卡死类已查**：未发现 await 永不 resolve（idbOpen 5s 超时、showDirectoryPicker/文件读写均有 catch 分支与 toast）、loading 不清除（nowBackup/下载按钮均有 finally 恢复）、弹层关不掉（四类弹层关闭路径齐全，发现的是反向的「连带关闭」问题 P1-4/P2-1/P2-2）、渲染死循环（render 为全量重绘无自触发循环；Coach 的 rAF/scroll 重定位有 cancelAnimationFrame 配对）、同步大循环（列表渲染均有 PAGE_SIZE=20 分页）。
- **B 死链类已查**：go 目标/render 分支/分页回调/搜索框 id/键盘引用函数（openSearchPanel、closeSearchPanel、openAIAssistant、newOrder、newUnit、goOrderEdit、addItem、exportJSON、syncNow、onSettleUnitFilter、onInvUnitFilter 等）全部存在；发现 1 处纯死链（P1-2）与 1 处条件性失效（P1-1）。
- **C 无法操作类已查**：bindView 绑定目标均在对应视图渲染后存在（specs/prices/bom/settle/invoices/orders-edit 各分支 id 与视图模板一一对应）；dataset.bound 防重绑；modal 有焦点陷阱与 Tab 循环；combo 有防裁剪向上展开与输入法守卫；筛选/分页状态（unitSearch/_orderPage 等）在切换视图时由 go() 保留属设计预期。发现 P1-1/P1-3/P1-4。
- 范围外（未深查，仅记录）：exporter.js 的 loadXLSX 动态加载超时策略、wiki.js 的异步索引循环、dashboard.js 待办按钮目标、ai-chat.js 提案弹窗内部校验——属其他模块审计范围。
