// views/data.js — 数据管理
/** 渲染存储架构状态卡片（IndexedDB/本地文件/localStorage 三段展示） */
function renderStorageStatus(sizeStr){
  return '<div class="card">'+
    '<h2>'+icon('database','18')+'数据管理</h2>'+
    '<div class="grid4 data-count-cards">'+
      '<div class="data-count-card">'+
        '<div class="dcc-icon" style="background:var(--pri-l);color:var(--pri)">'+icon('users','18')+'</div>'+
        '<div><div style="font-size:12px;color:var(--gray);margin-bottom:4px">关联单位</div><div style="font-size:22px;font-weight:700">'+DB.units.length+' 条</div></div>'+
      '</div>'+
      '<div class="data-count-card">'+
        '<div class="dcc-icon" style="background:var(--green-l);color:var(--green)">'+icon('tag','18')+'</div>'+
        '<div><div style="font-size:12px;color:var(--gray);margin-bottom:4px">价格记录</div><div style="font-size:22px;font-weight:700">'+DB.prices.length+' 条</div></div>'+
      '</div>'+
      '<div class="data-count-card">'+
        '<div class="dcc-icon" style="background:var(--amber-l);color:var(--amber)">'+icon('shoppingCart','18')+'</div>'+
        '<div><div style="font-size:12px;color:var(--gray);margin-bottom:4px">采购订单</div><div style="font-size:22px;font-weight:700">'+DB.orders.length+' 条</div></div>'+
      '</div>'+
      '<div class="data-count-card">'+
        '<div class="dcc-icon" style="background:var(--purple-l);color:var(--purple)">'+icon('database','18')+'</div>'+
        '<div><div style="font-size:12px;color:var(--gray);margin-bottom:4px">数据大小</div><div style="font-size:22px;font-weight:700">'+sizeStr+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div style="border-top:1px solid var(--line);padding-top:20px;">'+
      '<div class="data-section-hd">'+icon('database','16')+' 存储架构</div>'+
        '<div class="grid2" style="margin-bottom:12px">'+
          '<div style="background:'+(idbStatus==='error'?'var(--red-l)':idbStatus==='ok'?'var(--green-l)':'var(--bg-tint)')+';border:1px solid '+(idbStatus==='error'?'var(--red-line)':idbStatus==='ok'?'var(--green-line)':'var(--line)')+';border-radius:8px;padding:14px">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
              '<div style="font-size:12px;font-weight:600">IndexedDB <span class="tag info" style="font-size:12px;margin-left:4px">数据库</span></div>'+
              '<span class="tag '+(idbStatus==='error'?'err':'ok')+'">'+(idbStatus==='error'?'异常':'正常')+'</span>'+
            '</div>'+
            '<div style="font-size:14px;color:var(--gray)">数据大小 · '+sizeStr+'</div>'+
            '<div style="font-size:12px;margin-top:4px;color:var(--gray)">容量数百 MB+，所有业务数据的主存储</div>'+
          '</div>'+
          '<div style="background:'+(fileSync===true?'var(--green-l)':fileSync==='pending'?'var(--amber-l)':'var(--bg-tint)')+';border:1px solid '+(fileSync===true?'var(--green-line)':fileSync==='pending'?'var(--amber-line)':'var(--line)')+';border-radius:8px;padding:14px">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
              '<div style="font-size:12px;font-weight:600">本地 JSON 文件 <span class="tag info" style="font-size:12px;margin-left:4px">备份</span></div>'+
              '<span class="tag '+(fileSync===true?'ok':fileSync==='pending'?'warn':'gray')+'">'+(fileSync===true?'已同步':fileSync==='pending'?'待授权':'未绑定')+'</span>'+
            '</div>'+
            '<div style="font-size:14px;color:var(--gray)">'+(fileHandle?escHtml(fileHandle.name):'未绑定文件')+'</div>'+
            '<div style="font-size:12px;margin-top:4px;color:var(--gray)">磁盘文件，清缓存不丢数据</div>'+
          '</div>'+
        '</div>'+
        '<div id="storageQuota" style="margin-bottom:12px;background:var(--bg-tint);border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--gray)">'+
          icon('clock','12')+' 正在获取存储配额...'+
        '</div>'+
        '<div style="border-top:1px solid var(--line);padding-top:20px;">'+
          '<div style="display:flex;justify-content:space-between;align-items:center">'+
            '<div style="data-section-hd">'+icon('database','16')+' localStorage <span class="tag info" style="font-size:12px;margin-left:4px">表单草稿</span></div>'+
            '<span class="tag gray" style="font-size:12px">仅缓存</span>'+
          '</div>'+
          '<div style="font-size:12px;color:var(--gray)">仅用于表单填写过程中的自动草稿缓存，防止退出/关闭/误操作导致需要重新填写。提交后自动清除，不存储业务数据。</div>'+
        '</div>'+
    '</div>'+
  '</div>';
}

/** 渲染备份与恢复操作区（导出 JSON、导出 CSV、导入 JSON） */
function renderBackupSection(){
  return '<div style="border-top:1px solid var(--line);padding-top:20px;margin-bottom:20px">'+
      '<div class="card">'+
        '<div class="data-section-hd">'+icon('download','16')+' 备份与恢复</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">'+
          '<button class="btn primary" onclick="exportJSON()">'+icon('download')+'导出 JSON 备份</button>'+
          '<button class="btn" onclick="document.getElementById(\'importFile\').click()">'+icon('upload')+'导入 JSON 恢复</button>'+
          '<input type="file" id="importFile" accept=".json" style="display:none" onchange="importJSON(event)">'+
        '</div>'+
        '<div class="note" style="margin-bottom:0">导出的 JSON 文件包含全部数据（关联单位、属性、价格、订单）。导入时会覆盖当前数据，请谨慎操作。建议定期导出备份。</div>'+
      '</div>'+
    '</div>';
}

/** 渲染本地文件同步模块（根据同步状态展示绑定/授权/解绑操作） */
function renderFileSyncSection(){
  // Tauri 桌面版：数据存本机应用数据目录（IndexedDB 持久化），无需绑定本地文件
  if(AI.state.runtime==='tauri'){
    // 异步获取应用数据目录路径并填充（render 为同步流程，invoke 后按 id 更新）
    setTimeout(function(){
      if(window.__TAURI__&&window.__TAURI__.core&&typeof window.__TAURI__.core.invoke==='function'){
        window.__TAURI__.core.invoke('data_dir_get').then(function(path){
          const el=document.getElementById('dataDirPath');
          if(el&&path)el.textContent=path;
        }).catch(function(){});
      }
    },0);
    return '<div style="border-top:1px solid var(--line);padding-top:20px;margin-bottom:20px">'+
      '<div class="card">'+
        '<div class="data-section-hd">'+icon('fileText','16')+' 本地数据存储</div>'+
        '<div style="background:var(--green-l);border:1px solid var(--green-line);border-radius:8px;padding:14px">'+
          '<div style="font-size:14px;color:var(--gray);line-height:1.8">桌面版数据存储于<strong>本机应用数据目录</strong>（IndexedDB 持久化），不受浏览器清缓存影响，<strong>无需绑定本地文件</strong>。</div>'+
          '<div style="font-size:13px;margin-top:10px;color:var(--ink)"><b>数据目录</b><br><code id="dataDirPath" style="word-break:break-all">正在获取...</code></div>'+
          '<div style="font-size:12px;margin-top:6px;color:var(--gray)">数据文件与 DeepSeek API_KEY 均保存在此目录，卸载应用不影响（如需备份请复制该目录）。</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  let syncContent;
  if(fsaSupported()){
    if(fileSync===true){
      syncContent=
        '<div style="background:var(--green-l);border:1px solid var(--green-line);border-radius:8px;padding:14px;margin-bottom:12px">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="tag ok">已同步</span><b>'+escHtml(fileHandle?fileHandle.name:'')+'</b></div>'+
          '<div style="font-size:12px;color:var(--gray)">'+(fileLastSave?'最后同步：'+escHtml(fileLastSave):'')+' · 每次修改自动写入文件，浏览器清缓存不丢数据</div>'+
        '</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap">'+
          '<button class="btn" onclick="syncNow()">'+icon('refresh')+'立即同步</button>'+
          '<button class="btn danger" onclick="unbindFile()">'+icon('x')+'解绑文件</button>'+
        '</div>';
    }else if(fileSync==='pending'){
      syncContent=
        '<div style="background:var(--amber-l);border:1px solid var(--amber-line);border-radius:8px;padding:14px;margin-bottom:12px">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="tag warn">需重新授权</span><b>'+escHtml(fileHandle?fileHandle.name:'')+'</b></div>'+
          '<div style="font-size:12px;color:var(--gray)">刷新页面后浏览器需要重新授权才能读写文件，点击下方按钮授权</div>'+
        '</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap">'+
          '<button class="btn primary" onclick="reconnectFile()">'+icon('link')+'重新授权连接</button>'+
          '<button class="btn danger" onclick="unbindFile()" style="margin-left:8px">解绑</button>'+
        '</div>';
    }else{
      syncContent=
        '<div style="background:var(--bg-tint);border:1px solid var(--line);border-radius:8px;padding:14px;margin-bottom:12px">'+
          '<div style="font-size:14px;color:var(--gray);line-height:1.8">绑定一个本地 JSON 文件后，每次修改数据会<strong>自动写入文件</strong>。<br>即使浏览器清空缓存，数据也不会丢失——重新打开页面即可从文件恢复。</div>'+
        '</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap">'+
          '<button class="btn primary" onclick="bindFile()">'+icon('link')+'绑定本地文件</button>'+
        '</div>';
    }
  }else{
    syncContent='<div class="note">当前浏览器不支持文件同步（需 Chrome / Edge）。请使用「导出 JSON 备份」手动备份。</div>';
  }
  return '<div style="border-top:1px solid var(--line);padding-top:20px;margin-bottom:20px">'+
      '<div class="card">'+
        '<div class="data-section-hd">'+icon('fileText','16')+' 本地文件同步 <span class="tag ok" style="font-size:11px">推荐</span></div>'+
        syncContent+
      '</div>'+
    '</div>';
}

/** 渲染危险操作区（清空全部数据按钮及警告提示） */
function renderDangerZone(){
  return '<div style="border-top:1px solid var(--line);padding-top:20px">'+
      '<div class="card" style="border-color:var(--red-line)">'+
        '<div class="data-section-hd" style="color:var(--red)">'+icon('alertTriangle','16')+' 危险操作</div>'+
        '<button class="btn danger" onclick="clearAllData()">'+icon('trash')+'清空全部数据</button>'+
        '<div class="note" style="margin-top:8px;margin-bottom:0">清空后无法恢复，请确保已导出备份。</div>'+
      '</div>'+
    '</div>';
}

/** 渲染数据管理主视图（合并存储状态、备份、文件同步、危险操作四个模块） */
function viewData(){
  let dataSize=new Blob([JSON.stringify(DB)]).size;
  let sizeStr=dataSize<1024?dataSize+' B':(dataSize<1048576?(dataSize/1024).toFixed(1)+' KB':(dataSize/1048576).toFixed(2)+' MB');
  const tab=window._dataTab||'data';
  const tabs='<div class="data-tabs">'+
    '<button class="data-tab'+(tab==='data'?' active':'')+'" onclick="_switchDataTab(\'data\')">数据管理</button>'+
    '<button class="data-tab'+(tab==='history'?' active':'')+'" onclick="_switchDataTab(\'history\')">操作历史</button>'+
    '<button class="data-tab'+(tab==='trash'?' active':'')+'" onclick="_switchDataTab(\'trash\')">回收站</button>'+
    '</div>';
  let body='';
  if(tab==='history')body=renderOpsHistory();
  else if(tab==='trash')body=renderTrash();
  else body=renderStorageStatus(sizeStr)+renderBackupSection()+renderFileSyncSection()+renderDangerZone();
  return tabs+'<div class="data-tab-body">'+body+'</div>';
}
function _switchDataTab(name){window._dataTab=name;render();}

/** 导出全部数据为 JSON 备份文件并触发下载 */
function exportJSON(){
  // 导出不含回收站与操作历史（用户明确约束）
  let exportData={...DB};delete exportData.trash;delete exportData.aiOps;
  let data=JSON.stringify(exportData,null,2);
  let blob=new Blob([data],{type:'application/json'});
  let url=URL.createObjectURL(blob);
  let a=document.createElement('a');
  a.href=url;
  a.download='紧固件贸易工作台_备份_'+today()+'.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('已导出 '+DB.orders.length+' 条订单、'+DB.prices.length+' 条价格记录','success');
}

/** 导入 JSON 备份文件并覆盖当前数据库（含数据格式和完整性校验） */
function importJSON(event){
  let file=event.target.files[0];
  if(!file)return;
  let reader=new FileReader();
  reader.onload=function(e){
    try{
      let data=JSON.parse(e.target.result);
      // 导入数据不含回收站/操作历史（用户约束）：强制丢弃文件中可能存在的 trash/aiOps
      if(data&&typeof data==='object'){delete data.trash;delete data.aiOps;}
      if(!data.units||!data.prices||!data.orders){
        toast('文件格式不正确，缺少必要字段','error');
        return;
      }
      if(!Array.isArray(data.units)||!data.units.every(function(u){return u&&u.id&&u.name;})){
        toast('数据校验失败：关联单位数据不完整（缺少id或name）','error');
        return;
      }
      if(!Array.isArray(data.prices)){
        toast('数据校验失败：价格数据格式错误','error');
        return;
      }
      if(!Array.isArray(data.orders)){
        toast('数据校验失败：订单数据格式错误','error');
        return;
      }
      let badUnits=(data.settlements||[]).filter(function(s){return !(data.units||[]).some(function(u){return u.id===s.unitId;});});
      let badOrderRefs=[];(data.settlements||[]).forEach(function(s){(s.orders||[]).forEach(function(so){if(!(data.orders||[]).some(function(o){return o.id===so.orderId;}))badOrderRefs.push({sId:s.id,oId:so.orderId});});});
      let badInv=(data.invoices||[]).filter(function(inv){return !(data.settlements||[]).some(function(s){return s.id===inv.settleId;});});
      let badCount=badUnits.length+badOrderRefs.length+badInv.length;
      let warnMsg='';
      if(badCount>0){warnMsg='⚠ 数据完整性警告：'+badCount+' 条记录存在关联缺失（单位'+badUnits.length+'、订单引用'+badOrderRefs.length+'、发票关联'+badInv.length+'），导入后相关页面可能报错，是否仍继续？\n\n';}
      confirmModal(warnMsg+'导入将覆盖当前所有数据，确认继续?',function(){
        DB=data;
        if(!DB.specs)DB.specs=JSON.parse(JSON.stringify(DEFAULT_SPECS));
        if(!DB.bom)DB.bom=[];
        if(!DB.settlements)DB.settlements=[];
        if(!DB.invoices)DB.invoices=[];
        if(!DB.seq)DB.seq=100;
        if(!DB.orderSeq){
          let maxSeq=DB.orders.reduce(function(max,o){
            let m=o.id.match(/PO\d{8}-(\d+)/);
            return m?Math.max(max,parseInt(m[1],10)):max;
          },1);
          DB.orderSeq=maxSeq+1;
        }
        migrateItems();
        saveDB().then(function(){closeModal();render();});
        toast('数据已导入：'+DB.orders.length+' 订单、'+DB.prices.length+' 价格、'+DB.units.length+' 单位','success');
      },'确认导入');
    }catch(err){
      toast('文件解析失败：'+err.message,'error');
    }
  };
  reader.readAsText(file);
  event.target.value='';
}

/** 二次确认后清空所有数据库数据并重置为初始状态 */
function clearAllData(){
  confirmModal('您是否已导出最新的 JSON 备份文件？\n\n如未导出请先取消并到数据管理页点「导出 JSON 备份」。',function(){
    confirmModal('⚠ 确认清空全部数据？\n此操作不可恢复！',function(){
      DB={units:[],specs:JSON.parse(JSON.stringify(DEFAULT_SPECS)),bom:[],prices:[],orders:[],settlements:[],invoices:[],seq:100,orderSeq:1,trash:[],aiOps:[]};
      saveDB().then(function(){render();});
      toast('全部数据已清空','info');
    },'确认清空所有数据','取消保留数据');
  },'我已导出备份，继续','取消并去导出');
}

/* ===== 操作历史 / 回收站（阶段1：数据底座的用户操作面）===== */
const OP_LABEL={create:'新增',update:'修改',delete:'删除',restore:'恢复',flow:'流转',assign:'寻货'};
const TRASH_TYPE_LABEL={unit:'单位',spec:'属性',bom:'BOM',price:'报价',order:'订单',order_item:'订单明细',settlement:'结算',invoice:'发票'};
function _opTagCls(op){return op==='delete'?'err':(op==='create'?'green':(op==='restore'?'purple':''));}
/** 阶段4：操作历史筛选器渲染 */
function renderOpsFilter(){
  const f=window._aiOpsFilter||{op:'',operator:''};
  const opOpts=['',...Object.keys(OP_LABEL)].map(k=>'<option value="'+k+'"'+(f.op===k?' selected':'')+'>'+(k?OP_LABEL[k]:'全部操作')+'</option>').join('');
  const opOpts2=[{v:'',l:'全部操作者'},{v:'ai',l:'AI'},{v:'user',l:'用户'}].map(o=>'<option value="'+o.v+'"'+(f.operator===o.v?' selected':'')+'>'+o.l+'</option>').join('');
  return '<div class="ops-filter-bar">'+
    '<label class="ops-filter-item">操作类型<select onchange="_setAiOpsFilter(\'op\',this.value)">'+opOpts+'</select></label>'+
    '<label class="ops-filter-item">操作者<select onchange="_setAiOpsFilter(\'operator\',this.value)">'+opOpts2+'</select></label>'+
    '<button class="btn sm" onclick="_setAiOpsFilter(\'op\',\'\');_setAiOpsFilter(\'operator\',\'\');">重置</button>'+
    '<button class="btn sm" onclick="_aiOpsSelftest()">'+icon('check')+'自检</button>'+
    '</div>';
}
function _setAiOpsFilter(key,val){
  if(!window._aiOpsFilter)window._aiOpsFilter={op:'',operator:''};
  window._aiOpsFilter[key]=val;
  render();
}
/** 阶段4：AI 操作历史自检 —— 验证 aiOps 数据结构与关键函数可用性 */
function _aiOpsSelftest(){
  const checks=[];
  // 1. aiOps 数组结构
  const ops=DB.aiOps||[];
  checks.push({name:'aiOps 是数组',ok:Array.isArray(DB.aiOps)});
  checks.push({name:'aiOps 条数：'+ops.length,ok:true});
  // 2. 每条 op 必备字段
  let missingFields=0;
  ops.forEach(function(op){
    if(!op.id||!op.timestamp||!op.op||!op.type)missingFields++;
  });
  checks.push({name:'操作记录字段完整',ok:missingFields===0,detail:missingFields?missingFields+' 条缺失字段':''});
  // 3. 关键函数可用性
  const fns=['recordAiOp','undoAiOp','undoBatch','softDelete','restoreFromTrash','purgeTrash','clearTrash'];
  fns.forEach(function(fn){
    checks.push({name:'store.'+fn+' 可用',ok:typeof window[fn]==='function'});
  });
  // 4. AIT 模块可用
  checks.push({name:'AIT 模块加载',ok:typeof AIT!=='undefined'&&!!AIT.TOOLS_DEFS});
  if(typeof AIT!=='undefined'&&AIT.TOOLS_DEFS){
    checks.push({name:'AIT 工具数：'+AIT.TOOLS_DEFS.length,ok:AIT.TOOLS_DEFS.length>0});
    checks.push({name:'AIT.validateOp 可用',ok:typeof AIT.validateOp==='function'});
    checks.push({name:'AIT.executeOps 可用',ok:typeof AIT.executeOps==='function'});
    checks.push({name:'AIT.runQuery 可用',ok:typeof AIT.runQuery==='function'});
    checks.push({name:'AIT.runFlow 可用（阶段4）',ok:typeof AIT.runFlow==='function'});
    checks.push({name:'AIT.FLOW_TOOL_NAMES 可用（阶段4）',ok:!!AIT.FLOW_TOOL_NAMES&&AIT.FLOW_TOOL_NAMES.size>0});
  }
  // 5. trash 数组结构
  checks.push({name:'trash 是数组',ok:Array.isArray(DB.trash)});
  checks.push({name:'trash 条数：'+(DB.trash||[]).length,ok:true});
  // 渲染结果
  const allOk=checks.every(c=>c.ok);
  const rows=checks.map(c=>'<tr><td>'+escHtml(c.name)+'</td><td>'+(c.ok?'<span class="tag green">通过</span>':'<span class="tag err">失败</span>')+'</td><td>'+(c.detail?escHtml(c.detail):'')+'</td></tr>').join('');
  const summary=allOk?'✓ 全部 '+checks.length+' 项检查通过':'✗ 共 '+checks.filter(c=>!c.ok).length+' 项失败';
  modal('AI 操控系统自检',
    '<div class="selftest-summary '+(allOk?'ok':'fail')+'">'+summary+'</div>'+
    '<div class="table-wrap"><table><thead><tr><th>检查项</th><th>结果</th><th>详情</th></tr></thead><tbody>'+rows+'</tbody></table></div>',
    '关闭',null,true);
  toast(summary,allOk?'success':'warning');
}
/** 渲染操作历史 tab：最近 100 条 AI/用户操作，可单条回滚 */
function renderOpsHistory(){
  const allOps=DB.aiOps||[];
  if(!allOps.length)return '<div class="empty-state">暂无操作历史</div>';
  // 阶段4：按筛选条件过滤
  const f=window._aiOpsFilter||{op:'',operator:''};
  let ops=allOps;
  if(f.op)ops=ops.filter(o=>o.op===f.op);
  if(f.operator)ops=ops.filter(o=>o.operator===f.operator);
  const filterBar=renderOpsFilter();
  if(!ops.length)return filterBar+'<div class="empty-state">筛选后无匹配记录，<a onclick="_setAiOpsFilter(\'op\',\'\');_setAiOpsFilter(\'operator\',\'\');" style="cursor:pointer;color:var(--pri)">重置筛选</a></div>';
  // 统计每个 batchId 的未回滚操作数（用于判断是否显示「整批回滚」按钮）
  const batchUndoneCount={};
  ops.forEach(function(op){
    if(op.batchId&&!op.undone)batchUndoneCount[op.batchId]=(batchUndoneCount[op.batchId]||0)+1;
  });
  const rows=ops.slice(0,100).map(function(op){
    const time=new Date(op.timestamp).toLocaleString('zh-CN',{hour12:false});
    const label=OP_LABEL[op.op]||op.op;
    const typeLabel=TRASH_TYPE_LABEL[op.type]||op.type;
    const target=op.targetId?escHtml(String(op.targetId)):'—';
    const batchIdShort=op.batchId?escHtml(op.batchId.slice(0,8)):'—';
    const undoneTag=op.undone?'<span class="tag gray">已回滚</span>':'';
    const undoBtn=op.undone?'':'<button class="btn sm" onclick="undoAiOp(\''+escAttr(op.id)+'\');render();toast(\'已回滚\',\'info\');">回滚</button>';
    // 同批次多条未回滚操作时显示「整批回滚」按钮
    const batchBtn=(!op.undone&&op.batchId&&(batchUndoneCount[op.batchId]||0)>1)
      ?'<button class="btn sm" style="margin-left:4px" onclick="undoBatchConfirm(\''+escAttr(op.batchId)+'\');">整批回滚('+(batchUndoneCount[op.batchId])+')</button>'
      :'';
    return '<tr><td>'+time+'</td>'+
      '<td><span class="tag '+_opTagCls(op.op)+'">'+label+'</span></td>'+
      '<td>'+typeLabel+'</td><td>'+target+'</td>'+
      '<td>'+(op.operator==='ai'?'AI':'用户')+'</td>'+
      '<td>'+batchIdShort+'</td>'+
      '<td class="td-act">'+undoneTag+undoBtn+batchBtn+'</td></tr>';
  }).join('');
  const summary='<div class="ops-filter-summary">筛选后 '+ops.length+' / 共 '+allOps.length+' 条</div>';
  return filterBar+summary+'<div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>类型</th><th>目标</th><th>操作者</th><th>批次</th><th class="td-act">操作</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
/** 确认整批回滚（调用 store.js 的 undoBatch） */
function undoBatchConfirm(batchId){
  const ops=DB.aiOps||[];
  const count=ops.filter(o=>o.batchId===batchId&&!o.undone).length;
  if(!count){toast('该批次无可回滚操作','warning');return;}
  confirmModal('确认整批回滚？该批次共 '+count+' 条操作将按逆序撤销，且不可重复回滚。',
    function(){try{undoBatch(batchId);}catch(e){toast('回滚失败：'+e.message,'error');return;}closeModal();render();toast('已整批回滚 '+count+' 条','success');},
    '确认整批回滚','取消');
}
/** 渲染回收站 tab：按类型分组，可恢复/彻底删除/全部清空 */
function renderTrash(){
  const trash=DB.trash||[];
  if(!trash.length)return '<div class="empty-state">回收站为空</div>';
  const groups={};
  trash.forEach(function(t){(groups[t.type]=groups[t.type]||[]).push(t);});
  const TYPE_ORDER=['unit','spec','bom','price','order','order_item','settlement','invoice'];
  let html='<div class="trash-toolbar"><span class="muted">共 '+trash.length+' 条</span> <button class="btn sm" onclick="clearTrashConfirm()">全部清空</button></div>';
  TYPE_ORDER.forEach(function(type){
    if(!groups[type])return;
    html+='<h4 class="trash-group-title">'+(TRASH_TYPE_LABEL[type]||type)+'（'+groups[type].length+'）</h4>';
    html+='<div class="table-wrap"><table><thead><tr><th>原始ID</th><th>删除时间</th><th>删除者</th><th class="td-act">操作</th></tr></thead><tbody>';
    groups[type].forEach(function(t){
      const time=new Date(t.deletedAt).toLocaleString('zh-CN',{hour12:false});
      const op=t.operator==='ai'?'AI':'用户';
      html+='<tr><td>'+escHtml(String(t.originalId))+'</td><td>'+time+'</td><td>'+op+'</td>'+
        '<td class="td-act">'+
        '<button class="btn sm" onclick="restoreTrashItem(\''+escAttr(t.id)+'\')">恢复</button> '+
        '<button class="btn sm" onclick="purgeTrashItem(\''+escAttr(t.id)+'\')">彻底删除</button>'+
        '</td></tr>';
    });
    html+='</tbody></table></div>';
  });
  return html;
}
function restoreTrashItem(trashId){
  try{restoreFromTrash(trashId);toast('已恢复','success');render();}
  catch(e){toast('恢复失败：'+e.message,'error');}
}
function purgeTrashItem(trashId){
  confirmModal('彻底删除后不可恢复，确认?',function(){purgeTrash(trashId);toast('已彻底删除','info');render();},'确认彻底删除');
}
function clearTrashConfirm(){
  confirmModal('⚠ 清空回收站后所有被删记录不可恢复，确认?',function(){clearTrash();toast('回收站已清空','info');render();},'确认清空');
}
