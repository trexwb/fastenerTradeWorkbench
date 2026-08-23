// views/keyboard.js — 全局键盘快捷键系统（v2.0 重构版）
/* =========================================================
   键盘快捷键 - 三层结构
   =========================================================
   ⌥ + 字母    → 全局导航（去哪个页面）
   ⌥ + ⇧ + 字母 → 页面动作（做什么，上下文相关）
   ⌘ + S       → 保存表单
   Esc         → 关闭弹窗/抽屉 / 返回列表
   /           → 聚焦搜索框
   ?           → 打开快捷键说明
   ⌥ + ← / →   → 切换子 Tab（结算页/发票页）
   ↑/↓/Enter   → combo 下拉导航（组件内）
   ========================================================= */

/* ---- 快捷键说明文本 ---- */
function getShortcutsHTML(){
  const global=
    '<div class="sc-group">'+
      '<div class="sc-ghd">🧭 全局导航（任何页面可用）</div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>H</kbd></span><span class="sc-desc">概览（Home）</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>O</kbd></span><span class="sc-desc">采购订单（Orders）</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>U</kbd></span><span class="sc-desc">关联单位（Units）</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>P</kbd></span><span class="sc-desc">签约管理（Prices）</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>B</kbd></span><span class="sc-desc">BOM 管理</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>A</kbd></span><span class="sc-desc">属性管理（Attributes）</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>S</kbd></span><span class="sc-desc">对账结算（Settlements）</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>I</kbd></span><span class="sc-desc">发票管理（Invoices）</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>D</kbd></span><span class="sc-desc">数据管理（Data）</span></div>'+
    '</div>'+
    '<div class="sc-group">'+
      '<div class="sc-ghd">⚡ 全局操作（任何页面可用）</div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌘</kbd> + <kbd>S</kbd></span><span class="sc-desc">保存当前抽屉/弹窗中的表单</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>Esc</kbd></span><span class="sc-desc">关闭抽屉/弹窗/快捷键说明 / 返回列表</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>/</kbd></span><span class="sc-desc">聚焦当前页面搜索框</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>?</kbd></span><span class="sc-desc">打开本快捷键说明</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>←</kbd></span><span class="sc-desc">结算/发票页：切换到上一个 Tab</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>→</kbd></span><span class="sc-desc">结算/发票页：切换到下一个 Tab</span></div>'+
    '</div>'+
    '<div class="sc-group">'+
      '<div class="sc-ghd">📋 采购订单页面</div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>⇧</kbd> + <kbd>N</kbd></span><span class="sc-desc">新建采购订单（列表页，非输入状态）</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>⇧</kbd> + <kbd>E</kbd></span><span class="sc-desc">编辑当前订单（详情页）</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>⇧</kbd> + <kbd>A</kbd></span><span class="sc-desc">添加产品（编辑页）</span></div>'+
    '</div>'+
    '<div class="sc-group">'+
      '<div class="sc-ghd">🏢 关联单位页面</div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>⇧</kbd> + <kbd>N</kbd></span><span class="sc-desc">新建关联单位（非输入状态）</span></div>'+
    '</div>'+
    '<div class="sc-group">'+
      '<div class="sc-ghd">💾 数据管理页面</div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>⇧</kbd> + <kbd>E</kbd></span><span class="sc-desc">导出 JSON 备份</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>⇧</kbd> + <kbd>I</kbd></span><span class="sc-desc">导入 JSON 备份</span></div>'+
      '<div class="sc-row"><span class="sc-keys"><kbd>⌥</kbd> + <kbd>⇧</kbd> + <kbd>S</kbd></span><span class="sc-desc">同步文件（File System Access）</span></div>'+
    '</div>'+
    '<div class="sc-note">💡 所有快捷键均在 ⬆ + 修饰键 层，避免与浏览器内置快捷键冲突。输入框内自动禁用 ⌥ 系列快捷键，不干扰正常输入。</div>';
  return '<div class="shortcuts-body">'+global+'</div>';
}

/* ---- 显示快捷键说明弹窗 ---- */
function showShortcutsModal(){
  const old=document.getElementById('_mask');
  if(old)old.remove();
  const m=document.createElement('div');
  m.className='mask';
  m.id='_mask';
  m.onclick=function(e){if(e.target===m)closeModal();};
  m.innerHTML='<div class="modal shortcuts-modal"><div class="mh">'+icon('keyboard','18')+' 键盘快捷键<button class="sc-close-btn" onclick="closeModal()" title="关闭">×</button></div><div class="mb">'+getShortcutsHTML()+'</div></div>';
  document.getElementById('app').appendChild(m);
}

/* ---- 判断当前焦点是否在表单输入元素中 ---- */
function isInInput(){
  const t=document.activeElement;
  if(!t)return false;
  const tn=t.tagName.toLowerCase();
  return tn==='input'||tn==='textarea'||tn==='select'||t.isContentEditable;
}

/* ---- 判断当前是否打开了抽屉或弹窗 ---- */
function hasOverlay(){
  return !!document.querySelector('.drawer-wrap,.mask#_mask');
}

/* ---- 获取当前视图对应的搜索框（支持直接聚焦） ---- */
function getSearchInput(){
  const active=document.activeElement;
  if(active&&active.closest&&active.closest('.search-box')){
    const inp=active.closest('.search-box').querySelector('input[type=text],input[type="text"]');
    if(inp)return inp;
  }
  switch(view){
    case 'units':    return document.getElementById('unitSearchInput');
    case 'prices':   return document.getElementById('pf_sku');
    case 'bom':      return document.getElementById('bomSearchInput');
    case 'orders':
      if(curOrder||curOrderView)return null;
      return document.getElementById('orderSearchInput');
    case 'settle-receipt':
    case 'settle-payment':
    case 'settlements': return document.getElementById('settleSearchInput');
    case 'inv-issue':
    case 'inv-receive':
    case 'invoices':  return document.getElementById('invSearchInput');
    default:          return null;
  }
}

/* ---- 辅助：执行页面导航（统一入口） ---- */
function kbdNav(target){
  if(typeof go==='function'){
    go(target);
  }
}

/* ---- 全局键盘事件处理 ---- */
document.addEventListener('keydown',function(e){
  const meta=e.metaKey;    // ⌘
  const alt=e.altKey;      // ⌥
  const shift=e.shiftKey;  // ⇧
  const ctrl=e.ctrlKey;    // ⌃
  const key=e.key;
  const inp=isInInput();

  /* =====================================================
     第一优先级：Esc — 关闭弹窗/抽屉，返回订单列表
     ===================================================== */
  if(key==='Escape'){
    // 优先关闭抽屉
    if(document.querySelector('.drawer-wrap')){
      if(typeof safeCloseDrawer==='function'){
        safeCloseDrawer();
      } else {
        if(typeof closeDrawer==='function')closeDrawer();
      }
      return;
    }
    // 关闭弹窗
    if(document.getElementById('_mask')){
      if(typeof closeModal==='function')closeModal();
      return;
    }
    // 订单详情/编辑页：Esc → 返回列表
    if(view==='orders'&&(curOrderView||curOrder)){
      kbdNav('orders');
      return;
    }
    return;
  }

  /* =====================================================
     第二优先级：⌘+S 保存（输入框内也触发）
     ===================================================== */
  if(meta && !alt && !shift && !ctrl && key==='s'){
    e.preventDefault();
    if(typeof drawerOk==='function'&&document.querySelector('.drawer-wrap')){
      drawerOk();
    }
    return;
  }

  /* =====================================================
     输入框内：忽略所有 ⌥ 系列快捷键（避免干扰输入法）
     ===================================================== */
  if(inp){
    // 输入框内 `/` 和 `?` 也透传给输入框
    return;
  }

  /* =====================================================
     ⌥ + 字母：全局导航（非输入状态）
     ===================================================== */
  if(alt && !meta && !ctrl && !shift){
    switch(key.toLowerCase()){
      case 'h': e.preventDefault();kbdNav('dashboard');return;
      case 'o': e.preventDefault();kbdNav('orders');return;
      case 'u': e.preventDefault();kbdNav('units');return;
      case 'p': e.preventDefault();kbdNav('prices');return;
      case 'b': e.preventDefault();kbdNav('bom');return;
      case 'a': e.preventDefault();kbdNav('specs');return;
      case 's': e.preventDefault();kbdNav('settlements');return;
      case 'i': e.preventDefault();kbdNav('invoices');return;
      case 'd': e.preventDefault();kbdNav('data');return;
    }
    return;
  }

  /* =====================================================
     ⌥ + ⇧ + 字母：页面动作（上下文相关，非输入状态）
     ===================================================== */
  if(alt && !meta && !ctrl && shift){
    switch(key.toLowerCase()){
      // 新建：订单列表页→新建订单，单位页→新建单位
      case 'n':
        e.preventDefault();
        if(view==='orders'&&!curOrder&&!curOrderView&&typeof newOrder==='function'){
          newOrder();
        }else if(view==='units'&&typeof newUnit==='function'){
          newUnit();
        }
        return;
      // 编辑订单（详情页）/ 导出 JSON（数据页）
      case 'e':
        e.preventDefault();
        if(view==='orders'&&curOrderView&&typeof goOrderEdit==='function'){
          goOrderEdit(curOrderView);
        }else if(view==='data'&&typeof exportJSON==='function'){
          exportJSON();
        }
        return;
      // 添加产品（订单编辑页）
      case 'a':
        e.preventDefault();
        if(view==='orders'&&curOrder&&typeof addItem==='function'){
          addItem();
        }
        return;
      // 导入 JSON（数据页）
      case 'i':
        e.preventDefault();
        if(view==='data'){
          const fi=document.getElementById('importFileInput');
          if(fi)fi.click();
        }
        return;
      // 同步文件（数据页）
      case 's':
        e.preventDefault();
        if(view==='data'&&typeof syncNow==='function'){
          syncNow();
        }
        return;
    }
    return;
  }

  /* =====================================================
     ⌥ + ← / ⌥ + →：子 Tab 切换（结算页/发票页）
     ===================================================== */
  if(alt && !meta && !ctrl && !shift && (key==='ArrowLeft'||key==='ArrowRight')){
    e.preventDefault();
    if(key==='ArrowLeft'){
      // 切换到上一个 Tab
      switch(view){
        case 'settle-payment': kbdNav('settle-receipt');return;
        case 'inv-receive': kbdNav('inv-issue');return;
      }
    }else{
      // 切换到下一个 Tab
      switch(view){
        case 'settlements':
        case 'settle-receipt': kbdNav('settle-payment');return;
        case 'invoices':
        case 'inv-issue': kbdNav('inv-receive');return;
      }
    }
    return;
  }

  /* =====================================================
     ? 打开快捷键说明（非输入状态）
     ===================================================== */
  if(key==='?'&&!hasOverlay()){
    e.preventDefault();
    if(typeof showShortcutsModal==='function')showShortcutsModal();
    return;
  }

  /* =====================================================
     / 聚焦搜索框
     ===================================================== */
  if(key==='/'){
    e.preventDefault();
    const si=getSearchInput();
    if(si){si.focus();si.select();}
    return;
  }

  /* 搜索框内 Enter 兜底触发搜索 */
  if(key==='Enter'){
    const inp2=document.activeElement;
    if(inp2&&inp2.closest&&inp2.closest('.search-box')){
      const sb=inp2.closest('.search-box');
      const a=sb.querySelector('a[onclick]');
      if(a){
        e.preventDefault();
        const onclick=a.getAttribute('onclick');
        const m=onclick.match(/on[A-Z][a-zA-Z]+\(['"`]([^'"`]+)['"`]/);
        if(m){
          const fn=m[1];
          if(typeof window[fn]==='function')window[fn](inp2.value||'');
        }
        return;
      }
    }
  }
});