# 档案链路静态审查 — units / specs / bom / dashboard

- 审查范围：src/views/units.js、src/views/specs.js、src/views/bom.js、src/views/dashboard.js，及其依赖的 core/router.js、core/ui.js、core/utils.js、core/store.js（只读核对，未改任何文件）。
- 基准：工作区当前文件（非 HEAD）。行号以工作区文件为准。
- 问题口径：仅 A 卡死 / B 死链 / C 无法操作 三类；不给重构建议，只给最小修复点。
- 结论：P0×1、P1×3、P2×5。B 类死链逐一核对未发现缺失定义；A 类（卡死）未发现。

---

## P0

### 1. dashboard 所有「处理/查看」入口 goOrder 状态错位：落到空白新建页或另一张订单的编辑页，面包屑还显示错误单号
- severity：P0（错序状态下保存会把 A 订单内容整单覆盖，属数据丢失路径；即使不保存，dashboard 主跳转也永远到不了目标订单）
- 文件:行：src/core/router.js:602-609（goOrder 定义）；src/views/dashboard.js:58、63、100（唯三调用点）；src/views/orders.js:704-705（viewOrderEdit 只读 `_fMode/_fOrderId/_fItems`）；src/views/orders.js:1277、1296（saveOrder 按 `_fMode==='edit'&&_fOrderId` 分流更新/新建）；src/core/router.js:232（面包屑读 `curOrder.id`）
- 用户触发场景：
  1. 全新进入：概览页「今天要处理」条目/「处理」按钮、「最近订单→查看」点击后，进入的是**空白新建订单页**（标题「新建订单」、采购商空、明细 0 项），点「保存订单」走新建分支可能生成垃圾订单。
  2. 先进过订单 A 的编辑（goOrderEdit 设置 `_fMode='edit'/_fOrderId=A/_fItems`，go()/返回列表均不重置）→ 回概览 → 点订单 B 的「处理」→ 页面渲染的是 **A 的编辑页**，而面包屑显示 B 的单号（curOrder 是 goOrder 里 B 的克隆对象），此时点「保存订单」会把表单内容写进 **A**（router.js:1277 `o.items=_fItems...` 整体覆盖）。
- 证据：
  - router.js:602 `function goOrder(id){const o=DB.orders.find(...);curOrder=o?JSON.parse(JSON.stringify(o)):null;curOrderView=null;view='orders';updateHash();render();}` —— 只设 curOrder 对象，不设 `_fMode/_fOrderId/_fItems`；render() 因 curOrder 真值路由到 viewOrderEdit()。
  - orders.js:705 `const o=_fMode==='edit'?DB.orders.find(function(x){return x.id===_fOrderId;}):null;` —— viewOrderEdit 完全不读 curOrder 对象内容。
  - router.js:232 `'<span>'+(curOrderView?'查看订单':'编辑订单')+' · '+escHtml((curOrder&&curOrder.id)||'')+'</span>'` —— 面包屑取 curOrder.id（B），表单取 _fOrderId（A），两者可不一致。
- 最小修复建议：goOrder 内找到订单后直接复用 `goOrderEdit(id)`（补齐 _fMode/_fOrderId/_fItems 再 render）；找不到时 `go('orders')` 兜底。或 dashboard 三处改调 `goOrderView`（查看）与 `goOrderEdit`（处理）。

---

## P1

### 2. BOM 六维筛选 combo 选中即失效：onSelect 整页 render() 重建筛选栏时 data-val 被硬编码清空
- severity：P1（功能无法操作：筛选值只「活一次」，多属性 AND 组合不可能实现，翻页/搜索/删除后筛选静默清空）
- 文件:行：src/views/bom.js:55（filterRow `data-val=""` 硬编码）；src/core/router.js:684（bindView bom 分支 onSelect `opt=>{el.dataset.val=opt.id||'';render();}`）；src/core/utils.js:864（getComboVal 从 dataset.val 读）；src/views/prices.js:166（对照：报价页用 `filterPrices=debounce(_priceFilterNow,150)` 局部刷新，不重建筛选栏）
- 用户触发场景：BOM 管理页在「类型」筛选下拉选一个值 → 列表确实按该值过滤了一次（filterBOMData 在 innerHTML 替换前读旧 DOM），但筛选框立即变回空占位符；再选第二个属性时第一个已被清成 `data-val=""`（AND 组合失效）；点翻页/搜索/删除任一触发 refreshBOMTable 的操作后筛选彻底消失、回到全量。`hasBOMFilter()` 同样读回空值，「已筛选 N 条」徽章与「清除筛选」按钮状态错乱。
- 证据：
  - bom.js:55 `SPEC_FIELDS.map(k=>'<div id="bf_'+k+'" class="combo filt-combo" data-placeholder="'+SPEC_LABELS[k]+'" data-val=""></div>')`
  - router.js:684 `combo(el,(DB.specs[k]||[]).map(v=>({id:v,label:v})),opt=>{el.dataset.val=opt.id||'';render();},SPEC_LABELS[k],true);`
  - utils.js combo() 初始化：`if(el.dataset.val){...}` —— 重建后 data-val 为空，输入框不回填。
- 最小修复建议：router.js:684 的 `render()` 改为 `refreshBOMTable()`（该函数已同步刷新计数/徽章/清除按钮且不重建筛选栏）；或 viewBOM 用模块级变量回填 `data-val`。

### 3. 单位联系人删除中间行后保存：电话/供应采购侧交叉错乱（readContacts 按位置取 name、按 data-i 取其余字段）
- severity：P1（保存后联系人数据静默错乱；不报错、不卡死）
- 文件:行：src/views/units.js:430-441（readContacts）；src/views/units.js:405-410（delCRow 只 remove 不重排 data-i）；src/views/units.js:395-399（addCRow 用 name 输入框数量当新 data-i）
- 用户触发场景：编辑有 ≥2 个联系人的单位 → 删除**第一行**（非最后一行）→ 保存。剩余行的 name 按 NodeList 位置 i 取值，而 sides/phone/wechat 按 `data-i="i"` 属性匹配：结果第 1 个联系人 phone 为空、sides 为空（side 兜底成「供应商」）；第 2 个联系人配上的却是被删行的电话和侧向。若随后再「添加联系人」，新行 data-i 与现存行重复，错位进一步叠加。
- 证据：
  - units.js:431 `[...document.querySelectorAll('#contactsBox [data-c="name"]')].map((el,i)=>{ const sides=[...document.querySelectorAll('#contactsBox [data-c="side"][data-i="'+i+'"]:checked')]...`
  - units.js:406-408 `const row=btn.closest('[data-crow]'); if(!row)return; row.remove();` —— 无重排。
  - units.js:396 `const i=box.querySelectorAll('[data-c="name"]').length;` —— 删行后与残留 data-i 冲突。
- 最小修复建议：readContacts 改为按行容器收集：`[...box.querySelectorAll('[data-crow]')].map(row=>({name:row.querySelector('[data-c="name"]').value, ...row 内查 side/phone/wechat}))`；或 delCRow/addCRow 后统一重排 data-i。

### 4. BOM 批量导入解析用 `.filter(c=>c.trim())` 压缩列位：中间空单元格导致后续字段整体左移错位
- severity：P1（导入静默写错属性值；预览表可见但不标错）
- 文件:行：src/views/bom.js:531（filter 压缩空列）；bom.js:534-540（按 valid[] 位置赋 sku/surface/spec/extra）；对照正确实现 src/views/units.js:263-265（parseUnitBatchRows 保留空列、仅去尾空）
- 用户触发场景：从 Excel 复制的 BOM 行存在中间空列（如「表面处理」空、「规格」有值）→ 粘贴解析 → valid 数组先过滤掉空串再按位置赋值：表面处理吃到规格值、规格吃到标准值……批量提交后这些 BOM 属性静默存错。
- 证据：
  - bom.js:531 `let valid=cols.slice(startIdx).filter(function(c){return c.trim();});`
  - bom.js:534 `if(valid.length>=2){row.surface=valid[1].trim();}` —— 位置语义在过滤后失真。
  - units.js:265 `const valid=cols.slice(firstIsNum?1:0).map(function(c){return (c||'').trim();});` —— 同项目正确姿势。
- 最小修复建议：去掉 `filter`，改为 `cols.slice(startIdx).map(c=>(c||'').trim())` 保留空位（仅行首序号判断与整行全空跳过逻辑保持不变），与 units.js 导入对齐。

---

## P2

### 5. 删除单位的影响提示只覆盖订单+报价，不含结算/发票引用（不拦截、不卡死，仅提示不全）
- severity：P2（健壮性/提示完整性）
- 文件:行：src/views/units.js:365-378（delUnit 只查 `DB.orders`+`DB.prices`）；units.js:302-330（batchDeleteUnits 同）；src/core/store.js:947-964（softDelete 仅移除+入回收站，不清理任何引用）；对照容错：src/views/settlements.js:121/165（按 unitId 过滤，pName 兜底显示 ID）、src/views/invoices.js:66（`(DB.units.find(...)||{}).name||s.unitId`）
- 用户触发场景：单位已被结算记录/发票引用（但无订单无报价）→ 删除时确认框显示「未被引用」语义的弱提示 → 删除后结算/发票页该行名称退化为裸 ID。
- 证据：units.js:366 `const used=DB.orders.some(o=>o.buyerId===id||o.items.some(i=>(i.options||[]).some(opt=>opt.supplierId===id))); const usedPrice=DB.prices.some(pr=>pr.unitId===id);` —— 无 DB.settlements/DB.invoices 检查。
- 最小修复建议：delUnit/batchDeleteUnits 的引用聚合补 `DB.settlements.some(s=>s.unitId===id)` 与 `DB.invoices.some(v=>v.unitId===id)` 计数，并入提示文案（删除本身可保留现状，回收站可恢复）。

### 6. units.roles 缺失时 dashboard/列表/筛选多处裸调 `.includes` 直接抛错，整页白屏
- severity：P2（仅脏数据/导入数据缺 roles 字段时触发，但触发即整页崩）
- 文件:行：src/views/dashboard.js:86（`const r=DB.units[j].roles; if(r.includes('供应商'))` 无保护）；对照同文件防护范式 src/views/units.js:15（unitCounts `const r=u.roles; if(r&&r.includes(...))`）；同类裸调：src/core/utils.js:607（roleBadge `roles.map`）、src/core/router.js bindView prices/settle 分支（`u.roles.includes(role)`）
- 用户触发场景：导入的 JSON 备份或历史数据中某单位缺 roles 字段 → 打开概览（viewDashboard 渲染抛 TypeError）→ 整页无法渲染；单位列表行、报价筛选、结算筛选同样受累。
- 证据：dashboard.js:85-88 `for(let j=0;j<DB.units.length;j++){const r=DB.units[j].roles; if(r.includes('供应商'))suppliers++; if(r.includes('采购商'))buyers++;}`
- 最小修复建议：dashboard.js:86 改 `const r=DB.units[j].roles||[];`（utils.js:607、router.js 相关行同改为 `(u.roles||[])`）。

### 7. specs 每组「引用统计（实时）」面板永久隐藏：sgu_ 渲染后无任何显示入口
- severity：P2（死元素；不影响操作）
- 文件:行：src/views/specs.js:110（`'<div class="sg-usage" id="sgu_'+k+'" style="display:none">'`）；全仓 grep `sgu_` 仅此一处渲染，无 toggle/显示代码
- 用户触发场景：无——用户永远看不到该面板，白白多算一遍 countSpecUsage。
- 证据：specs.js:110 渲染 `style="display:none"`，src/ 下无其他 `sgu_` 引用。
- 最小修复建议：二选一：删除该隐藏块渲染（顺带省一遍统计计算）；或加一个「查看引用明细」按钮切换 display（与 sgh_ 的 toggle 同模式）。

### 8. specs 页渲染性能：renderSpecGroup 对每个枚举值重复跑 3 遍 countSpecUsage，O(值数×订单×明细×options) 同步阻塞
- severity：P2（数据量大时 specs 页明显卡顿，属 A 类「同步大循环」的边缘形态，未达卡死）
- 文件:行：src/views/specs.js:52-55（totalUsed reduce 逐值统计）；specs.js:77-78（值标签 map 内再算 usage）；specs.js:113-121（隐藏的 sgu_ 区第三次逐值统计）
- 用户触发场景：枚举值数百、订单数千时打开属性管理页，6 个维度 × 每值 3 次全库扫描，主线程一次性同步计算，页面长时间无响应感。
- 证据：specs.js:54 `const totalUsed=vals.reduce(function(s,v){return s+countSpecUsage(k,v).total;},0);` 与 77 行、113 行三处重复。
- 最小修复建议：单次遍历建 `Map<value,usage>` 后三处复用；sgu_ 若按第 7 条删除则天然省掉 1/3。

### 9. editUnit 也把编辑中的既有单位写入 unit 草稿：放弃编辑后，下次「新建单位」会提示恢复另一单位的数据
- severity：P2（有确认弹窗兜底，不丢数据，但语义混淆）
- 文件:行：src/views/units.js:338-360（editUnit 的 setTimeout 内 `bindDraftSave(panel,collectUnitDraft,DRAFT_TYPES.unit)`）；src/core/utils.js:304-318（checkDraftRestore 恢复确认）
- 用户触发场景：编辑单位 A 改了名字 → 点取消放弃（草稿已落 localStorage）→ 之后点「新建关联单位」→ 弹「检测到未提交的草稿，是否恢复」→ 恢复后表单里是 A 的数据，用户可能据此建出重复单位。
- 证据：units.js:357-359（editUnit 内）`setTimeout(()=>{const panel=document.querySelector('.drawer-panel'); if(panel)bindDraftSave(panel,collectUnitDraft,DRAFT_TYPES.unit);},100);`
- 最小修复建议：editUnit 不绑 bindDraftSave（草稿仅服务新建），或 collectUnitDraft 带上编辑 id、checkDraftRestore 对「编辑中」场景跳过提示。

---

## 已查未发现问题的项（按任务重点逐项交代）

### A 卡死 — 未发现
- 四个视图无 await 动态加载、无 loading 状态残留；保存类操作均为防重锁+同步流程（units.js `_unitSaving`、bom.js `_bomFormSaving/_bomBatchSaving`）。
- 弹层关闭路径完整：modal/confirmModal 有 Esc（焦点在弹层内时）、右上 ×、取消按钮（core/ui.js:78、152）；抽屉有 Esc/遮罩点击/取消/×（core/ui.js:226-261），dirty 关闭有二次确认且 `document.getElementById('_mask')` 防重入（core/ui.js:172-174）。z-index 链 `--z-modal:1050 > --z-drawer:1000`（variables.css:31、components.css:349/360），抽屉上叠确认框不会被盖住。
- combo 下拉：Esc 关闭、blur 150ms 延迟关闭、fitDrop 空间不足上翻（core/utils.js:806-822），未发现开得出轨关不掉。
- 未见渲染重入/死循环；bindDraftSave 为 300ms 防抖写 localStorage，无回路。

### B 死链 — 未发现缺失定义；1 处语义死链即 P0 第 1 条
- 四文件全部 inline onclick/回调名逐一核对均存在：onUnitSearch(unitPage)→router.js:481/491；goOrder→router.js:602；newOrder→orders.js:477；newPrice→prices.js:187；openBOMForm/newUnit/newOrder/dashboard 快速开始四按钮均全局定义；buildPaging 回调名 'unitPage'/'bomPage' 均有实现。
- go() 目标：'orders'/'units'/'specs'/'bom'/'dashboard' 在 router.js render() switch（case 均存在）。
- dashboard 空数据可操作：无订单时显示「快速开始」四按钮 + 最近订单空态含「新建采购订单」，today-box 空态为正向提示，无不可达入口。
- 规格六维枚举：新增（bindView specs 分支 combo onSelect push+saveDB+render，router.js:655-669）与删除（delSpecVal，specs.js:157-176）均有效；删除被订单/报价/BOM 引用的值有影响范围二次确认，引用记录保留原字符串值仅不再参与匹配，softDeleteSpecOption 入回收站可恢复（store.js:966-982）——行为符合预期，无卡点。
- 单位 CRUD：新建/编辑防重锁+必填校验有 toast；updateContactSides 双向联动逻辑正确（仅开采购商→「供应」侧禁用清空；反之亦然；全关→两侧恢复可用），禁用后切换角色即恢复，无「禁用后无恢复路径」问题。删除单位不会被静默拦截（提示不全见 P2 第 5 条）。

### C 无法操作 — 除 P1 第 2、3 条与 P2 第 6 条外未发现
- combo 绑定 id ↔ 渲染元素对照全查：specs `specadd_*`(6)、bom `bf_*`(6)（router.js bindView）与 BOM 表单 `bom_type/standard/diameter/hardness/surface/material`（_openBOMDrawer setTimeout 绑定，bom.js:346-359）均有对应渲染元素且 dataset.bund 防重绑；units/dashboard 页无 combo。越界核对：pf_*、settleUnitFilter、invUnitFilter、tf_buyer 同样成对存在。
- BOM 表单保存校验：必填三项 + SKU 唯一性（编辑排除自身）错误进 `#bomFormErr` 横幅（有关闭钮）+ field-err 高亮 + 焦点跳转（bom.js:471-492），无「拦截但无提示」。
- BOM 分页：bomPage 定义于本文件，`_bomPage>totalPages` 收敛、搜索/筛选重置回第 1 页，无残留错页。
- 表单禁用恢复：updateContactSides、BOM field-err 清除（oninput 防抖重校验）均有效。
