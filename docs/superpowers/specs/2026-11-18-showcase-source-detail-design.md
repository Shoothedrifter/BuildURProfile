# 设计：作品集详情展示 PDF 原文（sourceText 两级内容）

日期：2026-11-18
状态：待用户批准（builder 审查已完成，5 项发现已并入正文，标注为"审查修正"或"我的决定"）
分支预期：`dev/noodle` 之上的新功能分支

## 意图与动机

当前作品集的卡片面与"查看项目详情"展开体显示的是**同一份** Agent 精炼总结（草稿 `details` 字段）：[StackedCards.tsx:111-114](../../../apps/web/src/components/StackedCards.tsx) 的 `<details>` 展开体直接渲染 `card.description`。总结是有损压缩，读者无法了解经历的完整原始信息。

目标是为作品集建立**两级内容**：

- **卡片面**：Agent 精炼总结（`details`，即核对页"内容"字段）——不变
- **详情展开**：PDF 原文全文（新字段 `sourceText`，即核对页橙色"原文对照"卡的逐字内容）——点击"查看项目详情/查看详情"后展示

同时守住项目原则：**只有用户确认的展示字段进入生成 API**（AGENTS.md）。原文必须以"用户可见、可编辑、可确认"的字段身份进入草稿，而不是绕过确认直接投喂生成。

## 目标

1. 草稿条目新增可编辑字段 `sourceText`（UI 中文名"详情原文"），Agent 解析时从锚定 source blocks 逐字填充
2. 所有条目型模块统一支持（数据驱动）：项目、实习/工作、校园、教育、荣誉、自我评价、技能、其他；`basicInfo`/`jobIntent` 不参与（与 `details` 的处理一致）
3. `StackedCards`（项目卡片）与 `ResumeDisplay`（实习/工作等条目）都提供"查看详情"展开，交互语言一致；展开体 = `sourceText`，为空降级 `details`
4. TS 类型、JSON Schema、Python 合同镜像、黄金样例、单文件导出全部同步
5. 隐藏值校验沿用 supplement 先例：`sourceText` 含未勾选字段值时报错，提示用户删改
6. 拆分/合并跟随 `details` 的既有语义

## 非目标

- 不改卡片面预览逻辑（`projectPreview` 仍从 `details` 解析"概述/成果"段落）
- 不在读者端展示页码标注（"第 X 页"是核对用溯源信息，保留在核对页原文对照卡）
- 不把实习/工作经历搬进 StackedCards 卡片组（保持 `ResumeDisplay` 渲染，仅加展开）
- 不改旧浏览器解析流程的解析行为（其草稿无 `sourceText`，走降级）
- 不做富文本/Markdown 渲染（纯文本 + 段落/换行）

## 反目标（即使技术上可行也不要）

- 原文不经用户确认进入生成（违反 allowlist 投影原则）
- 原文含未勾选敏感值时静默置空或静默放行
- Agent 对 `sourceText` 做任何模型改写（必须逐字拼接；改写只存在于 `details`）

## 约束

- 生成请求只携带 `resumeId + revision + role + answers`（[storage/generations.mjs:27-36](../../../packages/storage/src/generations.mjs)），投影在服务端从存储草稿执行——`sourceText` 必须存在草稿里才能被投影
- checkpoint 不保存 PDF 原文/来源片段（AGENTS.md）：`sourceText` 存在于**草稿**（服务端会话保护、30 天保留，与 source blocks 同 regime），不是 agent checkpoint，不违反；但解析图不得把原文写入 checkpoint（现状即不落，实现时确认即可）
- 生成后 `sourceText` 随确认内容进入作品集 config 长期持久化，与 `supplements` 同等地位（用户已确认、已脱敏校验）
- 整包 256 KiB 上限校验已有（[resume-draft.ts:103](../../../packages/contracts/src/resume-draft.ts)），不新增机制
- TS ↔ Python 合同同步由 `apps/agent/tests/test_contract_schema.py` 强制校验。**前科**：P3 加 `supplements` 时漏改 Python 模型导致 pytest 失败 + Agent 重新序列化静默丢字段。本次所有合同改动必须三处同步（TS 类型 / JSON Schema / Python 模型），且验证必须包含 agent pytest，不能只跑 vitest
- 用户全局规则：TDD、中文注释、commit 需批准

## 方案选择（对话中已定案）

**Q1：原文以什么身份进入生成 → 方案 A（草稿可编辑字段）**

- **A（选定）**：草稿条目新增 `sourceText`，Agent 逐字填充，用户在核对页可编辑/删减/清空，投影走 allowlist。符合"用户确认的展示字段"原则；含敏感值时用户能自己删；数据流单一（生成服务仍只读草稿）
- B（弃）：服务端投影时按 `sourceBlockIds` 现算原文。"确认"语义弱（原文对照只是只读参考，没有"我要把它放进作品集"的确认动作）；生成服务需额外加载 source；用户无法删改敏感信息
- C（弃）：A 基础上每条加"详情展示原文"开关。多一层状态；清空 `sourceText` 本身即等效关闭（空 → 降级 `details` → 两者皆空则无展开按钮），不需要独立开关

**Q2：实习经历详情形态 → 选项 1（ResumeDisplay 加展开）**

- **1（选定）**：`ResumeDisplay` 条目加"查看详情"展开，与项目卡片交互语言一致（`<details>` + `<summary>`）
- 2（弃）：只做项目经历，与需求（实习卡片也要详情）不符
- 3（弃）：实习搬进 StackedCards，布局与模块映射大改

## 设计细节（对话中已定的口径）

### 1. 字段命名与语义

- 字段名统一 `sourceText`，贯穿草稿、公共展示合同、`ProjectCard`、Python 镜像——一个概念一个名字
- UI 标签"详情原文"，编辑区注明：此内容将展示在作品集的详情展开中（来自 PDF 原文，可删改）
- 编辑轨迹：`editedFields` 支持 `sourceText`（TS 正则 [resume-draft.ts:18](../../../packages/contracts/src/resume-draft.ts) 与 Python 校验器 [contracts.py:311](../../../apps/agent/src/buildurprofile_agent/contracts.py) 同步加）

### 2. Agent 填充（[anchored_formatter.py](../../../apps/agent/src/buildurprofile_agent/skills/anchored_formatter.py)）

- `sourceText` = 该条目锚定的 source blocks 文本按文档顺序（reading order）用 `\n` 连接，逐字、不进模型
- 锚定结果已精确到 block 级（`align_anchors` 为每个 anchor 累积 `sourceBlockIds`，blockId 按文档序追加），填充是确定性操作
- OCR 块、低置信块照常计入（`needsReview` 机制另行把关），`sourceText` 不因置信度裁剪
- **超限处理（我的决定）**：填充后超过长度上限（见 §5）的条目，`sourceText` 置空并置 `needsReview: true`（不硬失败整份简历、不静默截断原文；该条详情降级显示 `details`，核对页警示引导用户手动删减后自行粘贴）
- **候选/重解析语义（审查修正）**：完全对齐 `details` 的**现状**行为，不设特殊保护——
  - `overwriteDraft`（[candidates.mjs:82](../../../packages/storage/src/resumes/candidates.mjs)）：整体替换，用户编辑过的 `sourceText` 同 details 一样被覆盖（用户选择覆盖模式即接受全量替换）
  - `mergeEmptyDraft`（[candidates.mjs:25](../../../packages/storage/src/resumes/candidates.mjs)）：填充列表从 `['title','details']` 扩为 `['title','details','sourceText']`，条件不变（目标字段空且未编辑时才从候选填充）

### 3. 展示规则（两级内容）

- **展开体内容**：`sourceText` 非空 → 显示 `sourceText`；否则降级显示 `details`；两者皆空 → 不渲染展开按钮
- **卡片面**：预览逻辑不动（`projectPreview(description)` 解析"项目描述/职责/成果"）；"完整说明请查看项目详情"的提示 guard 从"有 description"改为"有展开体内容（sourceText 或 description）"
- **ResumeDisplay**：条目正文仍显示 `details`，其下加 `<details>` 展开遵循同一规则
- 详情内不出现页码标注

### 4. 拆分/合并（[resumeEdit.ts](../../../apps/web/src/lib/resumeEdit.ts)）

- 拆分：`sourceText` 按自身段落（空行分隔）在同一边界索引切分；段落数不足边界时前条保留全部、后条为空。两条都继承原 `sourceBlockIds`（现状语义），拆后 `needsReview: true` 把关；`editedFields` 记录 `sourceText`（second 条的初始 `['details']` 扩为 `['details','sourceText']`，first 条经 `withEdited` 同步）
- 合并：`sourceText` 用 `\n\n` 连接，`sourceBlockIds` 取并集（现状）；合并后超上限（§5）报错（与 `details` 合并超限报错同款文案风格）；`editedFields` 记录 `sourceText`

### 5. 隐藏值校验与长度

- 投影（`projectConfirmedResume`）：`sourceText` 含未勾选（`included: false`）字段值 → `throw`，文案：**"详情原文包含未勾选字段，请删改后再试。"**（supplement 先例，不静默置空）
- 长度上限（我的决定，审查修正）：`sourceText` ≤ **12000** 字符，与 `details` 上限对齐（初稿曾定 6000，builder 指出单锚点原文可达上万字符——无标题 PDF 整页兜底成单锚点时尤甚；6 千上限会让正常长条目也触发置空）。TS `str(v, 12000)` / Schema `maxLength` / Python `Field(max_length=12000)` 三处一致；整包 256 KiB 包络校验兜底总量。仍超 12000 的条目按 §2 置空降级
- `basicInfo`/`jobIntent` 投影时 `sourceText` 与 `title`/`details` 一样置空
- **内容判定（我的决定，审查补充）**：`resumeItemHasContent`（[resume-v2.mjs:41](../../../packages/contracts/src/resume-v2.mjs)）计入 `sourceText`——用户清空 `title`/`details` 只留原文的条目不得在 V3 投影和 `ResumeDisplay` 过滤中静默消失

### 6. 变更文件清单

**TS 合同（packages/contracts/src/）**
- `resume-draft.ts`：`ResumeDraftItem` 加 `sourceText?: string`；`editableField` 正则加 `sourceText`；`projectConfirmedResume` 投影加 `sourceText`（含隐藏值 throw、basicInfo/jobIntent 置空）；v1→v2 归一化不生成该字段
- `config.ts`：`ResumeEntry` 不动（v1 视图不带）；`ResumeDisplayItem` 加 `sourceText?`；`ProjectCard` 加 `sourceText?: string`
- `resume-v2.mjs`：`cleanResumeV2` 条目键集合加可选 `sourceText`（注意 `obj()` 是严格键集合校验，需支持可选键）+ `str(v, 12000)`；`resumeItemHasContent` 计入 `sourceText`（§5）；`resumeDisplayContent` 的 projects 映射携带 `sourceText`

**JSON Schema（packages/contracts/schema/）**
- `resume-draft.v1.json` **与** `resume-draft.v2.json`：item 定义都加可选 `sourceText`（maxLength 12000）。**v1 必须同步（审查修正）**：Python `ResumeDraftItem` 为 v1/v2 草稿共用基类，`test_contract_schema.py` 断言 `ResumeDraftV1.model_json_schema()` 与 `resume-draft.v1.json` 完全相等，且解析图经 `complete()` 按 v1 schema（`additionalProperties: false`）提交草稿——只改 v2 则 pytest 必挂且字段到不了存储草稿。"旧草稿无 `sourceText`"指存量历史数据，不是 v1 合同拒收新字段
- `design-config.v1.json` / `v2.json` / `v3.json`：`ProjectCard` 加可选字段（v2/v3 另含 `ResumeDisplayItem`/`ResumeDisplayItemV3` 同步）
- `generation-brief.v1.json` / `v2.json` / `v3.json`：其中定义展示条目形态的部分同步（v3 的 `ResumeDisplayItemV3` 等，逐份核对）
- 兼容性原则：所有新字段可选，旧 config/草稿/brief 必须继续通过校验

**持久化与候选（packages/）**
- `contracts/src/validation.mjs`：`cleanConfig` 的 `ProjectCard` 固定键白名单（[validation.mjs:86-92](../../../packages/contracts/src/validation.mjs)，现为 `{id,index,title,category,year,description,tags,visual,image,link}`）加可选 `sourceText`——**不加则正式保存/发布/生成队列会静默剥掉该字段，预览/导出有原文而正式分享没有（审查修正）**。v1 视图的条目清理器（`["title","details","facts"]`）不动：v1 视图按设计不携带 `sourceText`
- `storage/src/resumes/candidates.mjs`：`mergeEmptyDraft` 填充列表与 `overwriteDraft` 行为按 §2 修正

**Python（apps/agent/src/buildurprofile_agent/contracts.py）**
- `ResumeDraftItem`、`ResumeDisplayItem`、`ProjectCard` 镜像加字段；draft 校验器的 `editedFields` 正则加 `sourceText`

**黄金样例（packages/contracts/fixtures/）**
- `agent-golden.v2.json`、`agent-golden.v3.json`、`resume-enrichment.v2.json`、`resume-enrichment.v3.json` 加 `sourceText` 样例
- `resume-draft.v1.json`（v1 草稿）不动，作为"无字段降级"的回归样例

**Agent（apps/agent/）**
- `skills/anchored_formatter.py`：填充逻辑 + 测试（`tests/test_resume_anchored.py`）
- `tests/test_contract_schema.py` 必须继续通过（Python 模型 ↔ Schema 同步）

**Web（apps/web/src/）**
- `components/AgentEditor.tsx`：EntryCard 加"详情原文"编辑区（textarea 自适应行数 + 字数计数 ≤12000）
- `app/editor/[resumeId]/page.tsx`：`onPatchItem` 透传 `sourceText`
- `lib/resumeEdit.ts`：split/merge 按 §4
- `components/StackedCards.tsx`：展开体与 guard 按 §3
- `components/ResumeDisplay.tsx`：条目加展开按 §3
- `server/export.mjs`：数据驱动自动携带，补导出测试断言 `sourceText` 出现在导出 HTML 中

## 测试计划（TDD，先失败后实现）

按 AGENTS.md 检查表：contracts/前端改动 → `npm test`、`npm run build`；Python/生成合同 → `npm run test:agent`（含 `apps/agent/.venv/bin/pytest`，勿只跑 vitest——supplements 前科）。

用例清单：

1. **contracts（resume-draft.test.ts / resumeDraft.test.ts）**
   - 投影输出含 `sourceText`；含未勾选字段值时 throw 且错误文案正确
   - v1 草稿（无字段）投影成功且不含 `sourceText`
   - `cleanResumeV2` 接受带字段 / 拒绝超 12000 / 接受缺字段（旧数据）
   - `cleanConfig` 保留 `ProjectCard.sourceText`（保存/发布路径不剥字段）
   - `resumeItemHasContent` 计入 `sourceText`（只留原文的条目不被过滤）
   - 256 KiB 包络校验不回归
2. **agent（test_resume_anchored.py）**
   - `sourceText` 逐字等于锚定 blocks 按 reading order 的 `\n` 连接
   - 跨页条目、OCR 块计入
   - 超过 12000 的条目置空 + `needsReview: true`，其余条目不受影响
   - `test_contract_schema.py` 同步测试通过（v1/v2 Schema 均含可选字段）
3. **web / storage**
   - `resumeEdit.test.ts`：split 同边界切分（含段落数不足用例）、merge 连接与超限报错、`editedFields` 记录 `sourceText`
   - candidates（storage 测试）：`overwriteDraft` 整体替换含 `sourceText`；`mergeEmptyDraft` 对空且未编辑的 `sourceText` 填充、对已编辑的不覆盖
   - `StackedCards.test.tsx`：有 `sourceText` 展开体显示原文；无 `sourceText` 降级 `details`；两者皆空无展开按钮；卡片面预览不回归
   - `AgentEditor` / editor page 测试：编辑回填、editedFields 记录
   - `ResumeDisplay` 测试：展开交互与降级
   - 导出测试：`sourceText` 出现在单文件 HTML
4. **存量回归**：旧 config（无字段）渲染行为不变

## 风险与备注

- **合同三处同步**是最大风险（supplements 前科），实现顺序建议：TS 类型 + v1/v2 Schema + Python 模型 + fixtures 一次性同一 commit，再逐层功能
- **长文本样式**：详情可能数千字符，`.project-detail-body` 需要可滚动或限高处理，跟随现有展开风格，builder 定夺
- **换行语义**：Agent 用 `\n` 连接行级 blocks；用户编辑后段落形态以用户为准，渲染按换行/空行分段
- **worker 重启**：改 Python 后须整体重启 dev 三件套（launcher 令牌机制），验证时注意

## 留给 builder 的决定

- 详情展开体的具体样式细节（限高、滚动、分隔线），跟随现有 `.project-detail-body` 风格
- "详情原文"编辑区放置位置（建议"内容"字段之后，顺序 title → details → sourceText）
- 测试是追加到现有文件还是新建（倾向追加现有）
- `generation-brief` 各版本 schema 的具体同步点逐份核对后的微调
