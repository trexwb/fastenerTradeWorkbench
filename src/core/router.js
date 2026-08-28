// router.js — 路由 + 状态 + 分页/搜索/筛选 + bindView
/**
 * 订单编辑/详情视图的模块级临时状态变量。
 * @type {Object|null} curOrder - 当前编辑中的订单对象（新建/编辑模式）
 * @type {string|null} curOrderView - 当前查看详情的订单ID
 * @type {Array} _fItems - 编辑模式下的订单行项目数组
 * @type {string} _fMode - 编辑模式标识（'edit'/'new'）
 * @type {string|null} _fOrderId - 当前编辑订单的ID
 * @type {Object|null} _draftOrder - 订单草稿暂存，viewOrderEdit 读取以回填表单
 */
let curOrder = null;
let curOrderView = null;
let _fItems = [];
let _fMode = "";
let _fOrderId = null;
let _draftOrder = null;  // 订单草稿暂存，viewOrderEdit 读取以回填表单

/* =========================================================
   路由
   ========================================================= */
/**
 * 路由与列表视图的全局状态变量（模块级）。
 * @type {string} view - 当前视图 key（如 'dashboard'/'orders'）
 * @type {boolean} sidebarOpen - 侧栏是否展开
 * @type {string} unitSearch - 关联单位检索关键词
 * @type {string} _unitRoleFilter - 关联单位角色筛选
 * @type {string} _unitRatingFilter - 关联单位评级筛选
 * @type {string} orderSearch - 采购订单检索关键词
 * @type {string} bomSearch - BOM 检索关键词
 * @type {string} orderStatusFilter - 采购订单状态筛选
 * @type {number} _unitPage - 关联单位当前页（每页20条）
 * @type {number} _bomPage - BOM 管理当前页
 * @type {number} _pricePage - 价格库当前页（每页20条）
 * @type {number} _orderPage - 采购订单当前页（每页20条）
 * @type {number} PAGE_SIZE - 每页条数常量（20）
 * @type {number} _settlePage - 对账结算当前页
 * @type {Object} _navExpanded - 二级导航展开状态映射
 */
let view='dashboard';
let sidebarOpen=false;
let unitSearch='';       // 关联单位检索关键词
let _unitRoleFilter='';    // 关联单位角色筛选（采购商/供应商/双角色）
let _unitRatingFilter=''; // 关联单位评级筛选（主力/备选/新客）
let orderSearch='';      // 采购订单检索关键词
let bomSearch='';        // BOM检索关键词
let orderStatusFilter=''; // 采购订单状态筛选
let _unitPage=1;         // 关联单位当前页（每页20条）
let _bomPage=1;           // BOM管理当前页
let _pricePage=1;        // 价格库当前页（每页20条）
let _orderPage=1;        // 采购订单当前页（每页20条）
const PAGE_SIZE=20;
let _settlePage=1;  // 对账结算当前页

let _navExpanded={};

/**
 * 侧栏导航配置数组，每项含 key/label/icon，可选 children 二级菜单。
 * @type {Array<{k:string,label:string,icon:string,children?:Array<{k:string,label:string,icon:string}>}>}
 */
const NAV=[
  {k:'dashboard',label:'概览',icon:'grid'},
  {k:'units',label:'关联单位',icon:'building'},
  {k:'specs',label:'属性管理',icon:'tag'},
  {k:'bom',label:'BOM管理',icon:'package'},
  {k:'prices',label:'签约报价',icon:'yuan'},
  {k:'orders',label:'采购订单',icon:'doc'},
  {k:'settlements',label:'对账结算',icon:'wallet', children:[
    {k:'settle-receipt',label:'收款记录',icon:'income'},
    {k:'settle-payment',label:'付款记录',icon:'expense'}
  ]},
  {k:'invoices',label:'发票管理',icon:'receipt', children:[
    {k:'inv-issue',label:'开票记录',icon:'fileUp'},
    {k:'inv-receive',label:'收票记录',icon:'fileDown'}
  ]},
  {k:'data',label:'数据管理',icon:'database'},
];

/* =========================================================
   Hash 路由
   ========================================================= */
/**
 * 将当前视图状态同步到 URL hash。
 * 格式：#/{view} 或 #/{view}/{orderId}
 */
function updateHash(){
  // hash 路由仅在 http/https 协议可用。file:// 与 tauri:// 等自定义协议下
  // history.replaceState 会抛 SecurityError（WebKit 限制），导致 go() 中断、
  // 菜单全部失效、刷新回首页——这些协议改用 localStorage 持久化路由。
  if(!hashRoutingEnabled()){
    try{ localStorage.setItem('fw_last_route', JSON.stringify({view:view, oid:curOrderView||_fOrderId||null, edit:!!curOrder})); }catch(e){}
    return;
  }
  let hash = '#/' + view;
  // 订单详情/编辑：带订单ID
  if(view==='orders' && (curOrderView || _fOrderId)){
    hash += '/' + (curOrderView || _fOrderId);
    if(curOrder) hash += '/edit';
  }
  window.history.replaceState(null, '', hash);
}

/** 当前协议是否支持 hash/history 路由（仅 http/https；file:// 与 tauri:// 自定义协议不支持） */
function hashRoutingEnabled(){ return /^https?:$/.test(window.location.protocol); }

/**
 * 从 URL hash 恢复视图状态。
 * 支持格式：#/{view}、#/{view}/{orderId}、#/{view}/{orderId}/edit
 */
function restoreFromHash(){
  // 非标准协议（file:// / tauri://）：从 localStorage 恢复上次视图
  if(!hashRoutingEnabled()){
    let saved=null;
    try{ saved=JSON.parse(localStorage.getItem('fw_last_route')||'null'); }catch(e){}
    if(!saved||!saved.view) return;
    let validView = NAV.some(function(n){
      return n.k === saved.view || (n.children && n.children.some(c=>c.k===saved.view));
    });
    if(!validView) return;
    view = saved.view;
    if(saved.view==='orders' && saved.oid){
      let o = DB.orders.find(x=>x.id===saved.oid);
      if(o){
        if(saved.edit){
          curOrder = JSON.parse(JSON.stringify(o));
          curOrderView = null;
          _fMode = 'edit';
          _fOrderId = o.id;
          _fItems = curOrder.items || [];
        }else{
          curOrderView = saved.oid;
          curOrder = null;
          _fMode = '';
          _fOrderId = null;
          _fItems = [];
        }
      }
    }
    return;
  }
  let hash = window.location.hash.slice(2); // 去掉 '#/'
  if(!hash) return;
  let parts = hash.split('/').filter(Boolean);
  if(parts.length === 0) return;
  
  let targetView = parts[0];
  let orderId = parts[1] || null;
  let isEdit = parts[2] === 'edit';
  
  // 验证 view 是否有效
  let validView = NAV.some(function(n){
    return n.k === targetView || (n.children && n.children.some(c=>c.k===targetView));
  });
  if(!validView) return;
  
  view = targetView;
  
  // 订单详情/编辑
  if(targetView === 'orders' && orderId){
    let o = DB.orders.find(x=>x.id===orderId);
    if(o){
      if(isEdit){
        // 编辑模式
        curOrder = JSON.parse(JSON.stringify(o));
        curOrderView = null;
        _fMode = 'edit';
        _fOrderId = o.id;
        _fItems = curOrder.items || [];
      }else{
        // 详情模式
        curOrderView = orderId;
        curOrder = null;
        _fMode = '';
        _fOrderId = null;
        _fItems = [];
      }
    }
  }
}

/**
 * 监听 hashchange 事件（前进/后退）。file:// 环境下禁止注册以避免 "Unsafe attempt
 * to load URL from frame" 安全告警（file:// 无前进/后退深链接需求）。
 */
if(hashRoutingEnabled()){
  window.addEventListener('hashchange', function(){
    restoreFromHash();
    render();
  });
}

/**
 * 路由切换，更新视图并重新渲染。
 * @param {string} v - 目标视图 key
 * @returns {void} 无返回值
 */
function go(v){view=v;curOrder=null;curOrderView=null;sidebarOpen=false;updateHash();render();window.scrollTo(0,0);}

/**
 * 渲染整个应用界面，包括侧栏、面包屑和内容区。
 * @returns {void} 无返回值
 */
function render(){
  const app=document.getElementById('app');
  
  // 侧栏导航（支持二级菜单）
  let sideNav='';
  NAV.forEach(function(n){
    if(n.children){
      let isExpanded=_navExpanded[n.k];
      sideNav+='<button class="nav-parent" data-nav-key="'+n.k+'" onclick="toggleNavParent(\''+n.k+'\')">'+icon(n.icon)+'<span>'+n.label+'</span><span class="nav-arrow'+(isExpanded?' expanded':'')+'">'+icon('chevronRight','12')+'</span></button>';
      // C5 修复：用 nav-child-wrap 包裹所有二级按钮，给父级 max-height 动画；子级按钮在 CSS 中做 fade+位移差时
      sideNav+='<div class="nav-child-wrap'+(isExpanded?' expanded':'')+'">';
      if(isExpanded){
        n.children.forEach(function(c){
          sideNav+='<button class="nav-child'+(view===c.k?' active':'')+'" onclick="go(\''+c.k+'\')">'+icon(c.icon)+'<span>'+c.label+'</span></button>';
        });
      }
      sideNav+='</div>';
    }else{
      sideNav+='<button class="'+(view===n.k?'active':'')+'" onclick="go(\''+n.k+'\')">'+icon(n.icon)+'<span>'+n.label+'</span></button>';
    }
  });
  
  // 面包屑（详情页/编辑页支持返回链接）
  let crumb='';
  if(curOrder&&view==='orders'){
    crumb='<a href="javascript:void(0)" onclick="go(\'orders\')" style="color:var(--pri);text-decoration:none">采购订单</a>'+
      '<span style="color:var(--line);margin:0 6px">/</span>'+
      '<span>'+(curOrderView?'查看订单':'编辑订单')+' · '+escHtml(DB.orders.find(function(o){return o.id===curOrder})?.id||'')+'</span>';
  }else if(view==='settle-receipt')crumb='对账结算 / 收款记录';
  else if(view==='settle-payment')crumb='对账结算 / 付款记录';
  else if(view==='inv-issue')crumb='发票管理 / 开票记录';
  else if(view==='inv-receive')crumb='发票管理 / 收票记录';
  else crumb=(NAV.find(function(n){return n.k===view;})||{}).label||'';
  
  let content='';
  switch(view){
    case 'dashboard':content=viewDashboard();break;
    case 'units':content=viewUnits();break;
    case 'specs':content=viewSpecs();break;
    case 'bom':content=viewBOM();break;
    case 'prices':content=viewPrices();break;
    case 'orders':content=curOrder?viewOrderEdit():curOrderView?viewOrderDetail():viewOrders();break;
    case 'settle-receipt':content=viewSettlements('receipt');break;
    case 'settle-payment':content=viewSettlements('payment');break;
    case 'settlements':
      _settleTab = _settleTab || (view==='settle-payment'?'payment':'receipt');
      _settleSubTab = _settleSubTab || 'unpaid';
      _settlePage = _settlePage || 1;
      content=viewSettlements(_settleTab);
      break;
    case 'invoices':content=viewInvoices('issue');break;
    case 'inv-issue':content=viewInvoices('issue');break;
    case 'inv-receive':content=viewInvoices('receive');break;
    case 'data':content=viewData();break;
  }
  app.innerHTML='<div class="app">'+
    '<div class="menu-overlay'+(sidebarOpen?' on':'')+'" onclick="toggleSidebar()"></div>'+
    '<aside class="sidebar'+(sidebarOpen?' open':'')+'">'+
      '<div class="brand">紧固件贸易工作台<small>Fastener Trade Workbench</small></div>'+
      '<nav>'+sideNav+'</nav>'+
      '<div class="side-ft"><a href="https://wiki.edtib.com/%E4%B8%8B%E8%BD%BD%E4%B8%AD%E5%BF%83/%E7%B4%A7%E5%9B%BA%E4%BB%B6%E8%B4%B8%E6%98%93%E4%B8%AA%E4%BA%BA%E5%B7%A5%E4%BD%9C%E5%8F%B0/%E4%B8%8B%E8%BD%BD%E5%9C%B0%E5%9D%80.html" target="_blank" class="side-ft-link">'+icon('download','14')+' 下载工作台</a></div>'+
    '</aside>'+
    '<div class="main">'+
      '<div class="topbar">'+
        '<div class="crumb">'+
          '<span class="hamburger" onclick="toggleSidebar()">'+icon('menu','22')+'</span>'+
          crumb+
        '</div>'+
        '<div class="right">'+
          (fileSync===true&&AI.state.runtime!=='tauri'?'<span class="tag ok" title="本地文件已同步">'+icon('fileText','12')+' 已同步</span>':
           fileSync==='pending'&&AI.state.runtime!=='tauri'?'<span class="tag warn" title="点击数据管理重新授权" style="cursor:pointer" onclick="go(\'data\')">'+icon('alert','12')+' 待授权</span>':'')+
          '<span class="tag info">'+fmtN(DB.orders.length)+' 订单</span>'+
          '<button class="shortcut-btn" onclick="openSearchPanel()" title="全局搜索 (⌘K)">'+icon('search','16')+'</button>'+
          '<button class="shortcut-btn" id="aiTopbarBtn" onclick="openAIAssistant()" title="AI 代理未连接">'+icon('zap','16')+'</button>'+
          '<button class="shortcut-btn" onclick="showShortcutsModal()" title="快捷键 (?)">'+icon('keyboard','14')+'</button>'+
          '<button class="shortcut-btn" onclick="openSettingsModal()" title="设置">'+icon('gear','16')+'</button>'+
          '<button class="theme-tgl" onclick="switchTheme()" id="themeBtn" title="切换主题">'+icon('palette','16')+'</button>'+
        '</div>'+
      '</div>'+
      (function(){
        let dismissed=fileSync===true?false:(
          localStorage.getItem('fw_sync_banner_dismissed')==='1'
        );
        if(AI.state.runtime!=='tauri'&&!dismissed&&fileSync!==true){
          let msg=fileSync==='pending'
            ?'本地文件同步待授权，<a href="javascript:void(0)" onclick="go(\'data\');let b=document.getElementById(\x27_syncBanner\x27);if(b)b.remove()">立即重新授权</a>'
            :'数据未绑定本地文件，<a href="javascript:void(0)" onclick="go(\'data\');let b=document.getElementById(\x27_syncBanner\x27);if(b)b.remove()">前往绑定</a> 防止浏览器清除数据导致丢失';
          return '<div id="_syncBanner" class="sync-banner">'+icon('alert','16')+'<span>'+msg+'</span><button class="sb-dismiss" onclick="let b=document.getElementById(\'_syncBanner\');if(b)b.remove();try{localStorage.setItem(\'fw_sync_banner_dismissed\',\'1\');}catch(e){}" title="关闭">×</button></div>';
        }
        return '';
      })()+
      '<div class="content" id="content">'+content+'</div>'+
      '<footer class="footer">Copyright &copy; 2026 仟标科技 '+APP_VERSION+'</footer>'+
    '</div>'+
  '</div>';
  bindView();
  if(typeof refreshAIStatus==='function')refreshAIStatus();
  // B6：渲染完成后检查 ⌘K 新手引导气泡（只在 dashboard 显示，localStorage 去重）
  if(typeof window.__showCmdKTipIfNeeded==='function'){try{window.__showCmdKTipIfNeeded();}catch(e){}}
  // 模块级首次引导：每个功能模块首次进入显示一次提示（localStorage 去重）
  if(typeof window.__maybeShowModuleGuide==='function'){try{window.__maybeShowModuleGuide(view);}catch(e){}}
}
/**
 * 切换侧栏展开/收起状态。
 * @returns {void} 无返回值
 */
function toggleSidebar(){sidebarOpen=!sidebarOpen;let ov=document.querySelector('.menu-overlay'),sb=document.querySelector('.sidebar');if(ov)ov.classList.toggle('on',sidebarOpen);if(sb)sb.classList.toggle('open',sidebarOpen);}

/**
 * 切换导航菜单的二级子菜单展开/收起。
 * @param {string} k - 导航项 key
 * @returns {void} 无返回值
 */
function toggleNavParent(k){
  _navExpanded[k]=!_navExpanded[k];
  let btn=document.querySelector('.nav-parent[data-nav-key="'+k+'"]');
  if(!btn){render();return;}
  let arrow=btn.querySelector('.nav-arrow');
  if(arrow)arrow.classList.toggle('expanded',_navExpanded[k]);
  // C5：同级紧跟一个 .nav-child-wrap 包裹层（max-height 动画由 CSS 负责），
  //     只做内容注入/清空，不直接操作每个 nav-child 的显隐 → 动画顺滑、语义统一
  let wrap=btn.nextElementSibling;
  if(!wrap||!wrap.classList.contains('nav-child-wrap')){
    // 降级（旧 DOM 残留 / 兜底）：重建
    wrap=document.createElement('div');wrap.className='nav-child-wrap';
    btn.after(wrap);
  }
  if(_navExpanded[k]){
    let navItem=NAV.find(function(n){return n.k===k;});
    if(navItem&&navItem.children){
      let frag=document.createDocumentFragment();
      navItem.children.forEach(function(c){
        let el=document.createElement('button');
        el.className='nav-child'+(view===c.k?' active':'');
        el.setAttribute('onclick','go(\''+c.k+'\')');
        el.innerHTML=icon(c.icon)+'<span>'+c.label+'</span>';
        frag.appendChild(el);
      });
      wrap.innerHTML='';wrap.appendChild(frag);
      // requestAnimationFrame 后再加 expanded 才会触发 transition
      requestAnimationFrame(function(){wrap.classList.add('expanded');});
    }
  }else{
    wrap.classList.remove('expanded');
    // 动画结束后清空子节点，与之前"收起=移除子节点"语义保持一致，
    // 同时避免下次展开时 max-height 先跳再展开
    setTimeout(function(){
      if(!_navExpanded[k]){wrap.innerHTML='';}
    },360);
  }
}

/* 主题切换 */
/**
 * 切换应用主题（精密工坊 → 奶油白 → 暗色 → 精密工坊，三态循环）
 * @description 主题偏好保存到 localStorage('fw_theme')。v1.0.27 起新增暗色主题（夜间护眼）。
 */
function switchTheme(){
  const el=document.documentElement;
  const cur=el.getAttribute('data-theme')||'default';
  const order=['default','cream','dark'];
  const idx=order.indexOf(cur);
  const next=order[(idx+1)%order.length];
  el.setAttribute('data-theme',next);
  try{localStorage.setItem('fw_theme',next);}catch(e){}
  const btn=document.getElementById('themeBtn');
  if(btn){
    const labels={default:'当前：精密工坊·铜（点击切到奶油白）',cream:'当前：奶油白（点击切到暗色·护眼）',dark:'当前：暗色·护眼（点击切回精密工坊）'};
    btn.title=labels[next];
  }
}


/* =========================================================
   设置弹窗（关于 + 版本更新）
   ========================================================= */
/** 设置弹窗更新状态轮询定时器 id */
let _setTimer=null;

/**
 * 打开设置弹窗：展示应用信息与桌面版自动更新入口。
 * @returns {void} 无返回值
 */
function openSettingsModal(){
  const upd=window.Updater;
  const isDesktop=!!upd;
  const envText=IS_TAURI_RUNTIME?'桌面版（Tauri）':'网页版';
  let html='';
  /* Hero 卡片：应用品牌 + 版本信息 */
  html+='<div class="set-hero">'+
    '<div class="set-hero-icon">'+icon('package',22)+'</div>'+
    '<div class="set-hero-body">'+
      '<div class="set-hero-name">紧固件贸易工作台</div>'+
      '<div class="set-hero-version">版本 <span class="tag">'+APP_VERSION+'</span></div>'+
    '</div>'+
  '</div>';
  /* 关于：应用元信息列表 */
  html+='<div class="set-section-hd">'+icon('info',16)+'<span>关于</span></div>'+
    '<div class="set-info-list">'+
      '<div class="set-info-row"><span class="set-label">应用</span><span class="set-value">紧固件贸易工作台</span></div>'+
      '<div class="set-info-row"><span class="set-label">版本</span><span class="set-value">'+APP_VERSION+'</span></div>'+
      '<div class="set-info-row"><span class="set-label">运行环境</span><span class="set-value">'+envText+'</span></div>'+
      '<div class="set-info-row"><span class="set-label">下载中心</span><span class="set-value"><a href="https://wiki.edtib.com/%E4%B8%8B%E8%BD%BD%E4%B8%AD%E5%BF%83/%E7%B4%A7%E5%9B%BA%E4%BB%B6%E8%B4%B8%E6%98%93%E4%B8%AA%E4%BA%BA%E5%B7%A5%E4%BD%9C%E5%8F%B0/%E4%B8%8B%E8%BD%BD%E5%9C%B0%E5%9D%80.html" target="_blank">前往下载地址 →</a></span></div>'+
    '</div>';
  if(!isDesktop){
    html+='<div class="set-section-hd">'+icon('refresh',16)+'<span>版本更新</span></div>'+
      '<div class="set-web-note">网页版不支持自动更新，请使用桌面版（Tauri）以获取在线升级能力。</div>';
  }else{
    html+='<div class="set-section-hd">'+icon('refresh',16)+'<span>版本更新</span></div>'+
      '<div class="set-update-card">'+
        '<label class="set-auto-check">'+
          '<input type="checkbox" id="setAutoUpdate"'+(upd.autoEnabled()?' checked':'')+'/>'+
          '<span>自动检查并后台下载新版本<small style="color:var(--gray);display:block;margin-top:2px">更新完成后重启应用生效</small></span>'+
        '</label>'+
        '<div id="setStatusBox"></div>'+
      '</div>';
  }
  modal('设置',html,'关闭',function(){closeModal();},true);
  if(isDesktop){
    const au=document.getElementById('setAutoUpdate');
    if(au)au.onchange=function(){window.Updater.setAutoEnabled(au.checked);};
    renderSetStatus();
    if(_setTimer)clearInterval(_setTimer);
    _setTimer=setInterval(renderSetStatus,600);
  }
}

/**
 * 刷新设置弹窗内的更新状态区（含动作按钮绑定），轮询调用。
 * @returns {void} 无返回值
 */
function renderSetStatus(){
  const upd=window.Updater;
  const box=document.getElementById('setStatusBox');
  if(!upd){if(_setTimer){clearInterval(_setTimer);_setTimer=null;}return;}
  if(!box){if(_setTimer){clearInterval(_setTimer);_setTimer=null;}return;}
  const st=upd.state;
  const cur=APP_VERSION;
  let h='';
  if(st.status==='downloading'){
    h+='<div class="set-status-text">正在下载 v'+(st.version||'')+'… '+st.progress+'%</div>'+
      '<div class="set-status-bar"><i style="width:'+st.progress+'%"></i></div>';
  }else if(st.status==='ready'){
    h+='<div class="set-status-text ok">'+icon('check',14)+' 更新已就绪（v'+st.version+'），重启应用完成更新</div>'+
      '<div class="set-status-actions"><button type="button" class="btn primary" id="setRelaunchBtn">立即重启</button></div>';
  }else if(st.status==='available'){
    h+='<div class="set-status-text warn">'+icon('alertCircle',14)+' 发现新版本 v'+st.version+'（当前 '+cur+'）'+(st.notes?'<br><span style="color:var(--gray)">'+escHtml(st.notes).slice(0,120)+'</span>':'')+'</div>'+
      '<div class="set-status-actions"><button type="button" class="btn primary" id="setDownloadBtn">下载并安装</button></div>';
  }else if(st.status==='checking'){
    h+='<div class="set-status-text">'+icon('clock',14)+' 正在检查更新…</div>';
  }else if(st.status==='uptodate'){
    h+='<div class="set-status-text ok">'+icon('check',14)+' 已是最新版本（'+cur+'）</div>';
  }else if(st.status==='error'){
    h+='<div class="set-status-text err">'+icon('alertCircle',14)+' 检查更新失败：'+escHtml(st.error)+'</div>';
  }else{
    h+='<div class="set-status-text">当前版本 '+cur+'</div>';
  }
  h+='<div class="set-status-actions"><button type="button" class="btn ghost" id="setCheckBtn">'+icon('refresh',14)+' 检查更新</button></div>';
  box.innerHTML=h;
  const cb=document.getElementById('setCheckBtn');
  if(cb)cb.onclick=function(){window.Updater.check(false);renderSetStatus();};
  const db=document.getElementById('setDownloadBtn');
  if(db)db.onclick=function(){window.Updater.download();renderSetStatus();};
  const rb=document.getElementById('setRelaunchBtn');
  if(rb)rb.onclick=function(){window.Updater.relaunch();};
}

/**
 * 设置关联单位分页页码并刷新列表
 * @param {number} n - 目标页码
 */
function unitPage(n){
  let total=Math.ceil(filterUnitsData().length/PAGE_SIZE)||1;
  _unitPage=Math.max(1,Math.min(n,total));
  refreshUnitList();
}

/**
 * 处理关联单位搜索输入，重置页码并刷新列表
 * @param {string} v - 搜索关键词
 */
function onUnitSearch(v){
  unitSearch=v;_unitPage=1;
  let box=document.querySelector('.search-box');
  if(box){if(v)box.classList.add('has-val');else box.classList.remove('has-val');}
  refreshUnitList();
}

/**
 * 根据角色、评级和关键词筛选关联单位数据
 * @returns {Array} 过滤后的单位数组
 * @description 筛选条件 AND：角色筛选 / 评级筛选 / 关键词搜索（名称/账期/评级/角色/联系人）
 */
function filterUnitsData(){
  let list=DB.units;
  // 角色筛选
  if(_unitRoleFilter==='采购商')list=list.filter(p=>p.roles&&p.roles.includes('采购商'));
  else if(_unitRoleFilter==='供应商')list=list.filter(p=>p.roles&&p.roles.includes('供应商'));
  else if(_unitRoleFilter==='双角色')list=list.filter(p=>p.roles&&p.roles.length===2);
  // 评级筛选
  if(_unitRatingFilter)list=list.filter(p=>p.rating===_unitRatingFilter);
  // 关键词搜索
  if(unitSearch){
    const q=unitSearch.toLowerCase().trim();
    list=list.filter(p=>{
      if(p.name&&p.name.toLowerCase().includes(q))return true;
      if(p.term&&p.term.toLowerCase().includes(q))return true;
      if(p.rating&&p.rating.toLowerCase().includes(q))return true;
      if(p.roles&&p.roles.some(r=>r.toLowerCase().includes(q)))return true;
      if(p.contacts&&p.contacts.some(c=>(c.name&&c.name.toLowerCase().includes(q))||(c.phone&&c.phone.toLowerCase().includes(q))||(c.side&&c.side.toLowerCase().includes(q))||(c.sides&&c.sides.some(s=>s.toLowerCase().includes(q)))))return true;
      return false;
    });
  }
  return list;
}

/**
 * 设置采购订单分页页码并刷新列表
 * @param {number} n - 目标页码
 */
function orderPage(n){
  let total=Math.ceil(filterOrdersData().length/PAGE_SIZE)||1;
  _orderPage=Math.max(1,Math.min(n,total));
  refreshOrderList();
}

/**
 * 处理采购订单搜索输入，重置页码并刷新列表
 * @param {string} v - 搜索关键词
 */
function onOrderSearch(v){
  orderSearch=v;_orderPage=1;
  let box=document.querySelector('.search-box');
  if(box){if(v)box.classList.add('has-val');else box.classList.remove('has-val');}
  refreshOrderList();
}

/**
 * 处理采购订单状态筛选，重置页码并刷新列表
 * @param {string} v - 状态值（''=全部）
 */
function onOrderStatusFilter(v){
  orderStatusFilter=v;_orderPage=1;refreshOrderList();
}

/**
 * 根据状态和关键词筛选采购订单数据（数据层过滤函数）
 * 数据流：DB.orders → 倒序 → 状态筛选 → 关键词筛选 → 返回匹配数组
 * 
 * 搜索范围：
 * - 订单号、项目、联系人、交货期、状态
 * - 采购商名称
 * - 产品属性（类型/标准/直径/硬度/表面/材质）
 * - 备注
 * 
 * @returns {Array} 过滤后的订单数组（已倒序）
 */
function filterOrdersData(){
  let list=DB.orders.slice().reverse(); // 倒序：最新订单在前
  if(orderStatusFilter)list=list.filter(o=>o.status===orderStatusFilter);
  if(orderSearch){
    const q=orderSearch.toLowerCase().trim();
    list=list.filter(o=>{
      if(o.id&&o.id.toLowerCase().includes(q))return true;
      if(o.project&&o.project.toLowerCase().includes(q))return true;
      if(o.buyerContact&&o.buyerContact.toLowerCase().includes(q))return true;
      if(o.delivery){
        if(typeof o.delivery==='object'){
          if([o.delivery.time,o.delivery.address,o.delivery.tracking].some(v=>v&&String(v).toLowerCase().includes(q)))return true;
        }else if(o.delivery.toLowerCase().includes(q))return true;
      }
      if(o.status&&o.status.toLowerCase().includes(q))return true;
      const buyer=pName(o.buyerId);
      if(buyer&&buyer.toLowerCase().includes(q))return true;
      // 搜索产品属性
      if(o.items&&o.items.some(it=>SPEC_FIELDS.some(k=>it[k]&&it[k].toLowerCase().includes(q))))return true;
      if(o.remark&&o.remark.toLowerCase().includes(q))return true;
      return false;
    });
  }
  return list;
}

/**
 * 跳转到订单详情视图
 * @param {string} id - 订单ID
 */
function goOrderView(id){curOrderView=id;curOrder=null;view='orders';updateHash();render();}
/**
 * 跳转到订单编辑视图
 * @param {string} id - 订单ID
 */
function goOrder(id){curOrderView=id;curOrder=null;view='orders';updateHash();render();}



/* =========================================================
   绑定视图事件
   ========================================================= */
/**
 * 绑定当前视图的交互事件（核心初始化函数）
 * 数据流：DOM → 事件绑定 → 业务逻辑函数
 * 
 * 绑定内容：
 * 1. combo组件初始化（属性管理/BOM筛选/报价筛选/结算筛选/发票筛选）
 * 2. 属性管理新增combo（输入后自动添加到列表）
 * 3. BOM筛选combo（类型/标准/直径等）
 * 4. 报价筛选combo（单位/BOM引用）
 * 5. 结算/发票单位筛选combo
 * 6. 订单编辑页采购商combo（选择后更新联系人下拉）
 * 
 * 注意：每次 render() 后都会调用 bindView()，需通过 dataset.bound 防止重复绑定
 * @since v1.0
 */
function bindView(){
  const comboCandidates = document.querySelectorAll(
    '#specadd_type,#specadd_standard,#specadd_diameter,#specadd_hardness,#specadd_surface,#specadd_material,'+
    '#bf_type,#bf_standard,#bf_diameter,#bf_hardness,#bf_surface,#bf_material,'+
    '#pf_type,#pf_standard,#pf_diameter,#pf_hardness,#pf_surface,#pf_material,#pf_unit,#pf_bom,'+
    '#settleUnitFilter,#invUnitFilter,'+
    '.combo'
  );
  comboCandidates.forEach(function(el){ if(el.dataset) delete el.dataset.bound; });
  // 数据管理页：异步更新存储配额显示
  if(view==='data'){setTimeout(updateStorageQuota,100);}
  // 属性管理页：绑定新增 combo（下拉选值或自由输入，输入后自动添加到列表）
  if(view==='specs'){
    SPEC_FIELDS.forEach(function(k){
      let el=document.getElementById('specadd_'+k);
      if(!el||el.dataset.bound)return;
      el.dataset.bound='1';
      combo(el,(DB.specs[k]||[]).map(function(v){return {id:v,label:v};}),function(opt){
        let v=(opt.id||'').trim();
        if(!v)return;
        if(!DB.specs[k])DB.specs[k]=[];
        if(!DB.specs[k].includes(v)){
          DB.specs[k].push(v);
          saveDB();
          toast(SPEC_LABELS[k]+' 已添加：'+v,'success');
          render();
        }
      },'输入或选择新值，自动添加...',true);
    });
    return;
  }
  // 签约报价页：绑定筛选 combo
  if(view==='prices'){
    const unitEl=document.getElementById('pf_unit');
    if(unitEl&&!unitEl.dataset.bound){
      unitEl.dataset.bound='1';
      combo(unitEl,DB.units.filter(u=>u.roles.includes('供应商')).map(u=>({id:u.id,label:u.name,tag:{text:u.rating,cls:u.rating==='主力'?'ok':(u.rating==='新客'?'warn':'gray')}})),opt=>{unitEl.dataset.val=opt.id||'';filterPrices();},'全部供应商',true);
    }
    SPEC_FIELDS.forEach(k=>{
      const el=document.getElementById('pf_'+k);
      if(el&&!el.dataset.bound){
        el.dataset.bound='1';
        combo(el,(DB.specs[k]||[]).map(v=>({id:v,label:v})),opt=>{el.dataset.val=opt.id||'';filterPrices();},SPEC_LABELS[k],true);
      }
    });
    return;
  }
  // BOM管理页：绑定筛选 combo
  if(view==='bom'){
    SPEC_FIELDS.forEach(k=>{
      const el=document.getElementById('bf_'+k);
      if(el&&!el.dataset.bound){
        el.dataset.bound='1';
        combo(el,(DB.specs[k]||[]).map(v=>({id:v,label:v})),opt=>{el.dataset.val=opt.id||'';render();},SPEC_LABELS[k],true);
      }
    });
    return;
  }
  // 结算管理页：绑定单位筛选 combo
  if(view==='settle-receipt'||view==='settle-payment'||view==='settlements'){
    const sUnitEl=document.getElementById('settleUnitFilter');
    if(sUnitEl&&!sUnitEl.dataset.bound){
      sUnitEl.dataset.bound='1';
      const isRcp=view==='settle-receipt'||(view==='settlements'&&_settleTab==='receipt');
      const role=isRcp?'采购商':'供应商';
      const units=DB.units.filter(u=>u.roles.includes(role));
      combo(sUnitEl,units.map(u=>({id:u.id,label:u.name})),function(opt){
        sUnitEl.dataset.val=opt.id||'';
        onSettleUnitFilter(opt.id||'');
      },isRcp?'筛选采购商...':'筛选供应商...',true);
    }
    return;
  }
  // 发票管理页：绑定单位筛选 combo
  if(view==='inv-issue'||view==='inv-receive'||view==='invoices'){
    const iUnitEl=document.getElementById('invUnitFilter');
    if(iUnitEl&&!iUnitEl.dataset.bound){
      iUnitEl.dataset.bound='1';
      const isIssue=view==='inv-issue'||(view==='invoices'&&_invTab==='issue');
      const role=isIssue?'采购商':'供应商';
      const units=DB.units.filter(u=>u.roles.includes(role));
      combo(iUnitEl,units.map(u=>({id:u.id,label:u.name})),function(opt){
        iUnitEl.dataset.val=opt.id||'';
        onInvUnitFilter(opt.id||'');
      },isIssue?'筛选采购商...':'筛选供应商...',true);
    }
    return;
  }
  // 订单编辑页：绑定采购商 combo
  if(view==='orders'&&curOrder){
    const buyerEl=document.getElementById('tf_buyer');
    if(buyerEl&&!buyerEl.dataset.bound){
      buyerEl.dataset.bound='1';
      combo(buyerEl,DB.units.filter(u=>u.roles.includes('采购商')).map(u=>({id:u.id,label:u.name,tag:{text:u.rating,cls:u.rating==='主力'?'ok':(u.rating==='新客'?'warn':'gray')}})),
        opt=>{
          buyerEl.dataset.val=opt.id;
          const u=DB.units.find(x=>x.id===opt.id);
          const contacts=u?(u.contacts||[]).filter(c=>c.side==='采购商'||(c.sides&&c.sides.includes('采购'))):[];
          document.getElementById('tf_contact').innerHTML=contacts.length
            ?contacts.map(c=>'<option value="'+escAttr(c.name)+'">'+escHtml(c.name)+'('+escHtml(c.phone)+')</option>').join('')
            :'<option value="">(无联系人)</option>';
        },'搜索或直接输入采购商...',true);
      // 如果有已选采购商，回填联系人
      const bid=buyerEl.dataset.val;
      if(bid){
        const u=DB.units.find(x=>x.id===bid);
        const o=_fMode==='edit'?DB.orders.find(x=>x.id===_fOrderId):null;
        const draftContact=_draftOrder?_draftOrder.buyerContact:'';
        const contacts=u?(u.contacts||[]).filter(c=>c.side==='采购商'||(c.sides&&c.sides.includes('采购'))):[];
        const cEl=document.getElementById('tf_contact');
        if(cEl){
          cEl.innerHTML=contacts.length
            ?contacts.map(c=>'<option value="'+escAttr(c.name)+'"'+(o&&o.buyerContact===c.name? ' selected':(draftContact&&draftContact===c.name?' selected':''))+'>'+escHtml(c.name)+'('+escHtml(c.phone)+')</option>').join('')
            :'<option value="">(无联系人)</option>';
        }
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   外链处理：Tauri 桌面版 WebView 不处理 target="_blank" 导航，
   点击时改为 invoke Rust open_external 命令用系统浏览器打开；
   浏览器版保持原生行为（target="_blank" 新标签页）。
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener('click', function (e) {
  if (typeof IS_TAURI_RUNTIME === 'undefined' || !IS_TAURI_RUNTIME) return;
  var t = e.target;
  var a = t && t.closest ? t.closest('a[target="_blank"]') : null;
  if (!a || !a.href) return;
  e.preventDefault();
  window.__TAURI__.core.invoke('open_external', { url: a.href })['catch'](function (err) {
    console.error('[router] 打开外部链接失败:', err);
  });
});

/* =========================================================================
   🎯 Coach 引导引擎（每个功能模块首次进入显示一次引导提示）
   - 键：wb_fastener_coach_seen_<view>（localStorage，标记该模块已看过）
   - 数据：Coach.steps[view] = [{title, body, icon, target?, pos?}]
     · target: CSS selector（定位高亮元素，为空则居中气泡）
     · pos: 'top' | 'bottom' | 'left' | 'right'（气泡相对 target 方向）
   - 公开 API：Coach.show(view, force) / Coach.dismiss() / Coach.next() / Coach.prev() / Coach.reset(view?) / Coach.resetAll()
   - 在 router.render() 末尾自动检查 view 是否已看过，未看过则 show(view)
   ========================================================================= */
(function(){
  const LS_PREFIX='wb_fastener_coach_seen_';
  /** 2026-08-29 修「需跳过两次」：两套独立引导系统（旧横幅 wb_fastener_guide_* + 新 Coach 蒙层
   *  wb_fastener_coach_seen_*）并存 → 关闭一套还留另一套 → 用户体感两次。
   *  此处保留旧前缀，用于 reset/resetAll 时**双向同步清理** localStorage；新引导只写 Coach 前缀。 */
  const _OLD_GUIDE_PREFIX='wb_fastener_guide_';
  /** 子路由归并到所属主模块（与旧 guide.js 保持一致，防止 reset('settle-receipt') 漏清理） */
  const _GUIDE_PARENT={'settle-receipt':'settlements','settle-payment':'settlements','inv-issue':'invoices','inv-receive':'invoices'};
  const CFG={
    dashboard:{label:'概览',icon:'layout',steps:[
      {title:'欢迎来到紧固件贸易工作台',body:'这里是你的每日指挥中心：<b>4 张核心指标卡</b>一眼掌握订单数、总金额、寻货中、待确认，下方「今日待办」列出需要你处理的紧急事项。'},
      {target:'.stats',pos:'bottom',title:'4 张关键指标卡',body:'按「订单 / 金额 / 寻货中 / 待确认」四大维度展示，点击进入对应的模块查看详细列表。左侧彩色色条表示数据分类。'},
      {target:'.today-box',pos:'top',title:'今日待办 = 工作清单',body:'每一条都是<b>需要你决策的项</b>：待签约报价、寻货不足、未结清款。点击右侧「处理」按钮即可直达对应页面，处理完会自动从列表中消失。'},
      {target:'.sidebar',pos:'right',title:'11 个功能模块导航',body:'左侧菜单覆盖业务全流程：<b>订单 → 寻货 → 报价 → 签约 → 送货 → 结算 → 发票</b>。每个模块第一次进入都会显示本类型的引导提示。'},
      {title:'💡 隐藏技巧：⌘K 全局命令',body:'任何时候按 <span class="kbd">⌘K</span>（Windows 是 <span class="kbd">Ctrl+K</span>）打开全局命令面板，搜索单号、客户、BOM SKU，或直接向 AI 助手提问，效率提升看得见。'}
    ]},
    units:{label:'关联单位',icon:'users',steps:[
      {title:'关联单位 = 所有往来对象',body:'这里统一管理<b>采购商 / 供应商 / 物流方</b>。后续订单、报价、结算、发票都要从这里选择单位，所以先把客户/供应商录进去吧！'},
      {target:'.toolbar .btn.primary',pos:'bottom',title:'① 新增：从「新建单位」开始',body:'新建时可以同时选择多个角色（例如同一公司既是供应商也是物流方）。结算账期与信用评级后续会出现在结算报表里。'},
      {target:'.filter-bar',pos:'bottom',title:'② 快速筛选：按类型/评级找单位',body:'按角色、评级双维度筛选；搜索框支持输入公司名关键词 <b>回车搜索</b>（§8 约定，避免输入法冲突）。'},
      {title:'③ 批量操作：安全的删除',body:'勾选单位后「批量删除」会弹出影响说明（被引用的订单/报价/结算条数），<b>被引用的不会被删</b>，数据安全有保障。'}
    ]},
    specs:{label:'规格管理',icon:'tag',steps:[
      {title:'规格管理 = 属性可选值集合',body:'这里维护所有属性的<b>下拉可选值</b>：标准、类型、材质、直径、硬度、表面处理、镀层等。BOM 和报价页面的属性下拉框就来源于这里，一次维护处处复用。'},
      {target:'.specs-toolbar',pos:'bottom',title:'① 批量导入导出',body:'「批量导入全部维度」支持从其他系统复制粘贴属性集合；「导出全部」用于给同事或备份。'},
      {title:'② 删除：<span style="color:var(--warn);">灰色</span>标签可安全清理',body:'每个可选值都标注 <b>未使用样式</b>（灰色）——表示任何 BOM / 报价 / 订单都没引用过，可直接删除。常用值保持彩色，不用操心。'}
    ]},
    bom:{label:'BOM 管理',icon:'layers',steps:[
      {title:'BOM = 物料清单（产品数据库）',body:'BOM 是你所有螺栓/螺母的「字典」：每条记录定义一个<b>SKU</b>，包含规格、尺寸、材质、强度、表面处理等技术属性。后续报价/寻货/订单都从 BOM 中选。'},
      {target:'.toolbar .btn.primary',pos:'bottom',title:'① 新建 BOM：一条一条或批量',body:'「新建 BOM」单条新增；「批量导入」支持从 Excel / 表格粘贴多行属性。新入的 SKU 立刻可被报价和订单引用。'},
      {target:'#bomBody tr:nth-child(1) .td-act',pos:'left',title:'② 编辑 / 删除一条',body:'删除时会检查该 SKU 是否被报价 / 订单引用，被引用时会<b>提示不可删</b>，避免数据断裂。'},
      {title:'③ SKU 命名：保持一致',body:'建议保持 <b>类型-标准-尺寸-材质</b> 的命名规则，例如「六角螺栓-GB5783-M10x40-8.8级-发黑」，后续搜索与对帐非常省心。'}
    ]},
    prices:{label:'报价管理',icon:'wallet',steps:[
      {title:'报价管理 = 供应商询价簿',body:'这里记录<b>每个供应商</b>对不同 SKU 的<b>采购单价</b>，有效期与联系人信息。当采购订单进入「寻货」阶段，系统会自动按 SKU 匹配这里最低的供应商报价。'},
      {target:'.toolbar .btn.primary',pos:'bottom',title:'① 新增报价：选供应商 + BOM SKU + 单价',body:'同一个 SKU 可以有多个供应商的报价，寻货时会按<b>单价从低到高</b>自动排序推荐，同时保留历史价供你对比。'},
      {target:'.filter-bar',pos:'bottom',title:'② 多维筛选：快速找最低价',body:'按供应商 / BOM SKU / 规格 / 属性四个维度组合筛选，右上角搜索框支持输入联系人或公司名 <b>回车搜索</b>。'},
      {title:'③ 报价过期怎么处理？',body:'每张报价都有「有效期起」，超过 90 天的价格会在寻货阶段显示<b>黄色提醒</b>，提示你联系供应商确认最新价，避免用旧价接单亏本。'}
    ]},
    orders:{label:'采购订单',icon:'fileText',steps:[
      {title:'采购订单 = 业务核心驱动',body:'订单是整个工作台的中心：从「待确认 → 寻货中 → 报价中 → 签约完成 → 送货中 → 已完成」全程流转，每一步有 Excel 导出来对接对方，寻货与报价自动调用报价数据库匹配。'},
      {target:'.toolbar .btn.primary',pos:'bottom',title:'① 新建订单：采购方 + 产品明细 + 交期',body:'创建时录入采购商、项目、交期，产品明细逐条或批量从 BOM 选择。<b>新增/删除产品会自动保存</b>，不用手动点「保存订单」。'},
      {target:'#orderBody tr:nth-child(1) .tag',pos:'top',title:'② 状态流转：点击「查看」→ 点按钮前进',body:'标签颜色对应流程阶段：灰色→绿色→橙色→蓝色。每个状态下的「查看/详情」页顶部有<b>进入下一状态</b>按钮（如寻货 → 报价 → 签约）。'},
      {target:'#orderBody tr:nth-child(1) .td-act',pos:'left',title:'③ 查看 vs 编辑',body:'<b>查看</b>：只读详情，寻货入口在这里的「寻源状态」列（不足量才显示按钮）。<b>编辑</b>：改表单字段或产品明细。§8 约定——寻货只能在详情页操作。'},
      {title:'④ 5 种状态对应 5 种 Excel 导出模板',body:'点击「导出 Excel」时系统根据当前状态选择模板：<b>待确认→产品确认单 / 寻货中→寻源进度单 / 报价中→报价单 / 签约→结算单 / 送货→送货单</b>，不用再手动挑模板。'}
    ]},
    settlements:{label:'结算管理',icon:'dollarSign',steps:[
      {title:'结算管理 = 对帐中心',body:'按「应收（向客户收钱）/ 应付（向供应商付钱）」两条线管理，每个单位显示：<b>总额 · 已收/已付 · 未收/未付</b> + 进度条与状态标签，一清二楚。'},
      {target:'.settle-tabs',pos:'bottom',title:'① 切换：应收 / 应付 / 未结',body:'顶部三个主 Tab 分别是「应收账款 · 应付账款 · 全部」；每个主 Tab 还有「未结清 / 已结清」子 Tab，非常适合做月度对帐。'},
      {target:'table tbody tr:nth-child(1) .td-act',pos:'left',title:'② 看明细 / 新增结算记录',body:'点「明细」打开右侧抽屉：展示每个订单的应收/已收明细；点「新增结算」录入一笔收款或付款，金额自动累计到进度条。'},
      {title:'③ 红色未结清 = 重点追踪',body:'未收/未付列显示<b>红色数值</b> + 进度条未满 = 还有钱没收/没付，按单位行直接点新增结算记录即可补账，闭环非常直接。'}
    ]},
    invoices:{label:'发票管理',icon:'receipt',steps:[
      {title:'发票管理 = 开票/收票跟踪',body:'与结算记录联动，管理<b>采购方向我们开票（应收）</b>与<b>我们给供应商开票（应付）</b>两种场景，跟踪每张发票的状态：「未开票 / 已开票未到 / 已到票 / 已认证」。'},
      {target:'.settle-tabs',pos:'bottom',title:'① Tab 分场景：应收/应付 × 未结清/已结清',body:'与结算管理类似的分组结构，做月度税务核对非常直观。建议每月月初把上月「未开票 → 已开票」状态点进编辑改成已开票。'},
      {target:'table tbody tr:nth-child(1) .td-act',pos:'left',title:'② 编辑发票：录入号码/日期/金额',body:'点「编辑」打开抽屉，发票号、开票日期、金额、附件说明都可以记录。未结清状态的发票<b>会自动出现在对帐单导出中</b>。'},
      {title:'③ 与结算的关系',body:'一张结算单下可以多次开票；建议：一笔收款或付款 → 记录结算 → 收到/开出对应发票 → 去发票管理更新状态，保证财务三条线（收款/付款/发票）对齐。'}
    ]},
    data:{label:'数据管理',icon:'database',steps:[
      {title:'数据管理 = 数据的保险柜',body:'整个系统所有数据（单位 / BOM / 报价 / 订单 / 结算 / 发票）都保存在浏览器的 IndexedDB 中，通过这里统一<b>导出备份 / 导入恢复 / 绑定本地文件</b>做持久化。'},
      {target:'.btn.primary[data-action="export"]',pos:'bottom',title:'① 强烈建议：立刻导出一个 JSON 备份',body:'浏览器清理缓存或切换设备前先导出备份，下次用「导入 JSON」就能恢复到任意机器。'},
      {target:'.btn.primary[data-action="bind-dir"]',pos:'top',title:'② 进阶：绑定本地文件夹 = 自动同步',body:'绑定一个文件夹后，系统会把所有数据写入「紧固件贸易工作台_数据.json」；换电脑、换浏览器只要打开这同一个文件夹就能拿到最新数据，这是<b>最佳实践</b>。'},
      {title:'③ 重置示例数据 / 清空：有保护机制',body:'重置和清空会经过二次确认（显示影响条目数），绑定了文件也不会清空目标文件，放心使用。'}
    ]},
    keyboard:{label:'快捷键',icon:'command',steps:[
      {title:'快捷键 = 效率倍增开关',body:'把高频操作全部集中到键盘，尤其是全局命令面板 <span class="kbd">⌘K</span>。这里可以看到完整的快捷键列表，并能切换启用/禁用。'},
      {title:'⌘K 能做什么？',body:'① 搜索订单 / 报价 / BOM SKU 并直接跳转；② 输入自然语言问题让 AI 助手分析数据；③ 快速新建单位/订单/报价。真正的全局入口。'}
    ]},
    'ai-chat':{label:'AI 助手',icon:'sparkles',steps:[
      {title:'AI 助手 = 你的业务数据分析师',body:'这里可以用自然语言向 AI 提问，AI 使用<b>当前数据库的脱敏快照</b>回答（金额、余额、排名都以本地数据为准），不会编造单位名或订单号，放心用。'},
      {target:'.ai-input-area .ai-send',pos:'top',title:'① 输入问题后发送',body:'试试问：「本月有哪些订单还没确认？」「供应商 X 最近 3 个月平均单价？」—— 支持中文。'},
      {target:'.ai-key-btn',pos:'bottom',title:'② 需要先设置 API Key（浏览器版）',body:'浏览器版本用户点右上角「AI 🔑」输入你的 DeepSeek API Key 后存 localStorage；密钥只保存在<b>你这台设备上</b>，我们不收集。'},
      {title:'③ Function Calling：AI 会先问你再写入',body:'当你让 AI 「创建一个新单位 XX 公司」时，AI 不会直接写入数据库，而是<b>先生成提案让你逐条确认</b>，点执行才真正写入；写入记录在 aiOps 可回滚，符合安全操作习惯。'}
    ]}
  };

  /* === 引擎 === */
  const state={view:null,step:0,el:null,onEsc:null,raf:null,ro:null};
  /** 去抖 id：同一 view 在短时间内多次 __maybeShowModuleGuide 时，只保留最后一次触发 */
  let _showTimer=null;
  /** 去抖 view：用于校验是否真正切换了模块（同模块连续触发时清上一个 timer） */
  let _showTimerView=null;

  function _key(v){return LS_PREFIX+v;}
  function _hasSeen(v){try{return !!localStorage.getItem(_key(v));}catch(e){return false;}}
  function _markSeen(v){try{localStorage.setItem(_key(v),'1');}catch(e){}}
  function _renderStep(view,stepIdx){
    const conf=CFG[view];if(!conf)return;
    const s=conf.steps[stepIdx];if(!s)return;
    const overlay=document.querySelector('.coach-overlay');
    const hole=overlay.querySelector('.coach-hole');
    const card=overlay.querySelector('.coach-card');

    /* 1) 找 target 元素并计算尺寸 */
    let target=null;
    try{target=s.target?document.querySelector(s.target):null;}catch(e){target=null;}
    const rect=target && target.getBoundingClientRect && target.offsetParent!==null ? target.getBoundingClientRect() : null;
    const h=rect && rect.width>0 && rect.height>0;

    // 孔
    if(h && rect.top>=-4 && rect.left>=-4 && rect.bottom<=window.innerHeight+4 && rect.right<=window.innerWidth+4){
      hole.style.display='block';
      const pad=8;
      hole.style.left=(rect.left-pad)+'px';
      hole.style.top=(rect.top-pad)+'px';
      hole.style.width=(rect.width+pad*2)+'px';
      hole.style.height=(rect.height+pad*2)+'px';
    }else{
      hole.style.display='none';
    }

    // 2) 定位方向（默认居中；有 rect 时根据位置选择 top/bottom/left/right）
    card.classList.remove('is-flanking','is-top','is-bottom','is-left','is-right');
    card.style.top='';card.style.left='';card.style.right='';card.style.bottom='';
    card.style.setProperty('--cc-arrow-x','40px');
    card.style.setProperty('--cc-arrow-y','24px');

    // 窄屏：不做 flanking，统一底部 sheet（CSS @media 已接管）
    const narrow=window.matchMedia('(max-width:640px)').matches;
    if(h && !narrow){
      const MARGIN=12;
      // 默认方向：优先下方，下方不够放上方；左右放不下则居中
      let pos=s.pos||'bottom';
      const CW=Math.min(420,window.innerWidth*0.92);
      const CH=card.offsetHeight||240;
      if(pos==='auto'){
        if(rect.bottom+CH+MARGIN<window.innerHeight)pos='bottom';
        else if(rect.top-CH-MARGIN>0)pos='top';
        else if(rect.left-CW-MARGIN>0)pos='left';
        else pos='right';
      }
      card.classList.add('is-flanking','is-'+pos);
      const vCx=Math.min(window.innerWidth-16,Math.max(16,rect.left+rect.width/2));
      let cardLeft=Math.min(window.innerWidth-CW-16, Math.max(16, vCx-CW/2));
      let arrowX=vCx-cardLeft;
      if(pos==='top'||pos==='bottom'){
        if(pos==='top'){card.style.top=(rect.top-card.offsetHeight-MARGIN-14)+'px';}
        else{card.style.top=(rect.bottom+MARGIN+14)+'px';}
        card.style.left=cardLeft+'px';
        card.style.setProperty('--cc-arrow-x',Math.max(20,Math.min(CW-34,arrowX))+'px');
      }else{
        // left/right
        const vCy=Math.min(window.innerHeight-16,Math.max(16,rect.top+rect.height/2));
        let cardTop=Math.min(window.innerHeight-CH-16, Math.max(16, vCy-CH/2));
        if(pos==='left'){card.style.left=(rect.left-CW-MARGIN-14)+'px';}
        else{card.style.left=(rect.right+MARGIN+14)+'px';}
        card.style.top=cardTop+'px';
        card.style.setProperty('--cc-arrow-y',Math.max(20,Math.min(CH-34,vCy-cardTop))+'px');
      }
    }

    // 3) 重新渲染卡片内容（标题/正文/步骤）
    const iconName=s.icon||conf.icon||'zap';
    const total=conf.steps.length;
    card.innerHTML='';
    // 构建 head
    const head=document.createElement('div');
    head.className='coach-head';
    head.innerHTML='<div style="display:flex;align-items:flex-start;gap:12px">'+
      '<div class="coach-icon">'+(typeof icon==='function'?icon(iconName,'18'):'✨')+'</div>'+
      '<div>'+
        '<h3>'+s.title+'</h3>'+
        '<div class="coach-module">'+(conf.label||view)+' 模块引导</div>'+
      '</div></div>'+
      '<button class="coach-close" aria-label="关闭" title="关闭">×</button>';
    head.querySelector('.coach-close').addEventListener('click',function(){Coach.dismiss();});
    card.appendChild(head);
    // body
    const body=document.createElement('div');
    body.className='coach-body';
    body.innerHTML=s.body||'';
    card.appendChild(body);
    // foot
    const foot=document.createElement('div');
    foot.className='coach-foot';
    const showPrev=stepIdx>0;
    const isLast=stepIdx>=total-1;
    foot.innerHTML=''+
      '<button class="coach-skip">跳过</button>'+
      '<div class="coach-meta">第 <span class="coach-step">'+(stepIdx+1)+'</span> / '+total+' 步</div>'+
      '<div class="coach-actions">'+
        (showPrev?'<button class="btn">上一步</button>':'')+
        '<button class="btn primary">'+(isLast?'我知道了 ✓':'下一步 →')+'</button>'+
      '</div>';
    foot.querySelector('.coach-skip').addEventListener('click',function(){Coach.dismiss();});
    const btns=foot.querySelectorAll('.coach-actions .btn');
    let actIdx=0;
    if(showPrev){btns[actIdx++].addEventListener('click',Coach.prev);}
    btns[actIdx].addEventListener('click',isLast?function(){Coach.dismiss();}:Coach.next);
    card.appendChild(foot);
  }

  function _ensureOverlay(view){
    // 同 view 已有 overlay → 直接复用（不要 dismiss(true) 又重造 → 产生"闪一下重铺"体验）
    const curExist=document.querySelector('.coach-overlay');
    if(curExist && state.view===view)return curExist;

    // 切换模块：旧模块隐式跳过 → 写 seen
    if(state.view && state.view !== view){try{_markSeen(state.view);}catch(e){}}
    Coach.dismiss(true);

    const overlay=document.createElement('div');
    overlay.className='coach-overlay';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label', (CFG[view]&&CFG[view].label||view)+' 模块引导');
    // hole
    const hole=document.createElement('div');hole.className='coach-hole';hole.setAttribute('aria-hidden','true');
    // card
    const card=document.createElement('div');card.className='coach-card';
    overlay.appendChild(hole);overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Esc 关闭 + 点击遮罩背景（非卡片区）关闭
    const onKey=function(e){if(e.key==='Escape')Coach.dismiss();};
    document.addEventListener('keydown',onKey);
    state.onEsc=onKey;
    overlay.addEventListener('click',function(e){
      if(e.target===overlay)Coach.dismiss();
    });
    state.el=overlay;
    // ResizeObserver + rAF 重定位（当 target 元素是动态表格时）
    const reposition=function(){
      cancelAnimationFrame(state.raf);
      state.raf=requestAnimationFrame(function(){_renderStep(state.view,state.step);});
    };
    window.addEventListener('resize',reposition);
    window.addEventListener('scroll',reposition,true);
    state._cleanup=function(){
      window.removeEventListener('resize',reposition);
      window.removeEventListener('scroll',reposition,true);
    };
    return overlay;
  }

  const Coach={
    cfg:CFG,
    /** 显示某模块引导。force=true 强制忽略已看过标记
     *  幂等门闩：若该 view 已经在展示中（state.view===view && 存在 overlay DOM），直接 return，
     *  防止同模块多个 setTimeout 排队导致"弹两次"的视觉体验。
     */
    show:function(view,force){
      const conf=CFG[view];if(!conf||!conf.steps||!conf.steps.length)return;
      if(!force && _hasSeen(view))return;
      // 幂等：同 view 已挂着 overlay 就不要重新铺了（用户感知为出现两次）
      if(!force && state.view===view && document.querySelector('.coach-overlay'))return;
      _ensureOverlay(view);
      state.view=view;state.step=0;
      _renderStep(view,0);
    },
    next:function(){
      const n=CFG[state.view]&&CFG[state.view].steps.length;if(!n)return;
      if(state.step<n-1){state.step++;_renderStep(state.view,state.step);}
      else Coach.dismiss();
    },
    prev:function(){
      if(state.step>0){state.step--;_renderStep(state.view,state.step);}
    },
    dismiss:function(silent){
      if(state.onEsc){document.removeEventListener('keydown',state.onEsc);state.onEsc=null;}
      if(state._cleanup){try{state._cleanup();}catch(e){}state._cleanup=null;}
      cancelAnimationFrame(state.raf);

      // 关键点：**任何模式下都同步清除 document.body 下所有残留的 .coach-overlay**，
      // 防止"漏网 overlay"堆叠导致用户要点两次跳过。（之前只删 state.el 引用的那个，
      // 一旦 state.el 引用被异步 dismiss 160ms 动画期间 state.el 置空/重写 → 旧 overlay
      // 永远留在 DOM，新 overlay appendChild 后上下两层叠一起 = 点一次跳过只关上面那层）
      const remain=document.querySelectorAll('body > .coach-overlay');
      remain.forEach(function(el){
        try{el.style.opacity='0';el.style.transition='opacity .18s ease';}catch(e){}
        // 160ms 动画结束后 remove。无论 state.el 引用是否一致都删，避免多层堆叠。
        setTimeout(function(){try{el.remove();}catch(e){}},180);
      });

      const wasView=state.view;
      // 任何模式都清 state：避免 dismiss(true) 之后幂等判断 state.view===view 出错
      state.el=null;state.view=null;state.step=0;

      // 只有非 silent（即用户明确跳过 / Esc / 走完流程 / 点遮罩）才写已看过标记。
      // silent（show 前清旧 overlay / reset 路径）不写 LS。
      // 注意：用 silent!==true 而非 !silent —— 防御事件监听器把 MouseEvent 当第一个
      // 参数传入（truthy）导致用户点了跳过却不写 seen、引导重复出现。
      if(silent!==true && wasView){_markSeen(wasView);}
    },
    /** 重置单模块或全部（用于测试/调试/用户要求重新看引导）
     *  同步清理两套 localStorage 命名空间：
     *    · wb_fastener_coach_seen_<view>   (现行 Coach 全屏蒙层)
     *    · wb_fastener_guide_<view>        (旧横幅引导，2026-08-29 已废弃，但用户浏览器里可能仍有历史值)
     *  避免 reset 后旧横幅又冒出来 → 再次形成"关两次"的体感。
     */
    reset:function(view){
      if(view){
        try{localStorage.removeItem(_key(view));}catch(e){}
        try{localStorage.removeItem(_OLD_GUIDE_PREFIX + (_GUIDE_PARENT[view]||view));}catch(e){}
      }else Coach.resetAll();
    },
    resetAll:function(){
      try{
        Object.keys(CFG).forEach(function(v){
          localStorage.removeItem(_key(v));
          localStorage.removeItem(_OLD_GUIDE_PREFIX + (_GUIDE_PARENT[v]||v));
        });
      }catch(e){}
    }
  };
  window.Coach=Coach;

  /* render() 末尾钩子：未看过则自动展示。
   *  去抖：同一模块若在 500ms 内连续多次 render 触发 __maybeShowModuleGuide，
   *  只保留最后一个 setTimeout，避免多个 show 排队导致"同一引导连续弹两次"。
   *  （典型：冷启动 bootApp/initApp/数据恢复 多处先后 render 同个 dashboard）
   */
  window.__maybeShowModuleGuide=function(view){
    if(!view||!CFG[view])return;
    // 同模块重复进来：清上一个定时器，重置
    if(_showTimer){clearTimeout(_showTimer);_showTimer=null;}
    _showTimerView=view;
    _showTimer=setTimeout(function(){
      const cur=_showTimer;
      try{Coach.show(view);}catch(e){}
      // show 执行成功后清引用
      if(_showTimer===cur){_showTimer=null;_showTimerView=null;}
    },200);
  };
})();
