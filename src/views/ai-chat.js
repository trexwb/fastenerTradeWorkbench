// views/ai-chat.js — AI 助手抽屉（DeepSeek 直连：Tauri 桌面版走 Rust 命令，浏览器版前端直连）
let _aiCurrentSnapshot='';
let _aiSendGateAt=0; // 发送防抖门槛：300ms 窗口内的重复触发直接忽略（Enter 连击/快速双击）
let _wfRunning=false;   // 执行计划是否正在逐步运行（防止并发启动多个计划）
let _aiActiveWfId=null; // 正在运行/待确认的执行计划 id（供写入确认弹窗取消时感知并中止计划）
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
  // 2026-08-29：hasKey + apiKey 双重检查，防止初始化时序导致 hasKey=false 但 Key 实际已保存
  const hasKey=AI.state.hasKey||!!(AI.state.apiKey&&String(AI.state.apiKey).trim());
  if(hasKey)return '<span class="ai-status online">● '+(AI.state.runtime==='tauri'?'桌面就绪':'直连就绪')+'</span>';
  return '<span class="ai-status warning">● 未设置 API_KEY</span>';
}
function aiMessageHTML(message){
  const isUser=message.role==='user';const roleLabel=isUser?'我':'AI 助手';const deleteButton=(message.id&&!message.pending)?'<button type="button" class="ai-message-delete" title="删除这条记录" aria-label="删除'+roleLabel+'记录" onclick="deleteAIMessage(\''+escJsStr(message.id)+'\')">'+icon('trash','13')+'</button>':'';
  const content=isUser?escHtml(message.content):aiRenderCite(renderAIMarkdown(message.content));
  // 失败/超时消息附「重新提交」按钮（点击用原始问题+快照重发，见 retryAIMessage）
  const retryBar=(!isUser&&message.id&&message.retry)?'<div class="ai-undo-bar"><button type="button" class="ai-undo-btn" onclick="retryAIMessage(\''+escJsStr(message.id)+'\')">'+icon('refresh','13')+' 重新提交此问题</button><span class="ai-undo-hint">'+escHtml(message.retryError||'')+'</span></div>':'';
  // 执行计划卡：assistant 消息带 wf 时在气泡下方渲染（从 DB.aiWorkflows 实时读状态，运行中自动刷新）
  const wfCard=(!isUser&&message.wf&&message.wf.id)?'<div class="ai-wf-wrap" data-wf-wrap="'+escAttr(message.wf.id)+'">'+aiWorkflowCardHTML(message.wf.id)+'</div>':'';
  const stepTag=(!isUser&&message.wfStepOf)?'<div class="ai-step-tag">'+escHtml((message.wfStepTitle||'执行步骤')+(message.wfStepDone?' · 完成':' · 执行中'))+'</div>':'';
  return '<article class="ai-message '+(isUser?'user':'assistant')+'"'+(message.id?' data-ai-id="'+escAttr(message.id)+'"':'')+'><div class="ai-message-meta"><span>'+roleLabel+'</span>'+deleteButton+'</div><div class="ai-bubble">'+content+(message.pending?'<span class="ai-cursor">▍</span>':'')+'</div>'+stepTag+wfCard+(message.snapshot?'<details class="ai-snapshot"><summary>查看发送内容</summary><pre>'+escHtml(message.snapshot)+'</pre></details>':'')+retryBar+'</article>';
}
/** 将回答中的「依据：文件名」标注渲染为可点击引用（点击在弹窗查看原文分块） */
function aiRenderCite(html){
  if(!html)return html;
  return String(html).replace(/【依据：([^】]+)】/g,function(m,name){
    const trimmed=(name||'').trim();
    if(!trimmed)return m;
    return '<button type="button" class="ai-cite" onclick="kbShowFile(\''+escJsStr(trimmed)+'\')" title="查看原文：'+escAttr(trimmed)+'">'+escHtml(trimmed)+'</button>';
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
// ===== 执行计划（工作流）卡片 =====
/** 渲染执行计划卡（实时读取 DB.aiWorkflows 中最新状态；无计划返回提示占位） */
function aiWorkflowCardHTML(wfId){
  const wf=AI.wfFind(wfId);
  if(!wf)return '<div class="ai-wf-card"><div class="ai-wf-goal note">（该执行计划已清理）</div></div>';
  const statusMap={draft:['等待确认','wf-status-draft'],active:['执行中','wf-status-active'],done:['已完成','wf-status-done'],aborted:['已中止','wf-status-aborted'],cancelled:['已取消','wf-status-cancelled']};
  const st=statusMap[wf.status]||[wf.status,'wf-status-draft'];
  const stepsHtml=wf.steps.map(function(s,idx){
    const cls=s.status==='done'?'wf-step done':(s.status==='active'?'wf-step active':'wf-step');
    const stateDot=cls.indexOf('done')>=0?'<span class="wf-dot ok"></span>':cls.indexOf('active')>=0?'<span class="wf-dot run"></span>':'<span class="wf-dot"></span>';
    const sum=(s.status==='done'&&s.summary)?'<div class="wf-step-sum">'+escHtml(s.summary)+'</div>':'';
    const desc=(s.status!=='done'&&s.description)?'<div class="wf-step-desc">'+escHtml(s.description)+'</div>':'';
    return '<div class="'+cls+'">'+stateDot+'<div class="wf-step-main"><div class="wf-step-title">步骤'+(idx+1)+' · '+escHtml(s.title)+'</div>'+desc+sum+'</div></div>';
  }).join('');
  let actions='';
  if(wf.status==='draft'){
    actions='<button type="button" class="btn sm primary" onclick="workflowStart(\''+wf.id+'\')">开始执行</button><button type="button" class="btn sm ghost danger" onclick="workflowCancel(\''+wf.id+'\')">放弃计划</button>';
  }else if(wf.status==='active'){
    actions='<span class="ai-wf-live">'+icon('refresh','13')+' 步骤执行中…</span><button type="button" class="btn sm ghost danger" onclick="workflowStop(\''+wf.id+'\')">停止</button>';
  }
  return '<div class="ai-wf-card '+wf.status+'" data-wf="'+escAttr(wf.id)+'">'+
    '<div class="ai-wf-head"><span class="ai-wf-ico">'+icon('doc','15')+'</span><span class="ai-wf-label">执行计划</span><span class="ai-wf-status '+st[1]+'">'+st[0]+'</span></div>'+
    '<div class="ai-wf-goal">'+escHtml(wf.goal)+'</div>'+stepsHtml+'<div class="ai-wf-actions">'+actions+'</div></div>';
}
/** 刷新卡片（不重建整条消息） */
function workflowCardRefresh(wfId){
  const wrap=document.querySelector('[data-wf-wrap="'+wfId+'"]');
  if(wrap)wrap.innerHTML=aiWorkflowCardHTML(wfId);
}
/** 开始执行（按钮） */
async function workflowStart(wfId){
  if(_wfRunning){toast('已有执行计划正在运行，请先完成或停止','info');return;}
  const wf=AI.wfFind(wfId);if(!wf)return;
  if(wf.status!=='draft'){toast('计划已不在待确认状态','info');return;}
  if(AI.state.chatting){toast('AI 正在处理其他请求，请稍后再启动执行计划','warning');return;}
  // 定位该计划所属会话的 user 消息 id（引擎 wfCreateDraft 时已记录 wf.chatId，优先沿用；
  // 旧数据缺失时才回退到卡片前最近的 user 消息，用于删除消息时的关联清理）
  const dbChats=(typeof DB!=='undefined'&&Array.isArray(DB.aiChats))?DB.aiChats:[];
  let chatId=wf.chatId||'';
  if(!chatId){
    for(let i=dbChats.length-1;i>=0;i--){const m=dbChats[i];if(!m)continue;if(m.wf&&m.wf.id===wfId)continue;if(m.role==='user'){chatId=m.id;break;}}
  }
  const c=AI.wfConfirm(wfId,chatId);
  if(!c.ok){toast(c.error,'warning');return;}
  workflowCardRefresh(wfId);
  runWorkflowSteps(wfId,chatId);
}
/** 放弃/停止（按钮） */
function workflowCancel(wfId){const wf=AI.wfFind(wfId);if(!wf)return;AI.wfAbort(wfId,'用户放弃','cancelled');workflowCardRefresh(wfId);toast('已放弃该执行计划','success');}
async function workflowStop(wfId){AI.abort();AI.wfAbort(wfId,'用户停止','aborted');workflowCardRefresh(wfId);}
/** 步骤流式渲染节流（串行步骤不会并发，单实例全局计时即可） */
let _stepRenderAt=0,_stepRenderTimer=null;
function workflowStreamRender(stepId,text){
  const doRender=()=>{_stepRenderTimer=null;_stepRenderAt=Date.now();const el=document.querySelector('[data-ai-id="'+stepId+'"]');if(el){const b=el.querySelector('.ai-bubble');if(b)b.innerHTML=renderAIMarkdown(text)+'<span class="ai-cursor">▍</span>';}aiScrollBottom();};
  if(Date.now()-_stepRenderAt>=80)doRender();
  else if(!_stepRenderTimer)_stepRenderTimer=setTimeout(doRender,80);
}
/** 逐步执行主循环：每步创建独立消息气泡 → runWorkflowStep（内部 aiWriteLoop，不开启新聊天）→ 收束 → 自动续跑 */
async function runWorkflowSteps(wfId,chatId){
  _wfRunning=true;_aiActiveWfId=wfId;
  const box=document.getElementById('aiMessages');
  try{
    let guard=0;
    while(guard++<24){
      const wf=AI.wfFind(wfId);
      if(!wf||wf.status!=='active')break;
      // 创建本步骤气泡（流式写入此气泡）
      const stepMsg={id:uid('AI'),role:'assistant',content:'',context:view,timestamp:Date.now(),pending:true,wfStepOf:wfId,wfStepTitle:(wf.current>=0&&wf.steps[wf.current])?wf.steps[wf.current].title:'执行中',wfStepDone:false};
      DB.aiChats.push(stepMsg);if(DB.aiChats.length>50)DB.aiChats=DB.aiChats.slice(-50);
      if(box)box.insertAdjacentHTML('beforeend',aiMessageHTML(stepMsg));
      aiScrollBottom(true);
      const r=await AI.runWorkflowStep(wfId,async(msgs)=>{
        const onConfirm=async(toolCalls)=>{const rr=await confirmOpsModal(toolCalls,null);if(rr&&rr.cancelled&&_aiActiveWfId)AI.wfAbort(_aiActiveWfId,'用户取消写入确认','cancelled');return rr;};
        return AI.aiWriteLoop(msgs,chunk=>{stepMsg.content+=chunk;workflowStreamRender(stepMsg.id,stepMsg.content);saveDBDebounced(600);},onConfirm,chatId,{noWfTools:true});
      });
      const wfNow=AI.wfFind(wfId);
      const stepReal=(wfNow&&wfNow.current>=0&&wfNow.steps[wfNow.current])?wfNow.steps[wfNow.current]:null;
      stepMsg.wfStepDone=!!(r&&r.ok&&!r.error);
      stepMsg.wfStepTitle=(r&&r.ok&&stepReal)?stepReal.title:(stepMsg.wfStepTitle||'');
      stepMsg.pending=false;
      if(!stepMsg.content&&r&&r.result&&r.result.content&&String(r.result.content).trim())stepMsg.content=r.result.content;
      if(!stepMsg.content)stepMsg.content='(步骤已处理)';
      saveDB();
      const el=document.querySelector('[data-ai-id="'+stepMsg.id+'"]');
      if(el)el.outerHTML=aiMessageHTML(stepMsg);
      workflowCardRefresh(wfId);
      if(!r||!r.ok){if(!(wfNow&&(wfNow.status==='cancelled'||wfNow.status==='aborted')))toast((r&&r.error)?r.error:'步骤执行失败','error');break;}
      if(r.finished){toast('执行计划已完成','success');break;}
    }
  }catch(error){
    const errName=error&&error.name==='AbortError';
    const wfCur=AI.wfFind(wfId);
    if(!(wfCur&&(wfCur.status==='cancelled'||wfCur.status==='aborted'))){toast(errName?'已停止执行':'执行计划出错：'+((error&&error.message)||''),errName?'warning':'error');}
    if(errName){const wfNow=AI.wfFind(wfId);if(wfNow&&wfNow.status==='active')AI.wfAbort(wfId,'已停止','aborted');}
    workflowCardRefresh(wfId);
  }finally{
    _wfRunning=false;_aiActiveWfId=null;
    workflowCardRefresh(wfId);
    aiScrollBottom(true);
    setAISendingUI(false);
  }
}
function aiWelcomeHTML(){return '<article class="ai-empty"><span class="ai-empty-icon">'+icon('zap','22')+'</span><strong>开始一段新对话</strong><p>我会依据你确认过的脱敏业务快照，帮助分析订单、利润和应收应付。</p><p style="font-size:13px;color:var(--gray)">当前运行：'+escHtml(AI.runtimeLabel())+'</p></article>';}
function aiScrollBottom(force){const box=document.getElementById('aiMessages');if(!box)return;const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<200;if(force||nearBottom)box.scrollTop=box.scrollHeight;}
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
  openDrawer('AI 助手',body,null,false,true);AI.probeProxy().then(()=>{aiScrollBottom(true);});
  // 后台回复仍在进行时（弹窗中途关过再重开）：发送按钮保持「停止」态并标记忙碌，禁止重复提交
  if(AI.state.chatting)setAISendingUI(true);
}
function aiContextName(){const names={dashboard:'概览',units:'关联单位',specs:'属性管理',bom:'BOM管理',prices:'签约报价',orders:'采购订单',settlements:'对账结算','settle-receipt':'收款记录','settle-payment':'付款记录',invoices:'发票管理','inv-issue':'开票记录','inv-receive':'收票记录',data:'数据管理'};return names[view]||'工作台';}
function refreshAIStatus(){const status=document.getElementById('aiStatus');if(status)status.innerHTML=aiStatusLabel();const button=document.getElementById('aiTopbarBtn');if(button){const hasKey=AI.state.hasKey||!!(AI.state.apiKey&&String(AI.state.apiKey).trim());button.classList.toggle('online',hasKey);button.title=hasKey?('打开 AI 助手（'+AI.runtimeLabel()+'）'):'请先在 AI 设置中填写 API_KEY';}}
function handleAIInputKey(event){
  // 输入法组合中（选词/组词）不触发发送，避免拼音上屏即误发
  if(event.isComposing)return;
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
  // 发送防抖：300ms 窗口内重复触发直接忽略（Enter 连击/快速双击）
  const now=Date.now();
  if(now-(_aiSendGateAt||0)<300)return;
  _aiSendGateAt=now;
  const message=input.value.trim();
  if(!message){input.focus();return;}
  if(message.length>8000){toast('提问过长（'+message.length+' 字），请精简到 8000 字以内再发送','warning');return;} // 输入长度校验
  if(!AI.state.hasKey&&!AI.state.apiKey){toast('请先在 AI 设置中填写 API_KEY（本地模型可留空）','warning');return;}
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
  if(_wfRunning){toast('执行计划正在运行，请先完成或停止后再提问','info');return;}
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
  setAISendingUI(true);
  aiScrollBottom(true);
  let renderScheduled=false;
  // 按 data-ai-id 实时定位气泡渲染：弹窗关闭再打开也能命中新 DOM（旧实现缓存节点，弹窗重建后写入失效节点）
  let _lastRenderAt=0,_lastRenderLen=0,_lastRenderMs=16;
  const renderBubble=()=>{renderScheduled=false;const el=document.querySelector('[data-ai-id="'+liveMsg.id+'"]');const bubble=el?el.querySelector('.ai-bubble'):null;if(bubble){const t0=Date.now();bubble.innerHTML=renderAIMarkdown(liveMsg.content)+'<span class="ai-cursor">▍</span>';_lastRenderMs=Math.max(8,Math.min(500,Date.now()-t0));aiScrollBottom();}};
  // 流式渲染节流：rAF 之上再叠加「距上次渲染≥间隔 或 累计新增≥阈值」双条件。
  // 间隔与累计阈值随上次全量渲染耗时自适应放大：长回答后期单次渲染变慢时自动降低渲染频率，
  // 避免每帧都对全量内容重跑 renderAIMarkdown + innerHTML 重建（O(n²)）导致主线程堆积、界面像卡住
  const scheduleRender=()=>{
    const now=Date.now();
    const len=liveMsg.content.length;
    const minGap=Math.max(80,_lastRenderMs*2);        // 渲染耗时越高，下次渲染间隔越长
    const minGrow=Math.max(240,minGap*6);              // 累积新增字符阈值同步放大
    const due=now-_lastRenderAt>=minGap||len-_lastRenderLen>=minGrow;
    if(!due&&!renderScheduled){setTimeout(scheduleRender,Math.max(20,minGap-(now-_lastRenderAt)));return;}
    if(renderScheduled)return;
    renderScheduled=true;
    const fire=()=>{_lastRenderAt=Date.now();_lastRenderLen=liveMsg.content.length;renderBubble();};
    if(typeof requestAnimationFrame==='function'){requestAnimationFrame(fire);}else{fire();}
  };
  try{
    // 知识库检索：主动检索模式下不自动注入（由模型按需调 query_knowledge 等工具）；
    // 仅当「主动检索」关闭（回退旧模式）或「自动注入兜底」开启时，发请求前注入一次 Top-N
    let kbBlock='';
    try{
      if(typeof KB!=='undefined'){
        if(!KB.state.bound){await KB.init();}
        if(KB.state.bound&&KB.state.enabled){
          KB.ensureFresh(); // 距上次索引超时则后台增量更新，不阻塞本次回答
          if(!KB.state.activeRetrieval||KB.state.autoInjectFallback){
            kbBlock=KB.buildPromptBlock(message);
          }
        }
      }
    }catch(e){console.warn('KB retrieve failed',e);}
    const request=[{role:'system',content:AI.buildSystemPrompt(snapshot)+(kbBlock?'\n\n'+kbBlock:'')}].concat(history,[{role:'user',content:message}]);
    // 统一走写入流程：若模型未调用工具 → aiWriteLoop 返回纯文本总结（兼容只读分析场景）
    // 写入确认被用户取消时：若正处于执行计划运行中，一并中止该计划（步骤无法继续推进）
    const onConfirm=async(toolCalls)=>{
      const rr=await confirmOpsModal(toolCalls,null);
      if(rr&&rr.cancelled&&_aiActiveWfId){AI.wfAbort(_aiActiveWfId,'用户取消写入确认','cancelled');toast('已中止执行计划','info');}
      return rr;
    };
    const res=await AI.aiWriteLoop(request,chunk=>{liveMsg.content+=chunk;scheduleRender();saveDBDebounced(800);},onConfirm,userMessage.id);
    if(renderScheduled)renderBubble();
    if(res.content)liveMsg.content=res.content;      // 以模型最终返回为准
    if(!liveMsg.content)liveMsg.content='(操作已处理)'; // 流式中断时保留已累积内容兜底
    liveMsg.pending=false;
    // 模型发起执行计划：为消息挂 wf 卡（草稿待确认），直接收尾，不产生撤销条
    if(res.wfId){
      liveMsg.wf={id:res.wfId};
      saveDB();
      if(typeof render==='function')render();
      const art=document.querySelector('[data-ai-id="'+liveMsg.id+'"]');
      if(art)art.outerHTML=aiMessageHTML(liveMsg);
      return;
    }
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
    const note=error&&error.name==='AbortError'
      ?((AI.state.abortReason==='timeout'?'请求超时（长时间未收到完整响应）':'已停止生成')+(liveMsg.content?'，以上为已生成部分':'')+'。')
      :'请求失败：'+errMsg+(liveMsg.content?'（以上为已生成部分）':'');
    liveMsg.content=(liveMsg.content?liveMsg.content+'\n\n':'')+note;
    liveMsg.pending=false;
    // 失败/超时/停止都保留原始问题与快照，供「重新提交」按钮一键重发
    liveMsg.retry={text:message,snapshot:snapshot||''};
    liveMsg.retryError=error&&error.name==='AbortError'?(AI.state.abortReason==='timeout'?'响应超时，可重新提交':'已手动停止，可重新提交'):errMsg;
    saveDB();
    const art=document.querySelector('[data-ai-id="'+liveMsg.id+'"]');
    if(art)art.outerHTML=aiMessageHTML(liveMsg);
    toast(note,(error&&error.name==='AbortError')?'warning':'error');
  }finally{setAISendingUI(false);aiScrollBottom();}
}
function stopAIMessage(){AI.abort();}
/** 生成中/结束的 UI 态切换：按钮「停止⇄发送」、composer 忙碌标记；幂等，节点缺失自动跳过 */
function setAISendingUI(on){
  const button=document.getElementById('aiSendBtn');const composer=document.querySelector('.ai-composer');
  if(on){
    if(button){button.textContent='停止';button.onclick=stopAIMessage;}
    if(composer)composer.classList.add('ai-busy');
  }else{
    if(button){button.textContent='发送';button.onclick=requestAISend;}
    if(composer)composer.classList.remove('ai-busy');
  }
}
/** 点击失败/超时消息下的「重新提交」：用原始问题与快照重新走完整发送流程 */
async function retryAIMessage(id){
  const m=(DB.aiChats||[]).find(x=>x.id===id);
  if(!m||!m.retry||!m.retry.text){toast('未找到可重试的原始问题','warning');return;}
  if(AI.state.chatting){toast('AI 正在生成回复，请稍候…','info');return;}
  if(!document.getElementById('aiMessages'))openAIAssistant(); // 弹窗未开时先打开（重开弹窗点击历史按钮场景）
  await sendAIMessage(m.retry.text,m.retry.snapshot||'');
}
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
    // settled 防双 resolve；settle 是唯一出口（onOk/取消/X/遮罩/Esc 兜底全部走它）
    let settled=false;
    const settle=function(val){if(settled)return;settled=true;resolve(val);};
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
      if(!approvedOps.length){settle({cancelled:true,approvedOps:[]});return;}
      settle({cancelled:false,approvedOps});
    },true);
    // 关闭路径统一接管：取消按钮 / X / 全局 Esc（keyboard.js 调 closeModal 移除弹窗但不 resolve）
    // 任何路径关闭都视为取消——否则 aiWriteLoop 永久 await，AI.state.chatting 锁死直到刷新页面
    // v1.x：禁止点击遮罩层关闭 Dialog（防误触取消审批），遮罩点击不再触发 settleCancel
    const mask=document.getElementById('_mask');
    const settleCancel=function(){if(settled)return;settled=true;closeModal();settle({cancelled:true,approvedOps:[]});};
    if(mask){
      const cancelBtn=mask.querySelector('.mf .btn:not(.primary)');
      if(cancelBtn){cancelBtn.onclick=settleCancel;}
      const xBtn=mask.querySelector('.mh .x');
      if(xBtn)xBtn.onclick=settleCancel;
      // Esc 兕底：全局 Esc 走 closeModal() 直接移除 _mask，用 MutationObserver 监听移除后兜底取消
      const app=document.getElementById('app');
      if(app&&typeof MutationObserver==='function'){
        const obs=new MutationObserver(function(){
          if(!document.getElementById('_mask')){obs.disconnect();settleCancel();}
        });
        obs.observe(app,{childList:true});
      }
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
async function clearSavedAIKey(){
  try{await AI.setDeepseekToken('');const i=document.getElementById('aiDeepseekToken');if(i)i.value='';toast('已清除保存的 Key','info');const z=document.getElementById('kbZone');if(z)z.innerHTML=kbrenderZone(KB.summarize());}catch(e){toast('清除失败','error');}
}
async function kbPickFiles(){
  const r=await KB.chooseFiles();
  if(r&&r.cancelled)return;
  const z=document.getElementById('kbZone');if(z)z.innerHTML=kbrenderZone(KB.summarize());
  if(r&&r.ok){toast('批量文件索引完成：成功 '+(r.files||0)+' 个 · '+(r.blocks||0)+' 个分块',r.errors&&r.errors.length?'warning':'success');}
  else{toast((r&&r.error)||'批量选择文件失败','error');}
}
function kbrenderZone(stat){
  if(!stat)return '<p class="note">知识库模块未加载。</p>';
  const s=stat;
  let head='';
  if(s.bound){
    head+='<div class="ai-kb-head"><span class="tag green">已绑定</span> <strong>'+escHtml(s.dirName)+'</strong>'+(s.indexing?' <span class="ai-status warning">● 索引中…</span>':'')+(s.enabled?' <span class="tag blue">检索开启（Top '+s.topN+'）</span>':' <span class="tag">检索关闭</span>')+'</div>'+
      '<div class="note">'+s.files+' 个文件 · '+s.blocks+' 个分块 · 约 '+Math.round(s.chars/1000)+'K 字'+(s.indexedAt?(' · 索引于 '+new Date(s.indexedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):'')+'</div>';
    if(s.error)head+='<div class="ai-status warning">⚠ '+escHtml(s.error)+'</div>';
  }else{
    head='<div class="ai-kb-head"><span class="ai-status warning">● 未绑定知识库目录</span></div><div class="note">绑定一个本地文件夹作为知识库（支持 md/txt/pdf/docx），提问时自动查阅其中的资料；正文留在原目录不动。</div>';
  }
  const actions=s.bound
    ?'<button type="button" class="btn sm" onclick="kbRescan()"'+(s.indexing?' disabled':'')+'>重新索引</button> <button type="button" class="btn sm" onclick="kbPickFiles()"'+(s.indexing?' disabled':'')+'>批量选择文件</button> <button type="button" class="btn sm" onclick="kbUnbind()"'+(s.indexing?' disabled':'')+'>断开</button>'
    :'<button type="button" class="btn sm primary" onclick="kbBindDir()">选择目录并索引</button> <button type="button" class="btn sm" onclick="kbPickFiles()">批量选择文件</button>';
  const dis=(s.bound?'':' disabled');
  const enableRow='<div class="ai-kb-opts">'+
    '<label class="ai-opt"><input type="checkbox" id="kbEnabled" '+(s.enabled?'checked':'')+dis+' onchange="kbSetEnabled(this.checked)"><span>提问时检索知识库</span></label>'+
    (s.bound?'<label class="ai-opt-inline">注入 Top-N <input type="number" id="kbTopN" min="1" max="10" step="1" value="'+s.topN+'" onchange="kbSetTopN(this.value)"></label>':'')+
    '<label class="ai-opt"><input type="checkbox" id="kbCite" '+(s.cite?'checked':'')+dis+' onchange="kbSetCite(this.checked)"><span>回答标注来源</span></label></div>';
  const aiRow='<div class="ai-kb-ai"><div class="note ai-kb-ai-note">AI 主动检索（推荐）：开启后不再自动注入片段，由 AI 在对话中按需调用检索工具，命中更准、省 token。</div><div class="ai-kb-opts">'+
    '<label class="ai-opt"><input type="checkbox" id="kbActiveRetrieval" '+(s.activeRetrieval!==false?'checked':'')+dis+' onchange="kbSetActiveRetrieval(this.checked)"><span>AI 主动检索</span></label>'+
    '<label class="ai-opt"><input type="checkbox" id="kbAutoInjectFallback" '+(s.autoInjectFallback?'checked':'')+dis+' onchange="kbSetAutoInjectFallback(this.checked)"><span>自动注入兜底</span></label></div></div>';
  return head+'<div class="ai-kb-actions">'+actions+'</div>'+enableRow+aiRow;
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
function kbSetActiveRetrieval(v){if(typeof KB!=='undefined'){KB.setActiveRetrieval(v);toast(v?'已开启 AI 主动检索（按需调工具）':'已关闭 AI 主动检索（回退自动注入）','info');}}
function kbSetAutoInjectFallback(v){if(typeof KB!=='undefined'){KB.setAutoInjectFallback(v);toast(v?'已开启自动注入兜底（双保险）':'已关闭自动注入兜底','info');}}

async function openAISettings(){
  const isTauri=AI.state.runtime==='tauri';
  const bodyBuilder=async function(){
    let kbStat=null;
    try{if(typeof KB!=='undefined'){await KB.init();kbStat=KB.summarize();}}catch(e){kbStat=null;}
    const kbZone=kbrenderZone(kbStat);
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
      {label:'本地 oMLX',base:'http://127.0.0.1:8000/v1',model:'Qwen3.5-9B-MLX-4bit'}
    ];
    window._providerPresets=presets;
    window._presetIndexOf=function(url){
      const u=String(url||'').replace(/\/+$/,'');
      return presets.findIndex(function(p){return p.base.replace(/\/+$/,'')===u;});
    };
    // 初始选中态：当前 Base URL 命中预设则高亮
    const presetBtns=presets.map(function(p,i){
      const active=window._presetIndexOf(savedBase)===i;
      return '<button type="button" class="ai-preset-chip'+(active?' active':'')+'" data-i="'+i+'" onclick="applyProviderPreset('+i+')">'+escHtml(p.label)+'</button>';
    }).join('');
    const keyPh=savedKey?'已保存，输入新值覆盖；留空则删除':'粘贴 API_KEY（本地模型可留空）';
    const hostText=(function(){try{return new URL(savedBase).host;}catch(e){return savedBase;}})();
    return '<div class="ai-set-hero">'+
        '<div class="ai-set-hero-main"><div id="aiStatus" class="ai-set-hero-status">'+aiStatusLabel()+'</div><div class="ai-set-hero-model">'+escHtml(savedModel)+'</div><div class="ai-set-hero-host">'+escHtml(hostText)+'</div></div>'+
        '<div class="ai-set-hero-side"><span class="tag '+(isTauri?'green':'blue')+'">'+(isTauri?'桌面版':'浏览器版')+'</span><span class="ai-set-hero-note">API_KEY 仅保存在本机，不会发送给任何第三方</span></div>'+
      '</div>'+
      '<div class="ai-set-hd">模型服务</div>'+
      '<div class="ai-set-card">'+
        '<div class="field"><label class="f">快捷预设</label><div class="ai-preset-row">'+presetBtns+'</div><div class="note">点击自动填入下方地址与模型名，也可手动填写任意 OpenAI 兼容端点。</div></div>'+
        '<div class="field"><label class="f" for="aiBaseUrl">服务地址 Base URL</label><input id="aiBaseUrl" type="text" autocomplete="off" spellcheck="false" placeholder="https://api.deepseek.com/v1" value="'+escAttr(savedBase)+'" oninput="aiEndpointHint()"><div class="note" id="aiEndpointHint"></div></div>'+
        '<div class="field"><label class="f" for="aiModel">模型名称</label><input id="aiModel" type="text" autocomplete="off" spellcheck="false" placeholder="deepseek-v4-flash" value="'+escAttr(savedModel)+'"></div>'+
        '<div class="field" style="margin-bottom:0"><label class="f" for="aiDeepseekToken">API_KEY'+(savedKey?' <button type="button" class="btn sm" style="padding:2px 8px;margin-left:6px" onclick="clearSavedAIKey()">清除 Key</button>':'')+'</label><input id="aiDeepseekToken" type="text" autocomplete="off" spellcheck="false" placeholder="'+escAttr(keyPh)+'" value="'+escAttr(savedKey)+'"><div class="note">'+(savedKey?'已保存 Key（打开弹窗时会自动回显，输入新值覆盖）':'尚未设置')+'；使用本地 Ollama / oMLX 时可留空。</div></div>'+
      '</div>'+
      '<div class="ai-set-hd">知识库 <span class="note">提问时自动查阅本地资料</span></div>'+
      '<div class="ai-set-card"><div id="kbZone">'+kbZone+'</div></div>'+
      '<div class="ai-set-hd ai-set-hd-danger">数据</div>'+
      '<div class="ai-set-danger"><button type="button" class="btn sm danger" onclick="clearAIHistory()">清空对话历史</button><span class="note">删除本机保存的全部 AI 对话记录，不可恢复</span></div>';
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
      AI.setProvider(baseEl?baseEl.value:'',modelEl?modelEl.value:'');
      const baseVal=baseEl?(baseEl.value||'').trim():'';
      if(tokenVal){
        await AI.setDeepseekToken(tokenVal);
        toast('AI 设置已保存','success');
      }else{
        const hasSaved=await AI.getDeepseekToken();
        if(hasSaved){toast('API_KEY 输入为空——已保留原保存的 Key（如需清除请点「清除 Key」）','info');}
        else if(/^https?:\/\/(127\.0\.0\.1|localhost)/.test(baseVal)){
          toast('本地端点未填 API_KEY：Ollama 可直接使用；若为 oMLX，需在 oMLX「设置 → API Key」配置后，在应用内填写相同值','info');
        }else{
          toast('已保存端点/模型，但未填写 API_KEY','warning');
        }
      }
    }catch(e){toast('保存 AI 设置失败：'+(e&&e.message?e.message:e),'error');}
    closeModal();
  },true);
  aiEndpointHint(); // 初始按已保存端点渲染单行动态提示
}
/** 按 Base URL 推断服务商并更新单行动态提示（替代原来一大段固定说明） */
function aiEndpointHint(){
  const hint=document.getElementById('aiEndpointHint');
  if(!hint)return;
  const url=(document.getElementById('aiBaseUrl')||{value:''}).value.trim().replace(/\/+$/,'');
  let txt='自定义 OpenAI 兼容端点，地址需以 /v1 结尾，按服务要求填写 API_KEY。';
  if(/127\.0\.0\.1:\\d+|localhost:\\d+/.test(url)){
    if(/:11434/.test(url))txt='本地 Ollama：API_KEY 可留空，直接保存即可使用。';
    else if(/:8000/.test(url))txt='本地 oMLX：API_KEY 需与 oMLX「设置 → Auth & Info」中的值一致。';
    else txt='本地端点：按该服务的要求填写 API_KEY（允许留空则留空）。';
  }else if(/deepseek/.test(url))txt='DeepSeek 官方端点：在 platform.deepseek.com 创建 API_KEY 后粘贴到下方。';
  else if(/openai\.com/.test(url))txt='OpenAI 官方端点：在 platform.openai.com 创建 API_KEY 后粘贴到下方。';
  else if(/dashscope|aliyuncs/.test(url))txt='通义千问端点：在阿里云百炼控制台创建 API_KEY 后粘贴到下方。';
  hint.textContent=txt;
}
/** 应用端点预设：回填地址与模型 + chips 选中态 + 动态提示刷新 */
function applyProviderPreset(i){
  const p=window._providerPresets&&window._providerPresets[i];
  if(!p)return;
  const b=document.getElementById('aiBaseUrl');const m=document.getElementById('aiModel');
  if(b)b.value=p.base;if(m)m.value=p.model;
  document.querySelectorAll('.ai-preset-chip').forEach(function(ch){ch.classList.toggle('active',String(ch.getAttribute('data-i'))===String(i));});
  aiEndpointHint();
}
function clearAIHistory(){confirmModal('确认清空本机保存的 AI 对话历史？此操作不可恢复。',()=>{DB.aiChats=[];if(typeof AI!=='undefined'&&AI.wfCleanupChat){DB.aiWorkflows=[];saveDB();}else{saveDB();}closeModal();const qs=document.querySelector('.ai-quick-section');if(qs)qs.style.display='';const box=document.getElementById('aiMessages');if(box)box.innerHTML=aiWelcomeHTML();toast('AI 对话历史已清空','success');},'清空历史');}
function deleteAIMessage(id){
  const message=(DB.aiChats||[]).find(item=>item.id===id);if(!message)return;
  confirmModal('确认删除这条 '+(message.role==='user'?'提问':'回复')+' 记录？此操作不可恢复。',()=>{
    DB.aiChats=DB.aiChats.filter(item=>item.id!==id);
    // 删除用户提问或其携带的执行计划卡时，同步清理关联的 DB.aiWorkflows 计划（避免孤儿占用）
    if(typeof AI!=='undefined'&&AI.wfCleanupChat&&typeof DB!=='undefined'&&Array.isArray(DB.aiWorkflows)){
      if(message.role==='user')AI.wfCleanupChat(message.id);
      else if(message.wf&&message.wf.id)DB.aiWorkflows=DB.aiWorkflows.filter(w=>w&&w.id!==message.wf.id);
    }
    saveDB();closeModal();const item=document.querySelector('[data-ai-id="'+id+'"]');if(item)item.remove();const box=document.getElementById('aiMessages');if(box&&!box.children.length){box.innerHTML=aiWelcomeHTML();const qs=document.querySelector('.ai-quick-section');if(qs)qs.style.display='';}toast('对话记录已删除','success');
  },'删除记录');}
