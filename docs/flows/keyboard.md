# 键盘快捷键 (Keyboard) 流程说明文档

> 对齐版本：**v1.0.57** · 源码：`src/views/keyboard.js`
> 流程文档索引：[README](README.md)

## 模块功能概述

全局键盘快捷键层，采用三层结构：全局导航（`⌥ + 字母`）、全局操作（`⌘K` / `⌘S` / `Esc` / `/` / `?`）、页面动作（`⌥ + ⇧ + 字母`）。导航类快捷键统一放在 `⌥` 层，避免与浏览器内置快捷键冲突；输入框内自动禁用 `⌥` 系列，不干扰输入法。

## 核心数据结构

无独立数据结构，全部为运行时事件处理。关键判定函数：

| 函数 | 作用 |
|------|------|
| `isInInput()` | 焦点是否在 input / textarea / contenteditable |
| `hasOverlay()` | 是否存在 modal / drawer / 命令面板（决定 Esc 与字母键行为） |
| `getSearchInput()` | 取当前视图搜索框，供 `/` 聚焦 |
| `kbdNav(target)` | 按 `view` 分发页面动作快捷键 |
| `getShortcutsHTML()` | 生成快捷键说明表 HTML |
| `showShortcutsModal()` | 打开说明弹窗（`?` 键） |

## 快捷键清单

### 全局导航（非输入状态）

| 快捷键 | 动作 | 目标视图 |
|--------|------|---------|
| `⌥ + H` | 概览 | `dashboard` |
| `⌥ + O` | 采购订单 | `orders` |
| `⌥ + U` | 关联单位 | `units` |
| `⌥ + P` | 签约报价 | `prices` |
| `⌥ + B` | BOM 管理 | `bom` |
| `⌥ + A` | 属性管理 | `specs` |
| `⌥ + S` | 对账结算 | `settlements` |
| `⌥ + I` | 打开/关闭 AI 助手 | 抽屉 |
| `⌥ + D` | 数据管理 | `data` |

### 全局操作

| 快捷键 | 动作 | 备注 |
|--------|------|------|
| `⌘ + K` | 全局搜索命令面板 | 输入框内也触发 |
| `⌘ + S` | 保存当前抽屉/弹窗表单 | 输入框内也触发 |
| `Esc` | 关命令面板 → 关 modal → 关抽屉 → 订单详情回列表 | 优先级依次 |
| `/` | 聚焦当前页面搜索框 | 非输入状态 |
| `?` | 打开快捷键说明 | 非输入状态 |
| `⌥ + ←` / `⌥ + →` | 结算 / 发票页子 Tab 切换 | — |

### 页面动作（上下文相关，非输入状态）

| 快捷键 | 适用页面 | 动作 |
|--------|---------|------|
| `⌥ + ⇧ + N` | 订单列表 / 关联单位 | 新建订单 / 新建单位 |
| `⌥ + ⇧ + E` | 订单详情 / 数据管理 | 编辑当前订单 / 导出 JSON 备份 |
| `⌥ + ⇧ + A` | 订单编辑页 | 添加产品 |
| `⌥ + ⇧ + I` | 数据管理 | 导入 JSON 备份 |
| `⌥ + ⇧ + S` | 数据管理 | 同步文件 |

### 输入框内

| 场景 | 行为 |
|------|------|
| 搜索框 `Enter` | 触发搜索（`isComposing` 防输入法候选误触） |
| AI 输入框 `Enter` | 发送 |
| AI 输入框 `⌘/Ctrl + Enter`、`Shift + Enter` | 换行 |
| combo 下拉 `↑/↓`、`Enter`、`Esc` | 导航 / 选中 / 关闭 |

## 用户操作流程图

```
任意按键 → keydown 监听
    │
    ├── Esc → hasOverlay() 判定 → 逐层关闭（面板 → modal → drawer → 返回列表）
    ├── ⌘K → openSearchPanel()（输入框内也触发）
    ├── ⌘S → 提交当前抽屉/弹窗表单
    ├── ? → showShortcutsModal()（非输入状态）
    ├── / → getSearchInput().focus()（非输入状态）
    ├── ⌥← / ⌥→ → 结算/发票子 Tab 切换
    ├── isInInput() === true → ⌥ 系列全部放行给输入框（不拦截）
    └── 否则 → kbdNav(view) 分发
          ├── ⌥+字母 → go(目标视图) / AI 抽屉开关
          └── ⌥⇧+字母 → 按当前视图执行页面动作
```

## 与其他模块的数据依赖关系

```
keyboard.js（纯分发层，不直接改数据）
    ├── router.js  ──→ go(view) / render()
    ├── orders.js  ──→ 新建订单 / 编辑订单 / 添加产品 / 返回列表
    ├── units.js   ──→ 新建单位
    ├── data.js    ──→ exportJSON() / importJSON() / 同步文件
    ├── search-panel.js ──→ openSearchPanel() / closeSearchPanel()
    ├── ai-chat.js ──→ openAIAssistant() 开关
    └── ui.js      ──→ closeModal() / closeDrawer()
```

> ⚠️ **实现说明**：`⌘K` / `⌘S` 判定的是 `event.metaKey`（macOS Command）。Windows / Linux 下 `Ctrl + K` / `Ctrl + S` 当前**不会触发**，请使用顶栏按钮或鼠标操作。
