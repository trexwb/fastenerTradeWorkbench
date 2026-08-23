#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   紧固件贸易工作台 — 版本号一致性校验脚本
   ───────────────────────────────────────────────────────────────────
   用法：node scripts/check-version.mjs
   以 package.json 的 version 为基准，比对其余 5 处版本号
   （package-lock.json 存在时才校验），全部一致退出 0，
   任一不一致列出差异并退出 1（可挂 pre-commit / CI）。
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const base = JSON.parse(read('package.json')).version; // 基准版本
const VV = 'v' + base;

const checks = [
  ['src-tauri/tauri.conf.json', JSON.parse(read('src-tauri/tauri.conf.json')).version, base],
  ['src-tauri/Cargo.toml', /^version = "(\d+\.\d+\.\d+)"$/m.exec(read('src-tauri/Cargo.toml'))?.[1], base],
  ['src/js/store.js APP_VERSION', /APP_VERSION='v(\d+\.\d+\.\d+)'/.exec(read('src/js/store.js'))?.[1], base],
  ['AGENTS.md 当前基准版本', /当前基准版本：\*\*v(\d+\.\d+\.\d+)\*\*/.exec(read('AGENTS.md'))?.[1], base],
  ['src/index.html 顶部注释', /（当前 v(\d+\.\d+\.\d+)）/.exec(read('src/index.html'))?.[1], base],
];

if (fs.existsSync(path.join(ROOT, 'package-lock.json'))) {
  const lock = JSON.parse(read('package-lock.json'));
  checks.push(
    ['package-lock.json 顶层', lock.version, base],
    ['package-lock.json packages[""]', lock.packages && lock.packages[''] && lock.packages[''].version, base],
  );
}

let bad = 0;
for (const [label, actual, expect] of checks) {
  const ok = actual === expect;
  if (!ok) bad++;
  console.log(`${ok ? '✅' : '❌'} ${label}: ${actual ?? '(未找到)'} ${ok ? '' : `≠ ${expect}`}`);
}

if (bad === 0) {
  console.log(`\n全部 ${checks.length} 处版本号一致（${VV}）`);
  process.exit(0);
} else {
  console.log(`\n发现 ${bad} 处不一致！请运行: npm run version:set <x.y.z>`);
  process.exit(1);
}
