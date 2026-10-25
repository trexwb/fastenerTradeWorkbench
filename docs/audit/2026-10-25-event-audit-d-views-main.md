# 事件绑定审计 · D组「主视图模块」（2026-10-25）

- **范围**：`src/views/dashboard.js`、`units.js`、`specs.js`、`bom.js`、`prices.js`、`keyboard.js`、`data.js`（只读审计，未改动任何 src 代码）
- **方法**：rg 枚举 7 个文件全部 `onclick/onchange/oninput/onkeydown/addEventListener` 绑定 → 跨全 `src/`（含 core/、router.js、store.js、ui.js、utils.js、kb.js、search-panel.js）核验处理函数存在性 → 逐个读实现核验防抖/防重/二次确认。
- **依据**：AGENTS.md §8（搜索回车触发、禁 oninput 实时搜索）、§12.5（高频事件必须防抖/节流）、「所有操作必须有响应」、写/异步提交按钮须有重复触发防护。可用公共件：`utils.js:11 debounce` / `:28 throttle`、`store.js:861 saveDBDebounced`。
- **证据等级**：本文件全部结论基于一手代码（当前仓库快照），行号为 2026-10-25 实测。

## 结论摘要

| 严重级 | 数量 | 说明 |
|---|---|---|
| P1（死交互 / oninput 实时搜索） | **0** | 7 文件所有绑定目标函数均真实存在，未发现空 onclick、无响应按钮；无 oninput 实时搜索违规 |
| P2（高频缺防抖 / 写按钮无防重） | **6** | bom.js 表单校验 oninput、specs.js 高亮 oninput、keyboard.js 无 e.repeat 守卫、exportJSON / syncNow / exportAllSpecs 无重复触发防护 |
| P3（建议性） | **4** | importBtn 死引用、_priceFilterDebounced 死代码、dashboard unitRoleFilter 死分支、keyboard.js 全局 event 引用 |

## 违规明细

| 严重级 | 文件:行 | 事件/元素 | 问题描述 | 最小修复建议 |
|---|---|---|---|---|
| P2 | bom.js:324,328,331 | `oninput="bomValidateField('sku'/'name'/'spec')"`（BOM 表单 3 个必填输入框） | 每次击键直调 `bomValidateField`（bom.js:369），无任何防抖/节流，违反 §12.5「高频事件必须防抖」。缓解因素：实现为单元素 `classList.toggle`（bom.js:375），单次成本 O(1)，实际影响低 | 复用 `utils.js debounce`：`const bomValidateFieldDebounced=debounce(bomValidateField,150);` 三处 oninput 改调防抖包装；或补注释说明豁免理由 |
| P2 | specs.js:87 | `oninput="highlightSpecVals('k',this.value)"`（属性过滤输入框） | 每次击键执行 `container.querySelectorAll('.spec-val-tag').forEach` 逐个写 `style.outline/opacity`（specs.js:168-178），O(n) DOM 写且无防抖。**specs.js:83 注释声称「oninput 仅做防抖高亮」与实现不符**（全文件无 debounce 调用）——注释描述了不存在的防抖 | 同上加 `debounce(highlightSpecVals,120)` 包装；同时修正 specs.js:83 注释（或如实改为「非防抖轻量高亮」）。真实过滤仍由 Enter/🔍 触发（runSpecFilter），§8 语义合规 |
| P2 | keyboard.js:117 | `document.addEventListener('keydown',…)` 全局快捷键 | **全文件 0 处 `e.repeat` 检查**。按住不放触发系统自动重复：⌘S 连续调 `drawerOk()`（ui.js:169，保存回调虽有 500ms 防重锁仍反复弹「正在保存中」）；⌥⇧E 连续 `exportJSON()` 重复下载；⌥⇧S 连续 `syncNow()`；⌥⇧I 连续 `importFile.click()`；⌥⇧N 连续开表单；搜索框内按住 Enter 兜底分支连续全表重渲染 | 处理器入口加 `if(e.repeat)return;`（或仅对 ⌘S/⌥⇧* 动作类分支加；纯导航 ⌥+字母 幂等可放行） |
| P2 | data.js:96（按钮）→ data.js:431 | `onclick="exportJSON()"` 导出 JSON 备份 | 异步导出+下载无禁用/冷却/防抖：双击 → 两次 `a.click()` 重复下载同名文件 + 重复 toast；配合 keyboard ⌥⇧E 无 repeat 守卫可连续多次 | 事件入口加冷却（如 `let _exporting=false` + 完成后释放）或按钮临时 `.disabled` |
| P2 | data.js:255（按钮）→ store.js:631 | `onclick="syncNow()"` 立即同步（异步写本地文件） | 异步 `saveToFile()` 期间无禁用/进行中标志，双击重复写文件（内容相同、危害低，但按「写按钮须防重」标准不合规） | 加 `_syncing` 标志或复用 `.loading`（components.css:123 `pointer-events:none`）禁点 |
| P2 | specs.js:138（按钮）→ specs.js:334 | `onclick="exportAllSpecs()"` 导出全部属性 CSV | 与 exportJSON 同类：下载类写操作无重复触发防护，双击重复下载 CSV | 同 exportJSON 冷却/禁用方案 |
| P3 | data.js:456 | `importJSON` 内 `document.getElementById('importBtn')` | 全 src 无任何元素带 `id="importBtn"`（data.js:97 的导入按钮未设 id）→ `.loading` 防护为死代码，导入期间按钮无视觉禁用 | 给 data.js:97 按钮补 `id="importBtn"`，或删除 :456 死引用。实际导入风险低：file input onchange 触发 + `importParsedData`（store.js:1397）含二次确认 |
| P3 | prices.js:10 | `const _priceFilterDebounced=debounce(refreshPricesTable,150)` | 定义后全 src 无任何调用点（实际消费的是 prices.js:168 的 `filterPrices`，由 router.js:655,661 combo 回调调用）→ 死代码 | 删除该行，统一走 `filterPrices` |
| P3 | dashboard.js:114,118 | 统计卡 onclick 内 `document.getElementById('unitRoleFilter')` | 全 src 无该 id 元素（units.js 现用 ftab 按钮 + `setUnitRoleFilter`，units.js:165）：`if(f)` 守卫使其成为静默空转分支，「供应商/采购商」统计卡只导航不筛角色，与 title「查看供应商列表」承诺不符。非死交互（导航生效），故 P3 | go('units') 后改调已存在的全局函数：`setTimeout(()=>{ if(typeof setUnitRoleFilter==='function') setUnitRoleFilter('供应商'); },100)` |
| P3 | keyboard.js:296 | Enter 兜底搜索分支 `!event.isComposing` | 使用全局 `window.event` 而非处理器入参 `e`（同函数其余分支均用 `e`）：依赖已废弃的 window.event，当前浏览器可用但风格不一致且脆弱 | 改为 `!e.isComposing` |

## 逐文件核查结论（含已合规项）

### 1. dashboard.js（199 行）— P3×1
| 位置 | 绑定 | 结论 |
|---|---|---|
| :58, :63, :100 | onclick=goOrder（包 escJsStr 转义） | ✅ 已合规（goOrder 定义 router.js:597；stopPropagation 防冒泡） |
| :68, :135 | a[href=javascript:void(0)] onclick=gotoPendingOrders / go('orders') | ✅ 已合规（本文件 :7 定义 gotoPendingOrders） |
| :106-118 | 4 个 `.stat` role=button：onkeydown Enter/Space→click + onclick 导航 | ✅ 已合规（键盘可达 + 幂等导航；`event` 在行内 handler 作用域合法；重复触发无副作用）。其中 :114/:118 的 unitRoleFilter 派发为死分支 → P3 |
| :127-130, :142 | newOrder/newUnit/openBOMForm/newPrice | ✅ 已合规（orders.js:477 / units.js:297 / bom.js:286 / prices.js 均存在） |
| :177-178 | dismissCmdKTip(false/true) | ✅ 已合规（本文件 :176 定义；localStorage 去重防重复弹） |

### 2. units.js（709 行）— 0 违规
| 位置 | 绑定 | 结论 |
|---|---|---|
| :49 | checkbox onchange=updateUnitBatchBtn | ✅（:473） |
| :55 | editUnit / delUnit | ✅（:338 / :365；delUnit 引用检查+confirmModal 二次确认） |
| :74-83 | 角色/评级 ftab onclick=setUnitRoleFilter / setUnitRatingFilter | ✅（:165 / :174，重渲列表） |
| :96-98 | 🔍图标 onUnitSearch + 输入框 **onkeydown Enter** + 清除按钮 | ✅ §8 合规（onUnitSearch 定义 router.js:486；无 oninput 实时搜索） |
| :102 | batchDeleteUnits | ✅（:489，引用聚合提示 + confirmModal） |
| :104-108 | newUnit / 下拉 toggleUnitDropdown/closeUnitDropdown/openUnitBatchAdd | ✅（:297 / :693 / :706 / :597；document click once 外关） |
| :114 | toggleAllUnits | ✅（:463） |
| :121, :147 | 清除筛选 | ✅ |
| :240-241, :386-388 | role-opt 切换 / 联系人 side checkbox / delCRow | ✅（updateContactSides :414 / delCRow :405） |
| :251, :271 | toggleInvoiceSection / addCRow | ✅（:280 / :395） |
| :608, :643 | parseUnitBatch / removeUnitBatchRow | ✅（:616 / :658） |
| :652 | submitUnitBatch 批量提交 | ✅ 防重（`_unitBatchSaving` 500ms 锁，:532,667-669） |
| 抽屉保存（newUnit/editUnit 回调） | 单位表单保存 | ✅ 防重（`_unitSaving` 500ms 锁，:6,300-302,344-346） |

### 3. specs.js（356 行）— P2×2
| 位置 | 绑定 | 结论 |
|---|---|---|
| :71, :137 | openBatchImportSpec（单维度/全维度） | ✅（:259；抽屉保存回调先 toast 预览、写入经 confirmModal 门控） |
| :80 | toggleSpecGroup | ✅（:151） |
| :86 | 🔍图标 onclick=runSpecFilter | ✅ §8 合规（:185，真实过滤仅 Enter/图标触发） |
| :87 | 输入框 onkeydown Enter ✅ + **oninput=highlightSpecVals → P2** | 违规（无防抖 + :83 注释失实），见违规明细 |
| :89 | clearSpecFilter | ✅（:222） |
| :99 | sv-del onclick=delSpecVal（stopPropagation） | ✅（:235，引用影响统计 + confirmModal） |
| :138 | **exportAllSpecs → P2** | 违规（下载类无防重），见违规明细（:334） |

### 4. bom.js（728 行）— P2×1
| 位置 | 绑定 | 结论 |
|---|---|---|
| :30, :159 | checkbox onchange=updateBOMBatchBtn | ✅（:633） |
| :41-42, :170-171 | openBOMForm / confirmBOMDel | ✅（:286 / :251；删除走 confirmModal，:279-280） |
| :56, :60 | clearBOMFilter | ✅（:231） |
| :66-68 | 🔍图标 onBOMSearch + **onkeydown Enter** + 清除按钮 | ✅ §8 合规（onBOMSearch :221） |
| :73 | batchDeleteBOM | ✅（:649，引用聚合 + confirmModal :698） |
| :75-79, :84, :91-92, :183-184 | 新建/下拉/全选/清除 | ✅ |
| **:324, :328, :331** | **oninput=bomValidateField → P2** | 违规（无防抖；实现 :369-377 单元素 classList.toggle），见违规明细 |
| :334 | toggleBOMSpecsSection | ✅（:379，祖先切类修复折叠） |
| :423 | 错误横幅 fe-dismiss 行内 onclick | ✅（纯 DOM 隐藏） |
| :493, :565 | parseBOMBatch / removeBatchRow | ✅（:503 / :583；bindBatchPasteUX utils.js:643） |
| :574 | submitBOMBatch 批量提交 | ✅ 防重（`_bomBatchSaving` :8,595-597） |
| 抽屉保存 saveBOMForm | BOM 表单保存 | ✅ 防重（`_bomFormSaving` :6,399-401） |

### 5. prices.js（587 行）— P3×1；**debounce(150) 覆盖完整**
| 位置 | 绑定 | 结论 |
|---|---|---|
| :19 | checkbox onchange=updatePriceBatchBtn | ✅ |
| :27 | editPrice / delPrice | ✅（:224 / :233；delPrice confirmModal） |
| :40-41, :83 | 清除筛选/新增 | ✅ |
| :65-69 | 新增报价 + 下拉 | ✅（togglePriceDropdown :402 / closePriceDropdown :414） |
| :74 | 🔍图标 doPriceSearch + **onkeydown Enter** + 清除按钮 | ✅ §8 合规（doPriceSearch :137 用户主动触发即时刷新，不属高频） |
| :78 | batchDeletePrices | ✅（:295，订单引用提示 + confirmModal） |
| :85 | toggleAllPrices | ✅（:310） |
| combo 筛选（供应商+6属性） | router.js:655,661 回调调 `filterPrices()` | ✅ **debounce(150) 覆盖完整**：所有 combo 高频回调均经 prices.js:168 防抖入口；无旁路直调 refreshPricesTable 的高频路径 |
| :434, :543 | parsePriceBatch / removePriceBatchRow | ✅ |
| :555 | submitPriceBatch 批量提交 | ✅ 防重（`_priceBatchSaving` :8,~570-572） |
| 抽屉保存 savePriceDrawer | 报价表单保存 | ✅ 防重（`_priceFormSaving` :5,~307-309） |
| :10 | `_priceFilterDebounced` | ⚠ P3 死代码（无调用点），见违规明细 |

### 6. keyboard.js（315 行）— P2×1 + P3×1
| 位置 | 绑定 | 结论 |
|---|---|---|
| :68 | 关闭按钮 closeModal | ✅（ui.js） |
| :117 | 全局 keydown（Esc / ⌘K / ⌘S / ⌥+字母 / ⌥⇧+字母 / ⌥←→ / ? / slash / Enter 兜底） | 各分支目标函数均存在（openSearchPanel/closeSearchPanel search-panel.js:171,197；drawerOk ui.js:169；go router.js:196；newOrder/newUnit/goOrderEdit/addItem orders.js；exportJSON/syncNow data.js,store.js；openAIAssistant ai-chat.js:325；showShortcutsModal 本文件 :69）；输入框内透传、Enter 兜底带 isComposing 守卫、`?` 受 hasOverlay 防重入。**违规：全文件无 `e.repeat` 检查 → P2**；:296 用全局 `event.isComposing` → P3，见违规明细 |

### 7. data.js（787 行）— P2×2 + P3×1
| 位置 | 绑定 | 结论 |
|---|---|---|
| :69, :75 | swB/selDays onchange（_backupToggle/_backupIntervalChanged/_backupKeepChanged/_backupRemindToggled/_backupRemindIntervalChanged） | ✅（本文件 :144-172） |
| :82, :85 | _copyDirPath / chooseBackupDir | ✅（本文件 :175 / store.js:1223） |
| :96 | **exportJSON → P2** | 违规（data.js:431），见违规明细 |
| :97-98 | 导入按钮 click→importFile.click() + file onchange=importJSON | ⚠ P3（:456 importBtn 死引用）；导入本体合规：onchange 触发 + importParsedData（store.js:1397）结构校验+二次确认 |
| :102 | nowBackup 立即备份 | ✅ 防重：进入即 `.loading`，components.css:123 `.btn.loading{pointer-events:none}` 真禁点（store.js:1259-1277） |
| :111 | _backupKeepChanged | ✅ |
| :206, :209 | restoreBackup / deleteBackup | ✅（store.js:1371 走 importParsedData 二次确认；store.js:1356 confirmModal） |
| :255 | **syncNow → P2** | 违规（store.js:631 无进行中禁用），见违规明细 |
| :256, :266 | unbindFile（危险·解绑） | ✅（store.js:380 confirmModal） |
| :265, :274 | reconnectFile / bindFile | ✅（store.js:456 / :236；showOpenFilePicker 用户手势顺序触发） |
| :330, :344-346 | _kbChoose/_kbRescan/_kbChooseFiles/_kbUnbind | ✅（indexing 时 disabled；kb.js:730 `if(state.indexing)return` 模块级重入守卫；_kbUnbind 幂等可重绑，无确认可接受） |
| :349-354 | _kbToggle/_kbTopN/_kbCite | ✅（本文件 :381-383） |
| :406 | clearAllData 清空全部数据 | ✅ 双重 confirmModal（:557-566：先问已否备份，再确认不可恢复） |
| :418-420 | _switchDataTab | ✅（:428） |
| :530-547 | document dragenter/dragover/dragleave/drop | ✅ `_dragDepth` 计数守卫、dragover 按需 preventDefault、drop 仅 .json 且走 importParsedData 二次确认（importFileByDrop :482） |
| :646-651 | _setAiOpsFilter / _aiOpsSelftest | ✅（:610 / :620；selftest 仅读+modal） |
| :712 | 重置筛选链接 | ✅ |
| :725 | undoAiOp 回滚 | ✅（store.js:1062；undone 标记幂等，已回滚不渲染按钮） |
| :728 | undoBatchConfirm 整批回滚 | ✅（本文件 :743 confirmModal + try/catch） |
| :760 | clearTrashConfirm 全部清空 | ✅（:781 confirmModal） |
| :770-771 | restoreTrashItem / purgeTrashItem | ✅（恢复幂等带 try/catch :773；彻底删除 confirmModal :778） |

## 专项核验结论（对应任务四重点）

1. **bom.js 三处 oninput=bomValidateField**：**未防抖**（bom.js:369 直实现）。成本低（O(1) classList.toggle），按 §12.5 标准仍记 P2。
2. **specs.js oninput=highlightSpecVals**：**未防抖**（specs.js:168 直实现），且 specs.js:83 注释「oninput 仅做防抖高亮」与实现不符；真实过滤语义合规（Enter/图标经 runSpecFilter :185）。
3. **prices.js debounce(150) 覆盖**：**完整**。combo 高频回调全部经 filterPrices（prices.js:168，消费方 router.js:655,661）；搜索/清除/翻页为用户主动单击/回车，无需防抖；:10 `_priceFilterDebounced` 为无消费死代码（P3）。
4. **keyboard.js event.repeat**：**完全未处理**（全文件 0 处 repeat 检查）→ P2；⌘S/⌥⇧E/⌥⇧S/⌥⇧I/⌥⇧N/Enter 兜底在按键自动重复下连续触发。
5. **data.js 导入/导出/清空类**：清空/删除/回滚/解绑全部有 confirmModal 二次确认 ✅；nowBackup 有 .loading 真禁点 ✅；exportJSON（P2）、syncNow（P2）无防重；importJSON 的 loading 态为死引用（P3）。

## 修复建议汇总（复用既有公共件，不新造轮子）

- 防抖：三处 oninput 包装统一用 `utils.js debounce(fn,120~150)`；
- 键盘：keyboard.js:117 处理器入口 `if(e.repeat)return;`（或仅动作类分支）；
- 导出/同步冷却：模块级 `_busy` 标志或按钮 `.disabled`/`.loading`（复用 components.css:123）；
- 死代码清理：删 prices.js:10；补 data.js:97 `id="importBtn"` 或删 :456；
- dashboard 筛选：改调全局 `setUnitRoleFilter`（units.js:165）替代 DOM 派发；
- 注释纠偏：specs.js:83 去掉「防抖」表述或补真实防抖。
