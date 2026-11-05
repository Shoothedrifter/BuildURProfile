# BuildURProfile Agent 平台设计（2026-11-05）

## 目标与边界

完整的作品生成走 LangGraph：已确认的简历展示数据和 8 题答案进入图，图按注册的 Skill 完成评分、设计映射、可选肖像生成、首屏组装和成品校验。作品编辑继续由用户控制。PDF 字节、原文和来源片段只在浏览器；照片仅传到私有资产区，图的 checkpoint 只存资产 ID。支付验签、权益、分享、ZIP 和会话授权属于确定性 API，不能暴露为 Agent Skill。

GitHub Pages 是离线静态预览，继续用同一评分和设计规则在浏览器执行；它没有 LangGraph、支付或永久存储。API 模式下即使没有照片也必须排队运行图，不再从浏览器绕过 Agent。

## 模块与依赖方向

```text
apps/web (确认、编辑、展示)  ──> packages/contracts + packages/skills/shared
apps/api (会话、生成任务、支付、交付) ──> packages/contracts + packages/skills/catalog
apps/agent (Python LangGraph、Skill 注册表、图像 API 适配器) ──HTTP──> apps/api 私有任务协议
packages/skills (浏览器 Skills、Wibi 资源校验) ──> packages/contracts
packages/storage (Node 队列、资产、数据库迁移) ──> packages/contracts
```

`apps/api` 独占任务/资产和支付数据库；`apps/agent` 只通过带服务令牌与租约的私有 HTTP 接口读写本任务，不挂载支付卷。图不得导入 API 的支付服务，API 不得导入 Python Skill 实现。当前 SQLite + 本地资产 + SQLite checkpoint 是单机部署适配器；多实例部署需要可共享的队列、数据库、对象存储和 checkpoint 适配器，不应把 SQLite 文件跨主机共享。

## Skill 合同

每个 Skill 具有稳定 `id`、`version`、输入/输出校验、运行位置、允许的能力和超时。注册表拒绝重复 ID 或未批准的能力。图只根据已确认输入选择可用 Skill，执行器只注入所需的能力（如读取本任务照片、写入本任务成图），不向社区 Skill 暴露 shell、任意文件系统、网络、支付或数据库句柄。执行结果携带 Skill 版本，便于审计与重跑。

首期 Skill：`assessment.score.v1`（八题计分）、`design.map.v1`（风格向量映射）、`resume.compose.v1`（仅确认内容）、`avatar.wibi.v1`（固定三种肖像风格）、`artifact.qa.v1`（合同与资产校验）。确定性 Skill 是可信代码；Wibi 包是已固定提交和哈希校验的资源配方。社区 `SKILL.md` 是设计资料，不会在运行时直接作为可执行指令或脚本。Wibi 的来源版本和许可证记录到配方元数据。

## 图状态与流程

图状态含任务 ID、经过清洗的 `brief`（角色、答案、展示内容）、可选照片资产 ID、风格 ID、Skill 版本、评分向量、配置、成图资产 ID、QA 结果。禁止写入 PDF 原文、sourceRefs、照片字节、密钥、支付状态。图节点顺序：校验输入 → 选取 Skill 计划 → 评分 → 设计映射 → 注入已确认内容 → 可选 Wibi 风格生图 → 最终 QA → 提交预览配置。每个租约使用独立 checkpoint thread；Node 的成图资产写入具有幂等性，重试复用已写入资产。

## 运行可靠性与发布门槛

任务需要所有者、幂等键、状态、租约 token、心跳、次数与退避；完成/失败写入必须校验当前租约。长时间生图期间续租，过期 worker 不能覆盖新执行结果。API 保持会话和 CSRF 校验；任务查询与资产读取严格按会话隔离。调度和图执行日志只输出 ID、节点、耗时、错误码，不输出简历与照片。版本化迁移取代分散的启动时 ALTER。

2026-11-03 的选型决定：肖像生成调用外部图像编辑 API，不在服务器部署模型。`OpenAIImageProvider.edit(portrait, recipe)` 是图与供应商之间的端口。API 密钥只在 Python Agent 环境变量中，照片与风格参考图只发给配置的图像供应商；上传界面必须向用户说明该传输。限流和服务暂不可用进入有限重试；超时不自动重试，以降低重复计费风险。产物仍由任务所有权与图片格式校验保护。供应商、模型、成本和地区须在上线配置中固定并验证。

Wibi 来源清单带有个人非商业许可。未取得商业授权时，Wibi 成图只可本机/内部预览，不进入付费分享或 ZIP。团队可联系作者取得明确许可，或制作具有独立权利来源的自有风格 Skill；直接修改 Wibi 的提示词或配方不自动消除原许可限制。若修改或再分发 Wibi Skill，需按来源仓库要求保留作者、来源、LICENSE 和 NOTICE 并标注修改。高质量肖像的身份一致性与图像内容 QA 需要独立评测/人工确认；仅检查文件存在不代表视觉合格。

## 验收

1. 无照片与有照片的 API 任务都经过同一 LangGraph，返回可编辑 `DesignConfig`，有照片时首屏有授权的成图引用。
2. Skills 可列出合同与版本，非法能力、未知风格、非商业许可越界、无效输入被拒绝。
3. checkpoint 中没有 PDF 原文、sourceRefs、照片字节或支付数据；重启与重复请求不重复产出。
4. 既有支付/交付测试、Web 测试、静态 Pages 与离线导出测试保持通过。
5. 多 worker 租约竞争、心跳、失败重试和会话隔离有针对性测试。上线前再验证外部图像 API、共享存储和真实支付回调。
