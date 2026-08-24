// views/data.js — 数据管理
/** 渲染存储架构状态卡片（IndexedDB/本地文件/localStorage 三段展示） */
function renderStorageStatus(sizeStr){
  return '<div class="card">'+
    '<h2>'+icon('database','18')+'数据管理</h2>'+
    '<div class="grid4 data-count-cards">'+
      '<div class="data-count-card">'+
        '<div class="dcc-icon" style="background:#eff6ff;color:#2563eb">'+icon('users','18')+'</div>'+
        '<div><div style="font-size:12px;color:var(--gray);margin-bottom:4px">关联单位</div><div style="font-size:22px;font-weight:700">'+DB.units.length+' 条</div></div>'+
      '</div>'+
      '<div class="data-count-card">'+
        '<div class="dcc-icon" style="background:#f0fdf4;color:#16a34a">'+icon('tag','18')+'</div>'+
        '<div><div style="font-size:12px;color:var(--gray);margin-bottom:4px">价格记录</div><div style="font-size:22px;font-weight:700">'+DB.prices.length+' 条</div></div>'+
      '</div>'+
      '<div class="data-count-card">'+
        '<div class="dcc-icon" style="background:#fff7ed;color:#c2410c">'+icon('shoppingCart','18')+'</div>'+
        '<div><div style="font-size:12px;color:var(--gray);margin-bottom:4px">采购订单</div><div style="font-size:22px;font-weight:700">'+DB.orders.length+' 条</div></div>'+
      '</div>'+
      '<div class="data-count-card">'+
        '<div class="dcc-icon" style="background:#fdf4ff;color:#9333ea">'+icon('database','18')+'</div>'+
        '<div><div style="font-size:12px;color:var(--gray);margin-bottom:4px">数据大小</div><div style="font-size:22px;font-weight:700">'+sizeStr+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div style="border-top:1px solid var(--line);padding-top:20px;">'+
      '<div class="data-section-hd">'+icon('database','16')+' 存储架构</div>'+
        '<div class="grid2" style="margin-bottom:12px">'+
          '<div style="background:'+(idbStatus==='error'?'#fef2f2':idbStatus==='ok'?'#f0fdf4':'#f8fafc')+';border:1px solid '+(idbStatus==='error'?'#fecaca':idbStatus==='ok'?'#bbf7d0':'var(--line)')+';border-radius:8px;padding:14px">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
              '<div style="font-size:12px;font-weight:600">IndexedDB <span class="tag info" style="font-size:12px;margin-left:4px">数据库</span></div>'+
              '<span class="tag '+(idbStatus==='error'?'err':'ok')+'">'+(idbStatus==='error'?'异常':'正常')+'</span>'+
            '</div>'+
            '<div style="font-size:14px;color:var(--gray)">数据大小 · '+sizeStr+'</div>'+
            '<div style="font-size:12px;margin-top:4px;color:var(--gray)">容量数百 MB+，所有业务数据的主存储</div>'+
          '</div>'+
          '<div style="background:'+(fileSync===true?'#f0fdf4':fileSync==='pending'?'#fffbeb':'#f8fafc')+';border:1px solid '+(fileSync===true?'#bbf7d0':fileSync==='pending'?'#fde68a':'var(--line)')+';border-radius:8px;padding:14px">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
              '<div style="font-size:12px;font-weight:600">本地 JSON 文件 <span class="tag info" style="font-size:12px;margin-left:4px">备份</span></div>'+
              '<span class="tag '+(fileSync===true?'ok':fileSync==='pending'?'warn':'gray')+'">'+(fileSync===true?'已同步':fileSync==='pending'?'待授权':'未绑定')+'</span>'+
            '</div>'+
            '<div style="font-size:14px;color:var(--gray)">'+(fileHandle?escHtml(fileHandle.name):'未绑定文件')+'</div>'+
            '<div style="font-size:12px;margin-top:4px;color:var(--gray)">磁盘文件，清缓存不丢数据</div>'+
          '</div>'+
        '</div>'+
        '<div id="storageQuota" style="margin-bottom:12px;background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--gray)">'+
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
  let syncContent;
  if(fsaSupported()){
    if(fileSync===true){
      syncContent=
        '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:12px">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="tag ok">已同步</span><b>'+escHtml(fileHandle?fileHandle.name:'')+'</b></div>'+
          '<div style="font-size:12px;color:var(--gray)">'+(fileLastSave?'最后同步：'+escHtml(fileLastSave):'')+' · 每次修改自动写入文件，浏览器清缓存不丢数据</div>'+
        '</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap">'+
          '<button class="btn" onclick="syncNow()">'+icon('refresh')+'立即同步</button>'+
          '<button class="btn danger" onclick="unbindFile()">'+icon('x')+'解绑文件</button>'+
        '</div>';
    }else if(fileSync==='pending'){
      syncContent=
        '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-bottom:12px">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="tag warn">需重新授权</span><b>'+escHtml(fileHandle?fileHandle.name:'')+'</b></div>'+
          '<div style="font-size:12px;color:var(--gray)">刷新页面后浏览器需要重新授权才能读写文件，点击下方按钮授权</div>'+
        '</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap">'+
          '<button class="btn primary" onclick="reconnectFile()">'+icon('link')+'重新授权连接</button>'+
          '<button class="btn danger" onclick="unbindFile()" style="margin-left:8px">解绑</button>'+
        '</div>';
    }else{
      syncContent=
        '<div style="background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:14px;margin-bottom:12px">'+
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
      '<div class="card" style="border-color:#fca5a5">'+
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
  return renderStorageStatus(sizeStr)+renderBackupSection()+renderFileSyncSection()+renderDangerZone();
}

/** 导出全部数据为 JSON 备份文件并触发下载 */
function exportJSON(){
  let data=JSON.stringify(DB,null,2);
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
      DB={units:[],specs:JSON.parse(JSON.stringify(DEFAULT_SPECS)),bom:[],prices:[],orders:[],settlements:[],invoices:[],seq:100,orderSeq:1};
      saveDB().then(function(){render();});
      toast('全部数据已清空','info');
    },'确认清空所有数据','取消保留数据');
  },'我已导出备份，继续','取消并去导出');
}
