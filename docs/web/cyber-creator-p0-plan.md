# “赛博科技”固定模板 P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将赛博科技从暗紫色皮肤升级为由已确认简历内容驱动、可预览/编辑/导出/分享的固定作品集模板。

**Architecture:** 新生成请求用显式 `templateId`，服务端投影 `resume-v3`，版本化 Python 图从固定目录生成配置。Web 根据模板标识进入专属渲染器；旧配置仍用原路径。项目图片直接从条目补充资产读取，不复制外部参考素材。

**Tech Stack:** Next.js 16、React 19、TypeScript、Python FastAPI/LangGraph、SQLite、现有 JSON Schema 与单文件导出构建。

**Spec:** [“赛博科技”固定作品集模板 P0 规格](cyber-creator-p0-spec.md)

## Global Constraints

- 新生成只使用保存并核对的 `resume-v3`，保留模块和条目顺序及字段级隐私选择；旧任务和作品按原合同运行。
- 不实时调用 MotionSites MCP，不加载第三方 Prompt 图片，不接受任意 HTML/CSS/JS。
- 当前 Wibi 肖像仍仅限本机演示；正式分享不能绕过肖像资源的既有限制。
- 修改 Skill 合同与输出时升级图版本、Schema、黄金样例及跨语言测试；提交信息使用简体中文。

## Review Focus

- 同一幂等键换模板或 revision：任务 2 的测试必须返回冲突，不能复用旧任务。
- 隐藏模块和未选字段出现在补充图片说明/链接中：任务 2、3 的测试必须拒绝泄露。
- 0 项目或项目 0 图：任务 3、4 的测试必须呈现可读正文，不生成假素材或空堆叠区。
- 6 张图、长中文标题和大量正文：任务 3、4 的测试必须使所有内容可达且布局不溢出。
- 旧 V3/v4 任务与既有 `dark-tech` 分享：任务 2、5 的测试必须沿用旧合同与旧渲染。

---

### Task 1: 固定模板目录与版本化合同

**Files:** Modify `packages/contracts/src/config.ts`, `apps/agent/src/buildurprofile_agent/contracts.py`, `packages/contracts/src/validation.mjs`; create V4 brief/config JSON Schema and固定模板目录及黄金样例；modify `packages/skills/src/mapping.ts`, `apps/agent/src/buildurprofile_agent/skills/design.py`。测试放在相邻现有合同、Skill 与 Python 测试文件。

**Interfaces:** `TemplateId = 'cyber-creator-v1' | 'warm-v1' | 'minimal-v1' | 'bold-v1'`；`GenerationBriefV4 = {role, templateId, content: ResumeContentV3}`；`DesignConfigV4` 保留既有配置字段并增加必填 `templateId`。`templateToConfig(templateId, role)` 在 TS/Python 均返回相同固定参数；旧 `styleToConfig` 保留。

- [x] 写失败测试：新 ID 合法、未知 ID 拒绝、V4 不接受 `answers` 和任意代码字段、旧 V3 配置仍合法、TS/Python 目录黄金样例一致。
- [x] 运行对应合同/Skill/Python 测试，确认测试因缺少 V4 接口失败。
- [x] 实现 V4 类型、严格校验、Schema 和固定参数目录；`cyber-creator-v1` 固定为 `dark-tech` 兼容皮肤，但模板标识决定新渲染器。
- [x] 运行 `npm run test:skills`、`npm run test:agent`，确认合同及黄金样例通过。
- [x] 只暂存本任务文件，使用简体中文 commit 信息提交。

### Task 2: 服务端生成请求和 Python 图

**Files:** Modify `packages/storage/src/generations.mjs`, `packages/storage/src/generation/brief.mjs`, `packages/storage/src/generation/queue.mjs`, `apps/web/src/lib/generationApi.ts`, `apps/agent/src/buildurprofile_agent/graph.py`, `apps/agent/src/buildurprofile_agent/skills/registry.py`, `apps/agent/src/buildurprofile_agent/skills/resume.py`, `apps/agent/src/buildurprofile_agent/skills/artifact.py` and对应 API/图/队列测试。

**Interfaces:** 新 `enqueueResume` 接收 `{resumeId, revision, role, templateId, idempotencyKey, portraitAssetId?, styleId?}`；新工作流使用独立版本 `python-agent-v5`，以固定模板映射代替评分节点，内容组装与 QA 对比原确认内容。旧 v2–v4 分流不变。

- [x] 写失败测试：无 `answers` 的 V4 请求成功入队；跨用户图片/简历拒绝；同键不同模板或 revision 返回 409；隐藏字段与含隐藏值的补充说明被拒绝；旧 v4 租约可继续领取。
- [x] 运行 `npm run test:payment`、`npm run test:agent` 的相关测试，确认预期失败。
- [x] 实现严格 brief 清洗、队列版本分流、图节点与新 Skill/QA 版本；维持现有租约、媒体复制和图片权属逻辑。
- [x] 运行 `npm run test:payment`、`npm run test:agent`，确认全部通过。
- [x] 只暂存本任务文件，使用简体中文 commit 信息提交。

### Task 3: 以确认条目构建模板展示模型

**Files:** Create `apps/web/src/lib/cyber-creator-presentation.ts` and `apps/web/src/lib/cyber-creator-presentation.test.ts`；modify `apps/web/src/components/ResumeDisplay.tsx` only where needed to share safe full-content rendering。

**Interfaces:** `buildCyberCreatorPresentation(config: DesignConfigV4)` 返回有序模块视图、Hero 字段、可见项目及各项目的 `imageId[]`/命名链接；只读 `content.resume.sections`，以 `itemId` 关联条目，媒体 URL 由渲染器注入的 `resolveResumeImage` 解析。0/1/2/3+ 图分别选择文字/单图/双图/拼贴布局，4–6 图保留可展开内容。

- [x] 写失败测试：模块与条目排序、无图、六图、空项目、仅技能/工作、隐藏字段、补充文本换行、合法命名链接和长标题；摘要不替代全文。
- [x] 运行该 Vitest 文件，确认新展示模型测试失败。
- [x] 实现纯函数映射；跑马灯只使用可见项目图，少于两张时提供文字排版模式，不复制图片字节到配置。
- [x] 运行该 Vitest 文件与既有 `ShowcasePage` 测试，确认通过。
- [x] 只暂存本任务文件，使用简体中文 commit 信息提交。

### Task 4: 模板页面、资产与动效

**Files:** Create `apps/web/src/components/CyberCreatorPage.tsx`、相邻样式与测试文件；modify `apps/web/src/ShowcasePage.tsx`, `apps/web/src/styles.css` as needed；新增自有且完成使用权审查的默认无照片人物资产，并确保 `scripts/build-export.mjs` 可将其纳入单文件导出。

**Interfaces:** `CyberCreatorPage` 接收 `DesignConfigV4`、`resolveResumeImage`、现有分享锚点与触屏降级参数；`ShowcasePage` 仅对显式 `templateId === 'cyber-creator-v1'` 分流，旧 `dark-tech` 不改变。所有动态内容来自任务 3 的展示模型。

- [x] 写失败组件测试：人物与姓名交叠结构、能力浅色区、项目多图布局、0 项目、0 图片、无邮箱、长中文名、键盘可访问的展开内容及 `prefers-reduced-motion`。
- [x] 运行新组件测试，确认预期失败。
- [x] 实现首屏、About、能力区、项目区和其余简历模块；加入受控入场/滚动/指针效果，触屏与减少动态效果下展示静态状态。未完成资产权利审查前不采用 Prompt 外链或现有 Wibi 图作为正式默认人物。
- [x] 运行 `npm test`、`npm run build`；在 1440×900、768×1024、390×844 的浏览器预览检查构图和内容溢出。
- [x] 只暂存本任务文件，使用简体中文 commit 信息提交。

### Task 5: 风格选择、编辑与交付一致性

**Files:** Modify `apps/web/src/components/BuilderExperience.tsx`, `apps/web/src/App.tsx`, `apps/web/src/app/style/[resumeId]/page.tsx`, `apps/web/src/components/EditorPanel.tsx`, `apps/web/src/lib/export.ts` or实际导出入口，以及相邻测试；按需要更新 `docs/web/README.md`、`docs/shared/product.md`、`docs/shared/architecture.md`。

**Interfaces:** 新流程选择模板后保存显式 `templateId`，调用任务 2 的 V4 API；不展示八题也不向新任务提交答案。已有作品编辑只改确认展示内容，不改变其模板版本。分享和导出使用任务 4 同一渲染器与媒体解析。

- [x] 写失败流程测试：从核对页选“赛博科技”直达生成/预览；新请求无答案；编辑后图片仍属于原项目；分享/导出保留拼贴及全文；旧配置的预览/分享仍走旧皮肤。
- [x] 运行相关 Vitest 与导出测试，确认预期失败。
- [x] 接通模板状态和 V4 请求，清理新流程的八题状态依赖，保持旧浏览器兼容入口；更新产品/架构文档中已过时的“测评”和“固定皮肤”描述。
- [x] 运行 `npm test`、`npm run build`、`npm run test:skills`、`npm run test:agent`、`npm run test:payment`；浏览器复核无照片与含图布局，分享权限和离线导出由自动集成测试覆盖。真实付款与公网回调另按支付上线门槛验收。
- [x] 只暂存本任务文件，使用简体中文 commit 信息提交。

## 最终检查

- [ ] 逐条对照规格验收场景；确认旧任务、旧分享、其他风格与肖像发布限制均未回归。
- [ ] 检查 `git diff --check`、文档链接和仓库状态；保留与本计划无关的未提交业务改动。
