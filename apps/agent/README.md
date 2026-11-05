# Python Agent

`server.py` 启动私有 FastAPI 健康接口和单消费者 `worker_loop`。worker 通过 `transport/node_api.py` 领取带租约的任务；`graph.py` 编排 LangGraph 节点；每个节点通过 `skills/registry.py` 的 `SkillRegistry.run()` 调用版本化 Skill。测评、设计、简历组装、Wibi 肖像和产物 QA 各自位于 `skills/`。外部生图默认由 `providers/cloudflare_images.py` 调用 Cloudflare Workers AI FLUX.2 Klein 4B；`providers/openai_images.py` 保留为可选适配器。照片字节和 API Token 只存在当前调用内，不进入图状态或 checkpoint。

新加一个 Skill 时，在 `skills/` 放独立实现，在注册表声明稳定 ID、版本、能力、商用许可和超时，再从图节点显式授予所需能力。新增能力需加入 `KNOWN_CAPABILITIES` 并审查其数据边界；不要把数据库、shell、任意文件系统或支付对象注入 Skill。改变现有 Skill 合同或输出时同步升级 `graph.py` 与 `packages/storage/src/generation/queue.mjs` 的工作流版本及相应合同/测试，避免旧任务使用新规则。

Wibi 是经固定提交和哈希校验的风格资源，不是可执行 Python 包。Node API 在 `packages/skills/src/wibi.ts` 校验资源，并只把已批准任务的配方通过私有接口提供给 Agent。当前许可仅允许个人非商业预览；生产容器关闭肖像入口。

本机安装与测试：

```bash
uv sync --project apps/agent --frozen --extra test
npm run test:agent
```

本机 `npm run dev` 会同时启动 Vite、Node API 和本服务；单独运行需配置相同的 `AGENT_SERVICE_TOKEN` 与 `AGENT_API_URL`。Cloudflare 的 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN` 只放在不提交的 `.env.agent`。该模型的图片输入必须小于 512×512，适配器将照片和 Wibi 参考图等比缩小后按 multipart 发送；官方 Cloudflare Python SDK 已安装，但此模型的 multipart 推理请求通过 `httpx` 直接调用官方 REST 端点。无照片路径和模拟生图路径可离线测试；真实图像 API 验收需单独执行。
