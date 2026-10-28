# AI 链路静态审查报告（ai.md）

- 审查范围：`src/views/ai-chat.js`、`src/core/ai.js`、`src/core/ai-tools.js`、`src/core/ai-files.js`、`src/core/help-knowledge.js`，并交叉核对 `src/core/store.js`（aiOps/undo/softDelete）、`src/core/router.js`（render/go）、`src/core/ui.js`（modal/drawer）、`src/core/wiki-kb.js`、`src/core/kb.js`、`src-tauri/src/lib.rs`。
- 方法：只读静态审查，以工作区当前文件为准（git status 仅 `src/views/wiki.js` 有未提交改动，与 AI 链路无关，AI 链路文件均为已提交状态）。
- 严重级定义：P0=卡死或数据丢失；P1=功能无法操作或死链；P2=健壮性与体验。
- 数量统计：**P0 × 1，P1 × 4，P2 × 7**。

---

## P0（数据丢失）

### P0-1 撤销「修改订单元信息」会用 4 字段部分快照整行替换订单对象，订单被毁
- **文件:行**：`src/core/ai-tools.js:1419`（部分快照）＋ `src/core/store.js:1103`（整行替换）
- **用户触发场景**：AI 起草 `update_order_meta`（如改交期）→ 用户确认执行 → 之后在「数据管理 → 操作历史」单条回滚（或对话内「撤销本轮改动」）→ 该订单记录被替换为只有 4 个字段的对象。
- **证据**：
  - 执行器记录的 before 是部分快照：`const before=_snap({buyerId:o.buyerId,project:o.project,deliveryDate:(o.delivery&&(o.delivery.date||o.delivery.time))||'',buyerContact:o.buyerContact});`（ai-tools.js:1419）
  - 回滚逻辑整行替换：`const i=arr.findIndex(r=>r.id===op.targetId); if(i>=0)arr[i]=_snap(op.before);`（store.js:1103），`_SOFT_DEL_TABLE={unit:'units',bom:'bom',price:'prices',order:'orders',...}`（store.js:930）命中 `order → orders`。
  - 替换后订单对象失去 `id/status/items/createdAt/delivery.address` 等全部字段（before 里没有 `id`），列表页按 `o.id` 找不到、详情页打不开，只能靠备份恢复。
- **对照**：其余 update 执行器（update_unit/update_price/update_bom/update_settlement/update_invoice/update_order_item）的 before 均为 `_snap(整对象)`，唯独 update_order_meta 是部分快照。
- **最小修复**：ai-tools.js:1419 改为 `const before=_snap(o);`（记录完整订单快照）；或 store.js:1103 的 update 回滚改为 `Object.assign(arr[i],_snap(op.before))` 并要求 before 含 id。前者改动最小且与其余执行器口径一致。

---

## P1（功能无法操作 / 死链）

### P1-1 `read_local_file`（v1.0.57 桌面版新工具）路由断裂：永远走写入确认弹窗且执行必报「未知工具」
- **文件:行**：`src/core/ai.js:725-726`（分流）＋ `src/core/ai-tools.js:916`（FILE_TOOL_NAMES 定义但未导出、未被分流引用）＋ `src/core/ai-tools.js:1601`（executors 无此工具）
- **用户触发场景**：桌面版用户让 AI 读本地文件 → 模型调 `read_local_file` → 被分流进 writeOps → 弹「确认 AI 操作提案」要求用户确认一个"只读"操作（与 schema 描述「立即执行不需确认」相悖）→ 确认后 `executeOp` 找不到 executor，返回 `未知工具：read_local_file` 回填给模型，功能完全不可用。
- **证据**：
  - 分流只认 `query_` 前缀 / KB / Wiki 集合：`const queryOps=calls.filter(tc=>tc.name.indexOf('query_')===0||(kbSet&&kbSet.has(tc.name))||(wikiKbSet&&wikiKbSet.has(tc.name)));`（ai.js:725），`read_local_file` 落入 writeOps（ai.js:726）。
  - `validateOp` 对它直接放行（ai-tools.js:1568），但放行≠可执行：`const ex=executors[op.name]; if(!ex)return {ok:false,error:'未知工具：'+op.name};`（ai-tools.js:1601）；真正的实现 `runQuery('read_local_file')`（ai-tools.js:1875）永远不会被路由到。
- **最小修复**：ai.js:725 的 queryOps 条件追加 `||(typeof AIT!=='undefined'&&AIT.FILE_TOOL_NAMES&&AIT.FILE_TOOL_NAMES.has(tc.name))`（同时在 ai-tools.js 的 return 导出 FILE_TOOL_NAMES）。

### P1-2 订单明细更新类操作的回滚是"假撤销"：标记已撤销但数据不还原，UI 误报成功
- **文件:行**：`src/core/store.js:1094-1103`（undoAiOp case 'update'）＋ `src/core/store.js:930`（映射表无 order_item）＋ `src/core/ai-tools.js:1441/1477/1496/1512`（四个执行器均记 `op:'update',type:'order_item'`）
- **用户触发场景**：AI 执行 `assign_supplier` / `add_manual_supplier` / `remove_sourcing_option` / `update_order_item` 后，用户在操作历史（或对话内撤销条）整批回滚 → toast 显示「已撤销 N 条操作」，但订单明细的 options/字段完全没还原。
- **证据**：回滚取表名 `const arrName=_SOFT_DEL_TABLE[op.type];`，`order_item` 不在映射表 → `if(arrName&&op.before)` 为假 → 什么都不做，仍执行 `op.undone=true`（store.js:1108）。而 undoAiOp 里专门的 `case 'assign':`（store.js:1121，按 `before.orderId` 还原 options）从未被任何执行器产出——执行器全部记成 `op:'update'`。
- **最小修复**：四个执行器把 `op:'update',type:'order_item'` 改记为 `op:'assign',before:{orderId:o.id,options:_snap(it.options||[]),...}` 口径（或 case 'update' 内为 `order_item` 补"按 targetId 找订单→按 before 整体还原该明细"的分支）；二选一，前者更贴已有回滚分支。

### P1-3 写入成功 / 计划创建 / 视图导航后的 `render()` 会销毁打开中的 AI 抽屉：「撤销本轮改动」条与执行计划卡永不显示
- **文件:行**：`src/views/ai-chat.js:685`（先 render 后查 DOM）＋ `src/views/ai-chat.js:667`（wfId 路径同样先 render）＋ `src/core/router.js:261`（`app.innerHTML=` 全量重建）＋ `src/core/ui.js`（openDrawer 把 `.drawer-wrap` append 到 `#app`）
- **用户触发场景**：用户在 AI 抽屉里确认执行写入提案 → `executeOps` 成功 → `render()` 重建 `#app`，抽屉随 DOM 一起消失 → 随后的 `document.querySelector('[data-ai-id=...]')` 必为 null → `aiMessageHTML(liveMsg)+undoBar` 不插入。撤销条入口（`undoAIBatch`）在主路径上从未渲染过，等于死功能；`flow_start_workflow` 的计划卡同理（ai-chat.js:667），用户只能重开抽屉看到。AI 调 `navigate_view`（runFlow → go() → render()）时抽屉也被连带关闭。
- **证据**：`if(typeof render==='function'&&okN>0)render();` 紧接 `const art=document.querySelector('[data-ai-id="'+liveMsg.id+'"]'); if(art)art.outerHTML=aiMessageHTML(liveMsg)+undoBar;`（ai-chat.js:685→690）；代码注释自认「弹窗未开则跳过」，说明作者已观察到 art 为 null，但未意识到是 render() 自己关掉了抽屉。
- **最小修复**：把 render() 挪到 undoBar 插入之后，并改为「只刷新背景视图、保留抽屉」——最小做法是先 `const art=...; if(art)art.outerHTML=...` 再 render()，render() 开头检测 `.drawer-wrap` 存在时渲染后重建该抽屉（或至少把 render() 调用移到 undoBar/计划卡 DOM 更新之后，接受背景页延迟刷新）。

### P1-4 桌面版（Tauri）「停止生成」按钮完全无效：AbortController 从未创建，Rust 侧也无中止命令
- **文件:行**：`src/core/ai.js:939`（abort 只置标记）＋ `src/core/ai.js:514`（tauri 分支无 controller）＋ `src/core/ai.js:528`（controller 仅 web 分支创建）＋ `src-tauri/src/lib.rs`（仅行级空闲超时 1043-1048，无 abort 命令）
- **用户触发场景**：桌面版生成中点「停止」→ 按钮语义失效：`abort()` 里 `if(state.abortController)` 恒为假（tauri 分支从不赋值），流式继续追加、按钮保持「停止」态，直到 Rust 端请求自然结束（或 90s 级空闲超时）才收尾；多轮工具循环也照常继续。
- **证据**：`function abort(){state.abortReason='manual';if(state.abortController)state.abortController.abort();}`（ai.js:939）；`const full=await tauriInvoke('ai_deepseek_chat',reqArgs);`（ai.js:514）前后无任何中止通道。
- **最小修复**：短期在 tauri 分支让 abort 产生可见效果——`_ensureStreamListener` 的 onChunk 回调里检测 `state.abortReason==='manual'` 即丢弃后续块并提前以 AbortError 结束（invoke 结果到达时不再消费）；长期在 Rust 侧加 abort 命令（reqwest 持连接句柄 cancel）。

---

## P2（健壮性与体验）

### P2-1 首块到达前手动「停止」被误报为「无法连接模型服务」
- **文件:行**：`src/core/ai.js:367-379`
- **场景**：请求发出、尚未收到第一个数据块时点停止 → fetch 以 AbortError reject → webChat 重试循环把它当网络失败包装。
- **证据**：`if(signal&&signal.aborted)break;` 后仍走 `throw new Error('无法连接模型服务（'+apiChatUrl()+'）：'+...)`（ai.js:379），AbortError 语义丢失，sendAIMessage 按非超时失败渲染「请求失败：无法连接模型服务…」而非「已停止生成」。
- **最小修复**：`if(!res)` 抛错前检查 `_netErr&&_netErr.name==='AbortError'` → 原样重抛 AbortError。

### P2-2 上下文压缩失败无降级：注释承诺「降级为截断最近 6 条」，实际原样携带超长请求继续发
- **文件:行**：`src/core/ai.js:594-606`（aiWriteLoop round0）＋ `src/core/ai.js:556`（compressContext 注释）
- **场景**：历史超 20000 字触发压缩 → 压缩请求自身失败（断网/超时/无 Key）返回 null → `if(summary){...}` 无 else → 超长 messages 原样请求 → 大概率被服务端 400 拒绝，本轮发送失败。
- **证据**：`const summary=await compressContext(messages); if(summary){...}`（ai.js:597-598），无 else 分支；compressContext 注释「失败（网络/超时）返回 null，调用方降级为截断最近 6 条」与实现不符。
- **最小修复**：`if(summary){...} else { messages.splice(1, messages.length-7); }`（保 system + 最近 6 条），或至少在压缩失败时保留最近 N 条。

### P2-3 `add_manual_supplier` 自动创建的单位与报价不入 aiOps：整批撤销后残留孤儿数据
- **文件:行**：`src/core/ai-tools.js:1464-1493`
- **场景**：AI 手动录入供应商（自动建单位+写价格库）→ 用户整批撤销 → 明细 options 还原（若 P1-2 修复后），但自动创建的 `unit` 与 `price` 记录永久残留且无审计记录。
- **证据**：执行器只 `recordAiOp({op:'update',type:'order_item',...})` 一次，`DB.units.push(unit)` 与 `DB.prices.push(price)` 均无对应 op 记录。
- **最小修复**：为单位/价格创建各补一条 `recordAiOp`（同 batchId），撤销链自动覆盖。

### P2-4 `set_spec_value` / `add_order_item` 的 create 回滚必然抛错且被静默吞掉
- **文件:行**：`src/core/store.js:1094-1099`（case 'create' 一律走 softDelete）＋ `src/core/store.js:930`（映射表无 `spec`/`order_item`）
- **场景**：AI 新增属性值或订单明细后整批撤销 → `softDelete('spec',...)` 抛「不支持的软删除类型」→ undoBatch catch 只 `console.warn` → 该条不还原、无用户提示，撤销计数与实际不符。
- **证据**：`case 'create': try{softDelete(op.type,op.targetId,...);}catch(e){throw ...}`（store.js:1094-1099）＋ undoBatch `catch(e){console.warn('批次回滚部分失败：',...)}`（store.js:1143）。
- **最小修复**：case 'create' 对 `type==='spec'` 走 `softDeleteSpecOption`、对 `order_item` 走 `softDeleteOrderItem`（before.op 里补 orderId 或由 targetId 反查）。

### P2-5 Excel 附件解析为纯同步重活：大文件冻结主线程，「解析中…」芯片之外无进度、不可取消
- **文件:行**：`src/core/ai-files.js:79-99`（parseExcel：`window.XLSX.read` + `sheet_to_csv` 同步）＋ `src/views/ai-chat.js:471`（aiAttachPush 即选即解析）
- **场景**：用户选一个十几 MB 的 xlsx → 芯片显示「解析中…」→ `XLSX.read` 对 20MB 上限内文件同步解析数秒，UI 全程冻结（点击/滚动无响应），无进度提示、无法取消；PDF 逐页异步、docx mammoth 异步，仅 Excel 是重灾区。
- **最小修复**：解析前 `await new Promise(r=>setTimeout(r,30))` 让芯片先绘制；把 `sheet_to_csv` 按工作表切片放进 `await` 间隔（每表 yield 一次）；或对 >5MB 的 xlsx 提示「大文件解析中，请稍候」。

### P2-6 `read_local_file` 的 `window.__rfCache` 无上限、无过期：内存持续增长且读到旧内容
- **文件:行**：`src/core/ai-tools.js:1875-1912`
- **场景**：长会话中模型多次读不同路径 → 每个路径全文（至 20 万字）常驻 window，直到刷新；同一文件被用户修改后再次调用仍返回旧缓存。
- **最小修复**：缓存超过 5 条时淘汰最旧；或在 `started` 占位返回时记录时间戳，超过 5 分钟重读。

### P2-7 `update_order_item` 执行器无字段白名单：模型附带字段会整体写入明细
- **文件:行**：`src/core/ai-tools.js:1437-1443`
- **场景**：模型在 args 里多带 `options` / `id` / `status` 等非编辑字段（校验器只挑字段校验、不拒绝多余键）→ `Object.assign(it,patch)` 把它们原样覆盖进明细（如整体替换 options 数组、改 itemId），破坏寻货分配数据。
- **证据**：`const patch=Object.assign({},args);delete patch.orderId;delete patch.itemId;Object.assign(it,patch);`（ai-tools.js:1441-1442）；对照 update_unit/update_price/update_bom 均用 `_pick` 白名单。
- **最小修复**：改为 `const patch=_pick(args,['name','spec','qty','salePrice','quotePrice','usage','remark']);`。

---

## 任务六问逐项结论（已查证部分）

1. **流式中断/无 Key/超时/中途关抽屉，「生成中」能否结束**：浏览器版能——AbortController 真实 abort（ai.js:528），首块 120s / 空闲 90s 双看门狗（FIRST_CHUNK_TIMEOUT_MS/IDLE_TIMEOUT_MS），`chat()` finally 复位 `chatting`，`sendAIMessage`/`continueAIMessage`/`runWorkflowSteps` 均有 finally 复位 UI 与 `pending`；关抽屉后台继续、重开恢复（`setAISendingUI(true)` + 按 `data-ai-id` 重查 DOM）；`pagehide` 落盘兜底。断网带半截内容时 aiWriteLoop 归一为断流结果自动续写、手动停止原样上抛。**例外即 P1-4（桌面版停止无效）与 P2-1（首块前停止误报）**。
2. **写入提案执行失败后的 aiOps 回滚链**：executeOps 单条失败不中断其他、失败条目不产生 aiOps（无需回滚）、成功条目按 batchId 可整批撤销（store.js undoBatch 逆序）。**缺口即 P0-1（update_order_meta 假快照毁单）、P1-2（order_item 更新类假撤销）、P2-3（副产物残留）、P2-4（create 类抛错被吞）**；另「撤销本轮改动」入口因 P1-3 实际不可见，用户只能走数据管理-操作历史。
3. **提案含脏数据（单位/订单 ID 不存在）**：`validateOp` 校验存在性，失败卡片显示「校验失败：单位不存在：xxx」且 checkbox `disabled` 不可勾选；全无效时点「执行选中操作」→ approvedOps 空 → 以 `{cancelled:true}` 结束并回填「用户取消了本次操作」，不崩溃不死锁；弹窗期间并发脏数据由 `__beforeFingerprint` 二次检测拦截（executeOps 开头整批拒绝）。**已查，无问题**。
4. **附件大文件解析与失败后能否继续发消息**：`AF.parseEntry` 全程 try/catch 永不 reject（ai-files.js:169-172）→ 失败置 chip 为 error + toast，发送只被 `status==='parsing'` 阻塞，失败项不阻塞发送；解析成功上限 20MB/20 万字有截断标记。**缺口仅 P2-5（Excel 同步阻塞）**。
5. **浏览器版无 Key 各入口降级**：`requestAISend`/`regenerateAIMessage`/`continueAIMessage` 均有 hasKey+apiKey 双重检查 toast 拦截；顶栏按钮 title 提示；AI 设置可打开；本地端点（127.0.0.1/localhost）免 Key 放行；`runAIQuickAction`→requestAISend 同样拦截；正文路径直读浏览器版 toast 引导上传。备注：`retryAIMessage` 无显式 Key 检查，Key 被清后重试会在请求层报错并落失败说明（可用但提示绕一层，未单列）。**已查，无问题**。
6. **对话历史超长注入**：`getHistory` 取最近 20 条、附件块按 2000/8000 字预算回注（ai.js:198）；首轮总字符 >20000 触发模型压缩（compressContext，输入截 30000 字、摘要 >50 字才采用）；**缺口即 P2-2（压缩失败无降级）**；压缩请求自身无进度提示（多一次模型往返延迟）。

## 死链/遮挡类排查结果（B/C 类）

- ai-chat.js 全部 inline onclick 目标（workflowStart/Stop/Cancel、kbSet*、applyProviderPreset、undoAIBatch、copyAIMessage 等）均有全局定义；`go()` 的 13 个 viewName 在 render() switch 全有分支；`goOrderView/openSettleDetail/openInvEdit/newUnit/newOrder/newPrice/openBOMForm` 均存在（router.js:597、settlements/invoices/units/orders/prices/bom.js）。**已查，无死链**。
- 确认弹窗 `.mask` z-index 1050 > 抽屉 1000（components.css:349/360），无遮挡；confirmOpsModal 五条关闭路径（OK/取消/X/Esc/Observer 兜底）均 settle，`settled` 防双 resolve；scheduleRender 自调度链有终止条件（due 判定基于时间差必然满足），无渲染死循环。**已查，无问题**。

## 待证项 / 建议下一步

- `update_order_meta` 的 P0 建议用真实数据验证一次回滚后果（导入含订单的测试库 → AI 改交期 → 操作历史回滚 → 观察订单对象字段），以坐实破坏面。
- P1-3 建议在浏览器实测：AI 写入成功后抽屉是否立即消失（本审查为静态推断，DOM 销毁路径证据链完整但未运行验证）。
- `src-tauri/src/lib.rs` 的行级空闲超时具体时长未逐行核对（本次只确认「存在行级超时、无 abort 命令」），如需精确标注 Rust 侧超时值可再查 1043-1048 行上下文。
