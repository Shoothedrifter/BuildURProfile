# Web

`apps/web` 是 React + TypeScript + Vite 应用，负责浏览器内 PDF 解析、字段确认、八题测评、生成进度、编辑和作品展示。

## 用户流程

文本型 PDF → 提取与解析 → 用户核对展示字段 → 选择职业并完成测评 → 生成 → 编辑与预览。PDF 字节、提取全文及来源片段不上传、不持久化；扫描件 OCR 未接入。

| 模式 | 生成方式 | 保存与交付 |
| --- | --- | --- |
| 本机或完整 API | 提交已确认内容与答案到 Node，由 Python Agent 生成配置 | 项目、付费分享与 ZIP 由 API 管理 |
| Pages | 浏览器 TS Skills 完成评分、映射和内容组装 | 无 API、支付、分享和 ZIP；刷新后作品消失 |

肖像是可选的本机 demo；照片在主动提交前只留在浏览器。提交时须说明会交给图像供应商处理。Wibi 产物的使用限制见[Agent](../agent/README.md)。

## 代码入口

| 路径（相对 `apps/web`） | 用途 |
| --- | --- |
| `src/App.tsx` | 页面阶段、字段确认、异步任务与支付返回后的动作恢复 |
| `src/ShowcasePage.tsx`、`src/components/` | 固定作品骨架、跑马灯、堆叠卡片和编辑面板 |
| `src/lib/pdf.ts`、`src/lib/resume.ts` | 本地 PDF 提取与规则解析 |
| `src/lib/*Api.ts` | 带会话与 CSRF 的服务端请求 |
| `src/lib/presentation.ts`、`src/lib/resumePresentation.ts` | 项目、技能和经历的保守展示规则 |
| `src/export/standalone.tsx` | ZIP 内离线网页的独立渲染入口 |
| `src/demo/`、`src/fixtures/` | 公开视觉样例与合成回归样例 |

编辑后的展示配置用于预览和后续交付。JSON 下载不代表已经付费或发布。远程编辑图片需通过浏览器 CORS 读取并嵌入，才能用于离线交付。

## 开发与验证

在仓库根目录运行 `npm run dev`，Vite 将 `/api` 代理到 Node。完整环境与端口配置见[部署说明](../shared/deployment.md)。

```sh
npm test
npm run build
npm run verify:export
```

前端测试分布在源码旁，测试初始化位于 `src/test/setup.ts`。离线渲染产物由 `vite.export.config.ts` 生成到 `apps/web/public/export/`，属于生成文件。

静态构建和发布步骤见[GitHub Pages](github-pages.md)。
