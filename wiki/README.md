# wiki/ 目录说明

本目录存放 **GitHub Wiki 页面的 Markdown 源文件**，与仓库主文档 `docs/` 分工如下：

| 目录 | 定位 | 读者 |
|------|------|------|
| `docs/` | 随代码走的项目文档（操作手册 / API / 模块流程 / 发布日志 / 覆盖率） | 开发者、维护者 |
| `wiki/` | 发布到 GitHub Wiki 的在线文档（用户向，页面间互相链接） | 终端用户、协作者 |

## 页面清单

| 文件 | 说明 |
|------|------|
| `Home.md` | Wiki 首页：项目简介、三种运行形态、特性、文档导航 |
| `_Sidebar.md` | Wiki 侧边导航（GitHub Wiki 约定文件名，自动生效） |
| `_Footer.md` | Wiki 页脚（GitHub Wiki 约定文件名，自动生效） |
| `快速开始.md` | 打开方式、界面布局、首次操作顺序、macOS 隔离处理 |
| `功能模块总览.md` | 9 个侧栏入口 + 3 个横切模块 + 数据流向 |
| `关联单位.md` | 单位字段、批量导入、搜索筛选 |
| `属性与BOM.md` | 六维属性枚举、BOM 与仅按 SKU 的关联规则 |
| `签约报价.md` | 报价字段、防重复、与寻货的匹配关系 |
| `采购订单.md` | 九态状态机、产品明细、Excel 导出、批量导入 |
| `寻货与分配.md` | 两种寻货方式、多供应商分配校验、报价导入新列 |
| `对账结算.md` | 收付款 Tab、结算明细、与订单状态联动 |
| `发票管理.md` | 开收票 Tab、孤儿发票标记 |
| `数据管理.md` | 存储架构、文件同步、备份、操作历史、回收站、知识库 |
| `AI助手.md` | 端点与模型、47 个工具、附件、RAG、审计回滚 |
| `快捷键与全局搜索.md` | ⌘K 命令面板 + 全量快捷键表 |
| `常见问题.md` | 运行、数据、业务规则、导入、AI、快捷键 FAQ |
| `开发与构建.md` | 技术栈、目录结构、构建约束、版本规则、文档维护 |
| `版本记录.md` | 迭代摘要索引（详细见 `docs/version/RELEASE-v1.0.md`） |

## 如何发布到 GitHub Wiki

GitHub Wiki 本身是一个独立的 Git 仓库（`<repo>.wiki.git`）：

```bash
# 1. 克隆 wiki 仓库
git clone https://github.com/<owner>/<repo>.wiki.git

# 2. 覆盖页面文件
cp wiki/*.md <repo>.wiki/

# 3. 提交并推送
cd <repo>.wiki
git add . && git commit -m "docs(wiki): 同步 v1.0.57 文档" && git push
```

> `_Sidebar.md` / `_Footer.md` 是 GitHub Wiki 的保留文件名，推送后自动作为侧栏与页脚渲染。

## 维护约定

- 页面内容以 `docs/` 与源码为准，**函数名、字段名不得凭记忆书写**
- 版本号随 `package.json` 同步；仅更新文档时不推进版本号
- 页面间使用相对链接（如 `[采购订单](采购订单.md)`），在 GitHub Wiki 与普通 Markdown 预览中均可跳转
