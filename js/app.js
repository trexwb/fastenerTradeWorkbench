// app.js — 入口：window 挂载 + 启动
/* 全局函数自动挂载：所有 function 声明在普通 script 中即为 window 属性 */
/* =========================================================
   初始化
   ========================================================= */
/** 恢复主题偏好 — 从 localStorage 读取并应用保存的主题 */
(function(){
  try{let t=localStorage.getItem('fw_theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}
})();
/* 显示加载状态，等待 IndexedDB 异步加载 */
document.getElementById('app').innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px"><div class="spin" style="width:32px;height:32px;border:3px solid var(--line);border-top-color:var(--pri);border-radius:50%;animation:spin 1s linear infinite"></div><div style="color:var(--gray);font-size:14px">正在加载数据...</div></div>';
initApp();

/* =========================================================
   Hash 路由恢复（刷新后保持页面状态）
   ========================================================= */
/**
 * initApp 回调：数据加载完成后，恢复 URL hash 指定的视图
 */
function onAppReady(){
  // 如果有 hash，恢复视图状态
  if(window.location.hash && window.location.hash.length > 2){
    restoreFromHash();
  }
  render();
}

