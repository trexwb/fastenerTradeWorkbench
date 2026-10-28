# 数据与知识链路审查（audit-tmp/data-kb.md）

审查范围：src/views/data.js、src/core/kb.js、src/views/wiki.js、src/core/wiki-kb.js、src/views/search-panel.js；交叉核对 src/core/store.js、src/core/router.js、src/core/ui.js、src/core/ai-tools.js。
性质：只读静态审查（2026-10-28）。格式：severity｜文件:行｜用户触发场景｜证据（关键摘录）｜最小修复建议。

---

## P0（1 条）

### P0-1 回收站恢复订单明细：订单已不存在时静默丢弃数据，且提示「已恢复」
- **severity**：P0（数据丢失）
- **文件:行**：src/core/store.js:1011-1022（restoreFromTrash）
- **触发场景**：① 删除某订单明细（进回收站）→ ② 删除整张订单（也进回收站）→ ③ 在回收站「彻底删除」该订单（或等 90 天自动清理）→ ④ 在回收站点那条 order_item 的「恢复」。订单找不到，明细未恢复，但回收站条目被删除——该明细在世上的最后一份拷贝（entry.data）被丢弃，且 toast「已恢复」。
- **证据**：
  ```js
  }else if(entry.type==='order_item'){
    const order=DB.orders.find(o=>o.id===entry.data.orderId);
    if(order&&Array.isArray(order.items)){ ...order.items.push(itemData); }
  }  // order 不存在时什么都不做
  DB.trash.splice(idx,1);   // 无条件删回收站条目
  ```
- **最小修复**：order 不存在时不 splice（保留回收站条目），改为 throw「所属订单已不存在，无法恢复明细」；data.js restoreTrashItem 已有 catch 可直接 toast 错误。

---

## P1（5 条）

### P1-1 全局搜索面板：点「订单」结果永远落在订单列表，不进详情
- **severity**：P1（死链/跳转失效）
- **文件:行**：src/views/search-panel.js:47；src/core/router.js:196
- **触发场景**：⌘K 输入订单号/客户名 → 点订单分组里任意一条 → 期望打开该订单详情，实际永远落在订单列表页。
- **证据**：search-panel.js:47 `action:function(){curOrderView=o.id;go('orders');}`；router.js:196 `function go(v){view=v;curOrder=null;curOrderView=null;...}` —— 先设的 curOrderView 立刻被 go() 清空，render 走 `viewOrders()` 分支。router.js:597 已有正确入口 `goOrderView(id)`。
- **最小修复**：改为 `action:function(){goOrderView(o.id);}`。

### P1-2 专业解读页内全文搜索：命中「线上文章」点击无反应
- **severity**：P1（死链）
- **文件:行**：src/views/wiki.js:616-622（_wikiHitRow）；来源：wiki.js:_fetchWikiList 映射 `file:''`（约 :208）、_wikiActiveIndex 合并（约 :110）
- **触发场景**：wiki 列表态搜索框输入关键词（list.json 已加载）→ 命中行含线上文章 → 点击该行 / 回车 → 毫无反应。
- **证据**：_wikiHitRow 固定 `onclick="openWikiDoc('+attr+')"`，attr 来自 `_wikiAttr(d.file)`；远程条目 `file:''` → `openWikiDoc('')` 首行 `if(!file)return;`。卡片路径 `_wikiCard` 已正确分流 openWikiExternal，命中行路径漏了。
- **最小修复**：_wikiHitRow 开头加 `const isRemote=!!d.url;`，onclick/onkeydown 按 isRemote 分流 `openWikiExternal(_wikiAttr(d.url))`。

### P1-3 操作历史：AI「创建规格枚举 / 订单明细」的回滚必然抛错，点击无任何反应
- **severity**：P1（功能无法操作 + 无提示）
- **文件:行**：src/core/store.js:1094-1096（undoAiOp case 'create'）、947-949（softDelete 只支持 _SOFT_DEL_TABLE 六类）；触发入口 src/views/data.js:790；操作来源 src/core/ai-tools.js:1394（create spec）、1434（create order_item）
- **触发场景**：AI 创建一条规格枚举值或订单明细 → 数据管理 → 操作历史 → 该条 op 点「回滚」→ 按钮毫无反应（不 render、无 toast、无报错），可反复点仍无反应。
- **证据**：case 'create' 调 `softDelete(op.type,op.targetId,...)`；`_SOFT_DEL_TABLE` 无 'spec'/'order_item' → throw「不支持的软删除类型」→ 被 `throw new Error('回滚失败：...')` 重抛；data.js:790 行内 `onclick="undoAiOp('...');render();toast('已回滚','info');"` 无 try/catch，异常中断整条链。
- **最小修复**：undo 'create' 对 type='spec' 走 softDeleteSpecOption（解析 targetId 的 field:value），type='order_item' 直接从所属订单 items 移除（before 里有订单上下文时可经 after.orderId 定位）；同时给 data.js 行内调用套一层带 toast 的包装函数。

### P1-4 操作历史：AI「修改订单明细」的回滚是假回滚——数据未还原却标记已回滚
- **severity**：P1（回滚不生效但报告成功，数据与记录不一致）
- **文件:行**：src/core/store.js:1098-1106（case 'update'）、1133（`op.undone=true`）；操作来源 src/core/ai-tools.js:1444/1461/1483/1493（update order_item）
- **触发场景**：AI 修改某订单明细（如改数量/价格）→ 操作历史点该 update op 的「回滚」→ toast「已回滚」、条目变灰，但明细数据原样未动。
- **证据**：case 'update' 只处理 `_SOFT_DEL_TABLE[op.type]`；order_item 不在表中 → `arrName` 为 undefined → 整段 if 跳过，随后无条件 `op.undone=true;op.undoneAt=Date.now();saveDB();`。
- **最小修复**：update 分支补 order_item：按 targetId 全库定位 `DB.orders[].items[]` 后 `item 整体替换为 _snap(op.before)`；无法定位时显式 throw（配合 P1-3 的包装 toast），不得静默标已回滚。

### P1-5 导入/恢复确认框点「×」关闭 → await 永不 resolve，导入按钮 loading 永不清除
- **severity**：P1（A 类卡死：await 悬挂 + loading 状态泄漏）
- **文件:行**：src/core/store.js:1442（importParsedData 的 confirmModal 第 5 参 onCancel）；src/core/ui.js:137（确认框右上角 × 只绑 closeModal）；受影响 src/views/data.js:244-262（importJSON 的 finally 永不执行）、src/core/store.js:1397-1420（restoreBackup 静默挂起）
- **触发场景**：数据管理 →「导入 JSON 恢复」选文件 → 弹出「导入将覆盖当前所有数据」确认框 → 点右上角 ×（而非「取消」）→ 按钮永远转圈（aria-busy 不清），restoreBackup 路径则永远无任何后续提示。
- **证据**：store.js:1442 `confirmModal(...,'确认导入','取消',function(){resolve(false);})` —— resolve(false) 只挂在取消按钮；ui.js:137 × 为 `onclick="closeModal()"`，不触发 onCancel；Promise 两分支都没走到 → 永久 pending。
- **最小修复**：ui.js confirmModal 的 × 改为 `onclick="document.getElementById('_modalCancel').click()"`（与 Esc 路径一致）；或在 importParsedData 里不依赖 onCancel，用 `Promise.race` 加超时兜底。

---

## P2（9 条）

### P2-1 网页版备份目录句柄刷新后权限失效：无重新授权入口，列表误报「暂无备份文件」
- **文件:行**：src/core/store.js:1269-1283（performBackup 无 fhPerm）、1345-1368（listBackups 异常吞掉返回 []）、1397-1420（restoreBackup 无 fhPerm）、1285-1305（nowBackup 仅 toast 原始错误）
- **触发场景**：网页版设好备份目录 → 刷新页面（或重启浏览器；Chrome 对 FSA 授权是否跨会话持久随版本而异）→ 「立即备份」报 NotAllowedError 原文；「恢复」同样报错；备份列表显示「暂无备份文件，请先设置备份目录…」——与实际（目录已设、文件还在磁盘）矛盾。同步区有「重新授权连接」（reconnectFile），备份区没有对应入口。
- **证据**：performBackup 直接 `snapDir.getFileHandle(name,{create:true})`；listBackups `try{for await(const entry of dir.values())...}catch(e){}` → 权限拒绝时静默返回空列表。
- **最小修复**：performBackup/restoreBackup/listBackups 前对备份目录句柄 `fhPerm(dir,true)`，未授权时 toast「备份目录授权已失效，请重新选择目录」；listBackups 的 catch 区分 NotAllowedError 写回明确错误。

### P2-2 KB 目录索引期间无进度显示，且可重复并发触发
- **文件:行**：src/core/kb.js:573（`state.indexing=true`）；src/views/data.js:359-376（_kbChoose/_kbRescan 在整个索引完成后才 _kbRefreshBox）；kb.js rescan 入口无 indexing 检查
- **触发场景**：绑定含几百个 PDF 的目录 → 确定后界面纹丝不动（无「索引中…」、按钮不禁用）→ 用户再点「重新索引」→ 两个 indexDir 并发跑，重复解析浪费、后完成者覆盖状态。
- **证据**：`s.indexing` 只在 _kbRefreshBox 渲染时读，而刷新只发生在操作结束后；`KB.rescan()` 无 `if(state.indexing)` 守卫。
- **最小修复**：rescan/chooseDir 入口加 `if(state.indexing)return {ok:false,error:'索引进行中，请稍候'};`；_kbChoose 选完目录立刻调一次 _kbRefreshBox() 让「索引中…」标签先出现。

### P2-3 KB 批量选择文件（网页版）：用户取消选择器 → 未捕获异常，无任何反馈
- **文件:行**：src/core/kb.js:803-807（showOpenFilePicker 无 try/catch）；src/views/data.js:377-384（_kbChooseFiles 不 catch）
- **触发场景**：知识库区点「批量选择文件」（Chrome 网页版）→ 在系统文件框点取消 → 控制台 Uncaught (in promise) AbortError，界面无反应。与 chooseDir 的 AbortError→{cancelled:true} 语义不一致。
- **证据**：`const handles=await window.showOpenFilePicker({multiple:true,...});` 无包裹；_kbChooseFiles 直接 `const r=await KB.chooseFiles();`。
- **最小修复**：kb.js 包 try/catch，AbortError 返回 `{ok:false,cancelled:true}`（Tauri 路径已有此语义）。

### P2-4 KB 网页版目录读取失败被误报为「没有受支持文件」
- **文件:行**：src/core/kb.js:349-356（_kbListFiles 网页分支：walkDir 的 errs 局部变量被丢弃）、615-616（indexDir 传入的 errs 恒为空数组）
- **触发场景**：绑定的目录此后被系统收回读取权限（或目录句柄失效）→ 点「重新索引」→ 红色提示写的是「所选目录内没有发现 md / txt / … 文件」，用户误以为目录内容有问题。
- **证据**：`const found=[];const errs=[];await walkDir(dir,'',0,found,errs);` —— errs 之后无人消费；found 空时 state.error 固定为「没有发现…文件」。
- **最小修复**：_kbListFiles 返回 {found,errs}（或把 errs 拼进 state.error），indexFileList 将其并入返回值 errors。

### P2-5 操作历史单条回滚的条件性失败无反馈（回收站已清空 / 记录已再删）
- **文件:行**：src/core/store.js:1108-1117（case 'delete' throw「回收站已无该条目」、case 'restore' 经 softDelete throw）；src/views/data.js:790（行内 onclick 无 try/catch；对比 :807 undoBatchConfirm 有 try/catch）
- **触发场景**：删除某记录后手动清空回收站（clearTrash 不标记 aiOps）→ 操作历史点该 delete op 的「回滚」→ 无反应、按钮留存；restore 回滚在记录已被再次删除时同样静默。
- **证据**：`if(tIdx<0)throw new Error('回滚失败：回收站已无该条目（可能已清空）');` —— 异常发生在行内 handler，后续 render()/toast 全部不执行。
- **最小修复**：data.js 行内改为调用带 try/catch 的 `undoAiOpSafe(id)`（catch 里 `toast(e.message,'error')`）；顺带在 purgeTrash/clearTrash 时把关联未回滚 delete op 标记 autoPurged，让按钮直接消失。

### P2-6 openWikiExternal 每次必弹「若新窗口未弹出」误导提示
- **文件:行**：src/views/wiki.js:698-707
- **触发场景**：点击任意线上文章卡片 → 新标签页正常打开，同时弹 toast「若新窗口未弹出，请检查浏览器弹窗拦截设置」——每次都弹。
- **证据**：`const opened=window.open(url,'_blank','noopener');` 按 HTML 规范，features 含 noopener 时返回值恒为 null → 恒判定「被拦截」→ 走 `<a>` 降级并弹提示。
- **最小修复**：去掉第三个参数（`window.open(url,'_blank')`，noopener 语义可由降级 `<a rel="noopener">` 承担），仅在降级 click 后仍未打开时提示。

### P2-7 WikiKB 文章 id 用 list.json 下标生成 → 增量同步后分块归属串文章
- **文件:行**：src/core/wiki-kb.js:286（`const id='wiki_'+item.i;`）、261/303（blocksByArticle 以 id 为键，新旧同 id 相互覆盖）、354（search 用 `articles.find(x=>x.id===b.articleId)` 归属）
- **触发场景**：服务端 list.json 调整顺序/插删文章后同步 → 保留的旧文章与同下标的新文章 id 撞车 → 两篇文章共享同一份 blocks，检索命中的标题/URL 归属错乱（AI 引用张冠李戴）。
- **证据**：增量路径 `newArticles.push(old)`（old.id 为旧下标），新解析路径 `id='wiki_'+item.i` —— 两者可相同且都进 blocksByArticle。
- **最小修复**：id 改为由 url 派生的稳定值（如 encodeURIComponent(url) 或简单字符串 hash），旧库做一次按 url 的 id 迁移。

### P2-8 云端 wiki 索引脚本无超时：挂起时会话内永不重试
- **文件:行**：src/views/wiki.js:186-198（动态 script 只挂 onload/onerror）、158（`_wikiRemoteState==='loading'` 直接 return，冷却逻辑只对 error 生效）；附带：`_wikiListHeartbeat`/`WIKI_EMPTY_STALE_MS`/`_wikiListBytesLoaded` 声明后未使用，进度 elapsed 不更新
- **触发场景**：wiki.edtib.com 连接被防火墙静默吞包（TCP 不回 RST）→ index.js 请求长时间挂起 → 本地兜底列表正常显示（无白屏），但云端增强整个会话不再重试；「更新」按钮重置后同样卡 loading。
- **证据**：finish 仅由 `s.onload/s.onerror` 触发，无定时器兜底；重入守卫使后续 _loadWikiRemote 全部空转。
- **最小修复**：注入后起 10s setTimeout，未 finish 则 `finish(false)`（冷却 60s 已有，可自然重试）。

### P2-9 WikiKB 全量同步无进度、单篇 30s 超时串行批次，断网时按钮长时间禁用
- **文件:行**：src/core/wiki-kb.js:216-300（FETCH_TIMEOUT=30000，批 5 篇循环 await）、src/views/data.js:_wikiKbSync（按钮 disabled 依赖 s.syncing，同步期间无进度文案）
- **触发场景**：文章较多或网络半通（每篇都吃满 30s 超时）→ 点「立即同步」→ toast「正在同步…」后最长数分钟无任何反馈，按钮持续禁用、数据页无线索。
- **证据**：`for(let bi=0;bi<needFetch.length;bi+=5){ await Promise.all(batch...) }` 无进度上报；state 无 done/total 字段。
- **最小修复**：state 加 `syncDone/syncTotal`，_wikiKbRefreshBox 显示「同步中 n/总数」；单篇超时降到 8-10s。

---

## 已查未发现问题（类别覆盖说明）

- **A 卡死（其余路径）**：备份/KB 的所有文件选择器入口都先检 `showDirectoryPicker/showOpenFilePicker in window` 并 toast 降级（store.js:239-241、249-269、1249-1250；kb.js:798-801），file:// 双击下 KB chooseDir 自动降级 webkitdirectory 快照模式且带 5 分钟超时兜底（kb.js:_pickDirViaWebkitFiles）；Tauri 目录选择带 30s 超时（kb.js:chooseDir）；list.json fetch 有 15s AbortController（wiki.js:216-219）；同步文件写入失败会 toast 并转「需重新授权」态（store.js:548-553）；绑定流程有 30s 安全锁（store.js:146-149）。modal/drawer/confirm 均有 Esc+遮罩外关+关闭钮（ui.js）；viewWiki 的异步回调 render 均有 `view==='wiki'` 守卫，WikiKB 自动同步有 `_wikiKbAutoSyncTriggered` 防重入，未发现渲染死循环；KB/WikiKB 解析均分批 5 并发、未发现主线程长阻塞（BM25 全量重建在数千分块量为毫秒级）。
- **B 死链（其余入口）**：data.js/wiki.js/search-panel.js 全部行内 onclick/href 引用的函数逐一核对均有全局定义（exportJSON/importJSON/nowBackup/chooseBackupDir/_backup* 系列/_kb* 系列/_wikiKb* 系列/clearAllData/undoBatchConfirm/restoreTrashItem/purgeTrashItem/clearTrashConfirm/_switchDataTab/_setAiOpsFilter/_aiOpsSelftest/_copyDirPath/_wikiManualRefresh/onWikiSearch/onWikiFilter/clearWikiFilters/toggleWikiStar/openWikiDoc/closeWikiDoc/copyWikiLink/openWikiExternal/saveWikiNote/onWikiNoteInput/cmdOpen/cmdInputKey/cmdHover/askAISearch/askAIOnItem/closeSearchPanel 等）；go() 的 switch 分支覆盖 units/specs/bom/prices/orders/settlements/invoices/data/wiki，搜索面板 unit/price/bom/settle/invoice/wiki 六源跳转目标均有效（订单源为唯一坏点，见 P1-1）；「未绑备份目录点立即备份」有 NO_BACKUP_DIR 提示，未支持浏览器点「选择目录」有 toast，按钮渲染条件无恒假分支。
- **C 无法操作（其余路径）**：三个视图的动态填充块（storageQuota/backupDirSpan/backupListBox/kbSectionBox/wikiKbSectionBox/dataLocationInfo/dataDirPath/cmdResults/wikiNoteTA）均有 `getElementById` 空守卫，bindView 对 data 视图只挂 updateStorageQuota 无悬空绑定；combo 未用于这三视图；筛选状态（_wikiSearch/_wikiFilter/_dataTab/_aiOpsFilter）常驻但均有「清除/重置」入口；回收站恢复/彻底删除/清空均有确认与成功/失败 toast；笔记防抖保存有离开冲刷（closeWikiDoc/__wikiReset→_wikiFlushNote）；iframe 与笔记区无 z-index/pointer-events 遮挡。

## 待证项（建议下一步）

1. **P2-1 的实际触发面**：Chrome 各版本对 FSA 目录句柄授权的跨会话持久策略不同，建议在目标用户浏览器（Chrome 版本 + file:// 双击场景）实测「刷新后立即备份」是否必现 NotAllowedError。
2. **P2-7 的实际触发**：需要 wiki.edtib.com 的 list.json 出现顺序变化才能复现；可拉两份历史 list.json 比对顺序稳定性。
3. **P1-4/P1-3 的波及面**：ai-tools.js 是否还有其他以 spec/order_item 为对象的 create/update 工具未逐一枚举（本审查按 grep 到的 recordAiOp 调用点判断），修复时可全量 grep `type:'order_item'`、`type:'spec'` 复核。
