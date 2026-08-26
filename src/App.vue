<!--
  紧固件贸易工作台 — 根组件（Vue 壳）
  ═══════════════════════════════════════════════════════════════
  迁移策略（保持业务层零改动）：
    1. import.meta.glob(?raw) 把 core/ + views/ 所有 JS 读取为源码字符串
    2. 用 (0, eval)(code) —— 「间接 eval」在全局作用域 sloppy 模式执行
       （与 <script> 标签语义完全一致：function / var 声明自动挂 window）
    3. 执行前用字符串替换注入 __APP_VERSION__ 与 __FTWB_VERSION__
    4. 注入顺序严格与原 index.html 的 <script defer> 顺序一致
  ═══════════════════════════════════════════════════════════════
-->
<script setup>
import { onMounted, nextTick } from 'vue'

// ===== 版本号：Vite define 注入 =====
const APP_VERSION_STR = __APP_VERSION__
const FTWB_VERSION_STR = __FTWB_VERSION__

// ===== 脚本加载顺序（与原 index.html 的 <script defer> 顺序严格一致） =====
const SCRIPTS = [
  'core/seed.js',
  'core/utils.js',
  'core/ui.js',
  'core/store.js',
  'core/exporter.js',
  'core/ai.js',
  'core/help-knowledge.js',
  'core/ai-tools.js',
  'views/dashboard.js',
  'views/units.js',
  'views/specs.js',
  'views/bom.js',
  'views/prices.js',
  'views/orders.js',
  'views/settlements.js',
  'views/invoices.js',
  'views/data.js',
  'views/search-panel.js',
  'views/keyboard.js',
  'views/ai-chat.js',
  'core/router.js',
  'core/app.js',
]

// raw: 直接返回文件源码字符串，不经 Vite JS 编译（不走 define 替换）
// eager: true → 构建时一次性全量加载（不含 tree-shaking）
const rawModules = import.meta.glob('./{core,views}/**/*.js', {
  eager: true,
  query: '?raw',
  import: 'default',
})

/**
 * 对单个脚本源码打补丁：注入版本号 + 保留 sourceURL。
 * （不单独 eval，因为 const/let 声明属于 Script Record，
 *   多次 eval 的话各自的 Record 独立、互相不可见。）
 */
function patchScript(code, filename) {
  let patched = code
    .replace(/\b__APP_VERSION__\b/g, JSON.stringify(APP_VERSION_STR))
    .replace(/\b__FTWB_VERSION__\b/g, JSON.stringify(FTWB_VERSION_STR))
  // 用 //# sourceMappingURL=// 的反向技巧不行，
  // 直接 //# sourceURL= 即可：在单次大 eval 中浏览器也能按行定位。
  patched += '\n//# sourceURL=' + filename + '\n'
  return patched
}

/**
 * 在全局作用域执行拼接后的所有脚本。
 * 关键：合并成一次 (0, eval) 调用，等价于一个大 <script> 标签，
 * 所有 const/let/var/function 声明共享同一个 Script Record，
 * 互相可见，与原 index.html 中所有 <script defer> 顺序执行的语义
 * （同一 script block 内按序）略有差异但等价（全局变量全共享）。
 */
function runAllInGlobalScope(chunks) {
  const combined = chunks.join('\n;')
  try {
    ;(0, eval)(combined) // 间接 eval = 全局作用域 sloppy 模式，单次执行
  } catch (err) {
    console.error('[boot] 聚合脚本执行失败：', err)
    throw err
  }
}

async function boot() {
  // 1) 恢复主题偏好（原 app.js 中立即执行的 IIFE）
  try {
    const t = localStorage.getItem('fw_theme')
    if (t) document.documentElement.setAttribute('data-theme', t)
  } catch (e) {}

  // 2) 显示加载态
  const app = document.getElementById('app')
  if (app) {
    app.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px">' +
      '<div class="spin" style="width:32px;height:32px;border:3px solid var(--line);border-top-color:var(--pri);border-radius:50%;animation:spin 1s linear infinite"></div>' +
      '<div style="color:var(--gray);font-size:14px">正在加载数据...</div>' +
      '</div>'
  }

  // 3) 收集所有脚本源码，按顺序拼接（单次 eval，const/let 共享同一 Script Record）
  const chunks = []
  for (const rel of SCRIPTS) {
    const key = './' + rel
    const code = rawModules[key]
    if (!code) {
      console.error('[boot] 缺失源码资源：', key, '可用 keys：', Object.keys(rawModules))
      throw new Error('资源缺失：' + rel)
    }
    chunks.push(patchScript(code, rel))
  }

  // 4) 一次性执行所有脚本
  runAllInGlobalScope(chunks)

  // 5) 启动应用（initApp + IndexedDB 加载）
  if (typeof window.bootApp === 'function') {
    window.bootApp()
  } else if (typeof window.initApp === 'function') {
    window.initApp()
  }
}

onMounted(async () => {
  await nextTick()
  boot().catch(err => {
    console.error('[boot] 启动失败：', err)
    const app = document.getElementById('app')
    if (app) {
      app.innerHTML =
        '<div style="padding:40px;color:var(--err)">' +
        '<h3>启动失败</h3><pre style="white-space:pre-wrap">' +
        (err && err.stack ? err.stack : String(err)) +
        '</pre></div>'
    }
  })
})
</script>

<template>
  <!-- 空壳：boot() 会直接重写 #app 的 innerHTML -->
  <div></div>
</template>
