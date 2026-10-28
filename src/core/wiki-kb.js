// core/wiki-kb.js — 线上文章知识库（自动同步 + BM25 检索）
/* ═══════════════════════════════════════════════════════════════
   设计要点：
   1. 独立 IndexedDB 库 wb_fastener_wiki_kb —— 与业务库、文件知识库隔离
   2. 定时从 https://wiki.edtib.com/wiki/list.json 拉取文章列表
   3. 增量同步：依据 url + updated_at 识别新增/更新，仅处理变化文章
   4. 抓取正文 → 提取纯文本 → 分块 → BM25 索引
   5. 提供 search / buildPromptBlock 接口供 AI 问答使用
   ═══════════════════════════════════════════════════════════════ */
window.WikiKB=(function(){
  'use strict';

  const DB_NAME='wb_fastener_wiki_kb';
  const STORE='data';
  const K_META='meta';
  const K_ARTICLES='articles';
  const K_BLOCKS='blocks';

  const LIST_URL='https://wiki.edtib.com/wiki/list.json';
  const DEFAULT_SYNC_INTERVAL=24*60*60*1000;
  const FETCH_TIMEOUT=30000;
  const MAX_ARTICLE_CHARS=500000;
  const BLOCK_TARGET=500;
  const MIN_SCORE=0.6;
  const DEFAULT_TOPN=4;
  const MAX_SNIPPET_CHARS=300;

  const state={
    enabled:true,
    articles:[],
    blocks:[],
    chars:0,
    lastSyncAt:0,
    syncing:false,
    error:'',
    topN:DEFAULT_TOPN
  };

  let _bm=null;
  let _syncTimer=null;
  let _ready=false;

  /* ---------- IndexedDB 封装 ---------- */
  function dbOpen(){
    return new Promise(function(res,rej){
      const r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=function(){
        if(!r.result.objectStoreNames.contains(STORE)){
          r.result.createObjectStore(STORE);
        }
      };
      r.onsuccess=function(){res(r.result);};
      r.onerror=function(){rej(r.error||new Error('打开 WikiKB IndexedDB 失败'));};
    });
  }
  async function dbGet(key){
    try{
      const db=await dbOpen();
      return new Promise(function(res,rej){
        const tx=db.transaction(STORE,'readonly');
        const r=tx.objectStore(STORE).get(key);
        r.onsuccess=function(){res(r.result!==undefined?r.result:null);};
        r.onerror=function(){rej(r.error);};
      });
    }catch(e){return null;}
  }
  async function dbPut(key,val){
    try{
      const db=await dbOpen();
      return new Promise(function(res,rej){
        const tx=db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).put(val,key);
        tx.oncomplete=function(){res();};
        tx.onerror=function(){rej(tx.error);};
      });
    }catch(e){}
  }

  /* ---------- HTML 文本提取 ---------- */
  function extractText(html){
    try{
      const doc=new DOMParser().parseFromString(html,'text/html');
      const main=doc.querySelector('article')||doc.querySelector('main')||doc.querySelector('.content')||doc.body;
      if(!main)return '';
      const nav=main.querySelectorAll('nav,header,footer,aside,.nav,.header,.footer,.sidebar,.menu,.toc,.references');
      for(let i=0;i<nav.length;i++){if(nav[i].parentNode)nav[i].parentNode.removeChild(nav[i]);}
      return (main.textContent||'').replace(/\s+/g,' ').trim();
    }catch(e){
      return String(html||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    }
  }

  /* ---------- 分词：复用 KB.tokenize（中文 bi-gram + 英文/数字单词） ---------- */
  function tokenize(text){
    if(typeof KB!=='undefined'&&typeof KB.tokenize==='function')return KB.tokenize(text);
    const t=String(text==null?'':text);
    const res=[];
    const zhRe=/[\u4e00-\u9fa5]+/g;
    let m;
    while((m=zhRe.exec(t))){
      const w=m[0];
      if(w.length<=2)res.push(w);
      else for(let i=0;i+2<=w.length;i++)res.push(w.slice(i,i+2));
    }
    const enRe=/[A-Za-z0-9]+(?:\.?[A-Za-z0-9])*/g;
    while((m=enRe.exec(t))){
      const w=m[0].toLowerCase();
      if(w.length>1)res.push(w);
    }
    return res;
  }

  /* ---------- 文本分块 ---------- */
  function splitBlocks(text){
    const t=String(text==null?'':text).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    const blocks=[];
    let cur='';
    const lines=t.split('\n');
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      const isHeading=/^\s*#{1,6}\s/.test(line);
      const isBlank=/^\s*$/.test(line);
      if(isHeading&&!isBlank){
        if(cur&&cur.length>=40){
          blocks.push(cur.replace(/\n{2,}/g,'\n').trim());
          cur='';
        }
      }
      cur+=(cur?'\n':'')+line;
      if(cur.length>=BLOCK_TARGET&&(isHeading||isBlank)){
        const s=cur.replace(/\n{2,}/g,'\n').trim();
        if(s)blocks.push(s);
        cur='';
      }
      if(cur.length>=BLOCK_TARGET*1.5){
        const s=cur.replace(/\n{2,}/g,'\n').trim();
        if(s)blocks.push(s);
        cur='';
      }
    }
    if(cur.trim())blocks.push(cur.trim());
    return blocks;
  }

  /* ---------- BM25 索引 ---------- */
  function buildBM(){
    const tokensByBlock=state.blocks.map(function(b){return tokenize(b.text);});
    const N=state.blocks.length;
    const df={};
    let totalDl=0;
    const dls=[];
    for(let i=0;i<N;i++){
      const ts=tokensByBlock[i];
      dls.push(ts.length);
      totalDl+=ts.length;
      const uniq={};
      for(const w of ts)uniq[w]=1;
      for(const w in uniq){
        if(!df[w])df[w]=0;
        df[w]++;
      }
    }
    const avgdl=N?totalDl/N:0;
    _bm={N:N,avgdl:avgdl,df:df,dls:dls,tokensByBlock:tokensByBlock};
    return _bm;
  }

  const K1=1.5,B_COEFF=0.75;
  function bmQuery(queryTokens,limit){
    if(!state.blocks.length)return [];
    const bm=_bm||buildBM();
    const qt=[];
    const seen={};
    for(const w of queryTokens){
      if(seen[w])continue;
      seen[w]=1;
      qt.push(w);
    }
    if(!qt.length)return [];
    const scores=[];
    for(let i=0;i<bm.N;i++){
      let s=0;
      const terms={};
      const ts=bm.tokensByBlock[i];
      for(const w of ts){
        if(terms[w])terms[w]++;
        else terms[w]=1;
      }
      for(const w of qt){
        const tf=terms[w]||0;
        if(!tf)continue;
        const dfn=bm.df[w]||0;
        const idf=Math.log((bm.N-dfn+0.5)/(dfn+0.5)+1);
        const dl=bm.dls[i]||0;
        const denom=tf+K1*(1-B_COEFF+B_COEFF*(bm.avgdl?dl/bm.avgdl:0));
        s+=idf*(tf*(K1+1))/(denom||1);
      }
      if(s>0)scores.push({i:i,score:s});
    }
    scores.sort(function(a,b){return b.score-a.score;});
    const cap=(limit&&limit>0)?limit:state.topN;
    return scores.filter(function(x){return x.score>=MIN_SCORE;}).slice(0,cap);
  }

  /* ---------- 同步逻辑 ---------- */
  async function fetchWithTimeout(url,timeoutMs){
    const ctrl=new AbortController();
    const timer=setTimeout(function(){ctrl.abort();},timeoutMs||FETCH_TIMEOUT);
    try{
      const resp=await fetch(url,{signal:ctrl.signal});
      clearTimeout(timer);
      return resp;
    }catch(e){
      clearTimeout(timer);
      throw e;
    }
  }

  async function fetchArticleContent(url){
    try{
      const resp=await fetchWithTimeout(url);
      if(!resp.ok)throw new Error('HTTP '+resp.status);
      const html=await resp.text();
      return extractText(html);
    }catch(e){
      console.warn('[WikiKB] 文章抓取失败：'+url,e);
      return null;
    }
  }

  async function sync(){
    if(state.syncing)return {ok:false,error:'同步进行中'};
    state.syncing=true;
    state.error='';
    try{
      const resp=await fetchWithTimeout(LIST_URL);
      if(!resp.ok)throw new Error('HTTP '+resp.status);
      const list=await resp.json();
      if(!Array.isArray(list))throw new Error('列表格式非法');

      const oldByURL={};
      state.articles.forEach(function(a){oldByURL[a.url]=a;});

      const newArticles=[];
      const blocksByArticle={};
      let totalChars=0;
      let newCount=0;
      let updatedCount=0;

      for(let i=0;i<list.length;i++){
        const entry=list[i];
        if(!entry||!entry.url||!entry.title)continue;
        const url=String(entry.url);
        const title=String(entry.title);
        const updatedAt=entry.updated_at||'';

        const old=oldByURL[url];
        if(old&&old.updatedAt===updatedAt&&old.text){
          newArticles.push(old);
          blocksByArticle[old.id]=old.blocks||[];
          totalChars+=old.chars||0;
          continue;
        }

        if(old)updatedCount++;
        else newCount++;

        const text=await fetchArticleContent(url);
        if(text===null){
          if(old)newArticles.push(old);
          continue;
        }

        const id='wiki_'+i;
        const trimmed=text.length>MAX_ARTICLE_CHARS?text.slice(0,MAX_ARTICLE_CHARS):text;
        const blockTexts=splitBlocks(trimmed);
        const blocks=blockTexts.map(function(bt,bi){
          return {id:id+':'+bi,articleId:id,index:bi,text:bt};
        });

        const article={
          id:id,
          title:title,
          url:url,
          updatedAt:updatedAt,
          text:trimmed,
          chars:trimmed.length,
          blocks:blocks,
          syncedAt:Date.now()
        };

        newArticles.push(article);
        blocksByArticle[id]=blocks;
        totalChars+=trimmed.length;
      }

      const allBlocks=[];
      newArticles.forEach(function(a){
        const blks=blocksByArticle[a.id]||[];
        blks.forEach(function(b){allBlocks.push(b);});
      });

      state.articles=newArticles;
      state.blocks=allBlocks;
      state.chars=totalChars;
      state.lastSyncAt=Date.now();
      state.error='';
      _bm=null;

      await dbPut(K_ARTICLES,newArticles);
      await dbPut(K_BLOCKS,allBlocks);
      await dbPut(K_META,{
        enabled:state.enabled,
        topN:state.topN,
        lastSyncAt:state.lastSyncAt
      });

      console.info('[WikiKB] 同步完成：'+newArticles.length+' 篇文章，'+allBlocks.length+' 个分块（新增 '+newCount+'，更新 '+updatedCount+'）');
      return {ok:true,articles:newArticles.length,blocks:allBlocks.length,newCount:newCount,updatedCount:updatedCount};
    }catch(e){
      const msg=e&&e.message?e.message:String(e);
      state.error='同步失败：'+msg;
      console.warn('[WikiKB] 同步失败',e);
      return {ok:false,error:state.error};
    }finally{
      state.syncing=false;
    }
  }

  /* ---------- 检索接口 ---------- */
  function search(query,opts){
    opts=opts||{};
    if(!state.enabled||!state.blocks.length)return {ok:true,count:0,hits:[]};
    const qTokens=tokenize(query||'');
    if(!qTokens.length)return {ok:true,count:0,hits:[]};
    const limit=opts.topN?(function(){
      const v=Math.max(1,Math.min(10,parseInt(opts.topN,10)||DEFAULT_TOPN));
      return v;
    })():state.topN;
    const hits=bmQuery(qTokens,limit);
    const out=hits.map(function(hit){
      const b=state.blocks[hit.i];
      const a=state.articles.find(function(x){return x.id===b.articleId;});
      const title=(a&&a.title)||'未知文章';
      const url=(a&&a.url)||'';
      const text=b.text||'';
      const snippet=text.length>MAX_SNIPPET_CHARS?(text.slice(0,MAX_SNIPPET_CHARS)+'…'):text;
      return {
        title:title,
        url:url,
        score:Number(hit.score.toFixed(3)),
        snippet:snippet
      };
    });
    return {ok:true,count:out.length,hits:out};
  }

  function buildPromptBlock(question){
    if(!state.enabled||!state.blocks.length)return '';
    const r=search(question);
    if(!r.ok||!r.hits.length)return '';
    const parts=r.hits.map(function(hit){
      return '【'+hit.title+'】('+hit.url+')\n'+hit.snippet;
    });
    return '【线上知识库参考】（以下内容来自 wiki.edtib.com 同步文章，检索命中。回答时若与问题相关请优先采用；引用具体内容时在句末标注【依据：文章标题】，标题见各条来源。）\n'+parts.join('\n\n');
  }

  function getArticle(titleOrUrl){
    const key=String(titleOrUrl||'').toLowerCase();
    return state.articles.find(function(a){
      return (a.title||'').toLowerCase()===key||(a.url||'').toLowerCase()===key;
    })||null;
  }

  function listArticles(keyword){
    let list=state.articles.map(function(a){
      return {
        title:a.title||'',
        url:a.url||'',
        chars:a.chars||0,
        blocks:(a.blocks||[]).length,
        updatedAt:a.updatedAt||'',
        syncedAt:a.syncedAt||0
      };
    });
    if(keyword){
      const kw=String(keyword).toLowerCase();
      list=list.filter(function(a){
        return (a.title||'').toLowerCase().includes(kw);
      });
    }
    return {ok:true,count:list.length,articles:list};
  }

  function summarize(){
    return {
      enabled:state.enabled,
      articles:state.articles.length,
      blocks:state.blocks.length,
      chars:state.chars,
      lastSyncAt:state.lastSyncAt,
      syncing:state.syncing,
      error:state.error,
      topN:state.topN
    };
  }

  /* ---------- 定时同步 ---------- */
  function startAutoSync(){
    if(_syncTimer)return;
    _syncTimer=setInterval(function(){
      if(!state.enabled)return;
      if(Date.now()-state.lastSyncAt<DEFAULT_SYNC_INTERVAL)return;
      if(state.syncing)return;
      sync();
    },DEFAULT_SYNC_INTERVAL);
  }

  function stopAutoSync(){
    if(_syncTimer){
      clearInterval(_syncTimer);
      _syncTimer=null;
    }
  }

  function ensureFresh(){
    if(!state.enabled)return;
    if(Date.now()-state.lastSyncAt<DEFAULT_SYNC_INTERVAL)return;
    if(state.syncing)return;
    sync();
  }

  /* ---------- 初始化 / 配置 ---------- */
  async function init(){
    if(_ready)return state;
    const meta=await dbGet(K_META);
    if(meta){
      state.enabled=meta.enabled!==false;
      state.topN=meta.topN||DEFAULT_TOPN;
      state.lastSyncAt=meta.lastSyncAt||0;
    }
    const articles=await dbGet(K_ARTICLES);
    const blocks=await dbGet(K_BLOCKS);
    state.articles=Array.isArray(articles)?articles:[];
    state.blocks=Array.isArray(blocks)?blocks:[];
    state.chars=state.blocks.reduce(function(s,b){return s+(b.text?b.text.length:0);},0);
    _bm=null;
    _ready=true;
    startAutoSync();
    return state;
  }

  function setEnabled(v){
    state.enabled=!!v;
    dbPut(K_META,{enabled:state.enabled,topN:state.topN,lastSyncAt:state.lastSyncAt});
    return state.enabled;
  }

  function setTopN(n){
    const v=Math.max(1,Math.min(10,parseInt(n,10)||DEFAULT_TOPN));
    state.topN=v;
    dbPut(K_META,{enabled:state.enabled,topN:state.topN,lastSyncAt:state.lastSyncAt});
    return v;
  }

  async function clearAll(){
    state.articles=[];
    state.blocks=[];
    state.chars=0;
    state.lastSyncAt=0;
    state.error='';
    _bm=null;
    await dbPut(K_ARTICLES,[]);
    await dbPut(K_BLOCKS,[]);
    await dbPut(K_META,{enabled:state.enabled,topN:state.topN,lastSyncAt:0});
    return {ok:true};
  }

  return {
    init:init,
    sync:sync,
    search:search,
    buildPromptBlock:buildPromptBlock,
    getArticle:getArticle,
    listArticles:listArticles,
    summarize:summarize,
    setEnabled:setEnabled,
    setTopN:setTopN,
    clearAll:clearAll,
    ensureFresh:ensureFresh,
    startAutoSync:startAutoSync,
    stopAutoSync:stopAutoSync,
    state:state
  };
})();
