# Web（Next.js 全栈应用）

`apps/web` 是基于 Next.js（App Router）+ React + TypeScript + Tailwind CSS 的全栈应用。新简历流程上传 PDF 并交给 Python Agent 解析，前端负责核对、八题测评、生成进度、编辑和作品展示；服务端通过 App Router Route Handlers 提供会话、私有 PDF、解析任务、资产、支付与作品集交付接口。

## 用户流程与边界

文本型 PDF → `/upload` 私有上传 → Web 复用浏览器解析算法固定模块和条目 → Agent `resume-parse-v2` 对齐来源并逐条排版 → `/editor/:resumeId` 对照原 PDF 核对十模块并保存 → `/style/:resumeId` 选择职业并完成测评 → 仅提交确认内容与答案 → Python Agent `python-agent-v2` 生成配置 → 编辑与预览 → 付费分享或导出个人作品集网页。

- 新流程的原 PDF、来源块与私有草稿从上传起在受会话保护的服务端保留 30 天，可提前删除；Agent 仅向当前配置的 OpenAI 或智谱 GLM 文本供应商发送逐条格式化必需的文字。编辑页可刷新后继续预览原件，也可从同一原件建立新草稿重新解析；扫描件 OCR 未接入。
- 首页保留明确标注的“浏览器解析（兼容）”入口；该旧路径的 PDF 与候选内容仍只留在浏览器内存。新流程模型失败时不会回退到旧路径并假称 AI 解析成功。
- 确认页覆盖基本信息、求职意向、自我评价、教育、实习/工作、项目、奖项、校园、技能和其他内容。浏览器解析产出带来源、页码和展示选择的 `ResumeCandidateV2`，工作与校园经历是两个独立数组；识别结果可选择展示或调整分类，个人细节与期待薪资默认关闭。确认后生成 `resume-v1` 结构化内容，来源页码和原文不会进入生成 brief。
- **产品本体 vs. 交付产物**：`apps/web` 是生成器产品本体（全栈应用），不部署到 GitHub Pages；用户生成的**个人作品集页面（Showcase）**才是最终交付产物。
- 肖像是可选的本机 demo；照片在主动提交前只留在浏览器。提交时须说明会交给图像供应商处理。Wibi 产物的使用限制见[Agent](../agent/README.md)。

## 代码入口

| 路径（相对 `apps/web`） | 用途 |
| --- | --- |
| `src/app/layout.tsx`、`src/app/page.tsx` | Next.js 根布局与主页入口 |
| `src/app/payment/return/page.tsx` | 支付宝同步跳转返回恢复路由 |
| `src/app/upload/page.tsx`、`src/app/editor/[resumeId]/page.tsx`、`src/app/style/[resumeId]/page.tsx` | Agent 上传、十模块核对与风格选择 |
| `src/app/api/[[...slug]]/route.ts` | 统一 API 与内部 Agent 协议 Route Handler |
| `src/app/healthz/route.ts`、`src/app/readyz/route.ts` | 健康与 Agent 就绪探针路由 |
| `src/server/` | 服务端核心实现（配置、会话/CSRF、项目与支付服务、生成与内部桥接路由、作品集 ZIP 打包） |
| `src/App.tsx` | 页面阶段、字段确认、异步任务与支付返回后的动作恢复 |
| `src/components/BuilderExperience.tsx`、`BuilderChrome.tsx` | 六屏制作流程、暖色描边导航、进度、资料模块和交付状态 |
| `src/ShowcasePage.tsx`、`src/components/` | 固定作品骨架、跑马灯、堆叠卡片和编辑面板 |
| `src/lib/pdf.ts`、`src/lib/resume.ts` | 本地 PDF 提取与规则解析 |
| `src/lib/*Api.ts` | 带会话与 CSRF 的同源服务端请求 |
| `src/lib/presentation.ts`、`src/lib/resumePresentation.ts` | 项目、技能和经历的保守展示规则 |
| `src/demo/`、`src/fixtures/` | 公开视觉样例与合成回归样例 |

编辑后的展示配置用于预览和后续交付。远程编辑图片需通过浏览器 CORS 读取并嵌入为 Data URL，才能用于作品集发布与导出。

“我的项目”支持二次确认后删除：已打开的项目删除成功后返回首页，现有分享和未使用的下载链接失效；待核实支付订单的项目会显示服务端拒绝原因。

作品页将姓名、联系方式映射到首屏与联系区，技能映射到技能区和 Marquee，项目映射到 StackedCards；实习/工作经历、校园经历和教育背景分别渲染为独立区块。求职意向、自我评价、荣誉奖项和其他内容各有展示位置。无内容的区域不渲染。旧作品配置没有 `resume` 时继续按原有字段展示。

## 开发与验证

在仓库根目录运行 `npm run dev`，由 `apps/launcher` 启动 Next.js 开发服务与 Python Agent。完整环境与端口配置见[部署说明](../shared/deployment.md)。

```sh
npm test
npm run build
```

前端单测使用 Vitest（配置见根目录 `vitest.config.ts`），测试文件分布在源码旁，测试初始化位于 `src/test/setup.ts`。服务端接口与启动器说明见[API 与 Launcher](../api/README.md)。

## 核对与补充内容

核对页保留三栏原 PDF 对照和逐条来源摘录。低置信度条目须明确点击「已核对」，编辑内容不会自动确认；置信度提示仍保留。隐藏待核对模块需要确认，完成后才清除该模块的待核对标记。未完成核对不能进入风格页。

每条可补充 500 个 Unicode 码点、5 个 HTTP(S) 链接（名称可选）和 6 张图片。全份上限为 24 张 / 50 MiB、单张 5 MiB；上传实际格式和尺寸由服务端复核。保存时丢弃完全空白的链接行，有名称无 URL、非法协议或超限时定位模块并阻止提交。显式保存使用 revision 检测冲突，失败保留本地修改。

新流程生成只提交已保存的 `resumeId/revision`、角色和答案，服务端重新投影。`resume-v2.sections` 是确认内容的真相，补充信息跟随原条目进入预览、项目编辑、分享和导出。项目仍使用 StackedCards，工作与校园独立展示；正文保留换行，不为排版拆成多个条目。v3 无肖像生成成功会在「我的项目」出现未付款草稿，后续交付保存到同一项目；刷新恢复任务也恢复项目 ID。

私有原件到期后，已有项目图片继续通过独立作品资产读取。图片权限及保留规则见[架构与协议](../shared/architecture.md#简历图片与作品资产)。旧 `resume-v1` 项目继续使用兼容展示和编辑路径。
