# P0 Agent 简历解析执行计划

**Spec:** [`../shared/resume-parsing-p0-spec.md`](../shared/resume-parsing-p0-spec.md)。本计划是 [`agent-resume-parsing-plan.md`](agent-resume-parsing-plan.md) 的 P0 可执行细化，范围只到人工核对后进入既有作品生成链路。

**交付判定：** 用户上传文本 PDF，Agent 真正调用文本模型完成语义分类和经历拆条；编辑页刷新后可预览原 PDF 和草稿；确认内容能进入既有生成图；删除/到期后私有源不可读；全套按 `AGENTS.md` 的测试通过。缺少真实模型密钥时以假模型完成端到端自动测试，明确记录真实供应商联调未验收。

**共同规则：** 每个任务先写能失败的合成样例测试，再实现，再跑定向测试。共享合同/私有协议/Skill 输出同步升级版本和黄金样例。任何真实简历、PDF 原文、模型响应、密钥不入 Git 和日志。现有 `dev/noodle` 分支是 Agent 工作分支；涉及 Web 行为的接口由 Marshui 复核后合并。

## 任务与依赖

| 顺序 | 任务 | 主负责人建议 | 交付的接口 |
| --- | --- | --- | --- |
| 1 | 共同合同和隐私规则 | Noodle + Marshui | `ResumeSourceV1`、`ResumeDraftV1`、30 天生命周期 |
| 2 | 文件存储、PDF 上传和预览 | Marshui | `fileId`、属主预览、过期/删除 |
| 3 | 解析任务队列和私有协议 | Marshui + Noodle | `resumeId`、lease、status、草稿提交 |
| 4 | Agent PDF 版面和文本模型 | Noodle | 来源块、分类和拆条的模型输出 |
| 5 | LangGraph 解析子图与 Worker 接入 | Noodle | `resume-parse-v1` 图执行并提交草稿 |
| 6 | Web 上传和十模块编辑 | Marshui | `/upload`、`/editor/:resumeId` |
| 7 | 确认投影与既有生成链路 | 共同 | 来源剥离的 `ResumeContent` |
| 8 | 集成、隐私和回归验收 | 共同 | 合成端到端证据、文档更新 |

## Task 1：合同、版本和数据边界

**文件：** `packages/contracts/src/resume-source.ts`、`resume-draft.ts`；`packages/contracts/schema/resume-source.v1.json`、`resume-draft.v1.json`；`apps/agent/src/buildurprofile_agent/contracts.py`；`AGENTS.md`、`docs/shared/product.md`、`docs/shared/architecture.md`；测试 `apps/web/src/lib/resumeDraft.test.ts` 和 `apps/agent/tests/test_contract_schema.py`。

- [ ] 添加失败测试：十模块完整且唯一、固定映射、`sourceBlockIds` 不存在即拒绝、user origin 可无来源、字段/数组超限、确认投影不能携带来源。运行 `npm test -- --run apps/web/src/lib/resumeDraft.test.ts` 与 Agent 定向测试；预期因合同未实现失败。
- [ ] 实现 TS 类型及运行时校验，导出 JSON Schema；Python Pydantic 模型与 Schema 样例同义。日期、ID、长度、`confidence∈[0,1]` 和固定映射严格校验。保留 `resume-candidate-v2` 与 `resume-v1` 读取。
- [ ] 更新隐私文档：浏览器上传后的原件、块和草稿可在受会话保护的服务端存 30 天；确认内容才进入生成；模型供应商仅接收必要块。运行定向测试、`npm run test:agent` 和 `git diff --check`；预期通过。

## Task 2：服务端 PDF 生命周期

**文件：** `packages/storage/src/database.mjs` 新 migration；`packages/storage/src/resumes/files.mjs`、`repository.mjs`；`apps/web/src/server/routes/resumes.mjs`、`http.mjs`、`runtime.mjs`；`apps/web/src/app/api/[[...slug]]/route.ts`；测试 `apps/launcher/src/resumes.test.mjs`。

- [ ] 添加失败测试：仅 PDF、魔数/MIME/扩展名、10,000,000 字节边界、1/20/21 页、加密、无可提取文字；原子写入和失败清理；跨会话预览 404；解析后预览仍在；30 天后与用户删除后文件、草稿均不可读。预期测试先失败。
- [ ] 增加 `resume_files`、`resumes`、`resume_blocks` 表及索引，`expires_at = uploaded_at + 30 天`。PDF 在独立私有目录随机命名，目录 `0700`、文件 `0600`；后台定时/请求前有界清理，不靠手工清空目录。源预览返回 `application/pdf; Cache-Control: no-store; X-Content-Type-Options: nosniff`。
- [ ] 为上传做专门的有界 Web Request/Node 桥接：先检查长度，再计数流式接收，不能经通用 `arrayBuffer()` 无上限读入。使用现有 `pdfjs-dist` 在 Web 端二次校验页数/加密/文字可提取性。上传只存一份 PDF；异常不留孤儿文件。运行 `node --test apps/launcher/src/resumes.test.mjs`、`npm run test:payment`；预期通过。

## Task 3：解析队列、会话 API 和 Agent 租约

**文件：** `packages/storage/src/resumes/queue.mjs`；`apps/web/src/server/routes/resumes.mjs`、`internal-resume-agent.mjs`、`http.mjs`、`runtime.mjs`；`apps/agent/src/buildurprofile_agent/transport/node_api.py`；测试 `apps/launcher/src/resumes.test.mjs`、`apps/agent/tests/test_node_bridge.py`。

- [ ] 添加失败测试：CSRF/属主隔离、重复 parse 幂等、幂等键复用内容冲突、会话限流、排队/运行中取消、超时前端显示、失败可复用 `fileId`、租约续期/重领、旧租约不能读源或提交草稿。预期失败。
- [ ] 加 `resume_parse_tasks` 表，独立 `resume-parse-v1` 队列；公开 `POST /api/resumes/parse`、status、cancel、delete、GET/PATCH draft；内部 lease/source/heartbeat/complete/fail/ack-cancel。完成时事务内校验草稿和来源块，再以当前租约提交。Agent 仅取本任务源，不接触支付数据。
- [ ] 状态和错误码按 spec；每 1.5 秒轮询由前端执行，60 秒等待超时只是 UI 超时，后端任务可取消/稍后恢复。运行 Node/Agent 定向测试和 `npm run test:payment`；预期通过。

## Task 4：PDF 版面块与模型适配器

**文件：** `apps/agent/pyproject.toml`、`apps/agent/uv.lock`；`apps/agent/src/buildurprofile_agent/skills/pdf_layout.py`、`section_classifier.py`、`item_splitter.py`；`apps/agent/src/buildurprofile_agent/providers/text_model.py`；`apps/agent/tests/test_pdf_layout.py`、`test_resume_parse.py`；`packages/contracts/fixtures/resume-parse-golden.v1.json`。

- [ ] 先写合成文本 PDF 与假模型测试：双栏、跨页、标题缺失、学校与公司同页、工作/校园混排、四类多条、缺日期/参考字段、提示注入、重复/漏块、非法 JSON。预期失败。
- [ ] 使用版面提取库产出稳定 `PdfBlock`；按列、页和阅读顺序分组，不仅按 Y 排序。模型适配器只发必要块，明确供应商/模型环境变量，无配置返回 `PARSE_FAILED`。固定 Schema 结构化输出；技能 ID `resume.sections.v1`、`resume.items.v1`，映射为确定性节点。不得向模型授予 shell、支付、DB 或任意 URL 能力。
- [ ] 校验源块存在、每个非空块被分配或进入 Other、事实有证据；分类与拆分置信度分开。高置信度自动拆，中低置信度保留原段。运行 `npm run test:agent`；预期通过。

## Task 5：LangGraph 子图和 Worker 路由

**文件：** `apps/agent/src/buildurprofile_agent/graphs/resume_parse.py`、`worker.py`、`server.py`、`transport/node_api.py`、`skills/registry.py`；`apps/agent/tests/test_resume_parse_graph.py`、`test_node_bridge.py`；`apps/agent/.env.example`。

- [ ] 添加失败测试：解析任务走七个节点并提交十模块草稿；模型失败产生 `PARSE_FAILED`；取消和租约丢失后不提交；checkpoint 不含 PDF 全文/模型提示/响应；无照片作品原生成图仍正常。预期失败。
- [ ] Worker 在独立队列取 `resume-parse-v1` 任务，图节点依 spec 执行；生成任务仍走 `python-agent-v2`。实际 PDF 与块仅在节点执行内存中传递，持久 checkpoint 只放 ID/阶段和有限元数据。更新 env 示例，密钥不进入前端。
- [ ] 运行 `npm run test:agent` 和 `npm run test:skills`；预期通过。

## Task 6：上传页、编辑页和 PDF 对照

**文件：** `apps/web/src/app/upload/page.tsx`、`app/editor/[resumeId]/page.tsx`、`app/style/[resumeId]/page.tsx`；`apps/web/src/components/resume/UploadStep.tsx`、`ResumeEditor.tsx`；`apps/web/src/lib/resumeApi.ts`；`apps/web/src/app/page.tsx`、`App.tsx`、`styles.css`；相关 Web 测试。

- [ ] 添加失败测试：百分比、文件错误、1.5 秒轮询与 60 秒等待、取消/重试、刷新恢复、十模块始终可见、空项手填、低置信度提示、工作/校园独立、受保护 PDF 原文并排预览、无姓名可编辑但不能继续。预期失败。
- [ ] 新上传流程走服务端 Agent；旧浏览器规则保留为明确标注的兼容入口或测试工具，不在模型失败时静默接管。编辑采用显式保存和 revision 冲突提示；800ms 自动保存是 P1。浏览器 PDF 查看器只访问会话接口，不创建公开可猜 URL。
- [ ] 运行 `npm test`、`npm run build`；预期通过。

## Task 7：确认投影、生成衔接和资料删除

**文件：** `apps/web/src/lib/resumeProjection.ts`、`App.tsx`、`components/BuilderExperience.tsx`、`server/routes/resumes.mjs`；`packages/storage/src/generation/brief.mjs`；Web/Node 测试。

- [ ] 添加失败测试：姓名及邮箱/电话门槛；用户手填的内容可确认；敏感字段默认不展示；空/隐藏模块不进展示；生成 brief 拒绝 `sourceBlockIds`、PDF 文本和路径；旧作品可读。预期失败。
- [ ] 投影为现有 `ResumeContent`/`resume-v1`；确认后进入测评和既有生成流程，不改变 `python-agent-v2` 生成语义。删除简历清理源、草稿和任务，不误删已独立生成的付费项目与支付事实。
- [ ] 运行 `npm test`、`npm run test:payment`、`npm run build`；预期通过。

## Task 8：端到端、文档和发布前检查

**文件：** `apps/launcher/src/resumes.test.mjs`、`apps/agent/tests/test_node_bridge.py`、`docs/web/README.md`、`docs/agent/README.md`、`docs/shared/architecture.md`、`docs/shared/deployment.md`、`docs/README.md`。

- [ ] 用合成 PDF 和假模型走上传 → 租约 → 七节点 → 草稿 → 原文预览 → 修改 → 生成 brief → 删除；验证重启后草稿仍在、到期清理、跨会话 404、取消后旧租约 409。
- [ ] 核对开发/生产 env 清单、30 天告知、私有目录持久卷、反向代理禁止内部路径、无敏感日志；加入运行和故障排查说明。真实模型凭据缺失时记录“供应商实时联调待完成”，不把模拟测试写成线上验收。
- [ ] 跑 `npm test`、`npm run build`、`npm run test:payment`、`npm run test:skills`、`npm run test:agent`、`git diff --check`；预期全部通过。检查 `git status --short` 仅有预期文件。

## 交接和验收顺序

Task 1 的合同是 Task 2–7 的唯一形状来源；Task 2/3 的私有 API 由 Marshui 端给 Noodle 假服务，Task 4/5 的假模型草稿由 Noodle 给 Marshui 前端夹具。两端各自定向测试通过后再做 Task 8。任何阶段发现合同需要增字段，先同步 Schema、TS/Python 校验和黄金样例，再改调用方；不要让浏览器候选合同混入新的私有草稿或生成 brief。
