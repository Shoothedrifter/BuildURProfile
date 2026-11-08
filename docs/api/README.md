# API 与 Launcher

服务端 API 已合入 `apps/web`（Next.js App Router Route Handlers 与 `apps/web/src/server/`），而 `apps/launcher` 作为整个项目的**启动编排、服务端测试与容器化部署入口**。

## 模块结构

### 1. `apps/web/src/server/`（Next.js 服务端实现）

| 路径（相对 `apps/web/src/server`） | 职责 |
| --- | --- |
| `runtime.mjs` | Next.js Route Handlers 单例运行时初始化、环境变量与数据库连接绑定 |
| `http.mjs` | 请求分发器、匿名会话签名、CSRF 校验、Web Fetch `Request`/`Response` 适配 |
| `service.mjs` | 项目、订单、支付资格、分享和下载权限领域服务 |
| `config.mjs`、`gateway.mjs` | 支付配置校验、沙箱凭据读取与官方支付宝 SDK |
| `routes/generations.mjs` | 浏览器生成任务与资产路由 |
| `routes/internal-agent.mjs` | 服务令牌与租约保护的 Python Agent 私有协议 |
| `export.mjs` | 用户作品集（Showcase）单文件 HTML 与 ZIP 打包 |

`database.mjs`、`generations.mjs` 是存储模块的导出入口。实际数据库迁移、任务队列、确认内容清洗及资产文件管理位于 `packages/storage/src/`。

### 2. `apps/launcher/`（启动、测试与部署入口）

| 路径（相对 `apps/launcher`） | 职责 |
| --- | --- |
| `src/dev.mjs` | 本机联调启动器：同时启动 Next.js（5173）与 Python Agent（8788）并注入共享临时令牌 |
| `src/index.mjs` | 生产启动器：加载环境并启动 `next start`（默认 8787） |
| `src/payment.test.mjs` | 支付、订单、会话、CSRF、分享与导出端到端测试 |
| `src/generations.test.mjs` | 生成队列、租约、取消与私有资产隔离测试 |
| `src/internal-agent.test.mjs` | Node ↔ Python Agent 内部协议与租约围栏测试 |
| `src/next-routes.test.mjs` | Next.js App Router Route Handlers 直接调用契约测试 |
| `Dockerfile` | Next.js 全栈生产镜像构建文件 |
| `.env.local.example`、`.env.example` | 本机与 Compose 环境变量样例 |

## 任务与资产接口

| 接口 | 行为 |
| --- | --- |
| `GET /api/avatar-styles` | 返回当前可用风格；未启用肖像时为空 |
| `POST /api/portraits` | 校验并保存所属会话的照片，返回资产 ID |
| `POST /api/generations` | 提交确认后的 brief 与可选照片资产 ID，成功返回 `201` 任务信息 |
| `GET /api/generations/:id` | 所属会话查询状态与结果 |
| `POST /api/generations/:id/cancel` | 取消排队任务，或请求终止运行中的任务 |
| `GET /api/hero-assets/:id` | 读取所属会话的有效图片，使用私有禁止缓存响应 |

服务端根据会话决定所有者，不接受客户端注入所有权。写操作校验 CSRF；入队清洗拒绝 PDF 原文、`sourceRefs` 和多余字段。源照片和成图分别按 1 天、7 天有效期管理，当前每会话 24 小时最多发起 5 次肖像生成。
确认后的 `resume-v1` 模块可随 brief 入队；嵌套条目也使用严格字段白名单，拒绝来源摘录和未确认 PDF 数据。

私有协议、租约、取消与重试见[架构与协议](../shared/architecture.md)。图片文件格式通过不代表人物相似度或视觉质量合格。

## 项目与交付

项目和订单绑定匿名会话。免费预览不具备交付资格；付费资格与交付状态分开记录，打包失败后资格保留，可以重试。分享快照默认 7 天有效且可撤销，访问者无需登录；分享 token 不授予编辑、查单或下载权限。已经下载的导出包无法撤回。

支付配置、沙箱和上线核验见[支付与交付](payment.md)。

## 启动与检查

`npm start` / `npm run dev:server` 只启动 Next.js 服务。完整生成必须同时运行 Python Agent，并共享服务令牌；具体配置见[部署说明](../shared/deployment.md)。

- `/healthz`：Next.js API 健康检查。
- `/readyz`：检查 Python Agent 心跳就绪情况。
- `npm run test:payment`：运行 `apps/launcher` 下的服务端全量测试（支付、生成、内部协议与 Next 路由）。
- `npm run test:agent`：Python LangGraph 与 Node 私有协议集成测试。
