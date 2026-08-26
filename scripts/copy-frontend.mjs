/* ═══════════════════════════════════════════════════════════════════
   紧固件贸易工作台 — 构建前前端资源拷贝
   把浏览器版真源（src/ 下的 index.html + css/ + js/ + images/）复制到
   dist/，供 Tauri `frontendDist` 使用。这样：
     • src/index.html 仍是浏览器版入口（不被改动）
     • Tauri 的 frontendDist 是隔离的干净目录，通过配置校验
   跨平台（Node 内置 fs/path），Windows 构建机同样适用。
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // 紧固件贸易工作台根目录
const SRC = path.join(ROOT, 'src');         // 前端真源目录
const DIST = path.join(ROOT, 'dist');

// 清空并重建 dist
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const targets = ['index.html', 'css', 'js', 'images'];
for (const rel of targets) {
  const src = path.join(SRC, rel);
  if (!fs.existsSync(src)) {
    console.warn(`[紧固件贸易工作台] 跳过（不存在）: ${rel}`);
    continue;
  }
  fs.cpSync(src, path.join(DIST, rel), { recursive: true });
  console.log(`[紧固件贸易工作台] 已拷贝: ${rel}`);
}

console.log('[紧固件贸易工作台] 前端资源已准备到 dist/');
