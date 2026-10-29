# BuildURProfile Agent 架构方向（设计草案）

日期：2026-10-30。此文记录已确定的第一版边界与后续目标；不是实现完成记录。

## 已确定的方向

- 第一版沿用 `PROJECT.md` 的固定 Marquee + StackedCards 骨架，生成可预览、可编辑、可导出的 HTML 网站。
- 采用 `apps/web`、`apps/api`、`apps/worker` 与共享 `packages/*` 的分层。生成任务由 LangGraph.js 组织为显式节点；支付和发布保持确定性的服务端业务逻辑。
- 用户上传 PDF 后启动生成流程；PDF 字节与原始解析结果留在浏览器。用户确认展示内容后，才把交付所需的公开副本保存到服务端。付款与正式发布仍是独立的主动操作。
- 后续目标是支持生成任意 HTML 模板。该目标单列为第二阶段，届时需重新评估 `PROJECT.md` 的固定骨架限制，并增加隔离代码生成、构建和安全验收流程。

## 为什么 LangGraph 不必强制调用模型

LangGraph 管理状态、分支、暂停、重试和恢复。一个节点可以是普通 TypeScript 函数、外部工具调用，也可以是模型调用。浏览器 PDF 提取和用户确认位于服务端图工作流之前；付款核实与正式发布属于独立业务流程。当前的 PDF 文本提取、规则分段、8 题评分、`styleToConfig` 映射、schema 校验、可信组件渲染、付款核实和 ZIP 导出均有确定性实现，不因采用 LangGraph 而自动需要模型。

第一版的默认路径应在没有模型服务时仍能完成“PDF → 确认 → DesignConfig → HTML 预览”。模型只用于有明确非确定性输入的分支：

| 步骤或节点 | 输入 | 模型是否必要 | 预期输出 |
| --- | --- | --- | --- |
| 浏览器预处理：`extractResume` | 浏览器中的 PDF | 否；继续使用 PDF.js 与解析规则 | `ResumeDraft`，附原文出处 |
| 浏览器确认：`confirmContent` | 草稿与用户修改 | 否；用户确认后创建生成任务 | `ConfirmedContent` |
| `scoreStyle` | 职业与 8 题答案 | 否 | E/K/P/S、基础 `DesignConfig` |
| `retrieveDesignReferences` | 风格标签或检索词 | 否；可直接调用 MotionSites MCP | 带来源 ID 的候选参考 |
| `interpretDesignIntent` | 用户自由描述或参考图 | 可选；只有此类输入出现才调用 | 受 schema 约束的 `DesignBrief` |
| `adaptDesignRecipe` | 设计参考、风格偏好、允许的组件参数 | 可选；规则映射不足时调用 | 受 schema 约束的 `SiteSpec` 候选 |
| `validateAndRender` | `SiteSpec` 与确认内容 | 否 | HTML 预览与 ZIP 候选 |
| `verifyArtifact` | 生成物与验收规则 | 否；先用浏览器与程序检查 | 检查结果、可恢复错误 |
| 独立交付流程：`publish` | 用户主动请求与已验证资格 | 否；不作为设计 Agent 的自由工具 | 分享或 ZIP 交付 |

模型节点不得接收 PDF 原文、姓名、邮箱或项目详情，除非未来的产品设计明确改变这一隐私合同并得到用户确认。模型输出是设计数据，不是可执行的 React、HTML、CSS 或 JS。校验失败时使用现有确定性映射。MotionSites 提示词和第三方 skills 属外部参考材料，不能代替项目权限、schema 或构建验收。

## 方案权衡

1. **只用现有规则与 LangGraph：** 最小风险，可先完成架构迁移、任务状态和可恢复交付；设计多样性受现有参数限制。适合作为第一条可运行基线。
2. **LangGraph 加按需模型节点（推荐演进）：** 自然语言风格要求、参考图或多个设计参考的适配有更大空间；增加成本、延迟和不确定性，因此输出必须受 `SiteSpec` schema 与视觉验收约束。
3. **自由代码生成 Agent：** 能接近任意模板目标，但改变第一版固定骨架合同，需要独立沙箱、依赖白名单、离线构建、视觉及安全验收。留到第二阶段。

## 待确认

第一版是否要支持用户用自然语言描述想要的网站风格？若不支持，首个正式版本可完全不调用模型，先建立 LangGraph 节点与状态合同。若支持，先只加入 `interpretDesignIntent` / `adaptDesignRecipe` 中确有需要的模型节点。
