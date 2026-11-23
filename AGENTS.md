# BuildURProfile 开发约束

本文件只记录当前通用规则。模块说明见[文档导航](docs/README.md)，运行与配置见[部署说明](docs/shared/deployment.md)，跨模块合同见[架构与协议](docs/shared/architecture.md)。历史归档不是开发前置资料。提交信息使用简体中文，函数名、变量名和专有名词保留英文。

## 模块职责

- `apps/web`：Next.js（App Router）全栈应用；新流程上传 PDF 并核对 Agent 草稿，旧浏览器解析是兼容入口；服务端通过 Route Handlers 提供会话、CSRF、私有 PDF、项目、任务、资产、支付核实、交付与内部 Agent 接口。
- `apps/launcher`：服务启动、联调编排、集成测试与容器化部署入口（负责协调启动 Next.js Web 与 Python LangGraph Agent）。
- `apps/agent`：Python FastAPI + LangGraph；通过私有 HTTP 协议领取任务并调用版本化 Skills。无照片作品同样必须经过图执行。
- `packages/contracts`：展示合同、运行时校验、JSON Schema 和黄金样例。
- `packages/skills`：浏览器与 TS Skills、固定模板映射、旧评分兼容及 Node 风格资源校验；Python 有独立 Skill 注册表。
- `packages/storage`：Node PostgreSQL 迁移、任务租约与资产存储；Agent 不直接访问支付数据库。

## 重要概念澄清（产品本体 vs. 交付产物）

- **产品本体（BuildURProfile 应用）**：是全栈 Next.js + Python Agent 应用，必须依赖服务端会话、生成工作流与数据库运行；**产品本体不部署到 GitHub Pages，也不打包为离线静态版**。
- **最终产物（用户作品集 Showcase Web 页面）**：是用户上传简历、核对展示内容并选择固定模板后生成的个人作品集页面，支持通过服务端分享链接或作品集导出接口交付给用户。

## 运行与配置

- Node.js 22.12+（推荐 24+）、Python 3.11+、uv 0.11.x；先运行 `npm ci` 和 `uv sync --project apps/agent --frozen --extra test`。
- `npm run dev` 通过 `apps/launcher` 同时启动 Next.js Web（5173）和 Python Agent（8788）；`npm start` 启动 Next.js 生产服务（默认 8787），完整生成还需运行 Agent。
- 环境变量样例位于 `apps/launcher`、`apps/agent`、`deploy`。实际加载位置保持在仓库根目录（`.env`、`.env.api`、`.env.agent`）或注入进程环境。
- 启动脚本已自动检测 Unix（`apps/agent/.venv/bin/python`）与 Windows（`apps/agent/.venv/Scripts/python.exe`）虚拟环境，也可通过 `PYTHON` 环境变量显式指定。
- 简历解析文本模型由 `.env.agent` 声明：设置 `RESUME_TEXT_FALLBACKS`（`provider:model` 逗号分隔、按序）时构成 fallback 链，任一候选失败即时切换，缺 key 候选跳过；未设置时沿用 `RESUME_TEXT_PROVIDER`/`RESUME_TEXT_MODEL` 单候选。provider 支持 `openai`、`zai`、`siliconflow`；链变更须整体重启 Agent 生效。

## 数据与权限

- P0 上传原 PDF、来源块和私有草稿可在受会话保护的服务端从上传起存储 30 天，到期自动删除，用户可提前删除。旧浏览器解析的 `sourceRefs` 仍只留在浏览器内存。新流程复用其模块与条目边界，模型供应商只接收逐条格式化必要文字；上传前须披露期限及供应商。新流程生成请求只传已保存简历的 `resumeId/revision`、角色、显式 `templateId`、幂等键及可选肖像参数，服务端重新投影已确认展示内容；旧版本任务的测评答案仅由对应兼容合同读取。
- 新版解析页以模块开关决定普通内容条目展示：显示模块即纳入该模块全部条目；基本信息仅作网站身份与联系设置，已选姓名和邮箱/电话独立于模块可见状态投影，不生成基本信息分区。字段级选择控制公开联系信息，年龄等其他基本字段不进入新作品。旧草稿的 `item.included` 仅为兼容字段，不决定新版投影；低置信度条目仍需明确核对。
- 照片只在用户主动提交后进入私有资产区并交给配置的图像供应商；上传界面须说明该传输。
- checkpoint 不保存 PDF 原文、来源片段、照片字节、密钥或支付数据；解析图只保存任务 ID、文件 ID、阶段与版本，生成图只保存任务所需的确认字段和资产 ID。
- `.env` 及其变体、`.alipay-sandbox.json`、`data/`、私钥和真实简历样例不得提交、输出到日志或复制进前端；沙箱凭据文件在类 Unix 环境必须为普通文件且权限 `0600`。
- 日志只记录任务 ID、节点、耗时和错误码。自动测试使用可提交的合成样例。
- 新增模型供应商密钥只写入 `.env.agent`，并同步登记 `apps/launcher/src/web-env.mjs` 的 `WEB_EXCLUDED_KEYS`，确保 dev 启动时不透传给 Web 子进程。
- 匿名项目所有权由服务端会话决定；写操作保持 CSRF 校验，任务和资产按会话隔离。
- 私有 `/_internal/agent/` 接口只接受服务令牌，反向代理禁止向公网转发；任务读写同时核对有效租约。
- 数据库、资产、会话密钥和 Agent checkpoint 持久化；生产和沙箱分库分密钥，Web 业务与 Agent checkpoint 使用独立账号和数据库。多主机部署还需共享私有资产和会话密钥。

## 生成、支付与交付

- 新流程提供赛博科技、像素世界风、温暖创意、理性简约、大胆实验五个固定模板，以显式 `templateId` 选渲染器。赛博科技和像素世界风使用各自独立的作品集页面，其余模板和旧作品沿用 Marquee + StackedCards 骨架。配置是受校验的数据，不接受任意 HTML/CSS/JS 或 React 代码。旧 `dark-tech` 作品继续使用旧渲染器。
- 桌面主要页面当前以 `1600px` 为外层内容宽度上限，预览与正文优先获得可读宽度；修改布局时同时检查宽屏和窄屏折叠，具体栅格见[Web 文档](docs/web/README.md#页面宽度与响应式布局)。
- Skill 声明稳定 ID、版本、输入输出、能力和超时；能力按需授予，不提供支付、数据库、任意 shell 或文件系统访问。
- 修改 Skill 合同或输出时同步更新相关工作流版本、Schema 与测试，避免旧任务混用新规则。
- Wibi 资源固定提交并校验哈希，当前仅限本机非商业预览；未取得商业权利和完成资产交付设计前，带肖像作品不得进入正式分享或导出。
- 像素世界风使用 `python-agent-v7` 生成带原创默认角色的免费基础作品。新的本机个人头像任务使用 `python-agent-v10`，Cloudflare 只提供可见造型的枚举分类，Agent 使用固定设计图层合成候选。已入队的 v7、v8、v9 肖像任务使用各自的配方。个人头像只在本机编辑预览使用，正式分享和导出使用默认角色。
- 支付事实只接受支付宝签名通知或签名查单，并核对订单、金额及商户身份；不接受客户端或 Agent 自报，不手工修改数据库模拟实付。
- 免费生成、预览、编辑和单文件 HTML 导出不授予正式分享资格。导出由服务端校验项目所属会话，分享资格、过期和撤销由服务端校验，失败重试不得重复收费。
- 自动测试与收银台展示均不能证明真实付款或公网回调已验收；上线要求见[支付文档](docs/api/payment.md)。

## 按改动选择检查

| 改动 | 检查 |
| --- | --- |
| Web 前端、Next.js 路由、共享 TS 合同或展示 | `npm test`、`npm run build`；涉及布局或响应式时加宽屏与窄屏浏览器检查 |
| 服务端接口、支付、存储或权限 | `npm run test:payment` |
| launcher 启动脚本或 env 编排 | `npm run test:payment`（launcher node:test 全量） |
| TS Skills 或风格资源 | `npm run test:skills`；涉及跨语言评分时加 `npm run test:agent` |
| Python、生成合同或私有协议 | `npm run test:agent`，必要时同步检查 Schema 和黄金样例 |
| Docker 或编排 | 构建两端镜像并验证 Compose 健康检查、持久卷与重启 |
| 纯文档或样例移动 | 本地链接、变量清单、忽略规则、改动范围和 `git diff --check` |

文档按 `docs/web`、`docs/api`、`docs/agent` 和 `docs/shared` 维护；已完成计划和过程记录压缩后放入带日期的 `docs/archive`，日常说明不重复开发日志。
