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

  /* ---------- 分词：中文 bi-gram + 英文/数字单词 ---------- */
  function tokenize(text){
    const t=String(text==null?'':text);
    const res=[];
    const seen={};
    function add(w){
      if(!w||w.length<1)return;
      if(seen[w])return;seen[w]=1;
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
      if(!deps.pdfjs){throw new Error('pdf.js 未加载');}
      const pdf=await deps.pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
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
      await pdf.destroy();
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
    }
    if(e===EXT_DOCX){
      const deps=window.__KB_DEPS||{};
      if(!deps.mammoth){throw new Error('mammoth 未加载');}
      const res=await deps.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
      const text=(res&&res.value)||'';
      if(text.length>MAX_FILE_CHARS)text.slice(0,MAX_FILE_CHARS);
      return {text,chars:text.length,page:0,linePages:null};
    }
    return null;
  }

  /* ---------- 递归遍历目录（只读，不改动任何文件） ---------- */
  async function walkDir(dir,prefix,depth,out){
    if(depth>MAX_RECURSE_DEPTH)return;
    const entries=[];
    try{for await(const entry of dir.values())entries.push(entry);}catch(e){return;}
    for(const entry of entries){
      const name=entry.name;
      if(name.startsWith('.')||name==='node_modules')continue;
      const rel=prefix?prefix+'/'+name:name;
      if(entry.kind==='directory'){
        await walkDir(entry,rel,depth+1,out);
      }else if(entry.kind==='file'&&isSupported(name)){
        out.push({name:name,rel:rel,handle:entry});
      }
    }
  }

  /* ---------- 绑定目录 + 全量索引 ---------- */
  async function indexDir(dir){
    state.indexing=true;state.error='';
    try{
      const found=[];
      await walkDir(dir,'',0,found);
      if(!found.length){
        state.bound=true;state.dirName=dir.name;state.files=[];state.blocks=[];state.chars=0;state.indexedAt=Date.now();
        await kbPut(K_DIR,dir);
        await kbPut(K_META,{bound:true,dirName:dir.name,enabled:state.enabled,topN:state.topN,cite:state.cite,indexedAt:state.indexedAt});
        await kbPut(K_FILES,[]);
        await kbPut(K_BLOCKS,[]);
        _bm=null;
        return {ok:true,files:0,blocks:0,reads:0};
      }
      // 分文件解析（顺序执行，避免并发句柄竞争；实时汇报进度）
      const files=[];const allBlocks=[];
      let totalChars=0;let reads=0;const errors=[];
      for(let i=0;i<found.length;i++){
        const f=found[i];
        if(!f.handle)continue;
        try{
          const r=await parseFile(f.name,f.handle);
          if(r&&r.chars>0){
            const btexts=splitBlocks(f.name,r.text,r.linePages);
            const fileId=files.length;
            files.push({id:fileId,name:f.name,rel:f.rel,chars:r.chars,pages:r.page,blocks:btexts.length,size:f.handle?await f.handle.getFile().catch(()=>null).then(ff=>ff?ff.size:0):0});
            btexts.forEach((bt,bi)=>{
              allBlocks.push({id:fileId+':'+bi,file:fileId,index:bi,text:bt.text,chapter:bt.chapter||'',page:bt.page||0});
            });
            totalChars+=r.chars;reads++;
          }
        }catch(e){
          errors.push(f.name+': '+(e&&e.message?e.message:'解析失败'));
        }
      }
      state.bound=true;state.dirName=dir.name;state.files=files;state.blocks=allBlocks;state.chars=totalChars;state.indexedAt=Date.now();
      await kbPut(K_DIR,dir);
      await kbPut(K_META,{bound:true,dirName:dir.name,enabled:state.enabled,topN:state.topN,cite:state.cite,indexedAt:state.indexedAt});
      await kbPut(K_FILES,files);
      await kbPut(K_BLOCKS,allBlocks);
      _bm=null;
      return {ok:true,files:files.length,blocks:allBlocks.length,reads:reads,errors:errors};
    }finally{
      state.indexing=false;
    }
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
    return indexDir(dir);
  }
  async function rescan(){
    if(!dirHandle){
      const d=await kbGet(K_DIR);if(d)dirHandle=d;
    }
    if(!dirHandle)return {ok:false,error:'尚未绑定知识库目录'};
    return indexDir(dirHandle);
  }
  async function unbind(){
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
      const f=state.files[b.file];
      const name=f?f.name:(b.file||'unknown');
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
    tokenize,splitBlocks,isSupported,bmQuery
  };
})();
// 初始化时机：由 app.js 的 bootApp 异步挂载（不阻塞首屏），见 app.js
