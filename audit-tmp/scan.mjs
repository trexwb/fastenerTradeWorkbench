import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const files = [];
(function walk(d){
  for (const e of fs.readdirSync(d, {withFileTypes:true})) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules','dist','src-tauri'].includes(e.name)) walk(p); }
    else if (/\.(js|vue|html)$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT,'src'));

const RESERVED = new Set(['if','for','while','switch','catch','function','return','typeof','new','delete','void','in','of','do','else','try','const','let','var','await','async','throw','case','break','continue','instanceof','this','super','yield','parseInt','parseFloat','isNaN','String','Number','Boolean','Array','Object','JSON','Date','Math','fetch','alert','confirm','prompt','setTimeout','setInterval','clearTimeout','clearInterval','encodeURIComponent','decodeURIComponent','event','window','document','console','localStorage','indexedDB','navigator','history','location','AbortController','FileReader','Blob','URL','URLSearchParams','TextDecoder','TextEncoder','Uint8Array','Promise','Error','structuredClone','crypto']);
const defs = new Map(), refs = new Map(), hrefs = [], idsRef = new Map(), idsDef = new Map();
const add = (map,k,v)=>{ if(!map.has(k)) map.set(k,[]); map.get(k).push(v); };

for (const f of files) {
  const src = fs.readFileSync(f,'utf8');
  const rel = path.relative(ROOT,f);
  src.split('\n').forEach((ln,i)=>{
    const line = i+1;
    let m;
    for (const re of [
      /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$.]*\s*=>)/g,
      /\bwindow\.([A-Za-z_$][\w$]*)\s*=/g,
      /^\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/g,
    ]) { re.lastIndex=0; while((m=re.exec(ln))) add(defs,m[1],`${rel}:${line}`); }
    const reOn = /\bon([a-z]{2,12})\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    while((m=reOn.exec(ln))){
      const body = m[2] ?? m[3]; if(!body) continue;
      const reCall = /([A-Za-z_$][\w$]*)\s*\(/g; let c;
      while((c=reCall.exec(body))){
        if (RESERVED.has(c[1])) continue;
        add(refs,c[1],`${rel}:${line} on${m[1]}= "${body.slice(0,60)}"`);
      }
    }
    const reHref = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    while((m=reHref.exec(ln))){ const h=m[1]??m[2]; if(h==='#'||h==='') hrefs.push(`${rel}:${line} href="${h}"`); }
    const reG = /getElementById\(\s*([`'"])([\w-]+)\1\s*\)/g;
    while((m=reG.exec(ln))) add(idsRef,m[2],`${rel}:${line}`);
    const reQ = /querySelector(?:All)?\(\s*([`'"])#([\w-]+)\1/g;
    while((m=reQ.exec(ln))) add(idsRef,m[2],`${rel}:${line}`);
    const reId = /\bid\s*=\s*(?:"([\w-]+)"|'([\w-]+)')/g;
    while((m=reId.exec(ln))){ const id=m[1]??m[2]; if(id) add(idsDef,id,`${rel}:${line}`); }
  });
}

console.log('=== INLINE HANDLER REFS WITHOUT GLOBAL DEF ===');
for (const [name,uses] of [...refs].sort()) {
  if (!defs.has(name)) console.log(' ', name, '→', uses.slice(0,4).join(' | '), uses.length>4?`(+${uses.length-4} more)`:'');
}
console.log('=== href="#" / href="" ==='); hrefs.slice(0,40).forEach(x=>console.log(' ',x));
console.log('=== getElementById/querySelector targets never defined as static id= ===');
for (const [id,uses] of [...idsRef].sort()) if(!idsDef.has(id)) console.log(' ', id, '→', uses.slice(0,3).join(' | '));
console.log('=== counts ===', JSON.stringify({defs:defs.size, refNames:refs.size, hrefEmptys:hrefs.length, idsRef:idsRef.size, idsDef:idsDef.size}));
