# 代码文档覆盖率报告

> 生成时间: 2026-10-25
> 项目版本: v1.0.57（结构：`src/core/` 数据/工具/UI 层 + `src/views/` 视图层 + `src/styles/` 设计体系）
> 覆盖率: **597/722 函数 (83%)**（口径：顶层与模块内 `function` 声明数 vs `/** */` JSDoc 块数，脚本自动扫描）
> 重新生成：`node scripts/gen-coverage.mjs`

---

## 1. 覆盖率总览

| 文件 | 函数数 | JSDoc | 覆盖率 | 状态 |
|------|-------|-------|--------|------|
| `src/core/ai-files.js` | 10 | 0 | 0% | 🔴 待补 |
| `src/core/ai-tools.js` | 9 | 19 | 211% | 🟢 完整 |
| `src/core/ai.js` | 48 | 27 | 56% | 🔴 待补 |
| `src/core/app.js` | 2 | 3 | 150% | 🟢 完整 |
| `src/core/exporter.js` | 67 | 15 | 22% | 🔴 待补 |
| `src/core/guide.js` | 0 | 2 | 0% | 🔴 待补 |
| `src/core/help-knowledge.js` | 1 | 2 | 200% | 🟢 完整 |
| `src/core/kb.js` | 43 | 14 | 33% | 🔴 待补 |
| `src/core/router.js` | 25 | 31 | 124% | 🟢 完整 |
| `src/core/seed.js` | 1 | 1 | 100% | 🟢 完整 |
| `src/core/store.js` | 72 | 81 | 113% | 🟢 完整 |
| `src/core/ui.js` | 8 | 10 | 125% | 🟢 完整 |
| `src/core/updater.js` | 6 | 0 | 0% | 🔴 待补 |
| `src/core/utils.js` | 62 | 69 | 111% | 🟢 完整 |
| `src/core/validators.js` | 4 | 5 | 125% | 🟢 完整 |
| `src/views/ai-chat.js` | 69 | 29 | 42% | 🔴 待补 |
| `src/views/bom.js` | 25 | 30 | 120% | 🟢 完整 |
| `src/views/dashboard.js` | 4 | 2 | 50% | 🔴 待补 |
| `src/views/data.js` | 44 | 28 | 64% | 🟡 部分 |
| `src/views/invoices.js` | 9 | 13 | 144% | 🟢 完整 |
| `src/views/keyboard.js` | 6 | 0 | 0% | 🔴 待补 |
| `src/views/orders.js` | 96 | 105 | 109% | 🟢 完整 |
| `src/views/prices.js` | 30 | 36 | 120% | 🟢 完整 |
| `src/views/search-panel.js` | 16 | 5 | 31% | 🔴 待补 |
| `src/views/settlements.js` | 20 | 23 | 115% | 🟢 完整 |
| `src/views/specs.js` | 13 | 14 | 108% | 🟢 完整 |
| `src/views/units.js` | 32 | 33 | 103% | 🟢 完整 |
| **合计** | **722** | **597** | **83%** | — |

## 2. 说明

- 本文件由 `scripts/gen-coverage.mjs` 按当前 `src/core/` + `src/views/` 实际代码自动扫描生成，覆盖全部 27 个业务 JS 文件。
- 覆盖率 >100% 表示该文件除函数外还有常量、类型、命名空间等带 JSDoc 的注释块，属正常现象。
- AI 工具清单见 `docs/API.md` §7.4；订单状态机说明见 `docs/操作手册.md` §7.4。
- 版本历史见 `docs/version/RELEASE-v1.0.md`。
