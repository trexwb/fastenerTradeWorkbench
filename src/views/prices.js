// views/prices.js — 报价管理
/* =========================================================
   报价管理
   ========================================================= */

/**
 * 渲染报价列表视图（含搜索、供应商/属性筛选、排序、分页）。
 * @returns {string} 报价列表视图 HTML
 */
function viewPrices(){
  const filtered=filterPricesData();
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  if(_pricePage>totalPages)_pricePage=totalPages;
  const pageData=filtered.slice((_pricePage-1)*PAGE_SIZE,_pricePage*PAGE_SIZE);

  const rows=pageData.map(p=>{
    return '<tr>'+
      '<td><input type="checkbox" class="price-check" data-id="'+escAttr(p.id)+'" onchange="updatePriceBatchBtn()"></td>'+
      '<td><b>'+escHtml(pName(p.unitId))+'</b><br><span class="muted" style="font-size:12px">'+escHtml(pRating(p.unitId))+'</span></td>'+
      '<td>'+priceBomSku(p)+'</td>'+
      '<td>'+priceSpec(p)+'</td>'+
      '<td><div class="spec-line">'+priceAttrCol(p)+'</div></td>'+
      '<td><b style="color:var(--green)">'+fmt(p.price)+'</b></td>'+
      '<td>'+escHtml(p.contact||'-')+'</td>'+
      '<td>'+escHtml(p.validFrom)+'</td>'+
      '<td class="td-act"><button class="btn sm" onclick="editPrice(\''+escAttr(p.id)+'\')">'+icon('edit')+'编辑</button><button class="btn sm danger" onclick="delPrice(\''+escAttr(p.id)+'\')">'+icon('trash')+'删除</button></td>'+
    '</tr>';
  }).join('');

  const pg=buildPaging(filtered.length,_pricePage,totalPages,'pricePage',{id:'pricesPaging'});

  const specFilt=SPEC_FIELDS.map(k=>'<div id="pf_'+k+'" class="combo filt-combo" data-placeholder="'+SPEC_LABELS[k]+'" data-val=""></div>').join('');

  return '<div class="toolbar">'+
    '<div class="search-box" style="width:160px"><a href="javascript:void(0)" onclick="doPriceSearch()" style="text-decoration:none;color:inherit;cursor:pointer;display:flex;align-items:center">'+icon('search','16')+'</a><input id="pf_sku" placeholder="SKU..." onkeydown="if(event.key===\'Enter\')doPriceSearch()"><span class="clear-btn" onclick="clearPriceFilter()">×</span></div>'+
    '<div id="pf_unit" class="combo filt-combo" data-placeholder="全部供应商" data-val=""></div>'+
    '<div class="spacer"></div>'+
    '<button id="priceBatchDelBtn" class="btn sm" style="display:none" onclick="batchDeletePrices()">'+icon('trash')+'批量删除(<span id="priceBatchCount">0</span>)</button>'+
    '<div class="btn-group">'+
      '<button class="btn primary" onclick="newPrice()">'+icon('plus')+'新增报价</button>'+
      '<button class="btn primary dropdown-toggle" onclick="togglePriceDropdown(event)" title="更多操作">'+icon('chevronDown','14')+'</button>'+
      '<div class="dropdown-menu" id="priceDropdown" style="display:none">'+
        '<button class="dropdown-item" onclick="closePriceDropdown();newPrice()">'+icon('plus')+'新增报价</button>'+
        '<button class="dropdown-item" onclick="closePriceDropdown();openPriceBatchAdd()">'+icon('upload','14')+'批量导入</button>'+
      '</div>'+
    '</div>'+
  '</div>'+
  '<div class="filter-bar">'+
    specFilt+
    '<button class="btn sm ghost filt-clear" onclick="clearPriceFilter()">清除筛选</button>'+
  '</div>'+
  '<div class="card"><div class="table-wrap"><table><thead><tr><th style="width:40px"><input type="checkbox" onchange="toggleAllPrices(this)" title="全选"></th><th>供应商</th><th>BOM SKU</th><th>规格</th><th>属性</th><th>单价(元/千支)</th><th>联系人</th><th>有效期起</th><th></th></tr></thead><tbody id="priceBody">'+
  (rows||'<tr><td colspan="9"><div class="no-data">'+(hasPriceFilter()?'无匹配结果':'暂无报价记录，点击「新增报价」开始')+'</div></td></tr>')+
  '</tbody></table></div>'+pg+'</div>';
}

/* 数据层：返回过滤后的全部数据（不含分页） */
/** 根据供应商、SKU搜索和属性筛选过滤报价数据并按有效期降序排列 */
/**
 * 过滤报价数据（数据层过滤函数）
 * 数据流：DB.prices → 倒序 → 按条件过滤 → 返回匹配数组
 * 
 * 过滤条件（AND关系）：
 * - 单位筛选（unitId）
 * - 类型/标准/直径/硬度/表面/材质 combo筛选
 * - 搜索关键词匹配（SKU/单位名称/规格）
 */
function filterPricesData(){
  const unit=getComboVal('pf_unit');
  const sku=((document.getElementById('pf_sku')||{}).value||'').trim().toLowerCase();
  const specVals={};
  SPEC_FIELDS.forEach(k=>{specVals[k]=getComboVal('pf_'+k);});
  return DB.prices.filter(p=>{
    if(unit&&p.unitId!==unit)return false;
    if(sku&&!(p.bomSku||'').toLowerCase().includes(sku))return false;
    for(const k of SPEC_FIELDS){const v=specVals[k];if(!v)continue;if((p[k]||'')!==v)return false;}
    return true;
  }).slice().sort(function(a,b){return (b.validFrom||'').localeCompare(a.validFrom||'')||(b.createdAt||'').localeCompare(a.createdAt||'');});
}

/**
 * 判断是否设置了任何报价筛选条件（SKU/供应商/属性）。
 * @returns {boolean} 设置了任意筛选条件返回 true，否则 false
 */
function hasPriceFilter(){
  if(((document.getElementById('pf_sku')||{}).value||'').trim())return true;
  if(getComboVal('pf_unit'))return true;
  return SPEC_FIELDS.some(k=>getComboVal('pf_'+k));
}

/* 渲染层：刷新tbody + 分页 */
/** 局部刷新报价表格（tbody + 分页） */
/**
 * 局部刷新报价表格（渲染层函数）
 * 数据流：filterPricesData() → 分页 → DOM(#priceBody) + 分页条
 */
function refreshPricesTable(){
  const filtered=filterPricesData();
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  if(_pricePage>totalPages)_pricePage=totalPages;
  const pageData=filtered.slice((_pricePage-1)*PAGE_SIZE,_pricePage*PAGE_SIZE);

  const rows=pageData.map(p=>{
    return '<tr>'+
      '<td><input type="checkbox" class="price-check" data-id="'+escAttr(p.id)+'" onchange="updatePriceBatchBtn()"></td>'+
      '<td><b>'+escHtml(pName(p.unitId))+'</b><br><span class="muted" style="font-size:12px">'+escHtml(pRating(p.unitId))+'</span></td>'+
      '<td>'+priceBomSku(p)+'</td>'+
      '<td>'+priceSpec(p)+'</td>'+
      '<td><div class="spec-line">'+priceAttrCol(p)+'</div></td>'+
      '<td><b style="color:var(--green)">'+fmt(p.price)+'</b></td>'+
      '<td>'+escHtml(p.contact||'-')+'</td>'+
      '<td>'+escHtml(p.validFrom)+'</td>'+
      '<td class="td-act"><button class="btn sm" onclick="editPrice(\''+escAttr(p.id)+'\')">'+icon('edit')+'编辑</button><button class="btn sm danger" onclick="delPrice(\''+escAttr(p.id)+'\')">'+icon('trash')+'删除</button></td>'+
    '</tr>';
  }).join('');

  const body=document.getElementById('priceBody');
  if(body)body.innerHTML=rows||'<tr><td colspan="9"><div class="no-data">'+(hasPriceFilter()?'无匹配结果':'暂无报价记录，点击「新增报价」开始')+'</div></td></tr>';

  let pgEl=document.getElementById('pricesPaging');
  if(pgEl)pgEl.innerHTML=buildPaging(filtered.length,_pricePage,totalPages,'pricePage',{id:'pricesPaging',showCount:false});
}

/** 翻页并刷新报价表格 */
function pricePage(n){
  const filtered=filterPricesData();
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  _pricePage=Math.max(1,Math.min(n,totalPages));
  refreshPricesTable();
}

/** 执行SKU搜索并刷新报价表格（含搜索框高亮切换） */
function doPriceSearch(){
  const v=(document.getElementById('pf_sku').value||'').trim();
  const box=document.querySelector('.search-box');
  if(box){if(v)box.classList.add('has-val');else box.classList.remove('has-val');}
  _pricePage=1;
  refreshPricesTable();
}

/** 触发属性筛选后重置页码并刷新报价表格 */
function filterPrices(){
  _pricePage=1;
  refreshPricesTable();
}

/** 清空所有报价筛选条件（SKU/供应商/属性）并刷新 */
function clearPriceFilter(){
  let skuEl=document.getElementById('pf_sku');
  if(skuEl)skuEl.value='';
  let box=document.querySelector('.search-box');
  if(box)box.classList.remove('has-val');
  SPEC_FIELDS.forEach(k=>{
    let el=document.getElementById('pf_'+k);
    if(el){el.dataset.val='';let inp=el.querySelector('input');if(inp)inp.value='';}
  });
  let unitEl=document.getElementById('pf_unit');
  if(unitEl){unitEl.dataset.val='';let inp=unitEl.querySelector('input');if(inp)inp.value='';}
  _pricePage=1;
  refreshPricesTable();
}

/* ---- 表单 ---- */
let editingPriceId=null;
/** 打开新增报价抽屉（含草稿恢复检测和自动保存绑定） */
function newPrice(){
  editingPriceId=null;
  if(checkDraftRestore(DRAFT_TYPES.price,function(d){
    openDrawer('新增报价',priceFormHTML(),savePriceDrawer,true);
    setTimeout(function(){
      bindPriceFormCombos(null);
      restorePriceDraft(d);
      var panel=document.querySelector('.drawer-panel');
      if(panel)bindDraftSave(panel,collectPriceDraft,DRAFT_TYPES.price);
    },100);
  },function(){
    openDrawer('新增报价',priceFormHTML(),savePriceDrawer,true);
    setTimeout(function(){
      bindPriceFormCombos(null);
      var panel=document.querySelector('.drawer-panel');
      if(panel)bindDraftSave(panel,collectPriceDraft,DRAFT_TYPES.price);
    },100);
  },'报价'))return;
  openDrawer('新增报价',priceFormHTML(),savePriceDrawer,true);
  setTimeout(function(){
    bindPriceFormCombos(null);
    var panel=document.querySelector('.drawer-panel');
    if(panel)bindDraftSave(panel,collectPriceDraft,DRAFT_TYPES.price);
  },100);
}
/** 检查报价是否重复（同一供应商+BOM SKU+规格+属性组合） */
function isPriceDuplicate(unitId,bomSku,spec,attrs,excludeId){
  return DB.prices.some(p=>{
    if(excludeId&&p.id===excludeId)return false;
    if(p.unitId!==unitId)return false;
    if((p.bomSku||'')!==(bomSku||''))return false;
    if((p.spec||'')!==(spec||''))return false;
    for(const k of SPEC_FIELDS){if((p[k]||'')!==(attrs[k]||''))return false;}
    return true;
  });
}
/** 打开指定报价的编辑抽屉并初始化combo和联系人下拉 */
function editPrice(id){
  editingPriceId=id;
  const p=DB.prices.find(x=>x.id===id);
  openDrawer('编辑报价',priceFormHTML(p),savePriceDrawer,true);
  setTimeout(()=>{
    bindPriceFormCombos(p);
    const uEl=document.getElementById('ps_unit');
    const uVal=uEl?uEl.dataset.val:'';
    if(uVal){
      const cEl=document.getElementById('ps_contact');
      cEl.innerHTML=contactOpts(uVal,'供应商');
      if(p.contact)cEl.value=p.contact;
    }
  },50);
}
/** 确认后删除指定报价记录 */
function delPrice(id){
  const p=DB.prices.find(x=>x.id===id);
  if(!p)return;
  confirmModal('确认删除这条报价？'+pName(p.unitId)+' '+specLabel(p),()=>{
    DB.prices=DB.prices.filter(x=>x.id!==id);
    saveDB();closeDrawer();render();
    toast('已删除','info');
  },'确认删除');
}
/** 构建报价新建/编辑表单HTML（BOM引用、供应商、属性、单价） */
function priceFormHTML(p){
  const specEls=SPEC_FIELDS.map(k=>'<div class="field"><label class="f">'+SPEC_LABELS[k]+'</label><div id="ps_'+k+'" class="combo" data-placeholder="选择或输入'+SPEC_LABELS[k]+'..." data-val="'+escAttr(p?p[k]:'')+'"></div></div>').join('');
  return '<div class="field" style="margin-bottom:12px"><label class="f">BOM引用 <span style="color:var(--accent);font-size:11px">（选择后自动填入下方属性）</span></label><div id="ps_bom_ref" class="combo" data-placeholder="搜索BOM..." data-val="'+escAttr(p?p.bomSku||'':'')+'"></div></div>'+
  '<div class="field" style="margin-bottom:12px"><label class="f">规格</label><input id="ps_spec" tabindex="10" value="'+escAttr(p?p.spec:'')+'" placeholder="选择BOM后自动填入"></div>'+
  '<div class="grid2" style="margin-bottom:16px">'+
    '<div class="field"><label class="f">供应商 <span style="color:#ef4444">*</span></label><div id="ps_unit" class="combo" data-role="supplier" data-placeholder="搜索供应商..." data-val="'+escAttr(p?p.unitId:'')+'"></div></div>'+
    '<div class="field"><label class="f">联系人</label><select id="ps_contact" tabindex="11"><option value="">（请先选择供应商）</option></select></div>'+
  '</div>'+
  '<div class="grid2" style="margin-bottom:16px">'+specEls+'</div>'+
  '<div class="grid2">'+
    '<div class="field"><label class="f">单价(元/千支)<span style="color:#ef4444">*</span></label><input id="ps_price" type="number" step="0.01" tabindex="12" value="'+(p?p.price:'')+'" placeholder="0.00"></div>'+
    '<div class="field"><label class="f">有效期起</label><input id="ps_valid" type="date" tabindex="13" value="'+(p?p.validFrom:today())+'"></div>'+
  '</div>'+
  '<div class="field"><label class="f">备注</label><input id="ps_remark" tabindex="14" value="'+escAttr(p?p.remark:'')+'" placeholder="如：含税/不含税、起订量等"></div>';
}
/** 初始化报价表单中所有combo下拉组件（BOM、属性、供应商） */
function bindPriceFormCombos(p){
  const bomOpts=(DB.bom||[]).map(b=>({id:b.sku,label:b.sku+' · '+b.name+' · '+(b.spec||'')}));
  const bomRef=document.getElementById('ps_bom_ref');
  if(bomRef){
    combo(bomRef,bomOpts,opt=>{
      bomRef.dataset.val=opt.id;
      fillSpecFromBOM('ps');
    },'搜索BOM...',false);
  }
  SPEC_FIELDS.forEach(k=>{
    const el=document.getElementById('ps_'+k);
    if(!el)return;
    combo(el,(DB.specs[k]||[]).map(v=>({id:v,label:v})),opt=>{el.dataset.val=opt.id;},SPEC_LABELS[k]+'(可直接输入)...',true);
  });
  if(bomRef&&bomRef.dataset.val)fillSpecFromBOM('ps');
  const partyEl=document.getElementById('ps_unit');
  if(partyEl){
    combo(partyEl,DB.units.filter(u=>u.roles.includes('供应商')).map(u=>({id:u.id,label:u.name,tag:{text:u.rating,cls:u.rating==='主力'?'ok':(u.rating==='新客'?'warn':'gray')}})),
      opt=>{
        partyEl.dataset.val=opt.id;
        const cEl=document.getElementById('ps_contact');
        if(cEl)cEl.innerHTML=contactOpts(opt.id,'供应商');
      },'搜索供应商...',true);
  }
}
/** 校验并保存报价表单（含重复检查，新建/编辑复用） */
function savePriceDrawer(){
  const partyEl=document.getElementById('ps_unit');
  const input=partyEl.querySelector('input');if(input&&input.value.trim()==='')partyEl.dataset.val='';
  const unitId=partyEl.dataset.val;
  if(!unitId){toast('请选择供应商','warning');return;}
  const price=+document.getElementById('ps_price').value;
  if(!(price>0)){toast('请输入有效单价','warning');return;}
  const spec={};
  SPEC_FIELDS.forEach(k=>{spec[k]=getComboVal('ps_'+k);});
  const contact=document.getElementById('ps_contact').value;
  const validFrom=document.getElementById('ps_valid').value;
  const remark=document.getElementById('ps_remark').value;
  const specText=document.getElementById('ps_spec').value;
  const bomRefEl=document.getElementById('ps_bom_ref');
  const bomInput=bomRefEl.querySelector('input');if(bomInput&&bomInput.value.trim()==='')bomRefEl.dataset.val='';
  const bomSku=bomRefEl.dataset.val==='__manual__'?'':bomRefEl.dataset.val;
  if(isPriceDuplicate(unitId,bomSku,specText,spec,editingPriceId)){toast('已存在相同供应商+SKU+规格+属性的报价，请勿重复添加','warning');return;}
  if(editingPriceId){
    const rec=DB.prices.find(x=>x.id===editingPriceId);
    Object.assign(rec,{unitId,contact,...spec,bomSku,price,validFrom,remark,spec:specText});
    toast('报价已更新','success');
  }else{
    DB.prices.push({id:uid('PR'),unitId,contact,...spec,bomSku,price,validFrom,remark,spec:specText,createdAt:today()});
    toast('报价已添加','success');
  }
  saveDB();closeDrawer();render();
  clearDraft(DRAFT_TYPES.price);
}

/* ---- 批量删除 ---- */
/** 切换报价列表全选/取消全选 */
function toggleAllPrices(cb){
  document.querySelectorAll('.price-check').forEach(function(c){
    if(c.closest('tr').style.display!=='none')c.checked=cb.checked;
  });
  updatePriceBatchBtn();
}
/** 根据选中报价数量更新批量删除按钮状态 */
function updatePriceBatchBtn(){
  let checked=document.querySelectorAll('.price-check:checked');
  let btn=document.getElementById('priceBatchDelBtn');
  let cnt=document.getElementById('priceBatchCount');
  if(!btn)return;
  if(checked.length>0){
    btn.style.display='';btn.className='btn sm danger';
    if(cnt)cnt.textContent=checked.length;
  }else{
    btn.style.display='none';
  }
}
/** 批量删除选中报价（含订单寻源引用检查提示） */
function batchDeletePrices(){
  const checks=document.querySelectorAll('.price-check:checked');
  const ids=[];
  checks.forEach(function(c){ids.push(c.dataset.id);});
  // 订单寻源引用检查
  const useRefs=[];
  ids.forEach(function(pId){
    const p=DB.prices.find(x=>x.id===pId);
    if(!p)return;
    const hitOrders=[];
    (DB.orders||[]).forEach(function(o){
      (o.items||[]).forEach(function(it){
        (it.options||[]).forEach(function(opt){
          if(opt.supplierId!==p.unitId)return;
          // 匹配 bomSku 或 6 维规格属性完全一致
          const skuMatch=(p.bomSku||'')&&(it.bomSku||'')&&p.bomSku===it.bomSku;
          let specMatch=true;
          for(let i=0;i<SPEC_FIELDS.length;i++){
            const k=SPEC_FIELDS[i];
            if((p[k]||'')!==(it[k]||'')){specMatch=false;break;}
          }
          if(skuMatch||specMatch){
            if(hitOrders.indexOf(o.id)<0)hitOrders.push(o.id);
          }
        });
      });
    });
    if(hitOrders.length>0){
      useRefs.push(pName(p.unitId)+' 报价 被 订单 '+hitOrders.join('/')+' 使用');
    }
  });
  let msg='确认删除选中的 '+ids.length+' 条报价？';
  if(useRefs.length>0){
    msg='⚠ '+useRefs.length+' 条报价正在被订单寻源使用：\n'+useRefs.join('\n')+'\n\n删除后对应寻源记录的供应商名将显示为 ID。\n\n'+msg;
  }
  confirmModal(msg,function(){
    const idSet=new Set(ids);
    DB.prices=DB.prices.filter(function(x){return !idSet.has(x.id);});
    saveDB();render();toast('已删除 '+ids.length+' 条','info');
  },'确认删除');
}

/* ---- 新增报价下拉 ---- */
/** 切换「新增报价」下拉菜单显隐 */
function togglePriceDropdown(e){
  e.stopPropagation();
  let dd=document.getElementById('priceDropdown');
  if(!dd)return;
  let isOpen=dd.style.display==='block';
  dd.style.display=isOpen?'none':'block';
  if(!isOpen){
    setTimeout(function(){
      document.addEventListener('click',closePriceDropdown,{once:true});
    },0);
  }
}
/** 关闭「新增报价」下拉菜单 */
function closePriceDropdown(){
  let dd=document.getElementById('priceDropdown');
  if(dd)dd.style.display='none';
}

/* ---- 批量导入报价（Excel 粘贴） ---- */
/** 打开批量导入报价抽屉（粘贴解析流程说明+文本框） */
function openPriceBatchAdd(){
  let body='<div class="batch-intro">'+
    '<div class="batch-steps">'+
      '<div class="bs-step"><span class="bs-n">①</span><span>从 Excel 复制报价数据（<b>Ctrl+A → Ctrl+C</b>）</span></div>'+
      '<div class="bs-step"><span class="bs-n">②</span><span>粘贴到下方文本框</span></div>'+
      '<div class="bs-step"><span class="bs-n">③</span><span>点击「解析」预览，确认后批量提交</span></div>'+
    '</div>'+
    '<div class="field">'+
      '<label class="f">从Excel粘贴数据</label>'+
      '<textarea id="priceBatchPaste" class="paste-area" tabindex="50" placeholder="从 Excel 复制数据后 Ctrl+V 粘贴到此&#10;支持列：供应商、SKU、规格、单价、联系人、有效期起&#10;（可选后续列：类型、标准、直径、硬度、表面处理、材质，未提供时自动从 BOM 匹配）&#10;首行如表头含关键词会自动跳过，序号列自动跳过"></textarea>'+
      '<div class="note">按 Tab 分列，换行分行；供应商按名称自动匹配；单价单位：元/千支</div>'+
    '</div>'+
    '<div style="margin-bottom:10px">'+
      '<button class="btn primary" onclick="parsePriceBatch()">'+icon('search')+'解析</button>'+
    '</div>'+
    '<div id="priceBatchPreview" class="batch-preview" style="display:none"></div>';
  openDrawer('批量导入报价',body,null,true,true);
}
/** Excel 日期序列号转 YYYY-MM-DD */
function excelSerialToDate(serial){
  const d=new Date(Math.round((serial-25569)*86400*1000));
  const y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0'),day=String(d.getUTCDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}
/** 将常见日期格式归一化为 YYYY-MM-DD */
function normalizePriceDate(v){
  const s=(v||'').trim();
  if(!s)return '';
  if(/^\d+(\.\d+)?$/.test(s)&&parseFloat(s)>20000){return excelSerialToDate(parseFloat(s));}
  let m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if(m){return m[1]+'-'+String(+m[2]).padStart(2,'0')+'-'+String(+m[3]).padStart(2,'0');}
  m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if(m){return m[3]+'-'+String(+m[1]).padStart(2,'0')+'-'+String(+m[2]).padStart(2,'0');}
  return s;
}
/** 按名称或ID匹配供应商（仅'供应商'角色） */
function matchPriceSupplier(name){
  const s=(name||'').trim();
  if(!s)return null;
  const sups=DB.units.filter(u=>u.roles.includes('供应商'));
  let hit=sups.find(u=>u.id===s||u.name===s);
  if(hit)return hit;
  hit=sups.find(u=>u.name.indexOf(s)!==-1||s.indexOf(u.name)!==-1);
  return hit||null;
}
/** 解析粘贴的报价数据并预览 */
function parsePriceBatch(){
  let raw=document.getElementById('priceBatchPaste').value;
  if(!raw.trim()){toast('请先粘贴数据','warning');return;}
  let lines=raw.split(/\r?\n/).filter(function(l){return l.trim();});
  if(!lines.length){toast('未检测到有效数据','warning');return;}
  let headerKeywords=['序号','供应商','sku','规格','单价','联系人','有效期'];
  let allCols=lines[0].split('\t');
  let isHeader=false;
  for(let j=0;j<allCols.length;j++){
    let c=(allCols[j]||'').trim().toLowerCase();
    for(let k=0;k<headerKeywords.length;k++){
      if(c.indexOf(headerKeywords[k].toLowerCase())!==-1){isHeader=true;break;}
    }
    if(isHeader)break;
  }
  let dataLines=isHeader?lines.slice(1):lines;
  let attrFields=['type','standard','diameter','hardness','surface','material'];
  let parsed=[];
  let errCount=0;
  for(let l=0;l<dataLines.length;l++){
    let cols=dataLines[l].split('\t');
    let firstColVal=(cols[0]||'').trim();
    let firstIsNum=/^\d+$/.test(firstColVal);
    let startIdx=firstIsNum?1:0;
    let valid=cols.slice(startIdx).filter(function(c){return c.trim();});
    if(valid.length===0)continue;
    let row={unitId:'',unitName:'',bomSku:'',spec:'',price:0,contact:'',validFrom:'',attrs:{type:'',standard:'',diameter:'',hardness:'',surface:'',material:''},supplierMatched:false,bomMatched:false,reason:''};
    try{
      if(valid.length>=1){row.unitName=valid[0].trim();let sup=matchPriceSupplier(row.unitName);if(sup){row.unitId=sup.id;row.supplierMatched=true;}else{row.reason='供应商未匹配';}}
      if(valid.length>=2){row.bomSku=valid[1].trim();}
      if(valid.length>=3){row.spec=valid[2].trim();}
      if(valid.length>=4){let p=parseFloat(valid[3].trim());row.price=isNaN(p)?0:p;}
      if(valid.length>=5){row.contact=valid[4].trim();}
      if(valid.length>=6){row.validFrom=normalizePriceDate(valid[5]);}
      for(let m=6;m<valid.length&&(m-6)<attrFields.length;m++){
        row.attrs[attrFields[m-6]]=valid[m].trim();
      }
      if(!row.unitId){errCount++;}
      if(!(row.price>0)){row.reason='单价无效';errCount++;}
      if(row.bomSku){
        let bom=_getBom(row.bomSku);
        if(bom){
          row.spec=row.spec||bom.spec||'';
          attrFields.forEach(function(k){if(!row.attrs[k])row.attrs[k]=bom[k]||'';});
          row.bomMatched=true;
        }
      }
      parsed.push(row);
    }catch(e){errCount++;continue;}
  }
  if(!parsed.length){
    toast('解析失败，未识别到有效数据行','error');
    return;
  }
  renderPriceBatchPreview(parsed);
  window._batchPriceData=parsed;
  if(errCount>0)toast('共 '+errCount+' 行解析失败已跳过','warning');
  else toast('解析完成，共 '+parsed.length+' 条','success');
}
/** 渲染批量导入报价预览表 */
function renderPriceBatchPreview(data){
  let cols_=['编号','供应商','SKU','规格','单价','联系人','有效期起','BOM状态','操作'];
  let rowsHtml=data.map(function(r,i){
    return '<tr>'+
      '<td>'+(i+1)+'</td>'+
      '<td>'+(r.supplierMatched?escHtml(r.unitName):'<span class="tag warn">'+escHtml(r.unitName||'-')+'</span>')+'</td>'+
      '<td>'+escHtml(r.bomSku||'-')+'</td>'+
      '<td>'+escHtml(r.spec||'-')+'</td>'+
      '<td>'+fmt(r.price)+'</td>'+
      '<td>'+escHtml(r.contact||'-')+'</td>'+
      '<td>'+escHtml(r.validFrom||'-')+'</td>'+
      '<td><span class="tag '+(r.bomMatched?'ok':'warn')+'">'+(r.bomMatched?'已匹配':(r.bomSku?'未匹配':'—'))+'</span></td>'+
      '<td class="td-act"><button class="btn sm danger" onclick="removePriceBatchRow('+i+')">'+icon('x')+'</button></td>'+
    '</tr>';
  }).join('');
  let preview=document.getElementById('priceBatchPreview');
  preview.innerHTML=
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto">'+
      '<table><thead><tr>'+
        cols_.map(function(c){return '<th>'+c+'</th>';}).join('')+
      '</tr></thead><tbody>'+rowsHtml+'</tbody></table>'+
    '</div>'+
    '<div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px">'+
      '<button class="btn" onclick="closeDrawer()">取消</button>'+
      '<button class="btn primary" onclick="submitPriceBatch()">批量提交（'+data.length+' 条）</button>'+
    '</div>';
  preview.style.display='block';
}
/** 从批量导入预览中删除指定行 */
function removePriceBatchRow(idx){
  if(!window._batchPriceData)return;
  window._batchPriceData.splice(idx,1);
  if(!window._batchPriceData.length){closeDrawer();toast('已清空所有数据','info');return;}
  renderPriceBatchPreview(window._batchPriceData);
}
/** 提交批量导入报价（含重复检查） */
function submitPriceBatch(){
  const rows=window._batchPriceData||[];
  if(!rows.length){toast('没有可提交的数据','warning');return;}
  let added=0,dup=0,bad=0;
  rows.forEach(function(r){
    if(!r.unitId||!(r.price>0)){bad++;return;}
    if(isPriceDuplicate(r.unitId,r.bomSku||'',r.spec||'',r.attrs,null)){dup++;return;}
    DB.prices.push({id:uid('PR'),unitId:r.unitId,contact:r.contact||'',type:r.attrs.type,standard:r.attrs.standard,diameter:r.attrs.diameter,hardness:r.attrs.hardness,surface:r.attrs.surface,material:r.attrs.material,bomSku:r.bomSku||'',price:r.price,validFrom:r.validFrom||today(),remark:'',spec:r.spec||'',createdAt:today()});
    added++;
  });
  saveDB();
  let msg='';
  if(added>0){closeDrawer();render();clearDraft(DRAFT_TYPES.price);msg='成功导入 '+added+' 条报价';}
  else{msg='未导入任何报价';}
  if(dup>0)msg+='，跳过重复 '+dup+' 条';
  if(bad>0)msg+='，'+bad+' 行无效';
  toast(msg,added>0?'success':'warning');
}
