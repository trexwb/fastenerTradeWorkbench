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
  let hash = '#/' + view;
  // 订单详情/编辑：带订单ID
  if(view==='orders' && (curOrderView || _fOrderId)){
    hash += '/' + (curOrderView || _fOrderId);
    if(curOrder) hash += '/edit';
  }
  window.history.replaceState(null, '', hash);
}

/**
 * 从 URL hash 恢复视图状态。
 * 支持格式：#/{view}、#/{view}/{orderId}、#/{view}/{orderId}/edit
 */
function restoreFromHash(){
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
 * 监听 hashchange 事件（前进/后退）
 */
window.addEventListener('hashchange', function(){
  restoreFromHash();
  render();
});

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
      if(isExpanded){
        n.children.forEach(function(c){
          sideNav+='<button class="nav-child'+(view===c.k?' active':'')+'" onclick="go(\''+c.k+'\')">'+icon(c.icon)+'<span>'+c.label+'</span></button>';
        });
      }
    }else{
      sideNav+='<button class="'+(view===n.k?'active':'')+'" onclick="go(\''+n.k+'\')">'+icon(n.icon)+'<span>'+n.label+'</span></button>';
    }
  });
  
  // 面包屑
  let crumb='';
  if(view==='settle-receipt')crumb='对账结算 / 收款记录';
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
          escHtml(crumb)+
        '</div>'+
        '<div class="right">'+
          (fileSync===true&&AI.state.runtime!=='tauri'?'<span class="tag ok" title="本地文件已同步">'+icon('fileText','12')+' 已同步</span>':
           fileSync==='pending'&&AI.state.runtime!=='tauri'?'<span class="tag warn" title="点击数据管理重新授权" style="cursor:pointer" onclick="go(\'data\')">'+icon('alert','12')+' 待授权</span>':'')+
          '<span class="tag info">'+fmtN(DB.orders.length)+' 订单</span>'+
          '<button class="shortcut-btn" id="aiTopbarBtn" onclick="openAIAssistant()" title="AI 代理未连接">'+icon('zap','16')+'</button>'+
          '<button class="shortcut-btn" onclick="showShortcutsModal()" title="快捷键 (?)">'+icon('keyboard','14')+'</button>'+
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
      btn.after(frag);
    }
  }else{
    let next=btn.nextElementSibling;
    while(next&&next.classList.contains('nav-child')){
      let rm=next;next=next.nextElementSibling;rm.remove();
    }
  }
}

/* 主题切换 */
/**
 * 切换应用主题（默认 ↔ 奶油白）
 * @description 主题偏好保存到 localStorage('fw_theme')
 */
function switchTheme(){
  const el=document.documentElement;
  const cur=el.getAttribute('data-theme')||'default';
  const next=cur==='default'?'cream':'default';
  el.setAttribute('data-theme',next);
  try{localStorage.setItem('fw_theme',next);}catch(e){}
  const btn=document.getElementById('themeBtn');
  if(btn)btn.title=next==='cream'?'切换精密工坊':'切换奶油白';
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
      if(o.delivery&&o.delivery.toLowerCase().includes(q))return true;
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

