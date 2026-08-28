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

/** 渲染备份与恢复操作区（导出 JSON、导入 JSON、自动备份、备份文件列表） */
/** 备份与恢复设置区（对齐「备份提醒 / 自动快照 / 保留份数」分段式完整逻辑） */
function renderBackupSection(){
  const cfg=backupCfgGet();
  const isTauri=AI.state.runtime==='tauri';
  const lastTxt=cfg.lastBackupAt?_backupTimeLabel(cfg.lastBackupAt):'尚未备份';
  // 与 store.js BACKUP_INTERVAL_OPTIONS / BACKUP_KEEP_OPTIONS 保持一致的可选值
  const INTV=[1,3,7,14,30],KEEPS=[5,10,20,30,50];
  const selBase='padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);font-size:13px;font-family:inherit;';
  const rowBase='display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 12px;border-top:1px solid var(--line);';
  const swB=function(checked,onchange){
    return '<input type="checkbox"'+(checked?' checked':'')+' onchange="'+onchange+'" style="accent-color:var(--accent);width:16px;height:16px;flex:0 0 auto">';
  };
  const midB=function(t,d){
    return '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">'+t+'</div><div style="font-size:12px;color:var(--gray);margin-top:2px">'+d+'</div></div>';
  };
  const selDays=function(id,cur,onchange){
    return '<select id="'+id+'" onchange="'+onchange+'" style="'+selBase+'">'+
      INTV.map(function(d){return '<option value="'+d+'"'+(cur===d?' selected':'')+'>每'+d+'天</option>';}).join('')+'</select>';
  };
  const dirRow=isTauri?
    '<div style="'+rowBase+'">'+midB('数据所在目录','桌面版备份保存在应用数据目录下的 backups/ 子目录')+
      '<div style="flex:0 0 auto;min-width:0;max-width:58%;text-align:right">'+
        '<code id="backupDirSpan" style="font-size:12px;word-break:break-all;display:inline-block;vertical-align:middle">正在获取...</code>'+
        '<button class="btn" style="padding:2px 9px;margin-left:6px;vertical-align:middle" onclick="_copyDirPath()">'+icon('copy','13')+'复制</button>'+
      '</div></div>':
    '<div style="'+rowBase+'">'+midB('备份目录','网页版快照写入所选目录下的 backups/ 子目录')+
      '<button class="btn" style="flex:0 0 auto;padding:3px 10px" onclick="chooseBackupDir()">'+icon('folder','14')+'选择目录</button>'+
      '<div style="flex:0 0 auto;max-width:100%;text-align:right">'+
        '<div id="backupDirSpan" style="font-size:13px;font-weight:600;color:var(--ink);word-break:break-all">未设置</div>'+
        '<div style="font-size:11px;color:var(--gray);margin-top:2px">浏览器安全限制：不显示系统绝对路径，仅展示所选文件夹名</div>'+
      '</div></div>';
  // render 为同步流程，目录名/备份列表异步填充后再更新
  setTimeout(_renderBackupRuntime,0);
  return '<div style="border-top:1px solid var(--line);padding-top:20px;margin-bottom:20px">'+
      '<div class="card" style="overflow:hidden">'+
        '<div class="data-section-hd">'+icon('download','16')+' 备份与恢复</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap;padding:14px 14px 16px">'+
          '<button class="btn primary" onclick="exportJSON()">'+icon('download')+'导出 JSON 备份</button>'+
          '<button class="btn" onclick="document.getElementById(\'importFile\').click()">'+icon('upload')+'导入 JSON 恢复</button>'+
          '<input type="file" id="importFile" accept=".json" style="display:none" onchange="importJSON(event)">'+
        '</div>'+
        '<div style="background:var(--bg-tint)">'+
          '<div style="'+rowBase+'">'+midB('上次备份',lastTxt)+
            '<button class="btn" style="flex:0 0 auto" onclick="nowBackup()">'+icon('zap','14')+'立即备份</button>'+
          '</div>'+
          '<div style="'+rowBase+'">'+swB(cfg.remindEnabled,'_backupRemindToggled(this.checked)')+
            midB('备份提醒','超过设定时间未备份时提醒我，可一键立即备份')+selDays('backupRemindSel',cfg.remindIntervalDays,'_backupRemindIntervalChanged(this.value)')+
          '</div>'+
          '<div style="'+rowBase+'">'+swB(cfg.enabled,'_backupToggle(this.checked)')+
            midB('自动快照','开启后按设定间隔生成数据快照')+selDays('backupIntervalSel',cfg.intervalDays,'_backupIntervalChanged(this.value)')+
          '</div>'+
          '<div style="'+rowBase+'">'+midB('保留快照份数','超出后自动删除最旧快照，避免无限累积')+
            '<select onchange="_backupKeepChanged(this.value)" style="'+selBase+'">'+
              KEEPS.map(function(n){return '<option value="'+n+'"'+(cfg.keepCount===n?' selected':'')+'>'+n+'份</option>';}).join('')+'</select>'+
          '</div>'+
          dirRow+
        '</div>'+
        '<div style="padding:14px 14px 6px">'+
          '<div style="font-size:13px;font-weight:600;margin-bottom:8px">备份文件</div>'+
          '<div id="backupListBox" style="font-size:13px;color:var(--gray)">正在加载备份列表...</div>'+
        '</div>'+
        '<div class="note" style="margin:8px 14px 14px">导出的 JSON 文件包含全部数据（关联单位、属性、价格、订单）。恢复/导入时会覆盖当前数据，请谨慎操作。自动快照按设定间隔生成并保留指定份数，可从此处随时恢复或删除。</div>'+
      '</div>'+
    '</div>';
}
/** 备份区异步填充：备份目录显示名 + 备份文件列表 */
function _renderBackupRuntime(){
  const dirEl=document.getElementById('backupDirSpan');
  if(dirEl){
    if(AI.state.runtime==='tauri'){
      if(window.__TAURI__&&window.__TAURI__.core&&typeof window.__TAURI__.core.invoke==='function'){
        window.__TAURI__.core.invoke('data_dir_get').then(function(p){if(p)dirEl.textContent=p.replace(/\/+$/,'')+'/backups/';}).catch(function(){});
      }
    }else{
      backupDirName().then(function(n){if(n)dirEl.textContent=''+n;});
    }
  }
  refreshBackupList();
}
/** 自动快照开关 */
function _backupToggle(checked){
  setBackupEnabled(!!checked);
  toast(checked?'已开启自动快照':'已关闭自动快照','success');
  render();
}
/** 自动快照间隔变更 */
function _backupIntervalChanged(val){
  setBackupInterval(Number(val)||7);
  toast('自动快照间隔已设为每 '+val+' 天','success');
  render();
}
/** 保留份数变更 */
function _backupKeepChanged(val){
  setKeepCount(Number(val)||20);
  toast('快照保留份数已设为 '+val+' 份','info');
  render();
}
/** 备份提醒开关 */
function _backupRemindToggled(checked){
  setRemindEnabled(!!checked);
  toast(checked?'已开启备份提醒':'已关闭备份提醒','success');
  render();
}
/** 备份提醒间隔变更 */
function _backupRemindIntervalChanged(val){
  setRemindInterval(Number(val)||7);
  toast('备份提醒间隔已设为每 '+val+' 天','info');
  render();
}
/** 复制备份目录完整路径到剪贴板（桌面版可拿到绝对路径；网页版受浏览器限制仅有目录名） */
async function _copyDirPath(){
  const el=document.getElementById('backupDirSpan');
  if(!el||!el.textContent||el.textContent==='正在获取...'||el.textContent==='未设置'){
    toast('目录路径尚未就绪','error');return;
  }
  const path=String(el.textContent).trim();
  try{
    await navigator.clipboard.writeText(path);
    toast('已复制完整路径：'+path,'success');
  }catch(e){
    toast('复制失败：'+e.message+'（可手动选取复制）','error');
  }
}
/** 刷新备份文件列表（过滤并渲染可恢复/删除项） */
async function refreshBackupList(){
  const box=document.getElementById('backupListBox');
  if(!box)return;
  try{
    const list=await listBackups();
    if(!list.length){
      box.innerHTML='<div style="font-size:13px;color:var(--gray);padding:4px 0">暂无备份文件'+(AI.state.runtime==='tauri'?'':'，请先设置备份目录并点击「立即备份」或开启自动备份')+'</div>';
      return;
    }
    box.innerHTML=list.map(function(b){
      const fname=escAttr(b.name||'');
      return '<div style="display:flex;align-items:center;gap:10px;justify-content:space-between;padding:6px 8px;border:1px solid var(--line);border-radius:6px;margin-bottom:6px;flex-wrap:wrap;background:var(--bg-tint)">'+
        '<div style="min-width:0">'+
          '<div style="font-size:13px;word-break:break-all">'+escHtml(b.name||'')+'</div>'+
          '<div style="font-size:11px;color:var(--gray)">'+fmtBytes(b.size||0)+' · '+escHtml(_backupTimeLabel(b.modified||0))+'</div>'+
        '</div>'+
        '<div style="display:flex;gap:6px;flex-shrink:0">'+
          '<button class="btn" style="padding:3px 10px" data-restore="'+fname+'">'+icon('rotateCcw','14')+'恢复</button>'+
          '<button class="btn danger" style="padding:3px 10px" data-delete="'+fname+'">'+icon('trash','14')+'删除</button>'+
        '</div>'+
      '</div>';
    }).join('');
    box.querySelectorAll('[data-restore]').forEach(function(btn){
      btn.addEventListener('click',function(){restoreBackup(btn.getAttribute('data-restore'));});
    });
    box.querySelectorAll('[data-delete]').forEach(function(btn){
      btn.addEventListener('click',function(){deleteBackup(btn.getAttribute('data-delete'));});
    });
  }catch(e){box.innerHTML='<div style="font-size:13px;color:var(--err)">备份列表加载失败：'+escHtml(e.message||e)+'</div>';}
}
/** 字节数格式化 */
function fmtBytes(n){
  if(n<1024)return n+' B';
  if(n<1048576)return (n/1024).toFixed(1)+' KB';
  return (n/1048576).toFixed(2)+' MB';
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
  // 网页版：异步填充「数据所在目录」显示（render 为同步流程，setTimeout 后按 id 更新）
  setTimeout(_renderWebDataLocation,0);
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
        '<div id="dataLocationInfo" style="font-size:13px;margin-top:14px;padding-top:12px;border-top:1px dashed var(--line);line-height:1.9;color:var(--gray)">正在获取数据所在位置...</div>'+
      '</div>'+
    '</div>';
}
/** 网页版：填充「数据所在目录」显示（IndexedDB 主存储 + 同步目录 + 备份目录） */
function _renderWebDataLocation(){
  const el=document.getElementById('dataLocationInfo');
  if(!el)return;
  backupDirName().then(function(bd){
    let syncName='';
    if(fileSync===true){
      syncName=(syncDirHandle&&syncDirHandle.name)?syncDirHandle.name:(fileHandle&&fileHandle.name||'');
    }
    let html='<b style="color:var(--ink)">数据所在位置</b>';
    html+='<div>• 主存储：<b style="color:var(--ink)">浏览器 IndexedDB</b><span style="font-size:12px">（网页版数据默认保存在此，属浏览器内部存储，无磁盘路径）</span></div>';
    if(syncName)html+='<div>• 本地同步目录：<b style="color:var(--ink)">'+escHtml(syncName)+'</b><span style="font-size:12px">（数据文件 '+escHtml(BIND_FILE_NAME)+'）</span></div>';
    if(bd)html+='<div>• 自动备份目录：<b style="color:var(--ink)">'+escHtml(bd)+'</b><span style="font-size:12px">（所选文件夹名）</span></div>';
    html+='<div style="font-size:12px;margin-top:6px;color:var(--gray)">浏览器出于安全限制不提供完整磁盘路径；本地文件同步绑定的目录即网页版数据所在目录，可前往操作系统文件管理器中查看该文件夹。</div>';
    el.innerHTML=html;
  });
}

/** 渲染危险操作区（清空全部数据按钮及警告提示） */
/** 知识库（本地 RAG）：异步填充目录选择、索引状态与检索开关 */
function renderKbSection(){
  setTimeout(_kbRefreshBox,0);
  return '<div class="card" style="margin-top:20px">'+
    '<div class="data-section-hd">'+icon('fileText','16')+' 知识库 <span class="tag info" style="font-size:11px">本地 RAG</span>'+
      '<span class="note" style="float:right;font-size:12px">提问时离线检索本地文档 · 不联网</span></div>'+
    '<div id="kbSectionBox" style="font-size:13px;color:var(--gray)">正在加载…</div>'+
  '</div>';
}
async function _kbRefreshBox(){
  const box=document.getElementById('kbSectionBox');
  if(!box)return;
  let s=null;
  try{
    if(typeof KB!=='undefined'){await KB.init();s=KB.summarize();}
  }catch(e){/* 知识库模块未加载或初始化失败 */}
  if(!s){
    box.innerHTML='知识库模块未加载。';
    return;
  }
  if(!s.bound){
    box.innerHTML='<div style="line-height:1.9">'+
      '<span class="tag gray">未绑定</span> <span style="color:var(--gray)">选择本机目录作为 AI 知识库，将解析其中的 md / txt / PDF / docx（纯前端解析、不联网、本地检索）。</span>'+
      '<div style="margin-top:10px"><button type="button" class="btn primary sm" onclick="_kbChoose()">选择目录并索引</button></div>'+
    '</div>';
    return;
  }
  const sizeStr=s.chars<1024?s.chars+' B':(s.chars<1048576?(s.chars/1024).toFixed(1)+' KB':(s.chars/1048576).toFixed(1)+' MB');
  const timeTxt=s.indexedAt?_backupTimeLabel(s.indexedAt):'';
  const inner='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+
      '<span class="tag ok">已绑定</span>'+
      '<code style="font-size:12px;word-break:break-all">'+escHtml(s.dirName)+'</code>'+
      (s.indexing?'<span class="tag warn">索引中…</span>':'')+
      '<span style="color:var(--ink)">'+s.files+' 个文件 · '+s.blocks+' 个分块 · '+sizeStr+'</span>'+
      (timeTxt?'<span style="color:var(--gray)">最近索引 '+timeTxt+'</span>':'')+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">'+
      '<button type="button" class="btn sm" onclick="_kbRescan()" '+(s.indexing?'disabled':'')+'>'+icon('refresh','14')+' 重新索引</button>'+
      '<button type="button" class="btn sm" onclick="_kbUnbind()" '+(s.indexing?'disabled':'')+'>'+icon('link','14')+' 断开</button>'+
    '</div>'+
    '<div class="ai-kb-opts">'+
      '<label class="ai-opt"><input type="checkbox" id="kbSectEnabled" '+(s.enabled?'checked':'')+' onchange="_kbToggle(this.checked)"><span>提问时检索知识库</span></label>'+
      '<label class="ai-opt ai-opt-inline">注入 Top-N '+
        '<select id="kbSectTopN" onchange="_kbTopN(this.value)">'+
          [3,4,5].map(n=>'<option value="'+n+'"'+(s.topN===n?' selected':'')+'>'+n+' 片段</option>').join('')+
        '</select></label>'+
      '<label class="ai-opt"><input type="checkbox" id="kbSectCite" '+(s.cite?'checked':'')+' onchange="_kbCite(this.checked)"><span>回答标注来源</span></label>'+
    '</div>'+
    (s.error?'<div class="note" style="color:var(--red);margin-top:8px;margin-bottom:0">'+escHtml(s.error)+'</div>':'');
  box.innerHTML=inner;
}
async function _kbChoose(){
  if(typeof KB==='undefined'){toast('知识库模块未加载','error');return;}
  const r=await KB.chooseDir();
  if(r&&r.cancelled)return;
  if(r&&r.ok){
    _kbToastResult('知识库索引完成',r);
    if((r.scanned||0)===0&&(!r.errors||!r.errors.length)){toast('所选目录中没有找到 md / txt / PDF / docx 文件','warning');}
  }
  else{toast(r&&r.error?r.error:'选择目录失败','error');}
  _kbRefreshBox();
}
async function _kbRescan(){
  if(typeof KB==='undefined'){toast('知识库模块未加载','error');return;}
  const r=await KB.rescan();
  if(r&&r.ok){_kbToastResult('重新索引完成',r);}
  else{toast(r&&r.error?r.error:'重新索引失败','error');}
  _kbRefreshBox();
}
async function _kbUnbind(){
  if(typeof KB==='undefined'){toast('知识库模块未加载','error');return;}
  await KB.unbind();
  toast('已断开知识库目录','info');
  _kbRefreshBox();
}
/** 索引结果提示：扫描数/失败明细不再被静默吞掉 */
function _kbToastResult(prefix,r){
  const errs=(r&&Array.isArray(r.errors))?r.errors:[];
  let msg=prefix+(r?('：扫描 '+((typeof r.scanned==='number')?r.scanned:r.files)+' 个受支持文件，成功 '+(r.files)+' 个 · '+(r.blocks)+' 个分块'):'' );
  if(errs.length)msg+='；失败 '+errs.length+' 个（'+errs.slice(0,2).join(' / ')+(errs.length>2?' 等':'')+'）';
  toast(msg,errs.length?'warning':'success');
}
function _kbToggle(v){if(typeof KB==='undefined')return;KB.setEnabled(v);toast(v?'提问时将检索知识库':'已关闭知识库检索','info');}
function _kbTopN(v){if(typeof KB==='undefined')return;const n=KB.setTopN(v);toast('注入 Top-'+n+' 片段','info');}
function _kbCite(v){if(typeof KB==='undefined')return;KB.setCite(v);toast(v?'回答将标注来源':'已关闭来源标注','info');}

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
  else body=renderStorageStatus(sizeStr)+renderBackupSection()+renderFileSyncSection()+renderKbSection()+renderDangerZone();
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

/** 导入 JSON 备份文件并覆盖当前数据库（结构校验+完整性警告+二次确认，逻辑集中在 store.js importParsedData） */
function importJSON(event){
  let file=event.target.files[0];
  if(!file)return;
  let reader=new FileReader();
  reader.onload=function(e){
    (async function(){
      try{
        const data=JSON.parse(e.target.result);
        await importParsedData(data);
        toast('数据已导入：'+DB.orders.length+' 订单、'+DB.prices.length+' 价格、'+DB.units.length+' 单位','success');
      }catch(err){
        if(err&&err.code==='IMPORT_CANCELLED'){} // 用户取消导入
        else{toast('导入失败：'+(err&&err.message||err),'error');}
      }
    })();
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
const OP_LABEL={create:'新增',update:'修改',delete:'删除',restore:'恢复',flow:'流转',assign:'寻货',export:'导出'};
const TRASH_TYPE_LABEL={unit:'单位',spec:'属性',bom:'BOM',price:'报价',order:'订单',order_item:'订单明细',settlement:'结算',invoice:'发票',export:'导出'};
function _opTagCls(op){return op==='delete'?'err':(op==='create'?'green':(op==='restore'?'purple':(op==='export'?'info':'')));}
/** 阶段4：操作历史筛选器渲染 */
/** AI 操作统计报表（操作历史 tab 顶部，全量统计不受筛选影响） */
function renderOpsStats(){
  const ops=DB.aiOps||[];
  if(!ops.length)return '';
  const total=ops.length;
  const aiN=ops.filter(o=>o.operator==='ai').length;
  const userN=total-aiN;
  const undoneN=ops.filter(o=>o.undone).length;
  const autoPurgedN=ops.filter(o=>o.autoPurged).length;
  const batchN=new Set(ops.map(o=>o.batchId).filter(Boolean)).size;
  const aiPct=total?Math.round(aiN/total*100):0;
  const undonePct=aiN?Math.round(ops.filter(o=>o.operator==='ai'&&o.undone).length/aiN*100):0;
  // 按操作类型 × 操作者
  const opKeys=Object.keys(OP_LABEL);
  const byOp=opKeys.map(k=>{
    const all=ops.filter(o=>o.op===k).length;
    const ai=ops.filter(o=>o.op===k&&o.operator==='ai').length;
    return {k,label:OP_LABEL[k],all,ai,user:all-ai};
  }).filter(r=>r.all>0);
  // 按数据域
  const typeMap={};
  ops.forEach(o=>{typeMap[o.type]=(typeMap[o.type]||0)+1;});
  const byType=Object.keys(typeMap).map(t=>({label:TRASH_TYPE_LABEL[t]||t,n:typeMap[t]})).sort((a,b)=>b.n-a.n);
  // 近 7 天趋势
  const days=[];
  for(let i=6;i>=0;i--){
    const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);
    const start=d.getTime();
    const n=ops.filter(o=>o.timestamp>=start&&o.timestamp<start+86400000).length;
    days.push({label:(d.getMonth()+1)+'/'+d.getDate(),n});
  }
  const maxN=Math.max(1,...days.map(d=>d.n));
  // 指标卡
  const cards=[
    {label:'总操作',val:total},
    {label:'AI 操作',val:aiN+' <span class="ops-stats-sub">('+aiPct+'%)</span>'},
    {label:'用户操作',val:userN},
    {label:'已回滚',val:undoneN+' <span class="ops-stats-sub">AI 回滚率 '+undonePct+'%</span>'},
    {label:'操作批次',val:batchN},
    {label:'自动清理',val:autoPurgedN}
  ];
  const cardsHTML=cards.map(c=>'<div class="ops-stat-card"><div class="ops-stat-val">'+c.val+'</div><div class="ops-stat-label">'+c.label+'</div></div>').join('');
  // 类型分布
  const opRows=byOp.map(r=>'<tr><td>'+escHtml(r.label)+'</td><td>'+r.all+'</td><td>'+r.ai+'</td><td>'+r.user+'</td>'+
    '<td><div class="ops-bar"><div class="ops-bar-ai" style="width:'+(r.all?Math.round(r.ai/r.all*100):0)+'%"></div></div></td></tr>').join('');
  // 数据域分布（条形）
  const typeRows=byType.map(t=>'<tr><td>'+escHtml(t.label)+'</td><td>'+t.n+'</td>'+
    '<td><div class="ops-bar"><div class="ops-bar-type" style="width:'+Math.round(t.n/total*100)+'%"></div></div></td></tr>').join('');
  // 趋势
  const trendHTML=days.map(d=>{
    const h=Math.round(d.n/maxN*100);
    return '<div class="ops-trend-col"><div class="ops-trend-bar" style="height:'+Math.max(h,2)+'%"><span class="ops-trend-n">'+(d.n||'')+'</span></div><div class="ops-trend-label">'+d.label+'</div></div>';
  }).join('');
  return '<div class="ops-stats">'+
    '<div class="ops-stats-cards">'+cardsHTML+'</div>'+
    '<div class="ops-stats-grid">'+
      '<div class="ops-stats-block"><div class="ops-stats-title">操作类型分布</div>'+
        '<div class="table-wrap"><table><thead><tr><th>类型</th><th>合计</th><th>AI</th><th>用户</th><th style="width:34%">AI 占比</th></tr></thead><tbody>'+opRows+'</tbody></table></div></div>'+
      '<div class="ops-stats-block"><div class="ops-stats-title">数据域分布</div>'+
        '<div class="table-wrap"><table><thead><tr><th>数据域</th><th>次数</th><th style="width:34%">占比</th></tr></thead><tbody>'+typeRows+'</tbody></table></div></div>'+
    '</div>'+
    '<div class="ops-stats-block"><div class="ops-stats-title">近 7 天操作趋势</div>'+
      '<div class="ops-trend">'+trendHTML+'</div></div>'+
  '</div>';
}

function renderOpsFilter(){
  const f=window._aiOpsFilter||{op:'',operator:'',batchId:''};
  const opOpts=['',...Object.keys(OP_LABEL)].map(k=>'<option value="'+k+'"'+(f.op===k?' selected':'')+'>'+(k?OP_LABEL[k]:'全部操作')+'</option>').join('');
  const opOpts2=[{v:'',l:'全部操作者'},{v:'ai',l:'AI'},{v:'user',l:'用户'}].map(o=>'<option value="'+o.v+'"'+(f.operator===o.v?' selected':'')+'>'+o.l+'</option>').join('');
  // P3：按批次筛选 —— 列出有未回滚 op 的批次（前 8 位作为显示名）
  const batchIds=[...new Set((DB.aiOps||[]).filter(o=>o.batchId&&!o.undone).map(o=>o.batchId))].slice(0,20);
  const batchOpts=['<option value="">全部批次</option>'].concat(batchIds.map(bid=>'<option value="'+escAttr(bid)+'"'+(f.batchId===bid?' selected':'')+'>'+escHtml(bid.slice(0,8))+'</option>')).join('');
  return '<div class="ops-filter-bar">'+
    '<label class="ops-filter-item">操作类型<select onchange="_setAiOpsFilter(\'op\',this.value)">'+opOpts+'</select></label>'+
    '<label class="ops-filter-item">操作者<select onchange="_setAiOpsFilter(\'operator\',this.value)">'+opOpts2+'</select></label>'+
    '<label class="ops-filter-item">批次<select onchange="_setAiOpsFilter(\'batchId\',this.value)">'+batchOpts+'</select></label>'+
    '<button class="btn sm" onclick="_setAiOpsFilter(\'op\',\'\');_setAiOpsFilter(\'operator\',\'\');_setAiOpsFilter(\'batchId\',\'\');">重置</button>'+
    '<button class="btn sm" onclick="_aiOpsSelftest()">自检</button>'+
    '</div>';
}
function _setAiOpsFilter(key,val){
  if(!window._aiOpsFilter)window._aiOpsFilter={op:'',operator:'',batchId:''};
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
  // 3. 关键函数可用性（P2 修复：从 store.js 导出的 _AI_OPS_FNS 引用，避免硬编码）
  const fns=(typeof _AI_OPS_FNS!=='undefined')?_AI_OPS_FNS:['recordAiOp','undoAiOp','undoBatch','softDelete','restoreFromTrash','purgeTrash','clearTrash'];
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
    '关闭',function(){closeModal();},true);
  toast(summary,allOk?'success':'warning');
}
/** 渲染操作历史 tab：最近 100 条 AI/用户操作，可单条回滚 */
function renderOpsHistory(){
  const allOps=DB.aiOps||[];
  if(!allOps.length)return '<div class="empty-state">暂无操作历史</div>';
  // 阶段4：按筛选条件过滤
  const f=window._aiOpsFilter||{op:'',operator:'',batchId:''};
  let ops=allOps;
  if(f.op)ops=ops.filter(o=>o.op===f.op);
  if(f.operator)ops=ops.filter(o=>o.operator===f.operator);
  if(f.batchId)ops=ops.filter(o=>o.batchId===f.batchId);
  const filterBar=renderOpsFilter();
  const statsHTML=renderOpsStats();
  if(!ops.length)return statsHTML+filterBar+'<div class="empty-state">筛选后无匹配记录，<a onclick="_setAiOpsFilter(\'op\',\'\');_setAiOpsFilter(\'operator\',\'\');_setAiOpsFilter(\'batchId\',\'\');" style="cursor:pointer;color:var(--pri)">重置筛选</a></div>';
  // P2 修复：batchUndoneCount 基于全量 allOps 统计，避免筛选后计数偏小与 undoBatchConfirm 不一致
  const batchUndoneCount={};
  allOps.forEach(function(op){
    if(op.batchId&&!op.undone)batchUndoneCount[op.batchId]=(batchUndoneCount[op.batchId]||0)+1;
  });
  const rows=ops.slice(0,100).map(function(op){
    const time=new Date(op.timestamp).toLocaleString('zh-CN',{hour12:false});
    const label=OP_LABEL[op.op]||op.op;
    const typeLabel=TRASH_TYPE_LABEL[op.type]||op.type;
    const target=op.targetId?escHtml(String(op.targetId)):'—';
    const batchIdShort=op.batchId?escHtml(op.batchId.slice(0,8)):'—';
    const undoneTag=op.undone?'<span class="tag gray">已回滚</span>':(op.autoPurged?'<span class="tag gray">已自动清理</span>':'');
    const undoBtn=(op.undone||op.autoPurged||op.op==='export')?'':'<button class="btn sm" onclick="undoAiOp(\''+escAttr(op.id)+'\');render();toast(\'已回滚\',\'info\');">回滚</button>';
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
  return statsHTML+filterBar+summary+'<div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>类型</th><th>目标</th><th>操作者</th><th>批次</th><th class="td-act">操作</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
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
  // 自动清理：超保留期条目先清理（系统平台行为，AI 隔离原则不受影响）
  const purged=autoPurgeTrash();
  if(purged>0)toast('已自动清理 '+purged+' 条超过 '+TRASH_RETENTION_DAYS+' 天的回收站记录','info');
  const trash=DB.trash||[];
  if(!trash.length)return '<div class="empty-state">回收站为空</div>';
  const groups={};
  trash.forEach(function(t){(groups[t.type]=groups[t.type]||[]).push(t);});
  const TYPE_ORDER=['unit','spec','bom','price','order','order_item','settlement','invoice'];
  let html='<div class="trash-toolbar"><span class="muted">共 '+trash.length+' 条 · 保留 '+TRASH_RETENTION_DAYS+' 天，超期自动清理</span> <button class="btn sm" onclick="clearTrashConfirm()">全部清空</button></div>';
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
