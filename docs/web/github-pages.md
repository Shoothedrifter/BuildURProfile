# GitHub Pages 静态预览

Pages 只托管浏览器预览：PDF 本地解析、字段确认、八题测评、编辑与展示。它不运行 Node 或 Python，不保存项目，也不提供支付、正式分享或 ZIP。刷新后重新开始是预期行为。

## 构建与发布

在仓库根目录使用 Node.js 24+：

```sh
npm ci
npm test
npm run build:pages
```

`pages` 模式将资源基路径设为 `/BuildURProfile/`，输出到 `apps/web/dist/`。此模式无需环境变量文件、数据库或 Docker。

1. 在 GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 将待发布代码推送到 `main`，或在 Actions 中手动运行 **Deploy static preview to Pages**。
3. 检查 Pages 工作流的测试、构建、上传和发布步骤，并另行查看 CI 结果；两份工作流独立运行。
4. 以 Settings → Pages 显示的地址为准。当前仓库对应的预期地址为 <https://shoothedrifter.github.io/BuildURProfile/>，这不是可用性验收记录。

工作流配置见 [pages.yml](../../.github/workflows/pages.yml)。变更仓库名或发布路径时须同步调整 Vite 的资源基路径。

## 公开页面验收

- 首页、视觉样例与静态资源正常显示。
- 上传可选中文本的 PDF，核对字段，完成八题，检查 JSON 与网页预览。
- 结果页显示静态预览不保存作品，不出现支付、分享或 ZIP 按钮。
- 网络请求中没有生成、项目或支付 API 调用，也没有上传 PDF。
- 刷新后作品清空。

工作流成功只证明构建和发布步骤完成；完整用户流程需在公开地址人工验收。

## 排查

| 现象 | 检查 |
| --- | --- |
| 工作流不触发 | 工作流是否在 `main`，Actions 是否启用 |
| Pages 未启用 | Source 是否为 GitHub Actions |
| 页面空白或资源 404 | 地址与构建资源路径是否包含 `/BuildURProfile/` |
| 页面请求 `/api` | 是否误用了普通构建而非 `npm run build:pages` |

需要服务端保存和付费交付时，使用[完整部署](../shared/deployment.md)，Pages 发布不能代替后端部署。
