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
| `export.mjs` | 用户作品集（Showcase）HTML 与多文件 ZIP 打包 |

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
| `POST /api/generations` | 新 Agent 请求提交 `resumeId/revision/role/answers/idempotencyKey`，服务端校验草稿并投影；兼容入口接收 brief；成功返回 `201` |
| `GET /api/generations/:id` | 所属会话查询状态、配置及自动保存的 projectId |
| `POST /api/generations/:id/cancel` | 取消排队任务，或请求终止运行中的任务 |
| `GET /api/showcase-media/:id` | 属主读取独立作品图片，禁止缓存 |
| `GET /api/shares/:token/media/:id` | 校验付款、有效分享与快照引用后读取图片，不要求属主会话 |
| `GET /api/hero-assets/:id` | 读取所属会话的有效图片，使用私有禁止缓存响应 |

服务端根据会话决定所有者，不接受客户端注入所有权。写操作校验 CSRF；入队清洗拒绝 PDF 原文、`sourceRefs` 和多余字段。源照片和成图分别按 1 天、7 天有效期管理。开发期不设应用内肖像生成次数上限，供应商自身的额度和计费仍然生效。
新 Agent 路径仅接受服务端投影的 `resume-v3`；客户端不能通过旧 brief 路径自报新版本 content。revision 不匹配返回 409；待核对、无效链接、图片归属或格式错误在入队前拒绝，任务和图片复制事务回滚。旧合同仍可供已有项目和任务读取。

PDF 上传接受符合大小、页数和加密规则的扫描件，并记录无文字页。普通 `POST /api/resumes/parse` 仍可能返回 `PDF_NO_TEXT`；用户明确选择后可携带 `ocrRequested:true` 对同一未过期 `fileId` 重试。混合 PDF 的 `POST /api/resumes/:id/reparse-candidates` 可携带 `ocrRequested:true`，由独立任务生成候选，不改变当前草稿。OCR 工作流使用 `resume-parse-v3` 和 `resume-source-v2`；内部 `POST /_internal/agent/resume-tasks/:id/plan` 只接受有效服务令牌和租约，用 Web 原解析器对 OCR 文字制定条目边界。

`GET /api/resumes/:id/images` 列出尚未被已保存草稿引用的属主图片（稳定 ID、原条目 ID、MIME 和大小），供用户恢复或逐张删除，不执行批量回收。`POST /api/resumes/:id/images` 上传私有补充图片；新客户端携带 `x-resume-item` 以支持条目限额。`DELETE /api/resumes/:id/images/:imageId` 仅删除尚未被已保存草稿引用的图片；移除已保存图片须先保存草稿，服务端删除失去引用的旧图。限制与生命周期见[架构说明](../shared/architecture.md#简历图片与作品资产)。

私有协议、租约、取消与重试见[架构与协议](../shared/architecture.md)。图片文件格式通过不代表人物相似度或视觉质量合格。

## 项目与交付

项目和订单绑定匿名会话。免费预览不具备交付资格；付费资格与交付状态分开记录，打包失败后资格保留，可以重试。分享快照默认 7 天有效且可撤销，访问者无需登录；分享 token 不授予编辑、查单或下载权限。已经下载的导出包无法撤回。

`DELETE /api/projects/:id` 只允许项目所属会话调用，并要求 CSRF。删除后项目从列表和编辑接口消失，项目配置及分享快照清空，分享和未使用的下载链接失效；订单、支付资格及交付记录保留用于核对。生成任务记录保留，但关联已删除项目的任务不能恢复作品；独立作品图片按其余有效引用清理，已经下载的文件不属于项目删除范围。仍有待核实订单的项目暂不能删除，避免付款后失去交付入口。

支付配置、沙箱和上线核验见[支付与交付](payment.md)。

v3 无肖像成功结果在同一事务中创建免费项目，重复完成不重复建项目或授予支付资格。ZIP 包含 HTML 和按引用读取的 `assets/*` 图片；任何图片缺失均使打包明确失败，保留付费资格以供重试。

## 启动与检查

`npm start` / `npm run dev:server` 只启动 Next.js 服务。完整生成必须同时运行 Python Agent，并共享服务令牌；具体配置见[部署说明](../shared/deployment.md)。

- `/healthz`：Next.js API 健康检查。
- `/readyz`：检查 Python Agent 心跳就绪情况。
- `npm run test:payment`：运行 `apps/launcher` 下的服务端全量测试（支付、生成、内部协议与 Next 路由）。
- `npm run test:agent`：Python LangGraph 与 Node 私有协议集成测试。
