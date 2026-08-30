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
  const MAX_PDF_BYTES=20*1024*1024;  // PDF 解析大小上限（与扫描上限 20MB 对齐；此前 8MB 会静默丢弃大 PDF）
  // 2026-08-29 同步 Rust 端 KB_MAX_RECURSE_DEPTH=5，修复多层（正文/卷/分卷/章节）嵌套漏扫
  const MAX_RECURSE_DEPTH=5;         // 递归遍历子目录最大深度
  const BLOCK_TARGET=500;            // 分块目标字数（400~600 区间取中）
  const MIN_SCORE=0.6;               // 相关度阈值：BM25 得分低于该值的片段不注入（省 token）
  const MAX_SNIPPET_CHARS=300;       // search 工具返回的单片段字符上限（省 token）
  const MAX_GETFILE_CHARS=4000;      // get_kb_file 工具单次返回的字符上限

  let ready=false;                    // init 是否完成
  const state={
    bound:false,
    dirName:'',
    enabled:false,
    topN:DEFAULT_TOPN,
    cite:true,
    activeRetrieval:true,       // AI 主动检索：开启后不再自动注入 Top-N，由模型按需调 query_knowledge
    autoInjectFallback:false,  // 自动注入兜底：开启后除工具调用外仍发请求前注入一次 Top-N
    files:[],
    blocks:[],
    chars:0,
    indexedAt:0,
    indexing:false,
    error:''
  };
  let dirHandle=null;

  /* ---------- 独立 IndexedDB 封装（不复用 store.js 的库，彻底隔离） ---------- */
  const IS_TAURI_KB=!!(window.__TAURI__&&window.__TAURI__.core&&typeof window.__TAURI__.core.invoke==='function');
  let _kbStoreCache=null;let _kbSaveTimer=0;
  async function _kbStoreEnsure(){
    if(_kbStoreCache!==null)return _kbStoreCache;
    try{
      const txt=await window.__TAURI__.core.invoke('kb_store_load');
      _kbStoreCache=txt?(JSON.parse(txt)||{}):{};
    }catch(e){_kbStoreCache={};}
    return _kbStoreCache;
  }
  function _kbStoreSchedule(){
    clearTimeout(_kbSaveTimer);
    _kbSaveTimer=setTimeout(function(){
      if(_kbStoreCache===null)return;
      try{window.__TAURI__.core.invoke('kb_store_save',{content:JSON.stringify(_kbStoreCache)}).catch(function(){});}catch(e){}
    },300);
  }
  function kbOpen(){
    return new Promise((res,rej)=>{
      const r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE);};
      r.onsuccess=()=>res(r.result);
      r.onerror=()=>rej(r.error||new Error('打开知识库 IndexedDB 失败'));
    });
  }
  async function kbGet(key){
    if(IS_TAURI_KB){try{const c=await _kbStoreEnsure();const v=c[key];return v===undefined?null:v;}catch(e){return null;}}
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
    if(IS_TAURI_KB){try{const c=await _kbStoreEnsure();c[key]=val;_kbStoreSchedule();return;}catch(e){return;}}
    const db=await kbOpen();
    return new Promise((res,rej)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(val,key);
      tx.oncomplete=()=>res();
      tx.onerror=()=>rej(tx.error);
    });
  }
  async function kbDelete(key){
    if(IS_TAURI_KB){try{const c=await _kbStoreEnsure();delete c[key];_kbStoreSchedule();return;}catch(e){return;}}
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
  function bmQuery(queryTokens,limit){
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
    // limit 可由外部调用方覆盖（如 search 工具按参数 topN 取片段）；缺省走设置中的 state.topN
    const cap=(limit&&limit>0)?limit:state.topN;
    return scores.filter(x=>x.score>=MIN_SCORE).slice(0,cap);
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
  /** 统一文件字节读取：Tauri 走 kb_read_b64（路径），浏览器走 FSA handle */
  async function _kbReadBytes(source){
    if(source&&source.path&&IS_TAURI_KB){
      // 性能优化（v1.0.31+）：纯文本文件走 kb_read_text UTF-8 直读通道，
      // 绕开 base64 链（省 ~33% 体积的 IPC 字符串传输 + 前端 atob ~300ms/20MB）；
      // 失败（权限变化等）自动落回 b64 通道。kb_read_text 内部 UTF-8 lossy + BOM 剥除，索引场景可接受。
      const _p=String(source.path);
      if(/\.(md|txt|markdown|log)$/i.test(_p)){
        try{
          const text=await window.__TAURI__.core.invoke('kb_read_text',{path:_p});
          return new TextEncoder().encode(text);
        }catch(_e){/* 落回下方 b64 通道 */}
      }
      const b64=await window.__TAURI__.core.invoke('kb_read_b64',{path:_p});
      const bin=atob(b64);const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      return bytes;
    }
    const f=await source.handle.getFile();
    return new Uint8Array(await f.arrayBuffer());
  }
  /** 统一目录列表：Tauri 走 kb_scan_dir，浏览器走 walkDir
   *  2026-08-29：found=0 场景统一写入 state.error 诊断信息，避免 UI 只显示 0 文件 0 分块
   *  却不告诉用户「是扩展名不支持？/ 目录空？/ 嵌套太深？/ Tauri invoke 报错？」
   *  2026-08-29：Tauri 新增 dir.preScanned 快速路径——chooseDir 调用新命令
   *  kb_pick_and_scan_dir 在 pick_folder 回调（权限有效时）立刻同步扫出文件清单，
   *  直接带回到 dir.preScanned；_kbListFiles 在这里直接返回预扫描列表，**不二次
   *  invoke kb_scan_dir**，绕开 macOS Tauri 2 NSOpenPanel 临时授权的跨命令过期问题。
   *  2026-08-29：新增 Windows 专有诊断（skip_encoding / skip_path_too_long /
   *  skip_access_denied），对 WTF-16 路径编码、MAX_PATH 260、ERROR_ACCESS_DENIED
   *  / 独占占用 三类经典 Windows 0 文件边界给出红 note 指引。
   */
  async function _kbListFiles(dir){
    if(dir&&dir.path&&IS_TAURI_KB){
      // 2026-08-29 打包后「首次绑定显示 3 个 PDF ✅；点重新索引 → 0 文件 0 分块 ❌」根因：
      // macOS Tauri 2 NSOpenPanel 临时安全范围书签只在 pick_folder 回调生命周期内有
      // 效；回调内同步 kb_pick_and_scan_dir → 预扫描 3 个 PDF → 入库成功（首次 UI
      // 正常）。但 kbPut(K_DIR, dirHandle={path,name,preScanned:[3PDF]} 后，下次进页
      // 面 / 点「重新索引」从 K_DIR 恢复 dirHandle 时，preScanned 其实已是**过期
      // 快照**——若此时 _kbListFiles 直接返回快照 found=[3PDF]，indexDir 继续调
      // parseFile → read_bytes → 因为书签已过期 PermissionDenied → 逐文件 parse
      // 报错全部跳过 → found 数组非空但 files/blocks 最终落地为 0 条 → 「0文件 0
      // 分块 0B」但 UI 不告诉你原因（parseFile 是 found 之后的步骤，这里只在 err
      // 里，state.error 根本不会写）。
      //
      // 修复策略：preScanned 只允许「chooseDir 刚完成的一次性初始化」使用；只要
      // state.bound==true 或 dirHandle 来自 K_DIR 恢复，一律把 preScanned 当过期
      // 快照作废，强制重新 invoke kb_scan_dir。若 macOS 授权过期：kb_scan_dir 返回
      // PermissionDenied → 下面的诊断会把 state.error 写成「请重新选择目录并索引」，
      // 不会再静默把旧快照当成有效 found。
      let dirFromRestore=false;
      try{
        const d=await kbGet(K_DIR);
        if(d&&d.path&&dir&&dir.path&&String(d.path)===String(dir.path))dirFromRestore=true;
      }catch(e){dirFromRestore=false;}
      const canUsePreScanned=!state.bound&&!dirFromRestore&&Array.isArray(dir.preScanned)&&dir.preScanned.length>0;
      if(canUsePreScanned){
        return dir.preScanned.map(function(f){return {name:f.name,rel:f.rel,path:f.path,size:f.size};});
      }
      let result=null;let invErr=null;let isPermissionDenied=false;
      // 优先扫描原目录；若 Tauri 端原路径扫描失败但存在 cache_root（说明之前已把文件
      // 复制到 app_data_dir/kb_cache/<cache_id>），回退到 cache_root 再次扫描。
      const scanPath=String(dir.path||'');
      const cacheRoot=String(dir.cacheRoot||dir.cache_root||'');
      async function scanOnce(p){
        try{
          const r=await window.__TAURI__.core.invoke('kb_scan_dir',{path:p});
          return {result:r,err:null};
        }catch(e){return {result:null,err:String((e&&e.message)||e)};}
      }
      let primary=await scanOnce(scanPath);
      result=primary.result;invErr=primary.err;
      let usedFallback=false;
      if(invErr&&cacheRoot){
        const m=invErr.toLowerCase();
        const looksBad=m.indexOf('permissiondenied')>=0||m.indexOf('permission denied')>=0||m.indexOf('accessdenied')>=0||m.indexOf('access denied')>=0||m.indexOf('error_access_denied')>=0||m.indexOf('sharing_violation')>=0||m.indexOf('code=5')>=0||m.indexOf('code=32')>=0||m.indexOf('errno=13')>=0||m.indexOf('os error 13')>=0||m.indexOf('os error 5')>=0||m.indexOf('operation not permitted')>=0||m.indexOf('os error 1')>=0||m.indexOf('scoped resource')>=0||m.indexOf('security scope')>=0||m.indexOf('不存在')>=0||m.indexOf('无法读取目录')>=0;
        if(looksBad){
          const fb=await scanOnce(cacheRoot);
          if(fb.result){
            const fbList=Array.isArray(fb.result)?fb.result:(fb.result&&Array.isArray(fb.result.files)?fb.result.files:null);
            if(Array.isArray(fbList)&&fbList.length>0){
              result=fb.result;invErr=null;usedFallback=true;
            }
          }
        }
      }
      if(invErr){
        const m=invErr.toLowerCase();
        if(m.indexOf('permissiondenied')>=0||m.indexOf('permission denied')>=0||m.indexOf('accessdenied')>=0||m.indexOf('access denied')>=0||m.indexOf('error_access_denied')>=0||m.indexOf('sharing_violation')>=0||m.indexOf('code=5')>=0||m.indexOf('code=32')>=0||m.indexOf('errno=13')>=0||m.indexOf('os error 13')>=0||m.indexOf('os error 5')>=0){
          isPermissionDenied=true;
        }
        if(!isPermissionDenied&&(m.indexOf('operation not permitted')>=0||m.indexOf('os error 1')>=0||m.indexOf('scoped resource')>=0||m.indexOf('security scope')>=0)){
          isPermissionDenied=true;
        }
      }
      if(invErr){
        if(isPermissionDenied){
          state.error='知识库目录临时授权已过期（macOS Tauri 选择目录后的临时权限有时间限制，重启应用 / 隔几小时会失效）。请点击「选择目录并索引」重新选择该目录，系统会在选完立刻重新扫描入库。';
        }else{
          state.error='Rust 目录扫描失败：'+invErr;
        }
      }
      // 新 Rust kb_scan_dir 返回 {files, seen, skipped_*} 结构；旧结构容错为数组
      const list=Array.isArray(result)?result:(result&&Array.isArray(result.files)?result.files:null);
      if(!Array.isArray(list)||list.length===0){
        // 附加上层 skipped_* 诊断（仅 Windows 常见，跨平台统一展示）
        if(result&&typeof result==='object'){
          const enc=Number(result.skipped_encoding)||0;const long_=Number(result.skipped_path_too_long)||0;const den=Number(result.skipped_access_denied)||0;
          const unsup=Number(result.skipped_unsupported)||0;const large=Number(result.skipped_too_large)||0;const hid=Number(result.skipped_hidden)||0;
          const extra=[];
          if(enc>0)extra.push('路径含非法 Unicode/孤立代理字符 '+enc+' 个：请重命名文件后重试。');
          if(long_>0)extra.push('路径超长 '+long_+' 个：请确认 tauri.conf.json bundle.windows.longPathAware=true，或移动目录到更短上层路径。');
          if(den>0)extra.push('Windows 无权限 '+den+' 个：ERROR_ACCESS_DENIED 或被其他程序独占占用，请关闭占用程序后重试。');
          if(unsup>0)extra.push('非白名单扩展名 '+unsup+' 个（仅 md/txt/markdown/log/pdf/docx 支持）。');
          if(large>0)extra.push('大于 20MB '+large+' 个（超单文件大小上限）。');
          if(hid>0)extra.push('隐藏点文件/目录跳过 '+hid+' 个。');
          if(extra.length){
            const prev=state.error?state.error+'；':'';
            state.error=prev+'目录诊断：'+extra.join(' ');
          }
        }
        // found=0 诊断：把可能的四类常见原因写进 state.error（红 note 显示在 KB 区块里）
        try{
          const p=String(dir.path||'');
          const existHint=p?'（目录：'+p+'）':'';
          const prev=state.error?state.error+'；':'';
          const alreadyPermMsg=state.error&&(state.error.indexOf('权限')>=0||state.error.indexOf('无权限')>=0);
          const extra=alreadyPermMsg?'':'扫描后未发现 md / txt / markdown / log / PDF / docx 受支持文件'+existHint+'。可能原因：扩展名不在白名单 / 文件均为 0 字节（Rust 端新版保留 0B 文件入清单，本提示是仍 0 结果则纯扩展名问题）/ 子目录嵌套超过 5 层 / Windows 路径编码或权限异常（诊断条目见上方）。';
          if(extra)state.error=prev+extra;
        }catch(e){}
        return [];
      }
      return list.map(function(f){return {name:f.name,rel:f.rel,path:f.path,size:f.size};});
    }
    const found=[];const errs=[];
    await walkDir(dir,'',0,found,errs);
    if(!found.length){
      try{state.error='所选目录内没有发现 md / txt / markdown / log / PDF / docx 文件（或子目录嵌套超过 5 层）。';}catch(e){}
    }
    return found;
  }
  async function parseFile(fileName,source){
    const e=extOf(fileName);
    const file=source&&source.handle?await source.handle.getFile():null;
    const fsize=file?file.size:(source&&source.size)||0;
    if(fsize>MAX_PDF_BYTES&&e===EXT_PDF){throw new Error('PDF 超过解析大小上限（20MB），暂不支持');}
    if(EXT_TEXT.includes(e)){
      let buf=null;
      if(file){buf=new Uint8Array(await file.arrayBuffer());}
      else{buf=await _kbReadBytes({path:source.path});}
      // UTF-8 直读；带 BOM 自动剥除
      let text=new TextDecoder('utf-8').decode(buf);
      if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
      if(text.length>MAX_FILE_CHARS)text=text.slice(0,MAX_FILE_CHARS);
      return {text,chars:text.length,page:0,linePages:null};
    }
    if(e===EXT_PDF){
      // 桌面版快速路径：Rust 侧直接提取 PDF 文本（WKWebView 里 pdfjs 的
      // getTextContent 返回空文本——浏览器 Chrome 正常、打包应用为空，
      // 与文件本身是否有文字层无关；改用 pdf-extract 绕开 WebKit 行为差异）
      if(source&&source.path&&IS_TAURI_KB){
        let text='';
        try{text=await window.__TAURI__.core.invoke('kb_read_pdf_text',{path:source.path})||'';}
        catch(err){throw new Error('PDF 文本提取失败：'+(err&&err.message?err.message:err));}
        if(!text.trim())throw new Error('PDF 未包含可提取文本——若是扫描/图片型 PDF 则无文本层，暂不支持 OCR');
        const rows=text.replace(/\r\n?/g,'\n').split('\n').map(function(l){return l.trimEnd();});
        const lp=rows.map(function(_,i){return i+1;});
        let full=rows.join('\n').replace(/\n{2,}/g,'\n').trim();
        const fullPages=full.length?lp.slice(0,rows.length):[];
        return {text:full,chars:full.length,page:fullPages.length?1:0,linePages:fullPages};
      }
      const deps=window.__KB_DEPS||{};
      if(!deps.pdfjs){throw new Error('PDF 解析器未加载，请刷新页面后重试');}
      // 注意：pdfjs-dist v6 的 PDFDocumentProxy 已无 destroy()，
      // 正确的销毁入口是 loadingTask.destroy()；旧写法会导致「提取已全部完成」
      // 却在最后一步报错而整个文件作废。清理放进 finally 且失败不影响结果。
      let task=null,pdf=null;
      let bytesLen=0;let numPages=0;let pagesWithText=0;
      try{
        try{
          let pdfBytes=await _kbReadBytes(source);
          bytesLen=pdfBytes?pdfBytes.byteLength||pdfBytes.length||0:0;
          task=deps.pdfjs.getDocument({data:pdfBytes});
          pdf=await task.promise;
          numPages=Number(pdf.numPages)||0;
        }catch(err){
          // 2026-08-29：桌面版 chars===0 诊断——把实际拿到的字节数（bytesLen）
          // 拼接进错误信息，方便区分「整文件被截断 bytes=0」与「PDF 本身无文字层」。
          const diag='[PDF bytes='+bytesLen+']';
          throw new Error('PDF 解析失败（'+diag+'）'+(err&&err.message?'：'+String(err.message).slice(0,120):'')+'；请重新构建/刷新后重试');
        }
        const pageTexts=[];
      const maxPages=Math.min(pdf.numPages,200);
      for(let p=1;p<=maxPages;p++){
        try{
          const page=await pdf.getPage(p);
          const tc=await page.getTextContent();
          const itemTexts=tc.items.map(it=>(it&&it.str)||'').join(' ');
          if(itemTexts.trim().length>0)pagesWithText++;
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
      // chars===0 时抛诊断错误（区分「半截字节截断」vs「纯扫描图 PDF 真无文字层」）：
      //   bytes<expected_size% → Tauri 书签过期，kb_read_b64 被截断读不全
      //   numPages=0 → 半截字节生成的假 PDF 对象
      //   pagesWithText=0 → PDF 真的无文字层（OCR 需求）
      if(full.length===0){
        const expSize=Number(fsize)||0;
        const ratioPct=expSize>0?Math.round(bytesLen*100/expSize):-1;
        const diag='[PDF bytes='+bytesLen+'/'+expSize+'('+(ratioPct<0?'?':ratioPct+'%')+'), numPages='+numPages+', pagesWithText='+pagesWithText+']';
        let hint='';
        if(numPages===0||(ratioPct>=0&&ratioPct<5)){
          hint='（Tauri 打包版检测：实际读取字节只有原文件的 '+(ratioPct<0?'不明':ratioPct+'%')+'，极可能是缓存重写未生效，请先确认已用最新源码重新打包 Tauri，并在打包版里「断开」→「选择目录并索引」重新选一次原目录；缓存机制会在选目录回调里立刻把 PDF 整文件字节复制到应用私有目录，不依赖临时书签。）';
        }else if(pagesWithText===0){
          hint='（若是扫描/图片型 PDF 则无文本层，暂不支持 OCR，请使用文字版）';
        }
        throw new Error('未从文件中提取到文本'+hint+'；诊断：'+diag);
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
      const docxBytes=await _kbReadBytes({path:source.path&&IS_TAURI_KB?source.path:null,handle:source.handle});
      const res=await deps.mammoth.extractRawText({arrayBuffer:docxBytes.buffer});
      let text=(res&&res.value)||'';
      if(text.length>MAX_FILE_CHARS)text=text.slice(0,MAX_FILE_CHARS);
      return {text,chars:text.length,page:0,linePages:null};
    }
    return null;
  }

  /* ---------- 递归遍历目录（只读，不改动任何文件） ---------- */
  async function walkDir(dir,prefix,depth,out,errs){
    if(depth>MAX_RECURSE_DEPTH)return;
    /* 2026-08-29 兼容「伪目录」：由 webkitdirectory 多文件选择降级得到的目录快照对象，
     *  entries 已预填，不再需要异步遍历。结构：
     *    dir = { name, kind:'directory', _isSnapshot:true,
     *            _entries:[{name,rel,handle:{name,kind:'file',getFile:()=>Promise.resolve(file)}}] }
     *  这样 indexDir 主流程完全不必改动（found[i].handle.getFile() / parseFile 都能原样工作）。 */
    if(dir&&dir._isSnapshot===true){
      const list=Array.isArray(dir._entries)?dir._entries:[];
      // snapshot 本身已预过滤：只保留支持的扩展名、跳过隐藏/.dot 路径
      list.forEach(function(it){out.push(it);});
      return;
    }
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

  /** file:// 环境 showDirectoryPicker 不可用时的降级方案：<input type=file webkitdirectory>
   *  现代浏览器（Chrome/Edge/Firefox/Safari）在 file:// 下仍支持 webkitdirectory + webkitRelativePath，
   *  用户在系统选文件夹对话框里选一次即可拿到其下全部文件，等价于「目录快照」。
   *  语义上的限制（UI & KB 已有文案说明）：① 无法持久化 handle，rescan 增量重扫需用户重新选一次；
   *  ② 无自动静默同步。但检索/分块/AI 注入完全一致。 */
  function _pickDirViaWebkitFiles(){
    return new Promise(function(resolve){
      const inp=document.createElement('input');
      inp.type='file';
      // @ts-ignore — 非标准属性，但所有现代浏览器都支持
      try{inp.webkitdirectory=true;}catch(e){}
      try{inp.directory=true;}catch(e){}
      inp.multiple=true;
      inp.accept='.md,.txt,.markdown,.log,.pdf,.docx';
      inp.style.position='fixed';inp.style.left='-9999px';inp.style.top='-9999px';inp.style.opacity='0';
      const done=function(r){try{inp.remove();}catch(e){}resolve(r);};
      let settled=false;
      inp.onchange=function(){
        if(settled)return;settled=true;
        const files=Array.from(inp.files||[]);
        if(!files.length){done({cancelled:true});return;}
        // 根目录名 = webkitRelativePath 第一段（Chrome/Edge/Firefox 都一致：<rootDir>/.../<file>）
        let rootDir='本地目录';const seen=Object.create(null);const entries=[];
        files.forEach(function(f){
          // @ts-ignore
          const relPath=String(f.webkitRelativePath||f.name||'');
          if(!relPath)return;
          // 路径任意一级包含隐藏目录（以 . 开头）直接跳过
          const parts=relPath.split('/');
          if(parts.some(function(seg,i){return i<parts.length-1&&seg.length&&seg[0]==='.';}))return;
          const name=parts[parts.length-1]||f.name;
          if(!name||name[0]==='.'||name==='node_modules')return;
          if(!isSupported(name))return;
          if(parts[0])rootDir=parts[0];
          if(seen[relPath])return;seen[relPath]=1;
          entries.push({
            name:name,
            // rel: 去掉最外层根目录段（与 walkDir 语义对齐：从绑定目录的下一层开始记录相对路径）
            rel:parts.length>1?parts.slice(1).join('/'):name,
            handle:{
              name:name,kind:'file',
              getFile:function(){return Promise.resolve(f);},
              /* 额外字段仅用于调试与 IndexedDB 恢复判断，不影响主流程 */
              _snapshotFile:f,lastModified:f.lastModified,size:f.size
            }
          });
        });
        if(!entries.length){done({cancelled:true,empty:true});return;}
        done({ok:true,dir:{name:rootDir,kind:'directory',_isSnapshot:true,_entries:entries}});
      };
      inp.oncancel=function(){if(settled)return;settled=true;done({cancelled:true});};
      // Fallback：5 分钟没反应当用户取消（防止某些浏览器 cancel 事件不触发 + onchange 也没响）
      setTimeout(function(){if(settled)return;settled=true;done({cancelled:true,timedOut:true});},300000);
      document.body.appendChild(inp);
      // 必须放在追加到 DOM 之后 click，部分老版 Safari 才弹框
      try{inp.click();}catch(e){done({cancelled:true});}
    });
  }

  /* ---------- 绑定目录 + 索引（支持增量模式） ----------
     opts.incremental=true 时与上次清单逐文件比对 lastModified+size：
     未变化的文件直接复用旧分块（不重新读盘解析），只有新增/变更/删除被处理。
     用于定时静默更新 —— 目录新增或修改了文件也能自动同步进索引。 */
  /** 目录索引：扫描目录后走统一索引流程 */
  async function indexDir(dir,opts){
    const found=await _kbListFiles(dir);const errs=[];
    let reads=0;
    return await indexFileList(found,dir,errs,reads,opts);
  }

  /** 统一索引流程：给定文件清单（FSA handle 或 Tauri 路径）→ 增量比对 → 解析 → 分块入库 */
  async function indexFileList(found,dir,errs,reads,opts){
    opts=opts||{};const incremental=!!opts.incremental;
    state.indexing=true;state.error='';
    try{
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
        try{
          const f=found[i];
          if(f.path&&IS_TAURI_KB){statByRel[f.rel]={lastModified:0,size:f.size||0};}
          else{const st=await f.handle.getFile();statByRel[f.rel]={lastModified:st.lastModified||0,size:st.size||0};}
        }catch(e){}
      }
      if(!found.length){
        state.bound=true;state.dirName=dir.name;state.files=[];state.blocks=[];state.chars=0;state.indexedAt=Date.now();
        if(dir._isSnapshot===true){
          await kbPut(K_DIR,{_snapshot:true,name:dir.name,count:0});
        }else{
          await kbPut(K_DIR,dir);
        }
        await kbPut(K_META,{bound:true,dirName:dir.name,enabled:state.enabled,topN:state.topN,cite:state.cite,activeRetrieval:state.activeRetrieval,autoInjectFallback:state.autoInjectFallback,indexedAt:state.indexedAt});
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
        if(!f.handle&&!f.path)continue;
        const prev=prevByRel[f.rel];const st=statByRel[f.rel]||{lastModified:0,size:0};
        const canReuse=incremental&&prev&&oldBlocksByRel[f.rel]&&(prev.lastModified===st.lastModified)&&(prev.size===st.size);
        if(canReuse){
          reusedRels[f.rel]=1;
          finalFiles.push(Object.assign({},prev,{id:finalFiles.length,lastModified:st.lastModified,size:st.size}));
          totalChars+=Number(prev.chars)||0;reads++;
          continue;
        }
        try{
          const r=await parseFile(f.name,f);
          if(r&&r.chars===0){throw new Error('未从文件中提取到文本——若是扫描/图片型 PDF 则无文本层，暂不支持 OCR，请使用文字版');}
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
      // 2026-08-29「打包后重新索引变成 0 文件 0 分块 0B」的最后一道防线：
      // indexDir 在 full rescan（incremental=false）下，若 found>0 但解析结果 finalFiles=0
      // （典型触发链：macOS Tauri NSOpenPanel 书签过期 → _kbListFiles 用了 preScanned
      // 快照 → parseFile 每个文件都 PermissionDenied throw → finalFiles 为空但
      // found=[原快照]），此时不能把旧的 files/blocks 清零，否则用户会看到「明明 3 个
      // PDF 绑定成功，点重新索引后一夜回到 0」。
      // 处理：把 errors 写 state.error 红提示；保留 state.files/state.blocks 不覆写。
      if(!incremental&&found.length>0&&finalFiles.length===0){
        state.bound=true;state.dirName=dir.name;state.indexedAt=Date.now();
        // 保留 K_FILES / K_BLOCKS（上次有效索引），不把空数组覆写进去
        if(dir._isSnapshot===true){
          await kbPut(K_DIR,{_snapshot:true,name:dir.name,count:found.length});
        }else{
          await kbPut(K_DIR,dir);
        }
        await kbPut(K_META,{bound:true,dirName:dir.name,enabled:state.enabled,topN:state.topN,cite:state.cite,activeRetrieval:state.activeRetrieval,autoInjectFallback:state.autoInjectFallback,indexedAt:state.indexedAt});
        const parseFail=errors.length>0?('解析失败 '+errors.length+' 个文件（已保留上次成功索引的数据，未清空）：'+errors.slice(0,8).join('；')+(errors.length>8?'；其余 '+ (errors.length-8)+' 个略…':'')):('本次扫描到 '+found.length+' 个文件，但全部解析失败（已保留上次成功索引的数据，未清空）');
        // 缓存诊断摘要（若本次绑定带了统计字段就拼上）：
        let cacheDiag='';
        if(IS_TAURI_KB){
          const cid=dir.cacheId||dir.cache_id;
          const copied=Number(dir.cachedFiles||dir.cached_files)||0;
          const failed=Number(dir.cacheCopyFailed||dir.cache_copy_failed)||0;
          const probeOn=Number(dir.probeOnCacheOk||dir.probe_on_cache_ok)||0;
          const totalB=Number(dir.cacheTotalBytes||dir.cache_total_bytes)||0;
          if(cid||copied>0||failed>0||totalB>0){
            const mb=(totalB/1024/1024).toFixed(2);
            cacheDiag='；[Tauri缓存诊断] copied='+copied+'/'+found.length+' failed='+failed+' probe_on_cache_ok='+probeOn+' size='+mb+'MB cache_id='+String(cid||'(无)');
          }else{
            cacheDiag='；[Tauri缓存诊断] 未检测到缓存重写字段 → 说明你运行的 Tauri 打包版本可能还没把最新 Rust 源码编进去。请用当前最新源码重新执行 npm run tauri build，并**在打包版里先点「断开」→「选择目录并索引」重新执行一次绑定**。';
          }
        }
        const prev=state.error?state.error+'；':'';
        state.error=prev+parseFail+('。若是 Tauri 桌面版最常见原因：选择目录后的临时授权过期，请点击「选择目录并索引」重新选一次目录即可。'+cacheDiag);
        return {ok:false,files:state.files.length,blocks:state.blocks.length,reads:reads,scanned:found.length,errors:errors.slice(),preserved:true};
      }
      state.bound=true;state.dirName=dir.name;state.files=finalFiles;state.blocks=finalBlocks;state.chars=totalChars;state.indexedAt=Date.now();
      /* 快照模式（file:// webkitdirectory 降级）：伪 handle 内含 File 对象（体积大且不可跨页面复用），
       *  IndexedDB 里只存一个标记 {_snapshot,name}，重启后 K_DIR 拿不到真实 handle → silentRescan/rescan
       *  走友好提示路径。FSA 模式仍存完整 FileSystemDirectoryHandle（Chrome 支持结构化克隆持久化）。 */
      if(dir._isSnapshot===true){
        await kbPut(K_DIR,{_snapshot:true,name:dir.name,count:found.length});
      }else{
        await kbPut(K_DIR,dir);
      }
      await kbPut(K_META,{bound:true,dirName:dir.name,enabled:state.enabled,topN:state.topN,cite:state.cite,activeRetrieval:state.activeRetrieval,autoInjectFallback:state.autoInjectFallback,indexedAt:state.indexedAt});
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
  /** 静默增量重扫：不弹提示不打断；完成后若数据管理页打开则刷新其知识库区块
   *  2026-08-29：快照模式（file:// 用 webkitdirectory 绑定）没有可持久化的真实 handle，
   *  此时 dirHandle 可能是 null / {_snapshot:true} 标记对象 —— 直接空 return，不报错不空耗。 */
  async function silentRescan(reason){
    if(!dirHandle||dirHandle._snapshot===true){try{const d=await kbGet(K_DIR);if(d&&!d._snapshot)dirHandle=d;}catch(e){}}
    if(!dirHandle||dirHandle._snapshot===true)return;
    if(dirHandle._isSnapshot===true)return;
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
      state.activeRetrieval=meta.activeRetrieval!==false;state.autoInjectFallback=!!meta.autoInjectFallback;
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
  function _kbBasename(path){
    if(!path)return '';
    const s=String(path);
    const p1=s.lastIndexOf('\\');const p2=s.lastIndexOf('/');
    let name;
    // Windows 路径：C:\Users\xxx\yyy → 先按 \ 取最后段；若是混合的 UNC / Unix 模式 / 也取更后面一段
    if(p1>=0||p2>=0){
      name=s.slice(Math.max(p1,p2)+1);
    }else{name=s;}
    // Windows 可能有驱动器字母后带目录根（C:\ 取 basename = "C:"，兜底）
    if(!name){name=s.replace(/[\\\/]+$/g,'').split(/[\\\/]/).pop()||s;}
    return name;
  }
  /** 批量选择文件（不走目录授权）：Tauri 原生多选对话框 / 浏览器 FSA 多选 */
  async function chooseFiles(){
    const errs=[];const found=[];let reads=0;
    if(IS_TAURI_KB){
      let paths=[];
      try{paths=await window.__TAURI__.core.invoke('kb_pick_files')||[];}
      catch(e){state.error='批量选择文件失败：'+(e&&e.message?e.message:e);return {ok:false,error:state.error};}
      if(!paths.length)return {ok:false,cancelled:true};
      paths.forEach(function(p){
        const name=p.split('/').pop()||p.split('\\').pop()||p;
        found.push({name:name,rel:name,path:p,size:0});
      });
    }else{
      if(!('showOpenFilePicker' in window)){
        state.error='当前浏览器不支持批量选择文件（需 Chrome/Edge），请使用桌面版或 Chrome/Edge 打开';
        return {ok:false,error:state.error};
      }
      const handles=await window.showOpenFilePicker({multiple:true,
        types:[{description:'知识库文件',accept:{'application/pdf':['.pdf'],'text/markdown':['.md','.markdown'],'text/plain':['.txt','.log'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']}}]});
      for(const h of handles){
        const f=await h.getFile();
        found.push({name:f.name||h.name,rel:f.name||h.name,handle:h,size:f.size||0});
      }
    }
    state.dirName='所选文件';
    return await indexFileList(found,{name:'所选文件'},errs,reads);
  }

  async function chooseDir(){
    // 桌面版（Tauri）：WKWebView 不支持 File System Access API，走原生目录对话框
    if(IS_TAURI_KB){
      let picked=null;let timedOut=false;let t=null;
      try{
        // 2026-08-29：macOS Tauri 2 的 NSOpenPanel 仅在对话框回调上下文内授予目录
        // 读取权限；回调返回后跨命令调用 read_dir 通常 PermissionDenied。
        // 改调用 kb_pick_and_scan_dir：在回调权限有效时立刻同步 kb_walk 一次性返回
        // {path, dir_name, files, seen, skipped_*}，避免两次 invoke 掉授权。
        // 旧命令 kb_pick_dir 仅作为「老前端版本存在」的兜底（新前端不再走它）。
        const timeoutPromise=new Promise(function(_,rej){t=setTimeout(function(){timedOut=true;rej(new Error('TIMEOUT'));},30000);});
        picked=await Promise.race([window.__TAURI__.core.invoke('kb_pick_and_scan_dir'),timeoutPromise]);
      }catch(e){
        if(timedOut||(e&&(e.message==='TIMEOUT'||e.code==='TIMEOUT'))){
          state.error='目录选择超时。如果系统对话框没有弹出，请关闭应用重试或切换到浏览器版本使用。';
          return {ok:false,error:state.error};
        }
        state.error='选择目录失败：'+(e&&e.message?e.message:e);
        return {ok:false,error:state.error};
      }finally{if(t){clearTimeout(t);t=null;}}
      // Rust 返回：Some(result)=已选 / None=取消
      if(picked==null||picked===undefined)return {ok:false,cancelled:true};
      const path=String(picked.path||'');
      const name=String(picked.dir_name||'')||_kbBasename(path);
      const files=Array.isArray(picked.files)?picked.files:[];
      // pick_folder 合并命令返回后，权限帧其实已经弹出回调栈 → macOS 临时安全
      // 范围书签开始倒计时。我们在 Rust 回调里跑了 probe_read_files(files)「逐
      // 个文件读 1 字节」探针，probe_ok 精确告诉你「在权限还活着时实际能读到多
      // 少个文件字节」。
      const probeOk=Number(picked.probe_read_bytes_ok)||0;
      if(files.length>0&&probeOk<files.length){
        const miss=files.length-probeOk;
        state.error='选择目录并扫描完成，但 '+miss+' 个文件在回调上下文里就无法读字节（极可能是 Tauri 临时授权异常）。请重新点「选择目录并索引」重试，或把目录移到 Downloads/Desktop 等常见可见位置后再试。已把能读到的 '+probeOk+' 个文件先入库。';
        // 只保留探针通过的文件入清单 → parseFile 不会再因权限逐文件抛 → 0 分块
        // 这里没法知道具体哪些条目过了探针（为了避免 Rust 返回体积过大没把
        // probe_ok_flags 带回），保守处理：先展示诊断红 note，按 files 继续入库，
        // 后端防线 indexDir preserved 兜底 + parseFile throw 不会清旧数据。
      }
      // 2026-08-29：macOS sandbox 最终防线。Rust 在 pick_folder 回调里同步把命中
      // 文件整份字节复制到 app_data_dir/kb_cache/<cache_id>/<rel>，并把 files[i].path
      // 改写成缓存副本路径。后续 parseFile 读 kb_read_b64(cached_path) 永远成功，
      // 不再依赖原目录的临时安全范围书签（一返回回调就会被系统收回）。
      const cacheId=picked&&(typeof picked.cache_id==='string')?picked.cache_id:
                    (picked&&(typeof picked.cacheId==='string')?picked.cacheId:null);
      const cacheRoot=picked&&(typeof picked.cache_root==='string')?picked.cache_root:
                      (picked&&(typeof picked.cacheRoot==='string')?picked.cacheRoot:null);
      const cachedFiles=Number(picked&&(picked.cached_files!=null?picked.cached_files:picked.cachedFiles))||0;
      const cacheCopyFailed=Number(picked&&(picked.cache_copy_failed!=null?picked.cache_copy_failed:picked.cacheCopyFailed))||0;
      const probeOnCache=Number(picked&&(picked.probe_on_cache_ok!=null?picked.probe_on_cache_ok:picked.probeOnCacheOk))||0;
      const cacheTotalBytes=Number(picked&&(picked.cache_total_bytes!=null?picked.cache_total_bytes:picked.cacheTotalBytes))||0;
      // 把 picked 传来的所有 cache 诊断字段都写到 dirHandle，写入 K_DIR 后可跨重启恢复
      dirHandle={path:path,name:name,preScanned:files,
        cacheId:cacheId||undefined,
        cacheRoot:cacheRoot||undefined,
        cachedFiles:cachedFiles,
        cacheCopyFailed:cacheCopyFailed,
        probeOnCacheOk:probeOnCache,
        cacheTotalBytes:cacheTotalBytes};
      if(cachedFiles>0&&probeOk===files.length){state.error='';} // 路径已经被重写成缓存版，无需任何诊断
      if(files.length>0&&cachedFiles<files.length&&probeOk<files.length){
        const miss=files.length-cachedFiles-cacheCopyFailed;
        state.error=(state.error?state.error+'；':'')+'注意：有 '+miss+' 个文件未能成功复制到应用缓存（后续解析仍会尝试原目录路径，macOS 权限过期会解析失败）。请把目录移到 Downloads/Desktop 等更短路径或关闭占用后重试。';
      }
      // 预扫描为 0 的情况先把 Rust 诊断写 state.error（若有信息），让重走 indexDir 时
      // _kbListFiles 直接命中 preScanned=[] → 再拼上 found=0 的红 note 诊断
      if(!files.length&&state.error===''){
        const seen=Number(picked.seen||0);const skip_unsupported=Number(picked.skipped_unsupported||0);
        const skip_hidden=Number(picked.skipped_hidden||0);const skip_large=Number(picked.skipped_too_large||0);
        const dirs=Number(picked.dirs_scanned||0);
        const skip_enc=Number(picked.skipped_encoding||0);
        const skip_long=Number(picked.skipped_path_too_long||0);
        const skip_denied=Number(picked.skipped_access_denied||0);
        const hints=[];
        if(seen===0)hints.push('整个目录（含子目录）实际看到的文件数量为 0：可能是目录真的为空，或 macOS 临时授权在回调内就已异常，或 Windows 权限/反病毒软件拦截。建议重新选择一次。');
        if(skip_unsupported>0)hints.push('存在 '+skip_unsupported+' 个非白名单扩展名文件（仅 md/txt/markdown/log/pdf/docx 被支持）。');
        if(skip_large>0)hints.push('存在 '+skip_large+' 个大于 20MB 的文件（超出单文件上限）。');
        if(skip_hidden>0)hints.push('跳过 '+skip_hidden+' 个「.」开头的隐藏文件/目录。');
        if(skip_enc>0)hints.push('跳过 '+skip_enc+' 个文件：路径含非法 Unicode / 孤立代理字符（Windows WTF-16 风险），请重命名文件后重试。');
        if(skip_long>0)hints.push('跳过 '+skip_long+' 个条目：Windows 路径超长（MAX_PATH），请开启 tauri.conf.json 的 bundle.windows.longPathAware=true，或将知识库目录移动到更短的上层路径。');
        if(skip_denied>0)hints.push('跳过 '+skip_denied+' 个条目：Windows 无权限访问（ERROR_ACCESS_DENIED / 被其他程序独占占用），请关闭占用后重试。');
        if(dirs>0&&files.length===0)hints.push('遍历过 '+dirs+' 个子目录但没有命中任何受支持扩展名。');
        if(hints.length)state.error='选择目录并即时扫描完成，但命中 0 个可索引文件：'+hints.join(' ');
      }
      const r=await indexDir(dirHandle);
      startAutoScan();
      return r;
    }
    let dir;let mode='fsa';let fallbackNote='';
    /* 优先用 File System Access API（真 FSA：权限持久化、增量重扫、静默自动同步）；
     *  当 showDirectoryPicker 不存在（典型场景 file:// 双击打开 dist/index.html → 非安全上下文）
     *  → 自动降级 webkitdirectory 的多文件选择；FSA 抛 NotAllowedError/SecurityError 也降级。
     *  降级成功会在 toast 里告诉用户这是「快照模式」。 */
    const hasFSA=typeof window!=='undefined'&&'showDirectoryPicker' in window;
    if(hasFSA){
      try{
        dir=await window.showDirectoryPicker({mode:'read'});
      }catch(e){
        if(e&&e.name==='AbortError')return {ok:false,cancelled:true};
        // NotAllowedError / SecurityError / TypeError 等 → 降级 webkitdirectory
        fallbackNote='FSA 不允许('+(e&&e.name||'err')+')';
        dir=null;
      }
    }
    if(!dir){
      mode='snapshot';
      const fb=await _pickDirViaWebkitFiles();
      if(!fb||fb.cancelled){return {ok:false,cancelled:true};}
      if(fb.empty){return {ok:false,error:'所选目录内没有支持的文件（md/txt/pdf/docx）。file:// 模式下使用「多文件选择」替代目录选择器，请确认目录内含有上述扩展名文件后重试。'};}
      if(!fb.ok||!fb.dir){return {ok:false,error:(fb&&fb.error)||'多文件模式打开失败，请刷新页面重试'};}
      dir=fb.dir;fallbackNote=fallbackNote||'fallback:webkitdirectory';
    }
    // FSA 权限校验（仅真 FSA 做）
    if(mode==='fsa'){
      try{
        if((await dir.queryPermission({mode:'read'}))!=='granted'){
          if((await dir.requestPermission({mode:'read'}))!=='granted'){
            return {ok:false,error:'未获得目录读取权限，请在弹窗中点「允许」后重试'};
          }
        }
      }catch(e){/* 部分环境权限 API 受限，先尝试解析 */}
    }
    dirHandle=dir;
    const r=await indexDir(dir);
    startAutoScan();
    if(mode==='snapshot'&&r&&r.ok){
      // 给一个说明性提示，不返回 error：让用户知道增量重扫需要重新选目录
      if(typeof toast==='function'){try{toast('已绑定目录（快照模式）：file:// 环境不支持增量自动同步，下次更新文件请重新选择该目录。','info',5400);}catch(e){}}
      r.mode='snapshot';r.fallbackNote=fallbackNote;
    }
    return r;
  }
  async function rescan(){
    if(!dirHandle||dirHandle._snapshot===true){
      const d=await kbGet(K_DIR);if(d&&!d._snapshot)dirHandle=d;
    }
    if(!dirHandle||dirHandle._snapshot===true){
      /* 有 bound 但没有 handle 两种可能：
       *   ① 快照模式绑定（snapshot）→ 给用户友好提示；
       *   ② 其他异常情况 → 原返回。 */
      const meta=await kbGet(K_META);
      if(meta&&meta.dirName){
        return {ok:false,error:'当前为快照模式绑定（file:// 双击打开）。该模式无法在后台静默增量扫描，请点击「选择目录并索引」重新选择该目录以更新索引。'};
      }
      return {ok:false,error:'尚未绑定知识库目录'};
    }
    if(dirHandle._isSnapshot===true){
      return {ok:false,error:'当前为快照模式绑定，请重新选择该目录以更新索引。'};
    }
    const r=await indexDir(dirHandle,{incremental:false});
    startAutoScan();
    return r;
  }
  async function unbind(){
    stopAutoScan();
    // 解绑同步清缓存（否则 kb_cache 会越积越多）。失败不影响解绑流程。
    if(IS_TAURI_KB){
      try{
        const cid=(dirHandle&&(dirHandle.cacheId||dirHandle.cache_id))||null;
        await window.__TAURI__.core.invoke('kb_clear_cache',{cacheId:cid});
      }catch(e){/* 静默：最坏情况只是留下缓存文件，下次启动不会报错 */}
    }
    dirHandle=null;
    await Promise.all([kbDelete(K_META),kbDelete(K_DIR),kbDelete(K_FILES),kbDelete(K_BLOCKS)]);
    Object.assign(state,{bound:false,dirName:'',enabled:false,files:[],blocks:[],chars:0,indexedAt:0,error:''});
    _bm=null;
    return {ok:true};
  }
  function setEnabled(v){state.enabled=!!v;persistMeta();return state.enabled;}
  function setTopN(n){const v=Math.max(1,Math.min(10,parseInt(n,10)||DEFAULT_TOPN));state.topN=v;persistMeta();return v;}
  function setCite(v){state.cite=!!v;persistMeta();return state.cite;}
  function setActiveRetrieval(v){state.activeRetrieval=!!v;persistMeta();return state.activeRetrieval;}
  function setAutoInjectFallback(v){state.autoInjectFallback=!!v;persistMeta();return state.autoInjectFallback;}
  function persistMeta(){
    if(state.bound){
      kbPut(K_META,{bound:true,dirName:state.dirName,enabled:state.enabled,topN:state.topN,cite:state.cite,activeRetrieval:state.activeRetrieval,autoInjectFallback:state.autoInjectFallback,indexedAt:state.indexedAt});
    }
  }
  /* ---------- AI 主动检索接口（供 query_knowledge / list_kb_files / get_kb_file 工具调用） ---------- */
  /** 按问题检索 Top-N 片段，返回结构化命中（含源文件名/章节/页码/片段/得分）
   *  与 buildPromptBlock 的区别：不拼装 prompt 字符串，返回结构化对象供工具协议回填给模型；
   *  片段截断到 MAX_SNIPPET_CHARS 以省 token；支持 fileFilter 限定某文件内检索。
   *  未绑定/未启用/无命中 → 返回 {ok:true,count:0,hits:[]}（让模型按规则声明「未找到」） */
  function search(query,opts){
    opts=opts||{};
    if(!state.enabled||!state.blocks.length)return {ok:true,count:0,hits:[]};
    const qTokens=tokenize(query||'');
    if(!qTokens.length)return {ok:true,count:0,hits:[]};
    const limit=opts.topN?(function(){const v=Math.max(1,Math.min(10,parseInt(opts.topN,10)||DEFAULT_TOPN));return v;})():state.topN;
    let hits=bmQuery(qTokens,limit);
    if(opts.fileFilter){
      const ff=String(opts.fileFilter).toLowerCase();
      hits=hits.filter(function(h){
        const b=state.blocks[h.i];const f=(b&&typeof b.file==='number')?state.files[b.file]:null;
        const name=((f&&(f.name||''))+' '+(f&&(f.rel||''))).toLowerCase();
        return name.includes(ff);
      });
    }
    const out=hits.map(function(hit){
      const b=state.blocks[hit.i];
      const f=(b&&typeof b.file==='number')?state.files[b.file]:null;
      const name=(f&&f.name)?f.name:'未知来源';
      const rel=(f&&f.rel)||'';
      const text=b.text||'';
      const snippet=text.length>MAX_SNIPPET_CHARS?(text.slice(0,MAX_SNIPPET_CHARS)+'…'):text;
      return {file:name,rel:rel,chapter:b.chapter||'',page:b.page||0,score:Number(hit.score.toFixed(3)),snippet:snippet};
    });
    return {ok:true,count:out.length,hits:out};
  }
  /** 列出知识库内全部/筛选文件元数据（供 list_kb_files 工具，让模型先了解资料范围） */
  function listFiles(keyword){
    const cnt={};
    (state.blocks||[]).forEach(function(b){if(typeof b.file==='number')cnt[b.file]=(cnt[b.file]||0)+1;});
    let list=(state.files||[]).map(function(f,i){
      return {name:f.name||'',rel:f.rel||'',chars:Number(f.chars)||0,blocks:cnt[i]||0,indexedAt:state.indexedAt||0};
    });
    if(keyword){
      const kw=String(keyword).toLowerCase();
      list=list.filter(function(f){return (f.name||'').toLowerCase().includes(kw)||(f.rel||'').toLowerCase().includes(kw);});
    }
    return {ok:true,count:list.length,files:list};
  }
  /** 取某文件指定区间的分块全文（供 get_kb_file 工具，用于「定位原文」深度查阅）
   *  range=[startBlock,endBlock] 可选；累计超 MAX_GETFILE_CHARS 截断并标 truncated
   *  同步接口：bootApp 启动时已 init，常态 state.ready；未初始化时返回空结果兜底 */
  function getFileBlocks(nameOrRel,range){
    if(!state.files.length)return {ok:false,error:'知识库未初始化'};
    const f=state.files.find(function(x){return x.rel===nameOrRel||x.name===nameOrRel;});
    if(!f)return {ok:false,error:'未找到文件：'+nameOrRel};
    let blocks=state.blocks.filter(function(b){return b.file===f.id;});
    let truncated=false;
    if(Array.isArray(range)&&range.length===2){
      const s=Math.max(0,parseInt(range[0],10)||0);
      const e=Math.min(blocks.length,parseInt(range[1],10)||blocks.length);
      blocks=blocks.slice(s,e);
    }
    let acc=0;const out=[];
    for(let i=0;i<blocks.length;i++){
      const b=blocks[i];const t=b.text||'';
      if(acc+t.length>MAX_GETFILE_CHARS){
        out.push({index:i,chapter:b.chapter||'',page:b.page||'',text:t.slice(0,Math.max(0,MAX_GETFILE_CHARS-acc))+'…'});
        truncated=true;break;
      }
      out.push({index:i,chapter:b.chapter||'',page:b.page||'',text:t});
      acc+=t.length;
    }
    return {ok:true,file:f.name,rel:f.rel,blocks:out,truncated:truncated};
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
      activeRetrieval:state.activeRetrieval,autoInjectFallback:state.autoInjectFallback,
      files:state.files.length,blocks:state.blocks.length,chars:state.chars,
      indexedAt:state.indexedAt,indexing:state.indexing,error:state.error
    };
  }

  return {
    init,chooseDir,chooseFiles,rescan,unbind,setEnabled,setTopN,setCite,setActiveRetrieval,setAutoInjectFallback,
    buildPromptBlock,fileBlocks,summarize,state,
    search,listFiles,getFileBlocks,
    tokenize,splitBlocks,isSupported,bmQuery,
    ensureFresh,startAutoScan,stopAutoScan
  };
})();
// 初始化时机：由 app.js 的 bootApp 异步挂载（不阻塞首屏），见 app.js
