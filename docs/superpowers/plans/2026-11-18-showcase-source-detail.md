# sourceText 两级内容（作品集详情展示 PDF 原文）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作品集卡片面显示 Agent 精炼总结，"查看项目详情/查看详情"展开显示 PDF 原文（新草稿字段 `sourceText`），全链路（解析→核对→生成→渲染→导出）打通。

**Architecture:** `sourceText` 是草稿条目的可选可编辑字段，Agent 从锚定 source blocks 逐字填充；服务端 allowlist 投影把它带入生成 config；渲染层在 `StackedCards` 与 `ResumeDisplay` 用统一降级规则（`sourceText` → `details` → 无展开）展示。TS 类型、8 份 JSON Schema、Python 合同镜像三端同步（`test_contract_schema.py` 强制相等）。

**Tech Stack:** TypeScript（contracts/Next.js）、Python（pydantic/LangGraph）、vitest + node:test + pytest。

**Spec:** [docs/superpowers/specs/2026-11-18-showcase-source-detail-design.md](../specs/2026-11-18-showcase-source-detail-design.md)（含全部口径决定，本计划不重复论证）

## Global Constraints

- 字段名一律 `sourceText`，可选 string，上限 **12000** 字符，三端（TS/Schema/Python）一致
- 错误文案逐字：投影脱敏 `"详情原文包含未勾选字段，请删改后再试。"`；合并超限 `"合并后的详情原文超过单条上限。"`
- 代码注释中文；commit 信息中文、**不得出现 Co-Authored-By**；用户批准本计划即授权按各任务 commit 步骤提交
- TDD：每个任务先写失败测试并运行确认失败，再实现
- 测试命令：vitest `npx vitest run <file> --config vitest.config.ts`；node:test `node --test <file>`；pytest `apps/agent/.venv/bin/python -m pytest <file> -v`（仓库根执行，需 `PYTHONUTF8=1`）
- 终验门槛（Task 7）：`npm test`、`npm run build`、`npm run test:payment`、`npm run test:agent` 全绿
- 本地联调时 Python 改动后须整体重启 dev（launcher 随机令牌只随三件套启动生成）

## Review Focus

1. **旧数据回归**：已存 v2/v3 config 与旧草稿（无 `sourceText` 键）经 `cleanResumeV2`/`cleanConfig`/渲染行为不变 → Task 2（cleanResumeV2 缺键接受 + 既有存量测试）、Task 6（旧 fixture 渲染断言）
2. **空白-only `sourceText`**（全空格/换行）视为空 → 展开降级 `details` → Task 6 加断言：`sourceText: "   \n"` 的卡片展开体显示 `description`
3. **256 KiB 包络**：`sourceText` 放大后超包络 → 沿用原文案 `"生成内容超过 256 KiB，请精简展示内容；草稿内容未被截断。"` 不截断 → Task 2 加投影层用例
4. **正式保存/分享不丢字段**：`cleanConfig` 白名单保留 `sourceText`（预览/导出/正式同源）→ Task 2（export.test.mjs）+ Task 7（导出 HTML 断言）
5. **跨页条目 reading order**：`sourceText` 按文档序拼接（先第 1 页块后第 2 页块）→ Task 3 加跨页用例

---

### Task 1: Python 合同镜像与 8 份 JSON Schema 同步

**Files:**
- Modify: `apps/agent/src/buildurprofile_agent/contracts.py`（ProjectCard ~L38、ResumeDraftItem ~L248、editedFields 正则 ~L311、ResumeDisplayItem ~L353）
- Modify: `packages/contracts/schema/resume-draft.v1.json`、`resume-draft.v2.json`、`design-config.v1.json`、`design-config.v2.json`、`design-config.v3.json`、`generation-brief.v1.json`、`generation-brief.v2.json`、`generation-brief.v3.json`
- Test: `apps/agent/tests/test_contract_schema.py`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: Python 三模型带 `sourceText: str | None = Field(default=None, max_length=12000)`；8 份 Schema 的 `DraftItem`/`ResumeDisplayItem`/`ResumeDisplayItemV3`/`ProjectCard` `$defs` 含可选 `sourceText` 条目；draft 校验器 editedFields 正则接受 `sourceText`。后续所有任务依赖此字段合法。

- [ ] **Step 1: 写失败测试**

在 `test_contract_schema.py` 追加 `test_source_text_optional_field_on_contracts`：
- 断言 `ResumeDraftItem`、`ResumeDisplayItem`、`ProjectCard` 三者 `model_json_schema()["properties"]` 含 `"sourceText"` 且各自 `required` 列表**不含**它
- 断言 `ResumeDraftV2` 校验含 `editedFields: ["sourceText"]` 的条目通过（用 fixture v1 转 v2 的现有构造方式，参照 `test_private_resume_draft_v2_schema_and_edit_markers` L92-98）

- [ ] **Step 2: 运行确认失败**

Run: `apps/agent/.venv/bin/python -m pytest apps/agent/tests/test_contract_schema.py -v`
Expected: 新测试 FAIL（properties 无 sourceText / editedFields 校验拒绝）

- [ ] **Step 3: 实现 Python 模型**

三个模型各加一行 `sourceText: str | None = Field(default=None, max_length=12000)`；`contracts.py:311` 正则 `(title|details|included|supplements|needsReview|fact:...)` 插入 `sourceText`。

- [ ] **Step 4: 同步 8 份 Schema 文件**

每份文件中引用受影响 `$defs`（Python 端 `model_json_schema()` 已变）：以 `apps/agent/.venv/bin/python -c "from buildurprofile_agent.contracts import <Model>; import json; print(json.dumps(<Model>.model_json_schema(), ensure_ascii=False, indent=2))"` 的实际输出为准，在对应 `$defs` 的 properties 里补 `sourceText` 条目（形态参照现有 `image`/`link` 可选字段：`anyOf: [{type: string, maxLength: 12000}, {type: null}] + default: null + title`，title 以实际输出为准），**不加进 required**。注意 `ResumeDraftItem` 基类同时进入 v1/v2 两份 draft schema，`ProjectCard` 进入全部 6 份 design-config/brief，`ResumeDisplayItem`/`ResumeDisplayItemV3` 进入 v2/v3 的 design-config 与 brief。

- [ ] **Step 5: 运行测试确认通过**

Run: `apps/agent/.venv/bin/python -m pytest apps/agent/tests/test_contract_schema.py -v`
Expected: 全部 PASS（含原有 4 个 schema 完全相等断言——它们校验的是 json 内容相等，键序无关）

- [ ] **Step 6: 跑 agent 全量 pytest 确认无连带破坏**

Run: `apps/agent/.venv/bin/python -m pytest apps/agent/tests -q`
Expected: PASS（fixtures 尚未加字段，可选字段不影响存量样例）

- [ ] **Step 7: Commit**

```bash
git add apps/agent/src/buildurprofile_agent/contracts.py packages/contracts/schema/
git commit -m "feat: 合同三端新增可选字段 sourceText（Python 模型与 8 份 JSON Schema 同步）"
```

### Task 2: TS 草稿/展示合同、投影、清理器与白名单

**Files:**
- Modify: `packages/contracts/src/resume-draft.ts`（类型 L12、editableField 正则 L18、投影 L84-92）
- Modify: `packages/contracts/src/config.ts`（ProjectCard L26-37、ResumeDisplayItem L67）
- Modify: `packages/contracts/src/resume-v2.mjs`（cleanResumeV2 L19-24、resumeItemHasContent L41-44、resumeDisplayContent L51）
- Modify: `packages/contracts/src/validation.mjs`（cleanConfig ProjectCard 白名单 L86-92）
- Modify: `packages/contracts/fixtures/resume-enrichment.v2.json`、`resume-enrichment.v3.json`、`agent-golden.v2.json`、`agent-golden.v3.json`
- Test: `apps/web/src/lib/resumeDraft.test.ts`、`apps/web/src/lib/resumeEnrichment.test.ts`、`apps/launcher/src/export.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 Schema（TS `validateSchema` 运行时读取 draft v1/v2 schema，新字段需先合法）
- Produces: `ResumeDraftItem.sourceText?: string`；`ResumeDisplayItem.sourceText?: string`；`ProjectCard.sourceText?: string`；投影输出条目恒含 `sourceText: string`（`basicInfo`/`jobIntent` 为 `''`，其余为 `item.sourceText ?? ''`）；`cleanResumeV2` 条目键集合 `['itemId','title','details','facts','supplement'] + 可选 sourceText`；`resumeItemHasContent` 计入 sourceText；`resumeDisplayContent` 的 `projects[]` 携带 `sourceText`；`cleanConfig` 保留非空 `ProjectCard.sourceText`。Task 4/5/6 消费这些类型与行为。

- [ ] **Step 1: 写投影层失败测试（resumeDraft.test.ts）**

用例（参照该文件现有投影测试的草稿构造方式）：
- `projectConfirmedResumeV3`：条目 `sourceText: "原文A"` → 输出对应 `resume` 条目 `sourceText === "原文A"`
- 条目 `sourceText` 含某未勾选（`included: false`）fact 的值 → throw，`expect(...).toThrow("详情原文包含未勾选字段，请删改后再试。")`
- v1 草稿（无字段）投影成功 → 条目 `sourceText === ''`
- `editedFields: ['sourceText']` 通过 `validateResumeDraftV2`
- 256 KiB 包络：多条目带长 `sourceText` 使包络超限 → throw `"生成内容超过 256 KiB，请精简展示内容；草稿内容未被截断。"`

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/web/src/lib/resumeDraft.test.ts --config vitest.config.ts`
Expected: FAIL（TS 类型报错或断言失败）

- [ ] **Step 3: 实现 resume-draft.ts 与 config.ts**

`ResumeDraftItem` 加 `sourceText?: string`；`editableField` 正则加 `sourceText`；投影 items map 里：非 basicInfo/jobIntent 条目先做隐藏值检查（`hidden.some(v => (i.sourceText ?? '').includes(v))` → throw 上面的文案），输出 `sourceText: ['basicInfo','jobIntent'].includes(kind) ? '' : (i.sourceText ?? '')`；`config.ts` 的 `ProjectCard` 加 `sourceText?: string`、`ResumeDisplayItem` 加 `sourceText?: string`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/web/src/lib/resumeDraft.test.ts --config vitest.config.ts`
Expected: PASS

- [ ] **Step 5: 写清理器失败测试（resumeEnrichment.test.ts）**

- `cleanResumeV2`：条目带 `sourceText` 通过且保留；缺键通过（旧数据）；`'x'.repeat(12001)` 拒绝
- `resumeItemHasContent`：title/details/facts/supplement 全空但 `sourceText: "原文"` → `true`
- `resumeDisplayContent`（v2 与 v3 各一）：`projects` 卡片 `sourceText` 等于条目值；无字段时为 `''`

- [ ] **Step 6: 实现 resume-v2.mjs**

`cleanResumeV2` 条目 `obj()` 支持可选键（例如先取出 `sourceText` 再校验必键集合，或给 `obj()` 加可选键参数），值过 `str(v, 12000)`；`resumeItemHasContent` 加 `|| (item.sourceText || '').trim()`；`resumeDisplayContent` 的 projects 映射加 `sourceText: i.sourceText ?? ''`。

- [ ] **Step 7: 运行确认通过**

Run: `npx vitest run apps/web/src/lib/resumeEnrichment.test.ts --config vitest.config.ts`
Expected: PASS

- [ ] **Step 8: 写 cleanConfig 失败测试（export.test.mjs）**

- config 的 `projects[0].sourceText: "原文"` → `cleanConfig` 输出保留该键与值
- 无 `sourceText` 的 config → 输出不含该键（条件展开，与 `image`/`link` 同款）

- [ ] **Step 9: 实现 validation.mjs**

ProjectCard 白名单加条件展开 `...(project?.sourceText?.trim() ? { sourceText: text(project.sourceText) } : {})`。v1 视图条目清理器（L36 的 `["title","details","facts"]`）**不动**。

- [ ] **Step 10: 运行确认通过**

Run: `node --test apps/launcher/src/export.test.mjs`
Expected: PASS

- [ ] **Step 11: fixtures 加样例并双端验证**

`resume-enrichment.v2.json` 与 `v3.json` 各给一个条目加 `"sourceText": "<一段中文原文样例>"`；`agent-golden.v2.json` 与 `v3.json` 的 `content.projects` 各一个条目加同样字段（brief→config 透传验证）。然后：
Run: `npx vitest run apps/web/src/lib/resumeEnrichment.test.ts apps/web/src/lib/resumeDraft.test.ts --config vitest.config.ts && apps/agent/.venv/bin/python -m pytest apps/agent/tests -q`
Expected: 双端 PASS（Python 端 fixture round-trip 相等断言仍成立——字段已是模型成员）

- [ ] **Step 12: Commit**

```bash
git add packages/contracts/src packages/contracts/fixtures apps/web/src/lib/resumeDraft.test.ts apps/web/src/lib/resumeEnrichment.test.ts apps/launcher/src/export.test.mjs
git commit -m "feat: TS 合同投影与清理器支持 sourceText（cleanConfig 白名单保留）"
```

### Task 3: Agent 锚定填充 sourceText

**Files:**
- Modify: `apps/agent/src/buildurprofile_agent/skills/anchored_formatter.py`（`make_anchored_draft` L261-290）
- Test: `apps/agent/tests/test_resume_anchored.py`

**Interfaces:**
- Consumes: Task 1 的 draft schema（条目带字段合法）
- Produces: `make_anchored_draft` 输出的每个条目含 `sourceText`：按 `anchor["sourceBlockIds"]` 顺序取 `source.blocks` 的 `text` 用 `"\n"` 连接（逐字）；拼接结果超过 12000 字符 → 该条 `sourceText: ""` 且 `needsReview: True`，其余条目不受影响。

- [ ] **Step 1: 写失败测试（test_resume_anchored.py）**

参照该文件现有 `make_anchored_draft` 测试的 source/anchors/formatted 构造：
- 普通用例：条目 `sourceText` 逐字等于其锚定块文本按序 `"\n"` 连接（断言含跨页：锚定块分属第 1、2 页时第 1 页在前；含一个 `sourceType: "ocr"` 块，断言照常计入拼接）
- 超限用例：构造一个锚定块总长 > 12000 的条目 → `sourceText == ""` 且 `needsReview is True`；同草稿另一正常条目不受影响
- 产出草稿过 `validate_resume_draft`（带字段合法）

- [ ] **Step 2: 运行确认失败**

Run: `apps/agent/.venv/bin/python -m pytest apps/agent/tests/test_resume_anchored.py -v`
Expected: FAIL（item 无 sourceText 键）

- [ ] **Step 3: 实现**

`make_anchored_draft` 内建 `block_text = {b.blockId: b.text for b in source.blocks}`；每个条目 `"sourceText": "\n".join(block_text[bid] for bid in anchor["sourceBlockIds"])`，超 12000 时置 `""` 并把 `needsReview` 与锚定置信度结果取或。中文注释说明逐字与超限策略。

- [ ] **Step 4: 运行确认通过 + agent 全量**

Run: `apps/agent/.venv/bin/python -m pytest apps/agent/tests/test_resume_anchored.py apps/agent/tests/test_contract_schema.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/buildurprofile_agent/skills/anchored_formatter.py apps/agent/tests/test_resume_anchored.py
git commit -m "feat: 解析草稿逐字填充 sourceText（超 12000 置空并标记待核对）"
```

### Task 4: 拆分/合并与候选填充

**Files:**
- Modify: `apps/web/src/lib/resumeEdit.ts`（`splitResumeItem` L31-49、`mergeResumeItems` L51-78）
- Modify: `packages/storage/src/resumes/candidates.mjs`（`mergeEmptyDraft` 填充列表 L25）
- Test: `apps/web/src/lib/resumeEdit.test.ts`、`apps/launcher/src/resumes.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `ResumeDraftItem.sourceText` 类型
- Produces: split 后两条 `sourceText` 按自身空行段落同边界切分（段落数不足边界 → 前条全部、后条 `""`），`editedFields` 记 `sourceText`（second 条初始列表为 `['details','sourceText']`，first 条经 `withEdited`）；merge 后 `sourceText` 为 `"\n\n"` 连接、超 12000 throw `"合并后的详情原文超过单条上限。"`；`mergeEmptyDraft` 填充列表为 `['title','details','sourceText']`（条件不变：目标空且未编辑）。

- [ ] **Step 1: 写失败测试（resumeEdit.test.ts）**

- split：`sourceText` 两段、边界 1 → 前后各一段；`sourceText` 仅一段（不足边界）→ 前条全量、后条 `""`；两条 `editedFields` 均含 `'sourceText'`
- merge：两条 `sourceText` 以空行连接；构造合并后 > 12000 → throw 上面的文案；结果 `editedFields` 含 `'sourceText'`

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/web/src/lib/resumeEdit.test.ts --config vitest.config.ts`
Expected: FAIL

- [ ] **Step 3: 实现 resumeEdit.ts**

split：对 `item.sourceText` 复用与 `details` 相同的空行分段逻辑，边界大于等于自身段数时前条保留全部、后条 `""`；merge：`[first.sourceText, second.sourceText].filter(Boolean).join("\n\n")` 超限 throw。`editedFields` 按 Interfaces 更新。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/web/src/lib/resumeEdit.test.ts --config vitest.config.ts`
Expected: PASS

- [ ] **Step 5: 写候选失败测试（resumes.test.mjs）**

参照 L134 现有 `mergeEmptyDraft` 用例：
- 目标条 `sourceText` 空、未编辑 → 从候选填充
- 目标条 `sourceText` 已编辑（`editedFields` 含 `sourceText`）→ 不覆盖（即使目标为空）
- `overwriteDraft` 后条目 `sourceText` 为候选值（整体替换天然携带，钉住行为）

- [ ] **Step 6: 实现 candidates.mjs**

L25 `for(const field of ['title','details'])` → `['title','details','sourceText']`。`overwriteDraft` 不改。

- [ ] **Step 7: 运行确认通过**

Run: `node --test apps/launcher/src/resumes.test.mjs`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/resumeEdit.ts apps/web/src/lib/resumeEdit.test.ts packages/storage/src/resumes/candidates.mjs apps/launcher/src/resumes.test.mjs
git commit -m "feat: 拆分合并与候选填充支持 sourceText"
```

### Task 5: 核对页"详情原文"编辑区

**Files:**
- Modify: `apps/web/src/components/AgentEditor.tsx`（`EntryCard`，"内容"字段 L144-146 之后插入）
- Test: `apps/web/src/app/editor/[resumeId]/page.test.tsx`

**Interfaces:**
- Consumes: Task 2 类型；[page.tsx:209](../../../apps/web/src/app/editor/[resumeId]/page.tsx) 的 `onPatchItem` 已按 patch 键自动记 `editedFields`（**page.tsx 无需改动**）
- Produces: EntryCard 渲染"详情原文" textarea + 字数计数；输入经 `onPatchItem({ sourceText })` 回写草稿；超 12000 输入按字符 slice 截断（与"补充说明" L161 同款）。

- [ ] **Step 1: 写失败测试（page.test.tsx）**

参照该文件现有编辑页渲染与交互模式：
- 展开任一条目型模块 → 存在标签"详情原文"及其说明文字"此内容将展示在作品集的详情展开中（来自 PDF 原文，可删改）"
- 在 textarea 输入文本 → 草稿对应条目 `sourceText` 更新且 `editedFields` 含 `'sourceText'`
- 计数显示 `/12000`

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run "apps/web/src/app/editor/[resumeId]/page.test.tsx" --config vitest.config.ts`
Expected: FAIL（找不到"详情原文"标签）

- [ ] **Step 3: 实现 AgentEditor.tsx**

在"内容" label 块后插入同构的 `proof-field` label：`<span>详情原文</span>` + 说明行 + textarea（rows 与"内容"同款自适应）+ 计数 `<p className="proof-supplement-count">…/12000</p>`；onChange 里 `[...event.target.value].slice(0, 12000).join("")` 后 `onPatchItem({ sourceText })`。条目值默认 `item.sourceText ?? ""`。中文注释一句说明用途。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run "apps/web/src/app/editor/[resumeId]/page.test.tsx" --config vitest.config.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/AgentEditor.tsx "apps/web/src/app/editor/[resumeId]/page.test.tsx"
git commit -m "feat: 核对页新增详情原文编辑区（可删改、计数 12000）"
```

### Task 6: 作品集渲染（StackedCards 与 ResumeDisplay 统一降级）

**Files:**
- Modify: `apps/web/src/components/StackedCards.tsx`（L104-114）
- Modify: `apps/web/src/components/ResumeDisplay.tsx`（L17）
- Modify: `apps/web/src/styles.css`（ResumeDisplay 展开样式一条）
- Test: `apps/web/src/components/StackedCards.test.tsx`、`apps/web/src/ShowcasePage.fixtures.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `ProjectCard.sourceText`、`ResumeDisplayItem.sourceText`、fixtures 样例
- Produces: 统一降级规则——展开体 `detailText = card.sourceText?.trim() ? card.sourceText : card.description`（ResumeDisplay 同构：`item.sourceText` → `item.details`）；guard：`detailText` trim 后非空才渲染展开；`StackedCards` 卡面 neutral hint（L105）guard 从"有 description"改为"有展开体内容"；ResumeDisplay 条目下新增 `<details className="resume-entry-detail"><summary>查看详情</summary><div className="project-detail-body"><p>{detailText}</p></div></details>`（复用 `.project-detail-body`，styles.css 为 `.resume-entry-detail summary` 补一条与 `.project-actions summary` 同款的基础样式）。

- [ ] **Step 1: 写失败测试（StackedCards.test.tsx）**

- 卡片 `sourceText: "完整原文"` + `description: "总结"` → 存在"查看项目详情"，展开体文本为"完整原文"且不含"总结"正文
- 无 `sourceText`、有 `description` → 展开体为 `description`（降级）
- `sourceText: "   \n"`（空白）+ 有 `description` → 展开体为 `description`（空白视为空）
- 两者皆空 → 不渲染"查看项目详情"
- 卡面断言：`preview` 行为不变（现有断言保持）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/web/src/components/StackedCards.test.tsx --config vitest.config.ts`
Expected: FAIL

- [ ] **Step 3: 实现 StackedCards.tsx**

按 Interfaces 定义 `detailText`，替换 L111 guard 与 L113 展开体；L105 neutral hint guard 改为 `(card.description.trim() || card.sourceText?.trim())`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/web/src/components/StackedCards.test.tsx --config vitest.config.ts`
Expected: PASS

- [ ] **Step 5: 写失败测试（ShowcasePage.fixtures.test.tsx）**

- 用 Task 2 加过 `sourceText` 样例的 fixture 渲染 → 对应条目出现"查看详情"，展开体含原文
- 构造无 `sourceText` 的旧 v3 config 渲染 → 条目照常显示，展开体为 `details`（旧数据回归）

- [ ] **Step 6: 实现 ResumeDisplay.tsx 与 styles.css**

按 Interfaces 在条目 `<article>` 内 `<ResumeSupplement>` 之前插入展开；styles.css 追加 `.resume-entry-detail summary { cursor: pointer; color: var(--accent); text-decoration: underline; text-underline-offset: 4px; }`（置于 `.resume-entry` 样式块附近，中文注释）。

- [ ] **Step 7: 运行确认通过**

Run: `npx vitest run apps/web/src/ShowcasePage.fixtures.test.tsx --config vitest.config.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/StackedCards.tsx apps/web/src/components/ResumeDisplay.tsx apps/web/src/styles.css apps/web/src/components/StackedCards.test.tsx apps/web/src/ShowcasePage.fixtures.test.tsx
git commit -m "feat: 作品集详情展开显示原文（sourceText 优先、details 降级）"
```

### Task 7: 导出断言与全量验证

**Files:**
- Test: `apps/web/src/lib/export.test.ts`

**Interfaces:**
- Consumes: 前序全部任务的字段链路
- Produces: 导出回归钉——含 `sourceText` 的 config 经 `buildStaticHtml` 导出的 HTML 字符串包含原文文本。

- [ ] **Step 1: 写测试（钉住行为，允许直接通过）**

现有 `buildStaticHtml` 用例旁追加：config 的 `projects[0]` 带 `sourceText: "导出原文样例"` → 结果 HTML 字符串 `toContain("导出原文样例")`。数据驱动链路理论上直接通过；若失败说明导出路径有清理器剥字段，修复后通过。

- [ ] **Step 2: 运行**

Run: `npx vitest run apps/web/src/lib/export.test.ts --config vitest.config.ts`
Expected: PASS

- [ ] **Step 3: 全量验证**

依次运行并全绿：
`npm test`（vitest 全量，含存量回归）、`npm run build`（tsc + next build）、`npm run test:payment`（launcher node:test 全量，含 cleanConfig/candidates）、`npm run test:agent`（pytest 全量 + internal-agent/generations node:test）

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/export.test.ts
git commit -m "test: 导出单文件 HTML 保留 sourceText 回归钉"
```
