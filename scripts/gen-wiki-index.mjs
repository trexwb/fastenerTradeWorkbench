#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   gen-wiki-index.mjs — 专业解读文档索引生成器
   ───────────────────────────────────────────────────────────────────
   扫描 src/public/wiki/*.html，提取标题/摘要/分类/标签，产出
   src/public/wiki/index.js（注意：不是 .json）。

   ⚠ 为什么产物是 JS 而不是 JSON：
     dist/index.html 需要支持 file:// 双击运行，此时页面 origin 为 null，
     fetch('wiki/index.json') 会被 CORS 拦截而失败；而 <script src> 不受此限制。
     因此索引统一产出为 `window.__WIKI_INDEX = {...}`，由 views/wiki.js
     动态注入 <script> 加载（与 core/exporter.js 加载 vendor/xlsx.min.js 同策略）。

   索引 version 2（2026-10-27）起新增 docs[i].text：构建期从文档提取的纯文本
   （去 script/style/注释与标签，截断到 TEXT_MAX），仅供站内全文检索使用，
   不改动文档本身、也不参与打包编译。

   元数据约定（可选，写在 <head> 内）：
     <title>                               → 卡片标题（必填，缺失回退文件名）
     <meta name="description" content="">  → 卡片摘要（缺失时自动截取正文首段 <p>）
     <meta name="wiki-category" content="">→ 分组名（缺失归入「专业解读」）
     <meta name="wiki-tags" content="a,b"> → 标签（逗号分隔）
     <meta name="wiki-order" content="10"> → 排序权重（越小越靠前，缺失按文件名）

   用法：
     npm run wiki:index     # 手动重建
     （vite.config.js 的 ftwb-wiki-index 插件会在 dev 启动/文档增删改 与 build 前自动调用）
   ═══════════════════════════════════════════════════════════════════ */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WIKI_DIR = resolve(ROOT, 'src/public/wiki')
const OUT_FILE = resolve(WIKI_DIR, 'index.js')
const DEFAULT_CATEGORY = '专业解读'
const DESC_MAX = 96
const TEXT_MAX = 20000  // 全文检索文本上限（字符），控制 index.js 体积

/** 取第一个捕获组，未命中返回空串 */
function pick(re, html) {
  const m = html.match(re)
  return m ? m[1] : ''
}

/** HTML 实体解码（只处理文档标题/摘要里常见的几种） */
function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 去标签 + 压缩空白 */
function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** 读取 <meta name="xxx" content="yyy"> 的 content（属性顺序两种都兼容） */
function metaContent(html, name) {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re1 = new RegExp(`<meta\\s+[^>]*name=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i')
  const re2 = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*name=["']${n}["']`, 'i')
  return pick(re1, html) || pick(re2, html)
}

/** 摘要兜底：正文首个 <p>，去掉 script/style 后再抓 */
function firstParagraph(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  const m = body.match(/<p[^>]*>([\s\S]{20,600}?)<\/p>/i)
  return m ? stripTags(m[1]) : ''
}

/** 全文检索文本：去 script/style/注释与标签，压缩空白，截断到 TEXT_MAX */
function extractText(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(body).replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
}

/** 截断摘要，尽量断在标点处 */
function clip(text) {
  const s = String(text || '').trim()
  if (s.length <= DESC_MAX) return s
  const cut = s.slice(0, DESC_MAX)
  const at = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('，'), cut.lastIndexOf('；'), cut.lastIndexOf('、'))
  return (at > DESC_MAX * 0.6 ? cut.slice(0, at) : cut).replace(/[，、；：,;:]+$/, '') + '…'
}

/** 从单个 HTML 文件提取文档元数据 */
function readDoc(file) {
  const abs = resolve(WIKI_DIR, file)
  const html = readFileSync(abs, 'utf8')
  const st = statSync(abs)

  const title = stripTags(pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html)) || file.replace(/\.html$/i, '')
  const desc = clip(stripTags(metaContent(html, 'description')) || firstParagraph(html) || title)
  const category = stripTags(metaContent(html, 'wiki-category')) || DEFAULT_CATEGORY
  const tags = stripTags(metaContent(html, 'wiki-tags'))
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
  const orderRaw = parseInt(metaContent(html, 'wiki-order'), 10)
  const text = extractText(html)

  return {
    file,                              // 原始文件名（含中文/空格，前端负责 encodeURI）
    title,
    desc,
    category,
    tags,
    text,                              // 全文纯文本（检索用，仅存索引）
    order: Number.isFinite(orderRaw) ? orderRaw : 9999,
    size: st.size,                     // 字节数，用于卡片上展示篇幅
    mtime: Math.round(st.mtimeMs / 1000), // 秒级时间戳，用于「最近更新」标记
  }
}

/**
 * 扫描目录并生成索引文件。
 * @param {{silent?: boolean}} [options] silent=true 时不打印日志（vite 插件内调用）
 * @returns {{count: number, file: string}}
 */
export function generateWikiIndex(options = {}) {
  const log = options.silent ? () => {} : (...a) => console.log(...a)

  let files = []
  try {
    files = readdirSync(WIKI_DIR).filter((f) => /\.html$/i.test(f) && !f.startsWith('.'))
  } catch {
    log('[wiki] 目录不存在，跳过：', WIKI_DIR)
    return { count: 0, file: OUT_FILE }
  }

  const docs = files
    .map(readDoc)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-Hans-CN'))

  const payload = {
    version: 2,
    generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    count: docs.length,
    docs,
  }

  const banner =
    '/* 本文件由 scripts/gen-wiki-index.mjs 自动生成，请勿手工编辑。\n' +
    '   新增文档：把 .html 丢进 src/public/wiki/ 即可自动收录。\n' +
    '   产物为 JS 而非 JSON：file:// 双击运行时 fetch() 受 origin null CORS 限制。 */\n'
  const content = banner + 'window.__WIKI_INDEX = ' + JSON.stringify(payload, null, 2) + ';\n'

  writeFileSync(OUT_FILE, content, 'utf8')
  log(`[wiki] 已生成索引：${docs.length} 篇 → ${OUT_FILE}`)
  return { count: docs.length, file: OUT_FILE }
}

// 作为 CLI 直接执行时（npm run wiki:index / node scripts/gen-wiki-index.mjs）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateWikiIndex()
}
