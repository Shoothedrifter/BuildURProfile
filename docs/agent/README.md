# Python Agent

`apps/agent` 使用 FastAPI 管理进程生命周期和健康接口，worker 经 Node 私有协议领取任务，LangGraph 调用版本化 Skills 生成可编辑配置。无照片路径不调用图像服务。

## 结构与运行

| 路径（相对 `apps/agent`） | 职责 |
| --- | --- |
| `src/buildurprofile_agent/server.py` | FastAPI、checkpoint 和 worker 生命周期 |
| `src/buildurprofile_agent/worker.py` | 消费任务、心跳、取消与错误分类 |
| `src/buildurprofile_agent/graph.py` | LangGraph 节点、条件分支与 Skill 计划 |
| `src/buildurprofile_agent/graphs/resume_parse.py` | `resume-parse-v4/v5` 私有解析图，兼容 v2/v3；checkpoint 仅含任务元数据 |
| `src/buildurprofile_agent/contracts.py` | Python 边界数据模型 |
| `src/buildurprofile_agent/transport/node_api.py` | 带令牌和租约的 Node 客户端 |
| `src/buildurprofile_agent/skills/` | 注册表、评分、设计、内容组装、肖像和 QA |
| `src/buildurprofile_agent/providers/` | 外部图像 API 适配器 |
| `tests/` | 单测、黄金样例、模拟供应商和 Node HTTP 集成 |

本机 `npm run dev` 同时启动此服务；单独运行可使用 `npm run dev:agent` 或在已安装环境中执行 `python -m buildurprofile_agent.server`。令牌、环境文件加载及独立部署要求见[部署说明](../shared/deployment.md)，任务协议见[架构与协议](../shared/architecture.md)。

## Skill 扩展

生成图使用版本化的 `assessment.score`、`design.map`、`design.template`、`resume.compose`、`avatar.wibi`、`avatar.pixel` 和 `artifact.qa` Skills。`avatar.wibi.v2` 仅由 `python-agent-v6` 调用，旧任务使用 v1。简历格式化 Skill 仅获得文本模型能力，条目边界由 Web 的规则解析计划固定，结果须经来源块校验。细节见[解析流程 v2](resume-anchored-formatting.md)。

简历解析由独立 Worker 通过有界长轮询领取私有队列。LangGraph 使用 Agent 专用 PostgreSQL 数据库存储 checkpoint。文本页用 `pdfplumber` 提取；用户主动选择 OCR 后，`pypdfium2` 仅渲染无文字页并调用本机 Tesseract 中英文语言包，私有 `resume-source-v2` 记录来源与置信度，低置信度条目待核对。Web 通过 PDF.js 和旧浏览器解析器制定模块与条目边界。`RESUME_TEXT_PROVIDER=openai` 使用 OpenAI Responses 严格 JSON Schema；`RESUME_TEXT_PROVIDER=zai` 使用智谱 Response API 的 `json_object` 输出，再由 Agent 按同一合同校验。两者复用现有 OpenAI Python SDK，但必须使用各自的 API Key 和地址。原 PDF、页面图像、提取文本、模型提示与结果只在当前图执行内存中流转，不进入 LangGraph checkpoint 或日志。缺少模型或对应 Key 时任务返回 `PARSE_FAILED`；OCR 缺组件、缺语言包、超时和无文字有独立错误码。配置见 [Agent 样例](../../apps/agent/.env.example)。合成假模型跨端测试覆盖 Node HTTP 租约和 Python 图；真实供应商仍须单独联调。

新写入使用 `resume-parse-v4`（PDF）和 `resume-parse-v5`（OCR）。校园成果和奖项计数从同一条目的来源块提取，与模型排版后的措辞无关。候选留在私有草稿，带来源定位并默认未勾选。旧解析任务仍按原版读取，新版解析任务及带成果字段的生成任务等待声明支持该合同的 Worker 领取。

新增 Skill 时，在 `skills/` 实现并注册稳定 ID、版本、输入输出校验、能力、许可和超时，再由图节点显式授予所需能力。新增能力需加入 `KNOWN_CAPABILITIES` 并审查数据边界；不注入支付、数据库、任意 shell 或文件系统对象。外部下载的 `SKILL.md` 不作为可执行指令运行。

修改既有 Skill 合同或输出时，同步升级图与 Node 队列的工作流版本、合同及测试。TS 注册表用于浏览器，Python 图使用独立注册表；评分与映射通过共同黄金样例保证一致性。

## 图像供应商与风格资源

从 [Agent 样例](../../apps/agent/.env.example)准备根 `.env.agent`，或直接注入 Python 进程环境：

| 选项 | 配置与实现 |
| --- | --- |
| 默认 Cloudflare | `IMAGE_PROVIDER=cloudflare`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`；Token 需 Workers AI Read/Edit 权限 |
| 可选 OpenAI | `IMAGE_PROVIDER=openai`、`OPENAI_API_KEY`、可选 `OPENAI_IMAGE_MODEL`；模型可用性需独立验证 |

Cloudflare 适配器使用 `@cf/black-forest-labs/flux-2-klein-4b`，经 `httpx` 发送 multipart REST 请求；调用前把肖像和风格参考图等比缩到 480 像素长边。已安装 Cloudflare SDK，但此 multipart 请求不经 SDK。

首屏融合会在原图生成后尝试调用 Cloudflare AI 的 `bria/remove-background`，将原图另存为透明人物层。成图先发送给该第三方去背景模型；只从受限 HTTPS 主机下载结果，并按透明度与主体覆盖率验收。失败时保留原图，以设计化海报展示；预览编辑页会提示透明去背景未完成，Agent 日志只记录任务 ID 与 `CUTOUT_*` 错误码，不记录图片或供应商响应正文。透明人物层和原图分别存放在会话私有资产区，导出时都嵌入单文件 HTML。

抠图使用 `IMAGE_PROVIDER=cloudflare`，从根目录 `.env.agent` 读取 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。请求发送到 Cloudflare 的 `/client/v4/accounts/{account_id}/ai/run`，API Token 需要该账户的 Workers AI 权限。Bria 属于第三方模型，Cloudflare 默认 AI Gateway 通过 Unified Billing 扣除预付额度，可使用同一 Cloudflare Token。收到 HTTP 402 时记为 `CUTOUT_BILLING_REQUIRED`。补充该账户的额度后重新生成。已有任务若没有 `cutout_asset_id`，原图海报仍会使用原图。 [Cloudflare REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/) · [Bria 模型说明](https://developers.cloudflare.com/ai/models/bria/remove-background/)

运行 `npm run setup:avatar` 安装固定提交 `17880b82ea35c1fe1ec4b8f907a053d314df464f` 的 Wibi 资源到私有 `data/wibi-style-pinned/`。赛博科技固定使用「低清晰印刷感动漫」，采用极近景构图。旧版「复古扁平动画头」配方仅供已入队任务兼容读取。Node 校验资源哈希后，通过有效租约把配方交给 Python。

像素世界风的基础作品使用 `python-agent-v7`，由 `design.template.v2`、`resume.compose.v5` 和 `artifact.qa.v4` 生成。新的本机头像任务使用 `python-agent-v10` 和 `avatar.pixel.v4`。Cloudflare Workers AI Clef 分别识别发长、扎发、刘海、发色和可见配饰，并单独确认过肩发束、碎刘海和脸侧分层。确认有过肩发束时使用长发；确认有碎刘海可细化齐刘海或补足未确认的刘海。脸侧分层只应用于长发散发造型。Agent 使用固定图层和同一角色底稿，发色支持深色、暖棕、粉、红、紫、蓝、金、灰白。头颈配饰的显示取决于已打包素材。已入队的 v7、v8、v9 任务分别使用 `avatar.pixel.v1`、`avatar.pixel.v2`、`avatar.pixel.v3`。

照片字节、识别分布、响应正文和供应商密钥只用于当前操作。分层任务复用有效候选时省去识别调用。已绑定候选到期或照片到期时提示重新选照片。超时、取消与有限重试规则见[架构与协议](../shared/architecture.md)。

开发期不设置应用内肖像生成次数上限，以便反复验证风格与工作流；Cloudflare Workers AI 自身额度和计费仍然生效。**Follow-up（生产开放肖像前）**：结合供应商实际用量、会话或账号身份，以及失败和重试的计数语义，重新设计成本与滥用控制。

## 验证与上线门槛

在仓库根目录执行：

```sh
uv sync --project apps/agent --frozen --extra test
npm run test:agent
```

覆盖 Python Skills、完整图、TS/Python 规则对照、模拟图像响应及 Node 私有接口。真实图像 API 需要单独验收，模拟测试不能证明人物相似度、内容安全或供应商费用。

像素世界风的个人头像仅限本机编辑预览。公开分享和离线导出使用模板默认角色。

生产开放肖像还需完成真实供应商评测、身份一致性与内容 QA、成本和地区配置，以及持久资产快照与离线嵌入设计。现有文件格式校验不能替代视觉验收。

## 确认内容 v4

新 Agent 简历生成使用 `python-agent-v4`、`GenerationBriefV3` 和 `DesignConfigV3`。`resume.compose.v4` 只验证并透传按用户确认顺序排列的 `resume-v3` 条目、事实和补充内容；不再调用模型重写，图片只有稳定 ID。`artifact.qa.v3` 验证新合同，图同时检查最终 content 与确认 brief 完全一致。肖像重生成仍受本机非商业预览限制。

Worker 同时消费旧 `python-agent-v2/v3`，其合同及黄金样例保持原语义。新旧版本混用明确失败。Schema 导出、`agent-golden.v3.json` 和 Node HTTP ↔ Python 图的合成测试覆盖新版合同与免费项目创建，不需要真实模型或支付凭据。

透明人物层验收兼容近景肖像：主体覆盖率为 14%–97%，至少 5% 周界采样为透明背景，并检查画面中心保留主体。不再要求两个顶角都透明，帽子或头发可触及顶角；仍拒绝完全不透明、完全透明和只有零星透明像素的结果。已有 HTML 缺失透明层时不会自动补齐，需要重新生成或用有效透明资产重新导出。
