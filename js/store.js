// store.js — 数据常量 + 文件同步 + IndexedDB + initApp + seedData 包装
/* =========================================================
   数据层
   ========================================================= */
/**
 * 应用全局版本号，发布时统一在此修改
 * 三处需同步更新：store.js / index.html 顶部注释 / AGENTS.md「当前基准版本」
 * @type {string}
 */
const APP_VERSION='v1.0.0';

/**
 * localStorage 草稿键名前缀，与 DRAFT_TYPES 拼接构成完整键名
 * 仅用于表单草稿缓存，不存储业务数据
 * @type {string}
 */
const DRAFT_PREFIX='wb_fastener_draft_';

/**
 * BOM/报价/订单规格属性字段名数组
 * 驱动 combo 组件初始化、草稿收集/恢复、筛选等功能
 * @type {string[]}
 */
const SPEC_FIELDS=['type','standard','diameter','hardness','surface','material'];
/**
 * SPEC_FIELDS 各字段的中文显示标签映射表
 * @type {Object.<string, string>}
 */
const SPEC_LABELS={type:'类型',standard:'标准',diameter:'直径',hardness:'硬度',surface:'表面处理',material:'材质'};

/**
 * 新安装时的默认规格可选项字典
 * 应用首次初始化时复制到 DB.specs，key 对应 SPEC_FIELDS
 * @type {Object.<string, string[]>}
 */
const DEFAULT_SPECS={
  type:['螺栓','螺母','垫圈','螺钉','自攻钉','木螺钉','膨胀螺栓','销钉','挡圈','螺柱'],
  standard:['GB/T','DIN','ISO','ANSI/ASME','JIS','非标','HG','JB'],
  diameter:['M3','M4','M5','M6','M8','M10','M12','M14','M16','M18','M20','M22','M24','M27','M30','M36','M42'],
  hardness:['4.8','5.8','6.8','8.8','10.9','12.9','A2-70','A2-80','A4-70','A4-80','35H','45H'],
  surface:['本色','镀锌(白)','镀锌(彩)','镀镍','达克罗','发黑','磷化','钝化','镀铜','喷漆'],
  material:['304','316','316L','321','201','Q235','Q345','35#','45#','SCM435','40Cr','B7'],
};

/**
 * 订单状态枚举数组
 * @type {string[]}
 */
const ORDER_STATUSES=['待确认','寻货中','报价中','未成交','签约完成','送货中','异常','完成','取消'];
/**
 * 订单状态对应的 CSS 颜色类名映射
 * 用于标签着色：gray/info/warn/ok/err 等
 * @type {Object.<string, string>}
 */
const STATUS_COLORS={'待确认':'gray','寻货中':'info','报价中':'warn','未成交':'gray','签约完成':'ok','送货中':'info','异常':'err','完成':'ok','取消':'gray'};
/**
 * 订单正向流转状态序列（不含终态「异常」「取消」）
 * 用于渲染状态进度条和状态流转判断
 * @type {string[]}
 */
const STATUS_FLOW=['待确认','寻货中','报价中','签约完成','送货中','完成'];

/**
 * 全局数据主存储对象（主力存储：IndexedDB）
 * @type {{units: Array, specs: Object, bom: Array, prices: Array, orders: Array, settlements: Array, invoices: Array, seq: number, orderSeq: number, _savedAt?: number}}
 */
let DB={units:[],specs:{},prices:[],orders:[],settlements:[],invoices:[],seq:100,orderSeq:1};

/* 补齐 DB 可能缺失的字段（供 idbLoad 和 loadFromFile 复用） */
/**
 * 补齐 DB 对象可能缺失的字段（bom/settlements/invoices/orderSeq 等）
 * 供 idbLoad 和 loadFromFile 复用，确保从旧版本数据恢复时结构完整
 */
function ensureDBFields(){
  if(!DB.specs||Object.keys(DB.specs).length===0)DB.specs=JSON.parse(JSON.stringify(DEFAULT_SPECS));
  if(!DB.bom)DB.bom=[];
  if(!DB.settlements)DB.settlements=[];
  if(!DB.invoices)DB.invoices=[];
  if(!DB.seq)DB.seq=100;
  if(!DB._savedAt)DB._savedAt=Date.now();
  if(!DB.orderSeq){
    const maxSeq=DB.orders.reduce((max,o)=>{
      const m=o.id.match(/PO\d{8}-(\d+)/);
      return m?Math.max(max,parseInt(m[1],10)):max;
    },1);
    DB.orderSeq=maxSeq+1;
  }
  // v1.2.0→v1.3.0：旧「待签约」状态迁移为「报价中」
  DB.orders.forEach(o=>{if(o.status==='待签约')o.status='报价中';});
}

/* ---- 本地文件同步（File System Access API） ---- */
let fileHandle=null;       // 文件句柄
let fileSync=false;        // true=已绑定且有权, 'pending'=已绑定但需重新授权, false=未绑定
let fileLastSave='';       // 最后写入时间

/**
 * 检测浏览器是否支持 File System Access API（showSaveFilePicker）。
 * @returns {boolean} 支持返回 true，否则 false
 */
function fsaSupported(){return 'showSaveFilePicker' in window;}

/* IndexedDB 持久化文件句柄 */
const FH_DB='wb_fastener_fh',FH_STORE='handles',FH_KEY='main';
/**
 * 打开文件句柄持久化用的 IndexedDB，首次访问时自动建库建表。
 * @returns {Promise<IDBDatabase>} 文件句柄库连接实例
 * @throws {Error} 打开失败时 reject
 */
function fhOpen(){return new Promise((res,rej)=>{const r=indexedDB.open(FH_DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(FH_STORE);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
/**
 * 将文件句柄持久化到 IndexedDB，以便刷新页面后恢复。
 * @param {FileSystemFileHandle} h - 待持久化的文件句柄
 * @returns {Promise<void>} 完成（无返回值）
 */
async function fhSave(h){try{const db=await fhOpen();return new Promise((res,rej)=>{const tx=db.transaction(FH_STORE,'readwrite');tx.objectStore(FH_STORE).put(h,FH_KEY);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}catch(e){console.warn('fhSave failed',e);toast('文件同步失败，数据已保存在本地','');}}
/**
 * 从 IndexedDB 读取持久化的文件句柄。
 * @returns {Promise<FileSystemFileHandle|null>} 句柄或 null
 */
async function fhLoad(){const db=await fhOpen();return new Promise((res,rej)=>{const tx=db.transaction(FH_STORE,'readonly');const r=tx.objectStore(FH_STORE).get(FH_KEY);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error);});}
/**
 * 从 IndexedDB 删除持久化的文件句柄（解绑时调用）。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function fhDelete(){const db=await fhOpen();return new Promise((res,rej)=>{const tx=db.transaction(FH_STORE,'readwrite');tx.objectStore(FH_STORE).delete(FH_KEY);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}

/* 权限检查 */
/**
 * 检查并请求文件句柄的读写权限。
 * @param {FileSystemFileHandle} handle - 文件句柄
 * @param {boolean} rw - true 请求读写权限，false 仅读权限
 * @returns {Promise<boolean>} 已授权返回 true，否则 false
 */
async function fhPerm(handle,rw){
  const opts={mode:rw?'readwrite':'read'};
  if((await handle.queryPermission(opts))==='granted')return true;
  if((await handle.requestPermission(opts))==='granted')return true;
  return false;
}

/* 绑定本地文件 */
/**
 * 弹出系统保存对话框绑定本地 JSON 文件，绑定后数据将双向同步。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function bindFile(){
  if(!fsaSupported()){toast('当前浏览器不支持文件绑定，请使用 Chrome 或 Edge 浏览器','error');return;}
  try{
    const handle=await window.showSaveFilePicker({
      suggestedName:'紧固件贸易工作台_数据.json',
      types:[{description:'JSON 文件',accept:{'application/json':['.json']}}]
    });
    if(!(await fhPerm(handle,true))){toast('未获得文件写入权限','error');return;}
    fileHandle=handle;fileSync=true;
    await fhSave(handle);
    await saveToFile();
    toast('已绑定本地文件：'+handle.name+'，数据将自动同步','success');
    render();
  }catch(e){if(e.name!=='AbortError')toast('绑定失败：'+e.message,'error');}
}

/* 解绑 */
/**
 * 解绑本地文件同步，弹出确认框后清除句柄和 IndexedDB 记录。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function unbindFile(){
  confirmModal('解绑后数据将仅保存在浏览器 localStorage。确认解绑本地文件？',async()=>{
    fileHandle=null;fileSync=false;fileLastSave='';
    await fhDelete();
    closeModal();render();
    toast('已解绑本地文件','info');
  },'确认解绑');
}

/* 重新授权（刷新后权限失效时点击） */
/**
 * 刷新页面后重新获取文件句柄权限并加载最新数据。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function reconnectFile(){
  if(!fileHandle)return;
  try{
    if(await fhPerm(fileHandle,true)){
      fileSync=true;
      await loadFromFile();
      render();
      toast('已重新连接本地文件','success');
    }else{toast('授权失败','error');}
  }catch(e){toast('连接失败：'+e.message,'error');}
}

/* 写入文件（异步，saveDB 调用） */
/**
 * 将 DB 对象写入绑定的本地文件，失败时将 fileSync 置为 pending。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function saveToFile(){
  if(!fileHandle||fileSync!==true)return;
  try{
    const w=await fileHandle.createWritable();
    await w.write(JSON.stringify(DB,null,2));
    await w.close();
    fileLastSave=now();
  }catch(e){
    console.error('文件写入失败:',e);
    toast('文件写入失败：'+e.message+'，请检查本地文件是否被其他程序占用','error');
    fileSync='pending';
    render();
  }
}

/* 从文件读取（对比时间戳，避免旧文件覆盖新数据） */
/**
 * 从本地文件读取数据，基于时间戳对比决定加载方向（文件→DB 或 DB→文件）。
 * @returns {Promise<boolean>} 文件数据被加载返回 true，否则（含 DB 更新反向同步）返回 false
 */
async function loadFromFile(){
  if(!fileHandle)return false;
  try{
    if(!(await fhPerm(fileHandle,false)))return false;
    const file=await fileHandle.getFile();
    const text=await file.text();
    const data=JSON.parse(text);
    if(data&&data.units&&data.prices&&data.orders){
      // 对比时间戳：仅当文件比当前数据更新时才加载
      const curTs=DB._savedAt||0;
      const fileTs=data._savedAt||0;
      if(fileTs>curTs||curTs===0){
        DB=data;
        ensureDBFields();
        const migrated=migrateItems();
        if(migrated){DB._savedAt=Date.now();await idbSave();await saveToFile();}
        return true;
      }else{
        // 当前数据更新，反向同步到文件
        await saveToFile();
        return false;
      }
    }
  }catch(e){console.error('文件读取失败:',e);}
  return false;
}

/* 页面加载时恢复文件句柄 */
/**
 * 页面加载时恢复文件句柄，自动尝试重连并加载数据。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function initFileHandle(){
  if(!fsaSupported())return;
  try{
    const handle=await fhLoad();
    if(!handle)return;
    fileHandle=handle;
    const perm=await handle.queryPermission({mode:'readwrite'});
    if(perm==='granted'){
      fileSync=true;
      const loaded=await loadFromFile();
      if(loaded){render();toast('已从本地文件恢复数据','success');}
    }else{
      fileSync='pending';  // 需要用户点击重新授权
      render();
    }
  }catch(e){console.error('恢复文件句柄失败:',e);}
}

/**
 * 手动触发立即同步到本地文件。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function syncNow(){
  if(!fileHandle||fileSync!==true)return;
  await saveToFile();
  render();
  toast('已手动同步到本地文件','success');
}


/* ---- IndexedDB 主存储（突破 localStorage 5MB 限制） ---- */
const IDB_NAME='wb_fastener_idb',IDB_STORE='data',IDB_KEY='main';
let idbStatus='idle';  // idle | ok | error

/**
 * 打开主数据 IndexedDB，首次访问时自动建库建表。
 * @returns {Promise<IDBDatabase>} 连接成功的 IndexedDB 实例
 * @throws {Error} 当数据库被其他连接阻塞（blocked）时 reject
 */
function idbOpen(){return new Promise((res,rej)=>{
  const r=indexedDB.open(IDB_NAME,1);
  r.onupgradeneeded=()=>r.result.createObjectStore(IDB_STORE);
  r.onsuccess=()=>res(r.result);
  r.onerror=()=>rej(r.error);r.onblocked=()=>rej(new Error('DB blocked'));
});}

/**
 * 将 DB 对象异步写入 IndexedDB 主存储。
 * @returns {Promise<void>} 写入完成（无返回值）
 * @throws {Error} 写入事务失败时 reject 并置 idbStatus='error'
 */
async function idbSave(){
  try{
    const db=await idbOpen();
    return new Promise((res,rej)=>{
      const tx=db.transaction(IDB_STORE,'readwrite');
      tx.objectStore(IDB_STORE).put(DB,IDB_KEY);
      tx.oncomplete=()=>{idbStatus='ok';res();};
      tx.onerror=()=>{idbStatus='error';rej(tx.error);};
    });
  }catch(e){console.error('IDB save error:',e);idbStatus='error';}
}

/**
 * 从 IndexedDB 主存储读取 DB 对象。
 * @returns {Promise<Object|null>} 读取到的 DB 对象，失败时返回 null
 * @throws {Error} 读取事务失败时 reject 并置 idbStatus='error'
 */
async function idbLoad(){
  try{
    const db=await idbOpen();
    return new Promise((res,rej)=>{
      const tx=db.transaction(IDB_STORE,'readonly');
      const r=tx.objectStore(IDB_STORE).get(IDB_KEY);
      r.onsuccess=()=>{idbStatus='ok';res(r.result||null);};
      r.onerror=()=>{idbStatus='error';rej(r.error);};
    });
  }catch(e){console.error('IDB load error:',e);idbStatus='error';return null;}
}

/* 存储用量估算 */
/**
 * 查询浏览器存储配额与用量。
 * @returns {Promise<{usage:number,quota:number}|null>} 配额信息，不支持时返回 null
 */
async function storageEstimate(){
  if(navigator.storage&&navigator.storage.estimate){
    const est=await navigator.storage.estimate();
    return {usage:est.usage||0,quota:est.quota||0};
  }
  return null;
}

/* 更新数据管理页的配额显示 */
let _dbSizeCache={ts:0,bytes:0};
/** 渲染数据管理页的存储用量进度条，支持百分比颜色分级（绿/黄/红） */
async function updateStorageQuota(){
  const el=document.getElementById('storageQuota');
  if(!el)return;
  const est=await storageEstimate();
  if(est&&est.quota>0){
    const pct=(est.usage/est.quota*100).toFixed(1);
    const usedStr=est.usage<1048576?(est.usage/1024).toFixed(1)+' KB':(est.usage/1048576).toFixed(2)+' MB';
    const quotaStr=est.quota<1073741824?(est.quota/1048576).toFixed(0)+' MB':(est.quota/1073741824).toFixed(1)+' GB';
    const barPct=Math.min(parseFloat(pct),100);
    const barColor=parseFloat(pct)>80?'#ef4444':parseFloat(pct)>50?'#f59e0b':'#22c55e';
    el.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
      '<span>浏览器存储用量</span>'+
      '<span><b>'+usedStr+'</b> / '+quotaStr+' ('+pct+'%)</span>'+
    '</div>'+
    '<div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">'+
      '<div style="height:100%;width:'+barPct+'%;background:'+barColor+';border-radius:3px;transition:width .3s"></div>'+
    '</div>';
  }else{
    let _ts=DB._savedAt||0;
    if(_dbSizeCache.ts!==_ts){_dbSizeCache.ts=_ts;_dbSizeCache.bytes=JSON.stringify(DB).length;}
    el.innerHTML=icon('database','12')+' 当前数据大小：'+_dbSizeCache.bytes+' B · IndexedDB 存储不受 5MB 限制';
  }
}

/* 异步初始化：IndexedDB 加载 + 文件同步恢复 */
/**
 * 应用启动初始化：从 IndexedDB 加载数据（主力存储）→ 补齐字段 → 格式迁移 → 恢复文件同步。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function initApp(){
  // 1. 从 IndexedDB 加载（唯一主存储）
  try{
    const idbData=await idbLoad();
    if(idbData&&idbData.units&&idbData.prices&&idbData.orders&&idbData.specs){
      DB=idbData;
      // 补齐可能缺失的字段
      if(!DB.specs)DB.specs=JSON.parse(JSON.stringify(DEFAULT_SPECS));
        if(!DB.bom)DB.bom=[];
      if(!DB.settlements)DB.settlements=[];
      if(!DB.invoices)DB.invoices=[];
      if(!DB.seq)DB.seq=100;
      if(!DB._savedAt)DB._savedAt=Date.now();
      // 补齐 orderSeq（旧数据或未初始化的情况）
      if(!DB.orderSeq){
        const maxSeq=DB.orders.reduce((max,o)=>{
          const m=o.id.match(/PO\d{8}-(\d+)/);
          return m?Math.max(max,parseInt(m[1],10)):max;
        },1);
        DB.orderSeq=maxSeq+1;
      }
      const migrated=migrateItems();
      if(migrated){DB._savedAt=Date.now();await idbSave();}
      // 2. 恢复文件同步（必须在渲染前完成，确保 fileSync 状态正确）
      await initFileHandle();
      // 数据加载完成，调用 onAppReady 恢复 hash 路由
      if(typeof onAppReady==='function')onAppReady();else render();
    }else if(idbData&&(idbData.units||idbData.prices||idbData.orders)){
      // 部分数据（不完整），清空后让用户自行录入
      toast('数据不完整，已清空，请重新录入数据','warning');
      DB={units:[],specs:JSON.parse(JSON.stringify(DEFAULT_SPECS)),bom:[],prices:[],orders:[],settlements:[],invoices:[],seq:100,orderSeq:1};
      await idbSave();
      // 2. 恢复文件同步（必须在渲染前完成）
      await initFileHandle();
      if(typeof onAppReady==='function')onAppReady();else render();
    }else{
      // IndexedDB 无数据，首次使用，从空状态开始
      DB={units:[],specs:JSON.parse(JSON.stringify(DEFAULT_SPECS)),bom:[],prices:[],orders:[],settlements:[],seq:100,orderSeq:1};
      await idbSave();
      // 2. 恢复文件同步（必须在渲染前完成）
      await initFileHandle();
      if(typeof onAppReady==='function')onAppReady();else render();
    }
  }catch(e){
    // IndexedDB 完全不可用（隐私模式/存储满/权限不足），降级到内存模式
    console.error('IndexedDB 初始化失败，使用内存模式：',e);
    // toast 可能未定义，使用 alert 作为降级
    if(typeof toast==='function'){toast('浏览器存储不可用，当前数据仅保存在内存中（刷新页面将丢失），请使用「导出」功能备份','error');}
    else{alert('浏览器存储不可用，当前数据仅保存在内存中（刷新页面将丢失），请使用「导出」功能备份');}
    DB={units:[],specs:JSON.parse(JSON.stringify(DEFAULT_SPECS)),bom:[],prices:[],orders:[],settlements:[],invoices:[],seq:100,orderSeq:1};
    // 恢复文件同步（必须在渲染前完成）
    await initFileHandle();
    render();
  }
}

/**
 * 旧数据格式迁移：订单行项扁平字段→options数组、结算/invoice/BOM 字段补齐。
 * @returns {boolean} 是否发生了迁移
 */
function migrateItems(){
  let migrated=false;
  // 旧 orders.items 格式迁移（将扁平 supplier 字段提升为 options 数组）
  DB.orders.forEach(o=>{
    (o.items||[]).forEach(it=>{
      if(it.options)return;
      it.options=[];
      if(it.supplierId){
        it.options.push({id:'Q'+(DB.seq=(DB.seq||100)+1),supplierId:it.supplierId,contact:it.supplierContact||'',price:it.purchasePrice||0,allocQty:it.qty,stockNote:it.stockNote||'',source:it.supplierSource||'priceLibrary',status:'已选'});
      }
      delete it.supplierId;delete it.supplierContact;delete it.purchasePrice;
      delete it.supplierSource;delete it.stockNote;
      migrated=true;
    });
  });
  // settlements 格式迁移：确保每条记录有 orders 数组
  (DB.settlements||[]).forEach(s=>{
    if(!Array.isArray(s.orders)){s.orders=[];migrated=true;}
  });
  // invoices 格式迁移：确保每条记录有 timestamp 字段
  (DB.invoices||[]).forEach(inv=>{
    if(!inv.timestamp){inv.timestamp=inv.createdAt||(inv.date?new Date(inv.date).getTime():0);migrated=true;}
    if(!inv.createdAt){inv.createdAt=inv.date||new Date().toISOString().slice(0,10);migrated=true;}
  });
  // BOM 主键迁移：补齐 bom.id
  (DB.bom||[]).forEach(b=>{
    if(!b.id){b.id=uid('B');migrated=true;}
  });
  return migrated;
}
/**
 * 保存数据到 IndexedDB + 本地文件（双写），同时失效单位/BOM缓存。
 * @returns {Promise<void>} 完成（无返回值）
 */
function saveDB(){
  _unitNameCache=null; _bomCache=null; // 数据变更，失效缓存
  DB._savedAt=Date.now();
  // IndexedDB 主力存储（异步）
  const p=idbSave();
  p.finally(()=>_checkIdbErrorToast());
  // 本地文件（如果已绑定）
  if(fileSync===true)saveToFile();
  return p;
}
let _saveTimer=0;
/**
 * 防抖版 saveDB，在频繁变更场景下合并写入，默认延迟 300ms。
 * @param {number} [ms=300] - 防抖延迟毫秒数
 * @returns {void} 无返回值
 */
function saveDBDebounced(ms){
  if(_saveTimer)clearTimeout(_saveTimer);
  _saveTimer=setTimeout(function(){_saveTimer=0;saveDB();},ms||300);
}
let _idbErrorShown=false;
/** 检查 IndexedDB 写入状态，首次错误时弹出存储故障提示（全局仅弹一次） */
function _checkIdbErrorToast(){
  if(idbStatus==='error'&&!_idbErrorShown){
    _idbErrorShown=true;
    toast('存储故障：数据保存失败，请检查浏览器存储空间或导出备份以免数据丢失','error');
  }
}
/** 安全写 IndexedDB 并检查错误状态 */
async function _safeIdbSave(){
  await idbSave();
  _checkIdbErrorToast();
}



/* seedData 包装 — 调用 seed.js 的 _seedData */
/**
 * 调用 seed.js 的 _seedData 填充演示数据
 * @description 初始化预置示例数据（8家单位、9条报价、5条订单）
 */
function seedData(){
  _seedData(DEFAULT_SPECS, saveDB);
}
