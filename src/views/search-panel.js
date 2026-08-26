// views/search-panel.js — 全局 AI 搜索（⌘K 命令面板）
// 搜索订单/客户/报价/BOM/结算/发票，直达详情；输入问题可直达 AI 助手
let _cmdOpen=false;
let _cmdSel=-1;
let _cmdResults=[];
let _cmdQuery='';
let _cmdTimer=0;

const _CMD_TYPE_LABEL={order:'订单',unit:'客户',price:'报价',bom:'BOM',settle:'结算',invoice:'发票'};

function _cmdUnitName(id){const u=(DB.units||[]).find(x=>x.id===id);return u?u.name:(id||'');}
function _cmdSpecOf(it){return [it.type,it.standard,it.diameter,it.hardness,it.surface,it.material].filter(Boolean).join(' ');}
function _cmdMoney(v){return '¥'+Number(v||0).toLocaleString('zh-CN',{maximumFractionDigits:2});}
function _cmdSales(o){return typeof orderSales==='function'?orderSales(o):0;}

/** 关键字高亮（escHtml 后按原词索引，q 已小写） */
function _cmdHit(text,q){
  const t=escHtml(String(text==null?'':text));
  if(!q)return t;
  const i=t.toLowerCase().indexOf(q);
  if(i<0)return t;
  return t.slice(0,i)+'<mark class="cmd-hit">'+t.slice(i,i+q.length)+'</mark>'+t.slice(i+q.length);
}

/** 六源搜索：返回 [{type,title,sub,action}]，按数据源顺序分组 */
function cmdSearch(q){
  q=(q||'').trim().toLowerCase();
  const out=[];
  if(!q)return out;
  (DB.orders||[]).forEach(o=>{
    const buyer=_cmdUnitName(o.buyerId);
    const items=(o.items||[]).map(it=>(it.sku||'')+' '+(it.name||'')).join(' ');
    if([o.id,buyer,o.status||'',items].join(' ').toLowerCase().includes(q)){
      out.push({type:'order',title:o.id+' · '+buyer,sub:(o.status||'')+' · '+_cmdMoney(_cmdSales(o)),
        action:function(){curOrderView=o.id;go('orders');}});
    }
  });
  (DB.units||[]).forEach(u=>{
    const hay=[u.name,(u.roles||[]).join(' '),u.rating||'',typeof u.contact==='string'?u.contact:'',JSON.stringify(u.contacts||[])].join(' ').toLowerCase();
    if(hay.includes(q)){
      out.push({type:'unit',title:u.name,sub:(u.roles||[]).join('/')+(u.rating?' · '+u.rating:''),
        action:function(){go('units');}});
    }
  });
  (DB.prices||[]).forEach(p=>{
    const sup=_cmdUnitName(p.unitId);
    if([_cmdSpecOf(p),sup,String(p.price||'')].join(' ').toLowerCase().includes(q)){
      out.push({type:'price',title:_cmdSpecOf(p)||'(无规格)',sub:sup+' · '+_cmdMoney(p.price),
        action:function(){go('prices');}});
    }
  });
  (DB.bom||[]).forEach(b=>{
    if([b.sku||'',b.name||'',_cmdSpecOf(b)].join(' ').toLowerCase().includes(q)){
      out.push({type:'bom',title:((b.sku||'')+' '+(b.name||'')).trim(),sub:_cmdSpecOf(b),
        action:function(){go('bom');}});
    }
  });
  (DB.settlements||[]).forEach(s=>{
    const n=_cmdUnitName(s.unitId);
    if([n,s.type||'',String(s.amount||'')].join(' ').toLowerCase().includes(q)){
      out.push({type:'settle',title:n,sub:(s.type||'')+' · '+_cmdMoney(s.amount),
        action:function(){go('settlements');}});
    }
  });
  (DB.invoices||[]).forEach(v=>{
    const n=_cmdUnitName(v.unitId);
    if([n,v.type||'',String(v.amount||'')].join(' ').toLowerCase().includes(q)){
      out.push({type:'invoice',title:n,sub:(v.type||'')+' · '+_cmdMoney(v.amount),
        action:function(){go('invoices');}});
    }
  });
  return out.slice(0,40);
}

function cmdRender(){
  const box=document.getElementById('cmdResults');
  if(!box)return;
  const q=_cmdQuery;
  _cmdResults=cmdSearch(q);
  _cmdSel=_cmdResults.length?0:-1;
  if(!_cmdResults.length){
    box.innerHTML='<div class="cmd-empty"><div>无匹配结果</div><button type="button" class="cmd-ask-ai" onclick="askAISearch()">'+icon('zap','13')+' 问 AI</button></div>';
    return;
  }
  const groups={};
  _cmdResults.forEach(r=>{(groups[r.type]=groups[r.type]||[]).push(r);});
  let html='',idx=0;
  Object.keys(groups).forEach(k=>{
    html+='<div class="cmd-group"><div class="cmd-group-title">'+_CMD_TYPE_LABEL[k]+'</div>';
    groups[k].slice(0,5).forEach(r=>{
      html+='<div class="cmd-row'+(idx===_cmdSel?' sel':'')+'" data-i="'+idx+'" onmouseenter="cmdHover('+idx+')" onclick="cmdOpen('+idx+')">'+
        '<div class="cmd-row-main"><div class="cmd-row-title">'+_cmdHit(r.title,q)+'</div>'+
        (r.sub?'<div class="cmd-row-sub">'+escHtml(r.sub)+'</div>':'')+'</div>'+
        '<span class="cmd-row-go">'+icon('chevronRight','14')+'</span></div>';
      idx++;
    });
    html+='</div>';
  });
  box.innerHTML=html;
}

function cmdInputKey(e){
  const k=e.key;
  if(k==='Escape'){e.preventDefault();closeSearchPanel();return;}
  if(k==='ArrowDown'){e.preventDefault();if(_cmdResults.length)_cmdSel=Math.min(_cmdSel+1,_cmdResults.length-1);cmdRender();return;}
  if(k==='ArrowUp'){e.preventDefault();if(_cmdResults.length)_cmdSel=Math.max(_cmdSel-1,0);cmdRender();return;}
  if(k==='Enter'){
    e.preventDefault();
    if(_cmdResults.length&&_cmdSel>=0){cmdOpen(_cmdSel);return;}
    askAISearch();
    return;
  }
  if(k==='Tab'){
    e.preventDefault();
    if(_cmdResults.length&&_cmdSel>=0){askAIOnItem(_cmdSel);return;}
    return;
  }
}

function cmdHover(i){_cmdSel=i;const rows=document.querySelectorAll('#cmdResults .cmd-row');rows.forEach((r,j)=>r.classList.toggle('sel',j===i));}
function cmdOpen(i){
  const r=_cmdResults[i];if(!r)return;
  closeSearchPanel();
  if(r.action)r.action();
}

/** 用当前输入直接问 AI（打开 AI 助手并自动发送） */
function askAISearch(){
  const input=document.getElementById('cmdInput');
  const text=input?input.value.trim():'';
  if(!text)return;
  closeSearchPanel();
  if(typeof openAIWithMessage==='function')openAIWithMessage(text,'');
  else toast('AI 助手不可用','warning');
}

/** 把选中条目作为上下文问 AI */
function askAIOnItem(i){
  const r=_cmdResults[i];if(!r)return;
  const text='请分析这条数据：'+r.title+(r.sub?'（'+r.sub+'）':'');
  closeSearchPanel();
  if(typeof openAIWithMessage==='function')openAIWithMessage(text,'搜索结果：'+r.type+' | '+r.title+(r.sub?' | '+r.sub:''));
  else toast('AI 助手不可用','warning');
}

function openSearchPanel(){
  if(_cmdOpen)return;
  _cmdOpen=true;_cmdQuery='';_cmdResults=[];_cmdSel=-1;
  if(document.querySelector('.drawer-wrap')&&typeof closeDrawer==='function'){try{closeDrawer();}catch(e){}}
  const wrap=document.createElement('div');
  wrap.id='cmdPanel';
  wrap.className='cmd-overlay';
  wrap.innerHTML=
    '<div class="cmd-panel" role="dialog" aria-label="全局搜索">'+
      '<div class="cmd-input-wrap"><div class="cmd-input-box">'+icon('search','18')+
        '<input id="cmdInput" class="cmd-input" type="text" placeholder="搜索或直接提问…" autocomplete="off" spellcheck="false" onkeydown="cmdInputKey(event)" oninput="cmdInputChanged(this.value)">'+
        '<button type="button" class="cmd-close" onclick="closeSearchPanel()" title="关闭 (Esc)">'+icon('x','15')+'</button>'+
      '</div></div>'+
      '<div id="cmdResults" class="cmd-results"></div>'+
      '<div class="cmd-footer"><span><kbd class="cmd-kbd">↑↓</kbd> 选择</span><span><kbd class="cmd-kbd">Enter</kbd> 打开</span><span><kbd class="cmd-kbd">Tab</kbd> 问 AI</span><span><kbd class="cmd-kbd">Esc</kbd> 关闭</span><span class="cmd-ai-hint">'+icon('zap','12')+' 直接输入问题回车 = 问 AI</span></div>'+
    '</div>';
  wrap.addEventListener('mousedown',function(e){if(e.target===wrap)closeSearchPanel();});
  document.body.appendChild(wrap);
  const input=document.getElementById('cmdInput');
  if(input){input.focus();input.select();}
}
function cmdInputChanged(v){
  _cmdQuery=(v||'').toLowerCase();
  clearTimeout(_cmdTimer);
  _cmdTimer=setTimeout(cmdRender,150);
}
function closeSearchPanel(){
  if(!_cmdOpen)return;
  _cmdOpen=false;
  const w=document.getElementById('cmdPanel');
  if(w)w.remove();
}
