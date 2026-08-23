// ai.js — 可选 AI 增强：脱敏上下文、本地计算、代理通信
const AI=(function(){
  const PROXY_URL='http://127.0.0.1:7842';
  const HISTORY_LIMIT=50;
  const HISTORY_CONTEXT_LIMIT=6;
  const HEALTH_INTERVAL_MS=30000;
  const state={proxyOnline:false,hasKey:false,model:'deepseek-v4-flash',chatting:false,sessionToken:'',abortController:null,healthTimer:0,lastUsage:null};
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
  async function probeProxy(){
    try{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),800);const response=await fetch(PROXY_URL+'/health',{signal:controller.signal});clearTimeout(timer);const data=await response.json();state.proxyOnline=!!data.ok;state.hasKey=!!data.hasKey;state.model=data.model||state.model;}catch(_){state.proxyOnline=false;state.hasKey=false;}
    if(typeof refreshAIStatus==='function')refreshAIStatus();return {online:state.proxyOnline,hasKey:state.hasKey,model:state.model};
  }
  function startHealthCheck(){if(state.healthTimer)return;probeProxy();state.healthTimer=setInterval(probeProxy,HEALTH_INTERVAL_MS);}
  async function chat(messages,onChunk){
    if(!state.sessionToken)throw new Error('请先在 AI 设置中输入本次代理显示的会话访问码');
    state.chatting=true;state.abortController=new AbortController();
    try{const response=await fetch(PROXY_URL+'/chat',{method:'POST',headers:{'Content-Type':'application/json','X-AI-Session':state.sessionToken},body:JSON.stringify({messages,model:state.model,stream:true,max_tokens:1200}),signal:state.abortController.signal});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'AI 请求失败');}
      const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';while(true){const result=await reader.read();if(result.done)break;buffer+=decoder.decode(result.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(line=>{if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;try{const data=JSON.parse(raw);const text=data.choices&&data.choices[0]&&data.choices[0].delta&&data.choices[0].delta.content;if(text)onChunk(text);if(data.usage)state.lastUsage=data.usage;}catch(_){}});}
    }finally{state.chatting=false;state.abortController=null;}
  }
  function abort(){if(state.abortController)state.abortController.abort();}
  function setSessionToken(token){state.sessionToken=(token||'').trim();}
  return {state,QUICK_ACTIONS,probeProxy,startHealthCheck,buildPreview,buildSystemPrompt,getHistory,persistMessage,chat,abort,setSessionToken};
})();
