// ui.js — Modal / Drawer
/**
 * drawer 关闭动画时长(ms)，用于 closeDrawer 延迟移除 DOM 以避免动画被截断。
 * @type {number}
 */
/**
 * 抽屉关闭动画时长（毫秒）
 * @type {number}
 */
const DRAWER_CLOSE_DELAY=320;
/* =========================================================
   Modal / Drawer
   ========================================================= */
/**
 * 弹出模态对话框。
 * @param {string} title - 弹窗标题
 * @param {string|Element} body - 弹窗内容（HTML 字符串或 DOM 元素）
 * @param {string} [okText='确定'] - 确认按钮文字
 * @param {Function} [onOk] - 点击确认按钮的回调
 * @param {boolean} [wide] - 是否使用宽版样式
 * @returns {void} 无返回值
 */
function modal(title,body,okText,onOk,wide){
  const w=wide?'wide':'';
  const m=document.createElement('div');
  m.className='mask';m.id='_mask';
  m.onclick=function(e){if(e.target===m)closeModal();};
  m.innerHTML='<div class="modal '+w+'"><div class="mh">'+escHtml(title||'')+'<span class="x" onclick="closeModal()">×</span></div><div class="mb"></div><div class="mf"><button type="button" class="btn" onclick="closeModal()">取消</button><button type="button" class="btn primary" id="_modalOk">'+escHtml(okText||'确定')+'</button></div></div>';
  const mb=m.querySelector('.mb');
  if(body instanceof Element){mb.appendChild(body);}
  else{mb.innerHTML=body||'';}
  document.getElementById('app').appendChild(m);
  document.getElementById('_modalOk').onclick=onOk;
  m.scrollIntoView();
}
/**
 * 关闭并移除当前模态对话框。
 * @returns {void} 无返回值
 */
function closeModal(){const m=document.getElementById('_mask');if(m)m.remove();}
/**
 * 弹出确认对话框（含确认/取消按钮，自动清理旧弹窗避免嵌套冲突）。
 * @param {string} msg - 确认提示文案
 * @param {Function} onOk - 点击确认按钮回调
 * @param {string} [okText='确认操作'] - 确认按钮文字
 * @param {string} [cancelText='取消'] - 取消按钮文字
 * @param {Function} [onCancel] - 点击取消按钮回调
 * @returns {void} 无返回值
 */
function confirmModal(msg,onOk,okText,cancelText,onCancel){
  /* 先移除已有的同 ID 弹窗，避免嵌套确认时 getElementById 拿到旧元素 */
  const old=document.getElementById('_mask');
  if(old)old.remove();
  /* msg 契约为 HTML 字符串：含用户数据的调用方必须自行 escHtml（white-space:pre-line 使纯文本调用的 \n 正确换行） */
  document.getElementById('app').insertAdjacentHTML('beforeend','<div class="mask" id="_mask" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="mh">'+escHtml(okText||'确认操作')+'<span class="x" onclick="closeModal()">×</span></div><div class="mb"><p style="font-size:14px;line-height:1.7;white-space:pre-line">'+msg+'</p></div><div class="mf"><button type="button" class="btn" id="_modalCancel" tabindex="998">'+escHtml(cancelText||'取消')+'</button><button type="button" class="btn danger" id="_modalOk" tabindex="999">'+escHtml(okText||'确认')+'</button></div></div></div>');
  document.getElementById('_modalOk').onclick=onOk;
  document.getElementById('_modalCancel').onclick=()=>{if(onCancel)onCancel();closeModal();};
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
  const overlay=document.createElement('div');
  overlay.className='drawer-overlay';
  overlay.onclick=function(){safeCloseDrawer();};
  const panel=document.createElement('div');
  panel.className='drawer-panel '+w;
  panel.innerHTML='<div class="drawer-hd"><span class="drawer-ttl">'+escHtml(title||'')+'</span><span class="drawer-x" onclick="safeCloseDrawer()">×</span></div><div class="drawer-bd">'+html+'</div>'+(noFooter?'':'<div class="drawer-ft"><button type="button" class="btn" onclick="safeCloseDrawer()" tabindex="998">取消</button><button type="button" class="btn primary" onclick="drawerOk()" tabindex="999">保存</button></div>');
  const wrap=document.createElement('div');
  wrap.className='drawer-wrap';
  wrap.appendChild(overlay);
  wrap.appendChild(panel);
  document.getElementById('app').appendChild(wrap);
  requestAnimationFrame(()=>{overlay.classList.add('on');panel.classList.add('open');});
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
}
/**
 * 触发抽屉面板的保存回调。
 * @returns {void} 无返回值
 */
function drawerOk(){
  _drawerDirty=false; // 保存前标记为干净，避免保存成功后 closeDrawer 触发二次确认
  if(_drawerOnOk)_drawerOnOk();
}

