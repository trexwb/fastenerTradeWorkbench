/* ═══════════════════════════════════════════════════════════════════
   紧固件贸易工作台 — Vue 入口
   ═══════════════════════════════════════════════════════════════════ */

// ===== 样式：按原顺序引入（CSS 无作用域问题，直接 module import 即可） =====
import './styles/variables.css'
import './styles/layout.css'
import './styles/components.css'

// ===== Vue 应用：壳组件，onMounted 时按原 <script defer> 顺序动态注入核心 JS =====
import { createApp } from 'vue'
import App from './App.vue'
// ===== 知识库依赖（kb.js 通过 window.__KB_DEPS 取用，避免在 eval 脚本中直接 import） =====
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs'
import mammoth from 'mammoth'
// 真 Worker 加速（http / tauri 环境可用）；file:// 双击运行时浏览器禁止 new Worker()，
// pdf.js 会降级为主线程 fake worker —— 必须提供全局钩子 globalThis.pdfjsWorker，否则 PDF 解析必败
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker
globalThis.pdfjsWorker = pdfjsWorker
window.__KB_DEPS = { pdfjs, mammoth }

createApp(App).mount('#app')
