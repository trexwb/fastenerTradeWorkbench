# 紧固件贸易工作台

面向**紧固件贸易场景**的离线工作台：关联单位、属性管理、BOM 管理、签约报价、采购订单（多供应商分配寻源）、对账结算、发票管理，内置可选 AI 助手（多端点接入 + 对话附件 + 本地知识库 + Function Calling 提案确认）。

> 当前版本：**v1.0.57** ｜ 技术栈：Vue 3 + Vite（开发态） ｜ 交付形态：零依赖单文件 SPA（`dist/index.html` 双击即用）

---

## 三种运行形态

| 形态 | 启动方式 | 数据存储 | 说明 |
|------|---------|---------|------|
| **浏览器版（推荐）** | 双击 `dist/index.html` | IndexedDB + 可选本地 JSON 同步 | 零依赖，无需服务器、无需联网 |
| **开发态** | `npm install && npm run dev` | 同浏览器版 | Vite 开发服务器（默认 1421 端口） |
| **桌面版（Tauri）** | `npm run tauri:build` 打包 | 应用数据目录 `data.json` | 额外支持自动更新、正文路径直读、Key 存应用数据目录 |

---

## 核心特性

- **多供应商分配寻源**：一个产品可由多个供应商分别供货，自动汇总分配进度与缺口
- **九态订单状态机**：待确认 → 寻货中 → 报价中 → 签约完成 → 送货中 → 完成（未成交可恢复，异常/取消为终态）
- **六处批量粘贴导入**：BOM / 签约报价 / 关联单位 / 采购订单 / 订单产品明细 / 供应商报价，统一「复制 Excel → 粘贴 → 解析预览 → 提交」
- **按订单状态分发的 Excel 导出**：产品确认单 / 寻源进度单 / 报价中报价单 / 签约完成结算单 / 送货结算单
- **离线优先**：AI 之外全部功能无需联网；Excel、PDF、docx 解析均为本地资源
- **可选 AI 助手**：只读分析 + 写入提案（逐条确认）+ 本地知识库 RAG + 对话附件，全程审计可回滚
- **数据安全**：软删除进回收站（保留 90 天）、操作历史可单条/整批回滚、JSON 备份与本地文件双向同步

---

## 快速开始

```bash
# 开发调试
npm install
npm run dev

# 构建零依赖产物（双击 dist/index.html 即可用）
npm run vite:build

# 桌面版打包
npm run tauri:build
```

macOS 桌面版首次打开若提示「已损坏」，执行：

```bash
xattr -dr com.apple.quarantine "/Applications/FastenerTradeWorkbench.app"
```

详细步骤见 [快速开始](快速开始.md)。

---

## 文档导航

**使用指南**

- [快速开始](快速开始.md)
- [功能模块总览](功能模块总览.md)
- [关联单位](关联单位.md)
- [属性与 BOM](属性与BOM.md)
- [签约报价](签约报价.md)
- [采购订单](采购订单.md)
- [寻货与分配](寻货与分配.md)
- [对账结算](对账结算.md)
- [发票管理](发票管理.md)
- [数据管理](数据管理.md)

**增强能力**

- [AI 助手](AI助手.md)
- [快捷键与全局搜索](快捷键与全局搜索.md)

**运维与开发**

- [常见问题](常见问题.md)
- [开发与构建](开发与构建.md)
- [版本记录](版本记录.md)

---

## 数据存储一览

| 层 | 载体 | 用途 |
|----|------|------|
| 主存储 | IndexedDB（浏览器版）/ `data.json`（桌面版） | units、specs、bom、prices、orders、settlements、invoices、aiChats、trash、aiOps |
| 持久备份 | 本地 JSON 文件（File System Access API） | 双向同步，句柄存 IndexedDB |
| 草稿缓存 | localStorage（`wb_fastener_draft_*`） | 表单草稿，提交后清除，不存业务数据 |
| 知识库 | 独立 IndexedDB（`wb_fastener_kb`） | 目录级索引，与业务库隔离 |
| 设置 | localStorage / 桌面版应用数据目录 | AI 端点、模型、API Key |

---

## 浏览器兼容性

| 功能 | Chrome / Edge | Safari | Firefox |
|------|:---:|:---:|:---:|
| 基础功能 | ✅ | ✅ | ✅ |
| IndexedDB 存储 | ✅ | ✅ | ✅ |
| 本地文件同步 / 知识库目录绑定 | ✅ | ❌ | ❌ |
| AI 对话附件解析 | ✅ | ✅ | ✅ |
| 表单草稿缓存 | ✅ | ✅ | ✅ |

> Safari / Firefox 不支持 File System Access API，会自动隐藏文件同步与知识库目录绑定，回退到手动导出导入 JSON。
