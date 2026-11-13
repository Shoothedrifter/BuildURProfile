# Figma 启航页产品级融合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将根路径 `/` 改造成符合 Figma `67:74` 行业标准的产品启航页，同时保留真实 Agent 上传、作品样例、我的项目和旧浏览器解析入口。

**Architecture:** 新建无业务数据依赖的 `LaunchPage` 展示组件；`BuilderExperience` 在 `phase="landing"` 时单独渲染该组件和现有项目弹窗，其他 phase 继续使用 `BuilderChrome`。首页全部样式使用 `launch-*` 命名空间，避免影响上传、编辑、风格、生成和交付页面。

**Tech Stack:** React 19、Next.js App Router、TypeScript、CSS、Vitest、Testing Library

**Spec:** `docs/superpowers/specs/2026-11-14-figma-launch-page-design.md`

## Global Constraints

- 不新增 UI 框架、字体包或运行时依赖。
- `apps/web/public/logo.png` 是唯一图片资产；Hero 与案例预览使用 HTML/CSS。
- 主 CTA 使用真实 `<a href="/upload">`，不通过客户端状态模拟 Agent 上传页。
- 旧浏览器解析只调整入口层级，不修改解析合同或行为。
- 隐私政策、服务条款、联系我们没有真实路由前只展示普通文本。
- 新增 CSS 必须限定在 `launch-*` 命名空间，不能改变内部工作流共用组件的视觉。
- commit 信息使用简体中文，函数名、变量名和专有名词保留英文。

## Review Focus

- 浏览器缺少 `Element.scrollIntoView` 时，点击“查看样例”不得抛错或阻断其他交互；Task 1 测试覆盖。
- 首页存在多个“查看样例”文案时，滚动按钮和打开 Showcase 的按钮不得串线；Task 1 测试使用独立可访问名称覆盖。
- 项目列表异步加载后，“我的项目”可显示最新数量并打开原弹窗；Task 2 的 `App` 集成测试覆盖。
- 从兼容解析返回首页后，首页不得残留工作流 Chrome 或进度条；Task 2 的往返测试覆盖。
- 320px 视口不得产生页面级横向溢出；Task 3 以浏览器尺寸检查和截图覆盖。

---

### Task 1: 启航页语义结构与交互合同

**Files:**
- Create: `apps/web/src/components/LaunchPage.tsx`
- Create: `apps/web/src/components/LaunchPage.test.tsx`

**Interfaces:**
- Consumes: `projectCount: number` 和父层提供的三个同步回调。
- Produces: `LaunchPage({ projectCount, onProjects, onSample, onLegacyParse }: LaunchPageProps): JSX.Element`。

- [ ] **Step 1: 写失败测试 `renders the Figma launch information architecture with real destinations`**

断言两个主 CTA 的 `href` 均为 `/upload`；页面包含 Hero、四项产品价值、三张案例和三步流程；页脚中的隐私政策、服务条款、联系我们不是链接。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- apps/web/src/components/LaunchPage.test.tsx`

Expected: FAIL，因为 `LaunchPage.tsx` 尚不存在。

- [ ] **Step 3: 写失败测试 `keeps scrolling, samples, projects and legacy parsing as separate actions`**

为 `scrollIntoView` 提供 mock；点击顶部/ Hero 的样例滚动按钮时断言滚动到 `#launch-examples`；点击三张案例的独立可访问按钮时断言 `onSample`；点击“我的项目”断言 `onProjects`；点击“使用浏览器解析（兼容）”断言 `onLegacyParse`。删除 `scrollIntoView` 后再次点击滚动按钮，断言不抛错。

- [ ] **Step 4: 实现 `LaunchPage`**

实现固定的 Figma 信息架构、语义化 `header/main/section/footer`、原生 `/upload` 链接和四类回调。滚动逻辑使用内部 `scrollToExamples(): void`，在调用前检查 `scrollIntoView` 是否存在。案例按钮使用如“查看体验设计作品集样例”的唯一 `aria-label`。

- [ ] **Step 5: 运行组件测试确认通过**

Run: `npm test -- apps/web/src/components/LaunchPage.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/LaunchPage.tsx apps/web/src/components/LaunchPage.test.tsx
git commit -m "功能：新增 Figma 启航页结构"
```

### Task 2: 接入现有工作流与项目弹窗

**Files:**
- Modify: `apps/web/src/components/BuilderExperience.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `LaunchPageProps`；现有 `ProjectsDialog`、`go("upload")`、`go("mock")`、`onResumeProject`、`onDeleteProject`。
- Produces: `phase="landing"` 的独立启航页分支；非 landing phase 保持现有 `BuilderChrome` 行为。

- [ ] **Step 1: 更新首页集成测试并确认旧实现失败**

将原首页标题断言更新为“把一份 PDF 简历，变成你的个人网站”；断言“开始生成”链接到 `/upload`；点击“我的项目”仍打开原对话框；点击任一“浏览器解析（兼容）”入口后出现旧上传页标题“从你的简历开始”；从旧上传页返回后重新出现新 Hero，且不再显示进度导航。

Run: `npm test -- apps/web/src/App.test.tsx`

Expected: FAIL，旧首页标题和入口层级不符合新合同。

- [ ] **Step 2: 在 `BuilderExperience` 接入 `LaunchPage`**

在 `mock` 特例之后、`BuilderChrome` 之前增加 landing 分支；用 `.launch-shell` 包住 `LaunchPage` 和 `ProjectsDialog`。将回调映射为 `onProjects={() => setProjectsOpen(true)}`、`onSample={() => go("mock")}`、`onLegacyParse={() => go("upload")}`。删除旧 landing JSX 和不再使用的 `BrandPreview`。

- [ ] **Step 3: 运行首页和组件测试**

Run: `npm test -- apps/web/src/App.test.tsx apps/web/src/components/LaunchPage.test.tsx`

Expected: PASS；原项目删除、样例打开和兼容解析测试继续通过。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/BuilderExperience.tsx apps/web/src/App.test.tsx
git commit -m "功能：首页接入真实工作流入口"
```

### Task 3: 对齐 Figma 视觉与响应式标准

**Files:**
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 1 输出的 `launch-*` DOM 类名。
- Produces: 1440px 基准、1100px 平板和 760px/320px 手机布局；不影响 `.proof-*` 内部页面。

- [ ] **Step 1: 添加首页视觉样式**

实现 Figma 令牌：背景 `#fff5ef`、正文 `#262626`、弱文本 `#70645d`、边框 `#d8c8be`、主色 `#ffbe98`、白色卡片、12px 圆角；内容最大宽度 1280px、桌面外边距 80px。Hero 使用约 620/636 双列，价值区四列、案例区三列、流程区三列。

- [ ] **Step 2: 添加交互与无障碍样式**

为链接和按钮提供一致 hover/focus-visible；点击目标保持至少 44px；只使用轻量颜色/位移过渡；在 `prefers-reduced-motion: reduce` 中关闭过渡和滚动行为。

- [ ] **Step 3: 添加响应式样式**

1100px 下 Hero、价值卡重排；760px 下导航换行、所有内容单列、标题降级、按钮可触摸；320px 下不得出现固定最小宽度或页面级横向溢出。

- [ ] **Step 4: 运行自动化验证**

Run: `npm test`

Expected: 全部 PASS。

Run: `npm run build`

Expected: TypeScript 和 Next.js production build 成功。

- [ ] **Step 5: 浏览器视觉验收**

启动 `npm run dev`，分别以 1440px 和 320px 打开 `/`：核对 Hero、四项价值、三张案例、三步流程、Logo、主 CTA、样例滚动、项目弹窗和兼容入口；保存桌面与移动截图到 `docs/qa/`。同时打开 `/upload` 和旧浏览器解析页，确认其 `.proof-*` 样式未被首页 CSS 改写。

- [ ] **Step 6: 最终检查并提交**

Run: `git diff --check`

Expected: 无空白错误。

```bash
git add apps/web/src/styles.css docs/qa/figma-launch-1440.png docs/qa/figma-launch-320.png
git commit -m "样式：首页对齐 Figma 行业标准"
```

### Task 4: 完整回归与交付审阅

**Files:**
- Modify only if verification finds defects in files owned by Tasks 1-3.

**Interfaces:**
- Consumes: Tasks 1-3 的完整首页实现。
- Produces: 可交付的首页改造和验证记录。

- [ ] **Step 1: 执行完整检查**

Run: `npm test && npm run build && git diff --check`

Expected: 所有命令退出码为 0。

- [ ] **Step 2: 对照设计文档逐项复核**

确认主 CTA、真实样例、项目弹窗、兼容入口、无假链接、桌面布局和移动布局均满足 spec；确认 `/upload`、编辑器、风格页、结果页未被改动。

- [ ] **Step 3: 检查工作区与提交历史**

Run: `git status --short --branch && git log -4 --oneline`

Expected: 仅存在明确说明的验证产物或工作区干净；本功能所有 commit 信息为简体中文。
