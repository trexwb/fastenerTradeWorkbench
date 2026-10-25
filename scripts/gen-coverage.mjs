#!/usr/bin/env node
/**
 * 生成 docs/COVERAGE.md —— 代码文档覆盖率报告。
 * 口径：src/core/ + src/views/ 下每个 .js 文件里 `function` 声明数 vs JSDoc 块（以 /+两个星号 开头）数。
 * 用法：node scripts/gen-coverage.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'src');
const OUT_FILE = join(ROOT, 'docs', 'COVERAGE.md');
const SCAN_DIRS = ['core', 'views'];
const FULL_THRESHOLD = 100;
const PARTIAL_THRESHOLD = 60;

const readVersion = () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return pkg.version || '0.0.0';
};

const countFunctions = (src) => (src.match(/(^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+[\w$]+/g) || []).length;
const countJsdoc = (src) => (src.match(/\/\*\*/g) || []).length;

const statusOf = (pct) => {
  if (pct >= FULL_THRESHOLD) return '🟢 完整';
  if (pct >= PARTIAL_THRESHOLD) return '🟡 部分';
  return '🔴 待补';
};

const collect = () => {
  const rows = [];
  for (const dir of SCAN_DIRS) {
    const files = readdirSync(join(SRC_DIR, dir)).filter((f) => f.endsWith('.js')).sort();
    for (const file of files) {
      const src = readFileSync(join(SRC_DIR, dir, file), 'utf8');
      const fn = countFunctions(src);
      const js = countJsdoc(src);
      rows.push({ file: `src/${dir}/${file}`, fn, js, pct: fn ? Math.round((js / fn) * 100) : 0 });
    }
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file));
};

const main = () => {
  const rows = collect();
  const totalFn = rows.reduce((s, r) => s + r.fn, 0);
  const totalJs = rows.reduce((s, r) => s + r.js, 0);
  const totalPct = totalFn ? Math.round((totalJs / totalFn) * 100) : 0;
  const version = `v${readVersion()}`;
  const today = new Date().toISOString().slice(0, 10);

  const table = rows
    .map((r) => `| \`${r.file}\` | ${r.fn} | ${r.js} | ${r.pct}% | ${statusOf(r.pct)} |`)
    .join('\n');

  const md = `# 代码文档覆盖率报告

> 生成时间: ${today}
> 项目版本: ${version}（结构：\`src/core/\` 数据/工具/UI 层 + \`src/views/\` 视图层 + \`src/styles/\` 设计体系）
> 覆盖率: **${totalJs}/${totalFn} 函数 (${totalPct}%)**（口径：顶层与模块内 \`function\` 声明数 vs \`/** */\` JSDoc 块数，脚本自动扫描）
> 重新生成：\`node scripts/gen-coverage.mjs\`

---

## 1. 覆盖率总览

| 文件 | 函数数 | JSDoc | 覆盖率 | 状态 |
|------|-------|-------|--------|------|
${table}
| **合计** | **${totalFn}** | **${totalJs}** | **${totalPct}%** | — |

## 2. 说明

- 本文件由 \`scripts/gen-coverage.mjs\` 按当前 \`src/core/\` + \`src/views/\` 实际代码自动扫描生成，覆盖全部 ${rows.length} 个业务 JS 文件。
- 覆盖率 >100% 表示该文件除函数外还有常量、类型、命名空间等带 JSDoc 的注释块，属正常现象。
- AI 工具清单见 \`docs/API.md\` §7.4；订单状态机说明见 \`docs/操作手册.md\` §7.4。
- 版本历史见 \`docs/version/RELEASE-v1.0.md\`。
`;

  writeFileSync(OUT_FILE, md, 'utf8');
  console.log(`[gen-coverage] ${version} · ${totalJs}/${totalFn} (${totalPct}%) · ${rows.length} files -> docs/COVERAGE.md`);
};

main();
