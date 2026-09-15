// core/ai-files.js — AI 对话附件解析（v1.0.40，window.AF）
// 职责：把用户在 AI 助手里选择的本地文件（txt/md/markdown/log/csv/xls/xlsx/docx/pdf）
//       解析为纯文本，供对话上下文注入。与知识库（kb.js）互不依赖：
//       KB=目录级知识库（索引/BM25/引用）；AF=单条消息级附件（全文直读）。
// 直读约定（需求原文：「不用真的上传，可以直接读取文件就不用存储。如果不能直接读取就
// 存储放到应用能识别的临时文件中，使用完成后删除」）：
//   - 浏览器（含 file:// 双击运行）：<input type=file> / 拖拽得到 File 对象 → arrayBuffer() 直读；
//   - Tauri 桌面版：文件选择器 / 拖拽得到绝对路径 → kb_read_b64 / kb_read_pdf_text 直读；
//   - 两条通道均无需落盘中转 → 全程不产生临时文件，无需任何清理动作；
//   - 若未来出现无法直读的来源，由调用方补「写临时文件 → 用完删除」兜底，本模块不落盘。
// 解析依赖（全部复用既有链路，不新增 npm 依赖、不走 CDN 新增）：
//   - 文本/CSV：TextDecoder（UTF-8 优先，乱码字符超阈值自动 GBK 兜底再解码）
//   - Excel（xls/xlsx）：exporter.js 顶层 loadXLSX()（vendor/xlsx.min.js 本地优先 + CDN 兜底）
//   - docx：window.__KB_DEPS.mammoth（main.js 已随 bundle 打包挂载）
//   - pdf：Tauri 走 Rust kb_read_pdf_text；浏览器走 window.__KB_DEPS.pdfjs（pdfjs-dist）
window.AF=(function(){
  const EXT_TEXT=['.txt','.md','.markdown','.log','.csv'];
  const EXT_EXCEL=['.xls','.xlsx'];
  const EXT_DOCX='.docx';
  const EXT_PDF='.pdf';
  const ACCEPT=EXT_TEXT.concat(EXT_EXCEL,[EXT_DOCX,EXT_PDF]).join(',');
  const IS_TAURI_AF=!!(window.__TAURI__&&window.__TAURI__.core&&typeof window.__TAURI__.core.invoke==='function');
  const MAX_FILE_BYTES=20*1024*1024;   // 单文件字节上限（与知识库 20MB 对齐）
  const MAX_FILE_CHARS=200000;         // 单附件入库字符上限（全文随消息存 IndexedDB；注入另有预算）
  const MAX_SHEET_CHARS=60000;         // 单工作表 CSV 字符上限
  const MAX_EXCEL_SHEETS=20;           // 最多读取的工作表数
  const MAX_PDF_PAGES=200;             // 最多提取的 PDF 页数（与 KB 对齐）

  function extOf(name){const i=String(name||'').lastIndexOf('.');return i>=0?String(name).slice(i).toLowerCase():'';}
  function isSupported(name){const e=extOf(name);return EXT_TEXT.indexOf(e)>=0||EXT_EXCEL.indexOf(e)>=0||e===EXT_DOCX||e===EXT_PDF;}

  /* ---------- Excel：确保 SheetJS 就绪（复用 exporter.js 顶层 loadXLSX：本地 vendor 优先 + CDN 兜底） ---------- */
  function ensureXLSX(){
    if(window.XLSX&&window.XLSX.utils&&typeof window.XLSX.read==='function')return Promise.resolve();
    // loadXLSX 是 exporter.js 的顶层函数：项目全部业务 JS 由 App.vue 合并为一次间接 eval 执行，
    // 顶层函数共享同一全局作用域，这里直接复用（不重复实现加载器，不新增 CDN 常量）。
    if(typeof loadXLSX==='function'){
      return loadXLSX().then(function(){
        if(!(window.XLSX&&window.XLSX.utils))throw new Error('XLSX 库加载异常');
      });
    }
    return Promise.reject(new Error('Excel 解析库不可用（loadXLSX 未就绪且 window.XLSX 为空），请刷新页面后重试'));
  }

  /* ---------- 字节读取：浏览器 File 直读 / Tauri 路径直读（统一返回 Uint8Array） ---------- */
  async function readBytes(entry){
    if(entry&&entry.file&&typeof entry.file.arrayBuffer==='function'){
      const buf=await entry.file.arrayBuffer();
      return new Uint8Array(buf);
    }
    if(entry&&entry.path&&IS_TAURI_AF){
      const b64=await window.__TAURI__.core.invoke('kb_read_b64',{path:String(entry.path)});
      const bin=atob(String(b64));
      const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      return bytes;
    }
    throw new Error('无法读取文件内容（缺少可读来源：既无 File 对象也无可用的本地路径）');
  }

  /* ---------- 文本解码：UTF-8 优先，乱码比例超阈值时 GBK 兜底（国内 Excel/记事本常见 GBK 导出） ---------- */
  function decodeSmart(bytes){
    let text=new TextDecoder('utf-8').decode(bytes);
    if(text.charCodeAt(0)===0xFEFF)text=text.slice(1); // 剥 UTF-8 BOM
    const total=text.length||1;
    const bad=(text.match(/\uFFFD/g)||[]).length;
    if(bad>0&&bad/total>0.003){
      try{
        const gbk=new TextDecoder('gbk').decode(bytes);
        const g0=gbk.charCodeAt(0)===0xFEFF?gbk.slice(1):gbk;
        const badG=(g0.match(/\uFFFD/g)||[]).length;
        if(badG<bad)text=g0;
      }catch(e){/* 运行环境不支持 GBK 解码时保持 UTF-8 结果 */}
    }
    return text;
  }

  /* ---------- Excel（xls/xlsx）：逐表转 CSV（Tab 分隔，紧凑且模型可读） ---------- */
  async function parseExcel(bytes){
    await ensureXLSX();
    const wb=window.XLSX.read(bytes,{type:'array',cellDates:true});
    const names=(wb&&wb.SheetNames)||[];
    if(!names.length)throw new Error('Excel 中没有工作表');
    const sheets=names.slice(0,MAX_EXCEL_SHEETS);
    const out=[];let truncated=false;
    sheets.forEach(function(sn,idx){
      const ws=wb.Sheets[sn];
      if(!ws)return;
      let csv='';
      try{csv=window.XLSX.utils.sheet_to_csv(ws,{FS:'\t',blankrows:false})||'';}catch(e){csv='';}
      if(csv.length>MAX_SHEET_CHARS){csv=csv.slice(0,MAX_SHEET_CHARS)+'\n…（本工作表超长已截断）';truncated=true;}
      out.push('### 工作表 '+(idx+1)+'/'+names.length+'：'+sn+' ###\n'+(csv.trim()||'（空表）'));
    });
    if(names.length>MAX_EXCEL_SHEETS){out.push('…（工作表超过 '+MAX_EXCEL_SHEETS+' 个，其余省略）');truncated=true;}
    let text=out.join('\n\n');
    if(text.length>MAX_FILE_CHARS){text=text.slice(0,MAX_FILE_CHARS)+'\n…（文件内容超出上限已截断）';truncated=true;}
    if(!text.trim())throw new Error('Excel 中没有可读取的内容');
    return {text:text,truncated:truncated};
  }

  /* ---------- PDF（浏览器通道）：pdfjs 逐页提取文字层（与 kb.js 同源逻辑的精简版） ---------- */
  async function parsePdfBrowser(bytes){
    const deps=window.__KB_DEPS||{};
    if(!deps.pdfjs)throw new Error('PDF 解析器未加载，请刷新页面后重试');
    let task=null,pdf=null;
    try{
      task=deps.pdfjs.getDocument({data:bytes});
      pdf=await task.promise;
      const rows=[];let pagesWithText=0;
      const numPages=Number(pdf.numPages)||0;
      const maxPages=Math.min(numPages,MAX_PDF_PAGES);
      for(let p=1;p<=maxPages;p++){
        try{
          const page=await pdf.getPage(p);
          const tc=await page.getTextContent();
          const t=(tc.items||[]).map(function(it){return (it&&it.str)||'';}).join(' ');
          if(t.trim())pagesWithText++;
          String(t).split('\n').forEach(function(line){rows.push(line);});
        }catch(e){/* 单页失败跳过 */}
      }
      let full=rows.join('\n').replace(/[ \t]{2,}/g,' ').replace(/\n{2,}/g,'\n').trim();
      let truncated=maxPages<numPages;
      if(full.length>MAX_FILE_CHARS){full=full.slice(0,MAX_FILE_CHARS);truncated=true;}
      if(!full){
        if(maxPages>0&&pagesWithText===0)throw new Error('PDF 未包含可提取文本（扫描/图片型 PDF 无文字层，暂不支持 OCR）');
        throw new Error('PDF 文本提取为空，请确认文件未损坏');
      }
      return {text:full,truncated:truncated};
    }finally{
      // pdfjs-dist v6 销毁入口是 loadingTask.destroy()；清理失败不影响已提取结果
      try{if(task&&typeof task.destroy==='function')await task.destroy();}catch(e){console.warn('[AF] PDF 资源释放失败',e);}
    }
  }
  /* ---------- PDF（Tauri 通道）：Rust 侧 pdf-extract 直读路径（绕开 WKWebView 差异，与 KB 一致） ---------- */
  async function parsePdfTauri(path){
    let text='';
    try{text=await window.__TAURI__.core.invoke('kb_read_pdf_text',{path:String(path)})||'';}
    catch(err){throw new Error('PDF 文本提取失败：'+String((err&&err.message)||err));}
    let full=String(text).replace(/\r\n?/g,'\n').replace(/\n{2,}/g,'\n').trim();
    let truncated=false;
    if(full.length>MAX_FILE_CHARS){full=full.slice(0,MAX_FILE_CHARS);truncated=true;}
    if(!full)throw new Error('PDF 未包含可提取文本（扫描/图片型 PDF 无文字层，暂不支持 OCR）');
    return {text:full,truncated:truncated};
  }

  /* ---------- 主入口：单个附件 → {status:'ready'|'error', ext, chars, truncated, text, error} ---------- */
  async function parseEntry(entry){
    const name=String((entry&&entry.name)||'');
    const ext=extOf(name);
    const base={ext:ext};
    if(!isSupported(name))return Object.assign(base,{status:'error',error:'不支持的文件类型（支持 txt/md/markdown/log/csv/xls/xlsx/docx/pdf）',chars:0,truncated:false,text:''});
    let size=Number(entry&&entry.size)||0;
    if(!size&&entry&&entry.file)size=Number(entry.file.size)||0;
    if(size>MAX_FILE_BYTES)return Object.assign(base,{status:'error',error:'文件超过 20MB 解析上限',chars:0,truncated:false,text:''});
    try{
      if(EXT_TEXT.indexOf(ext)>=0){
        const bytes=await readBytes(entry);
        let text=decodeSmart(bytes);
        let truncated=false;
        if(text.length>MAX_FILE_CHARS){text=text.slice(0,MAX_FILE_CHARS);truncated=true;}
        if(!text.trim())return Object.assign(base,{status:'error',error:'文件内容为空',chars:0,truncated:false,text:''});
        return Object.assign(base,{status:'ready',text:text,chars:text.length,truncated:truncated});
      }
      if(EXT_EXCEL.indexOf(ext)>=0){
        const bytes=await readBytes(entry);
        const r=await parseExcel(bytes);
        return Object.assign(base,{status:'ready',text:r.text,chars:r.text.length,truncated:!!r.truncated});
      }
      if(ext===EXT_DOCX){
        const deps=window.__KB_DEPS||{};
        if(!deps.mammoth)throw new Error('docx 解析器未加载，请刷新页面后重试');
        const bytes=await readBytes(entry);
        const res=await deps.mammoth.extractRawText({arrayBuffer:bytes.buffer});
        let text=String((res&&res.value)||'');
        let truncated=false;
        if(text.length>MAX_FILE_CHARS){text=text.slice(0,MAX_FILE_CHARS);truncated=true;}
        if(!text.trim())throw new Error('docx 中没有可提取的正文');
        return Object.assign(base,{status:'ready',text:text,chars:text.length,truncated:truncated});
      }
      if(ext===EXT_PDF){
        const r=(entry&&entry.path&&IS_TAURI_AF)?(await parsePdfTauri(entry.path)):(await parsePdfBrowser(await readBytes(entry)));
        return Object.assign(base,{status:'ready',text:r.text,chars:r.text.length,truncated:!!r.truncated});
      }
      return Object.assign(base,{status:'error',error:'未识别的文件类型',chars:0,truncated:false,text:''});
    }catch(e){
      return Object.assign(base,{status:'error',error:String((e&&e.message)||e||'解析失败'),chars:0,truncated:false,text:''});
    }
  }

  /* ---------- 正文路径提取（v1.0.41）：从消息文本识别本地文件路径候选 ----------
   * 识别范围：Unix 绝对路径（/…）、Windows 盘符路径（C:\… / C:/…）、家目录（~/…）；
   * 以空白与全角标点为界（含空格的路径请用附件按钮/拖拽）；仅保留 AF 白名单扩展名，
   * 天然排除 URL（https://…）、时间比例（3:2）等假阳性。是否真实可读由调用方解析时校验。 */
  function extractPaths(text){
    const s=String(text||'');
    if(!s)return [];
    const out=[];const seen={};
    const push=function(p0){
      let p=String(p0||'').replace(/[.，、；！？）》」】"”']+$/,'').trim();
      if(!p)return;
      const base=p.replace(/\\/g,'/').split('/').pop()||'';
      if(!base||seen[p])return;
      seen[p]=1;
      if(isSupported(base))out.push(p);
    };
    let m;
    const reWin=/[A-Za-z]:[\\/][^\s，。；！？、（）】」「【"“”'<>|*?]+/g;          // C:\dir\file.ext / C:/dir/file.ext
    const reHome=/(?:^|[\s（(「【"“'])(~\/[^\s，。；！？、（）】」「【"“”'<>]+)(?=[\s，。；！？、（）】」「【"“”]|$)/g; // ~/dir/file.ext
    const reUx=/(?:^|[\s（(「【"“'])(\/[^\s，。；！？、（）】」「【"“”'<>]+)(?=[\s，。；！？、（）】」「【"“”]|$)/g;   // /dir/file.ext
    while((m=reWin.exec(s)))push(m[0]);
    while((m=reHome.exec(s)))push(m[1]);
    while((m=reUx.exec(s)))push(m[1]);
    return out;
  }

  return {
    ACCEPT,extOf,isSupported,parseEntry,extractPaths,
    MAX_FILE_CHARS,MAX_FILE_BYTES
  };
})();
