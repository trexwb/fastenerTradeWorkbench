/* ═══════════════════════════════════════════════════════════════════
   紧固件贸易工作台 — 生成 Tauri updater 更新清单 latest.json
   ───────────────────────────────────────────────────────────────────
   用法（CI 内）：
     node scripts/gen-latest-json.mjs \
       --win artifacts/windows --mac artifacts/macos \
       --out latest.json [--tag vX.Y.Z]
   规则：
     • 版本号取 src-tauri/tauri.conf.json（单一真源）
     • tag 未指定时默认 v<版本>（与 release tag 规范一致）
     • windows-x86_64 ← NSIS 安装器（*-setup.exe + .sig）
     • darwin-aarch64 ← macOS 更新包（*.app.tar.gz + .sig）
     • url 指向 GitHub Release 资产（发布后可下载；draft 期间 404 属预期）
   ═══════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }

const conf = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'))
const version = conf.version
const repo = 'trexwb/fastenerTradeWorkbench'
const tag = arg('tag') || ('v' + version)
const base = `https://github.com/${repo}/releases/download/${tag}`

function walkFiles(dir, out) {
  out = out || []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else out.push(p)
  }
  return out
}

function findUpdaterArtifact(dir, suffix) {
  if (!dir || !existsSync(dir)) return { found: false, reason: '目录不存在', files: [] }
  // ⚠ upload-artifact 多路径上传会保留「最小公共祖先」下的子目录结构（如 nsis/、msi/），
  //   download-artifact 解压后产物可能嵌套在子目录中，必须递归扫描而不是只读顶层
  const abs = walkFiles(dir)
  const files = abs.map((p) => path.relative(dir, p))
  const topLevel = readdirSync(dir, { withFileTypes: true }).map((e) => e.isDirectory() ? e.name + '/' : e.name)
  const hit = abs.find((p) => p.endsWith(suffix) && existsSync(p + '.sig'))
  if (!hit) {
    const installers = files.filter((f) => f.endsWith(suffix))
    const sigs = files.filter((f) => f.endsWith('.sig'))
    const reason = installers.length
      ? `递归找到 ${installers.length} 个安装包但无对应 .sig（签名未生成？）`
      : '递归扫描后未找到匹配的安装包'
    return { found: false, reason, files: topLevel.length ? topLevel : files.slice(0, 12) }
  }
  return {
    found: true,
    // Release 资产平铺在根目录，URL 只取文件名（忽略 artifact 内部嵌套路径）
    name: path.basename(hit),
    signature: readFileSync(hit + '.sig', 'utf8').trim(),
  }
}

const platforms = {}
const win = findUpdaterArtifact(arg('win'), '-setup.exe')
if (win.found) {
  platforms['windows-x86_64'] = { signature: win.signature, url: `${base}/${encodeURIComponent(win.name)}` }
} else {
  console.error(`[gen-latest-json] Windows: ${win.reason}`)
  if (win.files.length) console.error('  文件列表:', win.files.join(', '))
}
const mac = findUpdaterArtifact(arg('mac'), '.app.tar.gz')
if (mac.found) {
  platforms['darwin-aarch64'] = { signature: mac.signature, url: `${base}/${encodeURIComponent(mac.name)}` }
} else {
  console.error(`[gen-latest-json] macOS: ${mac.reason}`)
  if (mac.files.length) console.error('  文件列表:', mac.files.join(', '))
}

if (!Object.keys(platforms).length) {
  console.error('[gen-latest-json] 未找到任何带 .sig 的更新产物（*-setup.exe / *.app.tar.gz）')
  process.exit(1)
}

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms,
}
const out = arg('out') || 'latest.json'
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
console.log(`[gen-latest-json] latest.json 已生成（v${version}，平台：${Object.keys(platforms).join(' / ')}）`)
