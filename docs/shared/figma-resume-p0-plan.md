# Figma 简历核对闭环 P0 Implementation Plan（已实施，待最终审查）

> **For agentic workers:** 实施时按任务逐项执行与复核；用户已授权开始开发。步骤用 `- [x]` 追踪。

**Goal:** 让已确认的简历条目补充文字、链接和图片安全进入生成、预览、项目、分享及导出，并使待核对进度和保存校验真正可用。  
**Architecture:** 保留 `resume-draft-v1` 私有草稿与原 PDF 对照，新增无来源的 `resume-v2` 展示合同。新 Agent 生成请求只传 `resumeId/revision/role/answers`，由服务端投影并复制已选图片到独立作品资产；Agent v3 透传受校验的内容，Web 与导出消费同一结构。  
**Tech Stack:** Next.js 16/React 19/TypeScript、Node SQLite、Python FastAPI/LangGraph/Pydantic、Vitest/Node test/Pytest。  
**Spec:** [figma-resume-p0-spec.md](figma-resume-p0-spec.md)。  
**审阅归属建议：** Noodle 负责合同与 Agent；Marshui 负责 Web、私有资产、分享/导出；跨端合同时双方共同复核。每次提交信息使用中文，变量和函数名使用英文。

## Global Constraints

- 原 PDF、来源块和私有草稿从上传起保留 30 天；用户可提前删除。编辑页保留受会话保护的原 PDF 预览和来源摘录。
- 图片单张最多 5 MiB、单条最多 6 张；全份简历最多 24 张、合计 50 MiB，本轮按此执行。链接只接受 HTTP(S)，每条最多 5 个。
- 只有已选、可见、已核对的内容能进新生成任务；PDF 字节、来源摘录、未选字段、密钥和图片字节不能进 checkpoint、日志、项目配置或生成 brief。
- `resume-v1` 旧项目、旧草稿、旧生成任务可读；新生成任务使用 `python-agent-v3` 与 `resume.compose.v3`。固定十模块、Marquee + StackedCards、三种皮肤和支付校验不变。
- 测试只用合成 PDF/图片与假模型。按 `AGENTS.md` 执行 `npm test`、`npm run build`、`npm run test:payment`、`npm run test:agent`；触及 Skills 时加 `npm run test:skills`。

## Review Focus

1. 同一条目中隐藏 fact 的值出现在补充文字或链接名称时，服务端拒绝投影或清空该字段；Task 1 的投影测试覆盖。
2. 旧草稿的链接只有 `url`、没有 `label` 时，读取和保存不丢失链接；Task 1/2 的兼容测试覆盖。
3. 生成请求与编辑页 revision 竞争，或图片来自另一简历/会话时，入队前拒绝且不复制字节；Task 3 的接口测试覆盖。
4. 分享快照引用旧项目版本的图片，在项目更新后仍能读到；撤销、过期、删除后立刻拒绝；Task 5 的交付测试覆盖。
5. 图片上传/保存/生成中断或并发重试时，不留下无限期孤儿资产，也不重复复制；Task 3/6 的生命周期测试覆盖。

## File Map 与依赖

| 任务 | 主要文件 | 可独立验收的产物 |
| --- | --- | --- |
| 1 合同与投影 | `packages/contracts/src/config.ts`、`resume-draft.ts`、`validation.mjs`、`packages/contracts/schema/*`、`packages/storage/src/generation/brief.mjs`、`apps/agent/src/buildurprofile_agent/contracts.py` | `resume-v2`、严格投影和跨语言样例 |
| 2 核对编辑 | `apps/web/src/components/AgentEditor.tsx`、`apps/web/src/app/editor/[resumeId]/page.tsx`、`packages/contracts/schema/resume-draft.v1.json` | 进度闭环、有效保存、原 PDF 保留 |
| 3 服务端图片生命周期 | `packages/storage/src/database.mjs`、`packages/storage/src/resumes/queue.mjs`、新 `packages/storage/src/generation/resume-media.mjs`、`apps/web/src/server/routes/generations.mjs`、`apps/web/src/server/http.mjs` | 归属校验、复制、回收、私有读取 |
| 4 Agent v3 | `packages/storage/src/generation/queue.mjs`、`apps/agent/src/buildurprofile_agent/{contracts.py,graph.py,__init__.py}`、`apps/agent/src/buildurprofile_agent/skills/{registry.py,resume.py}` | v3 图、Skill、旧 v2 任务兼容 |
| 5 作品和交付 | `apps/web/src/{App.tsx,ShowcasePage.tsx}`、`apps/web/src/server/{service.mjs,http.mjs,export.mjs}` | 预览、项目、分享、导出内容一致 |
| 6 集成与文档 | `apps/launcher/src/*.test.mjs`、`docs/{web,api,agent,shared}/*` | 合成闭环和无敏感数据验收 |

**依赖顺序：** 1 → 2/3 → 4 → 5 → 6。Task 2 和 3 可分别开发，Task 4/5 必须使用 Task 1 的合同形状。本轮使用 Spec 中 24 张/50 MiB 上限。

---

### Task 1：`resume-v2` 合同、确认投影与黄金样例

**Files**
- Modify: `packages/contracts/src/config.ts`、`resume-draft.ts`、`validation.mjs`、`packages/contracts/schema/resume-draft.v1.json`、`packages/storage/src/generation/brief.mjs`
- Create: `packages/contracts/fixtures/resume-enrichment.v2.json`
- Modify: `apps/agent/src/buildurprofile_agent/contracts.py`、`scripts/export-agent-schemas.py`
- Test: `apps/web/src/lib/resumeDraft.test.ts`、`apps/agent/tests/test_contract_schema.py`

**Interfaces**
- `projectConfirmedResume(draft: ResumeDraftV1): ResumeContent`：当草稿来自新 Agent 路径时输出 `resume.version === "resume-v2"`；保留 `profile/projects/...` 兼容字段。
- `StructuredResumeV2.sections[]`：`{kind,items:[{itemId,title,details,facts,supplement:{text,links:[{label,url}],images:[{imageId,caption}]}}]}`。只含可见、已选条目；没有 PDF 来源字段。`cleanStructuredResume` 同时接受 v1 和 v2，严格拒绝额外属性。
- `GenerationBriefV2` / `DesignConfigV2` 的新 Schema 由 Python 模型导出；旧 v1 Schema 文件保持可读，不原地改写旧版本语义。

- [x] **Step 1：先写失败测试。** 用合成草稿断言：十模块投影、条目顺序、基本/求职事实逐字段选择、补充文字/命名链接/图片说明与 ID 存在；隐藏模块和未选条目完全不出现；`sourceBlockIds`、`confidence`、PDF 摘录完全不出现；隐藏 fact 的值若在补充文字、链接名称或 URL 中出现则拒绝；旧 `resume-v1` 和无 `label` 链接仍可读；表情符号按 Unicode 码点计数；超过 256 KiB 的确认内容给出明确错误且草稿不被截断。
- [x] **Step 2：运行定向测试确认先失败。** `npm test -- apps/web/src/lib/resumeDraft.test.ts` 与 `npm run test:agent`；预期新增断言失败，旧测试继续通过。
- [x] **Step 3：实现类型、白名单、投影和 Pydantic v2 模型。** `links.label` 读取缺省为空；URL 使用 `new URL()` 并限定 `http:`/`https:`，不允许凭正则前缀放行。`itemId` 全局唯一。更新 Schema 导出脚本和合成黄金样例。
- [x] **Step 4：运行定向测试和 Schema 检查。** 上述命令及 `git diff --check` 全通过，审查 Schema 只包含预定字段。
- [x] **Step 5：提交。** 中文提交信息建议：`定义简历补充内容展示合同`。

### Task 2：编辑页确认进度和可保存输入

**Files**
- Modify: `apps/web/src/components/AgentEditor.tsx`、`apps/web/src/app/editor/[resumeId]/page.tsx`、`apps/web/src/styles.css`
- Test: `apps/web/src/app/editor/[resumeId]/page.test.tsx`

**Interfaces**
- 条目操作 `onConfirmReview()` 将该条 `needsReview` 改为 `false`，不改 `confidence`；隐藏待核对模块时弹窗明确确认，并在保存草稿中记录选择。
- 新增链接本地行可为空；`save()` 在调用 `resumeApi.save` 前归一化完全空行，其他无效行就近报错。`uploadSupplementImage` 在第 6 张及全局上限前停止。

- [x] **Step 1：先写失败测试。** 断言待核对模块从 9/10 经「已核对」变成 10/10，保存/刷新后保持；仍待核对时确认按钮不导航并定位首项；隐藏待核对模块需确认；低置信度提示依旧可见；空链接保存成功，有名无 URL 或 `javascript:` 链接不发 PATCH；第 6 张后不能再上传；原 PDF iframe 和来源摘录持续存在。
- [x] **Step 2：运行 `npm test -- apps/web/src/app/editor/'[resumeId]'/page.test.tsx`，确认新增用例先失败。**
- [x] **Step 3：实现编辑状态、局部校验和行动反馈。** 上传失败、保存失败保留本地修改；显式保存沿用 revision 冲突提示，不加入自动保存。图片上传并发时由服务端继续兜底；输入计数与服务端限制一致。
- [x] **Step 4：运行定向测试、`npm test`、`npm run build`。** 预期全通过。
- [x] **Step 5：提交。** 中文提交信息建议：`完善简历核对进度与补充内容校验`。

### Task 3：图片从简历私有区进入作品资产

**Files**
- Modify: `packages/storage/src/database.mjs`、`packages/storage/src/resumes/queue.mjs`、`apps/web/src/server/routes/generations.mjs`、`apps/web/src/server/http.mjs`
- Create: `packages/storage/src/generation/resume-media.mjs`
- Test: `apps/launcher/src/resumes.test.mjs`、`apps/launcher/src/generations.test.mjs`

**Interfaces**
- 新 Agent 生成入口：`POST /api/generations` 的 `resumeId/revision/role/answers/idempotencyKey` 由服务端读取草稿并投影；旧 `brief` 路径继续兼容。revision 不匹配、待核对、跨会话或失效草稿返回明确 409/404，不入队。
- `materializeResumeImages(ownerSessionId, resumeId, generationId, imageIds)`：在同一事务内核对每个 ID 属于该简历、在当前已选投影中、未超数量/体积限制；复制到 `showcase_media`（ID 可保持不变）并建立任务引用。生成重复请求复用副本；不复制未选图片。
- `GET /api/showcase-media/:imageId` 供属主预览；`GET /api/shares/:token/media/:imageId` 由 Task 5 校验令牌、付款资格和分享快照引用后读取。两者均设置 `Cache-Control: no-store` 和 `nosniff`。禁止把字节经 JSON brief 传给 Agent。

- [x] **Step 1：先写失败接口测试。** 同会话有效图片可入队；跨会话/同会话另一简历图片、伪造 ID、旧 revision、待核对条目和无效图像字节均被拒绝且无残留；5 MiB、6 张/条、全局数量/体积边界；相同幂等键不重复复制；原简历删除后作品副本仍在，未挂项目副本到期清理。
- [x] **Step 2：运行 `node --test apps/launcher/src/resumes.test.mjs apps/launcher/src/generations.test.mjs`，确认新增用例先失败。**
- [x] **Step 3：添加数据库迁移和 `resume-media` 存储模块。** 新建 `showcase_media`、`generation_media`、`project_media` 表，保存图片字节、MIME、属主、任务/项目引用与创建时间；上传时用 `image-size` 核对真实格式及尺寸，避免只信任请求头。复制与任务入队使用同一事务；删除/过期清理使用有界批次。
- [x] **Step 4：改生成路由及队列调用。** 服务端投影而非接收浏览器自报 `content`；任务入队失败回滚媒体复制。旧浏览器路径不经过简历资产逻辑。
- [x] **Step 5：运行定向测试和 `npm run test:payment`。** 预期全通过。
- [x] **Step 6：提交。** 中文提交信息建议：`建立简历图片到作品资产的私有链路`。

### Task 4：生成图与 Skill v3

**Files**
- Modify: `packages/storage/src/generation/queue.mjs`、`apps/web/src/server/routes/internal-agent.mjs`
- Modify: `apps/agent/src/buildurprofile_agent/__init__.py`、`graph.py`、`contracts.py`、`skills/resume.py`、`skills/registry.py`、`worker.py`
- Modify: `packages/contracts/schema/generation-brief.v2.json`、`design-config.v2.json`、`packages/contracts/fixtures/agent-golden.v1.json`（保留旧样例，另加 v2 样例）
- Test: `apps/agent/tests/test_graph.py`、`test_contract_schema.py`、`apps/launcher/src/internal-agent.test.mjs`

**Interfaces**
- 新任务 `workflow_version = "python-agent-v3"`，Skill `resume.compose.v3`。它校验并复制 `resume-v2`，只引用图片 ID，不读图片字节；QA 校验所有已选补充信息仍在 config。
- v2 任务由保留的旧图/Worker 分支消费到完成或失败，不能被 v3 图误读；旧 `resume-v1` 项目与生成配置继续可读。

- [x] **Step 1：先写失败测试。** v3 brief 经 Python 严格模型通过并产出同顺序的 v3 config；PDF 字节/来源字段被拒绝；图片 ID 没有字节；`resume.compose.v3` 不改写用户补充文案；旧 v2 租约仍按原合同处理；v2/v3 混用返回版本错误。
- [x] **Step 2：运行 `npm run test:agent` 和 `npm run test:skills`，确认新增用例先失败。**
- [x] **Step 3：同步更新版本常量、Skill 注册、图分派、TS/Python Schema 和黄金样例。** 旧图分支仅供已有 v2 任务，若无法安全并存则部署前先 drain v2 队列并在发布检查中提供证据，不能静默丢弃。
- [x] **Step 4：运行 `npm run test:agent`、`npm run test:skills`、`npm run test:payment`。** 预期全通过。
- [x] **Step 5：提交。** 中文提交信息建议：`升级生成图以传递确认的简历补充内容`。

### Task 5：作品预览、分享与导出一致性

**Files**
- Modify: `apps/web/src/App.tsx`、`apps/web/src/lib/generationApi.ts`、`apps/web/src/ShowcasePage.tsx`
- Modify: `apps/web/src/server/service.mjs`、`http.mjs`、`export.mjs`、`packages/contracts/src/validation.mjs`
- Test: `apps/web/src/App.test.tsx`、新建 `apps/web/src/ShowcasePage.test.tsx`、`apps/web/src/lib/export.test.ts`、`apps/launcher/src/payment.test.mjs`

**Interfaces**
- `ShowcasePage` 通过可注入的 `resolveResumeImage(imageId)` 生成图片 URL：属主预览走会话接口，公开分享走有效令牌接口，导出走 ZIP 内相对路径。链接 `target="_blank" rel="noopener noreferrer"`，只渲染已校验 HTTP(S) 地址。
- 生成成功即以生成任务 ID 为幂等键创建同会话的免费项目并关联作品图片；`showResult` 读回该项目，刷新/重试不重复建项目，付款资格仍由服务端独立核实。项目创建/更新校验配置引用的作品图片；分享读取资产必须核对令牌、付款、有效期、撤销和项目状态；分享旧快照可读其当时的图片。项目删除后无其他有效引用的图片可清理。
- `buildStaticZip(config, mediaReader)` 输出 HTML 与 `assets/*` 图片文件；HTML 使用相对路径并渲染 v2 十模块/补充内容。旧 v1 配置继续走原样式及读取路径。

- [x] **Step 1：先写失败测试。** 用合成项目验证生成成功自动建立未付款项目且重试不重复；预览/分享/ZIP 中每条补充文字、命名链接、图片说明和图片顺序一致；工作/校园独立；隐藏/空项不出现；分享过期/撤销/未支付/删项目后图片 GET 为 404；项目更新后的旧分享快照保留旧图；旧 v1 配置照常显示。
- [x] **Step 2：运行 Web 定向测试与 `npm run test:payment`，确认新增用例先失败。**
- [x] **Step 3：实现作品渲染与服务端资产读取。** 保持现有固定骨架，兼容投影字段不与 `resume-v2.sections` 重复显示。使用独立作品资产，不从 `/api/resumes/:id/images` 构造分享 URL。
- [x] **Step 4：扩展 ZIP 构建为多文件，导出页面只引用包内图片。** 保留 HTML 转义、URL 安全校验与 CSP；校验 ZIP 内容不含 PDF 原文、私有路由和隐藏字段。
- [x] **Step 5：运行 `npm test`、`npm run build`、`npm run test:payment`。** 预期全通过。
- [x] **Step 6：提交。** 中文提交信息建议：`让简历补充内容贯通作品预览与交付`。

### Task 6：跨端验收、清理与文档

**Files**
- Modify: `apps/launcher/src/resumes.test.mjs`、`generations.test.mjs`、`payment.test.mjs`
- Modify: `docs/web/README.md`、`docs/api/README.md`、`docs/agent/README.md`、`docs/shared/architecture.md`、`docs/shared/product.md`、`docs/README.md`

- [x] **Step 1：加合成端到端测试。** 上传合成 PDF → 假 Agent 草稿 → 人工核对/补充 → 显式保存 → 服务端按 revision 投影 → v3 图 → 项目 → 付费资格模拟夹具下的分享/导出 → 删除简历 → 作品仍可读 → 撤销/删项目后图片不可读。支付事实仍仅由签名通知/查单产生，测试不手改数据库模拟实付。
- [x] **Step 2：跑全部规定检查。** `npm test`、`npm run build`、`npm run test:payment`、`npm run test:skills`、`npm run test:agent`、`git diff --check`；预期全通过。
- [x] **Step 3：更新正式说明并检查文档链接。** 说明新 v2 合同、30 天原件与独立作品资产的不同生命周期、图片全局上限、旧流程兼容和失败恢复；对照 Figma 的文案，避免宣称免费一键发布。
- [x] **Step 4：审查 `git status --short` 和 diff。** 只保留预期源码/文档/合成夹具；确认无 `.env`、真实简历、密钥、图片字节或 data 目录进入提交。
- [x] **Step 5：提交。** 中文提交信息建议：`完成简历补充内容跨端验收与文档`。

## 完成判定

六个任务及检查全部通过；用一个低置信度合成条目证明确认进度能归零，用一个含文字、命名链接和图片的合成项目证明预览、分享、导出一致。原 PDF 栏仍可对照，并在 30 天后失效；已保存作品不因此丢图。若真实供应商或支付沙箱没有可用凭据，明确标注其现场联调未验收，不把假模型或测试支付写成线上成功。


## 实施验证（2026-11-11）

- Web：194 个测试通过；TypeScript 与 Next.js 生产构建通过。
- 服务端：86 个测试通过，含合成 PDF 上传、草稿核对、v3 入队、签名测试付款通知、分享/导出及删除。
- Agent：57 个 Python 测试与 23 个 Node 协议/队列测试通过，包含真实 Node HTTP → Python v3 LangGraph → 免费项目的合成桥接。
- TS Skills：7 个测试通过；文档本地链接和 `git diff --check` 通过。
- Wibi 继续仅限本机非商业预览；带肖像任务不自动创建可付费交付项目。未使用真实供应商调用、真实付款或公网回调作为本轮验收。
- 合同、界面、存储和渲染互相依赖，因此先完成整体验证，再合并为一次可构建的实现提交；独立审查与最终修正另行记录。
