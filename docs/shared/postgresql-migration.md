# PostgreSQL 部署与 SQLite 迁移

BuildURProfile 的 Web 业务和 LangGraph checkpoint 分别连接 PostgreSQL。SQLite 快照导入涵盖会话、简历及历史、作品、任务、支付、权益和分享。原 PDF、照片及会话密钥随 Web 应用数据卷保留。旧 LangGraph checkpoint 随 SQLite 归档。排空旧租约后，新任务或重新领取的排队任务会写入 PostgreSQL checkpoint。

## 本机开发与迁移演练

准备 PostgreSQL 服务、逻辑数据库和有权创建 schema 的开发账号。在本机 `localhost:5432` 的 `mydb` 中，使用 `myuser` 和本机测试密码。分别向仓库根部的 `.env` 和 `.env.agent` 增加以下变量。示例中的占位值替换为实际本机密码。密码中有 URI 保留字符时按 URI 规则编码。

```dotenv
# .env
DATABASE_URL=postgresql://myuser:<本机测试密码>@localhost:5432/mydb
DATABASE_SCHEMA=buildurprofile_dev
PAYMENT_ENV=sandbox
```

```dotenv
# .env.agent
AGENT_CHECKPOINT_DATABASE_URL=postgresql://myuser:<本机测试密码>@localhost:5432/mydb
AGENT_CHECKPOINT_SCHEMA=buildurprofile_agent_dev
AGENT_LEASE_WAIT_MS=20000
```

```sh
npm ci
uv sync --project apps/agent --frozen --extra test
npm run db:migrate
npm run dev
```

Web 初始化时也会检查和执行待应用的结构迁移。Agent 第一次连接时创建 checkpoint 表。集成测试用 `TEST_DATABASE_URL` 指定同一台本机 PostgreSQL 的测试连接，测试创建并清理随机命名的 schema。按以下顺序执行，避免测试和构建同时占用机器资源。

```sh
npm test
npm run test:payment
npm run test:agent
npm run build
```

以合成数据执行导入演练时，将 `DATABASE_SCHEMA` 改为独立的新 schema，再按下节执行结构创建、预检、导入和核对。拿到测试报告后再启动应用验证会话恢复和任务处理。

## 生产切换

### 1. 备份和停写

1. 记录旧版本的提交、Compose 项目名、真实 SQLite 路径和资产目录。采用原项目名以复用现有 `app_data` 卷。
2. 在 Nginx 启用维护入口，暂停 Web 写入和新任务。维护期间支付宝通知使用临时失败响应，避免未入库就确认成功。内部 Web↔Agent 网络继续服务，等待在途生成、解析和 GitHub 上传结束。停止旧 Agent 和 Web 容器后再备份。
3. 在受限目录备份旧 SQLite 数据及可能仍在的 WAL，备份旧 checkpoint 和整个 Web 数据卷。特别核对 `data/session-secret`、`resume-files/` 与 `avatar-assets/`。从停机副本生成一致的 SQLite 快照，例如 `sqlite3 /private/old-data/buildurprofile.sqlite '.backup /private/backup/buildurprofile.sqlite'`。把快照和当时的应用版本一并保留。用旧运行目录的具体数据库路径替换示例中名称。
4. 从备份恢复到一次性演练环境，验证结构、会话、有效资产和支付历史。预检返回 `DRAIN_ACTIVE_TASKS` 或 `DRAIN_ACTIVE_GITHUB_UPLOADS` 时，恢复旧服务并等待相应工作结束后重做快照。

### 2. 启动数据库并迁移

在根目录 `.env` 设置生产独有的 `POSTGRES_ADMIN_PASSWORD`、`POSTGRES_WEB_PASSWORD` 和 `POSTGRES_CHECKPOINT_PASSWORD`。用不同的 URL 安全密码，例如分别生成 `openssl rand -hex 32`。原 `.env.api` 保持生产支付环境、商户配置和 URL，原 `.env.agent` 保留模型配置。生产和沙箱使用不同 Compose 项目。PostgreSQL 只接入 Compose 私网。

以下示例在仓库根执行，`buildurprofile-production` 替换为原项目名。把待导入快照的绝对路径赋给 `BUP_SQLITE_SNAPSHOT`，容器用只读挂载读取，Web 的已有文件卷仍读写挂载在 `/app/data`。确保运行 Web 的容器用户可以读取快照，例如将演练副本交给 UID 1000 并保留 `0600`。

```sh
docker compose -p buildurprofile-production config --quiet
docker compose -p buildurprofile-production build web-api agent
docker compose -p buildurprofile-production up -d --wait postgres

docker compose -p buildurprofile-production run --rm --no-deps web-api npm run db:migrate

docker compose -p buildurprofile-production run --rm --no-deps \
  -v "$BUP_SQLITE_SNAPSHOT:/tmp/buildurprofile-import.sqlite:ro" \
  web-api npm run db:import:sqlite -- --source /tmp/buildurprofile-import.sqlite \
  --resume-root /app/data/resume-files --avatar-root /app/data/avatar-assets --dry-run

docker compose -p buildurprofile-production run --rm --no-deps \
  -v "$BUP_SQLITE_SNAPSHOT:/tmp/buildurprofile-import.sqlite:ro" \
  web-api npm run db:import:sqlite -- --source /tmp/buildurprofile-import.sqlite \
  --resume-root /app/data/resume-files --avatar-root /app/data/avatar-assets --apply

docker compose -p buildurprofile-production run --rm --no-deps \
  -v "$BUP_SQLITE_SNAPSHOT:/tmp/buildurprofile-import.sqlite:ro" \
  web-api npm run db:verify:sqlite -- --source /tmp/buildurprofile-import.sqlite \
  --resume-root /app/data/resume-files --avatar-root /app/data/avatar-assets
```

- 使用 `PAYMENT_ENV=sandbox` 或 `PAYMENT_ENV=production` 匹配源数据库。预检检查 SQLite 完整性、外键、支付域、在途任务与有效文件。
- `--dry-run` 读取源快照及资产。遇见旧的已记录 schema 版本时，只升级临时副本。需要与目标逐行比对时使用独立的 verify 命令。
- `--apply` 要求目标业务表为空，并在一个事务里导入、逐行校验和调整 identity。失败中止并回滚。出现 `TARGET_NOT_EMPTY` 时保留已有目标，检查是否是已成功导入或连错库。成功后再次 apply 会拒绝。进程输出 JSON 报告，只含状态、计数、聚合哈希及故障范围。通过条件是预检、导入和核对均退出 0，并且三次报告的文件计数和聚合哈希一致。
- 生产有额外的 `RESUME_FILE_ROOT` 或 `AVATAR_ASSET_ROOT` 配置时，将命令中的目录换成容器内实际位置，并保留数据库记录使用的文件路径。如果搬迁了绝对照片路径，先将归档卷恢复到原容器路径，再切换。
- 数据库初始化 SQL 在新 PostgreSQL 卷第一次启动时创建两个数据库和各自的登录角色。既有卷上的密码轮换需要用管理账号执行 `ALTER ROLE`，随后协调更新 Compose 环境与重建客户端容器。

### 3. 验收后恢复流量

```sh
docker compose -p buildurprofile-production up -d --wait
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS http://127.0.0.1:8787/readyz
docker compose -p buildurprofile-production ps
```

用保留 Cookie 的已有浏览器会话读取作品和简历，确认 revision、资产和既有已付分享。用另一会话验证隔离。提交合成简历和生成任务，确认新任务快速领取、取消生效以及 Agent 重启后过期租约可恢复。检查公网无法访问两个内部 Agent 接口前缀。恢复流量后允许支付宝重投，并通过签名查单核对维护前后待确认订单。现网真实付款和回调按[支付上线说明](../api/payment.md)单独验收。

## 回滚与日常备份

- 开放新写入前发生问题时，保留 PostgreSQL 卷和报告，关闭新服务，用旧镜像、旧运行配置和匹配的 SQLite 与文件卷快照恢复。验证已有会话、订单、分享和队列后再恢复公网流量。
- PostgreSQL 开放写入后，先重新进入维护模式，备份两个 PostgreSQL 数据库与当前文件卷，盘点新增简历、任务、订单及权益。优先通过兼容 PostgreSQL 的版本恢复服务。若必须退回 SQLite，需要先迁回新增资料并完成支付对账，再恢复写入。
- 备份时把两个 PostgreSQL 数据库与应用文件卷、配置放在同一批次。停写或部署端做一致性快照后，使用相同维护时间点恢复。先在独立 Compose 项目验证备份，确保测试恢复环境使用自己的卷、数据库和服务凭据。

```sh
umask 077
docker compose -p buildurprofile-production exec -T postgres \
  pg_dump -U postgres -Fc buildurprofile > /private/backup/web.pg.dump
docker compose -p buildurprofile-production exec -T postgres \
  pg_dump -U postgres -Fc buildurprofile_checkpoints > /private/backup/checkpoints.pg.dump
```

恢复演练时先启动独立项目的数据库，由初始化脚本建立数据库与账号，再在应用启动之前还原。保留原数据卷和备份，演练目标应是新建空库。

```sh
docker compose -p buildurprofile-restore exec -T postgres \
  pg_restore -U postgres --exit-on-error --single-transaction -d buildurprofile < /private/backup/web.pg.dump
docker compose -p buildurprofile-restore exec -T postgres \
  pg_restore -U postgres --exit-on-error --single-transaction -d buildurprofile_checkpoints < /private/backup/checkpoints.pg.dump
```

将文件备份恢复到演练项目的应用卷，检查同一会话、有效文件、支付记录和 checkpoint，再按前述步骤启动和验收。
