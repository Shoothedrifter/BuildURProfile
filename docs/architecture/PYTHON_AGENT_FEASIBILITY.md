# React/Vite/Node + Python/LangGraph 可行性评估（2026-11-03）

## 结论

可行，推荐将 Python 作为**内部 Agent 服务/worker**，Node.js 继续作为唯一公开 API 和支付边界。React + Vite 仍只处理浏览器内 PDF、确认、编辑和展示。Python 运行 LangGraph、受限 Skill 注册表、图像编辑 API 适配器及 checkpoint；不接收支付密钥，也不直接管理分享/ZIP 权益。LangGraph Python 支持显式节点、分支和持久 checkpoint，适合当前有条件肖像分支的长任务。Python 服务不需要 GPU，因为生图调用外部 API。

```text
浏览器 React/Vite
  ├─ PDF 字节/原文/来源片段仅在浏览器
  └─ 已确认的展示 brief + 可选照片 → Node 公共 API（会话、CSRF、支付、交付）
                                             │ 内部任务合同 v1 + 资产 ID
                                             ▼
                               Python Agent worker / LangGraph
                               ├─ assessment → design → compose → QA
                               └─ 可选 portrait → 风格 Skill → 图像编辑 API → QA
                                             │
                               结果配置 + 私有资产引用 → Node API → 浏览器
```

## 迁移中必须解决的五件事

1. **跨语言合同**：给 `GenerationBriefV1`、`DesignConfigV1`、任务状态、Skill 版本和资产元数据固定 JSON Schema/OpenAPI；Node 在入队前校验，Python 在读任务后再校验。字段迁移必须有版本号，拒绝未知版本。PDF 原文、sourceRefs、照片字节、支付信息不进入 checkpoint。
2. **规则单一性**：八题评分、`styleToConfig` 和 `resume.compose` 从当前 TS Skill 移植到 Python Skill。Pages 静态模式仍在浏览器运行 TS 版本，使用相同的黄金样例做跨语言输出一致性测试；生产 API 结果以 Python 图为准。
3. **队列与存储**：单机由 Node 独占 SQLite WAL 数据库与私有资产卷，Python 只通过内部 HTTP 接口领取任务和读写本任务资产。Python checkpoint 使用单独的 SQLite 卷。多机生产需改为共享 PostgreSQL 任务库、对象存储与 Postgres checkpointer，且付款数据库/表权限不能授予 Agent worker。任务需要幂等键、租约/心跳、重试上限、取消和过期回收。
4. **图像服务**：选用支持单次图像编辑和多个输入图的 API。输入顺序为本人肖像、0–2 张固定并已审查的风格参考图；输出 1024×1024 PNG 原风格背景。Worker 私有环境变量保存 API Key，日志和 checkpoint 仅存请求 ID、模型版本、产物 ID、耗时与错误码；超时重试需评估重复计费。
5. **授权与交付**：Wibi 当前仅个人非商业。修改原 Skill 规则仍须遵守其许可及署名要求；付费交付要么获得作者明确的商业授权，要么发布权利来源独立的自有风格 Skill。肖像作品进入分享/ZIP 前还需实现安全的资产快照及离线嵌入，不能直接复用会话短期 URL。

## Docker 形态

- `web-api`：Node 24+，生产构建的 Vite 静态资源、匿名会话、任务 API、支付与交付。公开 HTTPS 入口只到该服务。
- `agent`：Python 3.12，LangGraph 与图像供应商 SDK，仅内部网络。只读取任务/资产所需权限，`OPENAI_API_KEY` 等仅通过该服务的 `env_file`/secret 注入。
- `postgres` 与对象存储：多机扩容时的目标持久层；当前单机 Compose 采用 Node SQLite/资产卷与 Python 独立 checkpoint 卷，不把私有文件 COPY 进镜像。
- `redis` 可在需要消息通知、横向扩容或更高吞吐时加入；首期可用 PostgreSQL 任务租约，避免同时引入两套队列语义。

`.env` 仅用于本机/部署环境注入，加入 `.dockerignore` 且不写入镜像层、前端变量、日志或 Git。Node 的支付宝密钥与 Python 的图像服务密钥应分开注入。容器以非 root 用户运行，健康检查分别覆盖 API、worker 心跳与数据库。Docker Compose 可复现单机部署；横向扩容与生产高可用仍需外部托管的持久服务和运维验收。

## 与当前 JS 图的关系

迁移已切换为单一 Python Agent 消费者；旧 JS 图和运行依赖已移除。浏览器 PDF Skills、Node 支付/交付服务、会话与 CSRF 保留。当前仍需真实供应商 API、Wibi 商业权利和公网支付闭环验收，不能把模拟生图或单机 Compose 测试视为生产上线证明。

## 依据

- [LangGraph Python 概览](https://docs.langchain.com/oss/python/langgraph/overview) 与 [持久化说明](https://docs.langchain.com/oss/python/langgraph/persistence)。
- [OpenAI 图像生成指南](https://developers.openai.com/api/docs/guides/image-generation) 与 [Python 图像编辑接口](https://developers.openai.com/api/reference/python/resources/images/methods/edit)。模型选择需在开发阶段用本人授权样例评估。
- [Wibi Style 使用与署名](https://github.com/Vieeeeeee/wibi-style/blob/main/README.md)。
