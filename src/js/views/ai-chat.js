// views/ai-chat.js — AI 助手抽屉
let _aiCurrentSnapshot='';
function renderAIMarkdown(text){
  const escaped=escHtml(text||'');
  const inline=value=>value.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
  return escaped.split('\n').map(line=>{
    if(/^&gt;\s?/.test(line))return '<blockquote>'+inline(line.replace(/^&gt;\s?/,''))+'</blockquote>';
    if(/^[-*]\s+/.test(line))return '<li>'+inline(line.replace(/^[-*]\s+/,''))+'</li>';
    if(/^\d+\.\s+/.test(line))return '<li>'+inline(line.replace(/^\d+\.\s+/,''))+'</li>';
    if(/^\|.+\|$/.test(line))return '<div class="ai-table-line">'+inline(line)+'</div>';
    return line?'<p>'+inline(line)+'</p>':'';
  }).join('');
}
function aiStatusLabel(){
  if(!AI.state.proxyOnline)return '<span class="ai-status offline">● 代理未连接</span>';
  if(!AI.state.hasKey)return '<span class="ai-status warning">● 未设置 Key</span>';
  return '<span class="ai-status online">● 已连接</span>';
}
function aiMessageHTML(message){
  const isUser=message.role==='user';const roleLabel=isUser?'我':'AI 助手';const deleteButton=message.id?'<button type="button" class="ai-message-delete" title="删除这条记录" aria-label="删除'+roleLabel+'记录" onclick="deleteAIMessage(\''+escAttr(message.id)+'\')">'+icon('trash','13')+'</button>':'';
  return '<article class="ai-message '+(isUser?'user':'assistant')+'"'+(message.id?' data-ai-id="'+escAttr(message.id)+'"':'')+'><div class="ai-message-meta"><span>'+roleLabel+'</span>'+deleteButton+'</div><div class="ai-bubble">'+(isUser?escHtml(message.content):renderAIMarkdown(message.content))+(message.pending?'<span class="ai-cursor">▍</span>':'')+'</div>'+(message.snapshot?'<details class="ai-snapshot"><summary>查看发送内容</summary><pre>'+escHtml(message.snapshot)+'</pre></details>':'')+'</article>';
}
function aiWelcomeHTML(){return '<article class="ai-empty"><span class="ai-empty-icon">'+icon('zap','22')+'</span><strong>开始一段新对话</strong><p>我会依据你确认过的脱敏业务快照，帮助分析订单、利润和应收应付。</p></article>';}
function aiScrollBottom(){const box=document.getElementById('aiMessages');if(box)box.scrollTop=box.scrollHeight;}
function openAIAssistant(){
  if(document.querySelector('.drawer-wrap'))closeDrawer();
  const actions=AI.QUICK_ACTIONS.map(action=>'<button type="button" class="ai-action" onclick="runAIQuickAction(\''+action.id+'\')">'+escHtml(action.label)+'</button>').join('');
  const history=(DB.aiChats||[]).map(aiMessageHTML).join('')||aiWelcomeHTML();
  const body='<section class="ai-chat" aria-label="AI 助手">'+
    '<header class="ai-chat-head"><div><span class="ai-eyebrow">DEEPSEEK · 本地增强</span><div id="aiStatus">'+aiStatusLabel()+'</div></div><div class="ai-head-actions"><button type="button" class="ai-head-btn" onclick="clearAIHistory()" title="清空全部对话记录">'+icon('trash','15')+' 清空</button><button type="button" class="ai-head-btn" onclick="openAISettings()">'+icon('palette','15')+' 设置</button></div></header>'+
    '<section class="ai-quick-section"><div class="ai-section-title">常用提问</div><div class="ai-actions">'+actions+'</div></section><div id="aiMessages" class="ai-messages">'+history+'</div>'+
    '<div class="ai-composer"><div class="ai-context">'+icon('link','13')+' 当前上下文：'+escHtml(aiContextName())+' <span>发送前可审阅</span></div><div class="ai-input-row"><textarea id="aiInput" rows="3" placeholder="例如：本月经营情况怎么样？" onkeydown="handleAIInputKey(event)"></textarea><button type="button" id="aiSendBtn" class="btn primary" onclick="requestAISend()">发送</button></div><div class="ai-input-hint">⌘ / Ctrl + Enter 发送 · Shift + Enter 换行</div></div></section>';
  openDrawer('AI 助手',body,null,false,true);AI.probeProxy().then(()=>{aiScrollBottom();});
}
function aiContextName(){const names={dashboard:'概览',units:'关联单位',specs:'属性管理',bom:'BOM管理',prices:'签约报价',orders:'采购订单',settlements:'对账结算','settle-receipt':'收款记录','settle-payment':'付款记录',invoices:'发票管理','inv-issue':'开票记录','inv-receive':'收票记录',data:'数据管理'};return names[view]||'工作台';}
function refreshAIStatus(){const status=document.getElementById('aiStatus');if(status)status.innerHTML=aiStatusLabel();const button=document.getElementById('aiTopbarBtn');if(button){button.classList.toggle('online',AI.state.proxyOnline&&AI.state.hasKey);button.title=AI.state.proxyOnline?'打开 AI 助手':'AI 代理未连接';}}
function handleAIInputKey(event){if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();requestAISend();}}
function runAIQuickAction(id){const action=AI.QUICK_ACTIONS.find(item=>item.id===id);const input=document.getElementById('aiInput');if(!action||!input)return;if(!action.prompt){input.value='';input.focus();return;}input.value=action.prompt;requestAISend();}
function requestAISend(){
  const input=document.getElementById('aiInput');if(!input||AI.state.chatting)return;const message=input.value.trim();if(!message){input.focus();return;}
  if(!AI.state.proxyOnline||!AI.state.hasKey){toast('AI 代理未就绪，请先启动代理并确认已设置 DEEPSEEK_API_KEY','warning');return;}
  _aiCurrentSnapshot=AI.buildPreview(message);
  const body='<p class="note">以下是本次将发送给 AI 的脱敏数据快照，不含联系人电话、地址、税号或银行账户。</p><pre class="ai-preview">'+escHtml(_aiCurrentSnapshot)+'</pre>';
  modal('确认发送数据',body,'确认发送',()=>{closeModal();sendAIMessage(message,_aiCurrentSnapshot);},true);
}
async function sendAIMessage(message,snapshot){
  const input=document.getElementById('aiInput');const messages=document.getElementById('aiMessages');const history=AI.getHistory();if(!messages)return;if(input)input.value='';
  const userMessage=AI.persistMessage('user',message);messages.insertAdjacentHTML('beforeend',aiMessageHTML(userMessage));
  const pending={role:'assistant',content:'',pending:true,snapshot};messages.insertAdjacentHTML('beforeend',aiMessageHTML(pending));const pendingEl=messages.lastElementChild;const sendButton=document.getElementById('aiSendBtn');if(sendButton){sendButton.textContent='停止';sendButton.onclick=stopAIMessage;}
  aiScrollBottom();
  try{const request=[{role:'system',content:AI.buildSystemPrompt(snapshot)}].concat(history,[{role:'user',content:message}]);await AI.chat(request,chunk=>{pending.content+=chunk;const bubble=pendingEl.querySelector('.ai-bubble');if(bubble)bubble.innerHTML=renderAIMarkdown(pending.content)+'<span class="ai-cursor">▍</span>';aiScrollBottom();});if(!pending.content)pending.content='未收到有效回复，请稍后重试。';pending.pending=false;const assistantMessage=AI.persistMessage('assistant',pending.content,snapshot);pendingEl.outerHTML=aiMessageHTML(assistantMessage);}catch(error){pending.content=error.name==='AbortError'?'已停止生成。':'请求失败：'+error.message;pending.pending=false;const assistantMessage=AI.persistMessage('assistant',pending.content,snapshot);pendingEl.outerHTML=aiMessageHTML(assistantMessage);toast(pending.content,'error');}finally{if(sendButton){sendButton.textContent='发送';sendButton.onclick=requestAISend;}aiScrollBottom();}
}
function stopAIMessage(){AI.abort();}
function openAISettings(){
  const body='<div class="field"><label class="f">代理状态</label><div>'+aiStatusLabel()+'</div></div><div class="field"><label class="f" for="aiSessionToken">会话访问码</label><input id="aiSessionToken" type="password" autocomplete="off" placeholder="从启动代理的终端复制，仅存当前页面内存"><div class="note">浏览器形态不接收 API Key。请使用 <code>DEEPSEEK_API_KEY=… node tools/ai-proxy.js</code> 启动代理。</div></div><div class="field"><label class="f" for="aiModel">模型</label><select id="aiModel"><option value="deepseek-v4-flash">deepseek-v4-flash</option><option value="deepseek-v4-pro">deepseek-v4-pro</option></select></div><button class="btn danger" type="button" onclick="clearAIHistory()">清空本机对话历史</button>';
  modal('AI 设置',body,'保存设置',()=>{AI.setSessionToken((document.getElementById('aiSessionToken')||{}).value);AI.state.model=(document.getElementById('aiModel')||{}).value||'deepseek-v4-flash';closeModal();toast('AI 设置已保存到当前页面内存','success');});
  const model=document.getElementById('aiModel');if(model)model.value=AI.state.model;
}
function clearAIHistory(){confirmModal('确认清空本机保存的 AI 对话历史？此操作不可恢复。',()=>{DB.aiChats=[];saveDB();closeModal();const box=document.getElementById('aiMessages');if(box)box.innerHTML=aiWelcomeHTML();toast('AI 对话历史已清空','success');},'清空历史');}
function deleteAIMessage(id){
  const message=(DB.aiChats||[]).find(item=>item.id===id);if(!message)return;
  confirmModal('确认删除这条 '+(message.role==='user'?'提问':'回复')+' 记录？此操作不可恢复。',()=>{DB.aiChats=DB.aiChats.filter(item=>item.id!==id);saveDB();closeModal();const item=document.querySelector('[data-ai-id="'+id+'"]');if(item)item.remove();const box=document.getElementById('aiMessages');if(box&&!box.children.length)box.innerHTML=aiWelcomeHTML();toast('对话记录已删除','success');},'删除记录');
}
