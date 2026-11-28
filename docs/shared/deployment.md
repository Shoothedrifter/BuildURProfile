# 部署与环境变量

## 样例与实际加载位置

所有命令从仓库根目录执行。样例按所属模块存放，**实际配置加载位置保持在仓库根目录**。

| 样例 | 用途 | 实际目标或注入方式 |
| --- | --- | --- |
| [apps/launcher/.env.local.example](../../apps/launcher/.env.local.example) | 本机 Next.js 与开发启动器 | 根 `.env` |
| [apps/launcher/.env.example](../../apps/launcher/.env.example) | Compose 的 Next.js 支付配置 | 根 `.env.api` |
| [apps/agent/.env.example](../../apps/agent/.env.example) | Python 图像与简历文本供应商 | 根 `.env.agent` |
| [deploy/.env.compose.example](../../deploy/.env.compose.example) | Compose 的共享服务令牌和 PostgreSQL 密码 | 补入根 `.env` |

已有目标文件时逐项补充，不覆盖文件。不把真实配置或密钥提交到 Git。模块目录中的样例不意味着入口会自动读取模块内的实际 `.env`。

| 启动入口 | 配置来源 |
| --- | --- |
| `npm run dev` | 根 `.env`；从根 `.env.agent` 选取模型和 PostgreSQL checkpoint 配置给 Python；无共享令牌时生成临时令牌 |
| `npm start` / `npm run dev:server` | Node 进程环境和仓库根 `.env`，不自动读取 `.env.api` |
| `npm run dev:agent` | 进程环境、根 `.env` 及根 `.env.agent` 中允许的 Agent 字段；需自行配置与 Web 服务相同的服务令牌 |
| `python -m buildurprofile_agent.server` | 进程环境，不自动读取环境文件 |
| `docker compose -f compose.agent.yml up --build` | 根 `.env` 用于变量替换，`.env.api` / `.env.agent` 分别注入两个服务 |

支付宝凭据只给 Next.js 服务端，图像与文本模型凭据只给 Python；共享 `AGENT_SERVICE_TOKEN` 只给服务进程，不暴露给客户端。Agent 简历解析需在根 `.env.agent` 配置 `RESUME_TEXT_PROVIDER`、`RESUME_TEXT_MODEL`，以及对应的 `OPENAI_API_KEY` 或 `ZAI_API_KEY`；缺少时解析任务返回 `PARSE_FAILED`。GLM Key 不能放在 `OPENAI_API_KEY` 下冒充 OpenAI Key。

## 本机开发

1. 安装 Node.js 22.12+（推荐 24+）、Python 3.11+ 和 uv 0.11.x。
2. 运行 `npm ci` 和 `uv sync --project apps/agent --frozen --extra test`。
   若需在本机处理扫描页，另安装 Tesseract 可执行文件及 `eng`、`chi_sim` 语言包，并验证 `tesseract --list-langs` 包含两者；Compose 的 Agent 镜像已安装这些组件。缺少组件时普通文本解析仍可使用，OCR 会返回专用错误码。
3. 配置 PostgreSQL 业务库与 Agent checkpoint，见[迁移指南](postgresql-migration.md#本机开发与迁移演练)。旧浏览器解析与无照片预览可直接运行 `npm run dev`。新 Agent 简历解析需从 `apps/agent/.env.example` 准备根 `.env.agent`，按所选 OpenAI 或 GLM 供应商填入模型和对应 Key；需要支付时，再从 `apps/launcher/.env.local.example` 准备根 `.env`；需要肖像时运行 `npm run setup:avatar` 并配置图像供应商。修改 `.env.agent` 后重启 `npm run dev`，运行中的 Python Agent 不会自动重新读取它。
4. 打开 `http://127.0.0.1:5173`；Next.js 开发服务默认监听 5173（前后端同源），Agent 默认 8788。图像服务配置见[Agent](../agent/README.md)，支付字段见[支付文档](../api/payment.md)。

启动脚本会自动检测 `apps/agent/.venv/bin/python`（Unix）与 `apps/agent/.venv/Scripts/python.exe`（Windows），也可通过环境变量 `PYTHON` 显式指定 Python 路径。

Next.js 开发环境会在服务端及共享包源码变更后重建服务实例，并等待旧请求结束后释放数据库连接，避免热更新继续使用旧校验规则。生产环境仍在进程内复用实例；环境变量与 Python Agent 配置变更仍需重启对应服务。

端口可通过 `VITE_PORT`（或 `PORT`）、`SERVER_PORT`、`AGENT_PORT` 调整。并行运行多组服务时，另外隔离 `DATABASE_URL` / `DATABASE_SCHEMA`、`AVATAR_ASSET_ROOT`、`AGENT_CHECKPOINT_DATABASE_URL` / `AGENT_CHECKPOINT_SCHEMA`。

## 单机 Compose

准备根 `.env.api`、`.env.agent`，并在根 `.env` 中配置随机生成的 `AGENT_SERVICE_TOKEN`（至少 32 字符、不含空白，两端共享）和三项独立 PostgreSQL 密码。保留已有 `.env` 的其他内容。

```sh
docker compose -f compose.agent.yml up --build
```

- `web-api` 使用 `apps/launcher/Dockerfile` 构建并运行 Next.js 全栈生产服务，宿主机只绑定 `127.0.0.1:8787`；`agent` 仅在容器网络中运行。
- `.env.api` 中的 `PUBLIC_BASE_URL` 应改为实际访问 origin；生产使用 HTTPS，并配置公网通知接口。
- Compose 使用独立 PostgreSQL 服务及 `postgres_data` 持久卷。`app_data` 保留原 PDF、照片及会话密钥。生产隔离和 SQLite 升级步骤见[迁移指南](postgresql-migration.md)。
- `compose.tunnel.yml` 是 FRP 穿透配置，与应用编排不同；启动应用须显式选择 `compose.agent.yml`。

当前检出版本的生产容器默认关闭肖像演示；自有肖像 Skill 的部署配置以相应分支为准。

### 单机生产部署

在服务器上安装 Docker Engine 与 Compose 插件，将仓库部署文件复制到服务器；不复制开发环境的 `.env`、沙箱凭据或 `data/`。使用下列样例分别准备仓库根目录 `.env`、`.env.api` 和 `.env.agent`；已有文件逐项合并，不覆盖。限制这些文件的读取权限，例如 `chmod 600 .env .env.api .env.agent`。

- `.env`：从 `deploy/.env.compose.example` 设置独立随机 `AGENT_SERVICE_TOKEN` 和三项 PostgreSQL 密码。
- `.env.api`：从 `apps/launcher/.env.example` 配置 `PAYMENT_ENV=production`、生产售价、生产应用和商户参数，`PUBLIC_BASE_URL=https://域名`，`ALIPAY_NOTIFY_URL=https://域名/api/payment/notify`。私钥由部署者自行安全注入，不能提交或发送到聊天。
- `.env.agent`：从 `apps/agent/.env.example` 设置所需供应商参数；无肖像作品仍需要运行 Agent。

使用独立 Compose 项目名隔离生产卷，切勿复用沙箱卷或沙箱数据库：

```sh
docker compose -p buildurprofile-production -f compose.agent.yml config --quiet
docker compose -p buildurprofile-production -f compose.agent.yml up -d --build
docker compose -p buildurprofile-production -f compose.agent.yml ps
```

Web 监听宿主机 `127.0.0.1:8787`，Agent 不发布端口。由服务器上的 Nginx 负责 HTTPS 和反向代理至 `http://127.0.0.1:8787`，并在转发前拒绝 `/_internal/agent/` 和 `/api/_internal/agent/` 及其子路径；支付宝通知路径 `/api/payment/notify` 必须允许 POST 且不重定向。两个 PostgreSQL 数据库和应用文件卷均需备份；不要使用 `down -v` 删除生产卷。确认 `/healthz` 和 `/readyz` 正常，以及公网内部接口不可访问。支付宝回调和真实付款仍须在域名及生产凭据就绪后按[支付上线验收](../api/payment.md)逐项验证。

### GitHub Pages 授权与验收

1. 在 GitHub Developer settings 注册 OAuth App。Homepage URL 填 BuildURProfile 公网地址，Authorization callback URL 填同一 HTTPS origin 加 `/api/github-pages/callback`。本机联调可注册独立的测试 OAuth App，并填写实际访问的 loopback 地址，例如 `http://127.0.0.1:5173/api/github-pages/callback`。 [GitHub OAuth App 注册](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
2. 在 Compose Web 的 `.env.api` 或本机根目录 `.env` 配置 `GITHUB_PAGES_ORIGIN`、`GITHUB_PAGES_CLIENT_ID` 和 `GITHUB_PAGES_CLIENT_SECRET`，然后重启 Web。Origin 只填协议和主机端口。三项完整时作品页显示部署入口。Client Secret 只交给 Web 服务端。Web 需要访问 `github.com`、`api.github.com` 和 GitHub Pages 默认站点。
3. Nginx 将 `/api/github-pages/callback` 原样代理到 Web，沿用现有转发头。在该路径关闭访问日志（`access_log off;`），并将 `proxy_read_timeout` 设为 `150s`，供回调顺序完成 GitHub 写入。避免其他日志系统记录回调查询串，其中含一次性授权参数。
4. 用个人 GitHub Free 测试账号与合成作品从已解锁项目发起部署。核对 GitHub 授权页、同账号公开仓库、默认分支的 `index.html` 与 `.nojekyll`、Pages 构建及最终 HTTPS 网址。打开网址检查内嵌图片、像素模板字体和项目详情导航，并用另外的 BuildURProfile 会话确认无法读取原会话的部署记录。

## 独立服务与公网部署

完整运行需要两个服务：Next.js 先执行 `npm run build`，再以进程环境启动 `npm start`（监听 `SERVER_PORT`，默认 8787）；Python 安装锁定依赖后，以其虚拟环境执行 `python -m buildurprofile_agent.server`。两者注入相同服务令牌，Python 的 `AGENT_API_URL` 指向可访问的 Next.js 私有地址。

Python 环境包括 `AGENT_SERVICE_TOKEN`、`AGENT_API_URL`、`AGENT_CHECKPOINT_DATABASE_URL`、可选 `AGENT_CHECKPOINT_SCHEMA`，以及所选供应商配置；可设置 `AGENT_HOST`、`AGENT_PORT`。Next.js 服务端独立配置服务绑定、数据库、资产目录和支付。部署平台负责环境注入，不依赖模块目录中隐式加载的环境文件。

从旧版升级成果展示合同，先更新 Agent Worker 再更新 Web。新建 PDF 或 OCR 解析任务及包含成果字段的生成任务会等待新版 Worker。两端启动完成后再验收完整生成链路。

对外 HTTPS 入口只到 Next.js；拒绝公网转发 `/_internal/agent/` 与 `/api/_internal/agent/`，保持浏览器 `/api` 同源。Next.js 设置合适的 `SERVER_HOST`；Python 不直接对公网开放。多副本部署先调整[共享存储架构](architecture.md)。

| 检查 | 要求 |
| --- | --- |
| 健康与就绪 | Next.js `/healthz`、`/readyz`；Python `/healthz` |
| 持久化 | 数据库、`data/session-secret`、私有资产、Python checkpoint；更换会话密钥会使原匿名所有者失去访问 |
| 环境隔离 | 沙箱与生产使用独立数据库和密钥，生产不得复用沙箱库 |
| 备份与重启 | 验证卷恢复、资格保留、任务恢复、租约与会话隔离 |
| 上线验收 | 按[支付](../api/payment.md)和[Agent](../agent/README.md)分别验证真实外部服务 |

Web 使用 `DATABASE_URL` 和可选 `DATABASE_SCHEMA`。Agent 通过专用账号连接 checkpoint 数据库。生产和沙箱使用独立 Compose 项目与数据卷。
