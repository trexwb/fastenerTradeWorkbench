// guide.js — ⚠ 自 2026-08-29 起已降级为「空壳适配器」
/* =========================================================
   历史说明：
   本文件原为「横幅型首次引导」系统（键 wb_fastener_guide_<module>，DOM 类 .module-guide）。
   随后在 router.js 中引入了更精细的「Coach 全屏蒙层分步引导」
   （键 wb_fastener_coach_seen_<module>，DOM 类 .coach-overlay），
   覆盖全部 11 个功能模块。两套系统并行导致用户进入同一模块时需要
   「先跳过 Coach 蒙层 + 再关闭横幅」= 体感关闭两次。

   修复方案（2026-08-29）：
   1. App.vue SCRIPTS 数组移除本文件入口（不再间接 eval 执行本文件）
   2. 本文件保留为空壳适配器，仅做三件事：
      · 兼容旧代码中 onclick="dismissModuleGuide(...)" 的按钮引用，防止控制台报错
      · 当用户调用 dismissModuleGuide() 时，把旧横幅 key 同步写入，避免未来恢复横幅系统时又出来
      · 暴露 window.__MAYBE_SHOW_MODULE_GUIDE_DISABLED__ = true 作为哨兵，
        让 App.vue / router.js 可以检测到 guide.js 已被加载但不应使用
   3. 引导统一入口：router.render() → window.__maybeShowModuleGuide → Coach.show(view)
      （Coach 系统位于 src/core/router.js IIFE 内，带 6 道去重/幂等/漏网防线）
   ========================================================= */

(function(){
  // —— 唯一命名空间（原样保留，与旧写入的 localStorage key 保持一致）——
  const _GUIDE_KEY_PREFIX = 'wb_fastener_guide_';
  const _GUIDE_PARENT = {
    'settle-receipt':'settlements','settle-payment':'settlements',
    'inv-issue':'invoices','inv-receive':'invoices',
  };

  /**
   * 兼容旧 onclick="dismissModuleGuide(...)"（旧横幅按钮仍可能存在于已分发的
   * 历史单文件版 HTML 中；此处仅写 localStorage + 移除 DOM，避免报错）
   */
  window.dismissModuleGuide = function(key, runAction){
    try{
      const k = _GUIDE_PARENT[key] || key;
      if(k) localStorage.setItem(_GUIDE_KEY_PREFIX + k, '1');
    }catch(e){}
    const el = document.querySelector('.module-guide');
    if(el){
      try{el.style.transition='opacity .18s,transform .18s';el.style.opacity='0';el.style.transform='translateY(-8px)';}catch(_){}
      setTimeout(function(){try{el.remove();}catch(_){}}, 180);
    }
    if(runAction && typeof runAction === 'function'){
      try{ setTimeout(runAction, 200); }catch(e){}
    }
  };

  /**
   * 强制不再使用横幅引导。老的 loader / router 如果仍想调
   * window.__maybeShowModuleGuide（原横幅版），会被这个空函数短路吞掉，
   * 真正生效的只剩 router.js 末尾挂的 Coach 版。
   */
  window.__maybeShowModuleGuide = function(){ /* 禁用：统一走 Coach */ };
  try{ window.__MAYBE_SHOW_MODULE_GUIDE_DISABLED__ = true; }catch(e){}
})();
