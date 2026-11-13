# 简历编辑与重解析 P1 Implementation Plan（审阅稿）

> **For agentic workers:** 实施前阅读 [Spec](figma-resume-p1-spec.md) 和当前合同。审批后使用 superpowers:executing-plans 或 superpowers:subagent-driven-development 逐任务执行；下列步骤以 `- [ ]` 跟踪。本文件尚未授权实施。

**Goal:** 让用户安全地排序、拆合、自动保存、恢复和重新解析简历，并在主动选择后处理扫描页 OCR。

**Architecture:** P1a 升级私有草稿和公开有序展示合同；P1b 在现有会话/队列上加入版本与重解析候选，再接自动保存；P1c 为解析图增加仅本机 OCR 分支。每段都保持旧项目和任务可读。

**Tech Stack:** Next.js/React/TypeScript、Node SQLite、Python FastAPI/LangGraph、IndexedDB、PDFium/Tesseract OCR；具体依赖版本在实施时锁定。
**Spec:** [figma-resume-p1-spec.md](figma-resume-p1-spec.md)。

**执行顺序：** Task 1 → Task 2 → Task 5（完成 P1a）→ Task 3 → Task 4（完成 P1b）→ Task 6（完成 P1c）；每段可独立验收。Task 5 的跨语言合同须先于自动保存和重解析发布。

## Global Constraints

- 原 PDF、来源块、草稿、历史和未保存本地副本均不超过上传起 30 天；用户可提前删除。作品图片按独立作品生命周期保留。
- 十个系统模块仍存在且不能删除；真正自定义第十一个模块不在本轮，用户可在“其他内容”建自命名条目。
- 图片单张 5 MiB、每条 6 张、整份 24 张/50 MiB；补充文字 500 字、HTTP(S) 链接每条 5 个。
- 新版本只投影已确认、可见、已选的内容；PDF、来源块、OCR 坐标、历史、未选事实、密钥不进入生成或分享。写接口保持会话、CSRF 和 revision 校验；内部任务保持令牌与租约校验。
- 旧 `resume-v1/v2` 项目、`resume-draft-v1` 草稿和已有 Agent 任务可读；新生成工作流和 Skill 版本同步升级。所有 commit 信息使用简体中文，标识符保留英文。

## Review Focus

1. 拆分含多张图片的条目时，不复制图片引用到第二条；合并超过单条 6 张时禁止提交并保留两条原样。（Task 2）
2. 两标签页同时编辑或自动保存回包乱序时，旧 revision 不覆盖新内容；冲突时保留可恢复的本地编辑。（Task 3）
3. 重解析期间继续编辑或原 PDF 到期时，不写入过期候选；失败/取消不动旧草稿。（Task 4）
4. 恢复历史版本引用已回收的图片时，拒绝恢复并给出可处理提示，不产出悬空展示资产。（Task 3）
5. 混合 PDF 中 OCR 和原文本重复、OCR 超时或缺语言包时，不假报解析成功；低置信度候选待核对。（Task 6）

## File Map 与依赖

| 责任 | 文件 |
| --- | --- |
| 私有编辑合同和兼容规范化 | `packages/contracts/src/resume-draft.ts`、`packages/contracts/schema/resume-draft.v2.json`、`packages/contracts/schema/resume-source.v2.json`、`apps/agent/src/buildurprofile_agent/contracts.py` |
| 有序展示合同与跨语言黄金样例 | `packages/contracts/src/resume-v3.mjs`、`packages/contracts/src/config.ts`、`packages/contracts/schema/design-config.v3.json`、`packages/contracts/schema/generation-brief.v3.json`、`packages/contracts/fixtures/agent-golden.v3.json` |
| 编辑操作与界面 | `apps/web/src/app/editor/[resumeId]/page.tsx`、`apps/web/src/components/AgentEditor.tsx`、`apps/web/src/lib/resumeEdit.ts` |
| 版本/候选/图片引用 | `packages/storage/src/database.mjs`、`packages/storage/src/resumes/queue.mjs`、`packages/storage/src/resumes/versions.mjs`、`packages/storage/src/resumes/candidates.mjs`、`apps/web/src/server/routes/resumes.mjs` |
| 自动保存与本地恢复 | `apps/web/src/lib/resumeAutosave.ts`、`apps/web/src/lib/resumeLocalDraft.ts`、`apps/web/src/lib/resumeApi.ts` |
| Agent OCR 和生成版本 | `apps/agent/src/buildurprofile_agent/skills/ocr.py`、`apps/agent/src/buildurprofile_agent/graphs/resume_parse.py`、`apps/agent/src/buildurprofile_agent/graph.py`、`apps/agent/src/buildurprofile_agent/skills/resume.py` |
| 作品与导出 | `apps/web/src/ShowcasePage.tsx`、`apps/web/src/components/EditorPanel.tsx`、`apps/web/src/server/export.mjs` |

### Task 1：版本化草稿、顺序与编辑来源（P1a）

**Interfaces:** `normalizeResumeDraft(raw)` 读取 v1/v2 并返回 v2；`validateResumeDraftV2(draft, source)` 校验十模块唯一、order 连续、itemId 唯一、来源合法及用户编辑标记。新草稿和旧草稿的写入都使用规范化后的 v2，已有任务按其版本完成。

- [ ] 在 `apps/web/src/lib/resumeDraft.test.ts` 和 `apps/agent/tests/test_contract_schema.py` 写失败测试：乱序十模块可规范化；重复 order/ID、伪造来源、缺失旧字段有明确处理；用户改动字段被标记，纯排序不把内容误判为已编辑。
- [ ] 运行定向 Web/Agent 测试确认新增断言先失败。
- [ ] 添加私有 v2 Schema、规范化和 Pydantic 对照；迁移读取只补默认值，不修改旧草稿的展示内容；保存时仍校验会话和 revision。
- [ ] 运行定向测试及 Schema 黄金样例，确认通过；用中文提交本任务。

### Task 2：排序和人工拆合界面（P1a）

**Interfaces:** `splitResumeItem(draft, kind, itemId, boundary)` 和 `mergeResumeItems(draft, kind, firstId, secondId, assetChoice)` 返回新草稿或可展示的限制错误；模块和条目顺序由同一 `order` 字段保存。

- [ ] 在 `apps/web/src/app/editor/[resumeId]/page.test.tsx` 与新 `resumeEdit.test.ts` 写失败测试：模块鼠标/键盘排序、条目拖拽与按钮同结果，拆分不按任意换行自动发生，第一段保留旧 ID/补充资产，第二段新 ID，合并超 6 图阻止且不丢数据。
- [ ] 运行定向测试确认失败。
- [ ] 抽取纯编辑操作；给四类经历增加拆/合确认与补充资产归属选择；为模块和条目加可访问的拖拽及键盘操作。保存继续经过服务端草稿校验。
- [ ] 运行 `npm test`、`npm run build`、`npm run test:payment`；中文提交。P1a 编辑操作此时可单独联调。

### Task 3：服务端历史、自动保存及断网恢复（P1b）

**Interfaces:** `GET /api/resumes/:id/versions`、`GET /api/resumes/:id/versions/:revision`、`POST /api/resumes/:id/restore`（body: `{expectedRevision,targetRevision}`）；`useResumeAutosave` 串行提交及重试；服务端在草稿读取时返回随机且不授予认证权限的 `cacheScope`；IndexedDB 按该值、resumeId 和基准 revision 分区，只存当前会话未保存的草稿差异。

- [ ] 在 `apps/launcher/src/resumes.test.mjs` 写失败测试：当前加最近 10 个前版本、恢复递增 revision、跨会话拒绝、过期/删除清理、图片被历史引用时禁止删除、历史裁剪后正确回收；在编辑页测试写 800 ms 防抖、立即图片/链接保存、乱序回包、断网缓存、跨会话缓存不可恢复、站内自定义挽留与刷新原生提示、冲突停止自动覆盖。
- [ ] 运行 Node/Web 定向测试确认失败。
- [ ] 增加迁移与 `versions.mjs`；保存和恢复同事务更新版本及草稿；修改 `queue.patch()`、`deleteImage()`、未保存图片列表和历史裁剪路径，使当前/历史引用阻止删除、无引用后再回收；接入按 `cacheScope` 分区的本地缓存、保存状态和两类离开提示。避免把 PDF/source 写入 IndexedDB。
- [ ] 运行 `npm test`、`npm run build`、`npm run test:payment`，验证删除和到期；中文提交。

### Task 4：原 PDF 重解析候选及覆盖/补空（P1b）

**Interfaces:** `POST /api/resumes/:id/reparse-candidates`（`{expectedRevision,mode,idempotencyKey}`，mode 为 `overwrite|fillEmpty`）创建原简历的私有候选任务；`GET /api/resumes/:id/reparse-candidates/:taskId` 查询状态与差异；`POST /api/resumes/:id/reparse-candidates/:taskId/apply` 以基准 revision 应用候选；`mergeEmptyDraft(current,candidate)` 只填未编辑空字段，按稳定来源块匹配条目。

- [ ] 在 `apps/launcher/src/resumes.test.mjs` 与编辑页测试写失败用例：覆盖、补空、已编辑字段保护、稳定 ID、未匹配新条目待核对、并发编辑冲突、失败/取消/到期不改旧草稿、幂等重试不重复应用。
- [ ] 运行定向测试确认失败。
- [ ] 复用私有 PDF 和解析图生成待应用候选，候选存于独立表/任务状态，绝不把当前简历状态改为 `QUEUED`；服务端事务内校验任务属主、租约结果、基准 revision 和图片引用，再写新历史版本；编辑页先保存、再选择模式、展示候选差异并确认。保留现有 `POST /api/resumes/:id/reparse` 的“新草稿副本”语义。
- [ ] 运行 Web/服务端/Agent 定向测试和 `npm run test:payment`；中文提交。P1b 此时可单独验收。

### Task 5：有序内容进入 Agent、作品和 ZIP（P1a 与 P1b 共用合同边界）

**Interfaces:** `projectConfirmedResumeV3(draft)` 输出有序 `resume-v3.sections/items`；新生成任务使用 `python-agent-v4` 与 `resume.compose.v4`，旧 v2/v3 任务保留分派；作品、项目编辑、分享快照和 ZIP 消费同一顺序。

- [ ] 在合同、`apps/web/src/ShowcasePage.test.tsx`、`apps/web/src/components/EditorPanel.test.tsx`、`apps/launcher/src/payment.test.mjs` 和 Python 图测试写失败用例：固定 Marquee 下的十模块按用户顺序展示，项目 StackedCards 出现在项目模块的指定位置，基本信息可排序，隐藏/空模块省略，工作校园独立，补充资产不串项，旧 v1/v2 项目保持原顺序和可读性。
- [ ] 运行定向测试确认失败。
- [ ] 新增 v3 公开 Schema/黄金样例和版本化投影，同步更新 brief/config、Node→Python 分派、Skill、QA、Web 与导出；不接受模型生成页面代码。
- [ ] 运行 `npm test`、`npm run build`、`npm run test:payment`、`npm run test:agent`、`npm run test:skills`；中文提交。Task 5 应随 P1a 一起发布，不能只发布可排序编辑器。

### Task 6：用户主动选择的本机 OCR（P1c）

**Interfaces:** `ocr_pdf_pages(pdf_bytes, pages, timeout_seconds)` 输出带页码/边框/阅读顺序/`ocr` 来源的私有块；初次失败时 `POST /api/resumes/parse` 可携带 `{fileId,idempotencyKey,ocrRequested:true}` 重试同一私有文件；已成功解析的混合 PDF 走 Task 4 的独立候选任务并携带 `ocrRequested`，当前草稿保持 `SUCCEEDED`。解析任务使用新工作流版本。原有文本页保持原提取路径。

- [ ] 用可提交的中英合成扫描 PDF 和混合 PDF 写失败测试：未选择 OCR 时仍返回 `PDF_NO_TEXT`；选择后只识别无文字页；文字重复消除、低置信度待核对、缺语言包/超时/取消的专用错误、无图像或来源字节进 checkpoint/日志。
- [ ] 运行 Agent/服务端定向测试确认失败。
- [ ] 锁定 PDFium 渲染和 Tesseract 中英文依赖，更新 `apps/agent/pyproject.toml`、锁文件、Dockerfile/Compose、部署说明；在队列中区分 OCR 与普通解析的幂等键及可重试状态，初次失败重试复用未过期 fileId；已成功解析的混合 PDF 使用独立 OCR 候选任务，不复用 `queue.parse()` 返回的成功旧任务；实现 OCR Skill 与原解析图分支，受既有大小、页数、租约及清理约束，前端明确告知本机处理及耗时。
- [ ] 运行 `npm run test:agent`、`npm run test:payment`、`npm test`、`npm run build`；构建 Web/Agent 镜像，验证 Compose 健康检查、持久卷和重启。中文提交。

## 总验收与审阅点

- [ ] 完整合成流程：文本型 PDF 和扫描型 PDF → 核对/排序/拆合 → 自动保存/断网恢复 → 历史恢复/重解析两模式 → v4 生成 → 免费项目 → 已签名测试支付后的分享/ZIP；比对顺序、内容和图片。
- [ ] 执行 AGENTS.md 所列全部适用检查，审查 Schema/黄金样例、文档本地链接、环境变量样例、忽略规则、`git diff --check` 与提交范围；不得提交真实简历、凭据或本地数据。
- [ ] 更新 `docs/web`、`docs/api`、`docs/agent`、`docs/shared` 的现行说明；阶段完成后把本 Spec/Plan 压缩归档。
- [ ] 发布前确认旧任务的版本分派、30 天清理与 OCR 目标环境可用；真实模型、付款和公网回调按独立上线验收执行。

**审阅时需要确定的产品取舍：** 本稿以“其他内容”的自命名条目承接自定义内容；OCR 采用用户主动选择的本机路径；重解析补空不覆盖用户编辑且冲突时停止。这些决定获批后再实施代码。
