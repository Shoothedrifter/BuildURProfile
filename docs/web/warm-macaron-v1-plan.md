# 暖调马卡龙模板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增第 3 个独立作品集模板 `warm-macaron-v1`（暖调马卡龙），按 spec 忠实还原参考设计的马卡龙渐变、毛玻璃卡片与分幕长卷，并接替「温暖创意」的选择器位置。

**Architecture:** 沿用像素世界风的独立模板模式：合同层新增 `templateId` 枚举与可选 `heroPhoto` 原图字段（Web/存储侧写入，Agent 不感知），前端以纯投影函数把 `resume-v3` 映射为区块模型，`WarmMacaronPage` 消费模型渲染，预览/分享/导出共用组件。照片直出为正式交付能力，保存项目时内嵌进配置。

**Tech Stack:** Next.js（App Router，特殊版本）、React + TypeScript、vitest、Python FastAPI 合同镜像（pydantic StrictModel）。

**Spec:** [docs/web/warm-macaron-architecture.md](warm-macaron-architecture.md) — 本计划从 spec 出发论证，执行者须同时阅读 spec。

## Global Constraints

- 提交信息用简体中文，函数名、变量名与专有名词保留英文；计划内 commit 步骤仅在用户批准执行方式后生效。
- 严格 TDD：每个任务先写失败测试、跑出失败、再实现、再跑绿、再提交。
- 真实简历、真实照片与参考站素材不进入仓库、模板资源或自动测试；测试只用可提交的合成样例。
- 照片只存私有资产区；macaron 直出不发送给图像生成供应商；checkpoint 不保存照片字节。
- 桌面外层内容宽度上限 1600px，模板内容列约 1100px；布局改动须宽屏与窄屏（390px/768px/1440px）双检查。
- 写 Next.js 代码前先读 `apps/web/node_modules/next/dist/docs/` 内相关指南（该版本有破坏性变更）。
- 测试命令映射（AGENTS.md）：Web `npm test` + `npm run build`；TS Skills `npm run test:skills`；Python/合同 `npm run test:agent`；存储/交付接口 `npm run test:payment`。
- 样式全部限定在模板根容器类 `.warm-macaron` 内，不污染既有模板。

## Review Focus

1. **warm-v1 存量回归**：新枚举上线后，已保存的 warm-v1 项目必须仍通过校验并用旧 Marquee 骨架渲染 → Task 1 断言 + Task 7 回归。
2. **照片过期后不裂图**：avatar_assets 短 TTL 与长期分享冲突，保存时未内嵌则分享页/导出出现死图 → Task 6 内嵌断言。
3. **空数据不产生空壳**：空模块、无图条目、未公开联系字段不得渲染空区块、空标签或死按钮 → Task 2/4 断言。
4. **减弱动态效果**：`prefers-reduced-motion` 下气泡与平滑滚动须停用，内容与导航完整可达 → Task 3 断言。
5. **恶意与超长输入**：外链走现有校验；长中文标题/段落不得撑破卡片、导航与模态 → Task 4/5 断言。

---

### Task 1: 合同与双侧模板注册

**Files:**
- Modify: `packages/contracts/src/config.ts`
- Modify: `packages/contracts/schema/design-config.v4.json`、`packages/contracts/schema/generation-brief.v4.json`
- Modify: `packages/contracts/src/validation.mjs`（若其中枚举/校验 templateId 或 V4 字段，执行时先 grep 确认）
- Modify: `packages/skills/src/mapping.ts`
- Modify: `apps/agent/src/buildurprofile_agent/contracts.py`、`apps/agent/src/buildurprofile_agent/skills/design.py`
- Modify: `packages/contracts/fixtures/agent-golden.v3.json`（若其枚举模板清单，补 macaron 用例）
- Test: 既有合同/Skills/Agent 测试套件就近新增断言

**Interfaces:**
- Produces: `TemplateId` 联合类型新增 `"warm-macaron-v1"`（TS 与 Python Literal 同步）；`DesignConfigV4` 新增可选字段 `heroPhoto?: Readonly<{ assetUrl: string; alt: string }>`（Python 侧同为可选，Agent 不产出该字段）；`TEMPLATE_VECTORS["warm-macaron-v1"] = { E: 0.75, K: 0.5, P: 0.5, S: 0.5, PChoice: "warm" }`。

- [ ] **Step 1: 写失败测试** — TS 侧：`templateToConfig("warm-macaron-v1", "ui-ux-designer")` 返回的 config 含 `templateId: "warm-macaron-v1"`；V4 校验接受含 `heroPhoto: { assetUrl: "data:image/png;base64,x", alt: "测试" }` 的配置、拒绝 `heroPhoto: 123`；`templateToConfig("warm-v1", …)` 仍通过（存量回归）。Python 侧：`template_to_config("warm-macaron-v1", …)` 同断言；含 `heroPhoto` 的 DesignConfigV4 可解析、缺省亦可。
- [ ] **Step 2: 跑测试确认失败** — Run: `npm run test:skills` 与 `npm run test:agent`。Expected: FAIL（未知模板 / 校验拒绝）。
- [ ] **Step 3: 实现** — 按 Interfaces 逐文件追加枚举与字段；两份 v4 Schema 的 `templateId.enum` 追加 `"warm-macaron-v1"`（保留 `warm-v1`），`design-config.v4.json` 的 V4 `$defs`/属性加可选 `heroPhoto`。
- [ ] **Step 4: 跑测试确认通过** — Run: `npm run test:skills`、`npm run test:agent`。Expected: PASS。
- [ ] **Step 5: Commit** — `git add` 上述文件，`git commit -m "feat: 注册暖调马卡龙模板合同与双侧向量"`

### Task 2: 展示模型投影（纯函数）

**Files:**
- Create: `apps/web/src/lib/warmMacaron.ts`
- Test: `apps/web/src/lib/warmMacaron.test.ts`（命名跟随 `lib/` 既有测试惯例，执行时对照 `resumePresentation` 的测试文件位置）

**Interfaces:**
- Consumes: Task 1 的 `DesignConfigV4`。
- Produces: `buildWarmMacaronModel(config: DesignConfigV4): WarmMacaronModel`；`WarmMacaronModel` 含 `hero`（问候语、姓名、岗位行、介绍文本、`contact: { email?: string; phone?: string }`、`photo: { assetUrl: string; alt: string } | null`）与 `sections: readonly WarmMacaronSection[]`；每个 section 含 `id`、`eyebrow`（英文小标题，常量 `EDUCATION/EXPERIENCE/PROJECTS/SHOWCASE/SKILLS`）、中文标题与 `cards`；card 含 `itemId/title/time/paragraphs/facts/highlights/links/images`。联系字段读取方式与 LegacyShowcasePage 一致（`content.profile.email` + basicInfo 的 `phone` fact）。

- [ ] **Step 1: 写失败测试** — 合成 resume-v3：全部模块有内容 → 6 个区块按 sections `order` 排列，`campusExperience/other/awards` 合并入 showcase 区；隐藏空模块 → 对应区块不出现；无 supplement 图 → card `images` 为空数组；未勾选联系 → `contact` 两字段均 undefined；`config.heroPhoto` 存在时 `photo` 透传、缺失时为 null；facts 只保留有值项。
- [ ] **Step 2: 跑测试确认失败** — Run: `npx vitest run apps/web/src/lib/warmMacaron.test.ts`。Expected: FAIL（模块不存在）。
- [ ] **Step 3: 实现** — 纯映射，无 React 依赖；条目按 `order` 排序、`itemId` 稳定透传；`presentationHighlights` 原样挂到所属条目的 card。
- [ ] **Step 4: 跑测试确认通过** — Run: 同 Step 2。Expected: PASS。
- [ ] **Step 5: Commit** — `git commit -m "feat: 暖调马卡龙展示模型投影"`

### Task 3: WarmMacaronPage 骨架与分发

**Files:**
- Create: `apps/web/src/components/WarmMacaronPage.tsx`、`apps/web/src/components/WarmMacaronPage.test.tsx`
- Modify: `apps/web/src/ShowcasePage.tsx`（templateId === "warm-macaron-v1" 且 resume-v3 时分发）
- Modify: `apps/web/src/styles.css`（`.warm-macaron` 作用域：固定渐变底 `#E0A6B5→#FED2BC→#DEEDC3`、半透明 blur 导航、分幕 `min-height:100vh`、气泡 keyframes、衬线双标题、外扩描边相框、900px/600px 断点）

**Interfaces:**
- Consumes: Task 2 的 `buildWarmMacaronModel`；Task 1 的 `heroPhoto`。
- Produces: `WarmMacaronPage({ config, preserveShareHash, staticDecorations, resolveResumeImage, defaultPhotoUrl, samplePreview })`（对齐 PixelWorldPage 的 props 形态）；相框图片源优先级 `config.heroPhoto.assetUrl` → `defaultPhotoUrl`。

- [ ] **Step 1: 写失败测试** — 首屏渲染姓名、岗位行、介绍盒与「联系我」按钮（contact 为空时按钮不存在）；导航项与实际区块一致且随滚动高亮（jsdom 下用 scroll stub 或直接断言 active 类计算逻辑）；「继续下滑」按钮指向下一区块、最后一区无按钮；`staticDecorations` 为 true 时气泡不带 animation；`prefers-reduced-motion` 模拟下同理；ShowcasePage 分发：macaron 配置渲染 `.warm-macaron` 根、warm-v1 存量配置仍渲染旧骨架。
- [ ] **Step 2: 跑测试确认失败** — Run: `npx vitest run apps/web/src/components/WarmMacaronPage.test.tsx apps/web/src/ShowcasePage.test.tsx`。Expected: FAIL。
- [ ] **Step 3: 实现** — 骨架含首屏、导航、分幕容器与区尾按钮；正文区块留给 Task 4（模型为空 sections 时页面不崩）。问候语文案原创（如「Hi，」+ 姓名）。
- [ ] **Step 4: 跑测试确认通过** — Run: 同 Step 2 及 `npm test`。Expected: PASS。
- [ ] **Step 5: Commit** — `git commit -m "feat: 暖调马卡龙页面骨架与模板分发"`

### Task 4: 内容区块渲染

**Files:**
- Create: `apps/web/src/components/WarmMacaronSections.tsx`
- Modify: `apps/web/src/components/WarmMacaronPage.tsx`（挂载区块）、`apps/web/src/styles.css`
- Test: `apps/web/src/components/WarmMacaronSections.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `WarmMacaronModel`、`resolveResumeImage`。
- Produces: `WarmMacaronSections({ model, resolveResumeImage, onOpenImage })`；`onOpenImage(src, caption)` 供 Task 5 灯箱接管。

- [ ] **Step 1: 写失败测试** — 教育卡渲染 facts 高亮数字行；工作卡为横向卡 + 最多前两张补充图；项目卡双列 grid、含「了解详情 →」按钮（触发回调）；展示区卡渲染 highlights 与 facts chip；技能区按条目分组渲染 chip；无图条目不出现空图框；超长中文标题（80+ 字）不产生横向溢出（断言容器有防溢出类/样式）；区尾版权行含姓名。
- [ ] **Step 2: 跑测试确认失败** — Run: `npx vitest run apps/web/src/components/WarmMacaronSections.test.tsx`。Expected: FAIL。
- [ ] **Step 3: 实现** — 每类卡片一个内部组件；图片一律 `resolveResumeImage(imageId)`；按钮/交互先以回调占位，模态在 Task 5 接管。
- [ ] **Step 4: 跑测试确认通过** — Run: 同 Step 2。Expected: PASS。
- [ ] **Step 5: Commit** — `git commit -m "feat: 暖调马卡龙内容区块"`

### Task 5: 模态四件套

**Files:**
- Create: `apps/web/src/components/WarmMacaronModals.tsx`
- Modify: `apps/web/src/components/WarmMacaronPage.tsx`、`WarmMacaronSections.tsx`（接回调）
- Test: `apps/web/src/components/WarmMacaronModals.test.tsx`

**Interfaces:**
- Consumes: Task 4 的 `onOpenImage` 等回调、Task 2 的 card 数据。
- Produces: `WarmMacaronModals({ active, card, works, contact, onClose, onNavigate })` 或按仓库习惯拆为四个受控组件（执行者对照 CyberCreatorPage 的模态组织方式择一，保持可测）。

- [ ] **Step 1: 写失败测试** — 灯箱显示图与说明、点击遮罩或 Escape 关闭并恢复触发元素焦点；项目详情按「标题 → 图画廊 → 正文 → 链接」渲染且图可点开灯箱（嵌套关闭只关灯箱不关详情）；轮播支持前后按钮、圆点与方向键，循环切换；联系卡只渲染非空字段；模态打开时 body 滚动锁定、全部关闭后解锁；分享链接带 `?section=<id>&case=<itemId>#share=<token>` 时定位区块并打开对应详情、关闭后清理参数（离线导出用 `#<section>`/`#case=<itemId>` 片段锚点）；外部链接经现有安全处理渲染（恶意外链不产生危险 href）。
- [ ] **Step 2: 跑测试确认失败** — Run: `npx vitest run apps/web/src/components/WarmMacaronModals.test.tsx`。Expected: FAIL。
- [ ] **Step 3: 实现** — 复用像素世界风的焦点管理与 Escape 处理约定（执行时读 `PixelWorldPage.tsx` 对应实现）；外链沿用现有安全跳转处理；分享深链与离线片段锚点对齐像素世界风的地址约定（`preserveShareHash` 语义不变）。
- [ ] **Step 4: 跑测试确认通过** — Run: 同 Step 2 与 `npm test`。Expected: PASS。
- [ ] **Step 5: Commit** — `git commit -m "feat: 暖调马卡龙模态交互"`

### Task 6: 照片直出管线（正式交付能力）

**Files:**
- Modify: `apps/web/src/App.tsx`（照片门控为 macaron 增加直出分支，移除「仅赛博科技」限制文案）
- Modify: `apps/web/src/components/BuilderExperience.tsx`（AvatarPicker 对 macaron 开放，披露文案改为「存储于私有资产区并直接展示，不发送给图像生成供应商」）
- Modify: `apps/web/src/server/runtime.mjs`、`packages/storage/src/generation/assets.mjs`（照片上传门控与 avatar 生成门控拆分：直出上传在生产亦可用，生成仍走原门控）
- Modify: `apps/web/src/server/service.mjs`、`apps/web/src/server/export.mjs`（项目保存时把 `heroPhoto.assetUrl` 内嵌为 data URL，镜像 `heroArtwork` 的内嵌与去重处理；导出读取内嵌值）
- Test: 上述各文件的既有测试套件 + `apps/web/src/server/` 就近新增用例

**Interfaces:**
- Consumes: Task 1 的 `heroPhoto` 字段、Task 3 的相框渲染。
- Produces: 保存后的项目 `config_json` 含内嵌 `heroPhoto`（data URL + alt）；alt 由 `${姓名}的个人照片` 生成。

- [ ] **Step 1: 写失败测试** — 上传照片并选 macaron 生成 → 任务的 config 含 `heroPhoto`（预览 URL 形态）；项目保存后读回 config，`heroPhoto.assetUrl` 以 `data:image/` 开头（不依赖 avatar_assets 存活）；导出的单文件 HTML 内嵌原图；删除/过期 portrait 资产后分享页仍显示照片；非 macaron 模板上传照片仍走原生成门控（回归）；支付/交付套件全绿。
- [ ] **Step 2: 跑测试确认失败** — Run: `npm run test:payment`（存储与交付接口在列）。Expected: FAIL。
- [ ] **Step 3: 实现** — 门控拆分时保持 `allowPortraits` 语义只管「发送给图像供应商」；上传→保存全链不产生生成任务；镜像 `heroArtwork` 的保存内嵌与 `project-matching` 去重排除字段（`heroPhoto` 与 `heroArtwork` 一并剥离）。
- [ ] **Step 4: 跑测试确认通过** — Run: `npm run test:payment`、`npm test`。Expected: PASS。
- [ ] **Step 5: Commit** — `git commit -m "feat: 暖调马卡龙照片直出交付链路"`

### Task 7: 选择器接替、journey 马卡龙化与收尾

**Files:**
- Modify: `apps/web/src/components/BuilderExperience.tsx`（warm 预设替换为 `{ id: "macaron", templateId: "warm-macaron-v1", label: "暖调马卡龙", description: "马卡龙渐变 / 毛玻璃 / 衬线温柔", tone: "Aa / 你好", answers: 同原 warm }`）
- Modify: `apps/web/src/demo/showcaseDemo.ts`（demoTemplates 用 macaron 条目替换 warm 条目，background `#FED2BC`、foreground `#4A3840`；`defaultDemoDraft.templateId` 改 `warm-macaron-v1`）
- Modify: `apps/web/src/components/LaunchPage.tsx`（ComparisonScene 默认 `useState<TemplateId>("warm-macaron-v1")`）
- Modify: `apps/web/src/components/LaunchPage.css`（新增 `data-template="warm-macaron-v1"` 段落样式：渐变 hero 背景 + 衬线标题，删除或保留 warm-v1 段落样式以是否仍被引用为准）
- Modify: `AGENTS.md`（模板清单改为「赛博科技、像素世界风、暖调马卡龙、理性简约、大胆实验」，独立页面列表加入暖调马卡龙，照片表述补「直出展示时不发送给图像供应商」）
- Modify: `docs/web/README.md`（若列模板清单则同步）、`docs/README.md`（导航行补实施计划链接）
- Test: `BuilderExperience`、`DemoWorkbench`、`LaunchPage` 既有测试更新

**Interfaces:**
- Consumes: 前序全部任务。

- [ ] **Step 1: 写失败测试** — 选择器枚举五项且含「暖调马卡龙」不含「温暖创意」；demo 默认草稿为 macaron；journey 默认选中 macaron；问答自动匹配原 warm 答案组合落到 macaron。
- [ ] **Step 2: 跑测试确认失败** — Run: `npm test`。Expected: FAIL。
- [ ] **Step 3: 实现** — 按文件清单替换；journey 段落视觉为原创马卡龙样式（渐变 + 毛玻璃质感 + 衬线），不复制参考站素材。
- [ ] **Step 4: 全量回归** — Run: `npm test`、`npm run build`、`npm run test:skills`、`npm run test:agent`、`npm run test:payment`。Expected: 全部 PASS。
- [ ] **Step 5: 浏览器双检查** — 本机起 dev，390px/768px/1440px 三宽度走查模板页与首页 journey；有/无照片、有/无公开联系字段各验一遍。
- [ ] **Step 6: Commit** — `git commit -m "feat: 暖调马卡龙接替温暖创意入口并完成收尾"`
