# Agent Resume Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文本型 PDF 的模块识别、设计模块匹配和多段经历拆分接入 Python LangGraph Agent，形成可保存、可核对、可恢复的 10 模块简历草稿，再把用户确认的内容送入现有作品生成流程。

**Architecture:** Next.js 持有匿名会话、私有 PDF/草稿/任务存储和用户接口；Agent 通过服务令牌及有效解析任务租约读取 PDF，在独立的 LangGraph 解析子流程中完成版面还原、语义分类、映射、拆条和校验，返回带来源块的草稿。用户核对后，Web 投影为不含 PDF 来源的生成 brief，继续调用现有生成图。解析任务与生成任务是同一 Agent 系统内两个有明确人工确认边界的工作流；不能把未确认内容塞进现有 `python-agent-v2` 生成图。

**Tech Stack:** Next.js App Router、TypeScript、SQLite、Python 3.11+、FastAPI、LangGraph、Pydantic、结构化输出 LLM、PDF 版面提取库、Vitest、Node tests、pytest。

**Spec:** `docs/PRD/11.7-前三页prd制作.docx` 的页面一至三需求；`AGENTS.md`；`docs/shared/product.md`；`docs/shared/architecture.md`。旧的 `docs/superpowers/plans/2026-11-08-structured-resume-modules.md` 只覆盖浏览器规则解析和 A–D 确认合同，本计划接续它。

## 先定下的设计边界

1. **隐私规则冲突必须在 P0 首项解决。** 现行 `AGENTS.md` 和 `docs/shared/product.md` 规定 PDF、全文、未确认结果只在浏览器内存；PRD 2.8/3.9 要求服务端上传、草稿和重解析；真正的服务端 Agent 解析还会把必要文本交给模型供应商。实现前同步修订数据流、用户告知与同意、供应商处理范围、私有存储和保留/删除期限。维持“生成 brief、生成 checkpoint 和公开作品不含 PDF 原文与 `sourceRefs`”。没有这项决定，不应把 PDF 上传到现有 `/api/generations`。
2. **推荐独立解析子图 + 人工确认 + 既有生成图。** 备选 A 是浏览器抽取文本后上传块，改动较小，但不符合 PRD 的服务端 PDF 二次校验和 `fileId` 重试；备选 B 是一个跨数天等待用户的单一长寿命图，需重做现有租约和 checkpoint 语义。推荐方案保留同一 Agent 技术栈并明确解析节点，同时让用户确认成为持久边界。
3. **候选合同需升级，展示合同要另行投影。** `ResumeCandidateV2` 的平铺数组和页码/摘录没有 blockId、跨模块原文顺序、条目 ID、置信度、可见性或补充内容。新增私有 `ResumeSourceV1`（`PdfBlock { blockId, page, bbox, fontSize, bold, readingOrder, text }`）及可编辑 `ResumeDraftV1`（`basics`、10 个有序 `sections`、稳定 `itemId`、`sourceBlockIds`、`confidence`/`needsReview`、`visible`、编辑状态）。只在确认投影时产生公开的、受校验的 `ResumeContent`；P1 需要随补充内容升级 `StructuredResume`/`DesignConfig` 版本。
4. **模型只对数据作判断。** PDF 内的指令视为简历文字；解析 Skill 没有支付、数据库、任意 URL、shell 或文件系统能力。模型输出必须过 JSON Schema/Pydantic、来源块存在性、顺序、去重、字段证据和大小校验；无法判断的内容进入“其他”或待确认，不得虚构履历。浏览器旧规则可作对照或标题预识别，不能在模型失败时静默冒充 AI 结果。
5. **保留现有展示骨架。** Marquee、StackedCards 和三种皮肤继续由校验后的数据驱动；不得接受模型生成的 HTML/CSS/JS。PRD 的“原文顺序与拖拽顺序”在 P1 增加显式 section/item order 并由渲染器消费，不靠数组偶然顺序。

解析输出的 `mappedDesignModule` 只允许以下对应关系，参考字段缺失不影响匹配：

| 简历模块 | 网站模块 |
| --- | --- |
| 基本信息 | 首屏个人名片 |
| 求职意向 | 求职意向条 |
| 自我评价 | 个人简介卡 |
| 教育背景 | 教育时间线 |
| 实习/工作经历 | 工作经历时间线 |
| 项目经历 | 项目卡片墙（StackedCards） |
| 荣誉奖项 | 奖项徽章墙 |
| 校园经历 | 校园经历时间线 |
| 专业技能 | 技能标签组（可用 Marquee 突出） |
| 其他 | 自由内容卡 |

## 当前缺口与阶段归属

| PRD 要求 | 当前实现 | 阶段 |
| --- | --- | --- |
| 10 MB、20 页、MIME/加密/无文字校验，`fileId` 上传与重试 | 浏览器 `pdfjs-dist` 提取全文；主要检查扩展名，无服务端 PDF 接口 | P0 |
| 带坐标、字号、粗体、阅读顺序的文本块 | `normalizePdfTextItems` 最终只给字符串和页数组，丢弃块级证据 | P0 |
| Agent 语义分类、网站模块映射、四类经历拆条 | `resume.parse.v3` 是浏览器规则；Python 仅有 `resume.compose.v2`，负责复制已确认内容 | P0 |
| 解析任务状态、取消、60 秒超时、可读取草稿 | 当前队列只处理 `python-agent-v2` 生成任务；无 `/api/resumes/*` | P0 |
| 10 模块确认、低置信度、稳定条目和来源块 | 10 组确认已有；候选为平铺文本、页码和摘录，内存状态无法刷新恢复 | P0 |
| 条目级文字/链接/图片、重排、拆合、重新解析、自动保存 | 生成后的项目图片/单链接编辑已有；确认页无这些能力 | P1 |
| 作品页按原文/用户顺序渲染，图片随条目 | 作品页按固定代码顺序渲染；`DesignConfigV1` 缺通用顺序和条目补充合同 | P1 |
| OCR、最近 10 版历史、断网恢复 | 均未实现 | P1 |
| `/upload`、`/editor/:id` 等三页路由及完整响应式/样例 | 当前主要是 `/` 上的 `App` 阶段状态 | P0 路由骨架，P2 完整体验 |

## Global Constraints

- 上传仅 PDF，单份 ≤10 MB、1–20 页；本计划按 10 MB = 10,000,000 字节、5 MB = 5,000,000 字节实现边界；加密和无可提取文字的 PDF 使用 PRD 2.7 错误码。
- 每个草稿归匿名会话所有，写操作保持 CSRF；Agent 私有接口同时核对服务令牌、任务 ID 与有效租约。
- 私有 PDF、文本块和未确认草稿不得进入生成 brief、生成 checkpoint、支付库记录、日志、分享/导出包或公开配置。
- 原始 PDF 至少保留到用户完成核对编辑；编辑页刷新后仍需能预览原文，P1 的重新解析也依赖原文件。P0 要与产品隐私文案一起定稿更长期限及到期提示；用户删除或到期清理时覆盖文件、来源块、草稿、解析任务和关联补充资产，已核实支付事实按现有规则保留。
- `confidence >= 0.8` 可直接拆条；`0.5 <= confidence < 0.8` 保留原条目并建议拆分；更低置信度只标记待确认。缺字段不是禁止映射或拆条的条件。
- 输出仅允许已声明的 10 种模块，无法判断的内容归入“其他”；确认页可以为空，生成网页不渲染空/隐藏模块。
- 变更合同/Skill/工作流时同步更新 TS/Python 校验、Schema、黄金样例及版本；保持旧已发布作品可读取。
- 测试只提交合成简历和假模型输出；真实简历及密钥不得提交或写入日志。

## Review Focus

- 双栏简历的左侧技能与右侧项目不得因坐标排序而串段；Task 2 的版面夹具覆盖。
- PDF 中的“忽略之前指令”等提示注入不得改变工具能力或生成伪造事实；Task 4 覆盖。
- 两段经历缺公司/时间时仍能分条，且中置信度不会自动拆；Task 4 覆盖。
- 取消与超时后，旧租约写回不得覆盖新的解析结果；Task 3 覆盖。
- 重解析、排序、删除后补充内容仍跟随 `itemId`，来源引用不进入公开作品；Task 6–8 覆盖。

## P0 真正 Agent 解析的最小闭环

**验收门槛：** 文本 PDF 经 `/upload` → Agent 解析 → `/editor/:resumeId` 核对 → 现有风格/生成链路；10 个模块全部可见，有内容才填入；四类多条目分条，工作与校园分开；状态/错误/取消/重试/删除可用。刷新后可读回草稿并预览原 PDF，生成 brief 不含原始材料。P0 不宣称 OCR、图片补充或完整自动保存已完成。

### Task 1: 隐私决策、源数据和草稿合同

**Files:** 修改 `AGENTS.md`、`docs/shared/product.md`、`docs/shared/architecture.md`；新增 `packages/contracts/src/resume-source.ts`、`packages/contracts/src/resume-draft.ts` 与同名 JSON Schema；修改 `apps/agent/src/buildurprofile_agent/contracts.py`、`apps/agent/tests/test_contract_schema.py`。

**Interfaces:** `ResumeSourceV1` 只在解析服务和 Agent 之间流转；`ResumeDraftV1.sections: ResumeSection[]` 中 10 个系统模块都有稳定 ID、`mappedDesignModule`、顺序与空状态；条目具有 `itemId/sourceBlockIds/segmentationConfidence/needsReview`。明确用户补充文本与 PDF 来源文本分栏，不要求补充内容“必须存在于 PDF”。

- [ ] 写失败测试：10 模块、缺失参考字段仍可映射、来源块 ID 必须有效、生成 brief 拒绝 `sourceBlockIds`；运行 `npm test`、`npm run test:agent` 中对应定向用例，确认失败原因。
- [ ] 定稿服务端保留/删除期限、AI 供应商披露与同意文案，修订当前浏览器专有隐私规则；添加 TS/Python/Schema 合同及迁移说明。
- [ ] 跑定向测试与 `git diff --check`；提交合同和文档。

### Task 2: PDF 上传、私有存储与版面块提取

**Files:** 新增 `packages/storage/src/resumes/{files,repository}.mjs`、`apps/web/src/server/routes/resumes.mjs`、`apps/agent/src/buildurprofile_agent/skills/pdf_layout.py`；修改 `packages/storage/src/database.mjs`、`apps/web/src/server/http.mjs`、`apps/web/src/server/runtime.mjs`、`apps/agent/pyproject.toml` 和锁文件；测试放在 `apps/launcher/src/resumes.test.mjs`、`apps/agent/tests/test_pdf_layout.py`。

**Interfaces:** `POST /api/resumes/upload` → `{fileId,fileName,size,pageCount}`；`GET /api/resumes/:id/source` 经会话所有权校验，以不可公开缓存的 PDF 响应供编辑页预览；私有 `GET /_internal/agent/resume-tasks/:id/source` 仅返回当前租约的 PDF 字节；版面提取返回 `ResumeSourceV1`，保留稳定 `blockId`、页码、坐标、字号、粗体、阅读顺序。

- [ ] 写失败测试：伪 MIME、扩展名伪装、10 MB 边界、0/21 页、加密、扫描件、双栏、跨页、文件名不泄露、跨会话读取、解析完成后仍可预览及删除后无法读取；确认测试先红。
- [ ] 实现有界流式接收/解析，避免当前 `dispatchWebRequest` 将大请求无界转 JSON；文件存私有目录，按会话隔离，清理异常上传残留；解析完成不删除原 PDF，编辑页使用受会话保护的预览接口；Agent 通过受租约保护的接口取源，不直接读支付库。
- [ ] 跑定向测试和 `npm run test:payment`；提交。

### Task 3: 独立解析任务队列与浏览器状态协议

**Files:** 新增 `packages/storage/src/resumes/queue.mjs`、`apps/web/src/server/routes/internal-resume-agent.mjs`、`apps/web/src/lib/resumeApi.ts`；修改 `apps/web/src/server/http.mjs`、`apps/web/src/server/routes/internal-agent.mjs`、`apps/agent/src/buildurprofile_agent/transport/node_api.py`、`apps/agent/src/buildurprofile_agent/worker.py`；测试 `apps/launcher/src/resumes.test.mjs`、`apps/agent/tests/test_node_bridge.py`。

**Interfaces:** `POST /api/resumes/parse {fileId}` → `{resumeId,status:"parsing"}`；`GET /api/resumes/:id/status` → `{status,progress,stage,errorCode}`；`POST /api/resumes/:id/cancel`、`DELETE /api/resumes/:id`。解析任务有独立 `workflow_version`、幂等键、租约、取消和有限重试；Agent 回写只接受当前租约。

- [ ] 写失败测试：会话/CSRF、按会话限流与 `RATE_LIMITED`、重复解析幂等、60 秒前端超时、取消与租约竞争、失败后复用 `fileId`、旧任务不能写新草稿；确认先红。
- [ ] 加解析队列和私有协议，不改变现有生成队列的 `python-agent-v2` 入队/响应；前端每 1.5 秒轮询并显示 PRD 2.7 错误码。
- [ ] 跑定向测试、`npm run test:payment`、`npm run test:agent`；提交。

### Task 4: LangGraph 语义分类、模块映射和拆条

**Files:** 新增 `apps/agent/src/buildurprofile_agent/graphs/resume_parse.py`、`apps/agent/src/buildurprofile_agent/skills/{section_classifier,item_splitter}.py`、`apps/agent/src/buildurprofile_agent/providers/text_model.py`；修改 `apps/agent/src/buildurprofile_agent/skills/registry.py`、`apps/agent/src/buildurprofile_agent/worker.py`、`apps/agent/.env.example`、`docs/agent/README.md`；测试 `apps/agent/tests/test_resume_parse.py`，增加合成黄金夹具到 `packages/contracts/fixtures/`。

**Interfaces:** 解析子图顺序为 `validate_source → extract_layout → classify_sections → map_design_modules → split_items → verify_evidence → complete_draft`。模型适配器接收限定块和受校验的输出 Schema；Skills `resume.sections.v1`、`resume.map.v1`、`resume.items.v1` 版本固定。`complete_draft` 只提交 `ResumeDraftV1`，graph checkpoint 只放任务 ID、源/草稿引用和节点状态，不放 PDF 全文。

- [ ] 写失败测试：不规范标题、教育/工作/校园/项目混排、四类拆条、无时间的独立经历、参考字段为空、其他兜底、0.8/0.5 阈值、重复/漏块、模型非法 JSON、提示注入；确认先红。
- [ ] 用标题词典和版面做候选，再由 LLM 判断模块语义与独立经历；逐块来源校验，低置信度保留原段并给建议；模型不可用时返回 `PARSE_FAILED`，不伪称成功。
- [ ] 跑 Agent 定向测试与 `npm run test:agent`；提交。

### Task 5: 三页路由骨架、10 模块核对与确认投影

**Files:** 新增 `apps/web/src/app/upload/page.tsx`、`apps/web/src/app/editor/[resumeId]/page.tsx`、`apps/web/src/components/resume/{UploadStep,ResumeEditor}.tsx`、`apps/web/src/lib/resumeProjection.ts`；修改 `apps/web/src/app/page.tsx`、`apps/web/src/app/api/[[...slug]]/route.ts`（增加 PATCH）、`apps/web/src/App.tsx`、`apps/web/src/components/BuilderExperience.tsx`、`apps/web/src/server/routes/resumes.mjs`；测试 `apps/web/src/App.test.tsx`、`apps/web/src/lib/resumeProjection.test.ts`、`apps/launcher/src/resumes.test.mjs`。

**Interfaces:** `GET /api/resumes/:id` 读取私有草稿；`PATCH /api/resumes/:id` 保存确认修改并以 revision 防止覆盖；`projectConfirmedResume(draft: ResumeDraftV1): ResumeContent` 只输出可见且经用户确认的字段，删除所有 `sourceBlockIds`、置信度和 PDF 证据。

- [ ] 写失败测试：10 个模块始终显示、空模块允许新增、低置信度提示、工作/校园独立、刷新恢复及原 PDF 预览、AI 未识别姓名时仍可手动补全、缺姓名或邮箱/电话不能下一步、确认内容与来源剥离；确认先红。
- [ ] 将上传和编辑从单页内存 phase 接到 `/upload`、`/editor/:resumeId`；显示上传百分比，解析成功使用 `router.replace`，编辑页通过浏览器 PDF 查看器读取受保护的源文件并与字段核对并排展示，下一步成功后进入现有风格/生成流程（`/style/:resumeId` 可先作薄路由）。来源支持的 AI 候选与用户自填补充内容分别校验，不能复用旧 `followsSourceOrder` 阻止补充；保留旧已发布作品读取。
- [ ] 跑 `npm test`、`npm run build`、`npm run test:payment`、`npm run test:skills`、`npm run test:agent`；提交 P0 闭环。

## P1 可编辑内容和网站映射

**验收门槛：** PRD 3.4–3.6、3.9 的条目级补充、重排、拆合、重新解析、自动保存和稳定映射可用；扫描件可选择 OCR；用户确认/补充的内容进入作品，但 PDF 来源不进入作品。

### Task 6: 条目级编辑与补充资产

**Files:** 新增 `apps/web/src/components/resume/{SectionCard,ItemCard,SupplementEditor}.tsx`、`packages/storage/src/resumes/assets.mjs`；修改 `apps/web/src/server/routes/resumes.mjs`、`packages/contracts/src/resume-draft.ts`、`apps/web/src/lib/resumeProjection.ts`、`apps/web/src/components/EditorPanel.tsx`；测试对应 `*.test.tsx`、`apps/launcher/src/resumes.test.mjs`。

- [ ] 写失败测试：`itemId` 下文字 ≤500 字、链接 ≤5 条且仅 HTTP(S)、图片 JPG/PNG/WebP 单张 ≤5 MB 且 ≤6 张、caption ≤80 字；拆/合/移动/删除后补充内容不串项；确认先红。
- [ ] 实现四类经历和教育的条目卡、模块级/条目级共用补充组件、私有图片资产接口与二次确认删除；图片只以资产 ID 进入草稿，展示和导出前通过受控投影处理。
- [ ] 跑 `npm test`、`npm run test:payment`、`npm run build`；提交。

### Task 7: 自动保存、重解析合并与版本历史

**Files:** 新增 `apps/web/src/lib/resumeAutosave.ts`、`packages/storage/src/resumes/versions.mjs`；修改 `apps/web/src/components/resume/ResumeEditor.tsx`、`apps/web/src/server/routes/resumes.mjs`、`packages/storage/src/resumes/repository.mjs`；测试对应 Web/Node 用例。

- [ ] 写失败测试：800 ms 防抖、同一简历串行保存、冲突 revision、不成功离开提示、断网暂存、`overwrite` 与 `mergeEmpty`、重解析保留已编辑条目和 `itemId` 绑定、最近 10 版恢复；确认先红。
- [ ] 实现保存状态、IndexedDB 未保存变更和恢复、解析覆盖/补空的确定性合并规则，重解析通过既有私有源文件和新任务执行；版本只保存私有草稿，删除时一并清理。
- [ ] 跑 `npm test`、`npm run test:payment`、`npm run test:agent`；提交。

### Task 8: 按顺序生成网站并携带补充内容

**Files:** 修改 `packages/contracts/src/config.ts`、`packages/contracts/schema/{generation-brief,design-config}*.json`、`packages/contracts/src/validation.mjs`、`packages/storage/src/generation/brief.mjs`、`apps/agent/src/buildurprofile_agent/contracts.py`、`apps/agent/src/buildurprofile_agent/graph.py`、`apps/agent/src/buildurprofile_agent/skills/resume.py`、`apps/web/src/ShowcasePage.tsx`、`apps/web/src/server/export.mjs`；测试跨语言黄金样例、Showcase 和导出用例。

- [ ] 写失败测试：模块/条目原文顺序和拖拽顺序一致、隐藏/空模块不显示、工作/校园不混合、条目文字/链接/图片位置正确、旧 `DesignConfigV1` 仍可读取；确认先红。
- [ ] 增量版本化确认/展示合同与 `resume.compose`、生成工作流；在既有 Marquee + StackedCards 组件体系中由显式 order 渲染十模块；分享/导出快照只含确认与补充内容，不含来源块。
- [ ] 跑 `npm test`、`npm run build`、`npm run test:payment`、`npm run test:agent`；提交 P1 闭环。

### Task 9: OCR 分支与质量评估

**Files:** 新增 `apps/agent/src/buildurprofile_agent/skills/ocr.py`、`apps/agent/tests/test_ocr.py`、`docs/agent/resume-parsing-qa.md`；修改解析子图和 `apps/web/src/server/routes/resumes.mjs`。

- [ ] 写失败测试：扫描/混合 PDF 的 OCR 仅在用户选择后运行；页码/坐标来源可追溯；OCR 失败返回可恢复错误，明确区分模型错误；确认先红。
- [ ] 接入可替换 OCR 适配器并评估成本/隐私；用可提交合成样例和本机私有人工核对集测模块分类、拆条、漏项、误项与幻觉，记录按类别指标和回归门槛。
- [ ] 跑 `npm run test:agent`、`npm run test:payment`；提交。

## P2 三页体验完善

**验收门槛：** 页面 1–3 的导航、移动端、键盘和异常状态达到 PRD；草稿/解析质量有可回归的评估报告。

### Task 10: 启航、上传、编辑三页的完整交互

**Files:** 修改 `apps/web/src/app/page.tsx`、`apps/web/src/app/upload/page.tsx`、`apps/web/src/app/editor/[resumeId]/page.tsx`、`apps/web/src/components/resume/*`、`apps/web/src/styles.css`；测试 Web 组件和 Playwright 端到端流程。

- [ ] 写失败测试：首屏 CTA 在 1440×900/375×667 可见、样例新标签、拖拽/键盘上传、取消/重试、移动端固定操作条、焦点可见、空模块与保存失败提示；确认先红。
- [ ] 完成 PRD 页面文案与布局、`/samples`/`/privacy`/`/terms` 的可达路由及滚动/返回行为；按 PRD 检查移动端 Lighthouse ≥85。
- [ ] 跑 `npm test`、`npm run build`、端到端检查；提交 P2 闭环。

## P3 上线前可靠性与规模化（在 P0/P1 验收之后）

- [ ] 明确文本模型供应商的地区、数据处理和费用配置，用户可见告知与删除路径完整；建立不含 PII 的任务耗时/错误码指标和按会话成本控制。
- [ ] 对超时、供应商限流、重试、进程重启和文件清理做故障注入；验证孤儿文件与租约回收，防止重复计费与跨会话数据泄露。
- [ ] 单机先验证持久卷、恢复和备份；多主机部署前迁移共享队列、私有对象存储和 checkpoint，绝不跨主机共享 SQLite 文件。
- [ ] 真实公网验收按 `docs/shared/deployment.md`、`docs/api/payment.md` 与 Agent 资源许可门槛执行，不把解析能力上线等同于支付或肖像能力获准上线。

## 自检与依赖顺序

`Task 1 → 2 → 3 → 4 → 5` 是 P0 主链；Task 6、7、9 在 P0 之后可分开开发，但 Task 8 依赖 6、7 的最终合同；Task 10 依赖 P0 路由和解析结果。每项先有失败测试再实现，提交合成样例，不提交真实简历。验收时复查 PRD 2.3–2.9、3.3–3.11 的每个错误码、按钮和接口，以及项目 `AGENTS.md` 的数据边界。
