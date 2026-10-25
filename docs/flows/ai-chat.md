# AI 助手 (AI Chat) 流程说明文档

> 对齐版本：**v1.0.57** · 源码：`src/views/ai-chat.js` + `src/core/ai.js` / `ai-tools.js` / `ai-files.js` / `kb.js`
> 流程文档索引：[README](README.md)

## 模块功能概述

AI 助手是**可选增强模块**，未配置 API Key 或无网络时，全部核心业务功能照常可用。启用后可：

- **只读分析**：基于脱敏业务快照回答经营总结、催款建议、比价、客户分级、话术生成、利润分析
- **工具调用（写入）**：通过 Function Calling 起草数据操作，逐条经确认弹窗后执行
- **系统帮助**：`query_help` 检索 `HELP_KNOWLEDGE` 使用说明
- **本地知识库**：`query_knowledge` 检索已绑定目录（BM25），回答标注【依据：文件名】
- **对话附件**：本地直读 txt/md/csv/xls/xlsx/docx/pdf 注入上下文（v1.0.40 起；v1.0.41 起桌面版支持正文写路径直读）

## 核心数据结构

| 位置 | 结构 | 说明 |
|------|------|------|
| `DB.aiChats` | `{id, title, messages[], createdAt, updatedAt}` | 会话记录，`messages[].attachments` 存附件解析全文 |
| `DB.aiOps` | `{id, op, target, before, after, batchId, createdAt}` | 操作审计，2000 条 FIFO，可单条/整批回滚 |
| `DB.aiWorkflows` | 工作流记录 | 多步执行计划（`WF_MAX_STEPS = 8`） |
| localStorage | `wb_fastener_ai_key`（浏览器版）/ 桌面版 `deepseek_token` 文件 | API Key 存储 |

## 关键函数及调用链

```
openAIAssistant() / openAIWithMessage(text)
  └── 渲染抽屉 → 会话列表 / 消息区 / 输入区（composer 气泡）
        │
用户输入 + 可选附件 → 发送
  └── AF.parseEntry(entry)         # 附件解析（浏览器 File 直读 / 桌面版 kb_read_*）
  └── AF.extractPaths(text)        # 正文路径识别（仅桌面版）
  └── AI.chat({messages, model, stream, tools})
        ├── 流式渲染 renderAIMarkdownStream()（自适应节流 + 近底跟随）
        ├── 无 tool_calls → 渲染 Markdown（markdown-it + DOMPurify + highlight.js）
        └── 有 tool_calls → AI.aiWriteLoop()
              ├── query_* / KB_*          → AIT.runQuery  自动执行（结果脱敏回填）
              ├── flow（navigate_view / open_*_drawer / export_order_excel）
              │                            → AIT.runFlow   自动执行（导出记 op:'export'）
              └── 写入/删除/流转           → renderOpsItem/renderOpsDiff 生成提案
                                           → confirmOpsModal 逐条确认
                                           → AIT.executeOps → DB 落盘 + 记 aiOps
  └── 多轮继续（上限 8 轮）→ 最终回复入库
```

## 用户操作流程图

```
打开助手（顶栏闪电 / ⌥+I / ⌘K 无结果回车）
    │
    ├── 未配置 Key → 状态灯黄色「● 未设置 API_KEY」→ 提示去设置
    │
    ├── 已配置 → 状态灯绿色「● 直连就绪 / 桌面就绪」
    │
    ├── 提问
    │     ├── 纯文本 → 直接发送
    │     ├── 带附件 → 附件芯片（解析中→就绪/失败）→ 解析完成后发送
    │     └── 常用提问 chips（冷启动显示，有历史后隐藏）
    │
    ├── AI 回复
    │     ├── 普通回答 → 复制 / 刷新（仅最后一条 AI 消息）
    │     ├── 含提案 → 逐条确认 → 执行 → 「撤销本轮改动」
    │     └── 疑似截断 → 「继续生成」按钮 + 自动续写（仅本地端点）
    │
    └── 设置 → 端点预设 / Base URL / 模型 / API_KEY / 知识库绑定
```

## 与其他模块的数据依赖关系

```
ai-chat (读写)
    ├── DB.units / specs / bom / prices / orders / settlements / invoices
    │      └── 经 snapshot 脱敏后注入 system prompt（金额/利润/余额一律以本地快照为准）
    ├── DB.trash（回收站）── AI 完全隔离：不可查看/恢复/彻底删除
    ├── DB.aiOps ──────────→ 数据管理「操作历史」Tab 展示与回滚
    ├── KB（window.KB）────→ 目录级知识库索引（`wb_fastener_kb`，与业务库隔离）
    └── AF（window.AF）────→ 附件解析（不上传、不产生临时文件）
```

## 安全与能力边界

- AI **只产出参数**，执行复用业务校验与 `saveDB()` 链路
- 写入类工具一律生成提案，需用户逐条确认；确认弹窗不可跳过、拒绝零写入
- 删除走**软删除**进回收站；AI 无任何回收站操作能力
- 敏感字段（电话/地址/税号/银行账户）AI 不收集，由用户在确认弹窗补全
- 并发保护：确认弹窗生成 `__beforeFingerprint`，执行前比对，数据被改动则拒绝
- 订单状态流转遵守状态机（`validators.canFlowOrderStatus`），与视图按钮同源
