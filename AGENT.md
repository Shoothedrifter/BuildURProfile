# BuildURProfile 接手记录

更新：2026-10-27。此文件记录当前 MVP 的代码入口、支付沙箱事实和下一步联调，供后续开发者接手；`PROJECT.md`、`README.md` 与 `docs/qa/PAYMENT_SANDBOX.md` 是产品和验收背景。不要把这里的状态描述当作已经完成真实付款的证明。

## 运行与安全边界

- Node.js 24+；`npm run dev` 同时启动 Vite `http://127.0.0.1:5173` 和后端 `http://127.0.0.1:8787`。`npm run build` 包含 TypeScript 检查；`npm test`、`npm run test:payment`、`npm run verify:export` 分别覆盖前端、支付后端和离线导出。
- `.env`、`.alipay-sandbox.json`、`data/` 属于本机私有配置或持久状态，不得提交、贴入日志或复制到前端。根目录 `.alipay-sandbox.json` 由已安装的 `alipay-aipay` Skill 创建，权限必须是 `0600`。生产配置、数据库和沙箱隔离；本机 1 分价格仅用于沙箱。
- PDF 字节与解析结果留在浏览器内存；确认后的展示配置才会保存到服务端。免费预览不授予正式分享和 ZIP 下载。项目所有权绑定服务端匿名会话；支付事实由签名通知或签名查单核实，不接受客户端自报。

## 代码入口

- `src/App.tsx`：PDF 确认、测评、编辑、付费说明、支付返回后恢复原分享或导出动作。
- `src/lib/paymentApi.ts`：带 CSRF 的项目与交付 API；仅提交官方 SDK 生成且网关地址经过校验的 POST 支付表单。
- `server/index.mjs`、`server/config.mjs`、`server/gateway.mjs`：服务启动、环境配置、官方 `alipay-sdk` 的页面支付/验签/查单。
- `server/database.mjs`、`server/service.mjs`、`server/http.mjs`：持久项目/订单/资格/交付、订单核对、分享和下载的权限校验。
- `server/export.mjs`、`src/export/standalone.tsx`：服务端 ZIP 及离线展示。`types/config.ts` 是配置合同。

## 当前沙箱问题：扫码提示“二维码已经失效”

用户重新上传简历后生成了**新**项目和**新**待支付订单。检查时订单创建约 1 分钟，收银台显示服务名称、¥0.01 和二维码；服务器签名调用 `alipay.trade.query` 得到 `40004 / ACQ.TRADE_NOT_EXIST`，本地订单仍为 `PENDING`，资格和分享均未生成。不能把二维码报错或收银台页面显示解释成付款成功，也没有证据表明本次复用了上次的旧订单。

已安装的支付宝 Skill 说明：沙箱支付宝客户端仅支持 Android；普通支付宝或 iOS 客户端扫码不能作为沙箱验收方式。优先请用户在当前电脑收银台的“登录支付宝账户付款”区域使用**沙箱买家**账号及**支付密码**（页面提示这里不是登录密码）自行完成。不要代用户输入密码或点击最终付款。若必须扫码，使用 Skill 指向的官方 Android 沙箱支付宝，安装帮助在 <https://open.alipay.com/develop/sandbox/tool>。不要使用真实支付宝或真实收款码。沙箱买家账号信息只能按 Skill 已校验配置提供，不从猜测或示例取得。

若电脑账号支付也失败，记录收银台可见错误、重新签名查单、检查网关与商户身份；不要直接修改数据库为 `PAID`。付款说明区已增加仅在沙箱显示的扫码限制和电脑账号支付提示。`server/service.mjs` 当前会复用同项目任意 `PENDING` 订单；后续可针对**已由支付宝核实关闭或过期**的订单增加安全刷新逻辑，但不能仅因二维码报错就把可能已付款的订单作废。保留旧订单以查单追回迟到付款，防止重复收费。

## 付款后必须完成的验收

1. 由用户自行完成沙箱付款。返回站点后执行服务端 `alipay.trade.query`；只有核对订单号、金额、商户身份并见到 `TRADE_SUCCESS` / `TRADE_FINISHED`，才认定资格已发放。
2. 核实原动作自动继续：正式分享生成 7 天 token 或 ZIP 下载；同项目第二种交付不再要求支付，另一项目仍需单独购买。
3. 打开分享链接并检查带 `#share=…` 的页内锚点；下载 ZIP 并断网打开 `index.html`。刷新与重启后复核持久资格。未付费直接请求发布/导出必须被拒绝。
4. 本机没有公网 HTTPS `notify_url`，无法验证支付宝异步回调；当前依赖用户返回后的签名查单。部署公网回调后再验签名、幂等和丢通知补偿。退款后台、生产签约、生产真实付款属于独立上线工作。

## 当前验证口径

当前本地记录：增加沙箱提示后 `npm run build`、`npm test`（84 项）、`npm run test:payment`（26 项）通过；之前 `npm run verify:export` 通过，但提示修改后未重跑。上述均是付款之前的结果。沙箱实付、支付后分享及 ZIP 闭环**尚未验证**。最新事实以数据库、支付宝签名查单和浏览器实际交付为准，不能用模拟通知测试替代。
