// core/kb.js — 本地知识库（纯前端 RAG，一期 BM25 关键词版）
/* ═══════════════════════════════════════════════════════════════
   设计要点：
   1. 独立 IndexedDB 库 wb_fastener_kb —— 与系统业务库 wb_fastener_idb、
      句柄持久化库 wb_fastener_fh 完全隔离，互不影响容量/性能，
      因此知识库元数据可以「尽量全」地存放（分块全文 + 索引），
      不需要为了省空间做轻量精简。
   2. 目录即知识库（模式A）：绑定本地目录后用 showDirectoryPicker 选取，
      文件原样留在原地，只把解析后的分块全文/词频索引写入独立库；
      提问时本地 BM25 打分取 Top-N 片段注入 system prompt，并带源文件标注。
   3. 解析：md/txt 直读文本；pdf 用 pdf.js 提取文本层；docx 用 mammoth 提取文本。
      （pdfjs/mammoth 由 main.js 按 Vite 依赖打包后挂到 window.__KB_DEPS）
   4. 检索纯本地 JS 计算，不依赖任何服务；回答侧仍走 DeepSeek/oMLX。
   ═══════════════════════════════════════════════════════════════ */
window.KB=(function(){
  const DB_NAME='wb_fastener_kb';
  const STORE='kb';          // 单 objectStore，key 分层：meta/dir/files/blocks
  const K_META='meta',K_DIR='dir',K_FILES='files',K_BLOCKS='blocks';
  const EXT_TEXT=['.md','.txt','.markdown','.log'];
  const EXT_PDF='.pdf';
  const EXT_DOCX='.docx';
  const DEFAULT_TOPN=4;
  const RESCAN_INTERVAL=5*60*1000;   // 定时增量更新间隔：目录新增/修改文件后最多 5 分钟内被同步进索引
  const MAX_FILE_CHARS=2_000_000;    // 单文件超过 200 万字符跳过（防御超长文件）
  const MAX_RECURSE_DEPTH=3;         // 递归遍历子目录最大深度
  const BLOCK_TARGET=500;            // 分块目标字数（400~600 区间取中）
  const MIN_SCORE=0.6;               // 相关度阈值：BM25 得分低于该值的片段不注入（省 token）

  let ready=false;                    // init 是否完成
  const state={
    bound:false,
    dirName:'',
    enabled:false,
    topN:DEFAULT_TOPN,
    cite:true,
    files:[],
    blocks:[],
    chars:0,
    indexedAt:0,
    indexing:false,
    error:''
  };
  let dirHandle=null;

  /* ---------- 独立 IndexedDB 封装（不复用 store.js 的库，彻底隔离） ---------- */
  function kbOpen(){
    return new Promise((res,rej)=>{
      const r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE);};
      r.onsuccess=()=>res(r.result);
      r.onerror=()=>rej(r.error||new Error('打开知识库 IndexedDB 失败'));
    });
  }
  async function kbGet(key){
    try{
      const db=await kbOpen();
      return new Promise((res,rej)=>{
        const tx=db.transaction(STORE,'readonly');
        const r=tx.objectStore(STORE).get(key);
        r.onsuccess=()=>res(r.result!==undefined?r.result:null);
        r.onerror=()=>rej(r.error);
      });
    }catch(e){return null;}
  }
  async function kbPut(key,val){
    const db=await kbOpen();
    return new Promise((res,rej)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(val,key);
      tx.oncomplete=()=>res();
      tx.onerror=()=>rej(tx.error);
    });
  }
  async function kbDelete(key){
    const db=await kbOpen();
    return new Promise((res,rej)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete=()=>res();
      tx.onerror=()=>rej(tx.error);
    });
  }

  /* ---------- 分词：中文 bi-gram + 英文/数字单词 ----------
     注意：返回结果不去重 —— BM25 需要真实词频（tf）与文档长度（dl），
     去重会令 tf 恒为 1、avgdl 失真，检索排序质量大幅下降；
     查询侧的去重由 bmQuery 内部单独处理。 */
  function tokenize(text){
    const t=String(text==null?'':text);
    const res=[];
    function add(w){
      if(!w||w.length<1)return;
      res.push(w);
    }
    const zhRe=/[\u4e00-\u9fa5]+/g;
    let m;
    while((m=zhRe.exec(t))){
      const w=m[0];
      if(w.length<=2){add(w);}
      else{for(let i=0;i+2<=w.length;i++)add(w.slice(i,i+2));}
    }
    const enRe=/[A-Za-z0-9]+(?:\.?[A-Za-z0-9])*/g;
    while((m=enRe.exec(t))){
      const w=m[0].toLowerCase();
      if(w.length>1)add(w);
    }
    return res;
  }

  /* ---------- BM25（纯前端本地计算） ---------- */
  let _bm=null; // {N, avgdl, df:{token:set(size)}, blocks:[{id,tokens,dlen}]}
  function buildBM(){
    const tokensByBlock=state.blocks.map(b=>tokenize(b.text));
    const N=state.blocks.length;
    const df={};
    let totalDl=0;
    const dls=[];
    for(let i=0;i<N;i++){
      const ts=tokensByBlock[i];
      dls.push(ts.length);totalDl+=ts.length;
      const uniq={};
      for(const w of ts)uniq[w]=1;
      for(const w in uniq){if(!df[w])df[w]=0;df[w]++;}
    }
    const avgdl=N?totalDl/N:0;
    // 预缓存每块 token 计数，避免重复遍历
    _bm={N,avgdl,df,dls,tokensByBlock};
    return _bm;
  }
  const K1=1.5,B=0.75;
  function bmQuery(queryTokens){
    if(!state.blocks.length)return [];
    const bm=_bm||buildBM();
    const qt=[];
    {const seen={};for(const w of queryTokens){if(seen[w])continue;seen[w]=1;qt.push(w);}}
    if(!qt.length)return [];
    const scores=[];
    for(let i=0;i<bm.N;i++){
      let s=0;
      const terms={};
      const ts=bm.tokensByBlock[i];
      for(const w of ts){if(terms[w])terms[w]++;else terms[w]=1;}
      for(const w of qt){
        const tf=terms[w]||0;
        if(!tf)continue;
        const dfn=bm.df[w]||0;
        const idf=Math.log((bm.N-dfn+0.5)/(dfn+0.5)+1);
        const dl=bm.dls[i]||0;
        const denom=tf+K1*(1-B+B*(bm.avgdl?dl/bm.avgdl:0));
        s+=idf*(tf*(K1+1))/(denom||1);
      }
      if(s>0)scores.push({i,score:s});
    }
    scores.sort((a,b)=>b.score-a.score);
    // 相关度阈值过滤：低于 MIN_SCORE 的弱命中不注入，省 token 且避免无关片段干扰
    return scores.filter(x=>x.score>=MIN_SCORE).slice(0,state.topN);
  }

  /* ---------- 文本解析 ---------- */
  function extOf(name){const i=name.lastIndexOf('.');return i>=0?name.slice(i).toLowerCase():'';}
  function isSupported(fileName){const e=extOf(fileName);return EXT_TEXT.includes(e)||e===EXT_PDF||e===EXT_DOCX;}
  function splitBlocks(fileName,text,linePages){
    const t=String(text==null?'':text).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    const lines=t.split('\n');
    const blocks=[];let cur='';let curChapter='';let curPage=0;
    const flush=()=>{
      const s=cur.replace(/\n{2,}/g,'\n').trim();
      if(s){blocks.push({text:s,chapter:curChapter||'',page:curPage||0});}
      cur='';
    };
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(!cur)curPage=(linePages&&linePages[i])||0;
      const isHeading=/^\s*#{1,6}\s/.test(line);
      const isBlank=/^\s*$/.test(line);
      if(isHeading&&!isBlank){
        const h=line.replace(/^\s*#{1,6}\s+/,'').trim();
        if(cur&&cur.length>=40)flush();        // 避免把标题吞进上一块尾部
        curChapter=h;                           // 新块隶属该章节
      }
      cur+=(cur? '\n':'')+line;
      if(cur.length>=BLOCK_TARGET&&(isHeading||isBlank))flush();
      // 连续文本过长时按段落硬切
      if(cur.length>=BLOCK_TARGET*1.5){flush();}
    }
    flush();
    return blocks;
  }
  async function parseFile(fileName,fileHandle){
    const e=extOf(fileName);
    const file=await fileHandle.getFile();
    if(file.size>MAX_FILE_CHARS*4&&e===EXT_PDF){return null;} // 防御超大
    if(EXT_TEXT.includes(e)){
      const buf=await file.arrayBuffer();
      // UTF-8 直读；带 BOM 自动剥除
      let text=new TextDecoder('utf-8').decode(buf);
      if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
      if(text.length>MAX_FILE_CHARS)text=text.slice(0,MAX_FILE_CHARS);
      return {text,chars:text.length,page:0,linePages:null};
    }
    if(e===EXT_PDF){
      const deps=window.__KB_DEPS||{};
      if(!deps.pdfjs){throw new Error('PDF 解析器未加载，请刷新页面后重试');}
      // 注意：pdfjs-dist v6 的 PDFDocumentProxy 已无 destroy()，
      // 正确的销毁入口是 loadingTask.destroy()；旧写法会导致「提取已全部完成」
      // 却在最后一步报错而整个文件作废。清理放进 finally 且失败不影响结果。
      let task=null,pdf=null;
      try{
        try{
          task=deps.pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
          pdf=await task.promise;
        }catch(err){
          throw new Error('PDF 解析失败'+(err&&err.message?'：'+String(err.message).slice(0,120):'')+'；请重新构建/刷新后重试');
        }
        const pageTexts=[];
      const maxPages=Math.min(pdf.numPages,200);
      for(let p=1;p<=maxPages;p++){
        try{
          const page=await pdf.getPage(p);
          const tc=await page.getTextContent();
          const itemTexts=tc.items.map(it=>(it&&it.str)||'').join(' ');
          pageTexts.push(itemTexts);
        }catch(err){/* 单页失败跳过 */}
      }
      // 按行对齐页码：逐页展开为「行+页码」，确保分块能记录到精准页码
      const rows=[];const lp=[];
      pageTexts.forEach(function(pt,idx){
        const lines=pt.replace(/[ \t]{2,}/g,' ').split('\n');
        for(let i=0;i<lines.length;i++){rows.push(lines[i]);lp.push(idx+1);}
      });
      let full=rows.join('\n').replace(/\n{2,}/g,'\n').trim();
      let fullPages=full.length?lp.slice(0,rows.length):[];
      // MAX_FILE_CHARS 截断时同步截行级页码（保持对齐）
      if(full.length>MAX_FILE_CHARS){
        let acc=0,end=0;
        while(end<rows.length&&acc+rows[end].length+1<=MAX_FILE_CHARS){acc+=rows[end].length+1;end++;}
        full=rows.slice(0,end).join('\n');
        fullPages=end?lp.slice(0,end):[];
      }
      return {text:full,chars:full.length,page:maxPages,linePages:fullPages};
      }finally{
        // 资源释放：优先 loadingTask.destroy()；任一清理失败仅告警，绝不影响已提取的结果
        try{if(task&&typeof task.destroy==='function'){await task.destroy();}}catch(e){console.warn('[KB] PDF 资源释放失败(loadingTask)',e);}
        if(!task||typeof task.destroy!=='function'){
          try{if(pdf&&typeof pdf.cleanup==='function')await pdf.cleanup();}catch(e){/* 忽略 */}
        }
      }
    }
    if(e===EXT_DOCX){
      const deps=window.__KB_DEPS||{};
      if(!deps.mammoth){throw new Error('docx 解析器未加载，请刷新页面后重试');}
      const res=await deps.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
      let text=(res&&res.value)||'';
      if(text.length>MAX_FILE_CHARS)text=text.slice(0,MAX_FILE_CHARS);
      return {text,chars:text.length,page:0,linePages:null};
    }
    return null;
  }

  /* ---------- 递归遍历目录（只读，不改动任何文件） ---------- */
  async function walkDir(dir,prefix,depth,out,errs){
    if(depth>MAX_RECURSE_DEPTH)return;
    const entries=[];
    try{for await(const entry of dir.values())entries.push(entry);}
    catch(e){errs.push((prefix||dir.name)+': 无法读取目录内容'+(e&&e.name?'('+e.name+')':''));return;}
    for(const entry of entries){
      const name=entry.name;
      if(name.startsWith('.')||name==='node_modules')continue;
      const rel=prefix?prefix+'/'+name:name;
      if(entry.kind==='directory'){
        await walkDir(entry,rel,depth+1,out,errs);
      }else if(entry.kind==='file'&&isSupported(name)){
        out.push({name:name,rel:rel,handle:entry});
      }
    }
  }

  /* ---------- 绑定目录 + 索引（支持增量模式） ----------
     opts.incremental=true 时与上次清单逐文件比对 lastModified+size：
     未变化的文件直接复用旧分块（不重新读盘解析），只有新增/变更/删除被处理。
     用于定时静默更新 —— 目录新增或修改了文件也能自动同步进索引。 */
  async function indexDir(dir,opts){
    opts=opts||{};const incremental=!!opts.incremental;
    state.indexing=true;state.error='';
    try{
      const found=[];const errs=[];
      await walkDir(dir,'',0,found,errs);
      // 上轮清单/分块（仅增量模式使用）：rel → 文件记录；rel → 旧分块列表
      const prevByRel={};
      if(incremental)(state.files||[]).forEach(function(f){if(f&&f.rel)prevByRel[f.rel]=f;});
      const oldBlocksByRel={};
      if(incremental){
        (state.blocks||[]).forEach(function(b){
          if(!b||b.text==null)return;
          const f=(state.files||[])[b.file];
          if(!f||!f.rel)return;
          (oldBlocksByRel[f.rel]=oldBlocksByRel[f.rel]||[]).push({text:b.text,chapter:b.chapter||'',page:b.page||0});
        });
      }
      // 采样现文件的 stat（lastModified/size），兼供全量记录与增量比对
      const statByRel={};
      for(let i=0;i<found.length;i++){
        try{const st=await found[i].handle.getFile();statByRel[found[i].rel]={lastModified:st.lastModified||0,size:st.size||0};}catch(e){}
      }
      if(!found.length){
        state.bound=true;state.dirName=dir.name;state.files=[];state.blocks=[];state.chars=0;state.indexedAt=Date.now();
        await kbPut(K_DIR,dir);
        await kbPut(K_META,{bound:true,dirName:dir.name,enabled:state.enabled,topN:state.topN,cite:state.cite,indexedAt:state.indexedAt});
        await kbPut(K_FILES,[]);
        await kbPut(K_BLOCKS,[]);
        _bm=null;
        return {ok:true,files:0,blocks:0,reads:0,scanned:0,errors:errs.slice()};
      }
      // 第一遍：逐文件判定「复用旧分块」还是「重新解析」，产出最终 files 记录
      const finalFiles=[];const newBlocksRaw={};const reusedRels={};
      let totalChars=0;let reads=0;const errors=[];
      for(let i=0;i<found.length;i++){
        const f=found[i];
        if(!f.handle)continue;
        const prev=prevByRel[f.rel];const st=statByRel[f.rel]||{lastModified:0,size:0};
        const canReuse=incremental&&prev&&oldBlocksByRel[f.rel]&&(prev.lastModified===st.lastModified)&&(prev.size===st.size);
        if(canReuse){
          reusedRels[f.rel]=1;
          finalFiles.push(Object.assign({},prev,{id:finalFiles.length,lastModified:st.lastModified,size:st.size}));
          totalChars+=Number(prev.chars)||0;reads++;
          continue;
        }
        try{
          const r=await parseFile(f.name,f.handle);
          if(r&&r.chars>0){
            const btexts=splitBlocks(f.name,r.text,r.linePages);
            newBlocksRaw[f.rel]=btexts;
            finalFiles.push({id:-1,name:f.name,rel:f.rel,chars:r.chars,pages:r.page,blocks:btexts.length,size:st.size,lastModified:st.lastModified});
            totalChars+=r.chars;reads++;
          }
          // 提取不到文本的文件：与旧版一致静默跳过
        }catch(e){
          errors.push(f.name+': '+(e&&e.message?e.message:'解析失败'));
        }
      }
      // 第二遍：按最终下标统一组装分块（复用块 + 新解析块，file/index/id 全部对齐）
      const finalBlocks=[];
      finalFiles.forEach(function(rec,nid){
        rec.id=nid;
        const src=reusedRels[rec.rel]?oldBlocksByRel[rec.rel]:newBlocksRaw[rec.rel];
        (src||[]).forEach(function(bt,bi){
          finalBlocks.push({id:nid+':'+bi,file:nid,index:bi,text:bt.text,chapter:bt.chapter||'',page:bt.page||0});
        });
      });
      state.bound=true;state.dirName=dir.name;state.files=finalFiles;state.blocks=finalBlocks;state.chars=totalChars;state.indexedAt=Date.now();
      await kbPut(K_DIR,dir);
      await kbPut(K_META,{bound:true,dirName:dir.name,enabled:state.enabled,topN:state.topN,cite:state.cite,indexedAt:state.indexedAt});
      await kbPut(K_FILES,finalFiles);
      await kbPut(K_BLOCKS,finalBlocks);
      _bm=null;
      return {ok:true,files:finalFiles.length,blocks:finalBlocks.length,reads:reads,scanned:found.length,errors:errs.concat(errors)};
    }finally{
      state.indexing=false;
    }
  }

  /* ---------- 定时静默更新（增量）：目录新增/修改文件后自动同步进索引 ---------- */
  let autoTimer=null;
  function startAutoScan(){
    if(autoTimer)return;
    autoTimer=setInterval(function(){
      if(document.visibilityState!=='visible')return; // 页面不可见时不空耗
      if(state.indexing||!state.bound)return;
      if(Date.now()-state.indexedAt<RESCAN_INTERVAL)return;
      silentRescan('auto');
    },RESCAN_INTERVAL);
  }
  function stopAutoScan(){if(autoTimer){clearInterval(autoTimer);autoTimer=null;}}
  /** 静默增量重扫：不弹提示不打断；完成后若数据管理页打开则刷新其知识库区块 */
  async function silentRescan(reason){
    if(!dirHandle){try{const d=await kbGet(K_DIR);if(d)dirHandle=d;}catch(e){}}
    if(!dirHandle)return;
    try{
      const r=await indexDir(dirHandle,{incremental:true});
      console.info('[KB] 定时更新完成：'+r.files+' 个文件 · '+r.blocks+' 个分块'+(reason?' ('+reason+')':''));
      if(typeof _kbRefreshBox==='function'&&view==='data'){try{_kbRefreshBox();}catch(e){}}
    }catch(e){console.warn('[KB] 定时更新失败',e);}
  }
  /** 提问前调用：距上次索引超过间隔时，后台触发一次增量更新（不阻塞本次回答） */
  function ensureFresh(){
    if(!state.enabled||!state.bound)return;
    if(Date.now()-state.indexedAt<RESCAN_INTERVAL)return;
    if(state.indexing)return;
    silentRescan('send');
  }

  /* ---------- 从独立库恢复（应用启动时调用） ---------- */
  async function init(){
    if(ready)return state;
    const meta=await kbGet(K_META);
    if(meta&&meta.bound){
      state.bound=true;state.dirName=meta.dirName||'';
      state.enabled=!!meta.enabled;state.topN=meta.topN||DEFAULT_TOPN;state.cite=meta.cite!==false;
      state.indexedAt=meta.indexedAt||0;
      const files=await kbGet(K_FILES);const blocks=await kbGet(K_BLOCKS);
      state.files=Array.isArray(files)?files:[];
      // 兼容旧版本存储的纯字符串分块，归一化为带元数据块
      state.blocks=Array.isArray(blocks)?blocks.map(b=>typeof b==='string'?{text:b,chapter:'',page:0}:b):[];
      state.chars=state.blocks.reduce((s,b)=>s+(b.text?b.text.length:0),0);
      dirHandle=await kbGet(K_DIR);
      _bm=null;
      startAutoScan(); // 恢复绑定后自动开启定时增量更新
    }
    ready=true;
    return state;
  }

  /* ---------- 对外操作 ---------- */
  async function chooseDir(){
    if(!('showDirectoryPicker' in window)){
      state.error='当前环境不支持目录选择 API（请使用 Chrome/Edge 浏览器）';
      return {ok:false,error:state.error};
    }
    let dir;
    try{dir=await window.showDirectoryPicker({mode:'read'});}
    catch(e){if(e&&e.name==='AbortError')return {ok:false,cancelled:true};return {ok:false,error:'选择目录失败'};}
    if(!dir)return {ok:false,cancelled:true};
    // 只读授权：目录绑定只读即可（正文留原目录，不改文件）
    try{
      if((await dir.queryPermission({mode:'read'}))!=='granted'){
        if((await dir.requestPermission({mode:'read'}))!=='granted'){
          return {ok:false,error:'未获得目录读取权限，请在弹窗中点「允许」后重试'};
        }
      }
    }catch(e){/* 部分环境权限 API 受限，先尝试解析 */}
    dirHandle=dir;
    const r=await indexDir(dir);
    startAutoScan();
    return r;
  }
  async function rescan(){
    if(!dirHandle){
      const d=await kbGet(K_DIR);if(d)dirHandle=d;
    }
    if(!dirHandle)return {ok:false,error:'尚未绑定知识库目录'};
    const r=await indexDir(dirHandle,{incremental:false});
    startAutoScan();
    return r;
  }
  async function unbind(){
    stopAutoScan();
    dirHandle=null;
    await Promise.all([kbDelete(K_META),kbDelete(K_DIR),kbDelete(K_FILES),kbDelete(K_BLOCKS)]);
    Object.assign(state,{bound:false,dirName:'',enabled:false,files:[],blocks:[],chars:0,indexedAt:0,error:''});
    _bm=null;
    return {ok:true};
  }
  function setEnabled(v){state.enabled=!!v;persistMeta();return state.enabled;}
  function setTopN(n){const v=Math.max(1,Math.min(10,parseInt(n,10)||DEFAULT_TOPN));state.topN=v;persistMeta();return v;}
  function setCite(v){state.cite=!!v;persistMeta();return state.cite;}
  function persistMeta(){
    if(state.bound){
      kbPut(K_META,{bound:true,dirName:state.dirName,enabled:state.enabled,topN:state.topN,cite:state.cite,indexedAt:state.indexedAt});
    }
  }
  /** 提问时检索 Top-N 片段并组装为注入 system prompt 的知识块（带源标注） */
  function buildPromptBlock(question){
    if(!state.enabled||!state.blocks.length)return '';
    const qTokens=tokenize(question||'');
    const hits=bmQuery(qTokens);
    if(!hits.length)return '';
    const parts=hits.map(hit=>{
      const b=state.blocks[hit.i];
      const f=(b&&typeof b.file==='number')?state.files[b.file]:null;
      const name=(f&&f.name)?f.name:'未知来源';
      const meta=[];
      if(b.chapter)meta.push('章节：'+b.chapter);
      if(b.page)meta.push('第'+b.page+'页');
      const tag=meta.length?' · '+meta.join(' | '):'';
      const text=b.text.length>900?b.text.slice(0,900)+'…':b.text;
      return '【'+name+tag+'】\n'+text;
    });
    return '【知识库参考】（以下内容来自本地知识库目录，检索命中。回答时若与问题相关请优先采用；引用具体内容时在句末标注【依据：文件名】，文件名见各条来源。）\n'+parts.join('\n\n');
  }
  /** 定位某文件的所有分块全文（供引用点开查看原文） */
  async function fileBlocks(relOrName){
    await init();
    const f=state.files.find(x=>x.rel===relOrName||x.name===relOrName);
    if(!f)return [];
    return state.blocks.filter(b=>b.file===f.id);
  }
  /** 供应设置弹窗/状态展示的摘要 */
  function summarize(){
    return {
      bound:state.bound,dirName:state.dirName,enabled:state.enabled,topN:state.topN,cite:state.cite,
      files:state.files.length,blocks:state.blocks.length,chars:state.chars,
      indexedAt:state.indexedAt,indexing:state.indexing,error:state.error
    };
  }

  return {
    init,chooseDir,rescan,unbind,setEnabled,setTopN,setCite,
    buildPromptBlock,fileBlocks,summarize,state,
    tokenize,splitBlocks,isSupported,bmQuery,
    ensureFresh,startAutoScan,stopAutoScan
  };
})();
// 初始化时机：由 app.js 的 bootApp 异步挂载（不阻塞首屏），见 app.js
