// ui.js — Modal / Drawer
/**
 * 抽屉关闭动画时长（毫秒），用于 closeDrawer 延迟移除 DOM 以避免动画被截断。
 * @type {number}
 */
const DRAWER_CLOSE_DELAY=320;
/* =========================================================
   Modal / Drawer
   ========================================================= */
let _modalReturnFocus=null;
let _drawerReturnFocus=null;
let _dialogSeq=0;
/** 收集容器内可聚焦元素（排除隐藏/禁用） */
function _dialogFocusables(root){
  return Array.from(root.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(el=>
    !el.disabled&&el.tabIndex!==-1&&el.getClientRects().length>0
  );
}
/** Tab / Shift+Tab 在对话框内循环，防止焦点进入背景页面 */
function _trapDialogFocus(e,root){
  if(e.key!=='Tab')return;
  const list=_dialogFocusables(root);
  if(!list.length){e.preventDefault();return;}
  const first=list[0],last=list[list.length-1],active=document.activeElement;
  if(!root.contains(active)){e.preventDefault();first.focus();return;}
  if(e.shiftKey&&active===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&active===last){e.preventDefault();first.focus();}
}
/** 打开对话框后优先聚焦首个表单控件，否则聚焦第一个可交互元素 */
function _focusDialog(root,fallback){
  const field=Array.from(root.querySelectorAll('input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled])')).find(el=>el.getClientRects().length>0);
  const list=_dialogFocusables(root);
  const target=field||(fallback&&fallback.getClientRects().length?fallback:list[0]);
  if(target&&typeof target.focus==='function')target.focus();
}
/** 关闭后归还焦点；目标已随抽屉关闭而隐藏时跳过 */
function _restoreFocus(el){
  if(!el||!el.isConnected||typeof el.focus!=='function')return;
  const closing=el.closest&&el.closest('.drawer-panel');
  if(closing&&!closing.classList.contains('open'))return;
  try{el.focus();}catch(e){}
}
/**
 * 弹出通用模态对话框（标题 + 内容 + 底部按钮）。
 * 支持最多 3 个按钮：取消（次）+ 确定（主）+ 额外按钮（extra，位于确定按钮左侧，用于"第三选择"如导入/重置）。
 * @param {string} title - 弹窗标题
 * @param {string|HTMLElement} body - 弹窗主体（HTML 字符串或 DOM 元素）
 * @param {string} okText - 主按钮（primary）文字
 * @param {Function} onOk - 主按钮点击回调（自动先关闭弹窗再执行）
 * @param {boolean|string} [wideOrExtra] - 兼容旧签名：boolean 时视为 wide（宽版）；string 时视为 extraBtn 文案
 * @param {Function|boolean} [extraOnOkOrWide] - 兼容旧签名：Function 时视为 extraBtn 回调；boolean 时视为 wide
 * @param {boolean} [_wide] - 兜底：显式 wide 标志
 * @returns {void} 无返回值
 */
function modal(title,body,okText,onOk,wideOrExtra,extraOnOkOrWide,_wide){
  /* 兼容旧签名 5 参数：modal(title,body,okText,onOk,wide) */
  let extraBtn='',extraOnOk=null,wide=false;
  if(typeof wideOrExtra==='boolean'){wide=wideOrExtra;}
  else if(typeof wideOrExtra==='string'){
    extraBtn=wideOrExtra;
    if(typeof extraOnOkOrWide==='function'){extraOnOk=extraOnOkOrWide;}
    if(typeof extraOnOkOrWide==='boolean'){wide=extraOnOkOrWide;}
    if(typeof _wide==='boolean'){wide=_wide;}
  }
  const w=wide?'wide':'';
  /* 先移除已存在的旧弹窗，避免重复打开时 getElementById 命中旧元素 */
  const oldMask=document.getElementById('_mask');
  if(!oldMask)_modalReturnFocus=document.activeElement;
  if(oldMask)oldMask.remove();
  const m=document.createElement('div');
  m.className='mask';m.id='_mask';
  // 禁止点击遮罩层关闭 Dialog：避免误触背景导致表单内容丢失，仅能通过按钮/右上角 X 关闭
  const extraHtml=(extraBtn&&extraOnOk)?'<button type="button" class="btn extra" id="_modalExtra">'+escHtml(extraBtn)+'</button>':'';
  /* v1.0.28：主按钮为「关闭」语义时（纯关弹窗无副作用，如设置弹窗、知识库原文）不渲染取消按钮，避免冗余双按钮 */
  const cancelHtml=(okText==='关闭')?'':'<button type="button" class="btn" id="_modalCancel">取消</button>';
  const titleId='_dlgTitle'+(++_dialogSeq);
  m.innerHTML='<div class="modal '+w+'" role="dialog" aria-modal="true" aria-labelledby="'+titleId+'"><div class="mh"><span class="mt" id="'+titleId+'">'+escHtml(title||'')+'</span><button type="button" class="x" aria-label="关闭" onclick="closeModal()">×</button></div><div class="mb"></div><div class="mf">'+cancelHtml+extraHtml+'<button type="button" class="btn primary" id="_modalOk">'+escHtml(okText||'确定')+'</button></div></div>';
  const mb=m.querySelector('.mb');
  if(body instanceof Element){mb.appendChild(body);}
  else{mb.innerHTML=body||'';}
  document.getElementById('app').appendChild(m);
  if(typeof associateFormLabels==='function')associateFormLabels(m);
  m.addEventListener('keydown',function(e){
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeModal();return;}
    _trapDialogFocus(e,m.querySelector('.modal'));
  });
  requestAnimationFrame(function(){_focusDialog(mb,m.querySelector('.mh .x'));});
  // 2026-08-29 关键修复：先执行 onOk 回调（它里面要读 modal body 里的 DOM），
  // 再关闭弹窗。旧写法 closeModal() 在 onOk() 前面，导致 AI 设置弹窗里
  // document.getElementById('aiDeepseekToken') 拿到 null → 永远保存不到 Key。
  // 各 modal 的 onOk 内部已经会自行调 closeModal()，这里的 closeModal 只是兜底。
  document.getElementById('_modalOk').onclick=()=>{
    /* 防双击：async onOk 未决期间禁用确定键，避免重复执行写回调（§12.5 重复触发防护） */
    const okBtn=document.getElementById('_modalOk');
    if(okBtn&&okBtn.disabled)return;
    if(onOk){
      try{
        const r=onOk();
        if(r&&typeof r.then==='function'){if(okBtn)okBtn.disabled=true;r.then(()=>{closeModal();}).catch(()=>{const b=document.getElementById('_modalOk');if(b)b.disabled=false;});return;}
        /* v1.0.57 修复：onOk 显式返回 false 表示校验失败需留在弹窗（如价格库匹配未勾选、
           手动供应商必填缺失），不再执行兜底 closeModal——旧逻辑同步返回后无条件关窗，
           校验提示随弹窗一起销毁、已填输入全部丢失 */
        if(r===false)return;
      }catch(e){
        /* 2026-10-29 审计修复：onOk 同步抛错不再静默吞掉后关窗（用户会误以为已保存成功），改为提示并留在弹窗 */
        toast('操作失败：'+((e&&e.message)||e),'error');
        return;
      }
    }
    closeModal();
  };
  /* v1.0.28 修复：取消按钮未绑 onclick，导致设置等弹窗点"取消"无反应。modal() 无 onCancel 形参，取消即关闭弹窗（与 confirmModal 行为一致） */
  const cn=document.getElementById('_modalCancel');
  if(cn)cn.onclick=()=>{closeModal();};
  const ex=document.getElementById('_modalExtra');
  if(ex&&extraOnOk){ex.onclick=()=>{closeModal();extraOnOk();};}
  m.scrollIntoView();
}
/**
 * 关闭并移除当前模态对话框。
 * @returns {void} 无返回值
 */
function closeModal(){
  const m=document.getElementById('_mask');
  if(m)m.remove();
  const target=_modalReturnFocus;
  _modalReturnFocus=null;
  _restoreFocus(target);
}
/**
 * 弹出确认对话框（含确认/取消按钮，自动清理旧弹窗避免嵌套冲突）。
 * @param {string} msg - 确认提示文案
 * @param {Function} onOk - 点击确认按钮回调
 * @param {string} [okText='确认操作'] - 确认按钮文字
 * @param {string} [cancelText='取消'] - 取消按钮文字
 * @param {Function} [onCancel] - 点击取消按钮回调
 * @param {boolean} [html=false] - 是否以 HTML 渲染 msg（默认纯文本转义）；仅可信内容可传 true
 * @returns {void} 无返回值
 */
function confirmModal(msg,onOk,okText,cancelText,onCancel,html){
  /* 先移除已有的同 ID 弹窗，避免嵌套确认时 getElementById 拿到旧元素 */
  const old=document.getElementById('_mask');
  if(!old)_modalReturnFocus=document.activeElement;
  if(old)old.remove();
  /* msg 默认按纯文本转义渲染（white-space:pre-line 保证纯文本调用里的 \n 正确换行）；
     仅调用方显式传入 html=true 且内容已自行 escHtml 或为可信静态模板时，才按 HTML 渲染 */
  const safeMsg=html?String(msg):escHtml(String(msg));
  const titleId='_dlgTitle'+(++_dialogSeq);
  const msgId='_dlgMsg'+_dialogSeq;
  document.getElementById('app').insertAdjacentHTML('beforeend','<div class="mask" id="_mask"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="'+titleId+'" aria-describedby="'+msgId+'"><div class="mh"><span class="mt" id="'+titleId+'">'+escHtml(okText||'确认操作')+'</span><button type="button" class="x" aria-label="关闭" onclick="(function(){var c=document.getElementById(\'_modalCancel\');if(c)c.click();else if(typeof closeModal===\'function\')closeModal();})()">×</button></div><div class="mb"><p id="'+msgId+'" style="font-size:14px;line-height:1.7;white-space:pre-line">'+safeMsg+'</p></div><div class="mf"><button type="button" class="btn" id="_modalCancel" tabindex="998">'+escHtml(cancelText||'取消')+'</button><button type="button" class="btn danger" id="_modalOk" tabindex="999">'+escHtml(okText||'确认')+'</button></div></div></div>');
  const mask=document.getElementById('_mask');
  mask.addEventListener('keydown',function(e){
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();const c=document.getElementById('_modalCancel');if(c)c.click();else closeModal();return;}
    _trapDialogFocus(e,mask.querySelector('.modal'));
  });
  requestAnimationFrame(function(){const c=document.getElementById('_modalCancel')||document.getElementById('_modalOk');if(c)c.focus();});
  document.getElementById('_modalOk').onclick=()=>{
    // confirmModal 的 onOk 也可能需要读 DOM 或 async，与 modal() 同样处理
    if(onOk){
      try{
        /* 防双击：async onOk 未决期间禁用确定键，删除/导入/解绑等破坏性确认不重复执行 */
        const okBtn=document.getElementById('_modalOk');
        if(okBtn&&okBtn.disabled)return;
        const before=document.getElementById('_mask');
        const r=onOk();
        if(r&&typeof r.then==='function'){if(okBtn)okBtn.disabled=true;r.then(()=>{closeModal();}).catch(()=>{const b=document.getElementById('_modalOk');if(b)b.disabled=false;});return;}
        // 嵌套确认：onOk 内部又弹了新的 confirmModal（_mask 已被重建）时，保持新弹窗，不再执行收尾关闭
        const after=document.getElementById('_mask');
        if(after&&after!==before){return;}
      }catch(e){
        /* 2026-10-29 审计修复：onOk 同步抛错不再静默吞掉后关窗（用户会误以为已确认成功），改为提示并留在弹窗 */
        toast('操作失败：'+((e&&e.message)||e),'error');
        return;
      }
    }
    closeModal();
  };
  document.getElementById('_modalCancel').onclick=()=>{closeModal();if(onCancel)onCancel();};
}

let _drawerOnOk=null;
/** 是否处于有未保存数据的抽屉中（由 BOM/报价等模块标记） */
let _drawerDirty=false;
/** 标记当前抽屉为有未保存输入状态 */
function markDrawerDirty(){_drawerDirty=true;}
/** 关闭抽屉前检查未保存状态，防止误关丢失输入
 * @param {boolean} [force=false] - 强制关闭，跳过确认
 */
function safeCloseDrawer(force){
  // 如果确认弹窗已打开（如用户在确认关闭对话框中再次点击关闭），不重复弹确认
  if(document.getElementById('_mask')){return;}
  if(force||!_drawerDirty){_drawerDirty=false;closeDrawer();return;}
  confirmModal('表单有未保存的内容，关闭将丢失。确定要关闭吗？',
    function(){
      _drawerDirty=false;
      closeDrawer();
      toast('已放弃修改','info');
    },'确认关闭','继续编辑'
  );
}
/**
 * 从右侧滑出抽屉面板。
 * @param {string} title - 抽屉标题
 * @param {string} html - 抽屉主体 HTML
 * @param {Function} [onOk] - 点击保存回调（绑定到 drawerOk）
 * @param {boolean} [wide] - 是否宽版
 * @param {boolean} [noFooter] - 是否隐藏底部按钮
 * @returns {void} 无返回值
 */
function openDrawer(title,html,onOk,wide,noFooter){
  _drawerOnOk=onOk||null;
  const w=wide?'wide':'';
  /* 先移除旧的抽屉实例，避免多次打开时抽屉叠加/状态错乱 */
  const oldWrap=document.querySelector('.drawer-wrap');
  if(!oldWrap)_drawerReturnFocus=document.activeElement;
  if(oldWrap)oldWrap.remove();
  const overlay=document.createElement('div');
  overlay.className='drawer-overlay';
  overlay.onclick=function(){safeCloseDrawer();};
  const panel=document.createElement('div');
  panel.className='drawer-panel '+w;
  const titleId='_dlgTitle'+(++_dialogSeq);
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-labelledby',titleId);
  panel.innerHTML='<div class="drawer-hd"><span class="drawer-ttl" id="'+titleId+'">'+escHtml(title||'')+'</span><button type="button" class="drawer-x" aria-label="关闭" onclick="safeCloseDrawer()">×</button></div><div class="drawer-bd">'+html+'</div>'+(noFooter?'':'<div class="drawer-ft"><button type="button" class="btn" onclick="safeCloseDrawer()" tabindex="998">取消</button><button type="button" class="btn primary" id="_drawerOk" onclick="drawerOk()" tabindex="999">保存</button></div>');
  const wrap=document.createElement('div');
  wrap.className='drawer-wrap';
  wrap.appendChild(overlay);
  wrap.appendChild(panel);
  document.getElementById('app').appendChild(wrap);
  if(typeof associateFormLabels==='function')associateFormLabels(panel);
  panel.addEventListener('keydown',function(e){
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();safeCloseDrawer();return;}
    _trapDialogFocus(e,panel);
  });
  requestAnimationFrame(()=>{overlay.classList.add('on');panel.classList.add('open');_focusDialog(panel,panel.querySelector('.drawer-x'));});
  document.body.style.overflow='hidden';
}
/**
 * 关闭抽屉面板（带动画延迟移除）。
 * @returns {void} 无返回值
 */
function closeDrawer(){
  const wrap=document.querySelector('.drawer-wrap');
  if(!wrap)return;
  const panel=wrap.querySelector('.drawer-panel');
  const overlay=wrap.querySelector('.drawer-overlay');
  panel.classList.remove('open');overlay.classList.remove('on');
  setTimeout(()=>wrap.remove(),DRAWER_CLOSE_DELAY);
  document.body.style.overflow='';
  _drawerOnOk=null;
  const target=_drawerReturnFocus;
  _drawerReturnFocus=null;
  _restoreFocus(target);
  /* v1.0.57 修复：AI 写入成功/计划创建后若抽屉打开中会推迟 render（避免渲染销毁抽屉连撤销条一起丢），
     此处在抽屉真正关闭后补一次背景刷新 */
  if(window._pendingRenderOnDrawerClose){
    window._pendingRenderOnDrawerClose=false;
    if(typeof render==='function')render();
  }
}
/**
 * 触发抽屉面板的保存回调。
 * @returns {void} 无返回值
 */
function drawerOk(){
  const okBtn=document.getElementById('_drawerOk');
  if(okBtn&&okBtn.disabled)return; // 防双击：async onOk 未决期间忽略重复点击
  if(!_drawerOnOk)return;
  _drawerDirty=false; // 保存路径先标记为干净，避免保存成功后 closeDrawer 触发二次确认
  const r=_drawerOnOk();
  /* async onOk：未决期间禁用保存键防重复提交；关闭抽屉仍由 onOk 自行负责，
     Promise settle 后恢复按钮（抽屉已关则按钮已随 DOM 移除，为空操作） */
  if(r&&typeof r.then==='function'&&okBtn){
    okBtn.disabled=true;
    r.then(
      /* 2026-10-29 审计修复：onOk 失败（resolve false / reject）留在抽屉时恢复未保存标记，
         否则此后 Esc/点遮罩直接关闭、「未保存提醒」失效导致已填输入丢失 */
      function(v){if(v===false)_drawerDirty=true;const b=document.getElementById('_drawerOk');if(b)b.disabled=false;},
      function(){_drawerDirty=true;const b=document.getElementById('_drawerOk');if(b)b.disabled=false;}
    );
    return;
  }
  /* 同步 onOk 返回 false 同为校验失败留在抽屉：恢复未保存标记 */
  if(r===false)_drawerDirty=true;
}

