# 模块级条目展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除新版 Agent“解析与补充”页的条目级展示选择，使可见模块默认包含全部条目。

**Architecture:** 保留 `item.included` 作为跨语言合同和旧草稿兼容字段，但从展示投影与基本信息确认中移除它的控制权。模块 `visible` 决定条目是否进入生成；字段 `fact.included` 继续负责敏感字段的精细选择。

**Tech Stack:** Next.js App Router、React、TypeScript、Vitest、Testing Library、共享 TypeScript contracts

**Spec:** `docs/superpowers/specs/2026-11-16-module-level-entry-display-design.md`

## Global Constraints

- commit 信息使用简体中文，函数名、变量名和专有名词保留英文。
- 不升级 `resume-draft-v2` Schema，不修改 Python Agent 私有协议。
- 字段级“展示”开关继续保留；旧浏览器解析兼容入口不改。
- Web、共享 TS 合同改动必须通过 `npm test`、`npm run build` 和 `git diff --check`。

## Review Focus

- 旧草稿中可见模块的 `item.included=false`：条目仍应进入投影（Task 1 新测试）。
- 隐藏模块中 `item.included=true`：条目仍不得进入投影（Task 1 新测试）。
- 条目自动包含时，`fact.included=false` 的敏感字段仍不得进入投影（Task 1 新测试）。
- 基本信息条目 `included=false`、但姓名和联系方式字段已选择：页面不得继续提示缺失（Task 2 新测试）。
- 待核对条目仍阻止确认，模块显示策略不得绕过核对（Task 2 现有确认测试 + 完整测试套件）。

---

### Task 1: 让模块可见性决定条目投影

**Files:**
- Modify: `packages/contracts/src/resume-draft.ts`
- Test: `apps/web/src/lib/resumeDraft.test.ts`

**Interfaces:**
- Consumes: `ResumeDraftSection.visible`、`ResumeDraftItem.included`、`DraftFact.included`
- Produces: `projectConfirmedResume(raw)` 在可见模块中按顺序投影全部条目，同时仍按 `fact.included` 过滤字段

- [ ] **Step 1: 写失败测试**

新增测试 `projects every item in a visible module without exposing unchecked facts`：构造可见项目模块，其中条目 `included=false`，断言条目进入作品集；给条目添加 `included=false` 的敏感字段，断言字段不进入作品集；再隐藏模块，断言整个项目模块不进入作品集。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- apps/web/src/lib/resumeDraft.test.ts`

Expected: FAIL，因为现有 `.filter(i => i.included)` 丢弃 `included=false` 条目。

- [ ] **Step 3: 实现最小合同修改**

在 `projectConfirmedResume` 中移除条目级 `included` 过滤，只保留模块 `visible` 和字段 `fact.included` 过滤；不修改 Schema 和类型。

- [ ] **Step 4: 运行目标测试并确认 GREEN**

Run: `npm test -- apps/web/src/lib/resumeDraft.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -f docs/superpowers/specs/2026-11-16-module-level-entry-display-design.md docs/superpowers/plans/2026-11-16-module-level-entry-display.md
git add packages/contracts/src/resume-draft.ts apps/web/src/lib/resumeDraft.test.ts
git commit -m "修复：可见模块默认包含全部条目"
```

### Task 2: 删除条目勾选框并解除确认依赖

**Files:**
- Modify: `apps/web/src/components/AgentEditor.tsx`
- Modify: `apps/web/src/app/editor/[resumeId]/page.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/app/editor/[resumeId]/page.test.tsx`

**Interfaces:**
- Consumes: Task 1 的模块级条目投影语义
- Produces: `EntryCard` 不再呈现或写入条目展示开关；`ResumeEditorPage` 的姓名/联系方式检查不再过滤 `item.included`

- [ ] **Step 1: 写失败测试**

新增测试 `uses the module switch for every entry while preserving field-level privacy controls`：加载可见的基本信息模块，令条目 `included=false`、姓名和邮箱字段 `included=true`；断言页面不存在“展示此条”，仍存在字段级“展示”，且不显示姓名/联系方式缺失提示。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- 'apps/web/src/app/editor/[resumeId]/page.test.tsx'`

Expected: FAIL，因为现有页面仍显示“展示此条”，且基本信息检查先过滤 `item.included`。

- [ ] **Step 3: 实现最小 UI 与确认修改**

- `EntryCard` 删除条目 checkbox，仅保留工具栏；更新组件注释。
- `ResumeEditorPage` 的 `selectedBasicFacts` 从模块全部条目收集已选择字段，不再过滤 `item.included`。
- 删除仅服务于条目 checkbox 的 CSS 规则，不改变条目工具布局和字段级 checkbox 样式。

- [ ] **Step 4: 运行目标测试并确认 GREEN**

Run: `npm test -- 'apps/web/src/app/editor/[resumeId]/page.test.tsx'`

Expected: PASS。

- [ ] **Step 5: 运行完整验证**

Run: `npm test && npm run build && git diff --check`

Expected: 全部通过，构建无错误，diff 无空白错误。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/AgentEditor.tsx 'apps/web/src/app/editor/[resumeId]/page.tsx' 'apps/web/src/app/editor/[resumeId]/page.test.tsx' apps/web/src/styles.css
git commit -m "优化：移除条目展示勾选"
```
