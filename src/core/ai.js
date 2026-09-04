// ai.js — 可选 AI 增强：脱敏上下文、DeepSeek 直连（Tauri 桌面版走 Rust 命令；浏览器版前端直连，CORS 已实测放行）
const AI=(function(){
  const HISTORY_LIMIT=50;
  const HISTORY_CONTEXT_LIMIT=20;   // 携带更多历史上下文（超长时自动压缩）
  const HISTORY_CONTEXT_CHARS=20000; // 上下文总字符阈值，超过触发一次压缩
  const HEALTH_INTERVAL_MS=30000;
  // 工作流（多步长任务分步执行）常量
  const WF_MAX_STEPS=8;             // 单计划最多步骤
  const WF_HISTORY_LIMIT=40;        // DB.aiWorkflows 保留条数
  const DEFAULT_MODEL='deepseek-v4-flash';
  // 预置推荐模型（不强制限制，设置中可自定义任意 OpenAI 兼容模型名）
  const PRESET_MODELS=['deepseek-v4-flash','deepseek-v4-pro','gpt-4o-mini','gpt-4o','qwen-plus','glm-4-flash','llama3','qwen2.5'];
  const ALLOWED_MODELS=new Set(PRESET_MODELS);
  const DEFAULT_BASE_URL='https://api.deepseek.com/v1';   // OpenAI 兼容端点，可在设置中修改（如 Ollama http://127.0.0.1:11434/v1）
  const STREAM_EVENT='ai:deepseek:chunk';
  const FIRST_CHUNK_TIMEOUT_MS=120000; // 首块响应超时：仅"请求发出→收到第一个数据块"计时，收包后即失效（不再累计总时长）
  const IDLE_TIMEOUT_MS=90000;     // 流式空闲超时：距上次收到任何数据块超过该时长视为断流（abortReason='timeout'）
  const AI_CONTINUE_MAX=3;         // 单条回复因「输出长度截断/未收到流结束指令」自动续写的最大次数（防无限循环）
  const WEB_KEY_STORAGE='wb_fastener_ai_key';   // API_KEY 明文存 localStorage（三端统一，用户决策 v1.0.31+）
  const WEB_API_URL=DEFAULT_BASE_URL+'/chat/completions';   // 默认端点（可配置）
  const WEB_BASE_STORAGE='wb_fastener_ai_base';   // Base URL 存 localStorage
  const WEB_MODEL_STORAGE='wb_fastener_ai_model'; // 模型名存 localStorage
  const _OBF_SALT_KEY='wb_fastener_obf_salt';   // 混淆盐值存 localStorage

  const state={
    runtime:'web',           // 'tauri' | 'web'
    proxyOnline:false,       // 运行通道可达（tauri：Rust 命令；web：已保存 Key）
    hasKey:false,            // 是否已保存 API_KEY
    apiKey:'',               // 明文 Key（localStorage 同步；每次请求随 body 传给 Rust）
    model:DEFAULT_MODEL,
    baseUrl:DEFAULT_BASE_URL,
    chatting:false,
    abortController:null,
    abortReason:'',        // 本次中止原因：''/'manual'/'timeout'（供调用方区分「已停止」与「请求超时」）
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
  // 恢复多模型配置与 API_KEY（浏览器 / macOS / Windows 统一明文存 localStorage）
  try{
    const _b=localStorage.getItem(WEB_BASE_STORAGE);
    if(_b&&String(_b).trim())state.baseUrl=String(_b).trim().replace(/\/+$/,'');
    const _m=localStorage.getItem(WEB_MODEL_STORAGE);
    if(_m&&String(_m).trim())state.model=String(_m).trim();
    const _k=localStorage.getItem(WEB_KEY_STORAGE);
    if(_k&&String(_k).trim()&&String(_k).indexOf('obf1:')!==0)state.apiKey=String(_k).trim();
    // 2026-08-29 修复：初始化时同步推导 hasKey，不再等 probeProxy 异步调用
    // 否则 bootApp → render 渲染 UI 时 hasKey 仍为 false → 显示「未设置 API_KEY」
    state.hasKey=!!state.apiKey||/^https?:\/\/(127\.0\.0\.1|localhost)/.test(state.baseUrl||'');
    state.proxyOnline=state.hasKey;
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
      // 知识库工具仅在已绑定且启用时向模型开放（未绑定时连同 system prompt 指引一并省略，模型无从发起 KB 调用）
      const kbReady=(typeof KB!=='undefined'&&KB.state.bound&&KB.state.enabled);
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
      '3. 状态流转必须守 STATUS_FLOW（待确认 → 寻货中 → 报价中 → 签约完成 → 送货中 → 完成）；只能前进到下一站，或转入「异常」「取消」分支；「未成交」是从「报价中」分支出的状态，可恢复回「报价中」；「完成」可回退到「送货中」或转「异常」；「异常」「取消」为终态不可再流转。\n'+
      '4. 联系人电话、税号、银行账号、地址等信息：直接取自用户对话内容，用户提供即可填入 create_unit 参数（contactName/phone/taxId/address/bank/accountNo）；未提供的字段省略。\n'+
      '5. 仍依据下方脱敏快照理解上下文，数据缺失时明确说明「未在快照中找到」，禁止补造不存在的单位/订单 ID。订单的「单号/订单编号」即系统订单 ID（如 PO260805-001），本系统没有独立「客户单号/客户 PO 号」字段：用户说单号、订单号时一律指向系统订单编号，不要臆造客户侧的另一套单号，也不要暗示存在隐藏单号字段。\n'+
      '6. 一条 tool_call 只起草一次操作；多个独立操作可并行起草（多个 tool_calls），但同一条记录不要在同一轮中既修改又删除。\n'+
      '7. 金额使用 ¥ 与千分位，日期使用 YYYY-MM-DD，分析结论用简洁 Markdown。\n'+
      '8. 功能层工具参数中的 ID 必须来自快照或前序查询结果，禁止凭空编造；调用 navigate_view 时若无 orderId，仅填 viewName 即可。\n'+
      '9. 用户询问系统使用/操作问题（"怎么操作/怎么做/如何使用/在哪/能不能"等）时：先调用 query_help 检索完整帮助知识库，再结合上方指引回答；能直接代做的（导航/导出/打开表单/打开抽屉）同时调用对应功能层工具。\n'+
      '10. 【多步长任务 → flow_start_workflow】当用户目标需要连续多轮工具调用、且无法在单轮对话中可靠完成（例如：批量录入多条记录、需要对多个对象逐个执行同一种写入、跨模块串联多个业务动作、存在先后依赖的流程性任务）时：先在 content 中用简短文字说明整体计划，然后调用 flow_start_workflow(goal, steps) 将其拆分为 2-8 个可验证的小步骤提交给用户确认；步骤之间要让前序为后续留下可复用的 ID/名称/金额。系统会生成执行计划卡片，用户确认后分步执行，每步写入仍需逐条确认。\n'+
      '   适用示范（每条都可拆成独立步骤）：a) 依次为 3 个新客户建档并各录 1 条签约报价；b) 新建 5 个订单并逐个寻货分配供应商；c) 本月对账结算 + 开票录入。\n'+
      '   不适用示范：单次查询、单条记录起草、纯文本分析（这类直接走常规对话即可，不要调用 flow_start_workflow）。\n\n'+
      (kbReady?
      '【知识库主动检索工具】（用户已绑定本地知识库目录时可用的工具，未绑定时工具返回 ok:false）\n'+
      '- query_knowledge(query, topN?, fileFilter?)：检索本地知识库（md/txt/pdf/docx），返回命中片段（含文件名/章节/页码/片段/得分）。\n'+
      '- list_kb_files(keyword?)：列出知识库内全部/筛选文件元数据，先了解资料范围再检索。\n'+
      '- get_kb_file(nameOrRel, range?)：取某文件分块全文（单次约 4000 字符上限，超限标 truncated，用 range 翻页）。\n'+
      '- search_kb_detail(query, topN?, fileFilter?)：与 query_knowledge 类似但返回更长片段+相邻上下文，仅在需要完整依据时使用。\n'+
      '使用时机：用户问及「资料/文档/合同/规格书/历史记录/供应商文件/有没有说过…」等需要查阅本地资料的问题时，先调用 query_knowledge；若不确定 KB 有什么资料先 list_kb_files；需要核对命中片段的完整上下文用 get_kb_file；常规检索不要用 search_kb_detail（省 token）。\n'+
      '硬约束：当 KB 命中且用于回答时，句末必须标注【依据：文件名】（文件名取自命中结果的 file 字段）；可在同一对话中多次调用 query_knowledge 精炼关键词；未命中（count:0）时明确说「未在知识库中找到」，禁止编造文件名或内容；KB 命中与业务数据快照冲突时，以业务快照为准并说明。\n\n'
:'')+
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
  /** 读取明文 Key；旧版混淆值（obf1: 前缀）自动清除，避免误当 Key 使用 */
  function readPlainKey(){
    const v=(localStorage.getItem(WEB_KEY_STORAGE)||'').trim();
    if(v.indexOf('obf1:')===0){localStorage.removeItem(WEB_KEY_STORAGE);return '';}
    return v;
  }
  function webHasKey(){return !!readPlainKey();}

  /** 健康检查：tauri 检查 Rust 通道与 Token 文件；web 检查本地保存的 Key */
  async function probeProxy(){
    // Key 明文存 localStorage（浏览器 / macOS / Windows 三端统一）；本地端点无需 Key 也可用
    state.hasKey=webHasKey()||/^https?:\/\/(127\.0\.0\.1|localhost)/.test(state.baseUrl||'');
    state.proxyOnline=state.hasKey;
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
    const key=readPlainKey();
    const localBase=/^https?:\/\/(127\.0\.0\.1|localhost)/.test(state.baseUrl||'');
    if(!key&&!localBase)throw new Error('请先在 AI 设置中填写 API_KEY（本地 Ollama 可留空）');
    // 本地端点无 Key 时用占位 token：Ollama 等 OpenAI 兼容层要求 Authorization 头非空（空值会 401）
    const authKey=key||(localBase?'ollama':'');
    state.webBuf='';
    state.webToolAcc=[];  // tool_calls 累积槽：按 index 累积 {index,id,name,argsStr}
    let _lastFinishReason=''; // 最近一次出现的 finish_reason（''/stop/length/…），供上层识别「输出长度截断」
    let _gotEndSignal=false;  // 是否收到过明确的流结束指令（finish_reason 或 [DONE]）；未收到即视为异常中断
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
    // 本地/远端端点偶发不可达（如本地推理服务加载中、系统网络瞬断）会使 fetch 直接 reject
    // （TypeError / ERR_INTERNET_DISCONNECTED / Failed to fetch）。对纯网络层失败自动重试：
    // 共 3 次尝试（0ms/600ms/1600ms 退避），吸收服务瞬时不可达窗口；HTTP 错误码（401/429 等）不重试。
    const NET_RETRY_MAX=2;
    let _netErr=null;
    for(let _try=0;_try<=NET_RETRY_MAX;_try++){
      if(_try>0){
        await new Promise(function(_r){setTimeout(_r,_try===1?600:1600);});
      }
      try{
        res=await fetch(apiChatUrl(),{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+authKey,'Accept':'text/event-stream'},
          body:JSON.stringify(reqBody),
          signal:signal
        });
        break;
      }catch(err){
        _netErr=err;
        if(signal&&signal.aborted)break; // 用户手动停止：不重试，立即上抛
        if(_try===NET_RETRY_MAX)break;    // 已达重试上限，最后一次失败保留原始错误
      }
    }
    if(!res){
      throw new Error('无法连接模型服务（'+apiChatUrl()+'）：'+(_netErr&&_netErr.message?_netErr.message:JSON.stringify(_netErr)));
    }
    if(!res.ok){
      let detail='';
      try{const j=await res.json();detail=(j&&j.error&&j.error.message)?j.error.message:'';}catch(_){}
      if(!detail){try{detail=(await res.text()).slice(0,200);}catch(_){detail='';}}
      throw new Error(providerLabel()+' 返回错误 (HTTP '+res.status+(detail?')：'+detail:')'));
    }
    if(!res.body||!res.body.getReader)throw new Error('当前浏览器不支持流式响应');
    const reader=res.body.getReader();const decoder=new TextDecoder();let buffer='';
    // 超时策略：无"全程总计时"——只要有响应持续输出就永不掐断（此前 10 分钟总兜底仍会在超长回答时误杀）。
    // 仅两类计时：①首块超时 FIRST_CHUNK_TIMEOUT_MS（请求发出后首个数据块迟迟不来）；
    // ②空闲超时 IDLE_TIMEOUT_MS（收到过数据后中途超过该时长无新数据 = 断流）。收到首个数据块即进入纯空闲看门狗模式。
    let _idleTimer=null,_gotFirstChunk=false;
    const _clearIdle=function(){if(_idleTimer){clearTimeout(_idleTimer);_idleTimer=null;}};
    while(true){
      let chunk;
      try{
        chunk=await Promise.race([
          reader.read(),
          new Promise(function(_,reject){
            _idleTimer=setTimeout(function(){
              state.abortReason='timeout'; // 复用超时语义：前端显示「请求超时」+ 重新提交入口
              reject(Object.assign(new Error('AI 响应空闲超时（长时间未收到新内容）'),{name:'AbortError',aiIdleTimeout:true}));
            },_gotFirstChunk?IDLE_TIMEOUT_MS:FIRST_CHUNK_TIMEOUT_MS);
          })
        ]);
      }finally{_clearIdle();}
      if(!chunk.done)_gotFirstChunk=true;
      const done=chunk.done,value=chunk.value;
      if(done){
        // EOF 边界：把缓冲区内残留的最后一行也解析一次（SSE 行若恰在流尾未带换行符，
        // 如 `data: [DONE]`，不能漏判结束信号，否则会被误认为「未收到结束指令」触发续写）
        const tail=(buffer||'').trim();
        if(tail){
          if(tail.startsWith('data:')){
            const rawTail=tail.slice(5).trim();
            if(rawTail==='[DONE]'){_gotEndSignal=true;}
            else if(rawTail){
              try{const jT=JSON.parse(rawTail);const choiceT=jT.choices&&jT.choices[0];if(choiceT&&choiceT.finish_reason){_lastFinishReason=choiceT.finish_reason;_gotEndSignal=true;}}catch(_){}
            }
          }
          buffer='';
        }
        break;
      }
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
        if(!raw)continue;
        // [DONE] 为 OpenAI 兼容流的标准结束标记：记录已收到结束指令（是否截断由 finish_reason 判定）
        if(raw==='[DONE]'){_gotEndSignal=true;continue;}
        try{
          const j=JSON.parse(raw);
          const choice=j.choices&&j.choices[0];
          // 流结束信号：finish_reason（stop=正常完成 / length=达到输出长度上限被截断），可作为结束标记
          if(choice&&choice.finish_reason){_lastFinishReason=choice.finish_reason;_gotEndSignal=true;}
          const delta=choice&&choice.delta;
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
    return {content:state.webBuf,toolCalls:_finalizeToolCalls(state.webToolAcc),finishReason:_lastFinishReason||'',gotEndSignal:_gotEndSignal};
  }

  /** 单次对话入口（兼容只读与带工具两种模式）
   *  参数：messages, onChunk, options?（含 tools 数组）
   *  返回：{content:string, toolCalls:array} —— 无 tools 时 toolCalls 为空数组
   *  向后兼容：调用方原期望纯文本字符串的代码，改为 res.content 读取即可
   */
  async function chat(messages,onChunk,options){
    if(!state.model)state.model=DEFAULT_MODEL;
    // 2026-08-29 安全兜底：若 state.apiKey 为空（可能 IIFE 初始化后 probeProxy 未跑完，
    // 或 setDeepseekToken 设了 hasKey 但 state.apiKey 赋值时序错），从 localStorage 再读一次。
    // 这不影响安全（Key 本就存 localStorage），只是确保 Tauri chat 不误报「未设置 API_KEY」。
    if(!state.apiKey){
      try{const _k=localStorage.getItem(WEB_KEY_STORAGE);if(_k&&String(_k).trim()&&String(_k).indexOf('obf1:')!==0)state.apiKey=String(_k).trim();}catch(e){}
    }
    state.chatting=true;
    state.abortController=null;
    state.abortReason=''; // 每次新请求重置中止原因
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
            apiKey:state.apiKey,
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
          // 结束信号：Rust 目前只透传文本增量、不透传 finish_reason，命令正常返回即视为收到结束信号（gotEndSignal=true），
          // 避免桌面版因「未收到结束指令」误触发续写；输出长度截断的自动续写目前仅浏览器直连模式支持（Rust 侧可后续扩展）。
          return {content:state.chunkBuf,toolCalls:_finalizeToolCalls(state.tauriToolAcc),finishReason:null,gotEndSignal:true};
        }finally{_cleanupStreamListener();}
      }
      // 浏览器形态：前端直连 DeepSeek，AbortController 真正可取消
      const controller=new AbortController();
      state.abortController=controller;
      // 无"全程总计时"：流式持续有响应即不设上限，不在这里挂整体超时。
      // 请求发出后等首包 / 流中途断流分别由 webChat 内的 FIRST_CHUNK_TIMEOUT_MS / IDLE_TIMEOUT_MS 看门狗判定；
      // AbortController 仅保留给用户手动停止（abort()）使用。
      try{return await webChat(messages,onChunk,controller.signal,options);}
      finally{state.abortController=null;}
    }catch(e){
      // 阶段4：错误处理边界 —— 分类网络错误/流式中断/tauri 命令异常，给出友好提示
      // 桌面版 Rust 行级空闲超时以 String err 抛回（无法携带 AbortError name），统一转成 AbortError + timeout 语义
      const _em=e&&e.message?String(e.message):'';
      if(!(e&&e.name==='AbortError')&&/空闲超时/.test(_em)){
        state.abortReason='timeout';
        const _ae=new Error(_em);_ae.name='AbortError';throw _ae;
      }
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
      try{console.error('[AI 诊断] 原始错误：',e);}catch(_){}
      return new Error('网络连接失败，请检查网络后重试（原始错误：'+msg.slice(0,300)+'）');
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
  async function aiWriteLoop(initialMessages,onChunk,onConfirm,aiChatId,opts){
    // opts：{noWfTools:boolean} —— 工作流步骤执行内部轮次传 true，禁止模型再发起子工作流
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
      // 工具可用性动态过滤：知识库未绑定/未启用时，不把 KB 工具带给模型（模型无从发起 → 无提案弹窗）
      // 工作流内部轮次（opts.noWfTools）不透出 flow_start_workflow，禁止步骤内再嵌套发起子工作流
      const kbSet=(typeof AIT!=='undefined'&&AIT.KB_TOOL_NAMES)?AIT.KB_TOOL_NAMES:null;
      const kbAvailable=(typeof KB!=='undefined'&&KB.state.bound&&KB.state.enabled);
      const noWfTools=!!(opts&&opts.noWfTools);
      const toolsDef=(typeof AIT!=='undefined'?AIT.TOOLS_DEFS:[]).filter(function(t){
        const tName=t&&t.function&&t.function.name;
        if(noWfTools&&tName==='flow_start_workflow')return false;
        if(!(kbSet&&kbSet.has(tName)))return true;
        return kbAvailable;
      });
      // 断流半截保护：chat() 在流式中途抛出的异常（网络瞬断/空闲超时）不直接上抛——
      // 只要本次已输出过半截内容，就把半截归一为「未收到流结束指令」的结果，走下方统一续写逻辑补齐；
      // 仅在两种情况下原样上抛：① 用户手动停止（abortReason==='manual'，不应擅自续写）；
      // ② 全程无任何输出（首包即失败，没有可接续的上文，交由 UI 提示重试）。
      let res;
      try{
        res=await chat(messages,onChunk,{tools:toolsDef});
      }catch(err){
        const _partial=String(state.webBuf||state.chunkBuf||'');
        if(state.abortReason==='manual'||!_partial)throw err;
        res={content:_partial,toolCalls:[],finishReason:'',gotEndSignal:false};
      }
      // —— 输出长度截断 / 断流 自动续写（后台无缝接续，用户无感） ——
      // 触发判据（与 AI 兼容流协议一致）：
      //   1) finish_reason==='length'：模型达到输出长度上限被截断（OpenAI 兼容流会在最后一个 chunk 携带）；
      //   2) 流已自然读到 EOF，但整条流从未收到结束指令（finish_reason/[DONE]）：视为异常中断。
      // 安全边界：用户手动停止已在上方 catch 原样上抛，不会走到此处 → 不误触发；
      // 空闲超时/网络错误若带半截内容，已在上方归一为断流结果进入本续写通道；
      // 有 tool_calls 的轮次不续写（保持 assistant(tool_calls)→tool 协议连续性）；
      // 无任何已生成文本不续写（没有可接续的上文，避免模型从头重写造成重复）。
      let _aiContinueCount=0;
      const _needContinue=(r)=>!!r&&(!r.toolCalls||!r.toolCalls.length)&&(r.finishReason==='length'||!r.gotEndSignal)&&String(r.content||'').length>0;
      while(_aiContinueCount<AI_CONTINUE_MAX&&_needContinue(res)){
        // 已生成部分作为 assistant 上下文回填 → 模型从中断处无缝接续，不会重复开头
        messages.push({role:'assistant',content:res.content||''});
        messages.push({role:'user',content:'你的上一条回复因输出长度限制被截断，请直接从中断处继续完整输出：只输出接续内容，不要重复已输出的部分，也不要复述本提示。'});
        _aiContinueCount++;
        const contRes=await chat(messages,onChunk,{tools:[]});
        const contText=(contRes&&contRes.content)?contRes.content:'';
        if(contText){res.content=(res.content||'')+contText;}   // 拼接到同一消息，UI/落盘均呈连续追加
        res.finishReason=(contRes&&contRes.finishReason)?contRes.finishReason:'';
        res.gotEndSignal=!!(contRes&&contRes.gotEndSignal);
        if(contRes&&contRes.toolCalls&&contRes.toolCalls.length){res.toolCalls=contRes.toolCalls;break;} // 理论不出现；真出现则交由下方工具分流
      }
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
      // 工作流计划发起拦截：flow_start_workflow 不进入 query/flow/write 常规分流。
      // 校验通过 → 创建 DB.aiWorkflows 草稿并返回 wfId（UI 展示计划卡 + 确认弹窗后再逐步执行）；
      // 校验失败 → 把错误作为 tool 响应回填，让模型下一轮自纠。
      const wfStartCalls=(opts&&opts.noWfTools)?[]:calls.filter(tc=>tc.name==='flow_start_workflow');
      if(wfStartCalls.length){
        const wfTry=wfCreateDraft(wfStartCalls[0].args,aiChatId);
        if(wfTry.ok){
          if(typeof toast==='function')toast('已生成执行计划，请确认后开始','info');
          return {content:(res.content&&String(res.content).trim())?res.content:'已生成执行计划，等待确认后分步执行。',wfId:wfTry.wfId,lastToolResults:[],lastBatchIds:[],lastBatchId:null};
        }
        // 计划参数不合法：回填错误并让模型自纠（同轮其他调用一并忽略，避免部分执行造成计划/操作错位）
        messages.push({role:'assistant',content:res.content||'',tool_calls:calls.map(tc=>({id:tc.id,type:'function',function:{name:tc.name,arguments:JSON.stringify(tc.args)}}))});
        messages.push({role:'tool',tool_call_id:wfStartCalls[0].id,content:JSON.stringify({ok:false,error:wfTry.error})});
        continue;
      }
      // 阶段3：分流 —— query/flow 类自动执行（不经弹窗），write/delete 类走确认弹窗
      // 阶段4：flow 类（navigate_view/export_order_excel/open_settlement_drawer/open_invoice_drawer）自动执行
      // P0 修复：flowSet 防护 AIT 未加载或 FLOW_TOOL_NAMES 为 undefined 的场景
      const flowSet=(typeof AIT!=='undefined'&&AIT.FLOW_TOOL_NAMES)?AIT.FLOW_TOOL_NAMES:null;
      const flowOps=calls.filter(tc=>flowSet&&flowSet.has(tc.name));
      // 知识库只读工具（query_knowledge/list_kb_files/get_kb_file/search_kb_detail）与 query_ 前缀同路：立即执行不经弹窗
      const queryOps=calls.filter(tc=>tc.name.indexOf('query_')===0||(kbSet&&kbSet.has(tc.name)));
      const writeOps=calls.filter(tc=>tc.name.indexOf('query_')!==0&&!(flowSet&&flowSet.has(tc.name))&&!(kbSet&&kbSet.has(tc.name)));

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

      // 未知工具兑底：校验器不认识的调用（模型幻觉/定义不同步）不进确认弹窗打扰用户，直接回填错误让模型自纠
      const unknownResults=[];const knownWriteOps=[];
      writeOps.forEach(tc=>{
        const v=(typeof AIT!=='undefined')?AIT.validateOp({name:tc.name,args:tc.args||{}}):{ok:false,error:'AIT 未加载'};
        if(!v.ok&&/未知工具/.test(v.error||''))unknownResults.push({toolCallId:tc.id,content:JSON.stringify({ok:false,error:v.error+'，请改用系统提供的工具'})});
        else knownWriteOps.push(tc);
      });
      // 2) 写入类走确认弹窗（仅当有 writeOps 时才弹窗）
      let writeResults=[];
      if(knownWriteOps.length){
        const confirmed=await onConfirm(knownWriteOps);
        if(confirmed.cancelled){
          // 用户取消：所有 writeOps 回填「用户取消」
          writeResults=knownWriteOps.map(tc=>({toolCallId:tc.id,content:JSON.stringify({ok:false,error:'用户取消了本次操作'})}));
          messages.push({role:'user',content:'用户取消了操作提案，请不要再次起草相同操作。'});
        }else{
          // 批量执行（写入 DB + aiOps）；记 batchId 供对话内一键撤销（复用持久化 undoBatch）
          const batchId=uid('AOB');
          const execRes=AIT.executeOps(confirmed.approvedOps,{aiChatId:aiChatId,batchId:batchId,operator:'ai'});
          lastToolResults=execRes.results;
          lastBatchIds.push(batchId);
          lastBatchId=batchId;
          // 回填：approvedOps 的执行结果 + 未勾选的「用户未选」
          writeResults=knownWriteOps.map(tc=>{
            const approvedIdx=confirmed.approvedOps.findIndex(o=>o.__toolCallId===tc.id);
            if(approvedIdx<0)return {toolCallId:tc.id,content:JSON.stringify({ok:false,error:'用户未勾选该操作'})};
            const r=execRes.results[approvedIdx]||{ok:false,error:'未执行'};
            return {toolCallId:tc.id,content:AIT.buildToolResponse(confirmed.approvedOps[approvedIdx],r)};
          });
        }
      }

      // 3) 回填 assistant + tool 响应（OpenAI 协议要求所有 tool_calls 都有响应，含未知工具的错误回填）
      messages.push({role:'assistant',content:res.content||'',tool_calls:calls.map(tc=>({id:tc.id,type:'function',function:{name:tc.name,arguments:JSON.stringify(tc.args)}}))});
      queryResults.forEach(r=>messages.push({role:'tool',tool_call_id:r.toolCallId,content:r.content}));
      flowResults.forEach(r=>messages.push({role:'tool',tool_call_id:r.toolCallId,content:r.content}));
      unknownResults.forEach(r=>messages.push({role:'tool',tool_call_id:r.toolCallId,content:r.content}));
      writeResults.forEach(r=>messages.push({role:'tool',tool_call_id:r.toolCallId,content:r.content}));
      // 继续下一轮，模型可基于工具响应再调工具或给总结
    }
    return {content:'',lastToolResults,lastBatchIds,lastBatchId,wfId:undefined,wfStepId:undefined,wfDone:undefined};
  }
  // ===== 工作流引擎（多步长任务分步执行：持久化草稿 → 确认 → 逐步执行 → 收束/完成） =====
  /** 取工作流（按 id；同时容忍 chatId 关联记录） */
  function wfFind(wfId){
    if(!wfId)return null;
    return ((typeof DB!=='undefined'&&Array.isArray(DB.aiWorkflows))?DB.aiWorkflows:[]).find(w=>w&&w.id===wfId)||null;
  }
  /** 持久化：脏数组保护 + 新单排前 + 保留上限 */
  function wfPersist(){
    if(typeof DB==='undefined')return;
    if(!Array.isArray(DB.aiWorkflows))DB.aiWorkflows=[];
    DB.aiWorkflows.sort((a,b)=>(b&&b.createdAt||0)-(a&&a.createdAt||0));
    if(DB.aiWorkflows.length>WF_HISTORY_LIMIT)DB.aiWorkflows.length=WF_HISTORY_LIMIT;
    if(typeof saveDB==='function')saveDB();
  }
  /** 校验并生成执行计划草稿（flow_start_workflow 拦截入口；不入库任何业务操作） */
  function wfCreateDraft(rawArgs,chatId){
    const args=(rawArgs&&typeof rawArgs==='object')?rawArgs:{};
    const goal=String(args.goal||'').trim();
    if(!goal)return {ok:false,error:'goal 不能为空'};
    if(goal.length>600)return {ok:false,error:'goal 过长（<=600 字）'};
    if(!Array.isArray(args.steps)||args.steps.length<2||args.steps.length>WF_MAX_STEPS)return {ok:false,error:'steps 需为 2-'+WF_MAX_STEPS+' 步的数组'};
    const steps=[];
    for(let i=0;i<args.steps.length;i++){
      const s=args.steps[i]||{};
      const title=String(s.title||'').trim();
      if(!title)return {ok:false,error:'steps['+i+'].title 不能为空'};
      if(title.length>80)return {ok:false,error:'steps['+i+'].title 过长（<=40 字）'};
      const description=(s.description===undefined||s.description===null)?'':String(s.description).trim();
      if(description.length>500)return {ok:false,error:'steps['+i+'].description 过长（<=400 字）'};
      steps.push({title,description,status:'pending',summary:''});
    }
    const now=Date.now();
    const wf={id:uid('WF'),chatId:String(chatId||''),status:'draft',goal,steps,current:-1,createdAt:now,updatedAt:now};
    if(typeof DB==='undefined')DB={aiWorkflows:[]};
    if(!Array.isArray(DB.aiWorkflows))DB.aiWorkflows=[];
    DB.aiWorkflows.push(wf);
    wfPersist();
    return {ok:true,wfId:wf.id};
  }
  /** 用户确认计划 → 转为 active（尚未开始执行任何步骤） */
  function wfConfirm(wfId,chatId){
    const wf=wfFind(wfId);
    if(!wf)return {ok:false,error:'执行计划不存在（可能已被清理），请重新发起'};
    if(wf.status!=='draft')return {ok:false,error:'计划当前状态不可确认：'+wf.status};
    wf.chatId=String(chatId||wf.chatId||'');
    wf.status='active';wf.current=-1;wf.startedAt=Date.now();wf.updatedAt=Date.now();
    wf.steps.forEach(s=>{s.status='pending';s.summary='';});
    wfPersist();
    return {ok:true};
  }
  /** 推进到下一步（active 且顺序执行；正在执行的步骤未结束时不允许重复推进） */
  function wfStepStart(wfId){
    const wf=wfFind(wfId);
    if(!wf)return {ok:false,error:'执行计划不存在'};
    if(wf.status!=='active')return {ok:false,error:'计划未处于执行中（当前状态：'+(wf.status||'unknown')+'）'};
    if(wf.current>=0&&wf.steps[wf.current]&&wf.steps[wf.current].status==='active')return {ok:false,error:'上一步骤尚未结束'};
    let idx=wf.current+1;
    while(idx<wf.steps.length&&wf.steps[idx].status==='done')idx++;
    if(idx>=wf.steps.length){
      wf.status='done';wf.completedAt=Date.now();wf.updatedAt=Date.now();
      wfPersist();
      return {ok:true,finished:true};
    }
    wf.steps[idx].status='active';wf.current=idx;wf.updatedAt=Date.now();
    wfPersist();
    return {ok:true,stepIdx:idx,step:{title:wf.steps[idx].title,description:wf.steps[idx].description}};
  }
  /** 步骤完成：记录收束摘要（含该步产生的 aiOps batchId，供整步一键撤销）；全部完成后计划置 done */
  function wfStepDone(wfId,summary,batchIds){
    const wf=wfFind(wfId);
    if(!wf)return {ok:false,error:'执行计划不存在'};
    if(wf.status!=='active'||wf.current<0||!wf.steps[wf.current]||wf.steps[wf.current].status!=='active')return {ok:false,error:'没有进行中的步骤可标记完成'};
    const st=wf.steps[wf.current];
    st.status='done';
    st.summary=(summary===undefined||summary===null)?'':String(summary).slice(0,500);
    if(Array.isArray(batchIds)&&batchIds.length){
      st.batchIds=(st.batchIds||[]).concat(batchIds.filter(Boolean));
      if(st.batchIds.length>WF_MAX_STEPS*2)st.batchIds=st.batchIds.slice(-WF_MAX_STEPS*2);
    }
    wf.updatedAt=Date.now();
    if(wf.current>=wf.steps.length-1){wf.status='done';wf.completedAt=Date.now();}
    wfPersist();
    return {ok:true,finished:wf.status==='done'};
  }
  /** 中止执行（出错/超轮次等）；status 可指定 'aborted' 或 'cancelled' */
  function wfAbort(wfId,reason,status){
    const wf=wfFind(wfId);
    if(!wf)return {ok:false,error:'执行计划不存在'};
    wf.status=status||'aborted';
    wf.endReason=String(reason||'');
    if(wf.current>=0&&wf.steps[wf.current]&&wf.steps[wf.current].status==='active')wf.steps[wf.current].status='pending';
    wf.updatedAt=Date.now();
    wfPersist();
    return {ok:true};
  }
  /** 删除聊天记录时清理其关联工作流（避免孤儿计划占用） */
  function wfCleanupChat(chatId){
    if(!chatId||typeof DB==='undefined'||!Array.isArray(DB.aiWorkflows))return;
    const before=DB.aiWorkflows.length;
    DB.aiWorkflows=DB.aiWorkflows.filter(w=>w.chatId!==chatId);
    if(DB.aiWorkflows.length!==before&&typeof saveDB==='function')saveDB();
  }
  /** 由 AI 主循环执行一个步骤：组装"前序收束+步骤指令"上下文，调用 writeFn 执行，
   *  结束后依据 writeFn 返回（lastBatchIds/content）自动将本步标记 done（或中止），
   *  返回 {ok,stepIdx,result,finished}，供外层决定续跑下一步或收尾。 */
  async function runWorkflowStep(wfId,writeFn){
    if(typeof writeFn!=='function')return {ok:false,error:'执行器不可用'};
    const started=wfStepStart(wfId);
    if(!started.ok)return started;
    if(started.finished)return {ok:true,finished:true};
    const wf=wfFind(wfId);
    if(!wf)return {ok:false,error:'执行计划不存在'};
    const doneSteps=wf.steps.filter((s,i)=>i<wf.current&&s.status==='done');
    const step=wf.steps[wf.current];
    let stepPrompt='你正在执行一个经过用户确认的多步执行计划（当前第'+(wf.current+1)+'/'+wf.steps.length+'步）。\n\n【计划总目标】'+wf.goal+'\n';
    if(doneSteps.length){
      stepPrompt+='\n【已完成步骤收束（供衔接参考，后续步骤可复用其中出现的 ID/名称/金额）】\n'+
        doneSteps.map((s,i)=>'步骤'+(i+1)+'《'+s.title+'》：'+(s.summary||'（无产出说明）')).join('\n')+'\n';
    }
    stepPrompt+='\n【当前步骤 '+(wf.current+1)+'/'+wf.steps.length+'】《'+step.title+'》\n'+(step.description||'');
    const msgs=[{role:'system',content:stepPrompt}];
    const result=await writeFn(msgs);
    if(result&&result.wfRequestAbort){
      wfAbort(wfId,result.wfRequestAbort,'aborted');
      return {ok:false,stepIdx:wf.current,result,finished:false,error:'已中止：'+result.wfRequestAbort};
    }
    if(result&&result.wfDone){
      // 模型已在单轮内完成了全部目标：将计划整体置 done（当前步及后续步骤直接标记完成）
      const wfAll=wfFind(wfId);
      if(wfAll){
        wfAll.steps.forEach(s=>{if(s.status==='pending'||s.status==='active')s.status='done';});
        wfAll.status='done';wfAll.completedAt=Date.now();wfAll.updatedAt=Date.now();
        wfPersist();
      }
      return {ok:true,stepIdx:wf.current,result,finished:true};
    }
    const batchIds=(result&&Array.isArray(result.lastBatchIds))?result.lastBatchIds:[];
    const summary=result&&result.content?String(result.content).slice(0,500):'';
    const done=wfStepDone(wfId,summary,batchIds);
    if(!done.ok)return {ok:false,stepIdx:wf.current,result,finished:false,error:done.error};
    return {ok:true,stepIdx:wf.current,result,finished:done.finished};
  }

  /** 撤销指定批次的 AI 工具改动（复用持久化 undoBatch，按 op 反向精准回滚，不误伤手动操作）
   *  返回已撤销条数（供 UI 提示）；batchId 无效或已撤销返回 0 */
  function undoLastBatch(batchId){
    if(!batchId||typeof undoBatch!=='function')return 0;
    return undoBatch(batchId);
  }
  function abort(){state.abortReason='manual';if(state.abortController)state.abortController.abort();}

  /** 保存/删除 API Key：明文存 localStorage（三端统一；空串删除）
   *  多模型接入：放开 sk- 前缀校验，自定义端点 Key 非空即可；仅限长度防滥用 */
  async function setDeepseekToken(raw){
    const token=String(raw||'').trim();
    if(token&&token.length>4000){
      throw new Error('API_KEY 过长，无法保存');
    }
    if(token){localStorage.setItem(WEB_KEY_STORAGE,token);}
    else{localStorage.removeItem(WEB_KEY_STORAGE);}
    state.apiKey=token;
    state.hasKey=!!token||/^https?:\/\/(127\.0\.0\.1|localhost)/.test(state.baseUrl||'');
    if(typeof refreshAIStatus==='function')refreshAIStatus();
  }
  /** 读取已保存的 Key 明文（仅设置弹窗编辑态回显用；非编辑状态不展示） */
  async function getDeepseekToken(){
    return readPlainKey();
  }
  async function getDeepseekTokenDraft(){
    const t=await getDeepseekToken();
    return t?'(已保存)':'';
  }

  // 中途退出兜底：若流式回复尚未完成，页面隐藏/关闭时把已入库内容再刷盘一次
  // （配合 sendAIMessage 的流式防抖增量落盘，关弹窗/中途退出都不丢已生成的部分）
  try{if(typeof window!=='undefined'&&typeof saveDB==='function')window.addEventListener('pagehide',function(){if(state.chatting){try{saveDB();}catch(e){}}});}catch(e){}

  return {
    state,runtimeLabel,providerLabel,QUICK_ACTIONS,ALLOWED_MODELS,PRESET_MODELS,DEFAULT_MODEL,DEFAULT_BASE_URL,
    probeProxy,startHealthCheck,buildPreview,buildSystemPrompt,getHistory,persistMessage,
    chat,aiWriteLoop,abort,setModel,setProvider,setDeepseekToken,getDeepseekToken,getDeepseekTokenDraft,
    undoLastBatch,
    wfFind,wfCreateDraft,wfConfirm,wfStepStart,wfStepDone,wfAbort,wfCancel:wfAbort,wfCleanupChat,runWorkflowStep
  };
})();
