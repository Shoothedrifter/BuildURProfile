# GitHub Pages 静态预览部署

这份部署只开放 PDF 本地解析、字段确认、8 题测评、编辑和网页预览。浏览器刷新后当前作品会消失；没有服务端草稿、分享链接、ZIP 下载或支付。PDF 字节和提取文本留在浏览器内存，不上传服务器。

## 当前发布记录（2026-10-30）

静态预览代码已随提交 `496f4a3` 推送到 `main`。该提交的 [CI](https://github.com/Shoothedrifter/BuildURProfile/actions/runs/41000252698) 和 [Pages 发布](https://github.com/Shoothedrifter/BuildURProfile/actions/runs/41000252695) 均显示成功，包括 `deploy-pages` 步骤。预计公开地址为 <https://shoothedrifter.github.io/BuildURProfile/>；仍需在公开网址执行下文第 5 步，完成用户流程验收。

## 仓库已准备的代码

- `npm run build:pages` 使用 Vite 的 `pages` 模式，把资源基路径设为 `/BuildURProfile/`，输出到 `apps/web/dist`。
- `apps/web/src/App.tsx` 在 `pages` 模式跳过服务端 API 请求，并隐藏分享、导出和支付界面。普通 `npm run dev` / `npm run build` 保留原有 Node API 流程。
- `.github/workflows/pages.yml` 在 `main` 推送后运行前端测试、构建并上传静态文件，然后发布到 GitHub Pages。

## 发布与复核

1. 在仓库根目录确认 Node.js 24+，然后验证静态版本：

   ```bash
   node --version
   npm ci
   npm test
   npm run build:pages
   ```

2. 登录 GitHub，打开仓库 `Shoothedrifter/BuildURProfile` 的 **Settings → Pages**。在 **Build and deployment → Source** 选择 **GitHub Actions**。不要选择 `Deploy from a branch`，因为仓库里的 Vite 源码必须先构建。
3. 确认要发布的代码已经推送到 `main`。当前静态预览的首个提交为 `496f4a3`；后续有改动时，先检查待提交内容，再提交和推送。`git add -u` 只暂存已跟踪文件；新增的公开文件须逐个指定，私有配置和 `data/` 不得提交。

   ```bash
   git status --short
   git add -u
   git diff --cached --stat
   git commit -m "docs: update deployment record"
   git push origin main
   ```

4. 打开仓库 **Actions**，分别查看 `CI` 和 `Deploy static preview to Pages`。等待 Pages 工作流里的 `Deploy to GitHub Pages` 完成。首次发布地址预计为 <https://shoothedrifter.github.io/BuildURProfile/>；实际地址以 **Settings → Pages** 显示的为准。
5. 在公开地址依次检查：主页和视觉样例；上传一份可选中文本的 PDF；确认字段；完成 8 题；查看 Design Config JSON 和网页预览。结果页应显示“静态预览版不会保存作品”，不应出现分享、支付或 ZIP 按钮。刷新页面后重新开始是当前版本的预期行为。

## 后续更新

每次向 `main` 推送代码，`pages.yml` 都会重新测试、构建和发布。若仅需手动重跑，在 Actions 中打开 `Deploy static preview to Pages`，选择 **Run workflow**。静态部署不需要 `.env`、SQLite、Railway、Render 或 Docker。

## 排查

- **Actions 没有触发：** 确认 `.github/workflows/pages.yml` 已推送到 `main`，仓库 Actions 已启用。
- **部署失败且提示 Pages 未启用：** 再检查 **Settings → Pages → Source** 是否选择了 **GitHub Actions**。
- **页面空白或 JS/CSS 404：** 检查公开网址是否包含 `/BuildURProfile/`，并在 `apps/web/dist/index.html` 中确认资源路径包含该前缀。
- **页面能打开但尝试请求 `/api`：** 确认工作流运行的是 `npm run build:pages`，不是 `npm run build`。
