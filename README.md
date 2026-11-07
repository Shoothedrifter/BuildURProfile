# BuildURProfile

将文本型 PDF 简历转成可编辑的交互式作品网页。浏览器负责解析与确认内容，Python LangGraph 通过 Skills 生成展示配置，Node API 管理任务、支付、分享和离线 ZIP。

## 目录

| 目录 | 职责 |
| --- | --- |
| `apps/web` | React/Vite 界面、浏览器 PDF、编辑与展示 |
| `apps/api` | Node API、会话、任务入口、支付与交付 |
| `apps/agent` | Python LangGraph、Skills 和图像服务适配器 |
| `packages` | 共享合同、浏览器规则、资源校验与持久化 |
| `scripts` | 启动、资源安装和验证工具 |
| `deploy` | 部署环境变量样例 |
| `docs` | 按模块组织的说明、跨模块规约与历史归档 |

## 本机启动

需要 Node.js 24+、Python 3.11+ 和 uv 0.11.x。在仓库根目录运行：

```sh
npm ci
uv sync --project apps/agent --frozen --extra test
npm run dev
```

打开 `http://127.0.0.1:5173`。该命令同时启动 Node API（8787）和 Python Agent（8788）；无照片预览不需要支付或图像服务凭据。

Windows 下若虚拟环境未激活，先在 PowerShell 设置 `$env:PYTHON = (Resolve-Path 'apps/agent/.venv/Scripts/python.exe').Path`。现有启动脚本只自动查找 Unix 虚拟环境路径。

可选配置的样例已归入各模块；**实际配置仍按现有启动方式放在根目录或注入进程环境**，已有文件请补充配置，避免覆盖。详见[部署与环境变量](docs/shared/deployment.md)。

## 文档

- [文档导航](docs/README.md)：按模块查阅。
- [产品约束](docs/shared/product.md)与[架构与协议](docs/shared/architecture.md)：当前行为和模块边界。
- [静态 Pages 预览](docs/web/github-pages.md)：无需后端的浏览器预览。
- [支付与交付](docs/api/payment.md)：配置和上线验收。
- [开发约束](AGENTS.md)：修改代码前的必要规则与检查。
