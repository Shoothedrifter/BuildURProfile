# 2026-11-16 集成合并与解析页展示

此页记录当时的合并决定；当前规则以[产品约束](../shared/product.md)、[Web 说明](../web/README.md)和[支付与交付](../api/payment.md)为准。

## 合并依据

- `80b8e22` 将 Marshui 分支末端提交 `dd28a10`（含其祖先中的支付和导出开发）合入 `integration`，解决简历流程与交付层冲突。保留支付宝下单、签名通知、签名查单和服务端分享资格校验；为简历流程衔接了图片读取与单文件 HTML 导出。
- 经产品确认，采用待合并分支的交付规则：生成、编辑、预览及单文件 HTML 导出免费；正式发布分享按项目付费。导出仍由服务端核对项目所属会话。此决定不代表生产支付或公网回调已经验收。
- `0c8a9b7` 随后合入 `dev/noodle` 的解析页模块级展示改动。新版“解析与补充”页删除条目级勾选框；开启模块即纳入该模块全部条目，关闭模块则不纳入。字段级隐私开关、待核对门槛和原 PDF 对照保留。旧 `item.included` 字段保留用于草稿合同兼容，但不参与新版展示投影。

## 验证与后续

合并时运行了 `npm test`、`npm run build`、`npm run test:payment`、`npm run test:skills` 和 `npm run test:agent`；这些本地检查不能替代真实支付宝付款、公网通知和真实模型/图像供应商验收。上线门槛见[支付文档](../api/payment.md)及[Agent 说明](../agent/README.md)。

分支名、工作区未跟踪文件和远端同步状态属于临时工作状态，使用 `git status --short --branch`、`git worktree list` 与 `git log` 实时核对，不在此页固化。
