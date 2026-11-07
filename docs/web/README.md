# Web（Next.js 全栈应用）

`apps/web` 是基于 Next.js（App Router）+ React + TypeScript + Tailwind CSS 的全栈应用。前端负责浏览器内 PDF 解析、字段确认、八题测评、生成进度、编辑和作品展示；服务端通过 App Router Route Handlers 统一提供会话、任务、资产、支付与作品集交付接口。

## 用户流程与边界

文本型 PDF → 浏览器本地提取与解析 → 用户核对展示字段 → 选择职业并完成测评 → 提交已确认内容与答案到 Next.js API → Python Agent 生成配置 → 编辑与预览 → 付费分享或导出个人作品集网页。

- PDF 字节、提取全文及来源片段始终留在浏览器内存，不上传、不持久化；扫描件 OCR 未接入。
- **产品本体 vs. 交付产物**：`apps/web` 是生成器产品本体（全栈应用），不部署到 GitHub Pages；用户生成的**个人作品集页面（Showcase）**才是最终交付产物。
- 肖像是可选的本机 demo；照片在主动提交前只留在浏览器。提交时须说明会交给图像供应商处理。Wibi 产物的使用限制见[Agent](../agent/README.md)。

## 代码入口

| 路径（相对 `apps/web`） | 用途 |
| --- | --- |
| `src/app/layout.tsx`、`src/app/page.tsx` | Next.js 根布局与主页入口 |
| `src/app/payment/return/page.tsx` | 支付宝同步跳转返回恢复路由 |
| `src/app/api/[[...slug]]/route.ts` | 统一 API 与内部 Agent 协议 Route Handler |
| `src/app/healthz/route.ts`、`src/app/readyz/route.ts` | 健康与 Agent 就绪探针路由 |
| `src/server/` | 服务端核心实现（配置、会话/CSRF、项目与支付服务、生成与内部桥接路由、作品集 ZIP 打包） |
| `src/App.tsx` | 页面阶段、字段确认、异步任务与支付返回后的动作恢复 |
| `src/ShowcasePage.tsx`、`src/components/` | 固定作品骨架、跑马灯、堆叠卡片和编辑面板 |
| `src/lib/pdf.ts`、`src/lib/resume.ts` | 本地 PDF 提取与规则解析 |
| `src/lib/*Api.ts` | 带会话与 CSRF 的同源服务端请求 |
| `src/lib/presentation.ts`、`src/lib/resumePresentation.ts` | 项目、技能和经历的保守展示规则 |
| `src/demo/`、`src/fixtures/` | 公开视觉样例与合成回归样例 |

编辑后的展示配置用于预览和后续交付。远程编辑图片需通过浏览器 CORS 读取并嵌入为 Data URL，才能用于作品集发布与导出。

## 开发与验证

在仓库根目录运行 `npm run dev`，由 `apps/launcher` 启动 Next.js 开发服务与 Python Agent。完整环境与端口配置见[部署说明](../shared/deployment.md)。

```sh
npm test
npm run build
```

前端单测使用 Vitest（配置见根目录 `vitest.config.ts`），测试文件分布在源码旁，测试初始化位于 `src/test/setup.ts`。服务端接口与启动器说明见[API 与 Launcher](../api/README.md)。
