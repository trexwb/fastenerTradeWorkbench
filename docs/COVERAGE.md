# 代码文档覆盖率报告

> 生成时间: 2026-08-28
> 项目版本: v1.0.31（结构：`src/core/` 数据/工具/UI 层 + `src/views/` 视图层 + `src/styles/` 设计体系）
> 覆盖率: **533/632 函数 (84%)**（口径：顶层与模块内 `function` 声明数 vs `/** */` JSDoc 块数，脚本自动扫描）

---

## 1. 覆盖率总览

| 文件 | 函数数 | JSDoc | 覆盖率 | 状态 |
|------|-------|-------|--------|------|
| `src/core/ai-tools.js` | 9 | 18 | 200% | 🟢 完整 |
| `src/core/ai.js` | 39 | 18 | 46% | 🔴 待补 |
| `src/core/app.js` | 2 | 3 | 150% | 🟢 完整 |
| `src/core/exporter.js` | 67 | 15 | 22% | 🔴 待补 |
| `src/core/guide.js` | 2 | 2 | 100% | 🟢 完整 |
| `src/core/help-knowledge.js` | 1 | 2 | 200% | 🟢 完整 |
| `src/core/kb.js` | 34 | 8 | 24% | 🔴 待补 |
| `src/core/router.js` | 24 | 26 | 108% | 🟢 完整 |
| `src/core/seed.js` | 1 | 1 | 100% | 🟢 完整 |
| `src/core/store.js` | 70 | 80 | 114% | 🟢 完整 |
| `src/core/ui.js` | 8 | 11 | 138% | 🟢 完整 |
| `src/core/updater.js` | 6 | 0 | 0% | 🔴 待补 |
| `src/core/utils.js` | 58 | 68 | 117% | 🟢 完整 |
| `src/core/validators.js` | 3 | 4 | 133% | 🟢 完整 |
| `src/views/ai-chat.js` | 41 | 16 | 39% | 🔴 待补 |
| `src/views/bom.js` | 25 | 29 | 116% | 🟢 完整 |
| `src/views/dashboard.js` | 4 | 2 | 50% | 🟡 部分 |
| `src/views/data.js` | 39 | 27 | 69% | 🟡 部分 |
| `src/views/invoices.js` | 9 | 11 | 122% | 🟢 完整 |
| `src/views/keyboard.js` | 6 | 0 | 0% | 🔴 待补 |
| `src/views/orders.js` | 82 | 91 | 111% | 🟢 完整 |
| `src/views/prices.js` | 30 | 36 | 120% | 🟢 完整 |
| `src/views/search-panel.js` | 16 | 5 | 31% | 🔴 待补 |
| `src/views/settlements.js` | 20 | 22 | 110% | 🟢 完整 |
| `src/views/specs.js` | 13 | 14 | 108% | 🟢 完整 |
| `src/views/units.js` | 23 | 24 | 104% | 🟢 完整 |
| **合计** | **632** | **533** | **84%** | — |

## 2. 说明

- 本文件由脚本按当前 `src/core/` + `src/views/` 实际代码自动扫描生成（v1.0.31 结构），替代 8-16 基于 `src/js/` 旧结构的版本。
- AI 工具清单（47 个）见 `docs/API.md` §7.4；状态机说明见 `docs/操作手册.md` §7.4。
- 版本历史见 `docs/version/RELEASE-v1.0.md`。
