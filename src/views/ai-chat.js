// views/ai-chat.js — AI 助手抽屉（DeepSeek 直连：Tauri 桌面版走 Rust 命令，浏览器版前端直连）
let _aiCurrentSnapshot='';
/** 将连续的 markdown 表格行渲染为真 <table>（第二行为 |---| 分隔行时识别表头）
 * @param {string[]} rows - 形如 "|a|b|" 的表格行数组（已 HTML 转义）
 * @param {Function} inline - 行内标记处理函数（code/strong/em）
 * @returns {string} 表格 HTML
 */
function aiMarkdownTableHTML(rows,inline){
  const cells=r=>r.replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>inline(c.trim()));
  const hasSep=rows.length>1&&/^\|[\s:|-]+\|$/.test(rows[1]);
  let head='',body='';
  rows.forEach(function(r,ri){
    if(hasSep&&ri===1)return; // 跳过分隔行
    if(hasSep&&ri===0){head='<thead><tr>'+cells(r).map(c=>'<th>'+c+'</th>').join('')+'</tr></thead>';return;}
    body+='<tr>'+cells(r).map(c=>'<td>'+c+'</td>').join('')+'</tr>';
  });
  return '<div class="ai-table-wrap"><table class="ai-table">'+head+(body?'<tbody>'+body+'</tbody>':'')+'</table></div>';
}
function renderAIMarkdown(text){
  const escaped=escHtml(text||'');
  const inline=value=>value.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
  const lines=escaped.split('\n');let html='';let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(/^&gt;\s?/.test(line)){html+='<blockquote>'+inline(line.replace(/^&gt;\s?/,''))+'</blockquote>';i++;continue;}
    if(/^[-*]\s+/.test(line)||/^\d+\.\s+/.test(line)){
      const ordered=/^\d+\.\s+/.test(line);const items=[];
      while(i<lines.length&&(ordered?/^\d+\.\s+/.test(lines[i]):/^[-*]\s+/.test(lines[i]))){items.push('<li>'+inline(lines[i].replace(ordered?/^\d+\.\s+/:/^[-*]\s+/,''))+'</li>');i++;}
      html+=(ordered?'<ol>':'<ul>')+items.join('')+(ordered?'</ol>':'</ul>');continue;
    }
    if(/^\|.+\|$/.test(line)){
      const rows=[];
      while(i<lines.length&&/^\|.+\|$/.test(lines[i])){rows.push(lines[i].trim());i++;}
      html+=aiMarkdownTableHTML(rows,inline);continue;
    }
    html+=line?'<p>'+inline(line)+'</p>':'';i++;
  }
  return html;
}
function aiStatusLabel(){
  if(AI.state.hasKey)return '<span class="ai-status online">● '+(AI.state.runtime==='tauri'?'桌面就绪':'直连就绪')+'</span>';
  return '<span class="ai-status warning">● 未设置 API_KEY</span>';
}
function aiMessageHTML(message){
  const isUser=message.role==='user';const roleLabel=isUser?'我':'AI 助手';const deleteButton=(message.id&&!message.pending)?'<button type="button" class="ai-message-delete" title="删除这条记录" aria-label="删除'+roleLabel+'记录" onclick="deleteAIMessage(\''+escAttr(message.id)+'\')">'+icon('trash','13')+'</button>':'';
  const content=isUser?escHtml(message.content):aiRenderCite(renderAIMarkdown(message.content));
  return '<article class="ai-message '+(isUser?'user':'assistant')+'"'+(message.id?' data-ai-id="'+escAttr(message.id)+'"':'')+'><div class="ai-message-meta"><span>'+roleLabel+'</span>'+deleteButton+'</div><div class="ai-bubble">'+content+(message.pending?'<span class="ai-cursor">▍</span>':'')+'</div>'+(message.snapshot?'<details class="ai-snapshot"><summary>查看发送内容</summary><pre>'+escHtml(message.snapshot)+'</pre></details>':'')+'</article>';
}
/** 将回答中的「依据：文件名」标注渲染为可点击引用（点击在弹窗查看原文分块） */
function aiRenderCite(html){
  if(!html)return html;
  return String(html).replace(/【依据：([^】]+)】/g,function(m,name){
    const trimmed=(name||'').trim();
    if(!trimmed)return m;
    return '<button type="button" class="ai-cite" onclick="kbShowFile(\''+escAttr(trimmed)+'\')" title="查看原文：'+escAttr(trimmed)+'">'+escHtml(trimmed)+'</button>';
  });
}
/** 查看知识库某文件的原文（弹窗展示其全部分块，用于核对引用来源） */
async function kbShowFile(nameOrRel){
  if(typeof KB==='undefined'){toast('知识库模块未加载','error');return;}
  const blocks=await KB.fileBlocks(nameOrRel);
  if(!blocks.length){toast('未在知识库中找到该文件：'+nameOrRel,'warning');return;}
  const html='<div class="kb-viewer"><div style="margin-bottom:8px"><span class="tag green">'+escHtml(nameOrRel)+'</span> <span class="note">'+blocks.length+' 个分块</span></div>'+blocks.map(function(b,bi){
    const meta=[];
    if(b.chapter)meta.push('章节：'+escHtml(b.chapter));
    if(b.page)meta.push('第'+b.page+'页');
    const mtag=meta.length?' <span class="note">'+meta.join(' · ')+'</span>':'';
    return '<details'+(bi===0?' open':'')+'><summary>分块 '+(bi+1)+mtag+'</summary><pre class="kb-block">'+escHtml(b.text)+'</pre></details>';
  }).join('')+'</div>';
  modal('知识库原文 · '+nameOrRel,html,'关闭',()=>closeModal(),true);
}
function aiWelcomeHTML(){return '<article class="ai-empty"><span class="ai-empty-icon">'+icon('zap','22')+'</span><strong>开始一段新对话</strong><p>我会依据你确认过的脱敏业务快照，帮助分析订单、利润和应收应付。</p><p style="font-size:13px;color:var(--gray)">当前运行：'+escHtml(AI.runtimeLabel())+'</p></article>';}
function aiScrollBottom(){const box=document.getElementById('aiMessages');if(box)box.scrollTop=box.scrollHeight;}
function openAIAssistant(){
  if(document.querySelector('.drawer-wrap'))closeDrawer();
  const actions=AI.QUICK_ACTIONS.map(action=>'<button type="button" class="ai-action" onclick="runAIQuickAction(\''+action.id+'\')">'+escHtml(action.label)+'</button>').join('');
  const history=(DB.aiChats||[]).map(aiMessageHTML).join('')||aiWelcomeHTML();
  // 已有对话历史时不再显示「常用提问」快捷区（冷启动引导只在无对话时出现）
  const hasChat=!!(DB.aiChats&&DB.aiChats.length);
  const quickSection=hasChat?'':'<section class="ai-quick-section"><div class="ai-section-title">常用提问</div><div class="ai-actions">'+actions+'</div></section>';
  const body='<section class="ai-chat" aria-label="AI 助手">'+
    '<header class="ai-chat-head"><div><span class="ai-eyebrow">AI · '+escHtml(AI.providerLabel?AI.providerLabel():'直连')+'</span><div id="aiStatus">'+aiStatusLabel()+'</div></div><div class="ai-head-actions"><button type="button" class="ai-head-btn" onclick="clearAIHistory()" title="清空全部对话记录">'+icon('trash','15')+' 清空</button><button type="button" class="ai-head-btn" onclick="openAISettings()">'+icon('palette','15')+' 设置</button></div></header>'+
    quickSection+'<div id="aiMessages" class="ai-messages">'+history+'</div>'+
    '<div class="ai-composer"><div class="ai-context">'+icon('link','13')+' 当前上下文：'+escHtml(aiContextName())+' <span>发送前可审阅</span></div><div class="ai-input-row"><textarea id="aiInput" rows="3" placeholder="例如：本月经营情况怎么样？" onkeydown="handleAIInputKey(event)"></textarea><button type="button" id="aiSendBtn" class="btn primary" onclick="requestAISend()">发送</button></div><div class="ai-input-hint">Enter 发送 · Ctrl / Shift + Enter 换行</div></div></section>';
  openDrawer('AI 助手',body,null,false,true);AI.probeProxy().then(()=>{aiScrollBottom();});
}
function aiContextName(){const names={dashboard:'概览',units:'关联单位',specs:'属性管理',bom:'BOM管理',prices:'签约报价',orders:'采购订单',settlements:'对账结算','settle-receipt':'收款记录','settle-payment':'付款记录',invoices:'发票管理','inv-issue':'开票记录','inv-receive':'收票记录',data:'数据管理'};return names[view]||'工作台';}
function refreshAIStatus(){const status=document.getElementById('aiStatus');if(status)status.innerHTML=aiStatusLabel();const button=document.getElementById('aiTopbarBtn');if(button){button.classList.toggle('online',AI.state.hasKey);button.title=AI.state.hasKey?('打开 AI 助手（'+AI.runtimeLabel()+'）'):'请先在 AI 设置中填写 API_KEY';}}
function handleAIInputKey(event){
  // Enter 直接发送；Ctrl/Cmd+Enter 与 Shift+Enter 均为换行（textarea 默认行为，不拦截）
  if(event.key==='Enter'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey){
    event.preventDefault();
    requestAISend();
  }
}
function runAIQuickAction(id){const action=AI.QUICK_ACTIONS.find(item=>item.id===id);const input=document.getElementById('aiInput');if(!action||!input)return;if(!action.prompt){input.value='';input.focus();return;}input.value=action.prompt;requestAISend();}
// 全局搜索面板注入的附加上下文（一次有效）
let _aiExtraContext='';
function openAIWithMessage(text,extraContext){
  openAIAssistant();
  _aiExtraContext=extraContext||'';
  setTimeout(function(){
    const input=document.getElementById('aiInput');
    if(input){input.value=text||'';requestAISend();}
  },60);
}
function requestAISend(){
  const input=document.getElementById('aiInput');
  if(!input)return;
  if(AI.state.chatting){toast('AI 正在生成回复，请稍候…','info');return;} // 明确反馈：后台回复仍在进行（弹窗重开后同样适用）
  const message=input.value.trim();if(!message){input.focus();return;}
  if(!AI.state.hasKey){toast('请先在 AI 设置中填写 API_KEY（本地模型可留空）','warning');return;}
  const extra=_aiExtraContext;_aiExtraContext='';
  _aiCurrentSnapshot=AI.buildPreview(message,extra);
  // 数据快照确认弹窗：首次发送提示一次，确认后记住（localStorage），后续发送不再重复弹
  let confirmed=false;
  try{confirmed=localStorage.getItem('wb_fastener_ai_confirm')==='1';}catch(e){}
  if(confirmed){sendAIMessage(message,_aiCurrentSnapshot);return;}
  const body='<p class="note">以下是本次将发送给 AI 的脱敏数据快照，不含联系人电话、地址、税号或银行账户。</p><pre class="ai-preview">'+escHtml(_aiCurrentSnapshot)+'</pre>';
  modal('确认发送数据',body,'确认发送',()=>{closeModal();try{localStorage.setItem('wb_fastener_ai_confirm','1');}catch(e){}sendAIMessage(message,_aiCurrentSnapshot);},true);
}
async function sendAIMessage(message,snapshot){
  const input=document.getElementById('aiInput');const messages=document.getElementById('aiMessages');const history=AI.getHistory();if(!messages)return;if(input)input.value='';
  // 发送时移除欢迎区（欢迎区仅在打开面板且无对话时渲染；发送后必须清除，否则与消息并存）
  const _welcome=document.querySelector('#aiMessages .ai-empty');
  if(_welcome)_welcome.remove();
  const userMessage=AI.persistMessage('user',message);messages.insertAdjacentHTML('beforeend',aiMessageHTML(userMessage));
  // 助手消息改为「创建即入库 + 流式增量防抖落盘」：关闭弹窗 / 中断 / 退出应用都不丢已生成的部分
  // （修复：接口未完全返回时关闭 AI 弹窗，重开对话内容丢失的问题）
  const liveMsg={id:uid('AI'),role:'assistant',content:'',context:view,timestamp:Date.now(),snapshot:snapshot||'',pending:true};
  DB.aiChats.push(liveMsg);
  if(DB.aiChats.length>50)DB.aiChats=DB.aiChats.slice(-50); // 与 ai.js HISTORY_LIMIT 保持一致
  saveDBDebounced(400);
  messages.insertAdjacentHTML('beforeend',aiMessageHTML(liveMsg));
  const sendButton=document.getElementById('aiSendBtn');if(sendButton){sendButton.textContent='停止';sendButton.onclick=stopAIMessage;}
  aiScrollBottom();
  let renderScheduled=false;
  // 按 data-ai-id 实时定位气泡渲染：弹窗关闭再打开也能命中新 DOM（旧实现缓存节点，弹窗重建后写入失效节点）
  const renderBubble=()=>{renderScheduled=false;const el=document.querySelector('[data-ai-id="'+liveMsg.id+'"]');const bubble=el?el.querySelector('.ai-bubble'):null;if(bubble){bubble.innerHTML=renderAIMarkdown(liveMsg.content)+'<span class="ai-cursor">▍</span>';aiScrollBottom();}};
  const scheduleRender=()=>{if(renderScheduled)return;renderScheduled=true;if(typeof requestAnimationFrame==='function'){requestAnimationFrame(renderBubble);}else{renderBubble();}};
  try{
    // 知识库检索：若已绑定且启用，本地 BM25 取 Top-N 片段拼入 system prompt（带源标注）
    let kbBlock='';
    try{
      if(typeof KB!=='undefined'){
        if(!KB.state.bound){await KB.init();}
        if(KB.state.bound&&KB.state.enabled){
          KB.ensureFresh(); // 距上次索引超时则后台增量更新，不阻塞本次回答
          kbBlock=KB.buildPromptBlock(message);
        }
      }
    }catch(e){console.warn('KB retrieve failed',e);}
    const request=[{role:'system',content:AI.buildSystemPrompt(snapshot)+(kbBlock?'\n\n'+kbBlock:'')}].concat(history,[{role:'user',content:message}]);
    // 统一走写入流程：若模型未调用工具 → aiWriteLoop 返回纯文本总结（兼容只读分析场景）
    const onConfirm=async(toolCalls)=>confirmOpsModal(toolCalls,null);
    const res=await AI.aiWriteLoop(request,chunk=>{liveMsg.content+=chunk;scheduleRender();saveDBDebounced(800);},onConfirm,userMessage.id);
    if(renderScheduled)renderBubble();
    if(res.content)liveMsg.content=res.content;      // 以模型最终返回为准
    if(!liveMsg.content)liveMsg.content='(操作已处理)'; // 流式中断时保留已累积内容兜底
    liveMsg.pending=false;
    saveDB();
    // 工具执行成功时在消息下方附「撤销本批」条（复用持久化 undoBatch，刷新不失效，不误伤手动改动）
    let undoBar='';
    if(res.lastToolResults&&res.lastToolResults.length){
      const okN=res.lastToolResults.filter(r=>r.ok).length;
      const failN=res.lastToolResults.length-okN;
      const tip='已执行 '+okN+' 条操作'+(failN?'，'+failN+' 条失败':'');
      toast(tip,failN?'warning':'success');
      const batchIds=(res.lastBatchIds&&res.lastBatchIds.length)?res.lastBatchIds:(res.lastBatchId?[res.lastBatchId]:[]);
      if(okN>0&&batchIds.length){
        const bidStr=escAttr(batchIds.join(','));
        undoBar='<div class="ai-undo-bar" data-batch="'+bidStr+'"><span class="ai-undo-info">'+icon('check','13')+' 已执行 '+okN+' 条</span><button type="button" class="ai-undo-btn" onclick="undoAIBatch(\''+bidStr+'\',this)">'+icon('cornerUpLeft','13')+' 撤销本轮改动</button><span class="ai-undo-hint">可在数据管理-操作历史查看</span></div>';
      }
      if(typeof render==='function'&&okN>0)render();
    }
    // 更新弹窗内气泡为最终态；undoBar 紧随其后插入（弹窗未开则跳过，内容已落盘，重开可见）
    const art=document.querySelector('[data-ai-id="'+liveMsg.id+'"]');
    if(art)art.outerHTML=aiMessageHTML(liveMsg)+undoBar;
  }catch(error){
    const errMsg=(error&&error.message)?error.message:(error?JSON.stringify(error):'未知错误');
    // 中断/出错不再整段丢弃已生成的部分，仅在末尾追加说明并立即落盘
    const note=error&&error.name==='AbortError'?'已停止生成'+(liveMsg.content?'，以上为已生成部分':'')+'。':'请求失败：'+errMsg+(liveMsg.content?'（以上为已生成部分）':'');
    liveMsg.content=(liveMsg.content?liveMsg.content+'\n\n':'')+note;
    liveMsg.pending=false;
    saveDB();
    const art=document.querySelector('[data-ai-id="'+liveMsg.id+'"]');
    if(art)art.outerHTML=aiMessageHTML(liveMsg);
    toast(note,'error');
  }finally{if(sendButton){sendButton.textContent='发送';sendButton.onclick=requestAISend;}aiScrollBottom();}
}
function stopAIMessage(){AI.abort();}
/** 撤销本批 AI 操作（复用持久化 undoBatch，按 op 反向精准回滚，不误伤手动操作）
 *  @param {string} batchId - aiOps 批次 ID
 *  @param {Element} btnEl - 触发按钮（撤销后置灰） */
function undoAIBatch(batchStr,btnEl){
  const batchIds=batchStr?String(batchStr).split(',').filter(Boolean):[];
  if(!batchIds.length){toast('无可撤销的批次','info');return;}
  const ops=(DB.aiOps||[]).filter(o=>batchIds.includes(o.batchId)&&!o.undone);
  if(!ops.length){toast('该轮已无可撤销的操作','info');if(btnEl){btnEl.disabled=true;btnEl.classList.add('done');btnEl.innerHTML=icon('check','13')+' 已撤销';}return;}
  confirmModal('确认撤销本轮 '+ops.length+' 条 AI 操作？将按操作类型反向还原（创建→删除、修改→还原旧值、删除→恢复），不会影响你之后的手动改动。',()=>{
    try{
      let n=0;
      batchIds.forEach(function(b){n+=AI.undoLastBatch(b);});
      toast(n?('已撤销 '+n+' 条操作'):'该轮已无可撤销操作',n?'success':'info');
      if(btnEl){btnEl.disabled=true;btnEl.classList.add('done');btnEl.innerHTML=icon('check','13')+' 已撤销';}
      const bar=btnEl?btnEl.closest('.ai-undo-bar'):null;
      if(bar){const info=bar.querySelector('.ai-undo-info');if(info)info.innerHTML=icon('cornerUpLeft','13')+' 本轮已撤销';}
      if(typeof render==='function')render();
    }catch(e){toast('撤销失败：'+(e&&e.message?e.message:e),'error');}
    closeModal();
  },'撤销本轮');
}

/* ===== AI 操作提案确认弹窗（写入流程核心交互） ===== */
/** AI 操作确认弹窗：渲染 tool_calls 列表，用户勾选后执行
 * @param {Array} toolCalls - 模型返回的 [{id,name,args}]
 * @param {Element} pendingEl - 对话气泡 DOM（保留参数供未来高亮）
 * @returns {Promise<{cancelled:boolean, approvedOps:array}>}
 */
function confirmOpsModal(toolCalls,pendingEl){
  return new Promise(resolve=>{
    // 1. 对每条 toolCall 调用 AIT.validateOp 获取预览
    const items=toolCalls.map((tc,idx)=>{
      const meta=(typeof AIT!=='undefined'&&AIT.TOOL_META[tc.name])||{label:tc.name,tagCls:'gray'};
      const v=(typeof AIT!=='undefined')?AIT.validateOp({name:tc.name,args:tc.args||{}}):{ok:false,error:'AIT 未加载'};
      return {idx,toolCallId:tc.id,name:tc.name,args:tc.args||{},meta,validation:v};
    });
    // 2. 渲染操作列表
    const body='<div class="ops-list">'+items.map(renderOpsItem).join('')+'</div>'+
      '<div class="ops-summary">共 '+items.length+' 条操作提案，<span id="opsSelectedCount">'+items.filter(it=>it.validation.ok).length+'</span> 条已选</div>'+
      '<div class="ops-note">提示：写入操作会写入业务库并记入「操作历史」，可在数据管理页回滚</div>';
    modal('确认 AI 操作提案',body,'执行选中操作',()=>{
      // 收集选中的 ops（注入 __toolCallId 供 aiWriteLoop 回填 tool 响应）
      const approvedOps=[];
      items.forEach(it=>{
        const cb=document.getElementById('ops_check_'+it.idx);
        if(cb&&cb.checked&&it.validation.ok){
          approvedOps.push({
            name:it.name,
            args:it.args,
            __toolCallId:it.toolCallId,
            // 阶段4：并发脏读检测指纹 —— 弹窗确认时的 before 快照 JSON 字符串
            // executeOp 执行前会重新读取当前 before 对比，不一致则拒绝执行（防止弹窗期间数据被并发修改）
            __beforeFingerprint:(it.validation&&it.validation.preview&&it.validation.preview.before!==undefined)
              ?JSON.stringify(it.validation.preview.before):null
          });
        }
      });
      // 执行按钮：先关弹窗再返回（用户可立即看到执行过程与结果）
      closeModal();
      if(!approvedOps.length){resolve({cancelled:true,approvedOps:[]});return;}
      resolve({cancelled:false,approvedOps});
    },true);
    // 覆写取消按钮：标记 cancelled
    const mask=document.getElementById('_mask');
    if(mask){
      const cancelBtn=mask.querySelector('.mf .btn:not(.primary)');
      if(cancelBtn){cancelBtn.onclick=()=>{resolve({cancelled:true,approvedOps:[]});closeModal();};}
      // 复选框联动：实时更新已选计数
      mask.querySelectorAll('.ops-check').forEach(cb=>{
        cb.onchange=()=>{
          const checked=mask.querySelectorAll('.ops-check:checked');
          const cnt=document.getElementById('opsSelectedCount');
          if(cnt)cnt.textContent=checked.length;
        };
      });
    }
  });
}
/** 渲染单条操作卡片（含校验状态、diff 预览） */
function renderOpsItem(it){
  const meta=it.meta;const v=it.validation;
  const cls=v.ok?'':'ops-item-invalid';
  const diffHTML=v.ok?renderOpsDiff(it):'<div class="ops-error">校验失败：'+escHtml(v.error||'未知错误')+'</div>';
  // 删除类：提示进入回收站（可恢复）；AI 无彻底删除能力（原则1）
  let delNote='';
  if(/^delete_/.test(it.name)||it.name==='remove_order_item'){
    delNote='<div class="ops-note ops-note-trash">'+icon('trash','12')+' 删除后进入回收站，可在数据管理页恢复</div>';
  }
  return '<div class="ops-item '+cls+'">'+
    '<div class="ops-item-hd">'+
      '<label class="ops-check-wrap"><input type="checkbox" id="ops_check_'+it.idx+'" class="ops-check" '+(v.ok?'checked':'disabled')+'></label>'+
      '<span class="tag '+meta.tagCls+'">'+escHtml(meta.label)+'</span>'+
      '<span class="ops-target">'+escHtml(summarizeOpTarget(it))+'</span>'+
    '</div>'+
    diffHTML+delNote+
  '</div>';
}
/** 渲染操作 diff 预览（旧值→新值，按工具类型分发） */
function renderOpsDiff(it){
  const v=it.validation;const p=v.preview||{};
  if(it.name==='create_unit'||it.name==='create_price'){
    const after=p.after||{};
    const rows=Object.keys(after).filter(k=>after[k]!==null&&after[k]!==undefined&&after[k]!=='').map(k=>
      '<div class="ops-diff-row"><span class="ops-diff-key">'+escHtml(k)+'</span><span class="ops-diff-val">'+escHtml(fmtOpsVal(after[k]))+'</span></div>'
    ).join('');
    return '<div class="ops-diff">'+(rows||'<div class="ops-diff-row">(无字段)</div>')+'</div>';
  }
  if(it.name==='update_unit'||it.name==='update_price'){
    const before=p.before||{};const after=p.after||{};
    const rows=Object.keys(after).map(k=>{
      const bv=before[k]===undefined?'':before[k];
      const av=after[k]===undefined?'':after[k];
      if(JSON.stringify(bv)===JSON.stringify(av))return '';
      return '<div class="ops-diff-row">'+
        '<span class="ops-diff-key">'+escHtml(k)+'</span>'+
        '<span class="ops-diff-old">'+escHtml(fmtOpsVal(bv))+'</span>'+
        '<span class="ops-diff-arrow">→</span>'+
        '<span class="ops-diff-new">'+escHtml(fmtOpsVal(av))+'</span>'+
      '</div>';
    }).filter(Boolean).join('');
    return '<div class="ops-diff">'+(rows||'<div class="ops-diff-row">无字段变更</div>')+'</div>';
  }
  if(it.name==='flow_order_status'){
    return '<div class="ops-diff">'+
      '<div class="ops-diff-row"><span class="ops-diff-key">订单</span><span class="ops-diff-val">'+escHtml(p.orderId||'')+' '+(p.buyer?'('+p.buyer+')':'')+'</span></div>'+
      '<div class="ops-diff-row"><span class="ops-diff-key">状态</span><span class="ops-diff-old">'+escHtml(p.before||'')+'</span><span class="ops-diff-arrow">→</span><span class="ops-diff-new">'+escHtml(p.after||'')+'</span></div>'+
    '</div>';
  }
  return '<div class="ops-diff"><pre>'+escHtml(JSON.stringify(p,null,2))+'</pre></div>';
}
/** 简短描述操作目标（用于卡片标题） */
function summarizeOpTarget(it){
  const a=it.args||{};const v=it.validation;const p=(v&&v.preview)||{};
  if(it.name==='create_unit')return '新增单位：'+(a.name||'');
  if(it.name==='update_unit'){const u=DB.units.find(x=>x.id===a.unitId);return '修改单位：'+(u?u.name:a.unitId);}
  if(it.name==='create_price'){const u=DB.units.find(x=>x.id===a.unitId);return '新增报价：'+(u?u.name:a.unitId)+' '+(a.spec||a.bomSku||'');}
  if(it.name==='update_price')return '修改报价：'+a.priceId;
  if(it.name==='flow_order_status')return '订单流转：'+a.orderId+' → '+a.toStatus;
  if(it.name==='create_bom')return '新增BOM：'+(a.sku||a.name||'');
  if(it.name==='update_bom')return '修改BOM：'+a.bomId;
  if(it.name==='set_spec_value')return '属性值：'+a.field+'「'+(a.value||'')+'」'+(a.newValue?' → '+a.newValue:'');
  if(it.name==='create_order'){const u=DB.units.find(x=>x.id===a.buyerId);return '新增订单：'+(u?u.name:a.buyerId)+' · '+(a.items||[]).length+' 项';}
  if(it.name==='update_order_meta')return '修改订单：'+a.orderId;
  if(it.name==='add_order_item')return '订单 '+a.orderId+' 添加明细';
  if(it.name==='update_order_item')return '修改订单明细：'+a.itemId;
  if(it.name==='remove_order_item')return '移除订单明细：'+a.itemId;
  if(it.name==='assign_supplier')return '寻货分配：'+a.itemId+' ← '+(a.priceId||'');
  if(it.name==='add_manual_supplier')return '手动录入供应商：'+(a.unitName||'');
  if(it.name==='remove_sourcing_option')return '移除寻货分配：'+a.optionId;
  if(it.name==='create_settlement')return '新增结算：'+(a.type==='receipt'?'收款':'付款')+' ¥'+(a.amount||'');
  if(it.name==='update_settlement')return '修改结算：'+a.settleId;
  if(it.name==='create_invoice')return '新增发票：'+(a.type==='issue'?'开票':'收票')+' ¥'+(a.amount||'');
  if(it.name==='update_invoice')return '修改发票：'+a.invoiceId;
  if(it.name==='delete_unit'){const u=DB.units.find(x=>x.id===a.unitId);return '删除单位：'+(u?u.name:a.unitId);}
  if(it.name==='delete_bom')return '删除BOM：'+a.bomId;
  if(it.name==='delete_price')return '删除报价：'+a.priceId;
  if(it.name==='delete_order')return '删除订单：'+a.orderId;
  if(it.name==='delete_spec_value')return '删除属性值：'+a.field+'「'+(a.value||'')+'」';
  if(it.name==='delete_settlement')return '删除结算：'+a.settleId;
  if(it.name==='delete_invoice')return '删除发票：'+a.invoiceId;
  return it.name;
}
/** 格式化 diff 值（数组/对象/数字/字符串，统一为可读文本，递归处理嵌套结构） */
function fmtOpsVal(v){
  if(v==null||v==='')return '(空)';
  if(Array.isArray(v))return v.map(function(item){return fmtOpsVal(item);}).join(' / ');
  if(typeof v==='object'){
    const parts=Object.keys(v).filter(function(k){return v[k]!==undefined&&v[k]!==null&&v[k]!=='';})
      .map(function(k){return k+'：'+fmtOpsVal(v[k]);});
    return parts.length?parts.join('，'):'{}';
  }
  return String(v);
}
/* ===== 本地知识库（KB）设置区 ===== */
/** 渲染知识库设置区 HTML（AI 设置弹窗内嵌，id=kbZone） */
function kbrenderZone(stat){
  if(!stat)return '<p class="note">知识库模块未加载。</p>';
  const s=stat;
  let head='';
  if(s.bound){
    head+='<div style="margin:6px 0 2px"><span class="tag green">已绑定</span> <strong>'+escHtml(s.dirName)+'</strong>'+(s.indexing?' <span class="ai-status warning">● 索引中…</span>':'')+(s.enabled?' <span class="tag blue">检索开启（Top '+s.topN+'）</span>':' <span class="tag">检索关闭</span>')+'</div>'+
      '<div class="note">'+s.files+' 个文件 · '+s.blocks+' 个分块 · 约 '+Math.round(s.chars/1000)+'K 字'+(s.indexedAt?(' · 索引于 '+new Date(s.indexedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):'')+'</div>';
    if(s.error)head+='<div class="ai-status warning">⚠ '+escHtml(s.error)+'</div>';
  }else{
    head='<div style="margin:6px 0 2px"><span class="ai-status warning">● 未绑定知识库目录</span></div><div class="note">绑定一个本地文件夹作为知识库（支持 md/txt/pdf/docx，PDF/Word 需联网首次加载解析内核），正文留在原目录不动，解析后的分块全文与索引写入独立的 wb_fastener_kb 库，与业务数据分离。</div>';
  }
  const actions=s.bound
    ?'<button type="button" class="btn sm" onclick="kbRescan()"'+(s.indexing?' disabled':'')+'>重新索引</button> <button type="button" class="btn sm" onclick="kbUnbind()"'+((s.indexing)?' disabled':'')+'>断开</button>'
    :'<button type="button" class="btn sm primary" onclick="kbBindDir()">选择目录并索引</button>';
  const enableRow='<div style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" id="kbEnabled" '+(s.enabled?'checked':'')+(s.bound?'':' disabled')+' onchange="kbSetEnabled(this.checked)"> 提问时检索知识库</label>'+
    (s.bound?'<label style="display:flex;align-items:center;gap:4px;font-size:13px">注入 Top-N <input type="number" id="kbTopN" min="1" max="10" step="1" value="'+s.topN+'" style="width:54px;padding:2px 6px" onchange="kbSetTopN(this.value)"></label>':'')+
    '<label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" id="kbCite" '+(s.cite?'checked':'')+(s.bound?'':' disabled')+' onchange="kbSetCite(this.checked)"> 回答标注来源</label></div>';
  return head+'<div style="margin-top:6px">'+actions+'</div>'+enableRow;
}
/** 刷新设置弹窗内的知识库区块（每次操作后重渲染） */
function kbRefreshZone(){
  try{
    const zone=document.getElementById('kbZone');
    if(zone)zone.innerHTML=kbrenderZone(KB.summarize());
  }catch(e){console.warn(e);}
}
/** 索引结果提示（AI 弹窗内）：失败明细不吞掉 */
function kbToastResult(prefix,r){
  const errs=(r&&Array.isArray(r.errors))?r.errors:[];
  let msg=prefix+(r?('：扫描 '+((typeof r.scanned==='number')?r.scanned:r.files)+' 个受支持文件，成功 '+(r.files)+' 个 / '+(r.blocks)+' 个分块'):'' );
  if(errs.length)msg+='；失败 '+errs.length+' 个（'+errs.slice(0,2).join(' / ')+(errs.length>2?' 等':'')+'）';
  toast(msg,errs.length?'warning':'success');
}
async function kbBindDir(){
  if(typeof KB==='undefined'){toast('知识库模块未加载','error');return;}
  const r=await KB.chooseDir();
  if(r&&r.cancelled)return;
  kbRefreshZone();
  if(r&&r.ok)kbToastResult('知识库索引完成',r);
  else if(r&&r.error)toast(r.error,'warning');
}
async function kbRescan(){
  if(typeof KB==='undefined')return;
  const r=await KB.rescan();
  kbRefreshZone();
  if(r&&r.ok)kbToastResult('已重新索引',r);
  else if(r&&r.error)toast(r.error,'warning');
}
async function kbUnbind(){
  if(typeof KB==='undefined')return;
  confirmModal('确认断开知识库目录？将清空独立库 wb_fastener_kb 中的分块与索引（源文件不受影响）。',async()=>{
    const r=await KB.unbind();
    kbRefreshZone();
    if(r&&r.ok)toast('知识库已断开','info');
  },'断开知识库');
}
function kbSetEnabled(v){if(typeof KB!=='undefined'){KB.setEnabled(v);toast(v?'知识库检索已开启':'知识库检索已关闭','info');}}
function kbSetTopN(v){if(typeof KB!=='undefined'){const n=KB.setTopN(v);toast('注入 Top-'+n+' 片段','info');}}
function kbSetCite(v){if(typeof KB!=='undefined'){KB.setCite(v);toast(v?'回答将标注来源':'已关闭来源标注','info');}}

async function openAISettings(){
  const isTauri=AI.state.runtime==='tauri';
  const bodyBuilder=async function(){
    let kbStat=null;
    try{if(typeof KB!=='undefined'){await KB.init();kbStat=KB.summarize();}}catch(e){kbStat=null;}
    const kbZone=kbrenderZone(kbStat);
    const runtimeInfo=isTauri?'<span class="tag green">桌面版（Tauri）</span> API_KEY 保存在本机应用数据目录，不会被发送给任何第三方。':'<span class="tag blue">浏览器版</span> API_KEY 保存在本机浏览器 localStorage，仅本机可见。';
    let savedKey='';
    try{if(typeof AI.getDeepseekToken==='function')savedKey=await AI.getDeepseekToken();}catch(e){savedKey='';}
    const savedBase=AI.state.baseUrl||AI.DEFAULT_BASE_URL;
    const savedModel=AI.state.model||AI.DEFAULT_MODEL;
    // 端点预设：点选自动填入 Base URL 与模型（不立即保存）
    const presets=[
      {label:'DeepSeek',base:'https://api.deepseek.com/v1',model:'deepseek-v4-flash'},
      {label:'OpenAI',base:'https://api.openai.com/v1',model:'gpt-4o-mini'},
      {label:'通义千问',base:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus'},
      {label:'本地 Ollama',base:'http://127.0.0.1:11434/v1',model:'qwen2.5'},
      {label:'本地 oMLX',base:'http://127.0.0.1:8000/v1',model:'qwen2.5'}
    ];
    window._providerPresets=presets;
    const presetBtns=presets.map(function(p,i){return '<button type="button" class="btn sm" onclick="applyProviderPreset('+i+')">'+escHtml(p.label)+'</button>';}).join('');
    const keyPh=savedKey?'已保存 Key，输入新值覆盖；留空保存则删除':'粘贴 API_KEY（本地 Ollama 可留空）';
    return '<div class="field"><label class="f">运行模式</label><div>'+runtimeInfo+'</div></div>'+
      '<div class="field"><label class="f">AI 状态</label><div>'+aiStatusLabel()+'</div></div>'+
      '<div class="field"><label class="f">知识库（本地 RAG）</label><div id="kbZone">'+kbZone+'</div></div>'+
      '<div class="field"><label class="f">端点预设</label><div class="ai-preset-row">'+presetBtns+'</div><div class="note">点选预设自动填入下方 Base URL 与模型；也可手动自定义任意 OpenAI 兼容端点。</div></div>'+
      '<div class="field"><label class="f" for="aiBaseUrl">Base URL（OpenAI 兼容端点）</label><input id="aiBaseUrl" type="text" autocomplete="off" spellcheck="false" placeholder="https://api.deepseek.com/v1" value="'+escAttr(savedBase)+'"><div class="note">需以 /v1 结尾；本地 Ollama 填 http://127.0.0.1:11434/v1（Key 可留空）；本地 oMLX 填 http://127.0.0.1:8000/v1，API_KEY 需与 oMLX「设置 → Auth & Info」中的值一致。</div></div>'+
      '<div class="field"><label class="f" for="aiModel">模型</label><input id="aiModel" type="text" autocomplete="off" spellcheck="false" placeholder="deepseek-v4-flash" value="'+escAttr(savedModel)+'"><div class="note">OpenAI 兼容模型名；自定义端点可填该端点支持的任意模型。</div></div>'+
      '<div class="field"><label class="f" for="aiDeepseekToken">API_KEY</label><input id="aiDeepseekToken" type="text" autocomplete="off" spellcheck="false" placeholder="'+escAttr(keyPh)+'" value="'+escAttr(savedKey)+'"><div class="note">'+(savedKey?'已保存 API_KEY（仅在编辑弹窗中可见）':'尚未设置 API_KEY')+' · '+(isTauri?'由桌面版保存到本机应用数据目录':'由浏览器保存到本机 localStorage')+'，不会发送给任何第三方；本地模型可留空。</div></div>'+
      '<button class="btn danger" type="button" onclick="clearAIHistory()">清空本机对话历史</button>';
  };
  let body='';
  try{body=await bodyBuilder();}
  catch(e){toast('打开 AI 设置失败：'+(e&&e.message?e.message:e),'error');return;}
  modal('AI 设置',body,'保存设置',async ()=>{
    const baseEl=document.getElementById('aiBaseUrl');const modelEl=document.getElementById('aiModel');
    if(baseEl&&modelEl){try{AI.setProvider(baseEl.value,modelEl.value);}catch(e){toast('保存端点失败：'+(e&&e.message?e.message:e),'error');}}
    const tokenEl=document.getElementById('aiDeepseekToken');
    const tokenVal=tokenEl?(tokenEl.value||'').trim():'';
    try{
      await AI.setDeepseekToken(tokenEl?tokenEl.value:'');
      // 本地端点未填 Key 时按服务规则提示（Ollama 可免；oMLX 必须与 oMLX 设置中的 Key 一致）
      const baseVal=baseEl?(baseEl.value||'').trim():'';
      if(!tokenVal&&/^https?:\/\/(127\.0\.0\.1|localhost)/.test(baseVal)){
        toast('本地端点未填 API_KEY：Ollama 可直接使用；若为 oMLX，需在 oMLX「设置 → API Key」配置后，在应用内填写相同值','info');
      }else{
        toast('AI 设置已保存','success');
      }
    }catch(e){toast('保存 API_KEY 失败：'+(e&&e.message?e.message:e),'error');}
    closeModal();
  });
}
/** 应用端点预设到 Base URL / 模型输入框（仅回填，不立即保存） */
function applyProviderPreset(i){
  const p=window._providerPresets&&window._providerPresets[i];
  if(!p)return;
  const b=document.getElementById('aiBaseUrl');const m=document.getElementById('aiModel');
  if(b)b.value=p.base;if(m)m.value=p.model;
}
function clearAIHistory(){confirmModal('确认清空本机保存的 AI 对话历史？此操作不可恢复。',()=>{DB.aiChats=[];saveDB();closeModal();const qs=document.querySelector('.ai-quick-section');if(qs)qs.style.display='';const box=document.getElementById('aiMessages');if(box)box.innerHTML=aiWelcomeHTML();toast('AI 对话历史已清空','success');},'清空历史');}
function deleteAIMessage(id){
  const message=(DB.aiChats||[]).find(item=>item.id===id);if(!message)return;
  confirmModal('确认删除这条 '+(message.role==='user'?'提问':'回复')+' 记录？此操作不可恢复。',()=>{DB.aiChats=DB.aiChats.filter(item=>item.id!==id);saveDB();closeModal();const item=document.querySelector('[data-ai-id="'+id+'"]');if(item)item.remove();const box=document.getElementById('aiMessages');if(box&&!box.children.length){box.innerHTML=aiWelcomeHTML();const qs=document.querySelector('.ai-quick-section');if(qs)qs.style.display='';}toast('对话记录已删除','success');},'删除记录');}
