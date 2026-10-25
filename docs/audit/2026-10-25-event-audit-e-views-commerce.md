# 审计 E 组：结算 / 发票 / AI 助手模块 事件绑定与触发防护审计

- 审计日期：2026-10-25（只读审计，未改动任何 src/ 代码，未运行构建 / git）
- 审计对象：`src/views/settlements.js`（892 行）、`src/views/invoices.js`（544 行）、`src/views/ai-chat.js`（1222 行）
- 审计依据：项目 AGENTS.md §8 交互约定（搜索回车触发、禁止 oninput 实时搜索）、§12.5 性能规范（高频事件防抖/节流）、「所有操作按钮必须有响应」、写操作按钮防重复触发要求
- 可复用公共工具：`src/core/utils.js:11 debounce(fn,delay)`（带 .cancel）、`src/core/utils.js:28 throttle(fn,delay)`、`src/core/store.js:861 saveDBDebounced(ms)`（单例 timer 合并写）
- 判定准则说明：高频事件处理器若为 **O(1) 幂等轻量操作**（置布尔标记、单文本节点赋值、幂等 class 切换），不加防抖/节流不构成性能问题，判「合规（无需防抖）」并写明理由；若处理器含同步 I/O、重渲染、非幂等写，才按 P2/P3 计。

## 严重级定义

| 级别 | 含义 |
|------|------|
| P1 | 死交互（元素有绑定但永远无有效行为）或 oninput 实时搜索违规 |
| P2 | 高频事件缺防抖/节流造成实际性能/正确性问题；写按钮无重复触发防护 |
| P3 | 建议性改进（当前无害或影响轻微） |

---

## 一、违规明细表

| 严重级 | 文件:行 | 事件/元素 | 问题描述 | 最小修复建议 |
|--------|---------|-----------|----------|--------------|
| P1 | invoices.js:343 | 空态区 `onclick="openInvEdit('')"`「新增发票」按钮 | openInvEdit 全 src 仅一处定义（invoices.js:427），入口守卫 `DB.invoices.find(x=>x.id===invId)` 对空串必不命中（id 均由 `uid('INV')` 生成，seed.js 无发票数据）→ 点击必然 toast「发票记录不存在」后 return，永远打不开发票表单，按钮承诺的「新增」功能不存在 = 死交互。注：ai-tools.js:1674 的 open_invoice_drawer 工具传空 invoiceId 同样落入该守卫 | 短期：把按钮改为提示引导（如 toast「发票记录由结算记录自动生成，请在结算模块操作」）或直接移除该按钮；若确需手动建票，须在 openInvEdit 内为空 invId 增加新建分支 |
| P3 | settlements.js:770 | `ol.addEventListener('change',…)`（refreshSettleOrderList 内） | #st_orderList 元素在抽屉生命周期内不重建（仅 innerHTML 替换），每次调用 refreshSettleOrderList（每次选单位、切类型都会调用）都叠加一个新 change 监听器；叠加 openNewSettlement 在 L650 已绑的一个，首次勾选复选框即触发 autoSumSettleAmount 两次（连续两个「已自动填入结算金额」toast），换单位 N 次后触发 N+1 次。写入幂等（重算同一总和），无 DB 写，故仅体验问题 | 绑定前先解绑：将监听器提为具名函数，绑定前 `ol.removeEventListener('change', fn)`；或在 openNewSettlement 只绑一次（L650 已覆盖，直接删除 L770 的重复绑定即可） |
| P3 | ai-chat.js:345-347 | `draftInput.addEventListener('input',…)` 草稿持久化 | 每个按键同步 `localStorage.setItem(AI_DRAFT_KEY,…)`，属高频输入事件未防抖（§12.5）。典型草稿体积（<数 KB）开销可忽略，不构成实际性能问题，故降为 P3 | 复用 `debounce(function(){try{localStorage.setItem(AI_DRAFT_KEY,this.value)}catch(e){}},300)`（utils.js:11）；注意抽屉关闭前需 flush 一次或保留即时写 |
| P3 | ai-chat.js:1158-1170 | modal「保存设置」主按钮（async onOk） | modal() 对返回 Promise 的 onOk 是「resolve 后才 closeModal」（ui.js modal 实现），await `AI.setDeepseekToken` 期间弹窗与按钮仍可点击 → 双击可重入：setDeepseekToken 双写、toast 重复。且回调内 `AI.setProvider` 被连续调用两次（L1160 与 L1164，冗余）。全部操作幂等、终态一致，无数据损坏，故 P3 | 回调入口先 `closeModal()` 再读值保存（读值在关窗前完成即可），或加模块级 `_aiSetSaving` 500ms 锁；删除 L1160 的首次 setProvider 调用保留 L1164 |
| P3 | ai-chat.js:1080-1086 | kbBindDir 按钮（「选择目录并索引」） | async 无防重锁；kbRescan/kbPickFiles 在 indexing 时按钮 disabled（kbrenderZone 内已处理），唯独 kbBindDir 按钮无 disabled 态，连点可重入多次目录选择/索引流程 | 与 kbRescan 对齐：kbrenderZone 渲染 kbBindDir 按钮时加 `(s.indexing?' disabled':'')`，或在函数入口检查 KB 索引中状态直接 return |

**计数：P1 = 1，P2 = 0，P3 = 4。**

---

## 二、逐文件事件绑定核查结论（含已合规项，无省略）

### 2.1 settlements.js（内联处理器 16 处 + addEventListener 5 个调用/4 行）

**写按钮防重复触发：合规**
- 新建结算提交 `submitSettlement`（:800）：入口防重锁 `_settlementSaving`（:10）+ 500ms 释放（:11、:804），重复点击 500ms 内被 toast 拦截；实际写库前还有 `confirmModal` 二次确认（confirmModal 的 onOk 为同步回调，ui.js 在回调执行完后才 closeModal，双击窗口被同步执行天然阻断）。双重防护，合规。
- 删除 `delSettlement`（:513）：confirmModal 门控，回调同步执行（softDelete+render+toast），合规。

**内联处理器（全部存在，全部有有效行为）**
| 行 | 事件/元素 | 处理函数 | 结论 |
|----|-----------|----------|------|
| :250 | 行内「明细」btn onclick | openSettleDetail(:421) | 合规 |
| :251 | 行内「新增结算」btn onclick | openNewSettlement(:551) | 合规 |
| :261 | 搜索图标 a[javascript:void(0)] onclick | onSettleSearch(:360) | 合规（有 onclick，非死链） |
| :262 | 搜索框 onkeydown | Enter+`!event.isComposing`→onSettleSearch | 合规（§8 回车触发；无 oninput 实时搜索） |
| :263 | clear-btn span onclick | onSettleSearch('') | 合规 |
| :266 | 工具栏「新增结算记录」onclick | openNewSettlement | 合规 |
| :271/:272 | 统计卡 onclick + role=button + onkeydown | drillSettleTab(:316)，Enter/Space→click | 合规（含键盘可达性） |
| :276/:277 | settle-tab onclick | switchSettleSubTab(:326) | 合规 |
| :294 | 「清除筛选」onclick | onSettleSearch('')+onSettleUnitFilter('')，均存在 | 合规 |
| :295 | 空态「新建结算」onclick | openNewSettlement | 合规（与 :343 的 invoices 死按钮不同，本按钮参数有效） |
| :486/:492/:498 | 抽屉折叠区头 div onclick | toggleDrawerSection(:877) | 合规（cursor:pointer，展开/收起有效） |
| :602 | st_type select onchange | onSettleTypeChange(:692) | 合规 |

**addEventListener（5 个调用）**
| 行 | 事件 | 处理 | 结论 |
|----|------|------|------|
| :633 | drawer-bd input | markDrawerDirty（ui.js:106，仅 `_drawerDirty=true`） | 合规（O(1) 幂等标记；防抖反而会留下「关窗不确认」的脏窗口，无需防抖） |
| :633 | drawer-bd change | 同上 | 合规（change 非高频） |
| :650 | #st_orderList change | autoSumSettleAmount（勾选委托） | 合规（change 非高频） |
| :770 | #st_orderList change | 同上 | **P3 监听器叠加**（见违规表） |
| :789 | st_amount transitionend（{once:true}） | 移除高亮 class | 合规（一次性自清理，不累积） |

**其他**：本文件无 oninput 处理器；无 onscroll/onresize/onwheel。

### 2.2 invoices.js（内联处理器 8 处 + addEventListener 2 个调用/1 行）

**写按钮防重复触发：合规**
- 保存回调（openDrawer onOk，:513-537）：防重锁 `_invEditSaving`（:12）+ 500ms 释放（:17、:516），校验失败提前 return 时锁随 500ms 自动释放；saveDB+closeDrawer 同步收口。合规。
- 本文件无删除按钮（删除走结算模块级联 delSettlement）。

**内联处理器**
| 行 | 事件/元素 | 处理函数 | 结论 |
|----|-----------|----------|------|
| :294 | 行内「编辑」btn onclick | openInvEdit(:427)（escJsStr 转义 id） | 合规 |
| :319 | 搜索图标 a onclick | onInvSearch(:455) | 合规 |
| :320 | 搜索框 onkeydown | Enter+`!event.isComposing`→onInvSearch | 合规（§8；无 oninput 实时搜索） |
| :321 | clear-btn onclick | onInvSearch('') | 合规 |
| :332/:333 | settle-tab onclick | switchInvSubTab(:440) | 合规 |
| :342 | 「清除筛选」onclick | onInvSearch('')+onInvUnitFilter('')，均存在 | 合规 |
| :343 | 空态「新增发票」onclick | openInvEdit('') | **P1 死交互**（见违规表） |

**addEventListener（2 个调用）**
| 行 | 事件 | 处理 | 结论 |
|----|------|------|------|
| :542 | drawer-bd input | markDrawerDirty | 合规（同 settlements :633 理由） |
| :542 | drawer-bd change | markDrawerDirty | 合规 |

**其他**：`syncInvoices()` 在视图渲染时被调用（含条件 saveDB），非事件处理器，不计入。

### 2.3 ai-chat.js（内联/属性处理器 30+ 处 + addEventListener 5 处）

**发送按钮防连点：合规（四层防护）**
1. `requestAISend`（:471）入口检查 `AI.state.chatting` → toast 拦截（后台回复中含弹窗重开场景）；
2. `_aiSendGateAt` 300ms 门槛（:3、:476-478），Enter 连击/快速双击静默忽略；
3. 生成开始即 `setAISendingUI(true)`（:691-699）把 `#aiSendBtn` 的 onclick 换成 `stopAIMessage`（按钮物理变「停止」），结束换回 `requestAISend`；
4. 附件解析中（:480）与 `_wfRunning`（sendAIMessage :603）双重阻断。合规。

**scheduleRender 流式渲染节流：合规（是真节流）**
- `sendAIMessage` 内 scheduleRender（:600-612）：双条件节流——距上次渲染 ≥`max(80, 上次渲染耗时×2)`ms 或累计新增 ≥`max(240, minGap×6)` 字符才渲染，rAF 对齐 + `renderScheduled` 单飞标志 + 自适应放大（渲染越慢频率越低，防 O(n²) 全量重排堆积）；循环收尾 `if(renderScheduled)renderBubble()` 补终帧。合规。
- `continueAIMessage` 内 scheduleRender（:793-805）：同一实现。合规。
- `workflowStreamRender`（:283-288）：80ms 节流 + 尾随 timer，注释明确单实例全局计时。合规。

**saveDBDebounced 用法：合规（正确）**
- 流式 per-chunk 合并落盘：:637（800ms）、:811（800ms）、:286（600ms）；状态切换点 ：562/:786（300ms）、:588（400ms）；
- 每条生成路径的收口（完成/出错/finally）均 `saveDB()` 硬落盘（:641/:665/:681/:858 等），防抖窗口内的崩溃风险被终态硬写覆盖；
- store.js:861 的实现为单例 timer 合并写，与各调用点频率组合无冲突。用法正确，合规。

**oninput 处理器（2 处）**
| 行 | 事件 | 处理 | 结论 |
|----|------|------|------|
| :1146 | aiBaseUrl oninput | aiEndpointHint(:1185)：读 URL→4 组正则→单 hint div 的 textContent | 合规（**无需防抖**：O(1) 纯文本提示更新，无 render()、无重排级联；防抖只会延迟反馈。不属于「oninput 实时搜索」违规） |
| :345 | aiInput input | 草稿 localStorage.setItem | **P3**（高频输入含同步存储写，建议防抖；见违规表） |

**addEventListener（5 处）**
| 行 | 事件 | 处理 | 结论 |
|----|------|------|------|
| :142 | document click（.ai-code-copy 委托） | 复制代码块 | 合规（click 非高频；`window.__aiCodeCopyBound` 守卫防重复绑定） |
| :345 | aiInput input | 草稿持久化 | **P3**（见上） |
| :354 | drawer dragover | preventDefault + classList.add('ai-dragover') | 合规（dragover 虽连续高频，但 handler 为幂等 O(1) class 操作，无需节流） |
| :355 | drawer dragleave | classList.remove（target 自判） | 合规（幂等） |
| :356 | drawer drop | preventDefault + aiAttachAddFiles | 合规（每次拖拽至多一次） |

补充：DnD 绑定有 `_dw.dataset.aiDnd` 守卫，且 openDrawer 每次重开均重建 DOM，无监听器叠加；Tauri 拖拽 `aiBindTauriDnD` 有 `_aiTauriDndBound` 守卫。合规。

**写按钮/确认类处理器（全部存在、全部有有效防护或门控）**
| 函数 | 防护 | 结论 |
|------|------|------|
| clearAIHistory(:1201) | isAIBusy 拦截 + confirmModal 同步回调 | 合规 |
| deleteAIMessage(:1219) | isAIBusy 拦截 + confirmModal | 合规 |
| regenerateAIMessage(:745) | 末条校验+pending/_wfRunning/chatting+Key 检查 + confirmModal（回调首行 closeModal 防重入） | 合规 |
| continueAIMessage(:777) | 同上多重检查 + confirmModal/fromHint 二段入口 | 合规 |
| retryAIMessage(:719) | chatting 检查 + sendAIMessage 内校验 | 合规 |
| undoAIBatch(:858) | confirmModal + 回调内 btnEl.disabled=true | 合规 |
| workflowStart(:274) | _wfRunning + status!=='draft' + chatting 三重 | 合规 |
| workflowCancel/:281 workflowStop | 状态幂等操作 | 合规 |
| kbUnbind(:1096) | confirmModal | 合规 |
| kbBindDir(:1080) | 无防重锁 | **P3**（见违规表） |
| kbRescan(:1088)/kbPickFiles(:1063) | indexing 时按钮 disabled | 合规 |
| 「保存设置」modal onOk(:1158) | async 回调，modal resolve 后才关窗 | **P3**（await 窗口可重入 + setProvider 冗余双调，见违规表） |
| runAIQuickAction(:410)/applyProviderPreset(:1186)/kbSet*(:1102-1106)/aiAttachRemove/copyAIMessage(:723)/kbShowFile(:212) | 轻量幂等或只读操作 | 合规 |

---

## 三、计数与结论

| 级别 | 数量 | 明细 |
|------|------|------|
| P1 | 1 | invoices.js:343 新增发票死交互 |
| P2 | 0 | —（三文件的写按钮均有防重锁或确认门控；未发现 oninput 实时搜索；流式渲染/落盘均已节流防抖） |
| P3 | 4 | settlements.js:770 监听器叠加；ai-chat.js:345 草稿存储未防抖；ai-chat.js:1158 保存设置可重入+冗余双调；ai-chat.js:1080 kbBindDir 无防重锁 |

**已合规要点（摘要）**：
1. 两文件搜索框均为 Enter+isComposing 触发，无 oninput 实时搜索（settlements:262、invoices:320）；
2. 写按钮防重复触发全覆盖：submitSettlement `_settlementSaving` 500ms 锁+二次确认（settlements:800-804）、发票保存 `_invEditSaving` 500ms 锁（invoices:514-516）、AI 发送四层防护（chatting 检查/300ms 门槛/按钮态切换/_wfRunning）；
3. scheduleRender 为「时间间隔+累计增量」双条件自适应节流+rAF 单飞，三处流式渲染（:600/:793/:283）均合规；
4. saveDBDebounced 全部用于流式增量合并落盘且终态均有 saveDB() 硬写收口，用法正确；
5. aiEndpointHint oninput 为 O(1) 文本提示，无需防抖；markDrawerDirty 输入监听为 O(1) 布尔标记，防抖反而有害；
6. 三文件全部内联 onclick/onchange/onkeydown 处理函数经跨 src 检索确认真实存在（除 P1 的参数级死交互外无死交互、无空 onclick、无 href="#" 死链）；
7. addEventListener 实际调用数为 5/2/5（任务线索中的 4/1/5 为按行计：settlements:633 与 invoices:542 各一行含两个调用），全部有守卫或 {once:true}，仅 settlements:770 一处叠加为 P3。

## 四、修复建议复用清单（供后续修复轮参考，本轮未改任何代码）

- P1（invoices:343）：改提示文案或移除按钮；不引入新表单逻辑。
- P3 监听器叠加（settlements:770）：直接删除该处重复绑定（:650 已有等价监听）。
- P3 草稿防抖（ai-chat:345）：复用 utils.js debounce(fn,300)。
- P3 保存设置（ai-chat:1158）：回调读值后先 closeModal()，删 ：1160 冗余 setProvider。
- P3 kbBindDir（ai-chat:1080）：对齐 kbRescan 的 indexing disabled 态。
