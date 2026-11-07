# BuildURProfile

将文本型 PDF 简历转成可编辑的交互式作品集网页（Showcase）。浏览器本地负责解析与确认简历内容，Python LangGraph 通过版本化 Skills 生成展示配置，Next.js 全栈应用统一承载前端界面、会话权限、任务队列、支付宝支付与作品集交付。

## 目录

| 目录 | 职责 |
| --- | --- |
| `apps/web` | Next.js（App Router）全栈应用：浏览器 PDF 解析、编辑展示、API Route Handlers 与服务端业务 |
| `apps/launcher` | 启动编排、服务端契约测试（支付/生成/内部桥接）与 Docker 部署入口 |
| `apps/agent` | Python LangGraph、Skills 和图像服务适配器 |
| `packages` | 共享合同、TS Skills、资源校验与 SQLite 持久化 |
| `scripts` | Python Agent 辅助启动、风格资源安装和 Schema 导出工具 |
| `deploy` | 部署环境变量样例 |
| `docs` | 按模块组织的说明、跨模块规约与历史归档 |

## 本机启动

需要 Node.js 22.12+（推荐 24+）、Python 3.11+ 和 uv 0.11.x。在仓库根目录运行：

```sh
npm ci
uv sync --project apps/agent --frozen --extra test
npm run dev
```

打开 `http://127.0.0.1:5173`。该命令通过 `apps/launcher` 同时启动 Next.js 全栈开发服务（5173）和 Python Agent（8788）；无照片预览不需要支付或图像服务凭据。

启动脚本会自动检测 `apps/agent/.venv/bin/python`（Unix）与 `apps/agent/.venv/Scripts/python.exe`（Windows），也可通过环境变量 `PYTHON` 显式指定解释器路径。

可选配置的样例位于 `apps/launcher`、`apps/agent` 和 `deploy`；**实际配置仍放在仓库根目录或注入进程环境**，已有文件请补充配置，避免覆盖。详见[部署与环境变量](docs/shared/deployment.md)。

## 文档

- [文档导航](docs/README.md)：按模块查阅。
- [产品约束](docs/shared/product.md)与[架构与协议](docs/shared/architecture.md)：当前行为、概念边界和模块协议。
- [Web 与 Next.js 应用](docs/web/README.md)与[服务端接口与启动器](docs/api/README.md)：前后端路由与测试说明。
- [支付与交付](docs/api/payment.md)：配置和上线验收。
- [开发约束](AGENTS.md)：修改代码前的必要规则与检查。
