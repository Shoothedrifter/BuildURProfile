# LangGraph Agent 迁移与上线计划（2026-11-05）

## 已落地

1. `apps/web` 保留 React + Vite；浏览器内的 PDF 提取、解析、字段确认使用浏览器 Skills。Pages 继续提供纯静态预览。
2. `apps/api` 保留 Node 原生 HTTP、匿名会话、CSRF、支付和交付；生成路由与私有 Agent 路由拆分。`packages/storage` 管理版本化数据库、任务租约、心跳、取消、重试与私有资产。
3. `apps/agent` 是唯一生成消费者：Python FastAPI 生命周期启动 LangGraph worker；图调用有版本和能力声明的测评、设计映射、简历组装、Wibi 肖像与 QA Skills。旧 JS worker、JS LangGraph 运行依赖和本地 MFLUX 安装脚本已移除。
4. 肖像由 Python 图像编辑 API 适配器调用外部模型；Wibi 三风格资源由 Node 按固定提交和哈希校验。Agent 只持有图像 API 密钥，Node 只持有支付配置；双方通过服务令牌及任务租约通信。容器入口和单机 Compose 见仓库根目录。
5. 已有无照片及模拟肖像的 Node↔Python HTTP 集成测试、跨语言评分映射对照、Web、支付、Skill、Pages 与 ZIP 回归。

## 上线前仍需完成

1. 用已配置的图像服务密钥完成一次真实肖像生图，并核对人物相似度、尺寸、内容安全及供应商费用；当前自动测试只使用模拟图像响应。
2. 获得 Wibi 的商业许可，或用独立权利来源的风格 Skill 替换；随后才能开放生产肖像和付费分享/ZIP 中的肖像资产。
3. 在可运行 Docker 的环境构建并启动 `compose.agent.yml`，验证数据卷、健康检查、容器重启、密钥注入与外网 HTTPS 反向代理；本次本机 Docker 守护进程未运行。
4. 多副本部署前将任务库与 LangGraph checkpoint 迁移到 PostgreSQL，将照片和成图迁移到对象存储，并验证并发租约、备份与恢复。当前 SQLite 设计面向单机。
5. 按 `AGENTS.md` 独立完成支付宝生产签约、真实付款、异步通知、退款及交付闭环验收。代码测试不构成付款成功证明。
