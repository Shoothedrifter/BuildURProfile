# 架构与协议

## 模块所有权与数据流

```text
浏览器客户端（Next.js Client Components）：PDF 上传 → 十模块核对 → 八题答案
  ↓ 私有 PDF 上传与解析任务；确认后提交 brief + 可选照片资产 ID
Next.js Route Handlers（apps/web/src/app/api & src/server）
  ├─ 会话 / CSRF / 解析与生成队列 / 私有 PDF 和资产（SQLite via packages/storage）
  ├─ ↕ 服务令牌 + 有效任务租约（/_internal/agent/*）
  │    Python Agent（apps/agent）：简历解析图 → OpenAI 文本模型；生成图 → 可选图像 API
  │      ↓ DesignConfig + 成图资产 ID
  └─ 预览与编辑 → 用户主动请求 → 核实支付 → 正式分享 / 作品集导出
```

| 模块 | 所有权与依赖 |
| --- | --- |
| `apps/web` | Next.js App Router 全栈应用；新流程负责私有 PDF 上传与 Agent 草稿确认，旧浏览器解析为兼容入口；服务端独占项目、支付、任务、会话与资产存储 |
| `apps/launcher` | 启动、联调、集成测试与容器化部署入口；协调 Next.js 服务与 Python Agent 生命周期 |
| `apps/agent` | 唯一生成任务消费者；独立 Python Skill 注册表；通过私有 HTTP 读写本任务，不访问支付卷 |
| `packages/contracts` | TypeScript 类型、Node 校验、版本化 JSON Schema 和跨语言黄金样例 |
| `packages/skills` | 浏览器注册表、TS 评分映射、公共风格目录与仅服务端可用的固定资源校验 |
| `packages/storage` | SQLite 迁移、确认 brief 清洗、任务租约、重试取消和资产存储 |

所有作品集生成任务（含无照片作品）均经过 Python LangGraph 图执行。付款、分享和下载属于确定性服务端业务，不能作为 Agent 可调用的自由工具。

## 合同与图执行

`GenerationBriefV1` 包含已确认的展示字段、角色和答案；展示字段可附带来源已剥离的 `resume-v1` 结构化简历。Next.js 服务端入队前清洗，Python 再校验。`DesignConfigV1` 是预览和交付配置，同样可携带该结构化简历。合同实现与 JSON Schema 位于 `packages/contracts/`，Python 边界模型位于 `apps/agent/src/buildurprofile_agent/contracts.py`。当前工作流版本为 `python-agent-v2`。

图顺序为：校验输入 → 选择 Skill 计划 → 评分 → 设计映射 → 注入确认内容 → 可选肖像 → 最终 QA → 提交配置。Skill 声明稳定 ID、版本、能力、输入输出和超时，执行器只授予当前节点所需能力。

新上传路径由 `resume-parse-v2` 独立队列和七节点 LangGraph 图解析。Web 在私有原件上复用旧浏览器解析算法，生成仅供 Agent 使用的 `resume-parse-plan-v1` 模块和条目锚点；Python 将 PDF 来源块对齐锚点，再由 `resume.format.v1` 文本模型逐条整理标题与正文，不能自由拆分或合并条目。固定映射和来源校验由代码执行，详见[解析流程 v2](../agent/resume-anchored-formatting.md)。私有 `resume-source-v1` 块与 `resume-draft-v1` 十模块草稿经会话隔离持久化；用户在编辑页对照原 PDF 保存并确认，投影剥离来源及隐藏字段后复用 `resume-v1`。原件、块与草稿从上传起 30 天自动删除，可提前删除。旧 `resume.parse.v3` 浏览器规则解析仍作为明确标注的兼容入口，候选只留浏览器内存；模型失败不回退旧路径。

图状态与 checkpoint 可保存任务 ID、清洗后的 brief、评分、配置、Skill 版本、风格与资产 ID、QA 结果。不得保存 PDF 原文、`sourceRefs`、照片字节、密钥和支付数据。照片及风格参考图仅在外部图像请求期间读取。

修改 Skill 合同或输出时，同步升级图和队列中的工作流版本及对应 Schema/测试；拒绝版本不匹配的任务。TS 规则和 Python 规则通过 `packages/contracts/fixtures/agent-golden.v1.json` 检查一致性。维护工具 `scripts/export-agent-schemas.py` 从 Python 模型刷新 Schema，执行后需审阅差异。

## 私有任务协议 v1

前缀为 `/_internal/agent`（在 Next.js 中通过 `next.config.mjs` rewrites 映射到 `/api/_internal/agent/*` Route Handler），只接受 `Authorization: Bearer AGENT_SERVICE_TOKEN`，采用常数时间比较。服务令牌为 32–512 字符且不含空白；反向代理不得向公网转发此路径。

| 方法与相对路径 | 输入 / 输出 |
| --- | --- |
| `POST /lease` | `{workerId}` → `204` 或任务：`id, leaseToken, workflowVersion, brief, config, portraitAssetId, styleId, outputAssetId` |
| `POST /heartbeat` | `{workerId}` → `{ok:true}`，更新 worker 就绪心跳 |
| `POST /tasks/:id/heartbeat` | `{leaseToken}` → `{ok,cancelRequested}`，续租并检查取消 |
| `GET /tasks/:id/output` | `x-agent-lease` → `{assetId,exists}`，查询可复用成图 |
| `GET /tasks/:id/portrait` | `x-agent-lease` → 原图字节及 MIME |
| `GET /tasks/:id/recipe` | `x-agent-lease` → 已校验风格配方、来源与参考图 |
| `POST /tasks/:id/output` | `x-agent-lease` + 图片字节 → `{assetId}` |
| `POST /tasks/:id/complete` | `{leaseToken,config}` → `{ok}` |
| `POST /tasks/:id/fail` | `{leaseToken,errorCode,retryable}` → `{ok}` |
| `POST /tasks/:id/ack-cancel` | `{leaseToken}` → `{ok}` |

除照片下载和成图上传外使用 JSON。所有任务接口同时校验正在运行且未过期的租约；服务令牌不能替代任务租约或浏览器会话。

## 可靠性与存储

任务具有会话所有者、幂等键、工作流版本、次数、状态、租约和退避时间。执行中每 15 秒续租；写结果必须核对租约，过期 worker 不得覆盖新结果。每次租约使用独立 checkpoint thread；重试重跑确定性节点，通过成图资产 ID 幂等复用已写入产物。

排队任务可立即取消，运行中任务标记取消并尽力终止外部请求。已发出的供应商调用可能计费，取消不承诺退款。限流和暂不可用有限重试，超时不自动重试以降低重复计费风险。

当前为单机 SQLite WAL、私有本地资产和 Python 独立 SQLite checkpoint。多主机部署前需迁移共享任务数据库、对象存储及 checkpoint 适配器，不跨主机共享 SQLite 文件。持久化与健康检查见[部署说明](deployment.md)。
