// views/bom.js — BOM管理
/* =========================================================
   BOM管理
   ========================================================= */

/** 渲染BOM列表视图（含搜索、属性筛选栏、筛选徽章、分页）
 * @returns {string} BOM列表HTML字符串
 */
function viewBOM(){
  const filtered=filterBOMData();
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  if(_bomPage>totalPages)_bomPage=totalPages;
  const pageData=filtered.slice((_bomPage-1)*PAGE_SIZE,_bomPage*PAGE_SIZE);

  const rows=pageData.map((b)=>{
    const idx=DB.bom.indexOf(b);
    // 属性标签
    const tags=SPEC_FIELDS.filter(k=>b[k]).map(k=>
      '<span class="spec-tag-pill">'+escHtml(SPEC_LABELS[k])+'：'+escHtml(b[k]||'')+'</span>'
    ).join('');
    const tagHtml=tags?'<div class="row-spec-tags">'+tags+'</div>':'';
    const specLine=b.spec?'<div class="row-spec">'+escHtml(b.spec)+'</div>':'';
    // 首字母头像
    const avatar=b.name?(b.name[0]||'B').toUpperCase():'B';
    return '<tr>'+
      '<td><input type="checkbox" class="bom-check" data-id="'+escAttr(b.id||idx)+'" data-idx="'+idx+'" onchange="updateBOMBatchBtn()"></td>'+
      '<td><div class="bom-sku">'+escHtml(b.sku||'-')+'</div></td>'+
      '<td><b>'+escHtml(b.name||'-')+'</b></td>'+
      '<td>'+escHtml(b.spec||'-')+'</td>'+
      '<td>'+escHtml(b.type||'-')+'</td>'+
      '<td>'+escHtml(b.standard||'-')+'</td>'+
      '<td>'+escHtml(b.diameter||'-')+'</td>'+
      '<td>'+escHtml(b.hardness||'-')+'</td>'+
      '<td>'+escHtml(b.surface||'-')+'</td>'+
      '<td>'+escHtml(b.material||'-')+'</td>'+
      '<td class="td-act">'+
        '<button class="btn sm" onclick="openBOMForm('+idx+')">'+icon('edit','13')+'编辑</button>'+
        '<button class="btn sm danger" onclick="confirmBOMDel('+idx+')">'+icon('trash','13')+'删除</button>'+
      '</td>'+
    '</tr>';
  }).join('');

  const total=DB.bom.length;
  const matched=filtered.length;
  const isFiltered=bomSearch||hasBOMFilter();
  const countTag='<span id="bomCountTag" class="tag gray"'+(isFiltered?'':' style="display:none"')+'>'+matched+' / '+total+'</span>';

  // 筛选栏（灰色底框，激活时显示清除按钮）
  const filterRow='<div class="filter-bar" id="bomFilterBar">'+
    '<span class="filter-bar-label">'+icon('filter','13')+' 筛选</span>'+
    SPEC_FIELDS.map(k=>'<div id="bf_'+k+'" class="combo filt-combo" data-placeholder="'+SPEC_LABELS[k]+'" data-val=""></div>').join('')+
    '<button id="bomFilterClearBtn" class="btn sm ghost filt-clear" onclick="clearBOMFilter()"'+(isFiltered?'':' style="display:none"')+'>'+icon('x','12')+' 清除筛选</button>'+
  '</div>';

  // 激活筛选徽章（工具栏右侧）
  const filterBadge=isFiltered?'<span id="bomFilterBadge" class="filter-active-badge" onclick="clearBOMFilter()" title="点击清除所有筛选">'+icon('filter','12')+' 已筛选 '+matched+' 条</span>':'';

  const pg=buildPaging(filtered.length,_bomPage,totalPages,'bomPage',{id:'bomPaging'});

  return '<div class="toolbar">'+
    '<div class="search-box'+(bomSearch?' has-val':'')+'">'+
      '<a href="javascript:void(0)" onclick="onBOMSearch(document.getElementById(\'bomSearchInput\').value)" style="text-decoration:none;color:inherit;cursor:pointer;display:flex;align-items:center">'+icon('search','16')+'</a>'+
      '<input id="bomSearchInput" type="text" tabindex="1" value="'+escAttr(bomSearch||'')+'" placeholder="搜索 SKU 或名称..." onkeydown="if(event.key===\'Enter\')onBOMSearch(this.value)">'+
      '<span class="clear-btn" onclick="onBOMSearch(\'\')">×</span>'+
    '</div>'+
    filterBadge+
    '<div class="spacer"></div>'+
    countTag+
    '<button id="bomBatchDelBtn" class="btn sm" style="display:none" onclick="batchDeleteBOM()">'+icon('trash')+'批量删除(<span id="bomBatchCount">0</span>)</button>'+
    '<button class="btn" onclick="openBOMBatchAdd()">'+icon('upload','14')+' 批量导入</button>'+
    '<button class="btn primary" onclick="openBOMForm(-1)">'+icon('plus')+' 新建BOM</button>'+
  '</div>'+
  filterRow+
  '<div class="card"><div class="table-wrap"><table><thead><tr><th style="width:40px"><input type="checkbox" onchange="toggleAllBOM(this)" title="全选"></th><th>SKU</th><th style="min-width:160px">名称</th><th>规格</th><th>类型</th><th>标准</th><th>直径</th><th>硬度</th><th>表面处理</th><th>材质</th><th></th></tr></thead><tbody id="bomBody">'+
  (rows||'<tr><td colspan="11"><div class="no-data">'+(isFiltered?'无匹配结果，试试调整筛选条件':'暂无 BOM 记录，点击「新建BOM」开始')+'</div></td></tr>')+
  '</tbody></table></div>'+pg+'</div>';
}

/* 数据层 */
/** 根据搜索关键词和属性筛选下拉值过滤BOM数据 */
/**
 * 过滤BOM数据（数据层过滤函数）
 * 数据流：DB.bom → 按条件过滤 → 返回匹配数组
 * 
 * 过滤条件（AND关系）：
 * - 类型/标准/直径/硬度/表面/材质 combo筛选
 * - 搜索关键词匹配（SKU/名称/规格）
 * 
 * @returns {Array} 过滤后的BOM数组
 */
function filterBOMData(){
  const kw=bomSearch.toLowerCase().trim();
  const specVals={};
  SPEC_FIELDS.forEach(k=>{specVals[k]=getComboVal('bf_'+k);});
  return (DB.bom||[]).filter(b=>{
    if(kw){
      if(!(b.sku||'').toLowerCase().includes(kw)&&!(b.name||'').toLowerCase().includes(kw))return false;
    }
    for(const k of SPEC_FIELDS){
      const fv=specVals[k];if(!fv)continue;
      if((b[k]||'')!==fv)return false;
    }
    return true;
  });
}
/** 判断是否设置了任何BOM属性筛选条件
 * @returns {boolean} 是否有筛选条件
 */
function hasBOMFilter(){
  return SPEC_FIELDS.some(k=>getComboVal('bf_'+k));
}

/* 渲染层 */
/** 局部刷新BOM表格（计数标签、筛选徽章、分页、清除按钮同步更新） */
/**
 * 局部刷新BOM表格（渲染层函数）
 * 数据流：filterBOMData() → 分页 → DOM(#bomBody) + 分页条
 * 
 * 调用时机：
 * - 筛选条件变化
 * - 搜索关键词变化
 * - 分页切换
 * - 数据增删改
 */
function refreshBOMTable(){
  const filtered=filterBOMData();
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  if(_bomPage>totalPages)_bomPage=totalPages;
  const pageData=filtered.slice((_bomPage-1)*PAGE_SIZE,_bomPage*PAGE_SIZE);
  const isFiltered=bomSearch||hasBOMFilter();

  const rows=pageData.map(b=>{
    const idx=DB.bom.indexOf(b);
    const tags=SPEC_FIELDS.filter(k=>b[k]).map(k=>'<span class="spec-tag-pill">'+escHtml(SPEC_LABELS[k])+'：'+escHtml(b[k]||'')+'</span>').join('');
    const tagHtml=tags?'<div class="row-spec-tags">'+tags+'</div>':'';
    const specLine=b.spec?'<div class="row-spec">'+escHtml(b.spec)+'</div>':'';
    const avatar=(b.name?(b.name[0]||'B'):'B').toUpperCase();
    return '<tr>'+
      '<td><input type="checkbox" class="bom-check" data-id="'+escAttr(b.id||idx)+'" data-idx="'+idx+'" onchange="updateBOMBatchBtn()"></td>'+
      '<td><div class="bom-sku">'+escHtml(b.sku||'-')+'</div></td>'+
      '<td><b>'+escHtml(b.name||'-')+'</b></td>'+
      '<td>'+escHtml(b.spec||'-')+'</td>'+
      '<td>'+escHtml(b.type||'-')+'</td>'+
      '<td>'+escHtml(b.standard||'-')+'</td>'+
      '<td>'+escHtml(b.diameter||'-')+'</td>'+
      '<td>'+escHtml(b.hardness||'-')+'</td>'+
      '<td>'+escHtml(b.surface||'-')+'</td>'+
      '<td>'+escHtml(b.material||'-')+'</td>'+
      '<td class="td-act">'+
        '<button class="btn sm" onclick="openBOMForm('+idx+')">'+icon('edit','13')+'编辑</button>'+
        '<button class="btn sm danger" onclick="confirmBOMDel('+idx+')">'+icon('trash','13')+'删除</button>'+
      '</td>'+
    '</tr>';
  }).join('');

  const body=document.getElementById('bomBody');
  if(body)body.innerHTML=rows||'<tr><td colspan="11"><div class="no-data">'+(isFiltered?'无匹配结果，试试调整筛选条件':'暂无 BOM 记录，点击「新建BOM」开始')+'</div></td></tr>';

  let pgEl=document.getElementById('bomPaging');
  if(pgEl)pgEl.innerHTML=buildPaging(filtered.length,_bomPage,totalPages,'bomPage',{id:'bomPaging',showCount:false});

  // 计数标签更新（工具栏）
  let tag=document.getElementById('bomCountTag');
  if(tag){tag.style.display=isFiltered?'':'none';tag.textContent=filtered.length+' / '+(DB.bom||[]).length;}

  // 筛选激活徽章
  let badge=document.getElementById('bomFilterBadge');
  if(badge){
    badge.style.display=isFiltered?'':'none';
    if(isFiltered)badge.innerHTML=icon('filter','12')+' 已筛选 '+filtered.length+' 条';
  }
  let clearBtn=document.getElementById('bomFilterClearBtn');
  if(clearBtn)clearBtn.style.display=isFiltered?'':'none';
}

/** 翻页并刷新BOM表格
 * @param {number} n - 目标页码
 * @returns {void}
 */
function bomPage(n){
  const filtered=filterBOMData();
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  _bomPage=Math.max(1,Math.min(n,totalPages));
  refreshBOMTable();
}

/** 设置搜索关键词并刷新BOM表格（含搜索框高亮切换）
 * @param {string} v - 搜索关键词
 * @returns {void}
 */
function onBOMSearch(v){
  bomSearch=v;_bomPage=1;
  const box=document.querySelector('.search-box');
  if(box){if(v)box.classList.add('has-val');else box.classList.remove('has-val');}
  refreshBOMTable();
}

/** 清空所有搜索关键词和属性筛选条件并刷新
 * @returns {void}
 */
function clearBOMFilter(){
  bomSearch='';
  const box=document.querySelector('.search-box');
  if(box)box.classList.remove('has-val');
  let inp=document.getElementById('bomSearchInput');
  if(inp)inp.value='';
  SPEC_FIELDS.forEach(k=>{
    const el=document.getElementById('bf_'+k);
    if(el){el.dataset.val='';const inp=el.querySelector('input');if(inp)inp.value='';}
  });
  _bomPage=1;
  refreshBOMTable();
  toast('筛选已清除','info');
}

/* ---- 单条删除：直接 confirmModal，无需 drawer ---- */
/** 确认删除单条BOM（含报价/订单引用检查提示）
 * @param {number} idx - BOM在数组中的索引
 * @returns {void}
 */
function confirmBOMDel(idx){
  let bom=(DB.bom||[])[idx];
  if(!bom)return;
  let sku=bom.sku||'(空)';
  let bid=bom.id||'';
  // 检查报价关联
  let priceRefs=(DB.prices||[]).filter(p=>{
    return (bid&&p.bomId===bid)||p.bomId===sku||p.bomSku===sku;
  }).length;
  // 检查订单关联（bid 匹配 BOM id；bomSku/sku 匹配 SKU 字符串）
  let orderRefs=(DB.orders||[]).filter(o=>{
    return (o.items||[]).some(it=>{
      return (bid&&it.bomId===bid)||it.bomSku===sku||it.sku===sku;
    });
  }).length;
  let msg='确认删除 BOM「'+escHtml(sku)+'」？';
  if(priceRefs>0||orderRefs>0){
    msg+='\n\n⚠ 已被引用：';
    let parts=[];
    if(priceRefs>0)parts.push(priceRefs+' 条报价');
    if(orderRefs>0)parts.push(orderRefs+' 条订单');
    msg+=parts.join('、')+'。删除后相关记录将无法匹配到此 BOM，仅显示为 ID。';
  }
  confirmModal(msg,function(){
    DB.bom.splice(idx,1);
    saveDB();
    refreshBOMTable();
    toast('BOM「'+escHtml(sku)+'」已删除','info');
  },'确认删除');
}

/* ---- 表单：必填高亮 + 校验改进 ---- */
/** 打开BOM新建/编辑抽屉（新建时检测草稿恢复）
 * @param {number} idx - BOM在数组中的索引，-1表示新建
 * @returns {void}
 */
function openBOMForm(idx){
  const isNew=idx<0;
  if(isNew){
    if(checkDraftRestore(DRAFT_TYPES.bom,function(d){
      var b={sku:d.sku||'',name:d.name||'',spec:d.spec||'',type:d.type||'',standard:d.standard||'',diameter:d.diameter||'',hardness:d.hardness||'',surface:d.surface||'',material:d.material||''};
      _openBOMDrawer(b,idx);
      setTimeout(function(){
        restoreBOMDraft(d);
        var panel=document.querySelector('.drawer-panel');
        if(panel)bindDraftSave(panel,collectBOMDraft,DRAFT_TYPES.bom);
      },100);
    },function(){
      _openBOMDrawer({sku:'',name:'',spec:'',type:'',standard:'',diameter:'',hardness:'',surface:'',material:''},-1);
      setTimeout(function(){
        var panel=document.querySelector('.drawer-panel');
        if(panel)bindDraftSave(panel,collectBOMDraft,DRAFT_TYPES.bom);
      },100);
    },'BOM'))return;
  }
  const b=idx>=0?(DB.bom||[])[idx]:{sku:'',name:'',spec:'',type:'',standard:'',diameter:'',hardness:'',surface:'',material:''};
  _openBOMDrawer(b,idx);
  if(isNew){
    setTimeout(function(){
      var panel=document.querySelector('.drawer-panel');
      if(panel)bindDraftSave(panel,collectBOMDraft,DRAFT_TYPES.bom);
    },100);
  }
}
/** 渲染BOM表单抽屉内容并初始化combo下拉组件
 * @param {Object} b - BOM对象
 * @param {number} idx - BOM在数组中的索引，-1表示新建
 * @returns {void}
 */
function _openBOMDrawer(b,idx){
  const isNew=idx<0;
  const bodyHTML=
    '<div id="bomFormErr" class="form-err-banner" style="display:none;margin-bottom:14px"></div>'+
    '<div class="field"><label class="f">SKU <span style="color:#ef4444">*</span></label>'+
      '<input id="bom_sku" class="bom-req" tabindex="10" value="'+escAttr(b.sku)+'" placeholder="输入 SKU，如 SCR-M6-316 · SKU 唯一不可重复" oninput="bomValidateField(\'sku\')">'+
      '<div class="field-hint">全系统唯一，建议包含规格或材质信息</div>'+
    '</div>'+
    '<div class="field"><label class="f">名称 <span style="color:#ef4444">*</span></label>'+
      '<input id="bom_name" class="bom-req" tabindex="11" value="'+escAttr(b.name)+'" placeholder="如 六角螺栓 · 简洁明确的商品名称" oninput="bomValidateField(\'name\')">'+
    '</div>'+
    '<div class="field"><label class="f">规格 <span style="color:#ef4444">*</span></label>'+
      '<input id="bom_spec" class="bom-req" tabindex="12" value="'+escAttr(b.spec||'')+'" placeholder="如 M6×30mm · 描述尺寸规格" oninput="bomValidateField(\'spec\')">'+
    '</div>'+
    '<div class="bom-specs-section">'+
      '<div class="sec-hd" onclick="toggleBOMSpecsSection(this)">'+icon('chevronDown','13')+' 其他属性（点击展开）</div>'+
      '<div class="sec-body sec-collapsed" id="bom_specs_body">'+
        '<div class="grid3">'+
          '<div class="field"><label class="f">类型</label><div id="bom_type" class="combo" data-placeholder="选择类型..." data-val="'+escAttr(b.type||'')+'"></div></div>'+
          '<div class="field"><label class="f">标准</label><div id="bom_standard" class="combo" data-placeholder="选择标准..." data-val="'+escAttr(b.standard||'')+'"></div></div>'+
          '<div class="field"><label class="f">直径</label><div id="bom_diameter" class="combo" data-placeholder="选择直径..." data-val="'+escAttr(b.diameter||'')+'"></div></div>'+
          '<div class="field"><label class="f">硬度</label><div id="bom_hardness" class="combo" data-placeholder="选择硬度..." data-val="'+escAttr(b.hardness||'')+'"></div></div>'+
          '<div class="field"><label class="f">表面处理</label><div id="bom_surface" class="combo" data-placeholder="选择表面处理..." data-val="'+escAttr(b.surface||'')+'"></div></div>'+
          '<div class="field"><label class="f">材质</label><div id="bom_material" class="combo" data-placeholder="选择材质..." data-val="'+escAttr(b.material||'')+'"></div></div>'+
        '</div>'+
      '</div>'+
    '</div>';
  openDrawer(isNew?'新建BOM':'编辑BOM：'+escHtml(b.sku||''),bodyHTML,()=>saveBOMForm(idx),true);
  _bomEditIdx=idx;
  setTimeout(()=>{
    SPEC_FIELDS.forEach(k=>{
      const el=document.getElementById('bom_'+k);
      if(!el)return;
      combo(el,(DB.specs[k]||[]).map(v=>({id:v,label:v})),opt=>{
        el.dataset.val=opt.id;
        let v=(opt.id||'').trim();
        if(!v)return;
        if(!DB.specs[k])DB.specs[k]=[];
        if(!DB.specs[k].includes(v)){DB.specs[k].push(v);saveDB();}
      },'选择或输入新值...',true);
    });
  },50);
}
let _bomEditIdx=-1;

/* 字段级校验：实时高亮 */
/** 实时校验BOM表单必填字段并高亮错误
 * @param {string} fld - 字段名（如'sku'/'name'/'spec'）
 * @returns {void}
 */
function bomValidateField(fld){
  let el=document.getElementById('bom_'+fld);
  if(!el)return;
  let val=el.value.trim();
  let hasErr=el.classList.contains('bom-req')&&!val;
  el.classList.toggle('field-err',hasErr);
}

/* 折叠区域 */
/** 切换BOM表单「其他属性」折叠区域展开/收起
 * @param {HTMLElement} el - 触发元素
 * @returns {void}
 */
function toggleBOMSpecsSection(el){
  let body=document.getElementById('bom_specs_body');
  if(!body)return;
  let isC=body.classList.toggle('sec-collapsed');
  el.innerHTML=(isC?icon('chevronDown','13'):icon('chevronUp','13'))+' 其他属性（点击'+(isC?'展开':'收起')+'）';
}

/* 保存表单 */
/** 校验并保存BOM表单（含SKU唯一性检查，新建/编辑复用）
 * @param {number} idx - BOM在数组中的索引，-1表示新建
 * @returns {void}
 */
function saveBOMForm(idx){
  // 校验
  let errs=[];
  let skuEl=document.getElementById('bom_sku');
  let nameEl=document.getElementById('bom_name');
  let specEl=document.getElementById('bom_spec');
  let sku=skuEl.value.trim();
  let name=nameEl.value.trim();
  let spec=specEl.value.trim();

  if(!sku){errs.push('请输入 SKU');skuEl.classList.add('field-err');}else skuEl.classList.remove('field-err');
  if(!name){errs.push('请输入名称');nameEl.classList.add('field-err');}else nameEl.classList.remove('field-err');
  if(!spec){errs.push('请输入规格');specEl.classList.add('field-err');}else specEl.classList.remove('field-err');

  // SKU 唯一性（编辑时排除自身记录，用闭包捕获原记录 ID）
  let originalId=idx>=0?((DB.bom||[])[idx]||{}).id:null;
  let dupIdx=-1;
  for(let i=0;i<(DB.bom||[]).length;i++){if(DB.bom[i].sku===sku){dupIdx=i;break;}}
  if(dupIdx>=0&&dupIdx!==idx){errs.push('SKU「'+sku+'」已存在，请使用其他编号');skuEl.classList.add('field-err');}

  if(errs.length){
    let errBanner=document.getElementById('bomFormErr');
    if(errBanner){errBanner.style.display='';errBanner.innerHTML='<span>'+icon('alertCircle','14')+'</span> '+errs.join(' &nbsp;·&nbsp; ')+'&nbsp; &nbsp; <span class="fe-dismiss" onclick="this.closest(\'.form-err-banner\').style.display=\'none\'">×</span>';}
    // 光标跳到第一个错误
    let firstErr=document.querySelector('.bom-req.field-err');
    if(firstErr)firstErr.focus();
    return;
  }

  let d={
    sku,name,spec,
    type:(document.getElementById('bom_type').dataset.val||'').trim(),
    standard:(document.getElementById('bom_standard').dataset.val||'').trim(),
    diameter:(document.getElementById('bom_diameter').dataset.val||'').trim(),
    hardness:(document.getElementById('bom_hardness').dataset.val||'').trim(),
    surface:(document.getElementById('bom_surface').dataset.val||'').trim(),
    material:(document.getElementById('bom_material').dataset.val||'').trim(),
  };
  DB.bom=DB.bom||[];
  if(idx>=0){
    if(!DB.bom[idx].id){d.id=uid('B');}else{d.id=DB.bom[idx].id;}
    DB.bom[idx]=d;
    toast('BOM「'+sku+'」已更新','success');
  }else{
    d.id=uid('B');
    DB.bom.push(d);
    toast('BOM「'+sku+'」已添加','success');
  }
  saveDB();closeDrawer();render();
  clearDraft(DRAFT_TYPES.bom);
}

/** 删除BOM入口，转发到confirmBOMDel
 * @param {number} idx - BOM在数组中的索引
 * @returns {void}
 */
function deleteBOM(idx){confirmBOMDel(idx);}

/* ---- 批量增加 ---- */
/** 打开批量导入BOM抽屉（粘贴解析流程说明+文本框）
 * @returns {void}
 */
function openBOMBatchAdd(){
  let body='<div class="batch-intro">'+
    '<div class="batch-steps">'+
      '<div class="bs-step"><span class="bs-n">①</span><span>从 Excel/CAD 导出表格中 <b>Ctrl+A → Ctrl+C</b> 全选复制</span></div>'+
      '<div class="bs-step"><span class="bs-n">②</span><span>粘贴到下方文本框</span></div>'+
      '<div class="bs-step"><span class="bs-n">③</span><span>点击「解析」预览，确认后批量提交</span></div>'+
    '</div>'+
    '<div class="field">'+
      '<label class="f">粘贴数据</label>'+
      '<textarea id="batchPaste" class="paste-area" tabindex="13" placeholder="粘贴 Excel 表格内容到此（Ctrl+V）\n支持列（按顺序）：SKU/名称 | 表面处理 | 规格 | 标准 | 直径 | 硬度 | 材质（至少填前4列）\n表头行会自动跳过，序号列会自动忽略"></textarea>'+
    '</div>'+
    '<div id="batchParseBtn" style="margin-bottom:10px">'+
      '<button class="btn primary" onclick="parseBOMBatch()">'+icon('search','14')+' 解析数据</button>'+
    '</div>'+
    '<div id="batchPreview" class="batch-preview" style="display:none"></div>';
  openDrawer('批量增加BOM',body,null,true,true);
}

/** 解析批量粘贴的表格数据并渲染预览表格
 * @returns {void}
 */
function parseBOMBatch(){
  let raw=document.getElementById('batchPaste').value;
  if(!raw.trim()){toast('请先粘贴数据','warning');return;}
  let lines=raw.split(/\r?\n/).filter(function(l){return l.trim();});
  if(!lines.length){toast('未检测到有效数据','warning');return;}

  let headerKeywords=['序号','名称','sku','表面处理','规格','名称/型号','物料编码'];
  let firstCols=lines[0].split('\t');
  let isHeader=false;
  outer:
  for(let j=0;j<firstCols.length;j++){
    let c=(firstCols[j]||'').trim().toLowerCase();
    for(let k=0;k<headerKeywords.length;k++){
      if(c.indexOf(headerKeywords[k])!==-1){isHeader=true;break outer;}
    }
  }
  let dataLines=isHeader?lines.slice(1):lines;

  let extraFields=['standard','diameter','hardness','material'];
  let parsed=[];
  let errCount=0;
  for(let li=0;li<dataLines.length;li++){
    let cols=dataLines[li].split('\t');
    let firstIsNum=/^\d+$/.test((cols[0]||'').trim());
    let startIdx=firstIsNum?1:0;
    let valid=cols.slice(startIdx).filter(function(c){return c.trim();});
    if(!valid.length)continue;
    let row={sku:'',name:'',spec:'',surface:'',standard:'',diameter:'',hardness:'',material:''};
    try{
      if(valid.length>=1){row.sku=valid[0].trim();row.name=row.sku;}
      if(valid.length>=2){row.surface=valid[1].trim();}
      if(valid.length>=3){row.spec=valid[2].trim();}
      for(let m=3;m<valid.length&&(m-3)<extraFields.length;m++){
        row[extraFields[m-3]]=valid[m].trim();
      }
      if(!row.sku){errCount++;continue;}
      parsed.push(row);
    }catch(e){errCount++;continue;}
  }

  if(!parsed.length){toast('解析失败，未识别到有效数据行','error');return;}

  let preview=document.getElementById('batchPreview');
  let cols_=['SKU','名称','规格','表面处理','标准','直径','硬度','材质'];
  let keys_=['sku','name','spec','surface','standard','diameter','hardness','material'];
  let rowsHtml=parsed.map(function(r,i){
    let tds=keys_.map(function(k){return'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r[k]||'-')+'</td>';}).join('');
    return'<tr><td>'+(i+1)+'</td>'+tds+'<td><button class="btn sm danger" onclick="removeBatchRow('+i+')">'+icon('x','12')+'</button></td></tr>';
  }).join('');
  preview.innerHTML=
    '<div style="margin-bottom:8px;font-size:13px;color:var(--gray)">解析完成，预览如下（可删除不需要的行）：</div>'+
    '<div class="table-wrap" style="max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:var(--radius)">'+
      '<table><thead><tr><th style="width:36px">#</th>'+cols_.map(function(c){return'<th style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c+'</th>';}).join('')+'<th style="width:40px"></th></tr></thead><tbody>'+rowsHtml+'</tbody></table>'+
    '</div>'+
    '<div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">'+
      '<button class="btn" onclick="closeDrawer()">取消</button>'+
      '<button class="btn primary" onclick="submitBOMBatch()">'+icon('check','14')+' 批量提交 ('+parsed.length+' 条)</button>'+
    '</div>';
  preview.style.display='block';
  document.getElementById('batchParseBtn').style.display='none';
  window._batchBOMData=parsed;
  if(errCount>0)toast('共 '+errCount+' 行解析失败已跳过','warning');
  else toast('解析完成，共 '+parsed.length+' 条，确认无误后提交','success');
}

/** 从批量导入预览中删除指定行并刷新预览
 * @param {number} idx - 行索引
 * @returns {void}
 */
function removeBatchRow(idx){
  if(!window._batchBOMData)return;
  window._batchBOMData.splice(idx,1);
  if(!window._batchBOMData.length){closeDrawer();toast('已清空所有数据','info');return;}
  let preview=document.getElementById('batchPreview');
  let cols_=['SKU','名称','规格','表面处理','标准','直径','硬度','材质'];
  let keys_=['sku','name','spec','surface','standard','diameter','hardness','material'];
  let rowsHtml=window._batchBOMData.map(function(r,i){
    let tds=keys_.map(function(k){return'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(r[k]||'-')+'</td>';}).join('');
    return'<tr><td>'+(i+1)+'</td>'+tds+'<td><button class="btn sm danger" onclick="removeBatchRow('+i+')">'+icon('x','12')+'</button></td></tr>';
  }).join('');
  preview.innerHTML=
    '<div style="margin-bottom:8px;font-size:13px;color:var(--gray)">解析完成，预览如下（可删除不需要的行）：</div>'+
    '<div class="table-wrap" style="max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:var(--radius)">'+
      '<table><thead><tr><th style="width:36px">#</th>'+cols_.map(function(c){return'<th style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c+'</th>';}).join('')+'<th style="width:40px"></th></tr></thead><tbody>'+rowsHtml+'</tbody></table>'+
    '</div>'+
    '<div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">'+
      '<button class="btn" onclick="closeDrawer()">取消</button>'+
      '<button class="btn primary" onclick="submitBOMBatch()">'+icon('check','14')+' 批量提交 ('+window._batchBOMData.length+' 条)</button>'+
    '</div>';
}

/** 批量提交解析后的BOM数据（含重复SKU去重）
 * @returns {void}
 */
function submitBOMBatch(){
  let data=window._batchBOMData;
  if(!data||!data.length){toast('没有可提交的数据','warning');return;}
  DB.bom=DB.bom||[];
  let existSKUs={};
  for(let i=0;i<DB.bom.length;i++)existSKUs[DB.bom[i].sku]=true;
  let batchSKUs={}; let skipped=0; let succ=0; let dupList=[];
  for(let i=0;i<data.length;i++){
    let r=data[i];
    if(!r.sku)continue;
    if(existSKUs[r.sku]||batchSKUs[r.sku]){skipped++;dupList.push(r.sku);continue;}
    batchSKUs[r.sku]=true;
    DB.bom.push({sku:r.sku,name:r.name||r.sku,spec:r.spec||'',type:'',standard:r.standard||'',diameter:r.diameter||'',hardness:r.hardness||'',surface:r.surface||'',material:r.material||''});
    succ++;
  }
  saveDB();closeDrawer();render();
  let msg='✅ 成功增加 '+succ+' 条 BOM';
  if(skipped>0)msg+='，⏭ 跳过 '+skipped+' 条重复 SKU（'+dupList.slice(0,3).join('、')+(dupList.length>3?'...':'')+'）';
  toast(msg,succ>0?'success':'warning');
}

/* ---- 批量删除 ---- */
/** 切换BOM列表全选/取消全选
 * @param {HTMLInputElement} cb - 全选复选框元素
 * @returns {void}
 */
function toggleAllBOM(cb){
  document.querySelectorAll('.bom-check').forEach(function(c){
    if(c.closest('tr').style.display!=='none')c.checked=cb.checked;
  });
  updateBOMBatchBtn();
}

/** 根据选中BOM数量更新批量删除按钮状态
 * @returns {void}
 */
function updateBOMBatchBtn(){
  let checked=document.querySelectorAll('.bom-check:checked');
  let btn=document.getElementById('bomBatchDelBtn');
  let cnt=document.getElementById('bomBatchCount');
  if(!btn)return;
  if(checked.length>0){
    btn.style.display='';
    if(cnt)cnt.textContent=checked.length;
  }else{
    btn.style.display='none';
  }
}

/** 批量删除选中的BOM（含报价/订单引用聚合检查提示）
 * @returns {void}
 */
function batchDeleteBOM(){
  let checks=document.querySelectorAll('.bom-check:checked');
  let indices=[];
  checks.forEach(function(c){indices.push(parseInt(c.dataset.idx));});
  indices.sort(function(a,b){return b-a;});
  // 引用关联聚合检查
  let totalPriceRefs=0;
  let totalOrderRefs=0;
  const refDetails=[];
  indices.forEach(function(i){
    const bom=(DB.bom||[])[i];
    if(!bom)return;
    const sku=bom.sku||'(空)';
    const bid=bom.id||'';
    let priceRefs=(DB.prices||[]).filter(p=>{
      return (bid&&p.bomId===bid)||p.bomId===sku||p.bomSku===sku;
    }).length;
    let orderRefs=(DB.orders||[]).filter(o=>{
      return (o.items||[]).some(it=>{
        return (bid&&it.bomId===bid)||it.bomSku===sku||it.sku===sku;
      });
    }).length;
    totalPriceRefs+=priceRefs;
    totalOrderRefs+=orderRefs;
    if(priceRefs>0||orderRefs>0){
      const parts=[];
      if(priceRefs>0)parts.push('报价'+priceRefs);
      if(orderRefs>0)parts.push('订单'+orderRefs);
      refDetails.push(escHtml(sku)+'('+parts.join('/')+')');
    }
  });
  let msg='确认删除选中的 '+indices.length+' 条 BOM？';
  if(totalPriceRefs>0||totalOrderRefs>0){
    const parts=[];
    if(totalPriceRefs>0)parts.push(totalPriceRefs+' 条报价');
    if(totalOrderRefs>0)parts.push(totalOrderRefs+' 条订单');
    msg='⚠ 以下 BOM 已被引用：'+refDetails.join('、')+'\n合计影响 '+parts.join('、')+'。删除后相关记录将无法匹配到此 BOM，仅显示为 ID。\n\n'+msg;
  }else{
    msg+='\n\n删除后这些 BOM 将从系统中移除。';
  }
  confirmModal(msg,function(){
    indices.forEach(function(i){if(DB.bom[i])DB.bom.splice(i,1);});
    saveDB();render();toast('已删除 '+indices.length+' 条 BOM','info');
  },'确认删除');
}

/* ---- BOM联动（供报价/订单页面调用） ---- */
/** 根据选中的BOM引用自动填充报价/订单表单的规格字段并锁定
 * @param {string} bomPrefix - 表单前缀（如'price'/'orderItem'）
 * @returns {void}
 */
function fillSpecFromBOM(bomPrefix){
  const sel=document.getElementById(bomPrefix+'_bom_ref');
  if(!sel)return;
  const bomId=sel.dataset.val;
  if(!bomId||bomId==='__manual__'){
    SPEC_FIELDS.forEach(k=>{
      const el=document.getElementById(bomPrefix+'_'+k);
      if(el){el.style.pointerEvents='';el.style.opacity='';el.dataset.val='';const inp=el.querySelector('input');if(inp)inp.value='';}
    });
    const specEl=document.getElementById(bomPrefix+'_spec');
    if(specEl){specEl.value='';specEl.readOnly=false;specEl.style.opacity='';}
    // 恢复SKU输入框可编辑
    const skuEl=document.getElementById(bomPrefix+'_sku');
    if(skuEl){skuEl.readOnly=false;skuEl.style.opacity='';}
    return;
  }
  const bomItem=(DB.bom||[]).find(b=>b.sku===bomId);
  if(!bomItem)return;
  SPEC_FIELDS.forEach(k=>{
    const el=document.getElementById(bomPrefix+'_'+k);
    if(el){
      const val=bomItem[k]||'';
      if(val){el.dataset.val=val;el.querySelector('input').value=val;el.style.pointerEvents='none';el.style.opacity='0.6';}
      else{el.dataset.val='';const inp=el.querySelector('input');if(inp)inp.value='';el.style.pointerEvents='';el.style.opacity='';}
    }
  });
  const specEl=document.getElementById(bomPrefix+'_spec');
  if(specEl){specEl.value=bomItem.spec||'';specEl.readOnly=true;specEl.style.opacity='0.6';}
  // SKU自动填入BOM的SKU并锁死
  const skuEl=document.getElementById(bomPrefix+'_sku');
  if(skuEl){skuEl.value=bomItem.sku||'';skuEl.readOnly=true;skuEl.style.opacity='0.6';}
}
