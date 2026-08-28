/* ═══════════════════════════════════════════════════════════════════
   紧固件贸易工作台 — 本地构建签名环境注入（tauri:build 包装器）
   ───────────────────────────────────────────────────────────────────
   背景：createUpdaterArtifacts + 公钥内嵌，打包时 Tauri 要求签名私钥。
   CI 经 GitHub Secrets 注入；本地若未设置环境变量会报
   "A public key has been found, but no private key"。
   本包装器规则：
     1) 已设置 TAURI_SIGNING_PRIVATE_KEY / _PATH（CI 或手动）→ 原样透传
     2) 未设置且 ~/.tauri/fastener-updater.key 存在 → 注入 _PATH 指向它
     3) 都没有 → 原样透传（由 Tauri 给出明确的缺钥报错）
   ═══════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEY_PATH = path.join(os.homedir(), '.tauri', 'fastenerTradeWorkbench-updater.key')
const ENV_FILES = [
  path.join(ROOT, '.env.local'),                                // 项目根
  path.join(os.homedir(), '.tauri', 'fastener-updater.env'),    // 兼容位置
]

// 解析极简 dotenv（支持 export 前缀 / 引号值 / 注释 / alias 行忽略）；
// 仅在变量未设置时写入，手动 export 的值优先
function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('alias ')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2]
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

ENV_FILES.forEach(loadEnvFile)

// 关键：tauri build 的更新产物签名只认内联 TAURI_SIGNING_PRIVATE_KEY；
// _PATH 形式仅 tauri signer 子命令支持。因此无论来源（.env.local / 兜底路径），
// 只要有私钥文件就统一补齐内联变量，避免 build 期报 no private key。
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  let cand = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || KEY_PATH
  if (cand && cand.startsWith('~')) cand = path.join(os.homedir(), cand.slice(1)) // ~/.tauri/... 展开
  if (cand && existsSync(cand)) {
    try {
      process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(cand, 'utf8')
      const head = Buffer.from(
        process.env.TAURI_SIGNING_PRIVATE_KEY.split(/\r?\n/)[0].replace('untrusted comment: ', ''),
        'base64'
      ).toString('utf8')
      if (head.includes('encrypted') && !process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        console.warn('[with-updater-key] 警告：私钥为加密态但未提供密码，签名将失败（检查 .env.local 的 PASSWORD）')
      }
      console.log('[with-updater-key] 已注入内联签名私钥（来自', path.basename(cand) + '）')
    } catch (e) {
      console.warn('[with-updater-key] 读取私钥失败:', e && e.message)
    }
  }
}

const hasKey = !!(process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH)

if (!hasKey && existsSync(KEY_PATH)) {
  process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = KEY_PATH
  // 空密码密钥也必须显式置空值：未设置时 CLI 在无 TTY 环境会尝试交互式
  // 询问密码并以 "Device not configured (os error 6)" 失败
  if (!('TAURI_SIGNING_PRIVATE_KEY_PASSWORD' in process.env)) {
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
  }
  console.log('[with-updater-key] 已注入本地签名私钥:', KEY_PATH)
}

const cmd = process.argv.slice(2)
if (!cmd.length) {
  console.error('[with-updater-key] 用法: node scripts/with-updater-key.mjs <命令…>')
  process.exit(1)
}
const result = spawnSync(cmd[0], cmd.slice(1), {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
