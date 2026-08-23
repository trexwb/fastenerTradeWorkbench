// views/specs.js — 属性选项管理
/* =========================================================
   属性选项管理
   ========================================================= */

/* 使用情况统计 */
/**
 * 统计指定属性值在报价/BOM/订单中的引用次数（含寻源状态的订单匹配）。
 * @param {string} k - 属性字段名（SPEC_FIELDS 之一）
 * @param {string} v - 属性值
 * @returns {Object} 引用统计 {prices, bom, orders, total}
 */
function countSpecUsage(k,v){
  const sv=(v||'').trim();
  if(!sv)return {prices:0,bom:0,orders:0,total:0};
  let p=(DB.prices||[]).filter(function(p){return p[k]===sv;}).length;
  let b=(DB.bom||[]).filter(function(b){return b[k]===sv;}).length;
  let originOrders=(DB.orders||[]).filter(function(o){return o.items.some(function(it){return it[k]===sv;});}).length;
  let orderWithSourcing=0;
  (DB.orders||[]).forEach(function(o){
    let hit=false;
    o.items.forEach(function(it){
      (it.options||[]).forEach(function(opt){
        let specVal=it[k];
        if(!specVal){
          let bomItem=(DB.bom||[]).find(function(bb){return bb.id===it.bomId||bb.sku===it.sku;});
          if(bomItem)specVal=bomItem[k];
        }
        if(specVal===sv)hit=true;
      });
    });
    if(hit)orderWithSourcing++;
  });
  let totalOrders=originOrders+orderWithSourcing;
  return {prices:p,bom:b,orders:totalOrders,total:p+b+totalOrders};
}

/* 批量导入弹窗 HTML */
/**
 * 生成批量导入属性选项的弹窗 HTML（含多行粘贴区）。
 * @param {string} k - 属性字段名（SPEC_FIELDS 之一）
 * @returns {string} 弹窗主体 HTML
 */
function batchImportSpecHTML(k){
  const label=SPEC_LABELS[k];
  return '<div class="field">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
      '<label class="f" style="margin:0">批量添加「'+escHtml(label)+'」选项</label>'+
    '</div>'+
    '<textarea id="bi_text" class="paste-area" tabindex="1" placeholder="粘贴多个值，每行或每行一个&#10;示例：&#10;不锈钢304&#10;碳钢&#10;铜&#10;铝合金"></textarea>'+
    '<div class="note" style="margin-top:6px">每行一个值，自动去除首尾空格和空行，重复值自动跳过</div>'+
  '</div>'+
  '<div id="bi_preview" style="display:none;margin-top:12px"></div>';
}

/* 渲染单个属性维度 */
/**
 * 渲染单个属性维度的管理面板（含搜索过滤、标签列表、新增输入框和引用统计）。
 * @param {string} k - 属性字段名（SPEC_FIELDS 之一）
 * @returns {string} 管理面板 HTML
 */
function renderSpecGroup(k){
  const label=SPEC_LABELS[k];
  const vals=(DB.specs[k]||[]);
  const isEmpty=!vals.length;
  // 统计
  const totalUsed=vals.reduce(function(s,v){return s+countSpecUsage(k,v).total;},0);
  // 过滤搜索
  const filterId='sff_'+k;
  // 批量导入按钮
  const batchBtn='<button class="btn sm ghost" onclick="openBatchImportSpec(\''+k+'\')" style="font-size:12px;padding:2px 10px">'+icon('upload','12')+' 批量导入</button>';
  const addComboId='specadd_'+k;
  return '<div class="spec-group" id="sg_'+k+'">'+
    '<div class="sg-hd" id="sgh_'+k+'">'+
      '<span class="tag info">'+escHtml(label)+'</span>'+
      '<span class="sg-count-badge" id="sgcb_'+k+'">'+vals.length+' 个值</span>'+
      '<span class="sg-used-badge'+(totalUsed>0?'':' sg-zero')+'" title="被引用的次数（报价+BOM+订单）" id="sgub_'+k+'">'+totalUsed+' 次引用</span>'+
      '<span style="flex:1"></span>'+
      batchBtn+
      '<button class="sg-toggle-btn" id="sgt_'+k+'" onclick="toggleSpecGroup(\''+k+'\')" title="展开/折叠">'+icon('chevronDown','14')+'</button>'+
    '</div>'+
    '<div class="sg-body" id="sgb_'+k+'">'+
      // 搜索过滤行
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
        '<div style="position:relative;flex:1">'+
          '<input id="'+filterId+'" type="text" placeholder="搜索已有值..." oninput="filterSpecVals(\''+k+'\',this.value)" style="width:100%;padding:6px 10px 6px 32px;font-size:13px;border:1px solid var(--line);border-radius:var(--radius);box-sizing:border-box;background:var(--card)">'+
          '<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--gray);pointer-events:none">'+icon('search','12')+'</span>'+
        '</div>'+
        '<button class="btn sm ghost" onclick="clearSpecFilter(\''+k+'\')" id="sfcl_'+k+'" style="display:none;font-size:12px;padding:2px 10px">清除</button>'+
      '</div>'+
      // 值标签列表
      '<div class="spec-tags" id="svt_'+k+'">'+
        vals.map(function(v,i){
          let usage=countSpecUsage(k,v);
          let unused=usage.total===0;
          return '<span class="spec-val-tag'+(unused?' unused':'')+'" id="svt_'+k+'_'+i+'" data-idx="'+i+'">'+
            '<span class="sv-text">'+escHtml(v)+'</span>'+
            (unused?'<span class="sv-unused-tag">(未使用)</span>':'')+
            '<span class="sv-del" onclick="event.stopPropagation();delSpecVal(\''+k+'\','+i+')" title="删除">×</span>'+
          '</span>';
        }).join('')+
        (isEmpty?'<span class="muted" style="font-size:13px">暂无选项，输入新值直接添加</span>':'')+
      '</div>'+
      // 添加输入框
      '<div style="display:flex;gap:8px;align-items:center;margin-top:8px">'+
        '<div id="'+addComboId+'" class="combo" data-placeholder="输入或选择新值，自动添加..." data-val="" style="flex:1"></div>'+
      '</div>'+
      '<div class="spec-add-hint">可直接输入自定义值，输入后自动添加到列表</div>'+
      // 使用情况（默认隐藏）
      '<div class="sg-usage" id="sgu_'+k+'" style="display:none">'+
        '<div class="sg-usage-hd">'+icon('info','12')+' 引用统计（实时）</div>'+
        vals.map(function(v,i){
          let u=countSpecUsage(k,v);
          return '<div class="sg-usage-row'+(u.total===0?' unused':'')+'">'+
            '<span>'+escHtml(v)+'</span>'+
            '<span>报价 <b>'+u.prices+'</b> 条</span>'+
            '<span>BOM <b>'+u.bom+'</b> 条</span>'+
            '<span>订单 <b>'+u.orders+'</b> 条</span>'+
            '<span>共 <b>'+u.total+'</b> 次</span>'+
            (u.total===0?' <span class="tag warn" style="font-size:11px">可清理</span>':'')+
          '</div>';
        }).join('')+
      '</div>'+
    '</div>'+
  '</div>';
}

/**
 * 渲染属性选项管理主视图（聚合所有属性维度的管理面板）。
 * @returns {string} 主视图 HTML
 */
function viewSpecs(){
  let html='<div class="card">'+
    '<h2>'+icon('tag','18')+'属性选项管理</h2>'+
    '<p class="note" style="margin-bottom:16px">管理各产品属性的可选值集合。这些选项将出现在签约报价和采购订单的属性下拉框中。无引用的值（显示「未使用」）可安全删除。</p>'+
    '<div class="specs-toolbar">'+
      '<button class="btn sm" onclick="openBatchImportSpec(null)">'+icon('upload','14')+' 批量导入全部维度</button>'+
      '<button class="btn sm" onclick="exportAllSpecs()">'+icon('download','14')+' 导出全部</button>'+
    '</div>';
  SPEC_FIELDS.forEach(function(k){html+=renderSpecGroup(k);});
  html+='</div>';
  return html;
}

/* 折叠/展开 */
/**
 * 切换属性维度的展开/折叠状态。
 * @param {string} k - 属性字段名
 * @returns {void} 无返回值
 */
function toggleSpecGroup(k){
  let body=document.getElementById('sgb_'+k);
  let btn=document.getElementById('sgt_'+k);
  if(!body)return;
  let isHidden=body.style.display==='none';
  body.style.display=isHidden?'':'none';
  if(btn)btn.innerHTML=isHidden?icon('chevronUp','14'):icon('chevronDown','14');
}

/* 搜索过滤 */
/**
 * 搜索过滤属性值标签（实时高亮匹配）。
 * @param {string} k - 属性字段名
 * @param {string} v - 搜索关键词
 * @returns {void} 无返回值
 */
function filterSpecVals(k,v){
  let vals=DB.specs[k]||[];
  let filterEl=document.getElementById('sff_'+k);
  let clearBtn=document.getElementById('sfcl_'+k);
  let container=document.getElementById('svt_'+k);
  if(!container)return;
  if(filterEl&&clearBtn){
    clearBtn.style.display=v?'inline-flex':'none';
  }
  let q=v.toLowerCase().trim();
  let spans=container.querySelectorAll('.spec-val-tag');
  spans.forEach(function(span){
    let text=span.querySelector('.sv-text');
    if(!text)return;
    span.style.display=(!q||text.textContent.toLowerCase().includes(q))?'':'none';
  });
}
/**
 * 清除属性值搜索过滤并恢复全部显示。
 * @param {string} k - 属性字段名
 * @returns {void} 无返回值
 */
function clearSpecFilter(k){
  let el=document.getElementById('sff_'+k);
  if(el)el.value='';
  filterSpecVals(k,'');
}

/* 删除属性值 */
/**
 * 删除指定属性值（含引用影响范围二次确认）。
 * @param {string} k - 属性字段名
 * @param {number} i - 值在数组中的索引
 * @returns {void} 无返回值
 */
function delSpecVal(k,i){
  let vals=DB.specs[k]||[];
  if(i<0||i>=vals.length)return;
  let v=vals[i];
  let usage=countSpecUsage(k,v);
  let impactMsg='';
  if(usage.total>0){
    impactMsg='\n\n⚠ 影响范围：报价 '+usage.prices+' 条、BOM '+usage.bom+' 条、订单 '+usage.orders+' 条。\n删除后这些记录将不再匹配此属性值。';
  }else{
    impactMsg='\n\n该值未被任何记录引用，可安全删除。';
  }
  confirmModal('确认删除「'+v+'」？'+impactMsg,function(){
    DB.specs[k].splice(i,1);
    saveDB();
    render();
    toast(SPEC_LABELS[k]+'值「'+v+'」已删除','info');
  },'确认删除');
}

/* 批量导入（单个维度或全维度） */
/**
 * 打开批量导入属性选项抽屉（支持单维度或全维度）。
 * @param {string|null} k - 属性字段名，null 表示全维度
 * @returns {void} 无返回值
 */
function openBatchImportSpec(k){
  let isAll=!k;
  let title=isAll?'批量导入全部属性选项':'批量导入「'+SPEC_LABELS[k]+'」选项';
  let bodyHTML='';
  if(isAll){
    // 全部维度：每个维度一个 textarea
    SPEC_FIELDS.forEach(function(fk){
      bodyHTML+='<div class="field" style="margin-bottom:14px">'+
        '<label class="f">'+escHtml(SPEC_LABELS[fk])+'</label>'+
        '<textarea id="bi_all_'+fk+'" class="paste-area" tabindex="11" placeholder="粘贴 '+SPEC_LABELS[fk]+' 的多个值，每行一个" style="min-height:60px;resize:vertical"></textarea>'+
      '</div>';
    });
  }else{
    bodyHTML=batchImportSpecHTML(k);
  }
  bodyHTML+='<div id="bi_preview_all" style="display:none;margin-top:12px"></div>';
  openDrawer(title,bodyHTML,function(){
    let added=0,skipped=0;
    let dimStats=[];
    let planWrite=[];
    if(isAll){
      SPEC_FIELDS.forEach(function(fk){
        let raw=document.getElementById('bi_all_'+fk);
        if(!raw)return;
        let lines=raw.value.split(/[\r\n]+/).map(function(l){return l.trim();}).filter(function(l){return l;});
        let existing=DB.specs[fk]||[];
        let dAdd=0,dSkip=0;
        let newVals=existing.slice();
        lines.forEach(function(v){
          if(newVals.includes(v)){dSkip++;return;}
          newVals.push(v);dAdd++;
        });
        planWrite.push({fk:fk,vals:newVals});
        added+=dAdd;skipped+=dSkip;
        dimStats.push(SPEC_LABELS[fk]+' +'+dAdd+'/-'+dSkip);
      });
    }else{
      let raw=document.getElementById('bi_text');
      if(!raw)return;
      let lines=raw.value.split(/[\r\n]+/).map(function(l){return l.trim();}).filter(function(l){return l;});
      let existing=DB.specs[k]||[];
      let newVals=existing.slice();
      lines.forEach(function(v){
        if(newVals.includes(v)){skipped++;return;}
        newVals.push(v);added++;
      });
      planWrite.push({fk:k,vals:newVals});
      dimStats.push(SPEC_LABELS[k]+' +'+added+'/-'+skipped);
    }
    let summary='解析完成：'+dimStats.join('、')+'，合计新增 '+added+' 条，确认提交？';
    toast(summary,'info');
    confirmModal(summary,function(){
      planWrite.forEach(function(p){DB.specs[p.fk]=p.vals;});
      saveDB();closeDrawer();render();
      let msg=added>0?'成功添加 '+added+' 个新值':'';
      if(skipped>0)msg+=(msg?', ':'')+'跳过 '+skipped+' 个重复值';
      toast(msg||'未添加任何新值','success');
    },'确认提交','取消');
  },true);
}

/* 导出全部属性 */
/**
 * 导出全部属性选项为 CSV 文件。
 * @returns {void} 无返回值
 */
function exportAllSpecs(){
  let lines=['属性维度,选项值,引用次数'];
  SPEC_FIELDS.forEach(function(k){
    let vals=DB.specs[k]||[];
    if(!vals.length){lines.push(SPEC_LABELS[k]+',(无)');return;}
    vals.forEach(function(v){
      let u=countSpecUsage(k,v);
      lines.push(SPEC_LABELS[k]+','+v+','+u.total);
    });
  });
  let csv=['\uFEFF'+lines.join('\n')];
  let blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  let a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='属性选项_'+today()+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  toast('已导出全部属性选项','success');
}
