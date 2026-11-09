# Python Agent

`apps/agent` 使用 FastAPI 管理进程生命周期和健康接口，worker 经 Node 私有协议领取任务，LangGraph 调用版本化 Skills 生成可编辑配置。无照片路径不调用图像服务。

## 结构与运行

| 路径（相对 `apps/agent`） | 职责 |
| --- | --- |
| `src/buildurprofile_agent/server.py` | FastAPI、checkpoint 和 worker 生命周期 |
| `src/buildurprofile_agent/worker.py` | 消费任务、心跳、取消与错误分类 |
| `src/buildurprofile_agent/graph.py` | LangGraph 节点、条件分支与 Skill 计划 |
| `src/buildurprofile_agent/graphs/resume_parse.py` | 七节点 `resume-parse-v1` 私有解析图；checkpoint 仅含任务元数据 |
| `src/buildurprofile_agent/contracts.py` | Python 边界数据模型 |
| `src/buildurprofile_agent/transport/node_api.py` | 带令牌和租约的 Node 客户端 |
| `src/buildurprofile_agent/skills/` | 注册表、评分、设计、内容组装、肖像和 QA |
| `src/buildurprofile_agent/providers/` | 外部图像 API 适配器 |
| `tests/` | 单测、黄金样例、模拟供应商和 Node HTTP 集成 |

本机 `npm run dev` 同时启动此服务；单独运行可使用 `npm run dev:agent` 或在已安装环境中执行 `python -m buildurprofile_agent.server`。令牌、环境文件加载及独立部署要求见[部署说明](../shared/deployment.md)，任务协议见[架构与协议](../shared/architecture.md)。

## Skill 扩展

当前 Python Skills 为 `assessment.score.v1`、`design.map.v1`、`resume.compose.v2`、`resume.sections.v1`、`resume.items.v1`、`avatar.wibi.v1` 和 `artifact.qa.v1`。后两项简历 Skill 仅获得文本模型能力，分类与拆条结果须经来源块校验。

简历解析由独立 Worker 领取 `resume-parse-v1` 队列。PDF 版面提取使用 `pdfplumber`，模型通过 OpenAI Responses API 的严格 JSON Schema 输出分类和分组；原 PDF、提取文本、模型提示与结果只在当前图执行内存中流转，不进入 LangGraph checkpoint。缺少 `OPENAI_API_KEY` 或 `RESUME_TEXT_MODEL` 时任务明确失败为 `PARSE_FAILED`。使用根 `.env.agent` 设置两项，文本模型名称示例见 [Agent 样例](../../apps/agent/.env.example)。合成假模型跨端测试已覆盖真实 Node HTTP 租约和 Python 图；未配置真实密钥时不视为 OpenAI 实时联调验收。

新增 Skill 时，在 `skills/` 实现并注册稳定 ID、版本、输入输出校验、能力、许可和超时，再由图节点显式授予所需能力。新增能力需加入 `KNOWN_CAPABILITIES` 并审查数据边界；不注入支付、数据库、任意 shell 或文件系统对象。外部下载的 `SKILL.md` 不作为可执行指令运行。

修改既有 Skill 合同或输出时，同步升级图与 Node 队列的工作流版本、合同及测试。TS 注册表用于浏览器，Python 图使用独立注册表；评分与映射通过共同黄金样例保证一致性。

## 图像供应商与风格资源

从 [Agent 样例](../../apps/agent/.env.example)准备根 `.env.agent`，或直接注入 Python 进程环境：

| 选项 | 配置与实现 |
| --- | --- |
| 默认 Cloudflare | `IMAGE_PROVIDER=cloudflare`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`；Token 需 Workers AI Read/Edit 权限 |
| 可选 OpenAI | `IMAGE_PROVIDER=openai`、`OPENAI_API_KEY`、可选 `OPENAI_IMAGE_MODEL`；模型可用性需独立验证 |

Cloudflare 适配器使用 `@cf/black-forest-labs/flux-2-klein-4b`，经 `httpx` 发送 multipart REST 请求；调用前把肖像和风格参考图等比缩到 480 像素长边。已安装 Cloudflare SDK，但此 multipart 请求不经 SDK。

运行 `npm run setup:avatar` 安装固定提交 `17880b82ea35c1fe1ec4b8f907a053d314df464f` 的三种 Wibi 资源到私有 `data/wibi-style-pinned/`。Node 校验哈希后，只把已批准任务的配方交给 Python。三种风格为复古扁平动画头、明黄发丝涂鸦、低清晰印刷感动漫，输出静态画面并保留各自风格背景；低清晰印刷感动漫采用极近景构图，画面几乎不留背景。

明黄发丝涂鸦使用项目自有的改写提示，优先保留原图发型、马尾扎点与配饰。上游提示词仍按原始哈希校验，最终配方另有版本标识；此修改不改变 Wibi 的个人非商业许可。

照片字节和供应商密钥不进入图状态或 checkpoint；供应商失败应明确报错，不伪造成功成图。超时、取消与有限重试规则见[架构与协议](../shared/architecture.md)。

开发期不设置应用内肖像生成次数上限，以便反复验证风格与工作流；Cloudflare Workers AI 自身额度和计费仍然生效。**Follow-up（生产开放肖像前）**：结合供应商实际用量、会话或账号身份，以及失败和重试的计数语义，重新设计成本与滥用控制。

## 验证与上线门槛

在仓库根目录执行：

```sh
uv sync --project apps/agent --frozen --extra test
npm run test:agent
```

覆盖 Python Skills、完整图、TS/Python 规则对照、模拟图像响应及 Node 私有接口。真实图像 API 需要单独验收，模拟测试不能证明人物相似度、内容安全或供应商费用。

Wibi 风格规则具有个人非商业限制。未获得商业授权或替换为独立权利来源的风格前，只可本机预览；服务端继续拒绝带肖像配置的付费分享和 ZIP。复制或改写提示词不自动解除许可限制；修改和再分发需保留作者、来源、LICENSE、NOTICE 并标注修改。来源见 [Wibi Style](https://github.com/Vieeeeeee/wibi-style)。

生产开放肖像还需完成真实供应商评测、身份一致性与内容 QA、成本和地区配置，以及持久资产快照与离线嵌入设计。现有文件格式校验不能替代视觉验收。
