// ai.js — 可选 AI 增强：脱敏上下文、DeepSeek 直连（Tauri 桌面版走 Rust 命令；浏览器版前端直连，CORS 已实测放行）
const AI=(function(){
  const HISTORY_LIMIT=50;
  const HISTORY_CONTEXT_LIMIT=20;   // 携带更多历史上下文（超长时自动压缩）
  const HISTORY_CONTEXT_CHARS=20000; // 上下文总字符阈值，超过触发一次压缩
  const HEALTH_INTERVAL_MS=30000;
  const DEFAULT_MODEL='deepseek-v4-flash';
  // 预置推荐模型（不强制限制，设置中可自定义任意 OpenAI 兼容模型名）
  const PRESET_MODELS=['deepseek-v4-flash','deepseek-v4-pro','gpt-4o-mini','gpt-4o','qwen-plus','glm-4-flash','llama3','qwen2.5'];
  const ALLOWED_MODELS=new Set(PRESET_MODELS);
  const DEFAULT_BASE_URL='https://api.deepseek.com/v1';   // OpenAI 兼容端点，可在设置中修改（如 Ollama http://127.0.0.1:11434/v1）
  const STREAM_EVENT='ai:deepseek:chunk';
  const WEB_KEY_STORAGE='wb_fastener_ai_key';   // 浏览器形态：API_KEY 存 localStorage
  const WEB_API_URL=DEFAULT_BASE_URL+'/chat/completions';   // 默认端点（可配置）
  const WEB_BASE_STORAGE='wb_fastener_ai_base';   // Base URL 存 localStorage
  const WEB_MODEL_STORAGE='wb_fastener_ai_model'; // 模型名存 localStorage
  const state={
    runtime:'web',           // 'tauri' | 'web'
    proxyOnline:false,       // 运行通道可达（tauri：Rust 命令；web：已保存 Key）
    hasKey:false,            // 是否已保存 DeepSeek API_KEY
    model:DEFAULT_MODEL,
    baseUrl:DEFAULT_BASE_URL,
    chatting:false,
    abortController:null,
    healthTimer:0,
    lastUsage:null,
    // tauri 模式流式接收：事件监听收到的块拼到 chunkBuf 里，最终返回值再取走
    chunkBuf:'',
    // web 模式流式接收：fetch ReadableStream 解析出的完整文本
    webBuf:'',
    // web 模式 tool_calls 增量累积槽（按 index 累积，流结束解析为最终数组）
    webToolAcc:[],
    // tauri 模式 tool_calls 增量累积槽（事件监听累积，invoke 返回后解析）
    tauriToolAcc:[],
    removeStreamListener:null
  };
  // 恢复多模型配置（浏览器与 Tauri 均用 localStorage；Tauri 版 API_KEY 仍在应用数据目录）
  try{
    const _b=localStorage.getItem(WEB_BASE_STORAGE);
    if(_b&&String(_b).trim())state.baseUrl=String(_b).trim().replace(/\/+$/,'');
    const _m=localStorage.getItem(WEB_MODEL_STORAGE);
    if(_m&&String(_m).trim())state.model=String(_m).trim();
  }catch(e){}
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
  function buildPreview(message,extra){
    const overview=extractOverview();const status=Object.keys(overview.byStatus).map(key=>key+' '+overview.byStatus[key]+'笔').join(' / ');
    const base='【经营概况】\n订单：'+(DB.orders||[]).length+'笔（'+status+'）\n销售额：'+money(overview.sales)+' | 采购成本：'+money(overview.cost)+' | 利润：'+money(overview.profit)+'（毛利率 '+overview.margin+'%）\n应收未收：'+money(overview.receivables.reduce((sum,item)=>sum+item.balance,0))+'（'+overview.receivables.length+'家） | 应付未付：'+money(overview.payables.reduce((sum,item)=>sum+item.balance,0))+'（'+overview.payables.length+'家）\n客户/供应商：'+(DB.units||[]).filter(item=>(item.roles||[]).includes('采购商')).length+'/'+(DB.units||[]).filter(item=>(item.roles||[]).includes('供应商')).length;
    return [base,extractPageContext(),extractByKeywords(message,overview),extra].filter(Boolean).join('\n\n');
  }
  function buildSystemPrompt(snapshot){
    return '你是紧固件贸易工作台的助手，既是数据助理也是系统操作顾问。可调用写入工具起草对单位/报价/订单等数据的修改，可调用查询工具（query_*）读取脱敏数据，可调用功能层工具（navigate_view/export_order_excel/open_settlement_drawer/open_invoice_drawer/open_unit_form/open_order_form/open_price_form/open_bom_form）触发视图导航、Excel 导出、打开抽屉、打开业务表单等 UI 动作，也可基于脱敏快照做只读分析与建议。\n\n'+
      '【系统操作指引】（用户询问"怎么操作/怎么做/不会操作"等问题时，优先用功能层工具直接代做；无法代做的给出简明步骤）\n'+
      'A. 关联单位：侧栏「关联单位」→ 搜索/筛选/新建（右上角按钮）→ 表单填名称/角色/账期/联系人/开票信息 → 保存。可用 open_unit_form 代开新建表单。\n'+
      'B. 属性管理：侧栏「属性管理」→ 六个维度（类型/标准/直径/硬度/表面处理/材质）增删枚举值；被引用的枚举值禁止删除。\n'+
      'C. BOM管理：侧栏「BOM管理」→ 新建 BOM（SKU/名称/规格/六属性）或批量粘贴导入。可用 open_bom_form 代开表单。\n'+
      'D. 签约报价：侧栏「签约报价」→ 新建报价（供应商/六属性/单价/有效期）→ 保存。可用 open_price_form 代开表单；也可让 AI 直接起草批量报价（需确认）。\n'+
      'E. 采购订单：侧栏「采购订单」→ 新建订单（采购商/交货期/产品明细）→ 订单详情内「寻货」分配供应商（价格库匹配或手动录入）→ 状态按流转规则推进。可用 open_order_form 代开表单；AI 可直接起草订单/明细/寻货/流转。\n'+
      'F. 对账结算：侧栏「对账结算」→ 收款/付款记录 → 新建结算（关联订单自动汇总金额）→ 提交。\n'+
      'G. 发票管理：侧栏「发票管理」→ 开票/收票记录（由结算同步生成，可编辑金额/日期/备注）。\n'+
      'H. 数据管理：侧栏「数据管理」→ 备份导出/导入 JSON、本地文件同步（推荐绑定）、操作历史（AI 操作记录可回滚）、回收站（删除记录恢复/彻底删除）。\n'+
      'I. 通用：Excel 导出（订单详情内导出按钮，AI 可代触发 export_order_excel）；视图导航用 navigate_view；本系统浏览器版与桌面版功能一致。\n\n'+
      '【硬性规则】\n'+
      '1. 写入类工具调用是**提案**，前端将要求用户逐条确认，不会自动执行；不要在 content 中假装操作已完成，应用「我将起草…」语气。查询类（query_*）和功能层（navigate_view 等）工具会立即执行，不需要用户确认。\n'+
      '2. 金额、利润、余额、排名一律以本地快照为准，不要自行重算或编造数字。\n'+
      '3. 状态流转必须守 STATUS_FLOW（待确认 → 寻货中 → 报价中 → 签约完成 → 送货中 → 完成）；只能前进到下一站，或转入「异常」「取消」终态分支；「未成交」是从「报价中」分支出的状态，可恢复回「报价中」；终态（完成/异常/取消）不可再流转。\n'+
      '4. 联系人电话、税号、银行账号、地址等信息：直接取自用户对话内容，用户提供即可填入 create_unit 参数（contactName/phone/taxId/address/bank/accountNo）；未提供的字段省略。\n'+
      '5. 仍依据下方脱敏快照理解上下文，数据缺失时明确说明「未在快照中找到」，禁止补造不存在的单位/订单 ID。\n'+
      '6. 一条 tool_call 只起草一次操作；多个独立操作可并行起草（多个 tool_calls），但同一条记录不要在同一轮中既修改又删除。\n'+
      '7. 金额使用 ¥ 与千分位，日期使用 YYYY-MM-DD，分析结论用简洁 Markdown。\n'+
      '8. 功能层工具参数中的 ID 必须来自快照或前序查询结果，禁止凭空编造；调用 navigate_view 时若无 orderId，仅填 viewName 即可。\n'+
      '9. 用户询问系统使用/操作问题（"怎么操作/怎么做/如何使用/在哪/能不能"等）时：先调用 query_help 检索完整帮助知识库，再结合上方指引回答；能直接代做的（导航/导出/打开表单/打开抽屉）同时调用对应功能层工具。\n\n'+
      snapshot;
  }
  function getHistory(){return (DB.aiChats||[]).slice(-HISTORY_CONTEXT_LIMIT).map(item=>({role:item.role,content:item.content}));}

  /** 上下文压缩：把历史对话交给模型生成结构化摘要（无工具、纯文本请求）
   *  - 触发：aiWriteLoop 首轮前，messages 总字符超 HISTORY_CONTEXT_CHARS
   *  - 失败（网络/超时）返回 null，调用方降级为截断最近 6 条
   *  - 摘要请求自身不走 aiWriteLoop，不会递归触发压缩
   */
  async function compressContext(messages){
    try{
      const text=messages.filter(m=>m.role!=='system').map(function(m){
        return (m.role==='user'?'用户：':'AI：')+String(m.content||'');
      }).join('\n\n').slice(-30000);
      if(!text.trim())return null;
      const res=await chat([
        {role:'system',content:'你是紧固件贸易助手。请将以下对话历史压缩为结构化中文摘要：保留涉及的单位/订单/报价/规格/金额等关键实体与数据、已完成的决策与操作、未完成事项与用户意图；不要遗漏重要数字；直接输出摘要正文，不要任何说明前缀。'},
        {role:'user',content:text}
      ],null,{tools:[]});
      const sum=(res&&res.content?String(res.content):'').trim();
      return sum.length>50?sum:null;
    }catch(e){
      console.warn('上下文压缩失败，降级为截断:',e);
      return null;
    }
  }
  function persistMessage(role,content,snapshot){const message={id:uid('AI'),role,content,context:view,timestamp:Date.now(),snapshot:snapshot||''};DB.aiChats=DB.aiChats||[];DB.aiChats.push(message);DB.aiChats=DB.aiChats.slice(-HISTORY_LIMIT);saveDB();return message;}
  function setModel(m){if(m&&String(m).trim())state.model=String(m).trim();else state.model=DEFAULT_MODEL;}
  /** 多模型接入：设置 Base URL 与模型名（OpenAI 兼容；本地 Ollama 可留空 API_KEY） */
  function setProvider(baseUrl,model){
    const b=baseUrl&&String(baseUrl).trim()?String(baseUrl).trim().replace(/\/+$/,''):'';
    if(b&&!/^https?:\/\//.test(b))throw new Error('Base URL 需以 http:// 或 https:// 开头');
    if(b){state.baseUrl=b;try{localStorage.setItem(WEB_BASE_STORAGE,b);}catch(e){}}
    else{state.baseUrl=DEFAULT_BASE_URL;try{localStorage.removeItem(WEB_BASE_STORAGE);}catch(e){}}
    const m=model&&String(model).trim()?String(model).trim():'';
    if(m){state.model=m;try{localStorage.setItem(WEB_MODEL_STORAGE,m);}catch(e){}}
    else{state.model=DEFAULT_MODEL;try{localStorage.removeItem(WEB_MODEL_STORAGE);}catch(e){}}
    if(typeof refreshAIStatus==='function')refreshAIStatus();
  }
  function apiChatUrl(){const b=(state.baseUrl||DEFAULT_BASE_URL).replace(/\/+$/,'');return b.endsWith('/chat/completions')?b:b+'/chat/completions';}
  function webHasKey(){return !!((localStorage.getItem(WEB_KEY_STORAGE)||'').trim());}

  /** 健康检查：tauri 检查 Rust 通道与 Token 文件；web 检查本地保存的 Key */
  async function probeProxy(){
    if(state.runtime==='tauri'){
      // 本地端点（Ollama 等）免 Token；其余端点检查 Token 文件
      const localBase=/^https?:\/\/(127\.0\.0\.1|localhost)/.test(state.baseUrl||'');
      try{
        const has=await tauriInvoke('ai_deepseek_token_has');
        state.proxyOnline=true;
        state.hasKey=localBase||!!has;
      }catch(e){state.proxyOnline=localBase;state.hasKey=localBase;}
    }else{
      // 本地端点（Ollama 等）无需 API_KEY 也可用
      state.hasKey=webHasKey()||/^https?:\/\/(127\.0\.0\.1|localhost)/.test(state.baseUrl||'');
      state.proxyOnline=state.hasKey;
    }
    if(typeof refreshAIStatus==='function')refreshAIStatus();return {runtime:state.runtime,online:state.proxyOnline,hasKey:state.hasKey,model:state.model};
  }
  function startHealthCheck(){if(state.healthTimer)return;probeProxy();state.healthTimer=setInterval(probeProxy,HEALTH_INTERVAL_MS);}
  /** 端点显示名（按 baseUrl 域名识别，本地端点单列） */
  function providerLabel(){
    const b=state.baseUrl||DEFAULT_BASE_URL;
    if(/^https?:\/\/(127\.0\.0\.1|localhost)/.test(b))return '本地模型';
    const m=b.match(/^https?:\/\/([^\/]+)/);const host=m?m[1]:'';
    if(/deepseek/.test(host))return 'DeepSeek';
    if(/openai\.com/.test(host))return 'OpenAI';
    if(/dashscope|aliyuncs/.test(host))return '通义千问';
    if(/bigmodel|zhipuai/.test(host))return '智谱';
    return host||'自定义';
  }
  function runtimeLabel(){const p=providerLabel();return state.runtime==='tauri'?('桌面版（AI · '+p+'）'):('浏览器（AI · '+p+'）');}

  /** Tauri 流式监听：把 Rust emit 来的 text 追加进 chunkBuf 并回调 onChunk；
   *  Rust 侧（lib.rs）已把 tool_calls delta 按 OpenAI 结构透传（{"text":"","toolCalls":[...]}），
   *  此处同步累积进 tauriToolAcc，invoke 返回后解析为最终数组
   */
  function _ensureStreamListener(onChunk){
    _cleanupStreamListener();
    state.chunkBuf='';
    state.tauriToolAcc=[];  // tool_calls 累积槽：按 index 累积（与 webToolAcc 同构）
    state.removeStreamListener=tauriListen(STREAM_EVENT,function(ev){
      const payload=ev&&ev.payload;
      if(!payload)return;
      const text=payload.text;
      if(typeof text==='string'&&text){
        state.chunkBuf+=text;
        if(onChunk)try{onChunk(text);}catch(_){}
      }
      // 工具调用增量：Rust 透传的 tool_calls delta（text 恒为空串，单独处理）
      if(Array.isArray(payload.toolCalls)){
        payload.toolCalls.forEach(function(tc){_accumToolDelta(state.tauriToolAcc,tc);});
      }
    });
  }
  function _cleanupStreamListener(){
    if(state.removeStreamListener){try{state.removeStreamListener();}catch(_){}}
    state.removeStreamListener=null;
  }

  /** 工具调用增量累积：把单条 tool_calls delta 合并进累积槽（按 index，OpenAI 流式分段结构） */
  function _accumToolDelta(acc,tc){
    const i=tc.index||0;
    const slot=acc[i]||(acc[i]={index:i,id:'',name:'',argsStr:''});
    if(tc.id)slot.id=tc.id;
    if(tc.function){
      if(tc.function.name)slot.name=tc.function.name;
      if(tc.function.arguments)slot.argsStr+=tc.function.arguments;
    }
  }
  /** 累积槽 → 最终 toolCalls 数组（argsStr 容错解析：修复尾随逗号后仍失败则置空对象） */
  function _finalizeToolCalls(acc){
    const toolCalls=[];
    for(let i=0;i<acc.length;i++){
      const slot=acc[i];
      if(!slot||!slot.name)continue;
      let args=null;
      if(slot.argsStr){
        try{args=JSON.parse(slot.argsStr);}
        catch(e){
          try{args=JSON.parse(slot.argsStr.replace(/,\s*([}\]])/g,'$1'));}
          catch(e2){args=null;}
        }
      }
      toolCalls.push({id:slot.id,name:slot.name,args:args||{}});
    }
    return toolCalls;
  }

  /** 浏览器形态：前端直连 DeepSeek（CORS 已实测放行，含 file:// 的 null origin），SSE 流式解析
   *  v0.2 升级：同时解析 content delta（给对话区流式显示）与 tool_calls delta（按 index 累积，不显示）
   *  返回值：{content:string, toolCalls:array} —— 调用方按需消费
   *  options.tools 提供 → 透传给 DeepSeek（OpenAI 兼容 function calling）；缺省 → 仅返回 content
   */
  async function webChat(messages,onChunk,signal,options){
    const key=(localStorage.getItem(WEB_KEY_STORAGE)||'').trim();
    const localBase=/^https?:\/\/(127\.0\.0\.1|localhost)/.test(state.baseUrl||'');
    if(!key&&!localBase)throw new Error('请先在 AI 设置中填写 API_KEY（本地 Ollama 可留空）');
    state.webBuf='';
    state.webToolAcc=[];  // tool_calls 累积槽：按 index 累积 {index,id,name,argsStr}
    const reqBody={
      model:state.model,
      messages:messages.map(function(m){
        // 协议透传：tool 消息带 tool_call_id；assistant 工具调用消息带 tool_calls（缺一即 400）
        const out={role:m.role,content:String(m.content||'')};
        if(m.tool_call_id)out.tool_call_id=m.tool_call_id;
        if(m.tool_calls)out.tool_calls=m.tool_calls;
        return out;
      }),
      stream:true,
      temperature:0.3,
      max_tokens:1200
    };
    if(options&&Array.isArray(options.tools)&&options.tools.length){
      reqBody.tools=options.tools;
      // tool_choice 默认 auto：让模型自主决定是否调用工具，避免强制调用导致纯分析场景失败
    }
    let res;
    try{
      res=await fetch(apiChatUrl(),{
        method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'Accept':'text/event-stream'},
      body:JSON.stringify(reqBody),
        signal:signal
      });
    }catch(err){
      throw new Error('无法连接模型服务（'+apiChatUrl()+'）：'+(err&&err.message?err.message:JSON.stringify(err)));
    }
    if(!res.ok){
      let detail='';
      try{const j=await res.json();detail=(j&&j.error&&j.error.message)?j.error.message:'';}catch(_){}
      if(!detail){try{detail=(await res.text()).slice(0,200);}catch(_){detail='';}}
      throw new Error(providerLabel()+' 返回错误 (HTTP '+res.status+(detail?')：'+detail:')'));
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
        if(!line.startsWith('data:')){
          if(!state.webBuf){
            try{
              const j=JSON.parse(line);
              const ch=j.choices&&j.choices[0];
              const text=ch&&(ch.message?ch.message.content:(ch.delta?ch.delta.content:null));
              if(typeof text==='string'&&text){state.webBuf+=text;if(onChunk)try{onChunk(text);}catch(_){}}
            }catch(_){}
          }
          continue;
        }
        const raw=line.slice(5).trim();
        if(!raw||raw==='[DONE]')continue;
        try{
          const j=JSON.parse(raw);
          const delta=j.choices&&j.choices[0]&&j.choices[0].delta;
          if(!delta)continue;
          // 1) content delta：照常给对话区流式显示
          if(typeof delta.content==='string'&&delta.content){
            state.webBuf+=delta.content;
            if(onChunk)try{onChunk(delta.content);}catch(_){}
          }
          // 2) tool_calls delta：按 index 累积，不显示
          if(Array.isArray(delta.tool_calls)){
            delta.tool_calls.forEach(function(tc){_accumToolDelta(state.webToolAcc,tc);});
          }
        }catch(_){}
      }
    }
    // 流结束：tool_calls 累积槽 → 解析为最终数组（argsStr 容错解析）
    return {content:state.webBuf,toolCalls:_finalizeToolCalls(state.webToolAcc)};
  }

  /** 单次对话入口（兼容只读与带工具两种模式）
   *  参数：messages, onChunk, options?（含 tools 数组）
   *  返回：{content:string, toolCalls:array} —— 无 tools 时 toolCalls 为空数组
   *  向后兼容：调用方原期望纯文本字符串的代码，改为 res.content 读取即可
   */
  async function chat(messages,onChunk,options){
    if(!state.model)state.model=DEFAULT_MODEL;
    state.chatting=true;
    state.abortController=null;
    try{
      if(state.runtime==='tauri'){
        _ensureStreamListener(onChunk);
        try{
          // tauri 模式：透传 tools 参数给 Rust 侧 ai_deepseek_chat；Rust 流式转发 tool_calls delta
          // （lib.rs 已 emit {"text":"","toolCalls":tcs}），此处由监听累积、invoke 返回后解析，
          // 桌面版与浏览器版行为一致（写入流程均可用）
          const reqArgs={
            messages:messages.map(function(m){
              const out={role:m.role,content:String(m.content||'')};
              if(m.tool_call_id)out.tool_call_id=m.tool_call_id;
              if(m.tool_calls)out.tool_calls=m.tool_calls;
              return out;
            }),
            model:state.model,
            baseUrl:state.baseUrl,
            stream:true,
            temperature:0.3,
            max_tokens:1200,
            streamEvent:STREAM_EVENT
          };
          if(options&&Array.isArray(options.tools)&&options.tools.length){
            reqArgs.tools=options.tools;
          }
          const full=await tauriInvoke('ai_deepseek_chat',reqArgs);
          // Rust 返回最终完整文本；若事件接收比最终返回慢，用最终文本兜底补齐
          if(typeof full==='string'&&full.length>state.chunkBuf.length&&onChunk){
            onChunk(full.slice(state.chunkBuf.length));
            state.chunkBuf=full;
          }
          // tauri 模式：由监听累积的 tool_calls delta 解析为最终数组（与浏览器版同构）
          return {content:state.chunkBuf,toolCalls:_finalizeToolCalls(state.tauriToolAcc)};
        }finally{_cleanupStreamListener();}
      }
      // 浏览器形态：前端直连 DeepSeek，AbortController 真正可取消
      const controller=new AbortController();
      state.abortController=controller;
      try{return await webChat(messages,onChunk,controller.signal,options);}
      finally{state.abortController=null;}
    }catch(e){
      // 阶段4：错误处理边界 —— 分类网络错误/流式中断/tauri 命令异常，给出友好提示
      throw _friendlyError(e);
    }finally{state.chatting=false;state.abortController=null;}
  }

  /** 阶段4：错误分类器 —— 把底层异常转换为对用户友好的中文提示
   *  - AbortError（用户主动中止）保持原样，由调用方专门处理
   *  - 网络层错误（fetch 失败/断网/CORS）统一为「网络连接失败」
   *  - Tauri 命令异常归类为「AI 服务调用异常」
   *  - HTTP 4xx/5xx 错误已在 webChat 中包装为中文，原样透传
   *  - 其他未知异常附加「请稍后重试」提示
   */
  function _friendlyError(e){
    if(!e)return new Error('未知错误，请稍后重试');
    if(e.name==='AbortError')return e; // 中止错误由调用方专门处理，保持原语义
    const msg=String(e.message||e);
    // 网络错误（fetch 抛 TypeError，多半是断网/DNS/CORS）
    if(e.name==='TypeError'||/Failed to fetch|\bNetworkError\b|loadfailed/i.test(msg)){
      return new Error('网络连接失败，请检查网络后重试');
    }
    // Tauri 命令调用异常
    if(/tauri|invoke|非 Tauri 运行时/i.test(msg)){
      return new Error('AI 服务调用异常：'+msg);
    }
    // 流式响应中断
    if(/stream|sse|eventsource/i.test(msg)){
      return new Error('AI 响应流中断，请重试');
    }
    return e;
  }

  /** 多轮工具调用循环（写入流程入口）
   *  流程：初始消息 → chat(带 tools) → 若有 tool_calls → 确认弹窗（由外部回调处理）→ 执行 → tool 响应回传 → 继续下一轮
   *  - 无 tool_calls → 持久化 assistant 纯文本总结，结束
   *  - 用户取消 → 推送「用户取消了本次操作」让模型决定后续
   *  - 单条失败不中断其他，模型可基于失败结果决定下一步
   *  onChunk：流式文本回调（对话区显示）
   *  onConfirm(toolCalls) → Promise<{cancelled:boolean, approvedOps:array}>：确认弹窗回调（由 ai-chat.js 实现）
   *  返回值：{content:string, lastToolResults:array}
   */
  async function aiWriteLoop(initialMessages,onChunk,onConfirm,aiChatId){
    const messages=[...initialMessages];
    let lastToolResults=[];
    let lastBatchIds=[];    // 本轮所有写入批次 ID（供对话内一键撤销整轮，复用持久化 undoBatch）
    let lastBatchId=null;     // 兼容字段：最后一个批次 ID
    const MAX_ROUNDS=8;  // 阶段3：查询+写入多轮，增加到 8 轮
    for(let round=0;round<MAX_ROUNDS;round++){
      // 上下文压缩：首轮前检查总长度，超阈值时先让模型压缩历史为摘要
      // （工具多轮进行中不压缩，避免破坏 assistant(tool_calls)→tool 的协议连续性）
      if(round===0){
        const totalChars=messages.reduce(function(sum,m){return sum+String(m.content||'').length;},0);
        if(totalChars>HISTORY_CONTEXT_CHARS){
          const summary=await compressContext(messages);
          if(summary){
            const systemMsg=messages.find(m=>m.role==='system')||null;
            const lastUser=[].concat(messages).reverse().find(m=>m.role==='user')||null;
            messages.length=0;
            if(systemMsg)messages.push(systemMsg);
            messages.push({role:'user',content:'【历史对话摘要】\n'+summary+(lastUser?'\n\n【当前问题】\n'+lastUser.content:'')});
            if(typeof toast==='function')toast('上下文较长，已自动压缩为摘要','info');
          }
        }
      }
      const res=await chat(messages,onChunk,{tools:typeof AIT!=='undefined'?AIT.TOOLS_DEFS:[]});
      if(!res.toolCalls||!res.toolCalls.length){
        // 纯文本总结，结束
        return {content:res.content,lastToolResults,lastBatchIds,lastBatchId};
      }
      // P0 修复：归一化 tool_calls —— 流式累积可能缺失 id，而 OpenAI 协议要求
      // assistant.tool_calls 的 id 与 tool 响应的 tool_call_id 非空且精确匹配，
      // id 缺失会导致 HTTP 400 "Messages with role 'tool' must be a response to..."
      const calls=res.toolCalls.map(function(tc){
        return {id:tc.id||uid('TC'),name:tc.name,args:(tc.args&&typeof tc.args==='object')?tc.args:{}};
      });
      // 阶段3：分流 —— query/flow 类自动执行（不经弹窗），write/delete 类走确认弹窗
      // 阶段4：flow 类（navigate_view/export_order_excel/open_settlement_drawer/open_invoice_drawer）自动执行
      // P0 修复：flowSet 防护 AIT 未加载或 FLOW_TOOL_NAMES 为 undefined 的场景
      const flowSet=(typeof AIT!=='undefined'&&AIT.FLOW_TOOL_NAMES)?AIT.FLOW_TOOL_NAMES:null;
      const flowOps=calls.filter(tc=>flowSet&&flowSet.has(tc.name));
      const queryOps=calls.filter(tc=>tc.name.indexOf('query_')===0);
      const writeOps=calls.filter(tc=>tc.name.indexOf('query_')!==0&&!(flowSet&&flowSet.has(tc.name)));

      // 1) 查询类立即执行（无副作用，结果直接回填给模型）
      const queryResults=queryOps.map(tc=>{
        const content=(typeof AIT!=='undefined')?AIT.runQuery(tc.name,tc.args||{}):JSON.stringify({ok:false,error:'AIT 未加载'});
        return {toolCallId:tc.id,content:content};
      });

      // 1.5) 功能层立即执行（UI 动作：导航/导出/打开抽屉，不写 DB，结果回填给模型）
      // 确认策略：纯 UI 动作（导航/打开抽屉）零副作用 → 自动执行不确认不审计；
      // 导出（生成文件）有副作用 → 自动执行 + 记审计（操作历史可追溯，不可回滚）
      const flowResults=flowOps.map(tc=>{
        const content=(typeof AIT!=='undefined'&&AIT.runFlow)?AIT.runFlow(tc.name,tc.args||{}):JSON.stringify({ok:false,error:'AIT.runFlow 未加载'});
        if(tc.name==='export_order_excel'){
          try{
            recordAiOp({op:'export',type:'export',targetId:(tc.args&&tc.args.orderId)||null,
              before:null,after:{orderId:(tc.args&&tc.args.orderId)||null},operator:'ai',aiChatId:aiChatId});
          }catch(e){}
        }
        return {toolCallId:tc.id,content:content};
      });

      // 2) 写入类走确认弹窗（仅当有 writeOps 时才弹窗）
      let writeResults=[];
      if(writeOps.length){
        const confirmed=await onConfirm(writeOps);
        if(confirmed.cancelled){
          // 用户取消：所有 writeOps 回填「用户取消」
          writeResults=writeOps.map(tc=>({toolCallId:tc.id,content:JSON.stringify({ok:false,error:'用户取消了本次操作'})}));
          messages.push({role:'user',content:'用户取消了操作提案，请不要再次起草相同操作。'});
        }else{
          // 批量执行（写入 DB + aiOps）；记 batchId 供对话内一键撤销（复用持久化 undoBatch）
          const batchId=uid('AOB');
          const execRes=AIT.executeOps(confirmed.approvedOps,{aiChatId:aiChatId,batchId:batchId,operator:'ai'});
          lastToolResults=execRes.results;
          lastBatchIds.push(batchId);
          lastBatchId=batchId;
          // 回填：approvedOps 的执行结果 + 未勾选的「用户未选」
          writeResults=writeOps.map(tc=>{
            const approvedIdx=confirmed.approvedOps.findIndex(o=>o.__toolCallId===tc.id);
            if(approvedIdx<0)return {toolCallId:tc.id,content:JSON.stringify({ok:false,error:'用户未勾选该操作'})};
            const r=execRes.results[approvedIdx]||{ok:false,error:'未执行'};
            return {toolCallId:tc.id,content:AIT.buildToolResponse(confirmed.approvedOps[approvedIdx],r)};
          });
        }
      }

      // 3) 回填 assistant + tool 响应（OpenAI 协议要求所有 tool_calls 都有响应）
      messages.push({role:'assistant',content:res.content||'',tool_calls:calls.map(tc=>({id:tc.id,type:'function',function:{name:tc.name,arguments:JSON.stringify(tc.args)}}))});
      queryResults.forEach(r=>messages.push({role:'tool',tool_call_id:r.toolCallId,content:r.content}));
      flowResults.forEach(r=>messages.push({role:'tool',tool_call_id:r.toolCallId,content:r.content}));
      writeResults.forEach(r=>messages.push({role:'tool',tool_call_id:r.toolCallId,content:r.content}));
      // 继续下一轮，模型可基于工具响应再调工具或给总结
    }
    return {content:'',lastToolResults,lastBatchIds,lastBatchId};
  }
  /** 撤销指定批次的 AI 工具改动（复用持久化 undoBatch，按 op 反向精准回滚，不误伤手动操作）
   *  返回已撤销条数（供 UI 提示）；batchId 无效或已撤销返回 0 */
  function undoLastBatch(batchId){
    if(!batchId||typeof undoBatch!=='function')return 0;
    return undoBatch(batchId);
  }
  function abort(){if(state.abortController)state.abortController.abort();}

  /** 保存/删除 API Key：tauri → 应用数据目录文件；web → localStorage（空串删除） */
  /** 保存/删除 API Key：tauri → 应用数据目录文件；web → localStorage（空串删除）
   *  多模型接入：放开 sk- 前缀校验，自定义端点 Key 非空即可；仅限长度防滥用 */
  async function setDeepseekToken(raw){
    const token=String(raw||'').trim();
    if(token&&token.length>4000){
      throw new Error('API_KEY 过长，无法保存');
    }
    if(state.runtime==='tauri'){
      await tauriInvoke('ai_deepseek_token_write',{token:token});
    }else{
      if(token)localStorage.setItem(WEB_KEY_STORAGE,token);
      else localStorage.removeItem(WEB_KEY_STORAGE);
    }
    state.hasKey=!!token||/^https?:\/\/(127\.0\.0\.1|localhost)/.test(state.baseUrl||'');
    if(typeof refreshAIStatus==='function')refreshAIStatus();
  }
  /** 读取已保存的 Key 明文（仅设置弹窗编辑态回显用；非编辑状态不展示） */
  async function getDeepseekToken(){
    if(state.runtime==='tauri'){
      try{
        const t=await tauriInvoke('ai_deepseek_token_get');
        return typeof t==='string'?t:'';
      }catch(e){return '';}
    }
    return (localStorage.getItem(WEB_KEY_STORAGE)||'').trim();
  }
  async function getDeepseekTokenDraft(){
    const t=await getDeepseekToken();
    return t?'(已保存)':'';
  }

  return {
    state,runtimeLabel,providerLabel,QUICK_ACTIONS,ALLOWED_MODELS,PRESET_MODELS,DEFAULT_MODEL,DEFAULT_BASE_URL,
    probeProxy,startHealthCheck,buildPreview,buildSystemPrompt,getHistory,persistMessage,
    chat,aiWriteLoop,abort,setModel,setProvider,setDeepseekToken,getDeepseekToken,getDeepseekTokenDraft,
    undoLastBatch
  };
})();
