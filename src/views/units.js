// views/units.js — 关联单位管理
/* =========================================================
   关联单位管理
   ========================================================= */
/** 关联单位新建/编辑保存防重锁 */
let _unitSaving=false;
/** 统计关联单位的角色分布和联系人覆盖情况
 * @returns {Object} 统计结果对象，含total/buyers/suppliers/both/noContacts
 */
function unitCounts(){
  const total=DB.units.length;
  let buyers=0, suppliers=0, both=0, noContacts=0;
  for(let i=0;i<total;i++){
    const u=DB.units[i];
    const r=u.roles;
    if(r&&r.includes('采购商'))buyers++;
    if(r&&r.includes('供应商'))suppliers++;
    if(r&&r.length===2)both++;
    if(!u.contacts||!u.contacts.length)noContacts++;
  }
  return {total,buyers,suppliers,both,noContacts};
}

/** 渲染单个联系人信息行 HTML（单位行内嵌，含脱敏电话与悬浮提示）
 * @param {Object} c - 联系人对象（name/phone/wechat/side/sides）
 * @returns {string} .ci-row HTML
 */
function unitContactRowHTML(c){
  const name=escHtml(c.name||'');
  const phone=escHtml(c.phone||'');
  const wechat=escHtml(c.wechat||'');
  const maskedPhone=phone.length>4?phone.slice(0,-4).replace(/./g,'*')+phone.slice(-4):phone;
  const sideTag=((c.sides||[c.side]).includes('采购')||c.side==='采购商')?'采':'供';
  const tip=phone||wechat?'电话：'+phone+(wechat?'\n微信：'+wechat:''):'';
  return '<div class="ci-row" '+(tip?'title="'+tip.replace(/\n/g,'&#10;')+'"':'')+'>'+
    '<span class="ci-name">'+name+'</span>'+
    '<span class="ci-side">('+sideTag+')</span>'+
    '<span class="ci-phone muted">'+(phone?' '+maskedPhone:'')+'</span>'+
  '</div>';
}

/** 渲染单条关联单位表格行 HTML（列表页与局部刷新共用，避免两份模板漏改）
 * @param {Object} p - 单位对象
 * @returns {string} <tr> 行 HTML
 */
function unitRowHTML(p){
  const contacts=(p.contacts||[]).map(unitContactRowHTML).join('')||'<span class="muted" style="font-size:13px">无联系人</span>';
  return '<tr>'+
    '<td><input type="checkbox" class="unit-check" data-id="'+p.id+'" onchange="updateUnitBatchBtn()"></td>'+
    '<td><div style="display:flex;align-items:center;gap:10px"><div class="td-img">'+escHtml(p.name[0])+'</div><b>'+escHtml(p.name)+'</b></div></td>'+
    '<td class="m-hide-s2">'+roleBadge(p.roles)+'</td>'+
    '<td class="m-hide-s1">'+escHtml(p.term||'-')+'</td>'+
    '<td class="m-hide-s1"><span class="tag '+(p.rating==='主力'?'info':(p.rating==='新客'?'warn':'gray'))+'">'+escHtml(p.rating||'-')+'</span></td>'+
    '<td class="m-hide-s2 td-contacts">'+contacts+'</td>'+
    '<td class="td-act"><button class="btn sm" onclick="editUnit(\''+p.id+'\')">'+icon('edit')+'编辑</button><button class="btn sm danger" onclick="delUnit(\''+p.id+'\')">'+icon('trash')+'删除</button></td>'+
  '</tr>';
}

/** 渲染关联单位列表视图（含搜索、角色/评级筛选标签、分页）
 * @returns {string} 关联单位列表HTML字符串
 */
function viewUnits(){
  const all=filterUnitsData();
  const totalPages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));
  if(_unitPage>totalPages)_unitPage=totalPages;
  const pageData=all.slice((_unitPage-1)*PAGE_SIZE,_unitPage*PAGE_SIZE);
  const rows=pageData.map(unitRowHTML).join('');
  const total=DB.units.length;
  const matched=all.length;
  const cnt=unitCounts();
  const countTag=unitSearch||_unitRoleFilter||_unitRatingFilter?'<span id="unitCountTag" class="tag gray" style="margin-left:8px">'+matched+' / '+total+'</span>':'<span id="unitCountTag" class="tag gray" style="margin-left:8px;display:none">'+matched+' / '+total+'</span>';
  const pg=buildPaging(all.length,_unitPage,totalPages,'unitPage',{id:'unitPaging'});
  const roleTabs='<div class="filter-tabs" id="unitRoleTabs">'+
    '<button class="ftab'+(_unitRoleFilter===''?' active':'')+'" data-role-filter="" onclick="setUnitRoleFilter(this.dataset.roleFilter)">全部 <span class="ftab-count">'+cnt.total+'</span></button>'+
    '<button class="ftab'+(_unitRoleFilter==='采购商'?' active':'')+'" data-role-filter="采购商" onclick="setUnitRoleFilter(this.dataset.roleFilter)">采购商 <span class="ftab-count">'+cnt.buyers+'</span></button>'+
    '<button class="ftab'+(_unitRoleFilter==='供应商'?' active':'')+'" data-role-filter="供应商" onclick="setUnitRoleFilter(this.dataset.roleFilter)">供应商 <span class="ftab-count">'+cnt.suppliers+'</span></button>'+
    '<button class="ftab'+(_unitRoleFilter==='双角色'?' active':'')+'" data-role-filter="双角色" onclick="setUnitRoleFilter(this.dataset.roleFilter)">双角色 <span class="ftab-count">'+cnt.both+'</span></button>'+
    '<span style="flex:1"></span>'+
    '<span class="ftab-sep"></span>'+
    '<button class="ftab'+(_unitRatingFilter===''?' active':'')+'" data-rating-filter="" onclick="setUnitRatingFilter(this.dataset.ratingFilter)">全部</button>'+
    '<button class="ftab'+(_unitRatingFilter==='主力'?' active':'')+'" data-rating-filter="主力" onclick="setUnitRatingFilter(this.dataset.ratingFilter)">主力</button>'+
    '<button class="ftab'+(_unitRatingFilter==='备选'?' active':'')+'" data-rating-filter="备选" onclick="setUnitRatingFilter(this.dataset.ratingFilter)">备选</button>'+
    '<button class="ftab'+(_unitRatingFilter==='新客'?' active':'')+'" data-rating-filter="新客" onclick="setUnitRatingFilter(this.dataset.ratingFilter)">新客</button>'+
  '</div>';
  const statsRow='<div class="unit-stats-row">'+
    '<span>全部 <b id="ust-total">'+cnt.total+'</b> 家</span>'+
    '<span class="sep">·</span>'+
    '<span>采购商 <b style="color:var(--pri)">'+cnt.buyers+'</b> 家</span>'+
    '<span class="sep">·</span>'+
    '<span>供应商 <b style="color:var(--green)">'+cnt.suppliers+'</b> 家</span>'+
    '<span class="sep">·</span>'+
    '<span>无联系人 <b style="color:var(--amber)">'+cnt.noContacts+'</b> 家</span>'+
  '</div>';
  return '<div class="toolbar">'+
    '<div class="search-box'+(unitSearch?' has-val':'')+'">'+
      '<a href="javascript:void(0)" data-search-fn="onUnitSearch" onclick="onUnitSearch(document.getElementById(\'unitSearchInput\').value)" style="text-decoration:none;color:inherit;cursor:pointer;display:flex;align-items:center">'+icon('search','16')+'</a>'+
      '<input id="unitSearchInput" type="text" tabindex="1" value="'+escAttr(unitSearch)+'" placeholder="搜索单位名称、联系人、电话..." onkeydown="if(event.key===\'Enter\')onUnitSearch(this.value)">'+
      '<span class="clear-btn" onclick="onUnitSearch(\'\')">×</span>'+
    '</div>'+
    '<div class="spacer"></div>'+
    countTag+
    '<button id="unitBatchDelBtn" class="btn sm" style="display:none" onclick="batchDeleteUnits()">'+icon('trash')+'批量删除(<span id="unitBatchCount">0</span>)</button>'+
    '<button class="btn primary" onclick="newUnit()">'+icon('plus')+'新建关联单位</button>'+
  '</div>'+
  roleTabs+
  statsRow+
  '<div class="card"><div class="table-wrap"><table><thead><tr><th style="width:40px"><input type="checkbox" onchange="toggleAllUnits(this)" title="全选"></th><th>名称</th><th class="m-hide-s2">角色</th><th class="m-hide-s1">结算账期</th><th class="m-hide-s1">评级</th><th class="m-hide-s2">联系人</th><th></th></tr></thead><tbody id="unitBody">'+
  (rows||'<tr><td colspan="7">'+
    '<div class="empty-state">'+
      '<div class="es-icon">'+icon('users',28)+'</div>'+
      '<div class="es-title">'+(unitSearch||_unitRoleFilter||_unitRatingFilter?'无匹配单位':'暂无关联单位')+'</div>'+
      '<div class="es-desc">'+(unitSearch||_unitRoleFilter||_unitRatingFilter?'试试调整筛选条件':'添加供应商和采购商，用于报价、订单和结算管理')+'</div>'+
      '<div class="es-action"><button class="btn primary" onclick="newUnit()">'+icon('plus')+'新建关联单位</button></div>'+
    '</div>'+
  '</td></tr>')+
  '</tbody></table></div>'+pg+'</div>';
}

/** 局部刷新关联单位列表（不重新渲染整个页面）
 * @returns {void}
 */
function refreshUnitList(){
  let body=document.getElementById('unitBody');
  let paging=document.getElementById('unitPaging');
  if(!body)return;
  let all=filterUnitsData();
  let totalPages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));
  if(_unitPage>totalPages)_unitPage=totalPages;
  let pageData=all.slice((_unitPage-1)*PAGE_SIZE,_unitPage*PAGE_SIZE);
  let rows=pageData.map(unitRowHTML).join('');
  body.innerHTML=rows||'<tr><td colspan="7">'+
    '<div class="empty-state">'+
      '<div class="es-icon">'+icon('users',28)+'</div>'+
      '<div class="es-title">'+(unitSearch||_unitRoleFilter||_unitRatingFilter?'无匹配单位':'暂无关联单位')+'</div>'+
      '<div class="es-desc">'+(unitSearch||_unitRoleFilter||_unitRatingFilter?'试试调整筛选条件':'添加供应商和采购商，用于报价、订单和结算管理')+'</div>'+
      '<div class="es-action"><button class="btn primary" onclick="newUnit()">'+icon('plus')+'新建关联单位</button></div>'+
    '</div>'+
  '</td></tr>';
  if(paging)paging.innerHTML=totalPages>1?buildPaging(all.length,_unitPage,totalPages,'unitPage',{id:'unitPaging',showCount:false}):'';
  let tag=document.getElementById('unitCountTag');
  if(tag){let total=DB.units.length,matched=all.length;tag.style.display='';tag.textContent=matched+' / '+total;}
  // 同步更新筛选标签激活状态
  let cnt=unitCounts();
  let ust=document.getElementById('ust-total');
  if(ust)ust.textContent=cnt.total;
}

/** 设置关联单位角色筛选条件并刷新列表和标签
 * @param {string} v - 角色筛选值（''/'采购商'/'供应商'/'双角色'）
 * @returns {void}
 */
function setUnitRoleFilter(v){
  _unitRoleFilter=v;_unitPage=1;
  refreshUnitList();
  refreshUnitTabs();
}
/** 设置关联单位评级筛选条件并刷新列表和标签
 * @param {string} v - 评级筛选值（''/'主力'/'备选'/'新客'）
 * @returns {void}
 */
function setUnitRatingFilter(v){
  _unitRatingFilter=v;_unitPage=1;
  refreshUnitList();
  refreshUnitTabs();
}
/** 同步筛选标签的激活状态到 DOM
 * @returns {void}
 */
function refreshUnitTabs(){
  let tabs=document.getElementById('unitRoleTabs');
  if(!tabs)return;
  tabs.querySelectorAll('[data-role-filter]').forEach(function(btn){
    btn.classList.toggle('active',btn.dataset.roleFilter===_unitRoleFilter);
  });
  tabs.querySelectorAll('[data-rating-filter]').forEach(function(btn){
    btn.classList.toggle('active',btn.dataset.ratingFilter===_unitRatingFilter);
  });
}

/** 验证并收集关联单位表单数据（含发票信息）
 * @param {string} editingId - 正在编辑的单位ID（可选）
 * @returns {Object} 校验结果对象，含error或data属性
 */
function validateAndCollectUnitForm(editingId){
  const name=document.getElementById('f_name').value.trim();
  if(!name)return {error:'请填写单位名称'};
  const roles=[...document.querySelectorAll('.role-opt.on')].map(e=>e.dataset.role);
  if(!roles.length)return {error:'请至少选择一个角色'};
  const contacts=readContacts();
  const term=document.getElementById('f_term').value;
  const rating=document.getElementById('f_rating').value;
  const invoice={
    taxId:(document.getElementById('f_taxId')||{}).value||'',
    address:(document.getElementById('f_address')||{}).value||'',
    phone:(document.getElementById('f_phone')||{}).value||'',
    bank:(document.getElementById('f_bank')||{}).value||'',
    accountNo:(document.getElementById('f_accountNo')||{}).value||''
  };
  return {data:{name,roles,contacts,term,rating,invoice}};
}

/** 构建关联单位新建/编辑表单 HTML（基本信息、发票、联系人）
 * @param {Object} p - 关联单位对象（null表示新建）
 * @returns {string} 表单HTML字符串
 */
function unitForm(p){
  const isEdit=!!p;
  const termOptions=[
    {v:'',l:'请选择账期'},
    {v:'货到付款',l:'货到付款'},
    {v:'月结15天',l:'月结15天'},
    {v:'月结30天',l:'月结30天'},
    {v:'月结45天',l:'月结45天'},
    {v:'月结60天',l:'月结60天'},
    {v:'季结',l:'季结'},
    {v:'面议',l:'面议'},
    {v:'其他',l:'其他'},
  ];
  const termSel=termOptions.map(o=>'<option value="'+o.v+'"'+(p&&p.term===o.v?' selected':'')+'>'+o.l+'</option>').join('');
  const hasInvoice=isEdit&&p&&p.invoice&&(p.invoice.taxId||p.invoice.bank||p.invoice.accountNo);
  return '<div class="unit-section"><div class="sec-hd">基本信息</div>'+
    '<div class="sec-body">'+
      '<div class="field"><label class="f">单位名称 <span style="color:var(--red)">*</span></label><input id="f_name" tabindex="10" value="'+escAttr(p?p.name:'')+'" placeholder="请输入单位全称" style="font-size:14px"></div>'+
      '<div class="grid2">'+
        '<div class="field"><label class="f">角色（可多选）</label>'+
          '<div class="role-pick">'+
            '<button type="button" class="role-opt '+(p&&p.roles.includes('采购商')?'on':'')+'" data-role="采购商" onclick="this.classList.toggle(\'on\');updateContactSides()">采购商</button>'+
            '<button type="button" class="role-opt '+(p&&p.roles.includes('供应商')?'on':'')+'" data-role="供应商" onclick="this.classList.toggle(\'on\');updateContactSides()">供应商</button>'+
          '</div>'+
          '<div class="field-hint">同一单位可同时是采购商和供应商</div>'+
        '</div>'+
        '<div class="field"><label class="f">合作评级</label><select id="f_rating" tabindex="11"><option value="" '+(p&&!p.rating?'selected':'')+'>请选择评级</option><option value="主力" '+(p&&p.rating==='主力'?'selected':'')+'>主力</option><option value="备选" '+(p&&p.rating==='备选'?'selected':'')+'>备选</option><option value="新客" '+(p&&p.rating==='新客'?'selected':'')+'>新客</option></select></div>'+
      '</div>'+
      '<div class="field" style="margin-bottom:0"><label class="f">结算账期</label><select id="f_term" tabindex="12">'+termSel+'</select></div>'+
    '</div>'+
  '</div>'+
  '<div class="unit-section '+(isEdit&&!hasInvoice?'sec-collapsed':'sec-expanded')+'" id="invoiceSection">'+
    '<div class="sec-hd" style="cursor:pointer" onclick="toggleInvoiceSection(this)">'+
      '发票信息 <span style="font-size:12px;font-weight:400;color:var(--gray)">(选填)</span>'+
      '<span class="sec-arrow">'+icon('chevronDown','14')+'</span>'+
    '</div>'+
    '<div class="sec-body">'+
      '<div class="grid2">'+
        '<div class="field"><label class="f">税号</label><input id="f_taxId" tabindex="13" value="'+escAttr(p&&p.invoice?p.invoice.taxId:'')+'" placeholder="统一社会信用代码" style="font-size:14px"></div>'+
        '<div class="field"><label class="f">电话</label><input id="f_phone" tabindex="14" value="'+escAttr(p&&p.invoice?p.invoice.phone:'')+'" placeholder="开票电话" style="font-size:14px"></div>'+
      '</div>'+
      '<div class="grid2">'+
        '<div class="field"><label class="f">开户银行</label><input id="f_bank" tabindex="15" value="'+escAttr(p&&p.invoice?p.invoice.bank:'')+'" placeholder="如：中国工商银行XX支行" style="font-size:14px"></div>'+
        '<div class="field"><label class="f">银行账号</label><input id="f_accountNo" tabindex="16" value="'+escAttr(p&&p.invoice?p.invoice.accountNo:'')+'" placeholder="开户账号" style="font-size:14px"></div>'+
      '</div>'+
      '<div class="field"><label class="f">单位地址</label><input id="f_address" tabindex="17" value="'+escAttr(p&&p.invoice?p.invoice.address:'')+'" placeholder="注册地址" style="font-size:14px"></div>'+
    '</div>'+
  '</div>'+
  '<div class="unit-section sec-expanded" id="contactsSection">'+
    '<div class="sec-hd">联系人</div>'+
    '<div class="sec-body">'+
      '<div id="contactsBox">'+((p&&p.contacts&&p.contacts.length)?p.contacts:[{name:'',phone:'',wechat:'',sides:['供应']}]).map((c,i)=>contactRow(c,i)).join('')+'</div>'+
      '<button class="btn sm" type="button" onclick="addCRow()" style="margin-top:8px">'+icon('plus')+'添加联系人</button>'+
    '</div>'+
  '</div>';
}

/** 切换发票信息区域的展开/收起
 * @param {HTMLElement} el - 触发元素
 * @returns {void}
 */
function toggleInvoiceSection(el){
  let sec=document.getElementById('invoiceSection');
  let arrow=el.querySelector('.sec-arrow');
  if(sec.classList.contains('sec-expanded')){
    sec.classList.remove('sec-expanded');
    sec.classList.add('sec-collapsed');
    arrow.innerHTML=icon('chevronRight','14');
  }else{
    sec.classList.remove('sec-collapsed');
    sec.classList.add('sec-expanded');
    arrow.innerHTML=icon('chevronDown','14');
  }
}

/** 初始化新建关联单位流程（含草稿恢复检测和自动保存绑定）
 * @returns {void}
 */
function newUnit(){
  let onSave=function(){
    // 防重锁：防止重复点击导致重复新建
    if(_unitSaving){toast('正在保存中，请稍候...','info');return;}
    _unitSaving=true;
    setTimeout(function(){_unitSaving=false;},500);
    let vr=validateAndCollectUnitForm(null);
    if(vr.error){toast(vr.error,'warning');return;}
    let _a=vr.data, name=_a.name, roles=_a.roles, contacts=_a.contacts, term=_a.term, rating=_a.rating, invoice=_a.invoice;
    DB.units.push({id:uid('U'),name:name,roles:roles,contacts:contacts,term:term,rating:rating,invoice:invoice});
    clearDraft(DRAFT_TYPES.unit);
    saveDB();closeDrawer();render();toast('关联单位已保存','success');
  };
  if(checkDraftRestore(DRAFT_TYPES.unit,function(d){
    openDrawer('新建关联单位',unitForm(null),onSave,true);
    setTimeout(function(){
      restoreUnitDraft(d);
      updateContactSides();
      let panel=document.querySelector('.drawer-panel');
      if(panel)bindDraftSave(panel,collectUnitDraft,DRAFT_TYPES.unit);
    },100);
  },function(){
    openDrawer('新建关联单位',unitForm(null),onSave,true);
    setTimeout(function(){
      updateContactSides();
      let panel=document.querySelector('.drawer-panel');
      if(panel)bindDraftSave(panel,collectUnitDraft,DRAFT_TYPES.unit);
    },100);
  },'关联单位'))return;
  openDrawer('新建关联单位',unitForm(null),onSave,true);
  setTimeout(function(){
    updateContactSides();
    let panel=document.querySelector('.drawer-panel');
    if(panel)bindDraftSave(panel,collectUnitDraft,DRAFT_TYPES.unit);
  },100);
}

/** 打开指定关联单位的编辑抽屉
 * @param {string} id - 关联单位ID
 * @returns {void}
 */
function editUnit(id){
  const p=DB.units.find(x=>x.id===id);
  if(!p)return;
  openDrawer('编辑关联单位',unitForm(p),function(){
    // 防重锁：防止重复点击导致重复保存
    if(_unitSaving){toast('正在保存中，请稍候...','info');return;}
    _unitSaving=true;
    setTimeout(function(){_unitSaving=false;},500);
    const vr=validateAndCollectUnitForm(id);
    if(vr.error){toast(vr.error,'warning');return;}
    const {name,roles,contacts,term,rating,invoice}=vr.data;
    p.name=name;p.roles=roles;p.term=term;p.rating=rating;
    p.contacts=contacts;p.invoice=invoice;
    clearDraft(DRAFT_TYPES.unit);
    saveDB();closeDrawer();render();toast('已更新','success');
  },true);
  setTimeout(()=>{
    const panel=document.querySelector('.drawer-panel');
    if(panel)bindDraftSave(panel,collectUnitDraft,DRAFT_TYPES.unit);
  },100);
  setTimeout(()=>updateContactSides(),50);
}

/** 确认后删除指定关联单位（含引用检查提示）
 * @param {string} id - 关联单位ID
 * @returns {void}
 */
function delUnit(id){
  const p=DB.units.find(x=>x.id===id);
  if(!p)return;
  const used=DB.orders.some(o=>o.buyerId===id||o.items.some(i=>(i.options||[]).some(opt=>opt.supplierId===id)));
  const usedPrice=DB.prices.some(pr=>pr.unitId===id);
  let msg='确认删除关联单位「'+escHtml(p.name)+'」?';
  if(used||usedPrice)msg='「'+escHtml(p.name)+'」已被订单或价格记录引用，删除后相关记录将显示为ID。确认删除?';
  confirmModal(msg,()=>{softDelete('unit',id,{operator:'user'});closeModal();render();toast('已删除','info');},'确认删除',null,null,true);
}

/** 渲染单条联系人编辑行 HTML
 * @param {Object} c - 联系人对象
 * @param {number} i - 行索引
 * @returns {string} 联系人行HTML字符串
 */
function contactRow(c,i){
  const raw=c.sides||(c.side==='采购商'?['采购']:c.side==='供应商'?['供应']:['供应']);
  return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px" data-crow="'+i+'">'+
    '<input placeholder="姓名" tabindex="20" value="'+escAttr(c.name)+'" data-c="name" data-i="'+i+'" style="flex:1 1 100px;min-width:80px">'+
    '<input placeholder="电话" tabindex="21" value="'+escAttr(c.phone)+'" data-c="phone" data-i="'+i+'" style="flex:1 1 110px;min-width:90px">'+
    '<input placeholder="微信号（选填）" tabindex="22" value="'+escAttr(c.wechat||'')+'" data-c="wechat" data-i="'+i+'" style="flex:1 1 100px;min-width:80px">'+
    '<label style="white-space:nowrap;font-size:13px;display:flex;align-items:center;gap:3px;flex-shrink:0"><input type="checkbox" data-c="side" data-v="供应" data-i="'+i+'" '+(raw.includes('供应')?'checked':'')+' onchange="updateContactSides()">供应</label>'+
    '<label style="white-space:nowrap;font-size:14px;display:flex;align-items:center;gap:3px;flex-shrink:0"><input type="checkbox" data-c="side" data-v="采购" data-i="'+i+'" '+(raw.includes('采购')?'checked':'')+' onchange="updateContactSides()">采购</label>'+
    '<button class="btn sm danger" type="button" onclick="delCRow(this)" title="删除该联系人" style="flex-shrink:0">'+icon('trash')+'</button>'+
  '</div>';
}

/** 在联系人区域追加一行空白联系人编辑行
 * @returns {void}
 */
function addCRow(){
  const box=document.getElementById('contactsBox');
  const i=box.querySelectorAll('[data-c="name"]').length;
  box.insertAdjacentHTML('beforeend',contactRow({name:'',phone:'',wechat:'',sides:['供应']},i));
}

/** 删除指定的联系人编辑行
 * @param {HTMLElement} btn - 删除按钮元素
 * @returns {void}
 */
function delCRow(btn){
  const row=btn.closest('[data-crow]');
  if(!row)return;
  row.remove();
}

/** 根据所选角色（采购商/供应商）自动禁用不符合的联系人侧
 * @returns {void}
 */
function updateContactSides(){
  const buyerBtn=document.querySelector('.role-opt[data-role="采购商"]');
  const supplierBtn=document.querySelector('.role-opt[data-role="供应商"]');
  const buyerOn=buyerBtn&&buyerBtn.classList.contains('on');
  const supplierOn=supplierBtn&&supplierBtn.classList.contains('on');
  const anyOn=buyerOn||supplierOn;
  document.querySelectorAll('#contactsBox [data-c="side"]').forEach(cb=>{
    const v=cb.dataset.v;
    if(v==='供应'){if(anyOn&&!supplierOn){cb.disabled=true;cb.checked=false;}else cb.disabled=false;}
    if(v==='采购'){if(anyOn&&!buyerOn){cb.disabled=true;cb.checked=false;}else cb.disabled=false;}
  });
}

/** 从 DOM 中读取所有联系人编辑行数据
 * @returns {Array} 联系人数组
 */
function readContacts(){
  return [...document.querySelectorAll('#contactsBox [data-c="name"]')].map((el,i)=>{
    const sides=[...document.querySelectorAll('#contactsBox [data-c="side"][data-i="'+i+'"]:checked')].map(cb=>cb.dataset.v);
    return {
      name:el.value.trim(),
      phone:(document.querySelector('#contactsBox [data-c="phone"][data-i="'+i+'"]')||{}).value||'',
      wechat:(document.querySelector('#contactsBox [data-c="wechat"][data-i="'+i+'"]')||{}).value||'',
      sides:sides,
      side:sides.includes('供应')?'供应商':(sides.includes('采购')?'采购商':'供应商')
    };
  }).filter(c=>c.name);
}

/** 根据单位 ID 和角色侧生成联系人 option 列表
 * @param {string} pid - 关联单位ID
 * @param {string} side - 角色侧（'供应商'/'采购商'）
 * @returns {string} option HTML字符串
 */
function contactOpts(pid,side){
  const p=DB.units.find(x=>x.id===pid);
  if(!p||!p.contacts||!p.contacts.length)return '<option value="">(无联系人)</option>';
  let cs=side?p.contacts.filter(c=>{
    return c.side===side||(c.sides&&c.sides.includes(side==='供应商'?'供应':'采购'));
  }):p.contacts;
  if(!cs.length)cs=p.contacts;
  return cs.map(c=>'<option value="'+escAttr(c.name)+'">'+escHtml(c.name)+'('+escHtml(c.phone)+(c.wechat?' / 微信:'+escHtml(c.wechat):'')+')</option>').join('');
}

/* ---- 批量操作 ---- */
/** 切换关联单位列表全选/取消全选
 * @param {HTMLInputElement} cb - 全选复选框元素
 * @returns {void}
 */
function toggleAllUnits(cb){
  document.querySelectorAll('.unit-check').forEach(function(c){
    if(c.closest('tr').style.display!=='none')c.checked=cb.checked;
  });
  updateUnitBatchBtn();
}

/** 根据选中单位数量更新批量删除按钮状态
 * @returns {void}
 */
function updateUnitBatchBtn(){
  let checked=document.querySelectorAll('.unit-check:checked');
  let btn=document.getElementById('unitBatchDelBtn');
  let cnt=document.getElementById('unitBatchCount');
  if(!btn)return;
  if(checked.length>0){
    btn.style.display='';btn.className='btn sm danger';
    if(cnt)cnt.textContent=checked.length;
  }else{
    btn.style.display='none';
  }
}

/** 批量删除选中的关联单位（含订单/价格引用检查提示）
 * @returns {void}
 */
function batchDeleteUnits(){
  const checks=document.querySelectorAll('.unit-check:checked');
  const names=[];
  const ids=[];
  checks.forEach(function(c){
    const id=c.dataset.id;
    ids.push(id);
    const p=DB.units.find(function(x){return x.id===id;});
    if(p)names.push(escHtml(p.name));
  });
  // 关联检查聚合
  const refParts=[];
  ids.forEach(function(id){
    const p=DB.units.find(x=>x.id===id);
    if(!p)return;
    const usedOrder=DB.orders.some(o=>o.buyerId===id||o.items.some(i=>(i.options||[]).some(opt=>opt.supplierId===id)));
    const usedPrice=DB.prices.some(pr=>pr.unitId===id);
    let orderCnt=0;
    DB.orders.forEach(o=>{
      if(o.buyerId===id)orderCnt++;
      o.items.forEach(i=>{(i.options||[]).forEach(opt=>{if(opt.supplierId===id)orderCnt++;});});
    });
    const priceCnt=DB.prices.filter(pr=>pr.unitId===id).length;
    if(usedOrder||usedPrice){
      const tag=[];
      if(priceCnt>0)tag.push('报价'+priceCnt);
      if(orderCnt>0)tag.push('订单'+orderCnt);
      refParts.push(escHtml(p.name)+'('+tag.join('/')+')');
    }
  });
  let msg='确认删除选中的 '+ids.length+' 个单位？\n\n'+names.join('、');
  if(refParts.length>0){
    msg='⚠ 以下单位已被引用：'+refParts.join('、')+'\n删除后相关记录将显示为 ID。\n\n'+msg;
  }
  confirmModal(msg,function(){
    const idSet=new Set(ids);
    const bid=uid('AOB');ids.forEach(function(id){try{softDelete('unit',id,{operator:'user',batchId:bid});}catch(e){}});
    render();toast('已删除 '+ids.length+' 个','info');
  },'确认删除',null,null,true);
}
