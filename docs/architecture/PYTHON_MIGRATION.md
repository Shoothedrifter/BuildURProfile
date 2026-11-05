# Python LangGraph 服务迁移合同（已决定，2026-11-03）

## 运行所有权

`apps/web`（React/Vite）继续在浏览器解析 PDF 和确认字段；`apps/api`（Node 原生 HTTP）继续是唯一公网入口，并拥有匿名会话、CSRF、任务状态、照片资产、支付验签和交付。`apps/agent`（Python 3.11+、LangGraph、FastAPI）在内部网络运行，是**唯一**生成任务消费者；不读取支付宝表或密钥。旧 JS worker 和图已从运行目录移除。生图由 Python ImageProvider 调用外部图像编辑 API，不安装 MFLUX 或模型权重。

## 内部任务协议 v1

Node API 的 `/_internal/agent/*` 仅接受 `Authorization: Bearer AGENT_SERVICE_TOKEN`，用常数时间比较；反向代理不向公网转发该前缀。令牌只在 Node/Python 服务环境中，不进入 Vite、checkpoint 或日志。所有带任务 ID 的请求同时校验正在运行且未过期的租约 token，失效 worker 不可写结果。请求/响应均用 JSON，只有照片下载和成图上传使用二进制。

| 请求 | 结果 | 作用 |
| --- | --- | --- |
| `POST /_internal/agent/lease` `{workerId}` | `204` 或 `{id, leaseToken, workflowVersion, brief, config, portraitAssetId, styleId, outputAssetId}` | 原子领取任务 |
| `POST /_internal/agent/heartbeat` `{workerId}` | `{ok:true}` | worker 就绪心跳 |
| `POST /_internal/agent/tasks/:id/heartbeat` `{leaseToken}` | `{ok,cancelRequested}` | 续租与取消检查 |
| `GET /_internal/agent/tasks/:id/output` `x-agent-lease` | `{assetId,exists}` | 查找可复用的幂等成图 |
| `GET /_internal/agent/tasks/:id/portrait` `x-agent-lease` | 原图字节及 MIME | 只读本任务照片 |
| `GET /_internal/agent/tasks/:id/recipe` `x-agent-lease` | 经固定哈希校验的风格配方及 0–2 张参考图 | 只读已批准风格 |
| `POST /_internal/agent/tasks/:id/output` `x-agent-lease` + 图片字节 | `{assetId}` | 校验格式、尺寸并幂等存储 |
| `POST /_internal/agent/tasks/:id/complete` `{leaseToken,config}` | `{ok}` | QA 成功后提交配置 |
| `POST /_internal/agent/tasks/:id/fail` `{leaseToken,errorCode,retryable}` | `{ok}` | 分类失败与有限退避 |
| `POST /_internal/agent/tasks/:id/ack-cancel` `{leaseToken}` | `{ok}` | 所有者取消后清理租约 |

公开 `/api/generations` 的请求/响应合同保持不变；浏览器不知道 Python 内部地址。取消接口只允许当前匿名会话与 CSRF，排队任务可立即取消，运行中任务标记取消并尽力中止供应商请求；已发出的 API 调用可能计费，界面不得承诺退款或零成本。

## Python 包与图

```text
apps/agent/
  pyproject.toml
  Dockerfile
  src/buildurprofile_agent/
    server.py             FastAPI 健康检查和 worker 生命周期
    transport/node_api.py 内部任务协议客户端
    graph.py              LangGraph StateGraph、条件分支和 checkpoint
    contracts.py          GenerationBriefV1/DesignConfigV1 校验
    skills/               注册表、测评、设计、内容组装、Wibi、QA
    providers/            图像编辑 API 适配器与测试替身
  tests/                  Python 单测与跨语言黄金样例
packages/contracts/schema/ 版本化 JSON 合同
```

图输入为已确认 brief 与可选照片资产 ID；checkpoint 存任务 ID、brief、Skill 版本、评分向量、设计配置、成图资产 ID、QA 结果，不存照片字节、PDF 原文或密钥。每次租约使用独立 checkpoint thread；重试重新执行确定性节点，成图通过 Node 资产 ID 幂等复用。版本不匹配的任务拒绝混用新旧 Skill。副作用节点使用租约 fencing；调用图像 API 前后检查取消，运行时每 15 秒续租。UI 付费入口仍禁止未授权的 Wibi 成图。

## 部署与验证

Docker Compose 分 `web-api`、`agent` 两个服务及私有持久卷；`agent` 的 `.env.agent` 才包含 `OPENAI_API_KEY`，Node 的 `.env.api` 才包含支付配置，二者都不 COPY 入镜像。单机 Node 管理 SQLite/资产卷，Python 只走内部 API，不直接挂载支付数据库；LangGraph SQLite checkpoint 单独挂载给 Python。多副本生产需要迁移 PostgreSQL 与对象存储。CI 验收覆盖 TS/Python 评分映射黄金样例、无照片完整图、带模拟图像 API 的肖像图、Node↔Python 内部接口、支付与 ZIP 回归、Docker 构建。没有可用图像 API Key 时只能完成模拟路径，不能声称真实生图验收。
