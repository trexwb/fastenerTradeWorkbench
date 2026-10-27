/* ═══════════════════════════════════════════════════════════════════
   wiki.js — 专业解读（本地互动文档）视图
   ───────────────────────────────────────────────────────────────────
   文档来源：src/public/wiki/*.html → 构建后位于 dist/wiki/*.html
             （单文件、零外部依赖，构建时原样复制，不参与打包编译）
   索引来源：src/public/wiki/index.js（由 scripts/gen-wiki-index.mjs 生成）
             通过「动态 <script> 注入」加载，而非 fetch ——
             file:// 双击运行时页面 origin 为 null，fetch 本地文件会被 CORS 拦截，
             而 <script src> 不受该限制（与 core/exporter.js 加载 vendor/xlsx.min.js 同策略）。
   展示方式：iframe 内嵌，保留文档自身排版/主题/交互，不做任何内联改写。
             新增文档只需把 .html 丢进 src/public/wiki/，索引自动重建。
   ═══════════════════════════════════════════════════════════════════ */

/** 当前打开的文档文件名（null = 列表态） */
let _wikiDoc = null;
/** 索引数据缓存（window.__WIKI_INDEX 的引用） */
let _wikiIndex = null;
/** 索引加载状态：idle | loading | ready | error */
let _wikiState = 'idle';
/** 索引加载中的等待回调队列 */
let _wikiWaiters = [];

/**
 * 拼接文档（或索引）的绝对 URL。
 * 以 document.baseURI 为基准：dev 为 http://localhost:1421/，构建后为 dist 目录
 * （file:// / github pages 子路径 / tauri.localhost 均由 baseURI 自然适配）。
 * @param {string} file - 相对 src/public/wiki 的文件名
 * @returns {string} 可直接用于 iframe src / script src 的绝对 URL
 */
function _wikiUrl(file){
  try{ return new URL('wiki/'+encodeURI(file), document.baseURI).href; }
  catch(e){ return 'wiki/'+encodeURI(file); }
}

/**
 * 把文件名编码为安全的内联事件参数（纯 ASCII，规避中文/空格/引号破坏 HTML 属性）。
 * @param {string} file - 原始文件名
 * @returns {string} 形如 '17-4ph-fastener.html' 的安全字面量（含外层单引号）
 */
function _wikiAttr(file){
  return "'"+encodeURIComponent(String(file)).replace(/'/g,'%27')+"'";
}

/**
 * 加载文档索引（幂等，可并发调用）。
 * @param {Function} [cb] - 加载完成回调（失败也会回调，由调用方按 _wikiState 判断）
 * @returns {void}
 */
function loadWikiIndex(cb){
  if(_wikiIndex){
    if(cb)cb();
    return;
  }
  if(_wikiState==='loading'){
    if(cb)_wikiWaiters.push(cb);
    return;
  }
  if(cb)_wikiWaiters.push(cb);
  _wikiState='loading';

  let done=false;
  const finish=function(ok){
    if(done)return;
    done=true;
    _wikiIndex=(window.__WIKI_INDEX && Array.isArray(window.__WIKI_INDEX.docs))
      ? window.__WIKI_INDEX
      : {docs:[],count:0};
    _wikiState=ok?'ready':'error';
    const waiters=_wikiWaiters.slice();
    _wikiWaiters=[];
    waiters.forEach(function(fn){try{fn();}catch(e){}});
  };

  const s=document.createElement('script');
  s.src=_wikiUrl('index.js');
  s.async=true;
  s.onload=function(){finish(true);};
  s.onerror=function(){finish(false);};
  document.head.appendChild(s);
}

/**
 * 重置为列表态（切换导航离开本模块时由 router 的 go() 调用）。
 * @returns {void}
 */
function __wikiReset(){ _wikiDoc=null; }

/**
 * 打开指定文档。
 * @param {string} key - encodeURIComponent 后的文件名（见 _wikiAttr）
 * @returns {void}
 */
function openWikiDoc(key){
  let file=String(key||'');
  try{ file=decodeURIComponent(file); }catch(e){}
  if(!file)return;
  _wikiDoc=file;
  render();
  window.scrollTo(0,0);
}

/**
 * 关闭文档，回到列表。
 * @returns {void}
 */
function closeWikiDoc(){ _wikiDoc=null; render(); }

/**
 * 复制文档的绝对链接（file:// 下 navigator.clipboard 可能不可用，降级 execCommand）。
 * @param {string} key - encodeURIComponent 后的文件名
 * @returns {void}
 */
function copyWikiLink(key){
  let file=String(key||'');
  try{ file=decodeURIComponent(file); }catch(e){}
  const url=_wikiUrl(file);
  const done=function(){ if(typeof toast==='function')toast('链接已复制','ok'); };
  const fail=function(){ if(typeof toast==='function')toast('复制失败，请手动选择地址栏链接','err'); };
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done).catch(fallback);
      return;
    }
  }catch(e){}
  fallback();

  function fallback(){
    try{
      const ta=document.createElement('textarea');
      ta.value=url;
      ta.style.position='fixed';
      ta.style.opacity='0';
      document.body.appendChild(ta);
      ta.select();
      const ok=document.execCommand('copy');
      document.body.removeChild(ta);
      ok?done():fail();
    }catch(e){ fail(); }
  }
}

/**
 * 由字节数估算阅读时长（中文约 500 字/分钟，HTML 标签约占 2/3 体积）。
 * @param {number} size - 文件字节数
 * @returns {string} 形如 '≈ 12 分钟'
 */
function _wikiReadTime(size){
  const min=Math.max(1,Math.round(Number(size||0)/3/500));
  return '≈ '+min+' 分钟';
}

/**
 * 渲染单张文档卡片。
 * @param {Object} d - 索引中的文档对象
 * @returns {string} HTML
 */
function _wikiCard(d){
  const attr=_wikiAttr(d.file);
  const tags=(d.tags||[]).map(function(t){return '<span class="tag">'+escHtml(t)+'</span>';}).join('');
  return '<article class="wiki-card" tabindex="0" role="link" aria-label="打开《'+escHtml(d.title)+'》" '
    +'onclick="openWikiDoc('+attr+')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openWikiDoc('+attr+');}">'
    +'<div class="wiki-card-top"><span class="tag info">'+escHtml(d.category||'专业解读')+'</span>'
      +'<span class="wiki-card-time">'+_wikiReadTime(d.size)+'</span></div>'
    +'<h3 class="wiki-card-title">'+escHtml(d.title)+'</h3>'
    +(d.desc?'<p class="wiki-card-desc">'+escHtml(d.desc)+'</p>':'')
    +'<div class="wiki-card-ft">'
      +(tags?'<div class="wiki-card-tags">'+tags+'</div>':'<span class="wiki-card-meta">互动长页 · 单文件离线可读</span>')
      +'<span class="wiki-card-go">开始阅读 '+icon('chevronRight','14')+'</span>'
    +'</div>'
    +'</article>';
}

/**
 * 渲染文档列表（按 category 分组）。
 * @param {Array} docs - 文档数组
 * @returns {string} HTML
 */
function _wikiList(docs){
  const groups={};
  const order=[];
  docs.forEach(function(d){
    const k=d.category||'专业解读';
    if(!groups[k]){ groups[k]=[]; order.push(k); }
    groups[k].push(d);
  });
  const multi=order.length>1;
  return order.map(function(k){
    return (multi?'<div class="wiki-group-title">'+escHtml(k)+'<span class="wiki-group-n">'+groups[k].length+' 篇</span></div>':'')
      +'<div class="wiki-grid">'+groups[k].map(_wikiCard).join('')+'</div>';
  }).join('');
}

/**
 * 渲染阅读器（iframe 内嵌文档）。
 * @returns {string} HTML
 */
function _viewWikiReader(){
  const docs=(_wikiIndex&&_wikiIndex.docs)||[];
  const doc=docs.find(function(d){return d.file===_wikiDoc;})||{file:_wikiDoc,title:_wikiDoc,desc:'',size:0,category:'专业解读'};
  const attr=_wikiAttr(doc.file);
  const url=_wikiUrl(doc.file);
  return '<div class="wiki-reader">'
    +'<div class="wiki-bar">'
      +'<button type="button" class="btn" onclick="closeWikiDoc()">'+icon('chevronLeft','16')+'<span>返回列表</span></button>'
      +'<div class="wiki-bar-main">'
        +'<div class="wiki-bar-title">'+escHtml(doc.title)+'</div>'
        +(doc.desc?'<div class="wiki-bar-sub">'+escHtml(doc.desc)+'</div>':'')
      +'</div>'
      +'<div class="wiki-bar-acts">'
        +'<button type="button" class="btn" onclick="copyWikiLink('+attr+')">'+icon('copy','14')+'<span>复制链接</span></button>'
        +'<a class="btn" href="'+escHtml(url)+'" target="_blank" rel="noopener">'+icon('link','14')+'<span>独立窗口</span></a>'
      +'</div>'
    +'</div>'
    +'<iframe class="wiki-frame" src="'+escHtml(url)+'" title="'+escHtml(doc.title)+'" loading="lazy"></iframe>'
    +'</div>';
}

/**
 * 专业解读视图入口（router 的 switch 分发调用）。
 * @returns {string} 视图 HTML
 */
function viewWiki(){
  // 文档态：异步索引可能尚未就绪，仍直接渲染 iframe（标题用文件名兜底）
  if(_wikiDoc){
    if(!_wikiIndex){
      loadWikiIndex(function(){ if(view==='wiki')render(); });
    }
    return _viewWikiReader();
  }

  if(!_wikiIndex){
    loadWikiIndex(function(){ if(view==='wiki')render(); });
    return '<div class="card"><div class="empty-state">'
      +'<div class="es-title">正在载入文档索引…</div>'
      +'<div class="es-desc">首次进入需要读取 wiki/index.js</div>'
      +'</div></div>';
  }

  const docs=_wikiIndex.docs||[];
  if(!docs.length){
    const failed=_wikiState==='error';
    return '<div class="card"><div class="empty-state">'
      +'<div class="es-icon">'+icon('fileText','28')+'</div>'
      +'<div class="es-title">'+(failed?'未找到文档索引':'暂无专业解读文档')+'</div>'
      +'<div class="es-desc">'+(failed
        ? '索引文件 wiki/index.js 加载失败。请在项目根目录执行 <code>npm run wiki:index</code> 重新生成后刷新。'
        : '把单文件 HTML 放入 <code>src/public/wiki/</code> 目录，索引会自动收录并展示在这里。')+'</div>'
      +'</div></div>';
  }

  const generated=(_wikiIndex.generatedAt||'').slice(0,10);
  return '<div class="card wiki-list-card">'
    +'<h2>'+icon('fileText','18')+'<span>专业解读</span>'
      +'<span class="tag info">'+docs.length+' 篇</span>'
      +(generated?'<span class="wiki-list-meta">索引更新于 '+escHtml(generated)+'</span>':'')
    +'</h2>'
    +'<p class="wiki-intro">产品与材料方向的深度长页，独立成文、可离线阅读。点击卡片在应用内直接打开，也可在新窗口单独查看。</p>'
    +_wikiList(docs)
    +'</div>';
}
