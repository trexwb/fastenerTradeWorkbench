// utils.js — 图标 + 草稿 + 工具函数 + Toast + Combo
/* =========================================================
   防抖 / 节流
   ========================================================= */
/**
 * 防抖：停止连续调用 delay 毫秒后仅执行最后一次。
 * @param {Function} fn - 目标函数
 * @param {number} [delay=150] - 延迟毫秒数
 * @returns {Function} 防抖包装函数（带 .cancel()）
 */
function debounce(fn,delay){
  delay=delay||150;
  let t=null;
  function wrapped(){
    const ctx=this,args=arguments;
    if(t)clearTimeout(t);
    t=setTimeout(function(){t=null;fn.apply(ctx,args);},delay);
  }
  wrapped.cancel=function(){if(t)clearTimeout(t);t=null;};
  return wrapped;
}
/**
 * 节流：每 delay 毫秒内至多触发一次（首次立即执行，间隔后补充执行尾次）。
 * @param {Function} fn - 目标函数
 * @param {number} [delay=150] - 间隔毫秒数
 * @returns {Function} 节流包装函数（带 .cancel()）
 */
function throttle(fn,delay){
  delay=delay||150;
  let last=0,t=null;
  function wrapped(){
    const ctx=this,args=arguments;
    const now=Date.now();
    if(now-last>=delay){
      last=now;if(t){clearTimeout(t);t=null;}
      fn.apply(ctx,args);
      return;
    }
    if(t)return;
    const remain=delay-(now-last);
    t=setTimeout(function(){
      last=Date.now();t=null;
      fn.apply(ctx,args);
    },remain);
  }
  wrapped.cancel=function(){if(t)clearTimeout(t);t=null;};
  return wrapped;
}
/* =========================================================
   SVG 图标
   ========================================================= */
const SVG={
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  building:'<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/><path d="M9 9h.01M9 13h.01M9 17h.01"/>',
  tag:'<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  yuan:'<path d="M8 4l4 8 4-8M6 12h12M6 16h12M8 20l4-5 4 5"/>',
  wallet:'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  receipt:'<path d="M6 3h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V3z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/>',
  doc:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  database:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit:'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash:'<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  check:'<polyline points="20 6 9 17 4 12"/>',
  x:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  arrowLeft:'<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  alert:'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  search:'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  menu:'<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  chevronRight:'<polyline points="9 18 15 12 9 6"/>',
  chevronDown:'<polyline points="6 9 12 15 18 9"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  refresh:'<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  fileText:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/>',
  palette:'<circle cx="13.5" cy="6.5" r="2"/><circle cx="17.5" cy="10" r="2"/><circle cx="9.5" cy="14" r="2"/><circle cx="13.5" cy="16.5" r="2"/><circle cx="6.5" cy="11" r="2"/><path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10a2 2 0 0 0 2-2c0-.6-.27-1.16-.7-1.54-.42-.36-.68-.87-.68-1.46 0-1.1.9-2 2-2h2.34c3.38 0 6.12-2.72 6.12-6.04C22.08 5.46 17.54 2 12 2z"/>',
  package:'<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  income:'<circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/>',
  expense:'<circle cx="12" cy="12" r="10"/><polyline points="16 12 12 8 8 12"/><line x1="12" y1="16" x2="12" y2="8"/>',
  fileUp:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="12"/><line x1="15" y1="15" x2="12" y2="12"/>',
  fileDown:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="12" y1="18" x2="12" y2="12"/>',
  keyboard:'<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6.01" y2="10"/><line x1="10" y1="10" x2="10.01" y2="10"/><line x1="14" y1="10" x2="14.01" y2="10"/><line x1="18" y1="10" x2="18.01" y2="10"/><line x1="8" y1="14" x2="8.01" y2="14"/><line x1="12" y1="14" x2="12.01" y2="14"/><line x1="16" y1="14" x2="16.01" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/>',
  zap:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  home:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  cornerUpLeft:'<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  chevronUp:'<polyline points="18 15 12 9 6 15"/>',
  chevronLeft:'<polyline points="15 18 9 12 15 6"/>',
  filter:'<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  shoppingCart:'<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  info:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  alertTriangle:'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  alertCircle:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
};
let _iconCache={};
/**
 * 获取内联 SVG 图标 HTML 字符串，支持缓存避免重复拼接。
 * @param {string} name - 图标名称（对应 SVG 字典键）
 * @param {number} [size=18] - 图标尺寸(px)
 * @returns {string} SVG 图标 HTML 字符串
 */
function icon(name,size){let k=name+'|'+(size||18);if(_iconCache[k])return _iconCache[k];let s='<svg width="'+(size||18)+'" height="'+(size||18)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(SVG[name]||'')+'</svg>';_iconCache[k]=s;return s;}


/* =========================================================
   表单草稿系统 — localStorage 仅用于表单填写缓存
   避免填写过程中退出/关闭/误操作导致数据丢失
   ========================================================= */
/**
 * 表单草稿类型枚举，键名对应 saveDraft/loadDraft 的 type 参数。
 * @type {{unit:string,order:string,bom:string,price:string}}
 */
/**
 * 表单草稿类型映射表
 * @type {Object.<string, string>}
 * @description 用于 saveDraft/loadDraft/clearDraft/hasDraft 的 type 参数
 */
const DRAFT_TYPES={unit:'unit',order:'order',bom:'bom',price:'price'};
/**
 * 保存表单草稿到 localStorage（数据流：表单 → localStorage），附带时间戳和版本号。
 * @param {string} type - 草稿类型，取 DRAFT_TYPES 枚举值
 * @param {Object} data - 待保存的表单数据对象
 * @returns {void} 无返回值（失败静默）
 */
function saveDraft(type,data){
  try{localStorage.setItem(DRAFT_PREFIX+type,JSON.stringify({...data,_ts:Date.now(),_appVersion:APP_VERSION}));}
  catch(e){console.warn('草稿保存失败:',e);}
}
/**
 * 从 localStorage 读取指定类型草稿（数据流：localStorage → 内存）。
 * @param {string} type - 草稿类型
 * @returns {Object|null} 解析后的 JSON 对象或 null
 */
function loadDraft(type){
  try{
    const raw=localStorage.getItem(DRAFT_PREFIX+type);
    return raw?JSON.parse(raw):null;
  }catch(e){return null;}
}
/**
 * 清除 localStorage 中指定类型的草稿（数据流：localStorage → 删除）。
 * @param {string} type - 草稿类型
 * @returns {void} 无返回值
 */
function clearDraft(type){
  try{localStorage.removeItem(DRAFT_PREFIX+type);}catch(e){}
}
/**
 * 检查指定类型草稿是否存在（数据流：localStorage → boolean）。
 * @param {string} type - 草稿类型
 * @returns {boolean} 存在返回 true，否则 false
 */
function hasDraft(type){
  try{return !!localStorage.getItem(DRAFT_PREFIX+type);}catch(e){return false;}
}
/* 收集关联单位表单数据 */
/**
 * 收集单位表单当前填写数据（数据流：DOM → JS对象）。
 * @returns {Object|null} 单位表单数据对象，DOM 不存在时返回 null
 */
function collectUnitDraft(){
  const name=document.getElementById('f_name');
  if(!name)return null;
  // combo字段用 dataset.val（普通input/select用 .value）
  const getVal=function(id){const el=document.getElementById(id);return el?(el.dataset&&el.dataset.val!==undefined?el.dataset.val:el.value)||'':'';};
  return {
    name:name.value,
    roles:[...document.querySelectorAll('.role-opt.on')].map(e=>e.dataset.role),
    term:(document.getElementById('f_term')||{}).value||'',
    rating:(document.getElementById('f_rating')||{}).value||'',
    contacts:readContacts(),
    invoice:{
      taxId:(document.getElementById('f_taxId')||{}).value||'',
      address:(document.getElementById('f_address')||{}).value||'',
      phone:(document.getElementById('f_phone')||{}).value||'',
      bank:(document.getElementById('f_bank')||{}).value||'',
      accountNo:(document.getElementById('f_accountNo')||{}).value||''
    }
  };
}
/* 恢复关联单位表单数据 */
/**
 * 将草稿数据恢复到单位表单（数据流：JS对象 → DOM）。
 * @param {Object} d - 草稿数据对象
 * @returns {void} 无返回值
 */
function restoreUnitDraft(d){
  if(!d)return;
  if(d.name&&DB.units&&DB.units.some(u=>u.name===d.name)){toast('已存在同名单位 '+d.name+'，本次恢复将作为新记录（如有需要请手动合并）','warn');}
  const nameEl=document.getElementById('f_name');if(nameEl)nameEl.value=d.name||'';
  document.querySelectorAll('.role-opt').forEach(el=>{
    el.classList.toggle('on',d.roles&&d.roles.includes(el.dataset.role));
  });
  const termEl=document.getElementById('f_term');if(termEl)termEl.value=d.term||'';
  const ratingEl=document.getElementById('f_rating');if(ratingEl)ratingEl.value=d.rating||'';
  if(d.contacts&&d.contacts.length){
    const box=document.getElementById('contactsBox');
    if(box)box.innerHTML=d.contacts.map((c,i)=>contactRow(c,i)).join('');
  }
  if(d.invoice){
    ['taxId','address','phone','bank','accountNo'].forEach(k=>{
      const el=document.getElementById('f_'+k);if(el)el.value=d.invoice[k]||'';
    });
  }
}
/* 收集订单表单数据 */
/**
 * 收集订单表单当前填写数据（数据流：DOM → JS对象）。
 * @returns {Object|null} 订单表单数据对象，DOM 不存在时返回 null
 */
function collectOrderDraft(){
  const buyer=document.getElementById('tf_buyer');
  if(!buyer)return null;
  return {
    buyerId:(buyer.dataset&&buyer.dataset.val!==undefined)?buyer.dataset.val:(buyer.value||''),
    buyerContact:(document.getElementById('tf_contact')||{}).value||'',
    project:(document.getElementById('tf_project')||{}).value||'',
    delivery:(document.getElementById('tf_delivery')||{}).value||'',
    status:(document.getElementById('tf_status')||{}).value||'',
    remark:(document.getElementById('tf_remark')||{}).value||'',
    items:_fItems.map(function(it){return {...it};})
  };
}
/* 恢复订单表单数据 */
/**
 * 将草稿数据恢复到订单表单（数据流：JS对象 → DOM）。
 * @param {Object} d - 草稿数据对象
 * @returns {void} 无返回值
 */
function restoreOrderDraft(d){
  if(!d)return;
  const buyerEl=document.getElementById('tf_buyer');if(buyerEl)buyerEl.dataset.val=d.buyerId||'';
  const bc=document.getElementById('tf_contact');if(bc)bc.value=d.buyerContact||'';
  const pj=document.getElementById('tf_project');if(pj)pj.value=d.project||'';
  const dl=document.getElementById('tf_delivery');if(dl)dl.value=d.delivery||'';
  const st=document.getElementById('tf_status');if(st)st.value=d.status||'待确认';
  const rm=document.getElementById('tf_remark');if(rm)rm.value=d.remark||'';
  if(d.items&&d.items.length){_fItems=d.items.map(it=>({...it}));}
}
/* 绑定草稿自动保存 — 给容器加上 input/change 事件 */
/**
 * 绑定草稿自动保存事件（数据流：DOM input/change事件 → collectFn → saveDraft → localStorage）。
 * @param {Element} container - 监听容器元素
 * @param {Function} collectFn - 收集表单数据的函数
 * @param {string} type - 草稿类型
 * @returns {void} 无返回值
 */
function bindDraftSave(container,collectFn,type){
  if(!container)return;
  const handler=function(e){
    // 有未保存表单数据时标记 dirty，关闭时弹出确认防止误关丢失输入
    if(typeof markDrawerDirty==='function')markDrawerDirty();
    const d=collectFn();if(d)saveDraft(type,d);
  };
  container.addEventListener('input',handler);
  container.addEventListener('change',handler);
}
/* 检查并恢复草稿（带确认弹窗） */
/**
 * 检查并提示恢复草稿（数据流：localStorage → 弹窗确认 → restoreFn 恢复 或 openFn 放弃）。
 * @param {string} type - 草稿类型
 * @param {Function} restoreFn - 恢复数据回调
 * @param {Function} openFn - 放弃后打开表单回调
 * @param {string} formLabel - 表单名称（用于提示文案）
 * @returns {boolean} 存在草稿并返回 true，否则 false
 */
function checkDraftRestore(type,restoreFn,openFn,formLabel){
  if(!hasDraft(type))return false;
  const d=loadDraft(type);
  if(!d)return false;
  const ts=d._ts?new Date(d._ts).toLocaleString('zh-CN'):'';
  confirmModal(
    '检测到「'+formLabel+'」有未提交的草稿（'+ts+'），是否恢复？',
    ()=>{restoreFn(d);closeModal();toast('草稿已恢复','success');},
    '恢复草稿','放弃草稿',
    ()=>{clearDraft(type);if(openFn)openFn();closeModal();toast('草稿已清除','info');}
  );
  return true;
}

/* 收集BOM表单数据 */
/**
 * 收集BOM表单当前填写数据（数据流：DOM → JS对象）。
 * @returns {Object|null} BOM 表单数据对象，DOM 不存在时返回 null
 */
function collectBOMDraft(){
  const sku=document.getElementById('bom_sku');
  if(!sku)return null;
  let d={sku:sku.value.trim(),name:(document.getElementById('bom_name')||{}).value||'',spec:(document.getElementById('bom_spec')||{}).value||''};
  SPEC_FIELDS.forEach(function(k){d[k]=(document.getElementById('bom_'+k)||{}).dataset.val||'';});
  return d;
}
/* 恢复BOM表单数据 */
/**
 * 将草稿数据恢复到BOM表单（数据流：JS对象 → DOM）。
 * @param {Object} d - 草稿数据对象
 * @returns {void} 无返回值
 */
function restoreBOMDraft(d){
  if(!d)return;
  let skuEl=document.getElementById('bom_sku');if(skuEl)skuEl.value=d.sku||'';
  let nameEl=document.getElementById('bom_name');if(nameEl)nameEl.value=d.name||'';
  let specEl=document.getElementById('bom_spec');if(specEl)specEl.value=d.spec||'';
  SPEC_FIELDS.forEach(function(k){
    let el=document.getElementById('bom_'+k);
    if(el&&d[k]){el.dataset.val=d[k];let inp=el.querySelector('input');if(inp){let opt=(DB.specs[k]||[]).find(function(v){return v===d[k];});inp.value=opt||d[k];el.classList.add('has-val');}}
  });
}

/* 收集报价表单数据 */
/**
 * 收集报价表单当前填写数据（数据流：DOM → JS对象）。
 * @returns {Object|null} 报价表单数据对象，DOM 不存在时返回 null
 */
function collectPriceDraft(){
  let unitEl=document.getElementById('ps_unit');
  if(!unitEl)return null;
  let d={unitId:unitEl.dataset.val||'',unitLabel:(unitEl.querySelector('input')||{}).value||'',contact:(document.getElementById('ps_contact')||{}).value||'',spec:(document.getElementById('ps_spec')||{}).value||'',bomSku:(document.getElementById('ps_bom_ref')||{}).dataset.val||'',price:(document.getElementById('ps_price')||{}).value||'',validFrom:(document.getElementById('ps_valid')||{}).value||'',remark:(document.getElementById('ps_remark')||{}).value||''};
  SPEC_FIELDS.forEach(function(k){d[k]=(document.getElementById('ps_'+k)||{}).dataset.val||'';});
  return d;
}
/* 恢复报价表单数据 */
/**
 * 将草稿数据恢复到报价表单（数据流：JS对象 → DOM）。
 * @param {Object} d - 草稿数据对象
 * @returns {void} 无返回值
 */
function restorePriceDraft(d){
  if(!d)return;
  let specEl=document.getElementById('ps_spec');if(specEl)specEl.value=d.spec||'';
  let priceEl=document.getElementById('ps_price');if(priceEl)priceEl.value=d.price||'';
  let validEl=document.getElementById('ps_valid');if(validEl)validEl.value=d.validFrom||'';
  let remarkEl=document.getElementById('ps_remark');if(remarkEl)remarkEl.value=d.remark||'';
  let contactEl=document.getElementById('ps_contact');if(contactEl)contactEl.value=d.contact||'';
  // BOM引用 combo
  let bomRef=document.getElementById('ps_bom_ref');if(bomRef&&d.bomSku){bomRef.dataset.val=d.bomSku;let bInp=bomRef.querySelector('input');if(bInp){let bOpt=(DB.bom||[]).find(function(b){return b.sku===d.bomSku;});bInp.value=bOpt?bOpt.sku+' · '+bOpt.name+' · '+(bOpt.spec||''):d.bomSku;bomRef.classList.add('has-val');}}
  // 供应商 combo + 联系人下拉
  let unitEl=document.getElementById('ps_unit');if(unitEl&&d.unitId){unitEl.dataset.val=d.unitId;let uInp=unitEl.querySelector('input');if(uInp){uInp.value=d.unitLabel||pName(d.unitId);unitEl.classList.add('has-val');}
    // 填充联系人下拉
    let cEl=document.getElementById('ps_contact');
    if(cEl){cEl.innerHTML=typeof contactOpts==='function'?contactOpts(d.unitId,'供应商'):'<option value="">（请先选择供应商）</option>';if(d.contact)cEl.value=d.contact;}
  }
  // 规格属性 combo
  SPEC_FIELDS.forEach(function(k){
    let el=document.getElementById('ps_'+k);
    if(el&&d[k]){el.dataset.val=d[k];let inp=el.querySelector('input');if(inp){let opt=(DB.specs[k]||[]).find(function(v){return v===d[k];});inp.value=opt||d[k];el.classList.add('has-val');}}
  });
}


/* =========================================================
   常量
   ========================================================= */
/**
 * 一天的毫秒数常量，用于日期天数差计算。
 * @type {number}
 */
/**
 * 每天毫秒数（24 * 60 * 60 * 1000）
 * @type {number}
 */
const MS_PER_DAY=86400000;
/**
 * Toast 提示默认显示时长(ms)。
 * @type {number}
 */
/**
 * Toast 消息显示时长（毫秒）
 * @type {number}
 */
const TOAST_DURATION=2600;
/**
 * Toast 淡出动画时长(ms)。
 * @type {number}
 */
/**
 * Toast 消息淡出动画时长（毫秒）
 * @type {number}
 */
const TOAST_FADE=300;
/**
 * 获取当前日期字符串（YYYY-MM-DD，本地时区）。
 * @returns {string} 今日日期字符串
 */
const today=()=>new Date().toISOString().slice(0,10);
/**
 * 获取当前日期时间字符串（YYYY-MM-DD HH:mm，本地时区）。
 * @returns {string} 当前日期时间字符串
 */
const now=()=>new Date().toISOString().slice(0,16).replace('T',' ');
/**
 * 金额格式化：添加 ¥ 前缀并固定两位小数（千分位分隔）。
 * @param {number} n - 待格式化数字
 * @returns {string} 格式化后的金额字符串
 */
const fmt=n=>'¥'+Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
/**
 * 数字格式化：千分位分隔，无小数位。
 * @param {number} n - 待格式化数字
 * @returns {string} 格式化后的数字字符串
 */
const fmtN=n=>Number(n||0).toLocaleString('zh-CN');
/**
 * HTML 转义：将 & < > 替换为实体字符，防止 XSS 注入。
 * @param {*} s - 待转义的值（非字符串会先转字符串）
 * @returns {string} 转义后的安全字符串
 */
function escHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
/**
 * HTML属性值转义：将双引号替换为 &quot;，用于安全拼接 HTML 属性。
 * @param {*} s - 待转义的值
 * @returns {string} 转义后的安全字符串
 */
function escAttr(s){return String(s==null?'':s).replace(/"/g,'&quot;');}
let _unitNameCache=null;
/**
 * 重建单位名称缓存 Map（id → {name, rating}），在数据变更后由 saveDB 触发失效并重建。
 * @returns {void} 无返回值
 */
function _buildUnitCache(){const m=new Map();DB.units.forEach(u=>m.set(u.id,{name:u.name,rating:u.rating}));_unitNameCache=m;}
/**
 * 根据单位ID获取单位名称，利用 _unitNameCache 缓存加速查询。
 * @param {string} id - 单位ID
 * @returns {string} 单位名称，未找到时返回原ID
 */
function pName(id){if(!_unitNameCache)_buildUnitCache();const u=_unitNameCache.get(id);return u?u.name:id||'';}
/**
 * 根据单位ID获取单位评级，利用 _unitNameCache 缓存加速查询。
 * @param {string} id - 单位ID
 * @returns {string} 单位评级，未找到时返回空串
 */
function pRating(id){if(!_unitNameCache)_buildUnitCache();const u=_unitNameCache.get(id);return u?u.rating:'';}
/**
 * 将对象的 SPEC_FIELDS 属性值用 · 连接为规格标签纯文本字符串。
 * @param {Object} it - 含 SPEC_FIELDS 属性的对象
 * @returns {string} 用 · 连接的规格文本
 */
function specLabel(it){return SPEC_FIELDS.filter(k=>it[k]).map(k=>it[k]).join(' · ');}
/**
 * 将对象的 SPEC_FIELDS 属性渲染为带标签名的规格标签 HTML（含 label 和 value）。
 * @param {Object} it - 含 SPEC_FIELDS 属性的对象
 * @returns {string} 规格标签 HTML 片段
 */
function specTags(it){return SPEC_FIELDS.filter(k=>it[k]).map(k=>'<span class="spec-tag">'+SPEC_LABELS[k]+': '+escHtml(it[k])+'</span>').join('');}
let _bomCache=null;
/**
 * 根据 SKU 从 BOM 缓存 Map 中查找 BOM 记录。
 * @param {string} sku - BOM SKU
 * @returns {Object|undefined} BOM 记录，未找到时返回 undefined
 */
function _getBom(sku){if(!_bomCache){_bomCache=new Map();DB.bom.forEach(b=>_bomCache.set(b.sku,b));}return _bomCache.get(sku);}
/**
 * 渲染报价行中的 BOM SKU 标签 HTML，手动输入或无BOM引用时显示 -。
 * @param {Object} p - 报价记录
 * @returns {string} BOM SKU 标签 HTML
 */
function priceBomSku(p){
  if(!p.bomSku||p.bomSku==='__manual__')return '<span class="muted">-</span>';
  const b=_getBom(p.bomSku);
  return b?'<span class="tag info">'+escHtml(b.sku||'-')+'</span>':'<span class="muted">-</span>';
}
/**
 * 获取报价的规格文本，优先使用自有规格字段，其次从关联BOM查找。
 * @param {Object} p - 报价记录
 * @returns {string} 规格文本 HTML（含转义）
 */
function priceSpec(p){
  if(p.spec)return escHtml(p.spec);
  if(!p.bomSku||p.bomSku==='__manual__')return '<span class="muted">-</span>';
  const b=_getBom(p.bomSku);
  return b&&b.spec?escHtml(b.spec):'<span class="muted">-</span>';
}
/**
 * 渲染报价行中的属性列 HTML，优先显示规格标签，无数据时显示 -。
 * @param {Object} p - 报价记录
 * @returns {string} 属性列 HTML 片段
 */
function priceAttrCol(p){
  let html=specTags(p);
  return html||'<span class="muted">-</span>';
}
// specMatch: 只有当 item 有规格值时才要求 price 对应字段匹配；item 未填的字段不限制（宽泛匹配）
/**
 * 规格宽松匹配：item 已填的所有 SPEC_FIELDS 在 price 中必须一致，item 未填的字段不限制。
 * @param {Object} price - 报价记录（含 SPEC_FIELDS 属性）
 * @param {Object} item - 订单行项目（含 SPEC_FIELDS 属性）
 * @returns {boolean} 匹配返回 true，否则 false
 */
function specMatch(price,item){return SPEC_FIELDS.every(k=>!item[k]||item[k]===price[k]);}
/**
 * 获取订单行项目中状态为「已选」的寻源选项列表。
 * @param {Object} it - 订单行项目
 * @returns {Array} 已选寻源选项数组
 */
function itemOpts(it){return (it.options||[]).filter(o=>o.status==='已选');}
/**
 * 计算订单行项目已分配的寻源总数量。
 * @param {Object} it - 订单行项目
 * @returns {number} 已分配总数量
 */
function itemAllocSum(it){if(!it)return 0;return itemOpts(it).reduce((a,o)=>a+(o.allocQty||0),0);}
/**
 * 判断订单行项目是否已完成寻源（已分配量 >= 需求量）。
 * @param {Object} it - 订单行项目
 * @returns {boolean} 已完成返回 true，否则 false
 */
function isItemSourced(it){return itemAllocSum(it)>=it.qty;}
/**
 * 获取订单行项目的寻源状态标签 [文本, CSS类名]，三种状态：待寻源/部分寻源/已确认。
 * @param {Object} it - 订单行项目
 * @returns {Array<string>} [状态文本, CSS类名]
 */
function itemSourcingStatus(it){
  if(!itemOpts(it).length)return ['待寻源','gray'];
  if(itemAllocSum(it)>=it.qty)return ['已确认','ok'];
  return ['部分寻源','warn'];
}
/**
 * 计算单个订单行项目的利润 =（售价 - 采购成本）* 已分配量。
 * @param {Object} it - 订单行项目
 * @returns {number} 行项目利润（四舍五入两位小数）
 */
function itemQuotePrice(it){return (it.quotePrice>0?it.quotePrice:(it.salePrice||0));}
function itemProfit(it){return Math.round(itemOpts(it).reduce((a,o)=>a+(itemQuotePrice(it)-(o.price||0))*(o.allocQty||0),0)*100)/100;}
/**
 * 计算整个订单的总利润，汇总所有行项目的利润。
 * @param {Object} o - 订单对象
 * @returns {number} 订单总利润
 */
function orderProfit(o){return Math.round(o.items.reduce((a,it)=>a+itemProfit(it),0)*100)/100;}
/**
 * 计算订单的总销售额（各行项目售价 * 数量之和）。
 * @param {Object} o - 订单对象
 * @returns {number} 总销售额
 */
function orderSales(o){return o.items.reduce((a,it)=>a+itemQuotePrice(it)*it.qty,0);}
/**
 * 计算订单的总采购成本（各行项目已选寻源选项成本之和）。
 * @param {Object} o - 订单对象
 * @returns {number} 总采购成本
 */
function orderCost(o){return o.items.reduce((a,it)=>a+itemOpts(it).reduce((s,o)=>s+(o.price||0)*(o.allocQty||0),0),0);}
/**
 * 计算订单的意向金额（数量 × 意向价）。
 * 意向价是采购商最初期望的价格，salePrice 字段。
 * @param {Object} o - 订单对象
 * @returns {number} 意向金额
 */
function orderIntent(o){return o.items.reduce((a,it)=>a+(it.salePrice||0)*(it.qty||0),0);}
/**
 * 渲染角色标签 HTML，采购商显示蓝色 info 标签，其他角色显示灰色 gray 标签。
 * @param {Array<string>} roles - 角色数组（如 ['采购商']）
 * @returns {string} 角色标签 HTML 片段
 */
function roleBadge(roles){return roles.map(r=>'<span class="tag '+(r==='采购商'?'info':'gray')+'">'+r+'</span>').join(' ');}
/**
 * 将日期字符串（YYYY-MM-DD）转换为 Date 对象，时间归零。
 * @param {string} s - 日期字符串
 * @returns {Date} 归零时间的 Date 对象
 */
function toDate(s){
  if(s&&typeof s==='object')s=s.time||'';
  return new Date(String(s||'').slice(0,10)+'T00:00:00');
}
/**
 * 判断订单是否逾期（交付日早于今天且状态非完成/取消/未成交）。
 * @param {Object} o - 订单对象
 * @returns {boolean} 逾期返回 true，否则 false
 */
function isOverdue(o){return toDate(o.delivery)<toDate(today())&&o.status!=='完成'&&o.status!=='取消'&&o.status!=='未成交';}
/**
 * 判断订单是否即将到期（距离交付日 0-3 天且状态非完成/取消/未成交）。
 * @param {Object} o - 订单对象
 * @returns {boolean} 临近到期返回 true，否则 false
 */
function isApproaching(o){const d=toDate(o.delivery);const t=toDate(today());const diff=(d-t)/(MS_PER_DAY);return diff>=0&&diff<=3&&o.status!=='完成'&&o.status!=='取消'&&o.status!=='未成交';}
/**
 * 计算距离目标日期的剩余天数（向上取整）。
 * @param {string} date - 目标日期字符串
 * @returns {number} 剩余天数
 */
function daysUntil(date){const d=toDate(date);const t=toDate(today());return Math.ceil((d-t)/(MS_PER_DAY));}


/* =========================================================
   Toast 消息
   ========================================================= */
/**
 * 显示浮动提示消息，自动创建容器，支持 success/error/warning/info 四种类型，默认 2.6 秒后淡出。
 * @param {string} text - 提示文案
 * @param {string} [type='info'] - 提示类型（success/error/warning/info）
 * @returns {void} 无返回值
 */
function toast(text,type){
  type=type||'info';
  let w=document.querySelector('.msg-wrap');
  if(!w){w=document.createElement('div');w.className='msg-wrap';document.body.appendChild(w);}
  const icons={success:'✓',error:'✕',warning:'!',info:'i'};
  const d=document.createElement('div');
  d.className='msg '+type;
  d.innerHTML='<i class="mi">'+icons[type]+'</i><span>'+escHtml(text)+'</span>';
  w.appendChild(d);
  setTimeout(()=>{d.style.transition='opacity .3s';d.style.opacity='0';setTimeout(()=>d.remove(),TOAST_FADE);},TOAST_DURATION);
}


/* =========================================================
   Combo 检索下拉 (支持 allow-create)
   ========================================================= */
/**
 * 过滤 combo 下拉选项，按输入文本不区分大小写匹配 label 字段。
 * @param {HTMLInputElement} input - combo 输入框
 * @param {Array} options - 候选选项数组（每项含 label）
 * @returns {Array} 过滤后的选项数组
 */
function comboFilter(input, options){
  const q=input.value.trim().toLowerCase();
  return options.filter(o=>!q||(o.label+'').toLowerCase().includes(q));
}
/**
 * 初始化检索下拉 combo 组件，支持键盘导航（↑↓Enter Esc）、自定义输入新建（allowCreate）、数据回填（dataset.val），选中后写入 el.dataset.val。
 * @param {Element} el - combo 容器元素
 * @param {Array} options - 候选选项数组（每项含 id/label/tag）
 * @param {Function} onSelect - 选中回调，接收选中项对象
 * @param {string} [placeholder] - 占位提示文字
 * @param {boolean} [allowCreate=true] - 是否允许输入新建
 * @returns {void} 无返回值
 * @since v1.0
 */
function combo(el,options,onSelect,placeholder,allowCreate){
  placeholder=placeholder||'搜索或直接输入...';
  allowCreate=allowCreate!==false;
  const listId='cl_'+Math.random().toString(36).slice(2,8);
  el.innerHTML='<div class="combo-wrap" style="position:relative">'+
    '<input role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-autocomplete="list" aria-controls="'+listId+'" placeholder="'+escAttr(placeholder)+'" autocomplete="off" style="width:100%" />'+
    '<ul role="listbox" id="'+listId+'" class="combo-drop" style="display:none;position:absolute;top:calc(100%+4px);left:0;right:0;background:var(--card);border:1px solid var(--line);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.09);z-index:var(--z-combo-over);max-height:240px;overflow-y:auto;padding:4px 0;list-style:none;margin:0" aria-label="可选项"></ul>'+
  '</div>';
  const inp=el.querySelector('input');
  const drop=el.querySelector('.combo-drop');
  let activeIdx=-1;
  // 选中流程中的 input 事件是 select() 内部派发的，需跳过 show() 防止下拉被重新打开
  let _selecting=false;
/** 设置 combo aria-expanded 无障碍状态属性 */
  function setExpanded(v){inp.setAttribute('aria-expanded',v?'true':'false');}
/** 显示 combo 下拉列表，根据输入过滤选项，支持键盘高亮导航 */
  function show(q,keepIdx){
    const q2=(q||'').toLowerCase().trim();
    const hits=comboFilter(inp,options);
    activeIdx=keepIdx===undefined?-1:Math.min(keepIdx,hits.length-1);
    if(!hits.length&&q2&&allowCreate){
      drop.innerHTML='<li class="combo-item" role="option" style="color:var(--blue);cursor:pointer;padding:8px 12px">按「<b>'+escHtml(q)+'</b>」新建 <span style="margin-left:auto;font-size:12px;color:var(--gray)">回车确认</span></li>';
      drop.querySelector('.combo-item').addEventListener('mousedown',e=>{e.preventDefault();select({id:q,label:q,isCustom:true});});
    }else if(!hits.length){
      drop.innerHTML='<li class="no-res" style="padding:8px 12px;color:var(--gray);font-size:14px">无匹配结果，可直接输入新值后回车</li>';
    }else{
      drop.innerHTML=hits.map((h,i)=>'<li class="combo-item" role="option" data-id="'+escAttr(h.id)+'" data-idx="'+i+'" style="padding:8px 12px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:6px"'+(i===activeIdx?' aria-selected="true"':'')+'>'+escHtml(h.label)+(h.tag?'<span class="ci-tag tag '+h.tag.cls+'" style="margin-left:auto;font-size:12px">'+escHtml(h.tag.text)+'</span>':'')+'</li>').join('');
      drop.querySelectorAll('.combo-item').forEach(item=>{
        item.addEventListener('mousedown',e=>{e.preventDefault();select(hits[+item.dataset.idx]);});
        item.addEventListener('mouseenter',()=>{activeIdx=+item.dataset.idx;syncActive();});
      });
    }
    drop.style.display='block';setExpanded(true);el.classList.add('open');
  }
/** 同步 combo 下拉列表中的高亮激活项样式和滚动位置 */
  function syncActive(){
    drop.querySelectorAll('.combo-item').forEach((item,i)=>{
      item.setAttribute('aria-selected',i===activeIdx?'true':'false');
      item.style.background=i===activeIdx?'var(--pri-l)':'';
    });
    if(activeIdx>=0){
      const el2=drop.querySelector('[data-idx="'+activeIdx+'"]');
      if(el2)el2.scrollIntoView({block:'nearest'});
    }
  }
  // 输入防抖（100ms）避免每敲一个字符就重建整个下拉列表
  const showDebounced=debounce(function(v){show(v);},100);
  inp.addEventListener('focus',()=>show(inp.value));
  inp.addEventListener('input',()=>{if(_selecting)return;showDebounced(inp.value);});
  inp.addEventListener('keydown',e=>{
    const q2=(inp.value||'').toLowerCase().trim();
    const hits=comboFilter(inp,options);
    if(e.key==='ArrowDown'){
      e.preventDefault();activeIdx=Math.min(activeIdx+1,hits.length-1+(q2&&allowCreate?1:0));show(inp.value,activeIdx);
    }else if(e.key==='ArrowUp'){
      e.preventDefault();activeIdx=Math.max(activeIdx-1,0);show(inp.value,activeIdx);
    }else if(e.key==='Enter'){
      e.preventDefault();
      if(activeIdx>=0&&activeIdx<hits.length){select(hits[activeIdx]);}
      else{const raw=inp.value.trim();const hit=options.find(o=>o.label===raw||(o.label+'').toLowerCase()===raw.toLowerCase());if(hit){select(hit);}else if(raw&&allowCreate){select({id:raw,label:raw,isCustom:true});}}
    }else if(e.key==='Escape'){closeDrop();}
  });
  inp.addEventListener('blur',()=>setTimeout(closeDrop,150));
/** 关闭 combo 下拉列表，重置激活索引和展开状态 */
  function closeDrop(){drop.style.display='none';setExpanded(false);el.classList.remove('open');activeIdx=-1;}
/** 处理 combo 选项选中：写入 el.dataset.val，更新 input 显示值，触发 onSelect 回调并派发 input 事件 */
  function select(opt){
    if(opt.id==='__manual__'){inp.value='';inp.placeholder='手动输入';}
    else{inp.value=opt.label;}
    el.dataset.val=opt.id;el.dataset.custom=opt.isCustom?'1':'0';
    el.classList.add('has-val');closeDrop();
    _selecting=true;
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    _selecting=false;
    if(onSelect)onSelect(opt);
  }
  if(el.dataset.val){
    const exist=options.find(o=>o.id===el.dataset.val);
    if(exist){
      if(exist.id==='__manual__'){inp.value='';inp.placeholder='手动输入';}
      else{inp.value=exist.label;}
      el.classList.add('has-val');
    }
    else if(el.dataset.val){inp.value=el.dataset.val;el.classList.add('has-val');}
  }
}
/**
 * 获取 combo 组件的当前选中值（从 el.dataset.val 读取）。
 * @param {string} id - combo 元素 ID
 * @returns {string} 选中值（dataset.val），无则空串
 */
function getComboVal(id){const el=document.getElementById(id);return el?(el.dataset.val||''):'';}



/** 生成唯一ID，格式为前缀字符 + 自增序号 */
/**
 * 生成唯一ID，格式为前缀字符 + 自增序号。
 * @param {string} p - ID 前缀（如 'U'、'PO'）
 * @returns {string} 生成的唯一 ID
 */
function uid(p){DB.seq=(DB.seq||100)+1;return p+DB.seq;}

/* 统一分页组件
   total: 总记录数
   page:  当前页
   pageSize: 每页条数
   onPage: 点击页码触发的回调函数名（字符串），接收目标页码参数
   opts: {id, showCount, label}
     id        容器 div 的 id（默认 paging_0）
     showCount 是否显示"第 X-Y 条，共 N 条"（默认 true）
     label     页面标签名，如 '订单'（默认 ''）
*/
/**
 * 构建统一分页组件 HTML，支持页码省略（超过7页时显示...）、计数信息和上一页/下一页按钮。
 * @param {number} total - 总记录数
 * @param {number} page - 当前页
 * @param {number} totalPages - 总页数
 * @param {string} [onPage] - 点击页码触发的回调函数名
 * @param {Object} [opts] - 配置 {id, showCount, label}
 * @returns {string} 分页组件 HTML 字符串
 */
function buildPaging(total,page,totalPages,onPage,opts){
  opts=opts||{};
  let id=opts.id||'paging_'+(onPage||'');
  let showCount=opts.showCount!==false;
  let label=opts.label||'';
  totalPages=Math.max(1,totalPages||Math.ceil(total/PAGE_SIZE));
  if(page>totalPages)page=totalPages;
  if(page<1)page=1;
  // 计数移到最左侧
  let start=(page-1)*PAGE_SIZE+1;
  let end=Math.min(page*PAGE_SIZE,total);
  let countStr=showCount&&total>0?'<span class="pg-info">共 <b>'+total+'</b> 条'+(totalPages>1?' · 第 '+start+'-'+end+' 条':'')+'</span>':'';
  start=(page-1)*PAGE_SIZE+1;
  end=Math.min(page*PAGE_SIZE,total);
  let fn=onPage||'page';
  let pages=[];
  // 页码按钮（最多显示 7 个，两端省略）
  if(totalPages<=7){
    for(let i=1;i<=totalPages;i++)pages.push(i);
  }else{
    pages.push(1);
    if(page>3)pages.push('…');
    for(let i=Math.max(2,page-1);i<=Math.min(totalPages-1,page+1);i++)pages.push(i);
    if(page<totalPages-2)pages.push('…');
    pages.push(totalPages);
  }
  let pageBtns=pages.map(function(p){
    if(p==='…')return'<span style="padding:0 4px;color:var(--gray)">…</span>';
    let cur=p===page?' style="background:var(--accent);color:#fff;border-color:var(--accent)"':' style="color:var(--accent)"';
    return'<button class="pg-btn"'+cur+' onclick="'+fn+'('+p+')">'+p+'</button>';
  }).join('');
  let prevBtn='<button class="pg-btn'+(page<=1?' pg-disabled':'')+'" onclick="'+fn+'('+(page-1)+')" title="上一页"'+(page<=1?' disabled':'')+'>'+icon('chevronLeft','13')+' 上一页</button>';
  let nextBtn='<button class="pg-btn'+(page>=totalPages?' pg-disabled':'')+'" onclick="'+fn+'('+(page+1)+')" title="下一页"'+(page>=totalPages?' disabled':'')+'>下一页 '+icon('chevronRight','13')+'</button>';
  
  return'<div id="'+id+'" class="paging-bar">'+
    prevBtn+
    pageBtns+
    nextBtn+
    countStr+
  '</div>';
}
