# 部署与环境变量

## 样例与实际加载位置

所有命令从仓库根目录执行。样例按所属模块存放，**实际配置加载位置保持不变**。

| 样例 | 用途 | 实际目标或注入方式 |
| --- | --- | --- |
| [apps/api/.env.local.example](../../apps/api/.env.local.example) | 本机 API 与开发启动器 | 根 `.env` |
| [apps/api/.env.example](../../apps/api/.env.example) | Compose 的 Node 支付配置 | 根 `.env.api` |
| [apps/agent/.env.example](../../apps/agent/.env.example) | Python 图像供应商 | 根 `.env.agent` |
| [deploy/.env.compose.example](../../deploy/.env.compose.example) | Compose 的共享服务令牌 | 补入根 `.env` |

已有目标文件时逐项补充，不覆盖文件。不把真实配置或密钥提交到 Git。模块目录中的样例不意味着入口会自动读取模块内的实际 `.env`。

| 启动入口 | 配置来源 |
| --- | --- |
| `npm run dev` | 根 `.env`；从根 `.env.agent` 选取图像配置和 checkpoint 路径给 Python；无共享令牌时生成临时令牌 |
| `npm start` / `npm run dev:server` | Node 进程环境和仓库根 `.env`，不自动读取 `.env.api` |
| `npm run dev:agent` | 进程环境、根 `.env` 及根 `.env.agent` 中允许的 Agent 字段；需自行配置与 Node 相同的服务令牌 |
| `python -m buildurprofile_agent.server` | 进程环境，不自动读取环境文件 |
| `docker compose -f compose.agent.yml up --build` | 根 `.env` 用于变量替换，`.env.api` / `.env.agent` 分别注入两个服务 |

支付宝凭据只给 Node，图像凭据只给 Python；共享 `AGENT_SERVICE_TOKEN` 只给服务进程，不给前端。Vite 不需要秘密环境变量。

## 本机开发

1. 安装 Node.js 24+、Python 3.11+ 和 uv 0.11.x。
2. 运行 `npm ci` 和 `uv sync --project apps/agent --frozen --extra test`。
3. 无照片预览可直接运行 `npm run dev`。需要支付时，从 API 本机样例准备根 `.env`；需要肖像时，再准备根 `.env.agent` 并运行 `npm run setup:avatar`。
4. 打开 `http://127.0.0.1:5173`；API 默认 8787，Agent 默认 8788。图像服务配置见[Agent](../agent/README.md)，支付字段见[支付文档](../api/payment.md)。

Windows 启动脚本只自动检测 `.venv/bin/python`；在 PowerShell 先运行：

```powershell
$env:PYTHON = (Resolve-Path 'apps/agent/.venv/Scripts/python.exe').Path
npm run dev
```

端口可通过 `SERVER_PORT`、`AGENT_PORT`、`VITE_PORT` 调整，Vite 代理随 API 端口变化。并行运行多组服务时，另外隔离 `DATABASE_PATH`、`AVATAR_ASSET_ROOT`、`AGENT_CHECKPOINT_PATH`。

## 单机 Compose

准备根 `.env.api`、`.env.agent`，并在根 `.env` 中配置随机生成的 `AGENT_SERVICE_TOKEN`（至少 32 字符、不含空白，两端共享）。保留已有 `.env` 的其他内容。

```sh
docker compose -f compose.agent.yml up --build
```

- `web-api` 构建前端与 Node，宿主机只绑定 `127.0.0.1:8787`；`agent` 仅在容器网络中运行。
- `.env.api` 中的 `PUBLIC_BASE_URL` 应改为实际访问 origin；生产使用 HTTPS，并配置公网通知接口。
- Compose 挂载 `app_data` 和独立 `agent_checkpoints` 卷。两端实际环境文件不打包进镜像。
- 根 `docker-compose.yml` 是 FRP 穿透配置，与应用编排不同；启动应用须显式选择 `compose.agent.yml`。

生产容器默认关闭 Wibi 肖像。开放条件见[Agent 上线门槛](../agent/README.md)。

## 独立服务与公网部署

完整模式需要两个服务。Node 先执行 `npm run build`，再以进程环境启动 `npm start`；Python 安装锁定依赖后，以其虚拟环境执行 `python -m buildurprofile_agent.server`。两者注入相同服务令牌，Python 的 `AGENT_API_URL` 指向可访问的 Node 私有地址。

Python 环境包括 `AGENT_SERVICE_TOKEN`、`AGENT_API_URL`、持久化的 `AGENT_CHECKPOINT_PATH`，以及所选供应商配置；可设置 `AGENT_HOST`、`AGENT_PORT`。Node 独立配置服务绑定、数据库、资产目录和支付。部署平台负责环境注入，不依赖模块目录中隐式加载的环境文件。

对外 HTTPS 入口只到 Node；拒绝转发 `/_internal/agent/`，保持浏览器 `/api` 同源。Node 设置合适的 `SERVER_HOST`；Python 不直接对公网开放。多副本部署先调整[共享存储架构](architecture.md)。

| 检查 | 要求 |
| --- | --- |
| 健康与就绪 | Node `/healthz`、`/readyz`；Python `/healthz` |
| 持久化 | 数据库、`data/session-secret`、私有资产、Python checkpoint；更换会话密钥会使原匿名所有者失去访问 |
| 环境隔离 | 沙箱与生产使用独立数据库和密钥，生产不得复用沙箱库 |
| 备份与重启 | 验证卷恢复、资格保留、任务恢复、租约与会话隔离 |
| 上线验收 | 按[支付](../api/payment.md)和[Agent](../agent/README.md)分别验证真实外部服务 |

默认本机数据库为 `data/buildurprofile.sqlite`（沙箱）或 `data/buildurprofile-production.sqlite`（生产），可通过 `DATABASE_PATH` 指定。Compose 显式指定卷内数据库路径；切换环境时也要隔离卷或调整部署配置。

只需要浏览器预览时使用[GitHub Pages](../web/github-pages.md)，不需要上述后端环境。
