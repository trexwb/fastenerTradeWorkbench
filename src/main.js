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
import mammoth from 'mammoth'
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker
window.__KB_DEPS = { pdfjs, mammoth }

createApp(App).mount('#app')
