// ai.js — 可选 AI 增强：脱敏上下文、DeepSeek 直连（Tauri 桌面版走 Rust 命令；浏览器版前端直连，CORS 已实测放行）
const AI=(function(){
  const HISTORY_LIMIT=50;
  const HISTORY_CONTEXT_LIMIT=6;
  const HEALTH_INTERVAL_MS=30000;
  const DEFAULT_MODEL='deepseek-v4-flash';
  const ALLOWED_MODELS=new Set(['deepseek-v4-flash','deepseek-v4-pro']);
  const STREAM_EVENT='ai:deepseek:chunk';
  const WEB_KEY_STORAGE='wb_fastener_ai_key';   // 浏览器形态：API_KEY 存 localStorage
  const WEB_API_URL='https://api.deepseek.com/v1/chat/completions';
  const state={
    runtime:'web',           // 'tauri' | 'web'
    proxyOnline:false,       // 运行通道可达（tauri：Rust 命令；web：已保存 Key）
    hasKey:false,            // 是否已保存 DeepSeek API_KEY
    model:DEFAULT_MODEL,
    chatting:false,
    abortController:null,
    healthTimer:0,
    lastUsage:null,
    // tauri 模式流式接收：事件监听收到的块拼到 chunkBuf 里，最终返回值再取走
    chunkBuf:'',
    // web 模式流式接收：fetch ReadableStream 解析出的完整文本
    webBuf:'',
    removeStreamListener:null
  };
  const _T=window.__TAURI__;
  /** 是否处于 Tauri 桌面运行时 */
  state.runtime=!!(_T&&_T.core&&typeof _T.core.invoke==='function'
    &&_T.event&&typeof _T.event.listen==='function')?'tauri':'web';
  function tauriInvoke(cmd,args){
    if(state.runtime!=='tauri')return Promise.reject(new Error('非 Tauri 运行时'));
    return _T.core.invoke(cmd,args||{});
  }
  function tauriListen(evt,cb){
    if(state.runtime!=='tauri')return ()=>{};
    let released=false;
    let unsub=null;
    _T.event.listen(evt,function(e){if(!released&&cb)cb(e);});
    return function(){
      if(released)return;released=true;
      if(unsub&&typeof unsub==='function'){try{unsub();}catch(_){}}
    };
  }

  const QUICK_ACTIONS=[
    {id:'summary',label:'经营总结',prompt:'请根据以下数据生成本月经营总结，包括销售额、利润、回款率、客户活跃度和待办事项。'},
    {id:'collection',label:'催款建议',prompt:'请分析所有应收未收款项，按紧急程度排序，给出催款优先级和建议。'},
    {id:'compare',label:'比价分析',prompt:'请分析所有供应商的报价数据，找出各规格性价比最高的供应商。'},
    {id:'customer',label:'客户分析',prompt:'请分析所有客户的交易频次、累计金额和毛利率，给出客户分级建议。'},
    {id:'wording',label:'话术生成',prompt:'请为有未收款项的客户生成催款微信消息，语气友好但坚定。'},
    {id:'profit',label:'利润分析',prompt:'请分析所有已完成订单的利润情况，找出最赚钱和最不赚钱的单子。'},
    {id:'ask',label:'任意提问',prompt:''}
  ];
  function money(value){return '¥'+Number(value||0).toLocaleString('zh-CN',{maximumFractionDigits:2});}
  function unitName(id){const unit=DB.units.find(item=>item.id===id);return unit?unit.name:(id||'未指定');}
  function activeOrders(){return (DB.orders||[]).filter(order=>!['未成交','取消'].includes(order.status));}
  function settlementTotal(type,unitId){return (DB.settlements||[]).filter(item=>item.type===type&&item.unitId===unitId).reduce((sum,item)=>sum+Number(item.amount||0),0);}
  function orderRow(order){const sales=orderSales(order);const cost=orderCost(order);return {id:order.id,buyer:unitName(order.buyerId),status:order.status,sales,cost,profit:sales-cost,date:order.deliveryDate||order.createdAt||''};}
  function extractOverview(){
    const orders=activeOrders().map(orderRow);const sales=orders.reduce((sum,item)=>sum+item.sales,0);const cost=orders.reduce((sum,item)=>sum+item.cost,0);
    const receivables=(typeof settleReceiptData==='function'?settleReceiptData():[]).map(item=>({name:item.unitName,balance:item.totalReceivable-item.totalReceived})).filter(item=>item.balance>0);
    const payables=(typeof settlePaymentData==='function'?settlePaymentData():[]).map(item=>({name:item.unitName,balance:item.totalPayable-item.totalPaid})).filter(item=>item.balance>0);
    const byStatus=(DB.orders||[]).reduce((map,item)=>{map[item.status]=(map[item.status]||0)+1;return map;},{});
    const margin=sales?((sales-cost)/sales*100).toFixed(1):'0.0';
    return {orders,sales,cost,profit:sales-cost,margin,receivables,payables,byStatus};
  }
  function extractPageContext(){
    const names={dashboard:'概览',units:'关联单位',specs:'属性管理',bom:'BOM管理',prices:'签约报价',orders:'采购订单',settlements:'对账结算','settle-receipt':'收款记录','settle-payment':'付款记录',invoices:'发票管理','inv-issue':'开票记录','inv-receive':'收票记录',data:'数据管理'};
    if(view==='orders'&&(curOrder||curOrderView)){
      const order=curOrder||DB.orders.find(item=>item.id===curOrderView);if(order){const row=orderRow(order);return '【当前页面：订单详情】\n'+row.id+' | '+row.buyer+' | '+row.status+' | 销售 '+money(row.sales)+' | 成本 '+money(row.cost)+' | 利润 '+money(row.profit)+'\n产品：'+(order.items||[]).map(item=>(item.sku||item.name||'未命名')+' × '+Number(item.qty||0)).join('；');}
    }
    if(view==='orders')return '【当前页面：采购订单列表】\n'+activeOrders().slice(0,8).map(order=>{const row=orderRow(order);return row.id+' | '+row.buyer+' | '+row.status+' | '+money(row.sales);}).join('\n');
    if(view==='units')return '【当前页面：关联单位】\n'+(DB.units||[]).slice(0,12).map(item=>item.name+' | '+(item.roles||[]).join('/')+' | '+(item.rating||'未评级')).join('\n');
    if(view==='prices')return '【当前页面：签约报价】\n'+(DB.prices||[]).slice(0,12).map(item=>(item.type||'')+' '+(item.diameter||'')+' | '+unitName(item.unitId)+' | '+money(item.price)).join('\n');
    return '【当前页面：'+(names[view]||'工作台')+'】';
  }
  function extractByKeywords(message,overview){
    const text=message||'';const blocks=[];
    if(/催款|应收|未收|回款/.test(text))blocks.push('【应收未收】\n'+overview.receivables.slice(0,10).map(item=>item.name+' 未收 '+money(item.balance)).join('\n'));
    if(/供应商|比价|采购/.test(text))blocks.push('【供应商报价】\n'+(DB.prices||[]).slice(0,20).map(item=>(item.type||'')+' '+(item.standard||'')+' '+(item.diameter||'')+' | '+unitName(item.unitId)+' | '+money(item.price)).join('\n'));
    if(/利润|赚|亏/.test(text))blocks.push('【订单利润排行】\n'+overview.orders.slice().sort((a,b)=>b.profit-a.profit).slice(0,8).map(item=>item.id+' '+item.buyer+' 利润 '+money(item.profit)).join('\n'));
    const entity=(DB.units||[]).find(item=>item.name&&text.includes(item.name));
    if(entity)blocks.push('【命中单位】\n'+entity.name+' | 角色：'+(entity.roles||[]).join('/')+' | 评级：'+(entity.rating||'未评级'));
    return blocks.filter(Boolean).join('\n\n');
  }
  function buildPreview(message){
    const overview=extractOverview();const status=Object.keys(overview.byStatus).map(key=>key+' '+overview.byStatus[key]+'笔').join(' / ');
    const base='【经营概况】\n订单：'+(DB.orders||[]).length+'笔（'+status+'）\n销售额：'+money(overview.sales)+' | 采购成本：'+money(overview.cost)+' | 利润：'+money(overview.profit)+'（毛利率 '+overview.margin+'%）\n应收未收：'+money(overview.receivables.reduce((sum,item)=>sum+item.balance,0))+'（'+overview.receivables.length+'家） | 应付未付：'+money(overview.payables.reduce((sum,item)=>sum+item.balance,0))+'（'+overview.payables.length+'家）\n客户/供应商：'+(DB.units||[]).filter(item=>(item.roles||[]).includes('采购商')).length+'/'+(DB.units||[]).filter(item=>(item.roles||[]).includes('供应商')).length;
    return [base,extractPageContext(),extractByKeywords(message,overview)].filter(Boolean).join('\n\n');
  }
  function buildSystemPrompt(snapshot){return '你是紧固件贸易助手。仅依据下方经过脱敏与本地计算的数据快照进行解释、总结、排序和话术生成；数据缺失时明确说明，禁止补造。金额、利润、余额和排名以本地结果为准，不要自行重算。金额使用¥与千分位，日期使用 YYYY-MM-DD。分析结论用简洁的 Markdown；催款话术用引用块。\n\n'+snapshot;}
  function getHistory(){return (DB.aiChats||[]).slice(-HISTORY_CONTEXT_LIMIT).map(item=>({role:item.role,content:item.content}));}
  function persistMessage(role,content,snapshot){const message={id:uid('AI'),role,content,context:view,timestamp:Date.now(),snapshot:snapshot||''};DB.aiChats=DB.aiChats||[];DB.aiChats.push(message);DB.aiChats=DB.aiChats.slice(-HISTORY_LIMIT);saveDB();return message;}
  function setModel(m){if(ALLOWED_MODELS.has(m))state.model=m;else state.model=DEFAULT_MODEL;}
  function webHasKey(){return !!((localStorage.getItem(WEB_KEY_STORAGE)||'').trim());}

  /** 健康检查：tauri 检查 Rust 通道与 Token 文件；web 检查本地保存的 Key */
  async function probeProxy(){
    if(state.runtime==='tauri'){
      try{
        const has=await tauriInvoke('ai_deepseek_token_has');
        state.proxyOnline=true;
        state.hasKey=!!has;
      }catch(e){state.proxyOnline=false;state.hasKey=false;}
    }else{
      state.hasKey=webHasKey();
      state.proxyOnline=state.hasKey;
    }
    if(typeof refreshAIStatus==='function')refreshAIStatus();return {runtime:state.runtime,online:state.proxyOnline,hasKey:state.hasKey,model:state.model};
  }
  function startHealthCheck(){if(state.healthTimer)return;probeProxy();state.healthTimer=setInterval(probeProxy,HEALTH_INTERVAL_MS);}
  function runtimeLabel(){return state.runtime==='tauri'?'桌面版（AI 直连 DeepSeek）':'浏览器（AI 直连 DeepSeek）';}

  /** Tauri 流式监听：把 Rust emit 来的 text 追加进 chunkBuf 并回调 onChunk */
  function _ensureStreamListener(onChunk){
    _cleanupStreamListener();
    state.chunkBuf='';
    state.removeStreamListener=tauriListen(STREAM_EVENT,function(ev){
      const payload=ev&&ev.payload;
      const text=payload&&payload.text;
      if(typeof text==='string'&&text){
        state.chunkBuf+=text;
        if(onChunk)try{onChunk(text);}catch(_){}
      }
    });
  }
  function _cleanupStreamListener(){
    if(state.removeStreamListener){try{state.removeStreamListener();}catch(_){}}
    state.removeStreamListener=null;
  }

  /** 浏览器形态：前端直连 DeepSeek（CORS 已实测放行，含 file:// 的 null origin），SSE 流式解析 */
  async function webChat(messages,onChunk,signal){
    const key=(localStorage.getItem(WEB_KEY_STORAGE)||'').trim();
    if(!key)throw new Error('请先在 AI 设置中填写 DeepSeek API_KEY');
    state.webBuf='';
    const res=await fetch(WEB_API_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'Accept':'text/event-stream'},
      body:JSON.stringify({
        model:state.model,
        messages:messages.map(function(m){return {role:m.role,content:String(m.content||'')};}),
        stream:true,
        temperature:0.3,
        max_tokens:1200
      }),
      signal:signal
    });
    if(!res.ok){
      let detail='';
      try{const j=await res.json();detail=(j&&j.error&&j.error.message)?j.error.message:'';}catch(_){}
      throw new Error('DeepSeek 返回错误 (HTTP '+res.status+')'+(detail?'：'+detail:''));
    }
    if(!res.body||!res.body.getReader)throw new Error('当前浏览器不支持流式响应');
    const reader=res.body.getReader();const decoder=new TextDecoder();let buffer='';
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      let idx;
      while((idx=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,idx).trim();buffer=buffer.slice(idx+1);
        if(!line.startsWith('data:'))continue;
        const raw=line.slice(5).trim();
        if(!raw||raw==='[DONE]')continue;
        try{
          const j=JSON.parse(raw);
          const text=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content;
          if(typeof text==='string'&&text){
            state.webBuf+=text;
            if(onChunk)try{onChunk(text);}catch(_){}
          }
        }catch(_){}
      }
    }
    return state.webBuf;
  }

  async function chat(messages,onChunk){
    if(!ALLOWED_MODELS.has(state.model))state.model=DEFAULT_MODEL;
    state.chatting=true;
    state.abortController=null;
    try{
      if(state.runtime==='tauri'){
        _ensureStreamListener(onChunk);
        try{
          const full=await tauriInvoke('ai_deepseek_chat',{
            messages:messages.map(function(m){return {role:m.role,content:String(m.content||'')};}),
            model:state.model,
            stream:true,
            temperature:0.3,
            max_tokens:1200,
            streamEvent:STREAM_EVENT
          });
          // Rust 返回最终完整文本；若事件接收比最终返回慢，用最终文本兜底补齐
          if(typeof full==='string'&&full.length>state.chunkBuf.length&&onChunk){
            onChunk(full.slice(state.chunkBuf.length));
            state.chunkBuf=full;
          }
          return state.chunkBuf;
        }finally{_cleanupStreamListener();}
      }
      // 浏览器形态：前端直连 DeepSeek，AbortController 真正可取消
      const controller=new AbortController();
      state.abortController=controller;
      try{return await webChat(messages,onChunk,controller.signal);}
      finally{state.abortController=null;}
    }finally{state.chatting=false;state.abortController=null;}
  }
  function abort(){if(state.abortController)state.abortController.abort();}

  /** 保存/删除 API Key：tauri → 应用数据目录文件；web → localStorage（空串删除） */
  async function setDeepseekToken(raw){
    const token=String(raw||'').trim();
    if(state.runtime==='tauri'){
      await tauriInvoke('ai_deepseek_token_write',{token:token});
    }else{
      if(token)localStorage.setItem(WEB_KEY_STORAGE,token);
      else localStorage.removeItem(WEB_KEY_STORAGE);
    }
    state.hasKey=!!token;
    if(typeof refreshAIStatus==='function')refreshAIStatus();
  }
  async function getDeepseekTokenDraft(){
    if(state.runtime==='tauri'){
      const has=await tauriInvoke('ai_deepseek_token_has');
      return has?'(已保存，不可读取明文)':'';
    }
    return webHasKey()?'(已保存，不可读取明文)':'';
  }

  return {
    state,runtimeLabel,QUICK_ACTIONS,ALLOWED_MODELS,DEFAULT_MODEL,
    probeProxy,startHealthCheck,buildPreview,buildSystemPrompt,getHistory,persistMessage,
    chat,abort,setModel,setDeepseekToken,getDeepseekTokenDraft
  };
})();
