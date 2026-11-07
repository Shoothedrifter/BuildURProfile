# API

`apps/api` 使用 Node.js 24+ 原生 HTTP，是唯一公开后端入口。它管理匿名会话、CSRF、项目、生成任务、私有资产、支付资格和交付；Python 只通过私有协议执行生成任务。

## 模块入口

| 路径（相对 `apps/api`） | 职责 |
| --- | --- |
| `src/index.mjs` | 配置加载、数据库初始化和服务启动 |
| `src/http.mjs` | HTTP、会话、CSRF、静态资源与交付路由 |
| `src/service.mjs` | 项目、订单、资格、分享和下载权限 |
| `src/config.mjs`、`src/gateway.mjs` | 支付配置与官方支付宝 SDK |
| `src/routes/generations.mjs` | 浏览器任务与资产路由 |
| `src/routes/internal-agent.mjs` | 服务令牌与租约保护的 Agent 协议 |
| `src/export.mjs` | 离线 ZIP 打包 |

`src/database.mjs`、`src/generations.mjs` 是存储模块的兼容导出入口。实际数据库迁移、任务队列、确认内容清洗及资产文件管理位于 `packages/storage/src/`。

## 任务与资产

| 接口 | 行为 |
| --- | --- |
| `GET /api/avatar-styles` | 返回当前可用风格；未启用肖像时为空 |
| `POST /api/portraits` | 校验并保存所属会话的照片，返回资产 ID |
| `POST /api/generations` | 提交确认后的 brief 与可选照片资产 ID，成功返回 `201` 任务信息 |
| `GET /api/generations/:id` | 所属会话查询状态与结果 |
| `POST /api/generations/:id/cancel` | 取消排队任务，或请求终止运行中的任务 |
| `GET /api/hero-assets/:id` | 读取所属会话的有效图片，使用私有禁止缓存响应 |

API 根据会话决定所有者，不接受客户端注入所有权。写操作校验 CSRF；入队清洗拒绝 PDF 原文、`sourceRefs` 和多余字段。源照片和成图分别按 1 天、7 天有效期管理，当前每会话 24 小时最多发起 5 次肖像生成。

私有协议、租约、取消与重试见[架构与协议](../shared/architecture.md)。图片文件格式通过不代表人物相似度或视觉质量合格。

## 项目与交付

项目和订单绑定匿名会话。免费预览不具备交付资格；付费资格与交付状态分开记录，打包失败后资格保留，可以重试。分享快照默认 7 天有效且可撤销，访问者无需登录；分享 token 不授予编辑、查单或下载权限。已经下载的 ZIP 无法撤回。

支付配置、沙箱和上线核验见[支付与交付](payment.md)。

## 启动与检查

`npm start` / `npm run dev:server` 只启动 Node。完整生成必须同时运行 Agent，并共享服务令牌；具体配置见[部署说明](../shared/deployment.md)。

- `/healthz`：API 健康检查。
- `/readyz`：检查 Agent 心跳就绪情况。
- `npm run test:payment`：构建后运行 API 测试，包含支付、生成和权限检查。
- `npm run test:agent`：Python 与 Node 私有协议相关测试。
- `npm run verify:export`：离线 ZIP 渲染回归。
