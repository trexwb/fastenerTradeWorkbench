// store.js — 数据常量 + 文件同步 + IndexedDB + initApp + seedData 包装
/* =========================================================
   数据层
   ========================================================= */
/**
 * 应用全局版本号，由 Vite 构建时从 package.json 注入
 * 单一来源：package.json 版本号
 * @type {string}
 */
const APP_VERSION = (typeof __APP_VERSION__ !== 'undefined') ? __APP_VERSION__ : 'v1.0.12';

/**
 * localStorage 草稿键名前缀，与 DRAFT_TYPES 拼接构成完整键名
 * 仅用于表单草稿缓存，不存储业务数据
 * @type {string}
 */
const DRAFT_PREFIX='wb_fastener_draft_';
/** 是否处于 Tauri 桌面运行时（store.js 在 ai.js 之前加载，独立检测，不依赖 AI 对象） */
const IS_TAURI_RUNTIME=!!(window.__TAURI__&&window.__TAURI__.core&&typeof window.__TAURI__.core.invoke==='function');

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
let DB={units:[],specs:{},prices:[],orders:[],settlements:[],invoices:[],aiChats:[],seq:100,orderSeq:1,trash:[],aiOps:[]};

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
  if(!Array.isArray(DB.aiChats))DB.aiChats=[];
  // AI 会话中断残留：上次会话流式回复未完成时退出应用会留下 pending 标记，加载时清除避免永久光标闪烁
  if(DB.aiChats.length)DB.aiChats.forEach(m=>{if(m&&m.pending)m.pending=false;});
  if(!Array.isArray(DB.trash))DB.trash=[];          // 回收站（软删除隔离区，AI 永不触碰）
  if(!Array.isArray(DB.aiOps))DB.aiOps=[];          // AI/用户操作日志（审计+回滚依据）
  if(!DB.seq)DB.seq=100;
  if(!DB._savedAt)DB._savedAt=Date.now();
  if(!DB.orderSeq){
    const maxSeq=DB.orders.reduce((max,o)=>{
      const m=o.id.match(/PO\d{8}-(\d+)/);
      const n=m?parseInt(m[1],10):0;
      return Number.isFinite(n)?Math.max(max,n):max; // 防御脏数据：编号段非纯数字时忽略，避免 orderSeq 变 NaN
    },1);
    DB.orderSeq=maxSeq+1;
  }
  // v1.2.0→v1.3.0：旧「待签约」状态迁移为「报价中」
  DB.orders.forEach(o=>{if(o.status==='待签约')o.status='报价中';});
}

/* ---- 本地文件同步（File System Access API） ---- */
let fileHandle=null;       // 文件句柄
let syncDirHandle=null;    // 同步目录句柄（网页版用于展示「数据所在目录」，仅用于显示/备份定位）
let fileSync=false;        // true=已绑定且有权, 'pending'=已绑定但需重新授权, false=未绑定
let fileLastSave='';       // 最后写入时间
let bindingInProgress=false; // true=正在执行绑定流程，禁止一切文件写入（防止竞态覆盖）
/**
 * 绑定目录时在目录中查找/创建的固定数据文件名
 * @type {string}
 */
const BIND_FILE_NAME='紧固件贸易工作台_数据.json';

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
/* 通用句柄持久化（同一 FH_DB 库，按 key 区分：同步目录 / 备份目录） */
const KEY_SYNC_DIR='syncDir';const KEY_BACKUP_DIR='backupDir';
/**
 * 将任意 FileSystemHandle 按 key 持久化到 IndexedDB（目录句柄需单独保存以便刷新后展示目录名）。
 * @param {string} key - 句柄键名
 * @param {FileSystemHandle|null} h - 待持久化的句柄，传 null 表示删除
 * @returns {Promise<void>} 完成（无返回值）
 */
async function fhStoreKey(key,h){
  const db=await fhOpen();
  return new Promise((res,rej)=>{
    const tx=db.transaction(FH_STORE,'readwrite');
    const os=tx.objectStore(FH_STORE);
    if(h===null)os.delete(key);else os.put(h,key);
    tx.oncomplete=()=>res();
    tx.onerror=()=>rej(tx.error);
  });
}
/**
 * 按 key 读取持久化的句柄。
 * @param {string} key - 句柄键名
 * @returns {Promise<FileSystemHandle|null>} 句柄或 null
 */
async function fhLoadKey(key){const db=await fhOpen();return new Promise((res,rej)=>{const tx=db.transaction(FH_STORE,'readonly');const r=tx.objectStore(FH_STORE).get(key);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error);});}

/* 权限检查 */
/**
 * 检查并请求文件/目录句柄的读写权限。
 * 容错：file:// 协议下 FileSystemHandle 的权限 API 可能不可用或 reject，
 * 以及 FileSystemDirectoryHandle 与 FileSystemFileHandle 的权限层级分离，
 * 一律先对目录句柄求权限（目录授权后目录内文件自动继承），失败则降级视为未授权。
 * @param {FileSystemHandle} handle - 文件句柄或目录句柄
 * @param {boolean} rw - true 请求读写权限，false 仅读权限
 * @returns {Promise<boolean>} 已授权返回 true，否则 false
 */
async function fhPerm(handle,rw){
  if(!handle||typeof handle.queryPermission!=='function')return false;
  const opts={mode:rw?'readwrite':'read'};
  try{
    if((await handle.queryPermission(opts))==='granted')return true;
  }catch(e){} // file:// 下部分浏览器版本 queryPermission 会 reject，直接走 requestPermission
  try{
    if((await handle.requestPermission(opts))==='granted')return true;
  }catch(e){} // requestPermission 同样可能在 file:// 下 reject
  return false;
}

/* 绑定本地目录 */
/**
 * 绑定本地目录做双向同步：用 showDirectoryPicker 选目录（不弹系统「替换」提示——目录选择器无替换语义），
 * 在目录中查找/创建固定文件名「紧固件贸易工作台_数据.json」——存在则用其数据做导入/合并，
 * 不存在则创建空文件。绑定前用项目统一 modal 预提示安全文件夹限制，取消/失败时用项目统一 modal 给重试选项。
 * @returns {Promise<void>} 完成（无返回值）
 */
function bindFile(){
  if(!fsaSupported()){toast('当前浏览器不支持文件绑定，请使用 Chrome 或 Edge 浏览器','error');return;}
  if(!('showDirectoryPicker' in window)){toast('当前浏览器不支持目录选择，请使用 Chrome 或 Edge 浏览器','error');return;}
  // 预提示：用项目统一 modal 解释浏览器对系统文件夹的安全限制 + 明确授权操作，避免用户看到系统弹窗时困惑
  const body=document.createElement('div');
  body.style.fontSize='14px';body.style.lineHeight='1.8';
  body.innerHTML=
    '<p>将选择一个本地文件夹用于存放数据文件「'+escHtml(BIND_FILE_NAME)+'」。</p>'+
    '<p style="color:var(--green)">✓ 过程中浏览器会弹出两次授权提示，<b>都请点「允许」</b>：</p>'+
    '<ol style="margin:.3rem 0 0 1.4rem;padding:0;color:var(--gray)">'+
    '<li>「允许此网站修改文件？」→ 点<b>「允许」</b></li>'+
    '<li>（授权通过后出现目录选择器）选择要绑定的文件夹 → 点「打开」</li>'+
    '</ol>'+
    '<p style="color:var(--warn);margin-top:.8rem">⚠ 浏览器安全限制：如果选择「下载」「桌面」「文档」等系统文件夹，会弹出「无法打开此文件夹，因为其中含有系统文件」。这是浏览器的安全保护，<b>不影响功能</b>，请点「另选一个文件夹」继续，或选择专门新建的空文件夹。</p>'+
    '<p>系统将在所选文件夹中：</p>'+
    '<ul style="margin:.5rem 0 0 1.2rem;padding:0;list-style:disc;color:var(--gray)">'+
    '<li>存在 '+escHtml(BIND_FILE_NAME)+' → 读取并与 IndexedDB 合并 / 导入</li>'+
    '<li>不存在 → 自动创建并写入当前数据</li>'+
    '</ul>';
  modal('绑定本地数据文件夹',body,'开始选择',()=>{
    closeModal();
    _doBindDirectory();
  });
}
/**
 * 实际执行目录绑定：调 showDirectoryPicker → 查找/创建固定数据文件 → 合并/导入/新建。
 * 取消选择或失败时，用项目统一 modal 给「重试 / 放弃」选项（分别走确定 / 取消按钮）。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function _doBindDirectory(){
  if(!('showDirectoryPicker' in window)){toast('当前浏览器不支持目录选择，请使用 Chrome 或 Edge 浏览器','error');return;}
  let dirHandle;
  try{
    // 绑定目录：showDirectoryPicker 不会弹系统「替换」确认框（目录选择器无替换语义），
    // 彻底避免 showSaveFilePicker 选已存在文件时浏览器/OS 截断原文件、弹原生替换提示的问题。
    dirHandle=await window.showDirectoryPicker({mode:'readwrite'});
  }catch(e){
    if(e.name==='AbortError'){
      // 用户取消选择或因「系统文件夹安全限制」被拒：用项目统一 modal 给「重试 / 放弃」选项，
      // 不弹任何系统对话框。确定按钮=再试一次，取消按钮=放弃绑定
      const body=document.createElement('div');
      body.style.fontSize='14px';body.style.lineHeight='1.8';
      body.innerHTML=
        '<p>刚才您取消了选择，或选择了「下载/桌面/文档」等系统文件夹触发了浏览器安全限制。</p>'+
        '<p style="color:var(--gray);font-size:13px">建议：专门新建一个空文件夹（如「'+escHtml('~/Documents/紧固件数据/')+'」）来存放数据文件。</p>';
      const onRetry=()=>{closeModal();_doBindDirectory();};
      const onGiveUp=()=>{closeModal();toast('已取消绑定','info');};
      modal('未绑定成功',body,'再试一次',onRetry);
      // modal 默认取消按钮是 closeModal()，覆写它为「放弃绑定」
      const mask=document.getElementById('_mask');
      if(mask){
        const cancelBtn=mask.querySelector('.mf .btn:not(.primary)');
        if(cancelBtn){cancelBtn.textContent='放弃绑定';cancelBtn.onclick=onGiveUp;}
      }
    }else{
      toast('选择目录失败：'+e.message,'error');
    }
    return;
  }
  try{
    // 先对目录句柄求读写权限：目录授权后，目录内的文件句柄自动继承读写权限，
    // 避免对 FileSystemFileHandle 再调 requestPermission 触发「第二次权限弹窗」
    // （file:// 下两次权限弹窗会让浏览器判定权限不透明，卡住整个选择流程）
    if(!(await fhPerm(dirHandle,true))){toast('未获得目录读写权限，请点「允许」授予目录修改权限后重试','error');return;}
    // 在所选目录中查找/创建固定数据文件：
    //   getFileHandle(name,{create:true}) 文件存在则返回已存在文件句柄（不截断、不覆盖原内容），
    //   不存在则创建空文件。无论哪种情况，后续 getFile 都能读到正确内容做合并/导入。
    let handle;
    try{
      handle=await dirHandle.getFileHandle(BIND_FILE_NAME,{create:true});
    }catch(e){
      toast('在所选目录中创建/打开数据文件失败：'+e.message,'error');
      return;
    }
    if(!handle){toast('未能获得数据文件句柄','error');return;}
    // 绑定流程保护：读取/合并/导入完成前禁止任何文件写入（saveToFile 会检查 bindingInProgress），
    // 杜绝「绑定过程中其他事件（定时器/输入回调等）触发保存、用当前库覆盖目标文件」的竞态清空问题
    bindingInProgress=true;
    fileHandle=handle;
    // 读取目标文件内容，区分三种情况：合法对象 / 非空但解析失败 / 空文件（刚创建的或原本就空）
    let fileData=null, fileHasAny=false;
    try{
      const f=await handle.getFile();
      const txt=await f.text();
      if(txt){
        const d=JSON.parse(txt);
        if(d&&typeof d==='object'&&!Array.isArray(d)){fileData=d;fileHasAny=true;}
        else{fileHasAny=true;} // 非 JSON 对象（如纯数组/字符串），视为「有内容但不可用」
      }
    }catch(e){fileHasAny=true;} // 解析失败说明文件非空/非预期结构，绝不覆盖
    // 文件有内容但无法解析为合法对象：绝不能开启同步，否则当前库会反向覆盖文件，回滚并取消绑定
    if(fileHasAny&&!fileData){
      fileHandle=null;
      bindingInProgress=false;
      toast('目标文件解析失败，已取消绑定，请检查「'+BIND_FILE_NAME+'」的格式','error');
      return;
    }
    // 判断本地 IndexedDB 是否为空（以业务数据为准，不看 _savedAt，避免空库被补时间戳后误判为「有数据」）
    const dbEmpty=!(DB.units&&DB.units.length)&&!(DB.prices&&DB.prices.length)&&!(DB.orders&&DB.orders.length)&&!(DB.settlements&&DB.settlements.length)&&!(DB.invoices&&DB.invoices.length);
    let merged=false;
    if(fileData){
      if(dbEmpty){
        // 情况1：IndexedDB 空 + 文件有数据 → 文件数据作为默认数据导入系统
        DB=fileData;
        ensureDBFields();
      }else{
        // 情况2：IndexedDB 有数据 + 文件有数据 → 合并 IndexedDB + 文件数据
        // IndexedDB 现有数据优先（保护用户当前正在操作的数据），文件中独有的条目追加
        mergeFileData(fileData);
        merged=true;
      }
      migrateItems();
      DB._savedAt=Date.now();
      await idbSave();
    }
    // 情况3：文件为空（刚创建/原本就空） → 保持当前 DB 不变，待 saveToFile 把当前库写入文件
    // 正式开启同步并持久化句柄（文件句柄 + 目录句柄：目录句柄用于展示「数据所在目录」）
    fileSync=true;
    syncDirHandle=dirHandle;
    await fhSave(handle);
    await fhStoreKey(KEY_SYNC_DIR,dirHandle);
    bindingInProgress=false;
    // 将合并/导入/当前的 DB 写回文件，确保文件与 IndexedDB 一致；
    // 由于合并模式下写入的是 IndexedDB ∪ 文件数据的并集，绝不发生「清空目标文件」
    await saveToFile();
    const tip=merged?'（已合并文件中的独有数据，IndexedDB 现有数据已保留）':(fileData?'（已从文件导入数据）':'（已新建数据文件）');
    toast('已绑定目录：'+dirHandle.name+'，数据文件：'+handle.name+'，将自动同步'+tip,'success');
    render();
  }catch(e){
    bindingInProgress=false;
    if(e.name!=='AbortError')toast('绑定失败：'+e.message,'error');
  }
}

/* 解绑 */
/**
 * 解绑本地文件同步，弹出确认框后清除句柄和 IndexedDB 记录。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function unbindFile(){
  confirmModal('解绑后数据将仅保存在浏览器 localStorage。确认解绑本地文件？',async()=>{
    fileHandle=null;fileSync=false;fileLastSave='';
    syncDirHandle=null;
    await fhDelete();
    await fhStoreKey(KEY_SYNC_DIR,null);
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

/* 合并文件数据到当前 DB（IndexedDB 优先，文件独有条目追加） */
/**
 * 绑定本地文件时，IndexedDB 已有数据 → 合并 IndexedDB + 文件数据。
 * 合并规则：
 *  - units/prices/orders/settlements/invoices/bom：按 id 去重，相同 id 以 IndexedDB 现有为准（保护用户当前操作），
 *    文件中独有的 id 追加到末尾；
 *  - specs 字典：IndexedDB 顺序优先，文件中独有的可选项追加（保持顺序、去重）；
 *  - seq/orderSeq：取最大值（避免编号回退）；
 *  - aiChats：保留 IndexedDB 现有（避免重复聊天记录）；
 *  - _savedAt：由调用方在合并完成后统一设置。
 * @param {Object} fileData - 从文件读取的 DB 对象
 * @returns {void}
 */
function mergeFileData(fileData){
  if(!fileData||typeof fileData!=='object')return;
  // 按 id 去重合并的辅助函数：IndexedDB 现有数据优先，文件中独有的条目追加
  const mergeById=(curArr,fileArr)=>{
    if(!Array.isArray(curArr)||!Array.isArray(fileArr))return;
    const seen=new Set(curArr.map(x=>x&&x.id).filter(Boolean));
    fileArr.forEach(x=>{if(x&&x.id&&!seen.has(x.id)){curArr.push(x);seen.add(x.id);}});
  };
  mergeById(DB.units,fileData.units||[]);
  mergeById(DB.prices,fileData.prices||[]);
  mergeById(DB.orders,fileData.orders||[]);
  mergeById(DB.settlements,fileData.settlements||[]);
  mergeById(DB.invoices,fileData.invoices||[]);
  mergeById(DB.bom,fileData.bom||[]);
  // specs 字典：IndexedDB 顺序优先，文件中独有项追加（去重）
  if(fileData.specs&&typeof fileData.specs==='object'){
    Object.keys(fileData.specs).forEach(k=>{
      const fileVals=Array.isArray(fileData.specs[k])?fileData.specs[k]:[];
      if(!DB.specs[k])DB.specs[k]=[];
      const seen=new Set(DB.specs[k]);
      fileVals.forEach(v=>{if(!seen.has(v)){DB.specs[k].push(v);seen.add(v);}});
    });
  }
  // seq / orderSeq 取最大值（避免编号回退）
  DB.seq=Math.max(DB.seq||100,fileData.seq||100);
  DB.orderSeq=Math.max(DB.orderSeq||1,fileData.orderSeq||1);
}

/* 写入文件（异步，saveDB 调用） */
/**
 * 将 DB 对象写入绑定的本地文件，失败时将 fileSync 置为 pending。
 * @returns {Promise<void>} 完成（无返回值）
 */
async function saveToFile(){
  if(!fileHandle||fileSync!==true||bindingInProgress)return;
  try{
    const w=await fileHandle.createWritable();
    // 导出/文件同步不含回收站与操作历史（用户明确约束）
    const exportData={...DB};delete exportData.trash;delete exportData.aiOps;
    await w.write(JSON.stringify(exportData,null,2));
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
    // 导入数据不含回收站/操作历史（用户约束）：强制丢弃文件中可能存在的 trash/aiOps，本机保留空态由 ensureDBFields 补齐
    if(data&&typeof data==='object'){delete data.trash;delete data.aiOps;}
    // 只要文件是合法 JSON 对象即进入处理（不再硬性要求 units/prices/orders 三字段齐全，
    // 避免结构不完整的数据文件被误判为"无数据"而触发反向覆盖清空）
    if(data&&typeof data==='object'&&!Array.isArray(data)){
      // 对比时间戳：仅当文件比当前数据更新时才加载
      const curTs=DB._savedAt||0;
      const fileTs=data._savedAt||0;
      // 本地库是否为空（无任何业务数据）：空库判断必须以业务数据为准，不能只看 _savedAt
      // （空库对象可能已被补上当前时间戳，仅凭时间戳会把「空库」误判为「本地更新」，反向清空文件）
      const dbEmpty=!(DB.units&&DB.units.length)&&!(DB.prices&&DB.prices.length)&&!(DB.orders&&DB.orders.length)&&!(DB.settlements&&DB.settlements.length)&&!(DB.invoices&&DB.invoices.length);
      const fileHasData=(data.units&&data.units.length)||(data.prices&&data.prices.length)||(data.orders&&data.orders.length)||(data.settlements&&data.settlements.length)||(data.invoices&&data.invoices.length);
      if(dbEmpty&&fileHasData){
        // 本地 IndexedDB 为空、文件有数据：将文件数据作为初始数据写入 IndexedDB，绝不反向清空文件
        DB=data;
        ensureDBFields();
        const migrated=migrateItems();
        DB._savedAt=Date.now();
        await idbSave();
        // 仅发生迁移时才回写文件（保持迁移后的结构一致）；未迁移则文件原样保留
        if(migrated){await saveToFile();}
        return true;
      }
      if(fileTs>curTs||curTs===0){
        DB=data;
        ensureDBFields();
        const migrated=migrateItems();
        // 发生迁移，或本地 IndexedDB 为空（首次导入文件数据作为初始数据）时，均需持久化
        if(migrated||curTs===0){DB._savedAt=Date.now();await idbSave();await saveToFile();}
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
    // 恢复同步目录句柄（用于展示「数据所在目录」；旧版本未持久化时为空，仅影响展示）
    syncDirHandle=await fhLoadKey(KEY_SYNC_DIR);
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
  // 超时兜底：部分环境（如 WKWebView 自定义协议）indexedDB.open 可能永不回调，
  // 不设超时会导致 initApp 永远卡在加载态。超时后走内存降级，保证界面可用。
  const timer=setTimeout(()=>{try{r.close&&r.close();}catch(_){};rej(new Error('IndexedDB 打开超时'));},5000);
  const r=indexedDB.open(IDB_NAME,1);
  r.onupgradeneeded=()=>r.result.createObjectStore(IDB_STORE);
  r.onsuccess=()=>{clearTimeout(timer);res(r.result);};
  r.onerror=()=>{clearTimeout(timer);rej(r.error);};
  r.onblocked=()=>{clearTimeout(timer);rej(new Error('DB blocked'));};
});}

/**
 * 将 DB 对象异步写入 IndexedDB 主存储。
 * @returns {Promise<void>} 写入完成（无返回值）
 * @throws {Error} 写入事务失败时 reject 并置 idbStatus='error'
 */
async function idbSave(){
  if(IS_TAURI_RUNTIME){
    // 桌面版主存储：写入应用数据目录 data.json（WKWebView 自定义协议下 IndexedDB 不可靠）
    try{
      await window.__TAURI__.core.invoke('data_file_save',{content:JSON.stringify(DB)});
      idbStatus='ok';return;
    }catch(e){console.error('Tauri data save error:',e);idbStatus='error';return;}
  }
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
  if(IS_TAURI_RUNTIME){
    // 桌面版主存储：从应用数据目录 data.json 读取
    try{
      const txt=await window.__TAURI__.core.invoke('data_file_load');
      if(!txt)return null;
      const d=JSON.parse(txt);
      idbStatus='ok';
      return d&&typeof d==='object'&&!Array.isArray(d)?d:null;
    }catch(e){console.error('Tauri data load error:',e);idbStatus='error';return null;}
  }
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
    const barColor=parseFloat(pct)>80?'var(--red)':parseFloat(pct)>50?'var(--amber)':'var(--green)';
    el.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
      '<span>浏览器存储用量</span>'+
      '<span><b>'+usedStr+'</b> / '+quotaStr+' ('+pct+'%)</span>'+
    '</div>'+
    '<div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden">'+
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
      // 补齐可能缺失的字段（与 idbLoad/loadFromFile 复用同一逻辑）
      ensureDBFields();
      const migrated=migrateItems();
      if(migrated){DB._savedAt=Date.now();await idbSave();}
      // 2. 恢复文件同步（必须在渲染前完成，确保 fileSync 状态正确）
      await initFileHandle();
      // 数据加载完成，调用 onAppReady 恢复 hash 路由
      autoPurgeTrash();  // 回收站自动清理（超保留期条目，启动时触发）
      if(typeof onAppReady==='function')onAppReady();else render();
    }else if(idbData&&(idbData.units||idbData.prices||idbData.orders)){
      // 部分数据（不完整），清空后让用户自行录入
      toast('数据不完整，已清空，请重新录入数据','warning');
      DB={units:[],specs:JSON.parse(JSON.stringify(DEFAULT_SPECS)),bom:[],prices:[],orders:[],settlements:[],invoices:[],aiChats:[],seq:100,orderSeq:1};
      await idbSave();
      // 2. 恢复文件同步（必须在渲染前完成）
      await initFileHandle();
      if(typeof onAppReady==='function')onAppReady();else render();
    }else{
      // IndexedDB 无数据，首次使用，从空状态开始
      DB={units:[],specs:JSON.parse(JSON.stringify(DEFAULT_SPECS)),bom:[],prices:[],orders:[],settlements:[],invoices:[],aiChats:[],seq:100,orderSeq:1};
      await idbSave();
      // 2. 恢复文件同步（必须在渲染前完成）
      await initFileHandle();
      if(typeof onAppReady==='function')onAppReady();else render();
    }
  }catch(e){
    // IndexedDB 完全不可用（隐私模式/存储满/权限不足），降级到内存模式
    console.error('IndexedDB 初始化失败，使用内存模式：',e);
    // 使用项目统一的 UI 提示（utils.js 中定义的 toast，按 defer 顺序必然已加载）
    if(typeof toast==='function'){toast('浏览器存储不可用，当前数据仅保存在内存中（刷新页面将丢失），请使用「导出」功能备份','error');}
    else{console.error('浏览器存储不可用，当前数据仅保存在内存中（刷新页面将丢失），请使用「导出」功能备份');}
    DB={units:[],specs:JSON.parse(JSON.stringify(DEFAULT_SPECS)),bom:[],prices:[],orders:[],settlements:[],invoices:[],aiChats:[],seq:100,orderSeq:1};
    // 恢复文件同步（必须在渲染前完成）
    await initFileHandle();
    render();
  }
  autoPurgeTrash();
  initAutoBackup();
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

/* ===== 软删除 / 回收站 / 操作日志（阶段1 数据底座，供手动删除与阶段2 AI 写入复用）===== */
const AI_OPS_LIMIT=2000;  // 操作日志保留上限（FIFO 滚动）
const TRASH_RETENTION_DAYS=90;             // 回收站保留期（天），超期自动清理
const TRASH_CLEANUP_KEY='wb_fastener_trash_cleanup';  // 上次自动清理时间戳（localStorage）
/** 业务表名映射（spec/order_item 走特殊路径，不在此映射） */
const _SOFT_DEL_TABLE={unit:'units',bom:'bom',price:'prices',order:'orders',settlement:'settlements',invoice:'invoices'};
/** 深拷贝快照（沿用项目既有 JSON 克隆模式） */
function _snap(obj){return obj==null?null:JSON.parse(JSON.stringify(obj));}

/** 记录一条操作日志（unshift 在前；超限 FIFO 截断尾部最旧） */
function recordAiOp(opts){
  opts=opts||{};
  const op={id:uid('AO'),batchId:opts.batchId||uid('AOB'),op:opts.op,type:opts.type,
    targetId:opts.targetId||null,before:_snap(opts.before),after:_snap(opts.after),
    operator:opts.operator||'user',timestamp:Date.now(),aiChatId:opts.aiChatId||null,
    undone:false,undoneAt:null};
  DB.aiOps.unshift(op);
  if(DB.aiOps.length>AI_OPS_LIMIT)DB.aiOps.length=AI_OPS_LIMIT;
  return op;
}

/** 通用软删除（数组类业务表：unit/bom/price/order/settlement/invoice） */
function softDelete(type,id,opts){
  opts=opts||{};
  const arrName=_SOFT_DEL_TABLE[type];
  if(!arrName)throw new Error('不支持的软删除类型：'+type);
  const arr=DB[arrName];
  const idx=arr.findIndex(r=>r&&r.id===id);
  if(idx<0)throw new Error('记录不存在或已删除：'+type+'/'+id);
  const snapshot=_snap(arr[idx]);
  arr.splice(idx,1);
  const trashEntry={id:uid('TR'),type:type,originalId:id,data:snapshot,deletedAt:Date.now(),
    operator:opts.operator||'user',reason:opts.reason||'',aiBatchId:opts.batchId||null};
  DB.trash.unshift(trashEntry);
  const op=recordAiOp({op:'delete',type:type,targetId:id,before:snapshot,after:null,
    batchId:opts.batchId,operator:opts.operator||'user',aiChatId:opts.aiChatId});
  saveDB();
  return {trashEntry,op};
}

/** 软删除规格枚举值（DB.specs 是字典，按 field 删 value） */
function softDeleteSpecOption(field,value,opts){
  opts=opts||{};
  if(!DB.specs[field]||!Array.isArray(DB.specs[field]))throw new Error('规格字段不存在：'+field);
  const idx=DB.specs[field].indexOf(value);
  if(idx<0)throw new Error('规格值不存在：'+field+'/'+value);
  DB.specs[field].splice(idx,1);
  const snapshot={field:field,value:value};
  const trashEntry={id:uid('TR'),type:'spec',originalId:field+':'+value,data:snapshot,deletedAt:Date.now(),
    operator:opts.operator||'user',reason:opts.reason||'',aiBatchId:opts.batchId||null};
  DB.trash.unshift(trashEntry);
  recordAiOp({op:'delete',type:'spec',targetId:field+':'+value,before:snapshot,after:null,
    batchId:opts.batchId,operator:opts.operator||'user',aiChatId:opts.aiChatId});
  saveDB();
  return {trashEntry};
}

/** 软删除订单明细行（order_item，订单内 items[i]） */
function softDeleteOrderItem(orderId,itemId,opts){
  opts=opts||{};
  const order=DB.orders.find(o=>o.id===orderId);
  if(!order||!Array.isArray(order.items))throw new Error('订单或明细不存在：'+orderId);
  const idx=order.items.findIndex(it=>it.id===itemId);
  if(idx<0)throw new Error('明细不存在：'+itemId);
  const snapshot=_snap(order.items[idx]);
  order.items.splice(idx,1);
  const trashEntry={id:uid('TR'),type:'order_item',originalId:itemId,
    data:Object.assign(_snap(snapshot),{orderId}),deletedAt:Date.now(),
    operator:opts.operator||'user',reason:opts.reason||'',aiBatchId:opts.batchId||null};
  DB.trash.unshift(trashEntry);
  recordAiOp({op:'delete',type:'order_item',targetId:itemId,before:snapshot,after:null,
    batchId:opts.batchId,operator:opts.operator||'user',aiChatId:opts.aiChatId});
  saveDB();
  return {trashEntry};
}

/** 从回收站恢复一条记录到业务表（同时记一条 restore 的 aiOps） */
function restoreFromTrash(trashId){
  const idx=DB.trash.findIndex(t=>t.id===trashId);
  if(idx<0)throw new Error('回收站条目不存在：'+trashId);
  const entry=DB.trash[idx];
  if(entry.type==='spec'){
    const d=entry.data;
    if(!DB.specs[d.field])DB.specs[d.field]=[];
    if(!DB.specs[d.field].includes(d.value))DB.specs[d.field].push(d.value);
  }else if(entry.type==='order_item'){
    const order=DB.orders.find(o=>o.id===entry.data.orderId);
    if(order&&Array.isArray(order.items)){
      const itemData=_snap(entry.data);delete itemData.orderId;
      if(!order.items.some(it=>it.id===entry.originalId))order.items.push(itemData);
    }
  }else{
    const arrName=_SOFT_DEL_TABLE[entry.type];
    if(arrName&&entry.data){
      if(!DB[arrName].some(r=>r.id===entry.originalId))DB[arrName].push(_snap(entry.data));
    }
  }
  DB.trash.splice(idx,1);
  recordAiOp({op:'restore',type:entry.type,targetId:entry.originalId,before:null,after:_snap(entry.data),
    operator:'user'});
  saveDB();
  return entry;
}

/** 物理删除回收站单条（不可恢复，仅用户手动） */
function purgeTrash(trashId){
  const idx=DB.trash.findIndex(t=>t.id===trashId);
  if(idx<0)return false;
  DB.trash.splice(idx,1);
  saveDB();
  return true;
}

/** 清空回收站（物理删除全部，不可恢复，仅用户手动） */
function clearTrash(){
  DB.trash=[];
  saveDB();
}

/** 回收站自动清理：删除超过保留期（TRASH_RETENTION_DAYS）的条目
 *  - 幂等：每天最多执行一次（force 可绕过，供手动/自检调用）
 *  - 清理时把关联的未回滚 delete 类 aiOps 标记 autoPurged（不可再回滚，避免 restoreFromTrash 落空）
 *  - 系统自动行为，与 AI 完全隔离原则不冲突（AI 不操作回收站，清理是平台机制）
 *  @param {boolean} [force=false] 强制清理（忽略每日频率限制）
 *  @returns {number} 本次清理条数
 */
function autoPurgeTrash(force){
  const nowTs=Date.now();
  try{
    const last=Number(localStorage.getItem(TRASH_CLEANUP_KEY)||0);
    if(!force&&nowTs-last<24*3600*1000)return 0;  // 一天最多清理一次
    const cutoff=nowTs-TRASH_RETENTION_DAYS*24*3600*1000;
    const expired=(DB.trash||[]).filter(t=>t&&t.deletedAt<cutoff);
    if(!expired.length){
      try{localStorage.setItem(TRASH_CLEANUP_KEY,String(nowTs));}catch(_){}
      return 0;
    }
    // 关联 aiOps：标记 autoPurged，UI 不再提供回滚
    expired.forEach(t=>{
      (DB.aiOps||[]).forEach(op=>{
        if(!op.undone&&!op.autoPurged&&op.op==='delete'&&op.type===t.type&&op.targetId===t.originalId){
          op.autoPurged=true;op.undoneAt=nowTs;
        }
      });
    });
    DB.trash=DB.trash.filter(t=>t&&t.deletedAt>=cutoff);
    saveDB();
    try{localStorage.setItem(TRASH_CLEANUP_KEY,String(nowTs));}catch(_){}
    return expired.length;
  }catch(e){
    console.error('回收站自动清理失败:',e);
    return 0;
  }
}

/** 单条回滚操作（按 op 反向执行；标 undone 单向不可再回滚） */
function undoAiOp(aiOpId){
  const op=DB.aiOps.find(o=>o.id===aiOpId);
  if(!op)throw new Error('操作记录不存在：'+aiOpId);
  if(op.undone)throw new Error('该操作已回滚，不可重复回滚');
  if(op.autoPurged)throw new Error('该记录已被自动清理，不可回滚');
  switch(op.op){
    case 'create':
      try{softDelete(op.type,op.targetId,{operator:'user',reason:'回滚创建'});}
      catch(e){throw new Error('回滚失败：记录可能已被删除 - '+e.message);}
      break;
    case 'update':{
      const arrName=_SOFT_DEL_TABLE[op.type];
      if(arrName&&op.before){
        const arr=DB[arrName];
        const i=arr.findIndex(r=>r.id===op.targetId);
        if(i>=0)arr[i]=_snap(op.before);
        else arr.push(_snap(op.before));
      }
      break;
    }
    case 'delete':{
      const tIdx=DB.trash.findIndex(t=>t.type===op.type&&t.originalId===op.targetId);
      if(tIdx<0)throw new Error('回滚失败：回收站已无该条目（可能已清空）');
      restoreFromTrash(DB.trash[tIdx].id);
      break;
    }
    case 'restore':
      try{softDelete(op.type,op.targetId,{operator:'user',reason:'回滚恢复'});}
      catch(e){throw new Error('回滚失败 - '+e.message);}
      break;
    case 'flow':
      if(op.before){const order=DB.orders.find(o=>o.id===op.targetId);if(order)order.status=op.before.status;}
      break;
    case 'assign':
      if(op.before&&op.before.orderId){
        const order=DB.orders.find(o=>o.id===op.before.orderId);
        if(order&&Array.isArray(order.items)){
          const item=order.items.find(it=>it.id===op.targetId);
          if(item)item.options=_snap(op.before.options||[]);
        }
      }
      break;
    case 'export':
      throw new Error('导出操作不可回滚');
  }
  op.undone=true;op.undoneAt=Date.now();
  saveDB();
}

/** 整批回滚（同 batchId 的未回滚操作，逆序撤销以保证依赖正确）
 *  返回已撤销条数（供 UI 提示） */
function undoBatch(batchId){
  const ops=DB.aiOps.filter(o=>o.batchId===batchId&&!o.undone);
  let undone=0;
  for(let i=ops.length-1;i>=0;i--){
    try{undoAiOp(ops[i].id);undone++;}catch(e){console.warn('批次回滚部分失败：',ops[i].id,e.message);}
  }
  return undone;
}

/**
 * 阶段4：AI 操控相关关键函数名清单（供 data.js 自检引用，避免硬编码）
 * 新增/重命名函数时只需更新此处，自检逻辑自动同步
 */
const _AI_OPS_FNS=['recordAiOp','undoAiOp','undoBatch','softDelete','softDeleteSpecOption','restoreFromTrash','purgeTrash','clearTrash'];



/* seedData 包装 — 调用 seed.js 的 _seedData */
/**
 * 调用 seed.js 的 _seedData 填充演示数据
 * @description 初始化预置示例数据（8家单位、9条报价、5条订单）
 */
function seedData(){
  _seedData(DEFAULT_SPECS, saveDB);
}

/* =========================================================
   自动备份 + 数据所在目录（数据管理「备份与恢复」增强）
   桌面版（Tauri）：备份目录固定为应用数据目录（用户约束：打包桌面应用即把数据同步目录作为备份目录），
                   备份=Rust 命令复制 data.json → backup_<本地时间戳>.json
   网页版：备份目录为 showDirectoryPicker 选择的目录（句柄持久化），
           备份=写「紧固件贸易工作台_备份_<本地时间戳>.json」到该目录
   存储：配置放 localStorage；备份/同步目录句柄复用 FH_DB 库（key=backupDir / syncDir）
   ========================================================= */
const BACKUP_CFG_KEY='wb_fastener_backup_cfg';
const BACKUP_FILE_PREFIX='紧固件贸易工作台_备份_';   // 网页版备份文件名前缀
const DST_BACKUP_PREFIX='backup_';                  // 桌面版备份文件名前缀（与 lib.rs BACKUP_PREFIX 一致）
const DAY_MS=86400000;                              // 1 天毫秒数
const BACKUP_INTERVAL_OPTIONS=[1,3,7,14,30];        // 快照/提醒间隔可选天数
const BACKUP_KEEP_OPTIONS=[5,10,20,30,50];          // 快照保留份数可选值
const BACKUPS_SUBDIR='backups';                     // 快照存放子目录（对齐「数据目录 backups/」）

let _backupDirHandle=null;   // 网页版备份目录句柄（内存缓存，指向用户所选目录；快照实际写入其 backups/ 子目录）
let _autoBackupTimer=null;   // 自动备份检查定时器
let _backupRetryAt=0;        // 自动备份失败冷却时间戳（10分钟内不重试，避免静默高频重试）

/** 读取自动备份配置（含旧版本迁移：period 字符串 → intervalDays 天数） */
function backupCfgGet(){
  try{
    const c=JSON.parse(localStorage.getItem(BACKUP_CFG_KEY)||'{}');
    // 旧版字段迁移（daily/weekly/monthly → 天）
    if('period' in c&&!(c.intervalDays>0)){
      const map={daily:1,weekly:7,monthly:30};
      c.intervalDays=map[c.period]||7;
      c.enabled=c.period!=='off'&&c.enabled;
      delete c.period;
    }
    return {
      enabled:!!c.enabled,
      intervalDays:c.intervalDays>0?c.intervalDays:7,
      keepCount:c.keepCount>0?c.keepCount:20,
      remindEnabled:!!c.remindEnabled,
      remindIntervalDays:c.remindIntervalDays>0?c.remindIntervalDays:7,
      lastBackupAt:c.lastBackupAt||0,
      lastRemindAt:c.lastRemindAt||0
    };
  }catch(e){return {enabled:false,intervalDays:7,keepCount:20,remindEnabled:false,remindIntervalDays:7,lastBackupAt:0,lastRemindAt:0};}
}
/** 保存自动备份配置 */
function backupCfgSet(cfg){try{localStorage.setItem(BACKUP_CFG_KEY,JSON.stringify(cfg));}catch(e){}}
/** 自动快照开关 */
function setBackupEnabled(on){const c=backupCfgGet();c.enabled=!!on;backupCfgSet(c);}
/** 自动快照间隔（天数） */
function setBackupInterval(days){const c=backupCfgGet();c.intervalDays=Math.max(1,Math.floor(Number(days)||7));backupCfgSet(c);}
/** 快照保留份数（超出自动删除最旧） */
function setKeepCount(n){const c=backupCfgGet();c.keepCount=Math.max(1,Math.floor(Number(n)||20));backupCfgSet(c);}
/** 备份提醒开关 */
function setRemindEnabled(on){const c=backupCfgGet();c.remindEnabled=!!on;backupCfgSet(c);}
/** 备份提醒间隔（天数） */
function setRemindInterval(days){const c=backupCfgGet();c.remindIntervalDays=Math.max(1,Math.floor(Number(days)||7));backupCfgSet(c);}
/** 本地时区时间戳 YYYYMMDD_HHMMSS（备份文件名用，避免 UTC 差 8 小时） */
function _localStamp(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return ''+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
}
/** 时间戳 → 显示用「YYYY-MM-DD HH:mm」 */
function _backupTimeLabel(ts){
  if(!ts)return '';
  const d=new Date(ts);
  const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
}
/** 备份快照：排除回收站与操作历史（与导出/文件同步约束一致） */
function _backupSnapshot(){const s={...DB};delete s.trash;delete s.aiOps;return s;}

/* ---- 备份目录句柄（网页版） ---- */
async function _loadBackupDirHandle(){
  if(_backupDirHandle)return _backupDirHandle;
  try{_backupDirHandle=await fhLoadKey(KEY_BACKUP_DIR);}catch(e){_backupDirHandle=null;}
  return _backupDirHandle;
}
async function _saveBackupDirHandle(h){_backupDirHandle=h;await fhStoreKey(KEY_BACKUP_DIR,h);}
/** 网页版：获取快照子目录句柄（所选备份目录下的 backups/，自动创建）；未设置备份目录返回 null */
async function _backupSnapDirHandle(){
  const dir=await _loadBackupDirHandle();
  if(!dir)return null;
  try{return await dir.getDirectoryHandle(BACKUPS_SUBDIR,{create:true});}catch(e){return null;}
}
/** 网页版：弹出目录选择器设置备份目录 */
async function chooseBackupDir(){
  if(!('showDirectoryPicker' in window)){toast('当前浏览器不支持目录选择，请使用 Chrome 或 Edge','error');return;}
  try{
    const dir=await window.showDirectoryPicker({mode:'readwrite'});
    if(!(await fhPerm(dir,true))){toast('未获得目录读写权限，请点「允许」授予后重试','error');return;}
    await _saveBackupDirHandle(dir);
    render();
    toast('备份目录已设置为：'+dir.name,'success');
  }catch(e){if(e.name!=='AbortError')toast('选择备份目录失败：'+e.message,'error');}
}
/** 备份目录显示名（网页版；未设置返回空串） */
async function backupDirName(){const h=await _loadBackupDirHandle();return h&&h.name?h.name:'';}

/* ---- 执行备份 ---- */
/**
 * 执行一次备份（立即或自动共用）：
 *  - 桌面版：先 saveDB 确保 data.json 为最新，再调 Rust backup_create 复制为带时间戳文件；
 *  - 网页版：写入备份目录中带时间戳的 JSON 文件。
 * @returns {Promise<string>} 备份文件名
 */
async function performBackup(){
  const name=IS_TAURI_RUNTIME?(DST_BACKUP_PREFIX+_localStamp()+'.json'):(BACKUP_FILE_PREFIX+_localStamp()+'.json');
  if(IS_TAURI_RUNTIME){
    await saveDB(); // 双写落盘（含 data_file_save → data.json），保证备份的是最新数据
    await window.__TAURI__.core.invoke('backup_create',{name:name});
  }else{
    const snapDir=await _backupSnapDirHandle();
    if(!snapDir){const err=new Error('未设置备份目录');err.code='NO_BACKUP_DIR';throw err;}
    const fh=await snapDir.getFileHandle(name,{create:true});
    const w=await fh.createWritable();
    await w.write(JSON.stringify(_backupSnapshot(),null,2));
    await w.close();
  }
  return name;
}
/** 立即备份（UI 按钮触发） */
async function nowBackup(){
  try{
    const name=await performBackup();
    const c=backupCfgGet();c.lastBackupAt=Date.now();backupCfgSet(c);
    await pruneOldBackups(); // 按保留份数清理最旧快照
    toast('备份成功：'+name,'success');
  }catch(e){
    if(e.code==='NO_BACKUP_DIR'){toast('请先设置备份目录','error');}
    else{toast('备份失败：'+e.message,'error');}
  }
  render();
}
/** 是否到自动备份时间点（间隔判断，单位天） */
function _backupDue(c){
  return c.enabled&&(!c.lastBackupAt||(Date.now()-c.lastBackupAt)>=c.intervalDays*DAY_MS);
}
/** 自动备份到期检查（应用启动时 + 定时器调用） */
async function maybeAutoBackup(){
  const c=backupCfgGet();
  if(!c.enabled||Date.now()<_backupRetryAt)return;
  if(!_backupDue(c))return;
  try{
    if(!IS_TAURI_RUNTIME){
      const dir=await _backupSnapDirHandle();
      if(!dir){_backupRetryAt=Date.now()+600000;return;} // 未设置备份目录，冷却后再试
    }
    const name=await performBackup();
    const nc=backupCfgGet();nc.lastBackupAt=Date.now();backupCfgSet(nc);
    await pruneOldBackups();
    // 仅在前台可见时弹提示，避免后台标签页静默打扰
    if(typeof document==='undefined'||!document.hidden)toast('已自动备份：'+name,'success');
  }catch(e){_backupRetryAt=Date.now()+600000;}
}
/** 备份提醒：距上次备份超过提醒间隔时，应用启动后弹窗提醒（每个备份周期仅提醒一次） */
async function checkBackupReminder(){
  const c=backupCfgGet();
  if(!c.remindEnabled||!c.lastBackupAt)return;
  if(Date.now()-c.lastBackupAt<c.remindIntervalDays*DAY_MS)return;
  if(c.lastRemindAt>=c.lastBackupAt)return; // 本周期已提醒过
  const nc=backupCfgGet();nc.lastRemindAt=Date.now();backupCfgSet(nc);
  if(typeof document==='undefined'||document.hidden)return;
  const days=Math.max(1,Math.floor((Date.now()-c.lastBackupAt)/DAY_MS));
  confirmModal('距上次备份已超过 '+days+' 天，建议立即备份以防数据丢失。',function(){closeModal();nowBackup();},'立即备份','稍后提醒');
}
/** 初始化自动备份调度（initApp 末尾调用）：启动后 3 秒检查一次备份与提醒，之后每分钟检查 */
function initAutoBackup(){
  if(_autoBackupTimer)return;
  setTimeout(function(){maybeAutoBackup();checkBackupReminder();},3000);
  _autoBackupTimer=setInterval(function(){
    if(typeof document!=='undefined'&&document.hidden)return; // 后台标签不轮询，恢复可见时 next tick 补查
    maybeAutoBackup();
  },60000);
}

/* ---- 备份列表 / 删除 / 恢复 ---- */
/** 列出备份文件（最新在前）：[{name,size,modified}] */
async function listBackups(){
  if(IS_TAURI_RUNTIME){
    const arr=await window.__TAURI__.core.invoke('backup_list');
    if(!Array.isArray(arr))return [];
    return arr.map(function(b){return {name:b.name,size:b.size||0,modified:(b.modified||0)*1000};}); // Rust modified 为 Unix 秒，转毫秒
  }
  const dir=await _backupSnapDirHandle();
  if(!dir)return [];
  const out=[];
  try{
    for await(const entry of dir.values()){
      if(entry.kind!=='file'||!entry.name.startsWith(BACKUP_FILE_PREFIX)||!entry.name.endsWith('.json'))continue;
      let size=0,modified=0;
      try{const f=await entry.getFile();size=f.size;modified=f.lastModified;}catch(e){}
      out.push({name:entry.name,size:size,modified:modified});
    }
  }catch(e){}
  out.sort((a,b)=>b.modified-a.modified);
  return out;
}
/** 按保留份数清理：超出 keepCount 份的最旧快照自动删除（列表已按最新在前排序，尾部即最旧） */
async function pruneOldBackups(){
  const cfg=backupCfgGet();
  const list=await listBackups();
  if(list.length<=cfg.keepCount)return;
  const toRemove=list.slice(cfg.keepCount);
  for(const b of toRemove){
    try{
      if(IS_TAURI_RUNTIME){await window.__TAURI__.core.invoke('backup_remove',{name:b.name});}
      else{
        const snapDir=await _backupSnapDirHandle();
        if(snapDir&&typeof snapDir.removeEntry==='function')await snapDir.removeEntry(b.name);
      }
    }catch(e){/* 单条清理失败不阻塞其余 */}
  }
}
/** 删除指定备份（二次确认） */
async function deleteBackup(name){
  if(!name)return;
  confirmModal('确认删除备份「'+name+'」？删除后不可恢复。',async function(){
    try{
      if(IS_TAURI_RUNTIME){await window.__TAURI__.core.invoke('backup_remove',{name:name});}
      else{
        const snapDir=await _backupSnapDirHandle();
        if(snapDir&&typeof snapDir.removeEntry==='function')await snapDir.removeEntry(name);
      }
      closeModal();render();
      toast('已删除备份：'+name,'info');
    }catch(e){toast('删除备份失败：'+e.message,'error');}
  },'确认删除');
}
/** 从备份恢复：读取备份内容 → 统一导入校验 → 覆盖当前数据 */
async function restoreBackup(name){
  if(!name)return;
  try{
    let text;
    if(IS_TAURI_RUNTIME){text=await window.__TAURI__.core.invoke('backup_read',{name:name});}
    else{
      const snapDir=await _backupSnapDirHandle();
      if(!snapDir){toast('备份目录不可用，请重新设置','error');return;}
      const f=await snapDir.getFileHandle(name);
      const file=await f.getFile();
      text=await file.text();
    }
    const data=JSON.parse(text);
    await importParsedData(data);
    toast('已从备份恢复：'+DB.orders.length+' 订单、'+DB.prices.length+' 价格、'+DB.units.length+' 单位','success');
  }catch(e){
    if(e&&e.code==='IMPORT_CANCELLED'){} // 用户取消
    else{toast('恢复失败：'+(e&&e.message||e||'未知错误'),'error');}
  }
}

/* ---- 统一导入/恢复逻辑（cover DB） ----
 * 供「导入 JSON 恢复」与「从备份恢复」共用：
 * 结构校验 + 完整性警告 + 二次确认 + 覆盖 + 迁移 + 落盘。
 * 用户取消时抛 code='IMPORT_CANCELLED' 的错误；校验失败抛普通 Error。
 */
async function importParsedData(data){
  // 导入/恢复数据不含回收站与操作历史（用户约束）：强制丢弃
  if(data&&typeof data==='object'){delete data.trash;delete data.aiOps;}
  if(!data.units||!data.prices||!data.orders){throw new Error('数据格式不正确，缺少必要字段');}
  if(!Array.isArray(data.units)||!data.units.every(function(u){return u&&u.id&&u.name;})){throw new Error('数据校验失败：关联单位数据不完整（缺少id或name）');}
  if(!Array.isArray(data.prices)){throw new Error('数据校验失败：价格数据格式错误');}
  if(!Array.isArray(data.orders)){throw new Error('数据校验失败：订单数据格式错误');}
  // 完整性检查（结算-单位 / 结算-订单 / 发票-结算）
  const badUnits=(data.settlements||[]).filter(s=>!(data.units||[]).some(u=>u.id===s.unitId));
  const badOrderRefs=[];(data.settlements||[]).forEach(s=>(s.orders||[]).forEach(so=>{if(!(data.orders||[]).some(o=>o.id===so.orderId))badOrderRefs.push({sId:s.id,oId:so.orderId});}));
  const badInv=(data.invoices||[]).filter(inv=>!(data.settlements||[]).some(s=>s.id===inv.settleId));
  const badCount=badUnits.length+badOrderRefs.length+badInv.length;
  let warnMsg='';
  if(badCount>0){warnMsg='⚠ 数据完整性警告：'+badCount+' 条记录存在关联缺失（单位'+badUnits.length+'、订单引用'+badOrderRefs.length+'、发票关联'+badInv.length+'），恢复后相关页面可能报错，是否仍继续？\n\n';}
  // 二次确认（用户可取消）
  const ok=await new Promise(function(resolve){
    confirmModal(warnMsg+'导入将覆盖当前所有数据，确认继续?',function(){closeModal();resolve(true);},'确认导入','取消',function(){resolve(false);});
  });
  if(!ok){const e=new Error('已取消');e.code='IMPORT_CANCELLED';throw e;}
  // 覆盖 + 默认字段补齐
  DB=data;
  if(!DB.specs)DB.specs=JSON.parse(JSON.stringify(DEFAULT_SPECS));
  if(!DB.bom)DB.bom=[];
  if(!DB.settlements)DB.settlements=[];
  if(!DB.invoices)DB.invoices=[];
  if(!DB.seq)DB.seq=100;
  if(!DB.orderSeq){
    const maxSeq=DB.orders.reduce(function(m,o){
      const mt=o.id.match(/PO\d{8}-(\d+)/);
      return mt?Math.max(m,parseInt(mt[1],10)):m;
    },1);
    DB.orderSeq=maxSeq+1;
  }
  migrateItems();
  await saveDB();
  closeModal();
  return true;
}

/* 备份相关函数清单（供 data.js 自检/UI 引用，避免硬编码） */
const _BACKUP_FNS=['backupCfgGet','setBackupEnabled','setBackupInterval','setKeepCount','setRemindEnabled','setRemindInterval','chooseBackupDir','backupDirName','nowBackup','listBackups','deleteBackup','restoreBackup','importParsedData','maybeAutoBackup','pruneOldBackups'];
