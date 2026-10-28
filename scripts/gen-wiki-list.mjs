#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   gen-wiki-list.mjs — 把 list.json 转换为 list.js（云端文章清单）
   ───────────────────────────────────────────────────────────────────
   输入：https://wiki.edtib.com/wiki/list.json（或本地副本）
   输出：list.js（window.__WIKI_LIST = [...]）

   为什么要转成 JS：
     dist/index.html 需要支持 file:// 双击运行，此时页面 origin 为 null，
     fetch('list.json') 会被 CORS 拦截（除非服务端显式加 Access-Control-Allow-Origin）；
     而 <script src> 不受同源限制，与 index.js 同策略，零 CORS 成本。

   用法：
     node scripts/gen-wiki-list.mjs                          # 默认拉线上 list.json 写到 src/public/wiki/list.js
     node scripts/gen-wiki-list.mjs /tmp/list.json           # 从本地文件读
     node scripts/gen-wiki-list.mjs https://x.com/list.json  # 自定义 URL
     node scripts/gen-wiki-list.mjs -                        # 从 stdin 读（可配合 curl | node ... -）
     node scripts/gen-wiki-list.mjs -o /tmp/list.js          # 指定输出路径
   ═══════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_URL = 'https://wiki.edtib.com/wiki/list.json'
const DEFAULT_OUT = resolve('src/public/wiki/list.js')

const args = process.argv.slice(2)
let input = DEFAULT_URL
let output = DEFAULT_OUT
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o' || args[i] === '--output') output = resolve(args[++i])
  else if (args[i] === '-' || !args[i].startsWith('-')) input = args[i]
}

async function loadList(src) {
  if (src === '-') {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src)
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + src)
    return await res.json()
  }
  return JSON.parse(readFileSync(src, 'utf8'))
}

try {
  const list = await loadList(input)
  if (!Array.isArray(list)) throw new Error('list.json 根节点必须是数组')

  const cleaned = list
    .filter(e => e && typeof e.title === 'string' && typeof e.url === 'string')
    .map(e => ({
      title: e.title,
      url: e.url,
      category: e.category || '',
      updated_at: e.updated_at || '',
    }))

  const js = '/* Auto-generated from list.json — DO NOT edit by hand. */\n'
    + '/* Source: ' + input + ' */\n'
    + 'window.__WIKI_LIST = ' + JSON.stringify(cleaned, null, 2) + ';\n'

  writeFileSync(output, js, 'utf8')
  console.log('[wiki-list] ✓ 生成 ' + cleaned.length + ' 篇文章清单 → ' + output)
} catch (err) {
  console.error('[wiki-list] ✗ ' + (err && err.message ? err.message : err))
  process.exit(1)
}
