#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   紧固件贸易工作台 — 版本号统一更新脚本
   ───────────────────────────────────────────────────────────────────
   用法：
     node scripts/bump-version.mjs 1.0.8        # 更新全部版本号
     node scripts/bump-version.mjs 1.0.8 --dry-run  # 只预览不写入
   覆盖位置（6 处 / 5 文件，package-lock.json 存在时才更新）：
     package.json / package-lock.json(顶层+packages[""]) /
     tauri.conf.json / Cargo.toml / core/store.js(APP_VERSION 回退值) /
     AGENTS.md(当前基准版本)
   README.md 更新日志为历史记录，不在本脚本范围（内容需人工编写）。
   index.html 顶部注释为 Vite 构建期注入说明，不含版本字面量，无需更新。
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const versionArg = args.find((a) => !a.startsWith('--'));

if (!versionArg || !/^v?\d+\.\d+\.\d+$/.test(versionArg)) {
  console.error('用法: node scripts/bump-version.mjs <x.y.z | vx.y.z> [--dry-run]');
  process.exit(1);
}
const V = versionArg.replace(/^v/, ''); // 1.0.8（兼容 v1.0.8 写法）
const VV = 'v' + V;                     // v1.0.8

const results = [];

function patchJson(file, apply, label) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    results.push(`⚠️  ${file}: 不存在，跳过`);
    return;
  }
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const before = JSON.stringify(d);
  apply(d);
  const after = JSON.stringify(d);
  if (before === after) {
    results.push(`⚠️  ${file}: 未匹配到版本号（${label}），跳过`);
    return;
  }
  if (!dryRun) fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  results.push(`${dryRun ? '🔍' : '✅'} ${file}: ${label}`);
}

function patchText(file, regex, replace, label) {
  const p = path.join(ROOT, file);
  const raw = fs.readFileSync(p, 'utf8');
  const out = raw.replace(regex, replace);
  if (out === raw) {
    results.push(`⚠️  ${file}: 未匹配到版本号（${label}），跳过`);
    return;
  }
  if (!dryRun) fs.writeFileSync(p, out);
  results.push(`${dryRun ? '🔍' : '✅'} ${file}: ${label}`);
}

/* ── JSON 类 ────────────────────────────────────────────────────── */
patchJson('package.json', (d) => { d.version = V; }, `version -> ${V}`);
patchJson('package-lock.json', (d) => {
  d.version = V;
  if (d.packages && d.packages['']) d.packages[''].version = V;
}, `顶层 + packages[""] -> ${V}`);
patchJson('src-tauri/tauri.conf.json', (d) => { d.version = V; }, `version -> ${V}（打包产物版本）`);

/* ── 文本类 ─────────────────────────────────────────────────────── */
patchText('src-tauri/Cargo.toml', /^version = "\d+\.\d+\.\d+"$/m, `version = "${V}"`, `version -> ${V}`);
// 注：store.js 的 APP_VERSION 为 Vite define 注入（__APP_VERSION__），源码保留回退值字面量，
// 此处同步该回退值，保证脱离 Vite 构建（单文件/原生加载）时展示的版本号一致。
patchText('src/core/store.js', /__APP_VERSION__\s*:\s*'v\d+\.\d+\.\d+'/, `__APP_VERSION__ : '${VV}'`, `APP_VERSION 回退值 -> ${VV}`);
patchText('AGENTS.md', /当前基准版本：\*\*v\d+\.\d+\.\d+\*\*/, `当前基准版本：**${VV}**`, `当前基准版本 -> ${VV}`);

console.log(results.join('\n'));
console.log(dryRun
  ? '\n[dry-run] 未写入任何文件'
  : `\n完成：全部版本号已统一为 ${VV}（README 更新日志请人工补充）`);
