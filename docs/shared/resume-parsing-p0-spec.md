# P0 Agent 简历解析：跨端规格

**状态：** 实施规格；基于 `docs/PRD/11.7-前三页prd制作.docx` 的页面一至三、`docs/agent/agent-resume-parsing-plan.md` 与 2026-11-09 的双人分工讨论。此文件定义目标行为；`docs/shared/architecture.md` 中的浏览器规则解析描述仍是现状，完成 P0 时同步更新。

## 1. 目标、边界和责任

文本型 PDF 从 Web 上传，经独立的 Python LangGraph 解析流程产生可编辑草稿。用户在 Web 核对 PDF 原文与十个 A–D 模块，修改并确认后，只有确认的展示字段进入现有作品生成图。四类经历（工作、项目、奖项、校园）按独立条目处理；工作与校园绝不共用一个模块。模块可为空，缺少参考字段不妨碍分类或拆条。

P0 交付上传、校验、解析任务、Agent 语义判断、来源证据、原 PDF 预览、草稿保存、确认投影、删除、错误与取消。条目级图片/链接补充、拖拽排序、自动保存、版本历史、OCR、页面视觉完善属 P1/P2。旧浏览器解析与旧作品读取在迁移期间保持可用；用户新上传流程必须明确显示是 Agent 解析，不得在模型失败时静默回退为“AI 解析成功”。

| 责任 | 主负责人 | 接口评审 |
| --- | --- | --- |
| 解析图、文本模型适配器、PDF 版面块、Python 合同 | Noodle | Marshui 评审草稿形状和错误码 |
| Web 上传/预览/编辑、会话接口、私有文件与任务数据库 | Marshui | Noodle 评审私有协议和任务状态 |
| 共享 Schema、隐私规则、端到端验收 | 共同 | 两人共同确认版本变更 |

此表是协作建议，不限制任何一方修改跨端文档或代码。

## 2. 用户与系统流程

```text
用户选择 PDF → 浏览器预检 → POST /api/resumes/upload
    → Web 校验并保留私有原件、创建 fileId
    → POST /api/resumes/parse → resumeId + 解析任务
    → Agent 领取解析租约 → 读取 PDF → 版面块 → 语义分类/拆条
    → 来源校验 → 持久化 ResumeDraftV1
    → GET status 轮询 → /editor/:resumeId 显示草稿和原 PDF
    → 用户修改并 PATCH 草稿 → 用户确认 → 投影为 ResumeContent
    → 现有测评与 python-agent-v2 作品生成图
```

解析子图节点为 `validate_source → extract_layout → classify_sections → map_design_modules → split_items → verify_evidence → complete_draft`。`classify_sections` 和 `split_items` 调用文本模型；`map_design_modules` 是固定的合同映射，不让模型自由生成模块 ID。用户核对是两个工作流之间的持久边界，不是一个等待数天的 LangGraph 节点。解析图 checkpoint 仅保存任务 ID、源文件 ID、节点状态和版本；PDF 字节、提取全文、来源块文本及模型密钥均不进入 checkpoint。

## 3. 私有数据合同

`ResumeSourceV1` 只供 Web 存储与 Agent 使用。`PdfBlock` 为 `{blockId,page,bbox:[x0,y0,x1,y1],fontSize,bold,readingOrder,text}`；`blockId` 在同一原件和抽取版本内稳定，页号从 1 起，坐标使用 PDF 页坐标，阅读顺序在每页内单调。保留原始块文本，不把原 PDF 或全文写进任务日志。双栏按列归并后确定阅读顺序；跨页条目可引用多页块。

`ResumeDraftV1` 是私有可编辑合同：

```ts
type ResumeModuleKind =
  | "basicInfo" | "jobIntent" | "selfEvaluation" | "education"
  | "workExperience" | "projects" | "awards" | "campusExperience"
  | "skills" | "other";

type ResumeDraftV1 = {
  version: "resume-draft-v1";
  resumeId: string;
  fileId: string;
  revision: number;
  sections: Array<{
    id: ResumeModuleKind; kind: ResumeModuleKind;
    mappedDesignModule: string; order: number; visible: boolean;
    items: Array<{
      itemId: string; order: number; title: string; details: string;
      facts: Array<{ key: string; label: string; value: string; included: boolean }>;
      sourceBlockIds: string[]; confidence: number;
      segmentationConfidence: number; needsReview: boolean;
      included: boolean; origin: "agent" | "user";
    }>;
  }>;
};
```

准确字段长度、ID 格式和数组上限由版本化 JSON Schema 与 TS/Python 边界模型统一确定；以上是语义合同，不允许任意附加字段。`sections` 必须恰好包含十个不重复的模块，空模块用 `items: []` 表示。`itemId` 不依赖数组索引，编辑、重分类和保存后稳定。`sourceBlockIds` 必须引用同一 PDF 的真实块，`origin: "user"` 的新增内容可没有来源块；模型不能为未在 PDF 出现的事实造来源。姓名、邮箱、电话作为 `basicInfo` 的已知 fact key；确认前要求姓名以及邮箱或电话，未识别姓名仍可进入编辑页手动补充。

| ResumeModuleKind | mappedDesignModule | PRD 类型 |
| --- | --- | --- |
| `basicInfo` | `hero-profile` | 基本信息 |
| `jobIntent` | `job-intent-strip` | 求职意向 |
| `selfEvaluation` | `intro-card` | 自我评价 |
| `education` | `education-timeline` | 教育背景 |
| `workExperience` | `work-timeline` | 实习/工作经历 |
| `projects` | `project-stacked-cards` | 项目经历 |
| `awards` | `award-badges` | 荣誉奖项 |
| `campusExperience` | `campus-timeline` | 校园经历 |
| `skills` | `skill-tags` | 专业技能 |
| `other` | `free-content-card` | 其他 |

模块映射在服务端和 Agent 端由同一版本化表校验；不属于前九类的内容归 `other`。分类置信度与拆条置信度分开；拆条 `≥0.8` 自动形成多条，`0.5–<0.8` 保留原段并提示建议，`<0.5` 保留原段并标记待核对。置信度只辅助编辑，不代替来源校验。用户编辑后的文本可与原 PDF 不同，来源证据不再被解释为对编辑后文字的逐字保证。

`projectConfirmedResume(draft)` 输出受校验的 `ResumeContent`/`resume-v1`，仅包含可见且用户确认的条目和字段；过滤 `sourceBlockIds`、置信度、PDF 原文、文件路径、任务状态及未勾选的敏感字段。电话、年龄、政治面貌、期待薪资等默认隐藏，用户主动选择才展示。P0 保持现有 Marquee + StackedCards 与三种皮肤合同，展示顺序升级留给 P1；旧 `DesignConfigV1` 可读。

## 4. HTTP 和任务协议

所有用户接口依赖现有匿名会话；`POST/PATCH/DELETE` 保持 CSRF 校验；跨会话统一返回 404。响应不得包含磁盘路径或模型请求原文。二进制响应带 `Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`。

| 接口 | 请求与成功响应 | 失败/约束 |
| --- | --- | --- |
| `POST /api/resumes/upload` | 单个 PDF 字节；`201 {fileId,fileName,size,pageCount}` | ≤10,000,000 B、1–20 页、扩展名/MIME/魔数/可解析结构、未加密、有可提取文字；失败清理临时文件 |
| `POST /api/resumes/parse` | `{fileId,idempotencyKey}`；`202 {resumeId,status:"QUEUED"}` | 同一会话的文件，幂等键冲突 409；按会话限流 |
| `GET /api/resumes/:id/status` | `{resumeId,status,stage,progress,errorCode}` | 解析中 1.5 秒轮询；前端 60 秒等待超时可取消/重试 |
| `GET /api/resumes/:id` | `{draft:ResumeDraftV1,revision}` | 草稿仅属主可读；成功前返回状态/冲突错误 |
| `GET /api/resumes/:id/source` | `application/pdf` 原文预览 | 仅属主；不提供公开静态 URL；解析后仍可用，删除后 404 |
| `PATCH /api/resumes/:id` | `{revision,draft}` → `{revision,draft}` | 版本不一致 409；服务端校验十模块、来源 ID、大小和敏感字段状态 |
| `POST /api/resumes/:id/cancel` | `{status}` | 排队立即取消，运行中标记并由 Agent 停止；旧租约不得回写 |
| `DELETE /api/resumes/:id` | `{ok:true}` | 清理文件、块、草稿、任务；幂等处理同会话重复删除 |

上传 API 接收原始 `application/pdf`，文件名作为受限头部传入，避免 multipart 带来的双重缓冲；Web 端可用 `XMLHttpRequest` 报告上传百分比。Next.js 的 Web Request 桥接必须在读取前检查 `Content-Length`，并在读取时计数限量；不能让现有 `dispatchWebRequest()` 无界 `arrayBuffer()` 处理上传。源文件写入专用数据目录，权限目录 `0700`、文件 `0600`，使用随机文件 ID 和原子写入，原文件名只用于受限显示，不用作路径。

私有 `/_internal/agent/resume-tasks/*` 使用现有 `AGENT_SERVICE_TOKEN`，每次源文件读取、心跳、完成、失败、取消确认同时核对任务 ID、当前 lease token、未过期租约和未取消状态。解析任务使用独立 `resume-parse-v1` 工作流版本、队列和幂等键，不复用生成队列中的 `python-agent-v2` 任务类型。Agent 只通过私有接口读取本任务 PDF、提交受校验草稿；不直接打开 Node 数据库或支付卷。任务状态为 `QUEUED → RUNNING → SUCCEEDED`，或 `FAILED/CANCELLING/CANCELLED`；可重试错误有限次数且指数退避。旧租约回写一律 409。

错误码使用 PRD 的 `FILE_TYPE_INVALID`、`FILE_TOO_LARGE`、`PDF_PAGE_LIMIT`、`PDF_ENCRYPTED`、`PDF_NO_TEXT`、`UPLOAD_FAILED`、`PARSE_TIMEOUT`、`PARSE_FAILED`、`RATE_LIMITED`。内部错误仅记录任务 ID、节点、耗时和错误码；用户界面显示可恢复提示，不展示模型原文或堆栈。

## 5. PDF、模型和安全判定

Web 对上传做格式、页数、加密和文字可提取性二次校验；Agent 再校验租约下读取的字节和提取结果。P0 只接受文本型 PDF，扫描件返回 `PDF_NO_TEXT` 并引导用户更换文件，OCR 留给 P1。原件及其私有草稿从上传时间起保留 30 天，用户可提前删除；到期自动清理文件、块、草稿和解析任务。编辑页显示到期时间，刷新后在期限内可预览原件；超过期限返回明确的过期状态，不延长保留期。配置和隐私文案必须一致；开发环境不得靠手工清空 `data/` 作为删除机制。

文本模型通过 Agent 适配器配置供应商、模型和密钥；配置缺失或调用失败返回 `PARSE_FAILED`，不假称为 AI 成功。供应商只收到为分类/拆条所需的受限文本块、页码和布局提示，不收到用户会话、文件路径、支付数据或照片。PDF 内嵌指令始终视为数据。模型输出采用固定 JSON Schema，禁止自由工具调用；验证模块枚举、来源块存在、覆盖率、顺序和条目长度。未分配块不得静默丢失，归 `other` 或标记待核对。所有日志不得输出 PDF 文本、模型提示、模型响应或密钥。

## 6. P0 验收场景

1. 文本 PDF 上传后，Web 与 Agent 都完成校验，刷新编辑页仍能看到私有原 PDF 和已保存草稿。
2. 十个模块始终显示；基本信息可手填；工作与校园独立；四类经历能按高置信度拆多条，中低置信度保留原段供核对。
3. 双栏、跨页、无标准标题、缺公司/日期、空参考字段和提示注入的合成样例均有可追溯结果；模型失败不会显示规则解析为 AI 成功。
4. 同会话重试、取消、删除可用；跨会话读写/预览/删除均失败；取消后旧租约不能覆盖新草稿。
5. 确认时只要求姓名加邮箱或电话；生成 brief、checkpoint、分享与导出产物均不含原 PDF、来源块或未确认草稿。
6. `npm test`、`npm run build`、`npm run test:payment`、`npm run test:skills`、`npm run test:agent` 通过；合成黄金样例与 TS/Python Schema 一致。


## 7. 合同边界补充

P0 已获授权使用服务端私有存储及必要模型传输；上传提交前须清楚披露从上传起 30 天保留期限及配置的供应商。初始实现采用 OpenAI API 和现有 Python SDK；GLM 接入沿用该 SDK，但使用智谱独立的 Response API 地址与 `json_object` 格式，并在 Agent 端按同一固定 Schema 校验。仅发送分类/拆条必要块。一个 fileId 对应一个 resumeId；失败重试先取消并隔离旧租约，再为同一 resumeId 新建解析任务，删除覆盖全部历史任务。

P0 支持十模块间移动/重分类及手动增删改；手动拆分/合并、自定义模块与重解析合并留给 P1。私有 fact.included 为必填选择，电话、年龄、政治面貌、期待薪资默认 false，由用户主动选择展示。基本信息和求职意向只投影已选 facts；其他条目标题/正文含本条隐藏 fact 的值时置空，防止隐藏值经自由文本泄漏。items.included 必须由确认界面明确选择，来源不等同确认。

运行时补充校验模块完整唯一、固定映射、全局 itemId 唯一、模块/条目顺序唯一和同文件来源引用。ID 为 1–100 位 ASCII 字母数字、下划线、连字符，首位字母数字。每模块至多 100 条，每条至多 100 facts、500 来源 ID；标题上限 300 字符，正文 12000，fact 值 2000。源合同固定 extractionVersion=pdf-layout-v1，UTC 秒精度 uploadedAt/expiresAt 相差恰好 30 天，pageCount 为 1–20；至多 5000 块，每块文本 12000 字符，同页 readingOrder 严格递增，矩形坐标非负有界且不倒置。展示 fact 的日期不强迫补全年月日；元数据日期严格校验。
