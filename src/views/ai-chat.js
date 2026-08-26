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
  const isUser=message.role==='user';const roleLabel=isUser?'我':'AI 助手';const deleteButton=message.id?'<button type="button" class="ai-message-delete" title="删除这条记录" aria-label="删除'+roleLabel+'记录" onclick="deleteAIMessage(\''+escAttr(message.id)+'\')">'+icon('trash','13')+'</button>':'';
  return '<article class="ai-message '+(isUser?'user':'assistant')+'"'+(message.id?' data-ai-id="'+escAttr(message.id)+'"':'')+'><div class="ai-message-meta"><span>'+roleLabel+'</span>'+deleteButton+'</div><div class="ai-bubble">'+(isUser?escHtml(message.content):renderAIMarkdown(message.content))+(message.pending?'<span class="ai-cursor">▍</span>':'')+'</div>'+(message.snapshot?'<details class="ai-snapshot"><summary>查看发送内容</summary><pre>'+escHtml(message.snapshot)+'</pre></details>':'')+'</article>';
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
    '<header class="ai-chat-head"><div><span class="ai-eyebrow">DEEPSEEK · '+escHtml(AI.state.runtime==='tauri'?'桌面直连':'浏览器直连')+'</span><div id="aiStatus">'+aiStatusLabel()+'</div></div><div class="ai-head-actions"><button type="button" class="ai-head-btn" onclick="clearAIHistory()" title="清空全部对话记录">'+icon('trash','15')+' 清空</button><button type="button" class="ai-head-btn" onclick="openAISettings()">'+icon('palette','15')+' 设置</button></div></header>'+
    quickSection+'<div id="aiMessages" class="ai-messages">'+history+'</div>'+
    '<div class="ai-composer"><div class="ai-context">'+icon('link','13')+' 当前上下文：'+escHtml(aiContextName())+' <span>发送前可审阅</span></div><div class="ai-input-row"><textarea id="aiInput" rows="3" placeholder="例如：本月经营情况怎么样？" onkeydown="handleAIInputKey(event)"></textarea><button type="button" id="aiSendBtn" class="btn primary" onclick="requestAISend()">发送</button></div><div class="ai-input-hint">⌘ / Ctrl + Enter 发送 · Shift + Enter 换行</div></div></section>';
  openDrawer('AI 助手',body,null,false,true);AI.probeProxy().then(()=>{aiScrollBottom();});
}
function aiContextName(){const names={dashboard:'概览',units:'关联单位',specs:'属性管理',bom:'BOM管理',prices:'签约报价',orders:'采购订单',settlements:'对账结算','settle-receipt':'收款记录','settle-payment':'付款记录',invoices:'发票管理','inv-issue':'开票记录','inv-receive':'收票记录',data:'数据管理'};return names[view]||'工作台';}
function refreshAIStatus(){const status=document.getElementById('aiStatus');if(status)status.innerHTML=aiStatusLabel();const button=document.getElementById('aiTopbarBtn');if(button){button.classList.toggle('online',AI.state.hasKey);button.title=AI.state.hasKey?'打开 AI 助手（'+(AI.state.runtime==='tauri'?'桌面直连':'浏览器直连')+'）':'请先在 AI 设置中填写 DeepSeek API_KEY';}}
function handleAIInputKey(event){if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();requestAISend();}}
function runAIQuickAction(id){const action=AI.QUICK_ACTIONS.find(item=>item.id===id);const input=document.getElementById('aiInput');if(!action||!input)return;if(!action.prompt){input.value='';input.focus();return;}input.value=action.prompt;requestAISend();}
function requestAISend(){
  const input=document.getElementById('aiInput');if(!input||AI.state.chatting)return;const message=input.value.trim();if(!message){input.focus();return;}
  if(!AI.state.hasKey){toast('请先在 AI 设置中填写 DeepSeek API_KEY','warning');return;}
  _aiCurrentSnapshot=AI.buildPreview(message);
  const body='<p class="note">以下是本次将发送给 AI 的脱敏数据快照，不含联系人电话、地址、税号或银行账户。</p><pre class="ai-preview">'+escHtml(_aiCurrentSnapshot)+'</pre>';
  modal('确认发送数据',body,'确认发送',()=>{closeModal();sendAIMessage(message,_aiCurrentSnapshot);},true);
}
async function sendAIMessage(message,snapshot){
  const input=document.getElementById('aiInput');const messages=document.getElementById('aiMessages');const history=AI.getHistory();if(!messages)return;if(input)input.value='';
  const userMessage=AI.persistMessage('user',message);messages.insertAdjacentHTML('beforeend',aiMessageHTML(userMessage));
  const pending={role:'assistant',content:'',pending:true,snapshot};messages.insertAdjacentHTML('beforeend',aiMessageHTML(pending));const pendingEl=messages.lastElementChild;const sendButton=document.getElementById('aiSendBtn');if(sendButton){sendButton.textContent='停止';sendButton.onclick=stopAIMessage;}
  aiScrollBottom();
  let renderScheduled=false;
  const renderBubble=()=>{renderScheduled=false;const bubble=pendingEl.querySelector('.ai-bubble');if(bubble){bubble.innerHTML=renderAIMarkdown(pending.content)+'<span class="ai-cursor">▍</span>';aiScrollBottom();}};
  const scheduleRender=()=>{if(renderScheduled)return;renderScheduled=true;if(typeof requestAnimationFrame==='function'){requestAnimationFrame(renderBubble);}else{renderBubble();}};
  try{
    const request=[{role:'system',content:AI.buildSystemPrompt(snapshot)}].concat(history,[{role:'user',content:message}]);
    // 统一走写入流程：若模型未调用工具 → aiWriteLoop 返回纯文本总结（兼容只读分析场景）
    const onConfirm=async(toolCalls)=>confirmOpsModal(toolCalls,pendingEl);
    const res=await AI.aiWriteLoop(request,chunk=>{pending.content+=chunk;scheduleRender();},onConfirm,userMessage.id);
    if(renderScheduled)renderBubble();
    pending.content=res.content||'(操作已处理)';
    pending.pending=false;
    const assistantMessage=AI.persistMessage('assistant',pending.content,snapshot);
    pendingEl.outerHTML=aiMessageHTML(assistantMessage);
    // 工具执行结果汇总提示 + 刷新当前视图（让录入结果立即可见）
    if(res.lastToolResults&&res.lastToolResults.length){
      const okN=res.lastToolResults.filter(r=>r.ok).length;
      const failN=res.lastToolResults.length-okN;
      const tip='已执行 '+okN+' 条操作'+(failN?'，'+failN+' 条失败':'');
      toast(tip,failN?'warning':'success');
      if(typeof render==='function'&&okN>0)render();
    }
  }catch(error){pending.content=error.name==='AbortError'?'已停止生成。':'请求失败：'+error.message;pending.pending=false;const assistantMessage=AI.persistMessage('assistant',pending.content,snapshot);pendingEl.outerHTML=aiMessageHTML(assistantMessage);toast(pending.content,'error');}finally{if(sendButton){sendButton.textContent='发送';sendButton.onclick=requestAISend;}aiScrollBottom();}
}
function stopAIMessage(){AI.abort();}

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
async function openAISettings(){
  const isTauri=AI.state.runtime==='tauri';
  const bodyBuilder=async function(){
    const runtimeInfo=isTauri?'<span class="tag green">桌面版（Tauri）</span> API_KEY 保存在本机应用数据目录，不会被发送给任何第三方。':'<span class="tag blue">浏览器版（file://）</span> API_KEY 保存在本机浏览器 localStorage，仅本机可见。';
    // 防御：旧版本（无 getDeepseekToken）降级为空串，避免设置弹窗打不开
    let savedKey='';
    try{
      if(typeof AI.getDeepseekToken==='function')savedKey=await AI.getDeepseekToken();
    }catch(e){savedKey='';}
    // 编辑态回显真实 Key（用户明确允许编辑时可见）；非编辑状态不展示
    const placeholder=savedKey?'sk-… 已保存 Key，输入新值可覆盖；留空保存则删除':'sk-… 从 api.deepseek.com 获取';
    const tokenInput='<div class="field"><label class="f" for="aiDeepseekToken">DeepSeek API_KEY <span style="color:var(--warn)">*</span></label><input id="aiDeepseekToken" type="text" autocomplete="off" spellcheck="false" placeholder="'+escAttr(placeholder)+'" value="'+escAttr(savedKey)+'"><div class="note">'+(savedKey?'已保存 API_KEY（仅在编辑弹窗中可见）':'尚未设置 API_KEY')+' · '+(isTauri?'由 Tauri 桌面版保存到本机应用数据目录':'由浏览器保存到本机 localStorage')+'，用于直连调用 DeepSeek API，不会发送给任何第三方。</div></div>';
    return '<div class="field"><label class="f">运行模式</label><div>'+runtimeInfo+'</div></div>'+
      '<div class="field"><label class="f">AI 状态</label><div>'+aiStatusLabel()+'</div></div>'+
      tokenInput+
      '<div class="field"><label class="f" for="aiModel">模型</label><select id="aiModel">'+
      Array.from(AI.ALLOWED_MODELS).map(m=>'<option value="'+escAttr(m)+'">'+escHtml(m)+'</option>').join('')+
      '</select></div>'+
      '<button class="btn danger" type="button" onclick="clearAIHistory()">清空本机对话历史</button>';
  };
  let body='';
  try{body=await bodyBuilder();}
  catch(e){toast('打开 AI 设置失败：'+(e&&e.message?e.message:e),'error');return;}
  modal('AI 设置',body,'保存设置',async ()=>{
    const modelEl=document.getElementById('aiModel');if(modelEl)AI.setModel(modelEl.value);
    const tokenEl=document.getElementById('aiDeepseekToken');
    try{
      await AI.setDeepseekToken(tokenEl?tokenEl.value:'');
      toast('DeepSeek API_KEY 已保存','success');
    }catch(e){toast('保存 API_KEY 失败：'+(e&&e.message?e.message:e),'error');}
    closeModal();
  });
  const model=document.getElementById('aiModel');if(model)model.value=AI.state.model||AI.DEFAULT_MODEL;
}
function clearAIHistory(){confirmModal('确认清空本机保存的 AI 对话历史？此操作不可恢复。',()=>{DB.aiChats=[];saveDB();closeModal();const qs=document.querySelector('.ai-quick-section');if(qs)qs.style.display='';const box=document.getElementById('aiMessages');if(box)box.innerHTML=aiWelcomeHTML();toast('AI 对话历史已清空','success');},'清空历史');}
function deleteAIMessage(id){
  const message=(DB.aiChats||[]).find(item=>item.id===id);if(!message)return;
  confirmModal('确认删除这条 '+(message.role==='user'?'提问':'回复')+' 记录？此操作不可恢复。',()=>{DB.aiChats=DB.aiChats.filter(item=>item.id!==id);saveDB();closeModal();const item=document.querySelector('[data-ai-id="'+id+'"]');if(item)item.remove();const box=document.getElementById('aiMessages');if(box&&!box.children.length){box.innerHTML=aiWelcomeHTML();const qs=document.querySelector('.ai-quick-section');if(qs)qs.style.display='';}toast('对话记录已删除','success');},'删除记录');}
