/* ═══════════════════════════════════════════════════════════════════
   wiki.js — 专业解读（互动文档）视图 · 云端优先 + 本地兜底 + list.json 远程文章
   ───────────────────────────────────────────────────────────────────
   本地文档：src/public/wiki/*.html → 构建后位于 dist/wiki/*.html
             （单文件、零外部依赖，构建时原样复制，不参与打包编译）
   本地索引：src/public/wiki/index.js（由 scripts/gen-wiki-index.mjs 生成）
   云端索引：WIKI_REMOTE_BASE + 'index.js'（线上部署同一生成脚本产物）
   加载策略：一律「动态 <script> 注入」而非 fetch ——
             file:// 双击运行时页面 origin 为 null，fetch 本地文件会被 CORS 拦截，
             而 <script src> 不受该限制（与 core/exporter.js 加载 vendor/xlsx.min.js 同策略）。
             索引 version 2 起含 docs[i].text 全文纯文本（构建期提取，仅用于站内检索）。
   双通道时序：先加载本地索引渲染（离线/file:// 可用），随后异步尝试云端索引
             （URL 带时间戳绕过缓存），成功且 docs 非空则切换为云端列表，iframe
             直连线上文档 —— 更新资料只需上传 HTML + index.js，无需发版。
             云端不可用（离线/断网/未部署）静默回退本地，零打扰。
   list.json 通道：fetch 拉取线上文章清单（含 title/url/category/updated_at），
             与 index.js 互动文档合并展示；远程文章新标签页打开，本地文档 iframe 阅读。
   展示方式：iframe 内嵌，保留文档自身排版/主题/交互，不做任何内联改写。
             新增文档只需把 .html 丢进 src/public/wiki/，索引自动重建。

   知识库能力（2026-10-27 深化，不推进版本号）：
     - 阅读元数据 DB.wikiMeta[file] = {star, read, readCount, lastReadAt, notes}
       收藏 / 已读 / 最近阅读 / 阅读笔记，随 DB 一起进 IndexedDB 与本地文件备份
     - 列表态：全文检索（回车触发，命中片段高亮）+ 筛选（收藏/未读/有笔记）
       + 「继续阅读」最近阅读条
     - 阅读态：顶栏收藏按钮（原地更新不重建 iframe）+ 底部笔记（防抖自动保存）
     - 全局搜索面板（views/search-panel.js）复用同一索引做知识库源检索
   ═══════════════════════════════════════════════════════════════════ */

/** 云端 wiki 基址（索引与文档同目录；置空字符串可禁用云端增强） */
const WIKI_REMOTE_BASE = 'https://wiki.edtib.com/wiki/';
/** 云端重试冷却期（ms）：失败后短时间内不重复注入请求 */
const WIKI_REMOTE_RETRY_MS = 60000;

/** 当前打开的文档文件名（null = 列表态） */
let _wikiDoc = null;
/** 本地索引数据缓存（window.__WIKI_INDEX 的引用） */
let _wikiIndex = null;
/** 本地索引加载状态：idle | loading | ready | error */
let _wikiState = 'idle';
/** 索引加载中的等待回调队列 */
let _wikiWaiters = [];
/** 列表态搜索关键词（原文） */
let _wikiSearch = '';
/** 列表态筛选：'' | 'star' | 'unread' | 'note' */
let _wikiFilter = '';
/** 笔记自动保存防抖定时器 id */
let _wikiNoteTimer = 0;

/** 筛选 chips 定义（k 为 _wikiFilter 的合法值，'' = 全部） */
const WIKI_FILTERS = [
  { k: '', label: '全部' },
  { k: 'star', label: '收藏' },
  { k: 'unread', label: '未读' },
  { k: 'note', label: '有笔记' },
];
/** 笔记停止输入后自动保存的防抖延迟（毫秒） */
const WIKI_NOTE_DEBOUNCE_MS = 900;
/** 命中片段前后各保留的字符数 */
const WIKI_SNIPPET_RADIUS = 60;
/** 「继续阅读」条展示的最近文档数 */
const WIKI_RECENT_COUNT = 3;
/** 云端索引（加载成功且 docs 非空时非 null，渲染时优先于本地） */
let _wikiRemote = null;
/** 云端索引状态：idle | loading | ready | error */
let _wikiRemoteState = 'idle';
/** 云端上次失败时间戳（冷却期内不重试） */
let _wikiRemoteFailAt = 0;
/** 云端索引 <script> 元素引用（重试前移除旧标签，防 DOM 堆积） */
let _wikiRemoteScript = null;
/** list.json 远程文章列表（fetch 加载，与 index.js 互动文档合并展示） */
let _wikiRemoteList = null;
/** list.json 加载状态：idle | loading | ready | error */
let _wikiRemoteListState = 'idle';
/** 最近一次 list 加载错误信息（用于 UI 排错） */
let _wikiRemoteListError = '';
/** 加载进度阶段：'connecting' | 'downloading' | 'parsing' | 'done' | 'error' */
let _wikiListStage = 'connecting';
/** 进度开始的时间戳（用于进度条动画） */
let _wikiListStartedAt = 0;
/** 已拉取到的字节数（Content-Length 已知时） */
let _wikiListBytesLoaded = 0;
/** 总字节数（Content-Length） */
let _wikiListBytesTotal = 0;
/** 进度态心跳定时器（loading 期间每秒刷新一次，驱动 elapsed 文案更新） */
let _wikiListHeartbeat = null;
/** 空态超时提示阈值（ms）—— loading 超过此时段显示「卡住」提示 + 重试 */
const WIKI_EMPTY_STALE_MS = 15000;
/** 首次进入空态的时间戳（用于判定 stale） */
let _wikiEmptySince = 0;

/** 串行加载步骤：0=未开始, 1=本地索引, 2=云端索引, 3=文章清单, 4=知识库同步, 5=全部完成 */
/** 串行加载步骤：0=未开始，1=文章清单，2=知识库同步，5=全部完成 */
let _wikiLoadStep = 0;
/** 串行加载是否正在执行中（防止重复触发） */
let _wikiLoadRunning = false;

/** localStorage 缓存键名 */
const WIKI_CACHE_KEY = 'wb_wiki_remote_list_cache';
/** 缓存有效期（毫秒）：24 小时 */
const WIKI_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * 读取本地缓存的远程文章列表（优先显示，避免每次启动都等待云端）。
 * @returns {Array|null} 缓存的文章列表或 null（无缓存/已过期）
 */
function _wikiReadCache(){
  try{
    const raw=localStorage.getItem(WIKI_CACHE_KEY);
    if(!raw)return null;
    const cached=JSON.parse(raw);
    if(!cached||!Array.isArray(cached.list)||!cached.ts)return null;
    if(Date.now()-cached.ts > WIKI_CACHE_TTL)return null;
    return cached.list;
  }catch(e){return null;}
}

/**
 * 保存远程文章列表到本地缓存。
 * @param {Array} list - 文章列表
 */
function _wikiSaveCache(list){
  try{
    localStorage.setItem(WIKI_CACHE_KEY, JSON.stringify({list:list, ts:Date.now()}));
  }catch(e){}
}

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
 * 当前生效的索引：云端 index.js 优先，合并 list.json 远程文章，否则本地。
 * 去重：同标题文章 list.json 优先（避免互动文档与远程文章重复展示）。
 * @returns {Object} 索引对象（docs 数组含互动文档 + 远程文章）
 */
function _wikiActiveIndex(){
  const base=(_wikiRemote && _wikiRemote.docs.length) ? _wikiRemote : (_wikiIndex || {docs:[]});
  const docs=(base.docs||[]).slice();
  if(_wikiRemoteList&&_wikiRemoteList.length){
    const seen={};
    docs.forEach(function(d){seen[d.title]=1;});
    _wikiRemoteList.forEach(function(d){
      if(!seen[d.title])docs.push(d);
    });
  }
  return {docs:docs,generatedAt:base.generatedAt||''};
}

/**
 * 来源感知的文档 URL：文档存在于云端索引 → 线上绝对 URL；
 * 否则（本地独有 / 云端不可用）→ 本地相对 URL（_wikiUrl）。
 * 「复制链接」「独立窗口」「iframe src」统一走这里，保证三者一致。
 * @param {string} file - 相对 wiki 目录的文件名（原始未编码）
 * @returns {string} 绝对 URL
 */
function _wikiDocUrl(file){
  const inRemote=_wikiRemote && _wikiRemote.docs.some(function(d){return d.file===file;});
  if(inRemote) return WIKI_REMOTE_BASE+encodeURI(file);
  if(!file){
    const rl=(_wikiRemoteList||[]).find(function(d){return d.url;});
    if(rl)return rl.url;
  }
  return _wikiUrl(file);
}

/**
 * 尝试加载云端索引（幂等 + 失败冷却，失败静默回退本地）。
 * 云端产物与本地产物同构（gen-wiki-index.mjs 生成，全局名同为 __WIKI_INDEX），
 * 故加载前先暂存本地引用，onload 取走云端值后立即还原，避免相互覆盖。
 * URL 带时间戳查询参数，绕过浏览器/CDN 对 index.js 的缓存。
 * @param {Function} [cb] - 结束回调（成功切换或失败均回调，之后可 render()）
 * @returns {void}
 */
function _loadWikiRemote(cb){
  if(!WIKI_REMOTE_BASE){ if(cb)cb(); return; }
  if(_wikiRemoteState==='loading'){ if(cb)cb(); return; }
  if(_wikiRemoteState==='ready'){ if(cb)cb(); return; }
  if(_wikiRemoteState==='error' && (Date.now()-_wikiRemoteFailAt)<WIKI_REMOTE_RETRY_MS){ if(cb)cb(); return; }
  _wikiRemoteState='loading';

  const local=window.__WIKI_INDEX;
  let done=false;
  const finish=function(ok){
    if(done)return;
    done=true;
    const remote=window.__WIKI_INDEX;
    // 还原本地引用（远程同名全局会覆盖它）；本地本就未定义时清掉，避免后续误读云端值
    if(typeof local!=='undefined') window.__WIKI_INDEX=local;
    else{ try{ delete window.__WIKI_INDEX; }catch(e){ window.__WIKI_INDEX=undefined; } }
    if(ok && remote && Array.isArray(remote.docs) && remote.docs.length){
      _wikiRemote=remote;
      _wikiRemoteState='ready';
    }else{
      _wikiRemote=null;
      _wikiRemoteState='error';
      _wikiRemoteFailAt=Date.now();
      console.warn('[wiki] 云端索引加载失败：服务器返回无效数据（可能是 404 HTML 页面）');
    }
    if(_wikiRemoteScript && _wikiRemoteScript.parentNode) _wikiRemoteScript.parentNode.removeChild(_wikiRemoteScript);
    _wikiRemoteScript=null;
    if(cb){
      try{cb();}catch(e){}
    }
  };

  // 移除上次失败残留的标签再注入
  if(_wikiRemoteScript && _wikiRemoteScript.parentNode) _wikiRemoteScript.parentNode.removeChild(_wikiRemoteScript);
  const s=document.createElement('script');
  s.src=WIKI_REMOTE_BASE+'index.js?t='+Date.now();
  s.async=true;
  s.onload=function(){finish(true);};
  s.onerror=function(){finish(false);};
  _wikiRemoteScript=s;
  document.head.appendChild(s);
  /* v1.0.57 修复：连接被防火墙吞包时 onload/onerror 均不触发，loading 态永不冷却，云端增强整个会话不再重试；
     10s 超时兑底（finish 有 done 门闩幂等，可安全与 onload/onerror 竞争） */
  setTimeout(function(){ if(!done) finish(false); },10000);
}

/**
 * 从 list.json 加载远程文章列表（与 index.js 互动文档合并展示）。
 * 直接 fetch（CORS 已在服务端开启：Access-Control-Allow-Origin: *）。
 * 简化版：不使用流式读取，直接 resp.json()，更稳定可靠。
 * @returns {void}
 */
function _fetchWikiList(){
  if(!WIKI_REMOTE_BASE)return;
  if(_wikiRemoteListState==='loading')return;
  _wikiRemoteListState='loading';
  _wikiRemoteListError='';
  _wikiListBytesLoaded=0;
  _wikiListBytesTotal=0;
  _wikiListStage='connecting';
  _wikiListStartedAt=Date.now();
  _wikiEmptySince=Date.now();

  const ctrl=new AbortController();
  const timeoutMs=15000;
  const timer=setTimeout(function(){ctrl.abort();},timeoutMs);

  _wikiListStage='downloading';
  if(view==='wiki')render();

  fetch(WIKI_REMOTE_BASE+'list.json?t='+Date.now(),{signal:ctrl.signal,cache:'no-store'})
  .then(function(resp){
    clearTimeout(timer);
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    _wikiListStage='parsing';
    return resp.json();
  })
  .then(function(list){
    if(_wikiListHeartbeat){clearInterval(_wikiListHeartbeat);_wikiListHeartbeat=null;}
    if(!Array.isArray(list))throw new Error('格式非法');
    _wikiRemoteList=list.filter(function(e){return e&&e.title&&e.url;}).map(function(e){
      return {
        title:String(e.title),
        url:String(e.url),
        file:'',
        desc:e.desc||'',
        category:e.category||'',
        tags:Array.isArray(e.tags)?e.tags:[],
        size:Number(e.size)||0,
        updated_at:e.updated_at||''
      };
    });
    // 保存到本地缓存
    _wikiSaveCache(_wikiRemoteList);
    _wikiListStage='done';
    _wikiRemoteListState='ready';
    _wikiRemoteListError='';
    if(view==='wiki')render();
  })
  .catch(function(e){
    clearTimeout(timer);
    if(_wikiListHeartbeat){clearInterval(_wikiListHeartbeat);_wikiListHeartbeat=null;}
    _wikiRemoteListState='error';
    _wikiListStage='error';
    const name=e&&e.name?e.name:'';
    const msg=e&&e.message?e.message:String(e);
    _wikiRemoteListError=name==='AbortError'?'请求超时（'+(timeoutMs/1000)+'s）':msg;
    if(view==='wiki')render();
  });
}

/**
 * 串行加载：一步完成后再启动下一步，避免并发触发服务器限流。
 * 步骤：1=文章清单 (list.json) → 2=知识库同步
 * 每步失败后暂停，显示错误 + 重试按钮，用户点击后从失败步骤继续。
 * 注：云端只有 list.json，没有 index.js（本地互动文档）。
 */
function _wikiSequentialLoad(){
  if(!WIKI_REMOTE_BASE || _wikiLoadStep >= 5){
    _wikiLoadRunning = false;
    return;
  }

  // Step 1: 加载文章清单 (list.json) — 云端只有这个文件
  if(_wikiLoadStep === 0){
    _wikiLoadStep = 1;
    // 有缓存时不显示加载进度（静默更新）
    const hasCache=!!_wikiRemoteList;
    if(!hasCache){
      _wikiListStage = 'connecting';
      _wikiListStartedAt = Date.now();
      if(view==='wiki')render();
    }
    _fetchWikiList();
    // 监听加载完成（通过轮询状态）
    const checkComplete = setInterval(function(){
      if(_wikiRemoteListState === 'ready'){
        clearInterval(checkComplete);
        _wikiLoadRunning = false;
        _wikiLoadStep = 2;
        // 有缓存时静默更新，不重新渲染（除非数据有变化）
        if(!hasCache && view==='wiki')render();
        setTimeout(function(){ _wikiLoadRunning = true; _wikiSequentialLoad(); }, 300);
      }else if(_wikiRemoteListState === 'error'){
        clearInterval(checkComplete);
        _wikiLoadRunning = false;
        // 有缓存时不显示错误（静默失败）
        if(!hasCache && view==='wiki')render();
      }
    }, 200);
    return;
  }

  // Step 2: 知识库同步
  if(_wikiLoadStep === 2){
    _wikiLoadStep = 5;
    _wikiLoadRunning = false;
    if(!_wikiKbAutoSyncTriggered && typeof WikiKB!=='undefined' && WikiKB.state && !WikiKB.state.articles.length && !WikiKB.state.syncing && WikiKB.state.enabled){
      _wikiKbAutoSyncTriggered = true;
      console.log('[wiki] 知识库同步启动（串行最后一步）');
      WikiKB.sync().then(function(r){
        console.log('[wiki] 知识库同步完成:', r);
        if(view==='wiki')render();
      }).catch(function(e){
        console.warn('[wiki] 知识库同步失败:', e);
      });
    }
    return;
  }

  _wikiLoadRunning = false;
}

/**
 * 手动重试：从当前失败步骤继续加载。
 */
function _wikiRetryLoad(){
  if(_wikiLoadRunning)return;
  _wikiRemoteListError = '';
  _wikiLoadRunning = true;
  _wikiSequentialLoad();
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
    // 本地索引就绪（含失败兜底）后，异步尝试云端索引；成功切换后由回调触发重渲染
    _loadWikiRemote(function(){ if(view==='wiki')render(); });
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

/* =========================================================
   阅读元数据（收藏 / 已读 / 笔记）
   ========================================================= */
/**
 * 只读获取文档元数据（不创建、无副作用）：渲染与筛选路径专用。
 * @param {string} file - 原始文件名
 * @returns {Object|null} 元数据对象或 null
 */
function _wikiMetaGet(file){
  if(!DB.wikiMeta||typeof DB.wikiMeta!=='object')return null;
  const m=DB.wikiMeta[file];
  return (m&&typeof m==='object')?m:null;
}

/**
 * 取文档元数据（懒创建，写入路径专用）：保证旧数据/任意初始化路径下结构完整。
 * @param {string} file - 原始文件名
 * @returns {{star:number, read:number, readCount:number, lastReadAt:number, notes:string}}
 */
function _wikiMeta(file){
  if(!DB.wikiMeta||typeof DB.wikiMeta!=='object')DB.wikiMeta={};
  let m=DB.wikiMeta[file];
  if(!m||typeof m!=='object'){
    m={star:0,read:0,readCount:0,lastReadAt:0,notes:''};
    DB.wikiMeta[file]=m;
  }
  if(typeof m.notes!=='string')m.notes=m.notes?String(m.notes):'';
  return m;
}

/** 相对时间文案：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / YYYY-MM-DD */
function _wikiRelTime(ts){
  const n=Number(ts||0);
  if(!n)return '';
  const diff=Date.now()-n;
  const MS_MINUTE=60000,MS_HOUR=3600000,MS_DAY=86400000,MS_MONTH=30*MS_DAY;
  if(diff<MS_MINUTE)return '刚刚';
  if(diff<MS_HOUR)return Math.floor(diff/MS_MINUTE)+' 分钟前';
  if(diff<MS_DAY)return Math.floor(diff/MS_HOUR)+' 小时前';
  if(diff<2*MS_DAY)return '昨天';
  if(diff<MS_MONTH)return Math.floor(diff/MS_DAY)+' 天前';
  const d=new Date(n);
  const pad=function(x){return String(x).padStart(2,'0');};
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}

/** 当前时刻 HH:mm（笔记保存时间戳用） */
function _wikiClock(){
  const d=new Date();
  const pad=function(x){return String(x).padStart(2,'0');};
  return pad(d.getHours())+':'+pad(d.getMinutes());
}

/* =========================================================
   站内检索
   ========================================================= */
/** 解析搜索词：空白/逗号分隔多关键词，全部命中才算匹配（AND） */
function _wikiQueryTerms(q){
  return String(q||'').split(/[\s,，]+/).map(function(s){return s.trim().toLowerCase();}).filter(Boolean);
}

/** 检索 haystack：标题 + 摘要 + 分类 + 标签 + 全文（索引 v1 无 text 时自动降级） */
function _wikiHay(d){
  return [d.title||'',d.desc||'',d.category||'',(d.tags||[]).join(' '),d.text||''].join('\n').toLowerCase();
}

/** 高亮纯文本片段：先按关键词切分再逐段转义，用户数据始终过 escHtml，避免 XSS */
function _wikiHi(text,terms){
  const s=String(text||'');
  const safe=terms.filter(Boolean).map(function(t){return String(t).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');});
  if(!safe.length)return escHtml(s);
  let re;
  try{ re=new RegExp('('+safe.join('|')+')','gi'); }catch(e){ return escHtml(s); }
  return s.split(re).map(function(part,i){
    return i%2===1?'<mark class="wiki-hit">'+escHtml(part)+'</mark>':escHtml(part);
  }).join('');
}

/**
 * 命中信息：全文首个命中位置的上下文片段 + 首个命中关键词的出现次数。
 * @param {Object} d - 索引文档对象
 * @param {string[]} terms - 小写关键词数组
 * @returns {{snippet:string, hits:number}}
 */
function _wikiHitInfo(d,terms){
  const text=String(d.text||'');
  const lower=text.toLowerCase();
  const first=terms.find(function(t){return lower.indexOf(t)>=0;})||'';
  const idx=first?lower.indexOf(first):-1;
  let snippet='';
  if(idx>=0){
    const start=Math.max(0,idx-WIKI_SNIPPET_RADIUS);
    const end=idx+first.length+WIKI_SNIPPET_RADIUS;
    snippet=(start>0?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
  }else if(d.desc){
    snippet=String(d.desc);
  }
  let hits=0;
  if(first){
    let pos=lower.indexOf(first);
    while(pos>=0&&hits<999){hits++;pos=lower.indexOf(first,pos+first.length);}
  }
  return {snippet:snippet,hits:hits};
}

/** 按搜索词与筛选 chip 过滤文档（搜索与筛选同时生效，AND 语义） */
function _wikiFilterDocs(docs){
  const terms=_wikiQueryTerms(_wikiSearch);
  let list=docs.slice();
  if(terms.length){
    list=list.filter(function(d){
      const hay=_wikiHay(d);
      return terms.every(function(t){return hay.indexOf(t)>=0;});
    });
  }
  if(_wikiFilter==='star')list=list.filter(function(d){const m=_wikiMetaGet(d.file);return !!(m&&m.star);});
  else if(_wikiFilter==='unread')list=list.filter(function(d){const m=_wikiMetaGet(d.file);return !(m&&m.read);});
  else if(_wikiFilter==='note')list=list.filter(function(d){const m=_wikiMetaGet(d.file);return !!(m&&m.notes);});
  return list;
}

/* =========================================================
   用户动作（全局函数，供内联事件调用）
   ========================================================= */
/**
 * 列表态搜索（回车 / 点击放大镜触发，§8 约定不用 oninput 实时搜索）。
 * @param {string} v - 搜索框内容
 */
function onWikiSearch(v){
  _wikiSearch=String(v||'').trim();
  render();
  const inp=document.getElementById('wikiSearchInput');
  if(inp){inp.focus();try{inp.setSelectionRange(inp.value.length,inp.value.length);}catch(e){}}
}

/** 切换筛选 chip（再次点击同一 chip 取消） */
function onWikiFilter(k){
  _wikiFilter=(_wikiFilter===k)?'':k;
  render();
}

/** 清空搜索与筛选（工具栏「清除」按钮） */
function clearWikiFilters(){
  _wikiSearch='';
  _wikiFilter='';
  render();
}

/**
 * 收藏 / 取消收藏。
 * 列表态直接重渲染；阅读态只原地更新顶栏按钮，避免 render() 重建 iframe
 * 导致文档阅读位置丢失。
 * @param {string} key - encodeURIComponent 后的文件名
 */
function toggleWikiStar(key){
  let file=String(key||'');
  try{ file=decodeURIComponent(file); }catch(e){}
  if(!file)return;
  const m=_wikiMeta(file);
  m.star=m.star?0:1;
  saveDB();
  if(typeof toast==='function')toast(m.star?'已收藏':'已取消收藏','ok');
  if(_wikiDoc===file){
    const btn=document.getElementById('wikiStarBtn');
    if(btn)btn.classList.toggle('on',!!m.star);
  }else{
    render();
  }
}

/** 笔记输入：标记「未保存」并安排防抖自动保存 */
function onWikiNoteInput(){
  const st=document.getElementById('wikiNoteStat');
  if(st){st.textContent='有未保存更改…';st.classList.add('dirty');}
  if(_wikiNoteTimer)clearTimeout(_wikiNoteTimer);
  _wikiNoteTimer=setTimeout(saveWikiNote,WIKI_NOTE_DEBOUNCE_MS);
}

/** 保存当前文档笔记到 DB（自动保存与「保存笔记」按钮共用） */
function saveWikiNote(){
  if(_wikiNoteTimer){clearTimeout(_wikiNoteTimer);_wikiNoteTimer=0;}
  if(!_wikiDoc)return;
  const ta=document.getElementById('wikiNoteTA');
  if(!ta)return;
  const m=_wikiMeta(_wikiDoc);
  if(m.notes===ta.value)return;  // 内容未变化不写库
  m.notes=ta.value;
  saveDB();
  const st=document.getElementById('wikiNoteStat');
  if(st){st.textContent='已保存 '+_wikiClock();st.classList.remove('dirty');}
}

/** 离开阅读态前冲刷挂起的自动保存（closeWikiDoc / __wikiReset 调用） */
function _wikiFlushNote(){
  if(_wikiNoteTimer)saveWikiNote();
}

/** 重置为列表态（切换导航离开本模块时由 router 的 go() 调用） */
function __wikiReset(){ _wikiFlushNote(); _wikiDoc=null; }

/**
 * 打开指定文档：记录已读 / 最近阅读（lastReadAt + readCount）后进入阅读态。
 * @param {string} key - encodeURIComponent 后的文件名（见 _wikiAttr）
 */
function openWikiDoc(key){
  let file=String(key||'');
  try{ file=decodeURIComponent(file); }catch(e){}
  if(!file)return;
  _wikiFlushNote();
  _wikiDoc=file;
  const m=_wikiMeta(file);
  m.read=1;
  m.readCount=(m.readCount||0)+1;
  m.lastReadAt=Date.now();
  saveDB();
  render();
  window.scrollTo(0,0);
}

/**
 * 打开远程文章（应用内 iframe 打开）。
 * @param {string} key - encodeURIComponent 后的 URL
 */
function openWikiDocRemote(key){
  let url=String(key||'');
  try{ url=decodeURIComponent(url); }catch(e){}
  if(!url)return;
  _wikiFlushNote();
  _wikiDoc=url;  // 远程文章用 URL 作为 doc key
  render();
  window.scrollTo(0,0);
}

/** 关闭文档，回到列表 */
function closeWikiDoc(){ _wikiFlushNote(); _wikiDoc=null; render(); }

/**
 * 复制文档的绝对链接（file:// 下 navigator.clipboard 可能不可用，降级 execCommand）。
 * 云端文档复制的是线上 URL（可直接分享），本地文档复制本地路径。
 * @param {string} key - encodeURIComponent 后的文件名
 */
function copyWikiLink(key){
  let file=String(key||'');
  try{ file=decodeURIComponent(file); }catch(e){}
  const url=_wikiDocUrl(file);
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

/* =========================================================
   渲染
   ========================================================= */
/**
 * 渲染单张文档卡片（含收藏星标 / 未读标记 / 笔记标记 / 上次阅读）。
 * 远程文章（d.url 非空，来自 list.json）：新标签页打开，显示 globe 图标。
 * 本地互动文档（d.file 非空，来自 index.js）：iframe 阅读器，显示 fileText 图标。
 * @param {Object} d - 索引中的文档对象
 * @returns {string} HTML
 */
function _wikiCard(d){
  const isRemote=!!d.url;
  const attr=_wikiAttr(isRemote?d.url:d.file);
  const meta=(!isRemote&&d.file)?(_wikiMetaGet(d.file)||{}):{};
  const tags=(d.tags||[]).map(function(t){return '<span class="tag">'+escHtml(t)+'</span>';}).join('');
  const unread=!isRemote&&!meta.read;
  const catLabel=d.category||'专业解读';
  const timeTxt=isRemote
    ?(d.updated_at?'<span style="color:var(--gray);font-size:12px">'+escHtml(String(d.updated_at).slice(0,10))+'</span>':'')
    :_wikiReadTime(d.size);
  // 远程文章：默认应用内打开（iframe），提供浏览器打开按钮
  const clickFn=isRemote?'openWikiDocRemote('+attr+')':'openWikiDoc('+attr+')';
  const keyFn=isRemote
    ?'if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openWikiDocRemote('+attr+');}'
    :'if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openWikiDoc('+attr+');}';
  return '<article class="wiki-card" tabindex="0" role="link" aria-label="'+(isRemote?'查看':'打开')+'《'+escHtml(d.title)+'》" '
    +'onclick="'+clickFn+'" onkeydown="'+keyFn+'">'
    +(!isRemote?'<button type="button" class="wiki-star'+(meta.star?' on':'')+'" aria-label="'+(meta.star?'取消收藏':'收藏')+'" title="'+(meta.star?'取消收藏':'收藏')+'" onclick="event.stopPropagation();toggleWikiStar('+attr+')">'+icon('star','16')+'</button>':'')
    +(isRemote?'<button type="button" class="wiki-open-external" aria-label="在浏览器中打开" title="在浏览器中打开" onclick="event.stopPropagation();openWikiExternal('+attr+')">'+icon('externalLink','14')+'</button>':'')
    +'<div class="wiki-card-top"><span class="tag info">'+(isRemote?icon('globe','12')+' ':'')+escHtml(catLabel)+'</span>'
      +(!isRemote&&unread?'<span class="tag warn">未读</span>':'')
      +(!isRemote&&meta.notes?'<span class="tag purple">笔记</span>':'')
      +'<span class="wiki-card-time">'+timeTxt+'</span></div>'
    +'<h3 class="wiki-card-title">'+escHtml(d.title)+'</h3>'
    +(d.desc?'<p class="wiki-card-desc">'+escHtml(d.desc)+'</p>':'')
    +'<div class="wiki-card-ft">'
      +(tags?'<div class="wiki-card-tags">'+tags+'</div>'
        :(isRemote?'<span class="wiki-card-meta">'+icon('link','12')+' 线上文章</span>'
          :'<span class="wiki-card-meta">互动长页 · 单文件离线可读</span>'))
      +(!isRemote&&meta.lastReadAt?'<span class="wiki-card-meta wiki-card-last">上次阅读 '+escHtml(_wikiRelTime(meta.lastReadAt))+'</span>':'')
      +'<span class="wiki-card-go">'+(isRemote?'查看详情':(unread?'开始阅读':'继续阅读'))+' '+icon('chevronRight','14')+'</span>'
    +'</div>'
    +'</article>';
}

/**
 * 渲染单条全文检索命中行（标题/片段高亮 + 命中次数）。
 * @param {Object} d - 索引文档对象
 * @param {string[]} terms - 小写关键词数组
 * @returns {string} HTML
 */
function _wikiHitRow(d,terms){
  /* v1.0.57 修复：线上文章（list.json）file 为空串，openWikiDoc('') 直接 return——点击/回车无反应；分流 openWikiExternal */
  const isRemote=!!d.url;
  const attr=_wikiAttr(isRemote?d.url:d.file);
  const openFn=isRemote?'openWikiExternal':'openWikiDoc';
  const info=_wikiHitInfo(d,terms);
  const meta=_wikiMetaGet(d.file)||{};
  const tags=(d.tags||[]).map(function(t){return '<span class="tag">'+escHtml(t)+'</span>';}).join('');
  return '<article class="wiki-hit-row" tabindex="0" role="link" aria-label="打开《'+escHtml(d.title)+'》" '
    +'onclick="'+openFn+'('+attr+')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();'+openFn+'('+attr+');}">'
    +'<div class="wiki-hit-title"><span>'+_wikiHi(d.title,terms)+'</span>'
      +'<span class="tag info">'+escHtml(d.category||'专业解读')+'</span>'
      +(meta.star?'<span class="tag warn">已收藏</span>':'')+tags
    +'</div>'
    +(info.snippet?'<div class="wiki-hit-snippet">'+_wikiHi(info.snippet,terms)+'</div>':'')
    +'<div class="wiki-hit-meta">'+(info.hits?'全文命中 <b>'+info.hits+'</b> 处 · ':'')+_wikiReadTime(d.size)
      +(meta.notes?' · 有笔记':'')
      +(meta.lastReadAt?' · 上次阅读 '+escHtml(_wikiRelTime(meta.lastReadAt)):'')
    +'</div>'
    +'</article>';
}

/**
 * 渲染「继续阅读」条：最近打开的文档（仅无搜索、无筛选时显示）。
 * @param {Array} docs - 全部文档
 * @returns {string} HTML（无最近阅读时返回空串）
 */
function _wikiRecentStrip(docs){
  const recent=docs
    .filter(function(d){const m=_wikiMetaGet(d.file);return !!(m&&m.lastReadAt);})
    .sort(function(a,b){
      const ma=_wikiMetaGet(a.file)||{};
      const mb=_wikiMetaGet(b.file)||{};
      return (mb.lastReadAt||0)-(ma.lastReadAt||0);
    })
    .slice(0,WIKI_RECENT_COUNT);
  if(!recent.length)return '';
  return '<div class="wiki-recent">'
    +'<span class="wiki-recent-hd">'+icon('clock','14')+'<span>继续阅读</span></span>'
    +recent.map(function(d){
      const attr=_wikiAttr(d.file);
      const m=_wikiMetaGet(d.file)||{};
      return '<button type="button" class="wiki-recent-item" onclick="openWikiDoc('+attr+')">'
        +escHtml(d.title)+'<small>'+escHtml(_wikiRelTime(m.lastReadAt))+'</small></button>';
    }).join('')
    +'</div>';
}

/**
 * 渲染工具栏：搜索框（回车触发）+ 筛选 chips（含计数）+ 清除按钮。
 * @param {Array} docs - 全部文档（计数基准）
 * @returns {string} HTML
 */
function _wikiToolbar(docs){
  const counts={
    '':docs.length,
    'star':docs.filter(function(d){const m=_wikiMetaGet(d.file);return !!(m&&m.star);}).length,
    'unread':docs.filter(function(d){const m=_wikiMetaGet(d.file);return !(m&&m.read);}).length,
    'note':docs.filter(function(d){const m=_wikiMetaGet(d.file);return !!(m&&m.notes);}).length,
  };
  const chips=WIKI_FILTERS.map(function(f){
    return '<button type="button" class="wiki-chip'+(_wikiFilter===f.k?' on':'')+'" '
      +'aria-pressed="'+(_wikiFilter===f.k?'true':'false')+'" onclick="onWikiFilter(\''+f.k+'\')">'
      +escHtml(f.label)+'<span class="wiki-chip-n">'+counts[f.k]+'</span></button>';
  }).join('');
  return '<div class="wiki-toolbar">'
    +'<div class="search-box'+(_wikiSearch?' has-val':'')+'">'
      +'<button type="button" class="search-trigger" aria-label="搜索知识库" onclick="onWikiSearch(document.getElementById(\'wikiSearchInput\').value)">'+icon('search','16')+'</button>'
      +'<input id="wikiSearchInput" type="text" aria-label="搜索标题、标签与正文" value="'+escAttr(_wikiSearch)+'" placeholder="搜索标题 / 标签 / 正文全文…（回车搜索）" onkeydown="if(event.key===\'Enter\'&&!event.isComposing)onWikiSearch(this.value)">'
      +'<button type="button" class="clear-btn" aria-label="清空搜索" onclick="onWikiSearch(\'\')">×</button>'
    +'</div>'
    +'<div class="wiki-chips">'+chips+'</div>'
    +((_wikiSearch||_wikiFilter)?'<button type="button" class="btn ghost sm" onclick="clearWikiFilters()">'+icon('x','14')+'<span>清除</span></button>':'')
    +'</div>';
}

/**
 * 在新标签页打开远程 wiki 文章（list.json 来源）。
 * @param {string} encodedUrl - encodeURIComponent 编码后的文章 URL
 */
function openWikiExternal(encodedUrl){
  let url=String(encodedUrl||'');
  try{url=decodeURIComponent(url);}catch(e){}
  if(!url)return;
  // 尝试 window.open，若被浏览器拦截则降级为 location 跳转（会离开当前应用）
  /* v1.0.57 修复：去掉 'noopener' 第三参——该写法下返回值恒为 null，每次都误判被拦截并弹提示 toast */
  const opened=window.open(url,'_blank');
  if(!opened || opened.closed || typeof opened.closed==='undefined'){
    // 弹窗被拦截：创建临时 <a> 点击
    const a=document.createElement('a');
    a.href=url;
    a.target='_blank';
    a.rel='noopener';
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){document.body.removeChild(a);},100);
    if(typeof toast==='function')toast('若新窗口未弹出，请检查浏览器弹窗拦截设置','info');
  }
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

/** 空态：搜索无结果 */
function _wikiEmptySearch(){
  return '<div class="empty-state">'
    +'<div class="es-icon">'+icon('search','28')+'</div>'
    +'<div class="es-title">未找到与「'+escHtml(_wikiSearch)+'」相关的解读</div>'
    +'<div class="es-desc">试试更换关键词；检索范围为标题、摘要、标签与正文全文。</div>'
    +'</div>';
}

/** 空态：筛选无结果 */
function _wikiEmptyFilter(){
  const label=(_wikiFilter==='star')?'收藏':((_wikiFilter==='unread')?'未读':'有笔记');
  return '<div class="empty-state">'
    +'<div class="es-icon">'+icon('filter','28')+'</div>'
    +'<div class="es-title">没有'+label+'的文档</div>'
    +'<div class="es-desc">切换到「全部」或调整筛选条件试试。</div>'
    +'</div>';
}

/**
 * 渲染阅读器（iframe 内嵌 + 顶栏收藏 + 底部阅读笔记）。
 * @returns {string} HTML
 */
function _viewWikiReader(){
  // 判断是否为远程文章（URL）
  const isRemoteUrl = _wikiDoc && (_wikiDoc.startsWith('http://') || _wikiDoc.startsWith('https://'));
  
  // 元数据查找：先当前生效索引（云端优先），再本地索引兜底，均未命中用文件名兜底
  const activeDocs=_wikiActiveIndex().docs||[];
  const localDocs=(_wikiIndex&&_wikiIndex.docs)||[];
  let doc=activeDocs.find(function(d){return d.file===_wikiDoc;});
  if(!doc) doc=localDocs.find(function(d){return d.file===_wikiDoc;});
  // 远程文章：按 URL 查找
  if(!doc && isRemoteUrl) doc=activeDocs.find(function(d){return d.url===_wikiDoc;});
  if(!doc) doc={file:_wikiDoc,title:_wikiDoc,desc:'',size:0,category:'专业解读',url:isRemoteUrl?_wikiDoc:''};
  const attr=_wikiAttr(isRemoteUrl?doc.url:doc.file);
  const url=isRemoteUrl?doc.url:_wikiDocUrl(doc.file);
  const meta=isRemoteUrl?{}:(_wikiMetaGet(doc.file)||{});
  const subBits=[];
  if(doc.category)subBits.push(escHtml(doc.category));
  if(!isRemoteUrl){
    subBits.push(meta.lastReadAt
      ?'上次阅读 '+escHtml(_wikiRelTime(meta.lastReadAt))+(meta.readCount?' · 已读 '+meta.readCount+' 次':'')
      :'首次阅读');
  }else{
    subBits.push('线上文章');
  }
  return '<div class="wiki-reader">'
    +'<div class="wiki-bar">'
      +'<button type="button" class="btn" onclick="closeWikiDoc()">'+icon('chevronLeft','16')+'<span>返回列表</span></button>'
      +'<div class="wiki-bar-main">'
        +'<div class="wiki-bar-title">'+escHtml(doc.title)+'</div>'
        +'<div class="wiki-bar-sub">'+subBits.join(' · ')+'</div>'
      +'</div>'
      +'<div class="wiki-bar-acts">'
        +(!isRemoteUrl?'<button type="button" class="btn wiki-star'+(meta.star?' on':'')+'" id="wikiStarBtn" '
          +'onclick="toggleWikiStar('+attr+')" title="'+(meta.star?'取消收藏':'收藏')+'" aria-pressed="'+(meta.star?'true':'false')+'">'
          +icon('star','14')+'<span>'+(meta.star?'已收藏':'收藏')+'</span></button>':'')
        +'<button type="button" class="btn" onclick="copyWikiLink('+attr+')">'+icon('copy','14')+'<span>复制链接</span></button>'
        +'<a class="btn" href="'+escHtml(url)+'" target="_blank" rel="noopener">'+icon('link','14')+'<span>独立窗口</span></a>'
      +'</div>'
    +'</div>'
    +'<iframe class="wiki-frame" src="'+escHtml(url)+'" title="'+escHtml(doc.title)+'" loading="lazy"></iframe>'
    +(!isRemoteUrl?'<div class="wiki-notes">'
      +'<div class="wiki-notes-hd">'+icon('edit','14')+'<span>我的笔记</span>'
        +'<span class="wiki-notes-stat" id="wikiNoteStat">'+(meta.notes?'停止输入后自动保存':'记录阅读要点，自动保存')+'</span>'
        +'<button type="button" class="btn sm" onclick="saveWikiNote()"><span>保存笔记</span></button>'
      +'</div>'
      +'<textarea id="wikiNoteTA" class="wiki-notes-ta" aria-label="本篇文档的阅读笔记" '
        +'placeholder="记录这篇解读的要点、疑问或与订单相关的线索…（停止输入约 1 秒后自动保存）" '
        +'oninput="onWikiNoteInput()">'+escHtml(meta.notes||'')+'</textarea>'
    +'</div>':'')
    +'</div>';
}

/** 知识库自动同步是否已触发（避免 render 循环重复触发） */
let _wikiKbAutoSyncTriggered = false;

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

  // 云端索引：本地 index.js 存在则加载（互动文档 iframe），否则跳过
  if(!_wikiIndex){
    loadWikiIndex(function(){ if(view==='wiki')render(); });
  }
  
  // 优先读取本地缓存（立即显示，避免等待云端）
  if(!_wikiRemoteList && WIKI_REMOTE_BASE){
    const cached=_wikiReadCache();
    if(cached){
      _wikiRemoteList=cached;
      _wikiRemoteListState='ready';
      console.log('[wiki] 使用本地缓存（'+cached.length+' 篇）');
    }
  }
  
  // 后台静默更新（有缓存时不阻塞 UI）
  if(WIKI_REMOTE_BASE && !_wikiLoadRunning && _wikiLoadStep < 5){
    _wikiLoadRunning = true;
    _wikiSequentialLoad();
  }

  // 列表渲染以生效索引为准（云端就绪优先，离线/失败回退本地内置）
  const active=_wikiActiveIndex();
  const isCloud=!!(_wikiRemote&&_wikiRemote.docs.length);
  const docs=active.docs||[];
  if(!docs.length){
    const localFailed=_wikiState==='error';
    const listFailed=_wikiRemoteListState==='error';
    let title,desc,retryBtn='',progressHtml='';

    if(!WIKI_REMOTE_BASE){
      title='暂无本地文档';
      desc='云端同步已禁用，且本地 wiki/index.js 无文档。请将 .html 文件放入 src/public/wiki/ 后运行 npm run wiki:index。';
    }else if(_wikiLoadStep === 1 && listFailed){
      // Step 1 失败：文章清单加载失败
      title='文章清单加载失败';
      const errHint=_wikiRemoteListError?(' 原因：'+escHtml(_wikiRemoteListError)):'';
      desc='list.json 不可用'+errHint+'。';
      retryBtn='<button type="button" class="btn sm" style="margin-top:12px" onclick="_wikiRetryLoad()">'+icon('refresh','14')+' 重试</button>';
    }else if(_wikiLoadStep > 0 && _wikiLoadStep < 5){
      // 正在加载中，显示进度
      const stepLabels = {
        1: '正在加载文章清单…',
        2: '正在同步知识库…'
      };
      const stepDescs = {
        1: '连接 wiki.edtib.com，读取文章清单（list.json）。',
        2: '抓取文章正文，构建本地知识库。'
      };
      title = stepLabels[_wikiLoadStep] || '加载中…';
      desc = stepDescs[_wikiLoadStep] || '';
      progressHtml = _wikiListProgressHtml();
    }else{
      title='正在从云端加载文章列表…';
      desc='连接 wiki.edtib.com，读取文章清单。';
      progressHtml=_wikiListProgressHtml();
    }

    return '<div class="card"><div class="empty-state">'
      +'<div class="es-icon">'+icon('fileText','28')+'</div>'
      +'<div class="es-title">'+title+'</div>'
      +'<div class="es-desc">'+desc+'</div>'
      +progressHtml
      +retryBtn
      +'</div></div>';
  }
  _wikiEmptySince=0;

  const list=_wikiFilterDocs(docs);
  const terms=_wikiQueryTerms(_wikiSearch);
  const generated=(active.generatedAt||'').slice(0,10);
  const readCount=docs.filter(function(d){const m=_wikiMetaGet(d.file);return !!(m&&m.read);}).length;
  const starCount=docs.filter(function(d){const m=_wikiMetaGet(d.file);return !!(m&&m.star);}).length;
  const remoteN=_wikiRemoteList?_wikiRemoteList.length:0;
  const isLoadingList=_wikiRemoteListState==='loading';

  // 结果区：有关键词 → 命中行列表；否则 → 继续阅读 + 分组卡片（筛选模式下不显示继续阅读）
  let body='';
  if(terms.length){
    body=list.length
      ?'<div class="wiki-search-list">'+list.map(function(d){return _wikiHitRow(d,terms);}).join('')+'</div>'
      :_wikiEmptySearch();
  }else{
    body=(_wikiFilter?'':_wikiRecentStrip(docs))+_wikiList(list);
    if(!list.length)body=_wikiEmptyFilter();
  }

  return '<div class="card wiki-list-card">'
    +'<h2>'+icon('fileText','18')+'<span>专业解读</span>'
      +'<span class="tag info">'+docs.length+' 篇</span>'
      +(isCloud?'<span class="tag green">云端</span>':'')
      +(remoteN?'<span class="wiki-list-meta">线上 '+remoteN+' 篇</span>':'')
      +'<span class="wiki-list-meta">已读 '+readCount+' · 收藏 '+starCount
        +(generated?' · 索引更新于 '+escHtml(generated):'')+'</span>'
      +'<button type="button" class="btn sm" style="margin-left:auto" onclick="_wikiManualRefresh(this)" '+(isLoadingList?'disabled':'')+'>'
        +icon('refresh','14')+(isLoadingList?' 加载中…':' 更新')+'</button>'
    +'</h2>'
    +'<p class="wiki-intro">内置本地知识库：产品与材料方向的深度长页，支持全文检索、收藏、阅读进度与笔记，全部离线可用。点击卡片在应用内直接打开，也可在新窗口单独查看。</p>'
    +_wikiToolbar(docs)
    +body
    +'</div>';
}

/**
 * 手动刷新：重置 list.json 与云端 index.js 缓存，重新拉取后重渲染。
 * 用于校对本地文档与线上文章是否一致。
 */
/**
 * 渲染文章清单加载进度条：阶段文案 + 字节进度（已知 Content-Length 时）+ 动画条。
 * @returns {string} HTML 片段
 */
function _wikiListProgressHtml(){
  const stageMap={
    'connecting':'连接云端…',
    'downloading':'下载文章清单…',
    'parsing':'解析清单数据…',
    'done':'完成',
    'error':'失败'
  };
  const label=stageMap[_wikiListStage]||'准备中…';
  let pct=-1;
  if(_wikiListStage==='parsing'){
    pct=95;
  }else if(_wikiListStage==='connecting'){
    pct=10;
  }
  const barStyle=pct>=0
    ?'<div class="wiki-progress"><div class="wiki-progress-bar" style="width:'+pct+'%"></div></div>'
    :'<div class="wiki-progress wiki-progress-indeterminate"><div class="wiki-progress-bar"></div></div>';
  return '<div class="wiki-progress-wrap">'
    +'<div class="wiki-progress-label">'+icon('cloud','14')+' '+label+'</div>'
    +barStyle
    +'</div>';
}

function _wikiManualRefresh(btn){
  if(!WIKI_REMOTE_BASE){
    if(typeof toast==='function')toast('云端同步已禁用，仅显示本地文档','info');
    if(btn)btn.disabled=false;
    return;
  }
  if(btn)btn.disabled=true;
  // 重置所有状态
  _wikiRemoteList=null;
  _wikiRemoteListState='idle';
  _wikiRemote=null;
  _wikiRemoteState='idle';
  _wikiRemoteFailAt=0;
  _wikiRemoteListError='';
  _wikiListStage='connecting';
  _wikiListBytesLoaded=0;
  _wikiListBytesTotal=0;
  _wikiLoadStep=0;
  _wikiLoadRunning=false;
  _wikiKbAutoSyncTriggered=false;
  if(_wikiListHeartbeat){clearInterval(_wikiListHeartbeat);_wikiListHeartbeat=null;}
  // 重新启动串行加载
  _wikiLoadRunning=true;
  _wikiSequentialLoad();
  if(typeof toast==='function')toast('正在更新文章列表…','info');
}
