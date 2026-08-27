import { defineConfig } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

// ═══════════════════════════════════════════════════════════════════
// 紧固件贸易工作台 Vue3 构建 — 统一外置资源产物（可双击运行）
// ───────────────────────────────────────────────────────────────────
// 版本号单一来源：package.json。构建期注入：
//   __APP_VERSION__     → 'vX.Y.Z'（渲染页脚、版本展示）
//   __FTWB_VERSION__    → 'X.Y.Z'（store.js 中的 APP_VERSION 运行版本）
//
// 所有构建（vite build）统一走 rollup iife 单 chunk 产物：
//   - JS 外置到 dist/assets/js/，CSS 外置到 dist/assets/css/，
//     产物结构清晰、便于审查
//   - iife（非 module script）在 file:// 下可被 Chrome 加载，
//     不触发 module 脚本的 CORS 拦截，双击 index.html 可用
//   - GitHub Pages 子路径部署
//   - Tauri 桌面打包（frontendDist 指向 ../dist）
// ═══════════════════════════════════════════════════════════════════

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const APP_VERSION = 'v' + pkg.version

// 构建后把 index.html 的 `<script type="module" crossorigin src=...>` 降级为普通
// `<script src=...>`：产物为 iife（无 import/export），普通脚本在 file:// 下可被
// Chrome 加载，而 module 脚本受 CORS 限制（origin 'null'）会被拦截。
function demoteModuleScripts() {
  return {
    name: 'ftwb-demote-module-scripts',
    closeBundle() {
      const htmlPath = resolve(import.meta.dirname, 'dist/index.html')
      try {
        const html = readFileSync(htmlPath, 'utf-8')
        const out = html.replace(
          /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
          '<script defer src="$1"></script>',
        )
        if (out !== html) writeFileSync(htmlPath, out)
      } catch {
        // 忽略：未生成 html 时跳过
      }
    },
  }
}

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [vue(), demoteModuleScripts()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      onwarn(warning, warn) {
        // 过滤已知无害的 EMPTY_IMPORT_META 警告（iife 下 import.meta 批量告警）：
        //  - vite/preload-helper.js：动态导入 helper，import.meta.url 仅用于拼接 preload 链接
        //  - pdfjs-dist：import.meta.url 位于 NodeCanvasFactory._createCanvas 惰性方法内，
        //    浏览器路径不会执行，替换为 {} 无副作用
        // 其余警告（真实告警）原样上抛，避免被白名单掩盖。
        if (warning.code === 'EMPTY_IMPORT_META') {
          const id = warning.id || ''
          if (id.includes('pdfjs-dist') || id.includes('preload-helper')) return
        }
        warn(warning)
      },
      output: {
        // iife（非 module）：file:// 下可加载，避免 module script 的 CORS 拦截
        // Vite 8 中 iife 输出默认 codeSplitting:false，无需再设 inlineDynamicImports
        format: 'iife',
        entryFileNames: 'assets/js/[name].js',
        assetFileNames: 'assets/[ext]/[name][extname]',
      },
    },
  },
  server: {
    port: 1421,
    strictPort: true,
  },
  define: {
    // 版本号单一来源注入：升级只改 package.json / tauri.conf.json
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __FTWB_VERSION__: JSON.stringify(pkg.version),
  },
})
