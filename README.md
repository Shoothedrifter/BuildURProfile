# BuildURProfile MVP

目标 Agent 架构与阶段迁移见 [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md)，当前执行清单见 [REFACTOR_PLAN.md](REFACTOR_PLAN.md)。当前代码已分为 `apps/web`、`apps/api` 和 `packages/contracts`；LangGraph worker 与异步生成 API 尚未接入。

浏览器内完成 **PDF → Resume JSON → Style Vector → Design Config JSON → Showcase 预览**。渲染骨架固定为 Marquee + StackedCards，使用 React、TypeScript、Vite、Tailwind CSS 和原生 CSS transition。

## 运行

```bash
npm install
npm run dev
```

打开 Vite 打印的本地地址。上传可选中文本的 PDF 后，必须核对姓名、工作经历、项目、技能、教育，才能进入 8 题测评。生成页可改展示文案、跑马灯图片、项目图片和交互强度；改动立即进入预览、Design Config JSON 与静态网站导出。首页的“查看视觉样例”使用 `apps/web/src/demo/config.json` 中的三板块 mock，保留三套皮肤切换。

PDF.js 和 worker 随页面本地打包，文件字节、提取文本和确认表单只存在浏览器内存中；应用没有 PDF 上传接口或 LLM 调用。每个展示字段在 JSON 的 `content.sourceRefs` 中保留 PDF 页码和原文摘录；在结果页手动修改文字后，对应的原文出处会从配置中移除，避免错误归因。当前分段规则已针对 `docs/黄琬斐_算法_大模型_Agent_副本.pdf` 和 `docs/个人简历（黄禹哲）.pdf` 验证；后者需要按 PDF 文字坐标恢复章节顺序，并识别没有日期的项目、条目式技能和校园经历。校园经历在导出 JSON 中单列。其他版式可能需要扩展规则。扫描件 OCR 尚未接入。触屏会保留卡片手动切换，并将滚动绑定的跑马灯降级为恒定滚动。

## 分享与离线导出

- 免费生成和编辑只显示本地预览。正式发布与离线 ZIP 需要所属项目在服务端具备已验证的付费资格；分享链接默认 7 天过期，可撤销，同项目重新发布不重复收费。接收者打开有效链接无需登录或付款。
- 服务端生成的 ZIP 含独立的 `index.html`，解压后可离线打开。编辑器上传的图片先嵌入发布配置；远程图片需由浏览器通过 CORS 读取并内嵌。已下载的 ZIP 无法撤回。
- 发布快照和 ZIP 只包含展示所需内容，服务端保存前移除 `content.sourceRefs` 中的 PDF 原文摘录；原 PDF 始终只在浏览器内解析。结果页的 Design Config JSON 可供用户核对，但不代表已付款或已发布。

## 代码入口

- `apps/web/src/lib/pdf.ts`：浏览器端 PDF 文字提取。
- `apps/web/src/lib/resume.ts`：简历分段、原文出处与数字校验。
- `apps/web/src/lib/assessment.ts`：8 题答案与 E/K/P/S 归一化。
- `apps/web/src/lib/mapping.ts`：纯函数 `styleToConfig(vector, jobRole)`。
- `apps/web/src/components/EditorPanel.tsx`：结果页文字、图片与交互强度编辑。
- `apps/api/src/service.mjs` 与 `apps/api/src/http.mjs`：项目归属、订单、支付资格、分享和下载的服务端校验。
- `apps/api/src/export.mjs` 与 `apps/web/src/export/standalone.tsx`：服务端离线 ZIP 打包与独立渲染入口。
- `packages/contracts/src/config.ts`：完整的 `DesignConfig` 合同。
- `apps/web/src/ShowcasePage.tsx`：固定骨架和三套 CSS 变量皮肤。
- `apps/web/src/lib/presentation.ts` 与 `apps/web/src/lib/resumePresentation.ts`：项目概述/详情、技能短标签和经历层级的保守展示规则。项目正文、完整技能和无法可靠分段的经历原文始终可读。
- `apps/web/src/fixtures/`：可提交的合成样例，用于前端与离线导出回归；本机真实简历样例继续忽略，不是构建依赖。

```bash
npm test
npm run build
npm run verify:export
```
# 支付沙箱联调（AI 网页应用收款）

当前正式发布与静态 ZIP 导出使用支付宝 **AI 网页应用收款** 的 `alipay.trade.page.pay`。PDF 仍在浏览器解析；只有用户确认后的 Design Config、展示素材和发布所需内容会送到本地服务端。免费生成、编辑和预览不需要付款。一个服务端项目 ID 的一次付款同时解锁正式分享与静态导出；新项目独立计费。

1. 复制 `.env.example` 为 `.env`，填写你自行确定的正整数 `PAYMENT_PRICE_FEN` 和站点地址。若已通过安装的支付宝 Skill 创建项目根目录 `.alipay-sandbox.json`，服务端会在沙箱模式下从该权限为 `0600` 的文件读取同一应用的 ID、PKCS#1 私钥、支付宝公钥及商户身份，不需要把密钥再复制进 `.env`。也可直接在 `.env` 中填写沙箱参数，并按密钥格式设置 `ALIPAY_PRIVATE_KEY_TYPE`。不要提交任何密钥文件。生产模式只读取独立的 `.env` 参数，不读取沙箱文件，且需要 HTTPS `PUBLIC_BASE_URL` 和公共 HTTPS `ALIPAY_NOTIFY_URL`。
2. 使用 Node 24+ 运行 `npm install`、`npm run dev`。它同时启动 8787 端口的 Node 服务和 5173 端口的 Vite，Vite 将 `/api` 代理给服务端。当前 5173 端口若已由旧 Vite 占用，先停止旧进程，再运行此命令。部署时运行 `npm run build`、`npm start`，并以反向代理或平台端口映射提供公网 HTTPS；容器环境可将 `SERVER_HOST=0.0.0.0`。
3. 在浏览器生成作品并点击“发布并分享”或“导出静态网站 ZIP”。服务端保存草稿并显示服务内容、服务端售价、两项解锁能力与 7 天链接有效期。确认后进入支付宝沙箱收银台；返回时服务端用 `alipay.trade.query` 查单，核实订单号和金额后继续原动作。异步通知采用官方 SDK 验签，并核对订单号、金额、app ID 和 seller。
4. 可用 `npm run test:payment` 跑支付逻辑与 HTTP 交付测试，`npm test` 跑前端测试，`npm run build` 跑类型检查和构建。自动测试的伪支付宝通知仅用于业务逻辑测试，**不代表沙箱实付成功**。

本地 `127.0.0.1` 不能接收支付宝服务器发出的异步通知。若要验证通知，请用公网 HTTPS 部署服务并将 `ALIPAY_NOTIFY_URL` 指向无重定向的 `/api/payment/notify`；用实际外部请求确认该地址可 POST 且不重定向。未配置该地址时，沙箱可用用户返回后的签名查单恢复支付；若用户未返回，可在项目页面重新点击原动作后查单。正式上线前需独立完成产品签约、生产密钥和网关配置、回调可达性、真实小额交易与退款售后流程核验。

沙箱数据默认写入 `data/buildurprofile.sqlite`，生产数据默认写入 `data/buildurprofile-production.sqlite`；也可用 `DATABASE_PATH` 指定独立持久盘。数据库在首次设置支付环境时会绑定到沙箱或生产，跨环境复用同一文件会拒绝启动。匿名会话签名密钥保存在 `data/session-secret`。这些文件都在 `.gitignore` 中。备份与部署时必须一起持久化；更换会话密钥会使原浏览器失去匿名项目归属。分享 token 只允许浏览已发布的快照，不能用于修改项目、查订单或下载。支付资格与交付状态分别记录；已付费但交付失败时资格仍保留，可重试；已下载的 ZIP 无法撤回。订单号与支付宝交易号可通过所属项目的 `GET /api/projects/:id/orders` 查询，供人工退款售后核对。仅在核实全额退款后才应撤销资格和有效分享；本次 demo 不提供自动退款后台。

## 生产部署（2026-10-28 签约已提交）

「AI 网页应用收款」签约已于 2026-10-28 经支付宝 Skill 提交（经营类目「在线工具」），正式应用 `2021007113619286` 已创建并提审、等待上线；两者生效前不能正式收款。生产配置只读 `.env`，不读取 `.alipay-sandbox.json`：

1. `PAYMENT_ENV=production`；`ALIPAY_APP_ID=2021007113619286`；`ALIPAY_PRIVATE_KEY` 为用户自持的 PKCS#1 私钥并设 `ALIPAY_PRIVATE_KEY_TYPE=PKCS1`；`ALIPAY_PUBLIC_KEY` 取自 `~/.config/2021007113619286-alipayPublicKey.keytext`（Skill 导出的支付宝公钥）。
2. `PUBLIC_BASE_URL` 为公网 HTTPS 域名；`ALIPAY_NOTIFY_URL` 指向无重定向的公网 HTTPS `/api/payment/notify`；网关自动切换为 `https://openapi.alipay.com/gateway.do`。
3. 生产数据写入独立的 `data/buildurprofile-production.sqlite`，与沙箱库互不兼容复用。
4. 上线前在支付宝商家平台「签约管理」补全收款信息，并完成公网通知验收、真实小额交易与退款售后核验。

