# 架构与协议

## 模块所有权与数据流

```text
浏览器客户端（Next.js Client Components）：PDF 上传 → 十模块核对 → 八题答案
  ↓ 私有 PDF 上传与解析任务；确认后提交 resumeId/revision + 角色/答案 + 可选照片资产 ID
Next.js Route Handlers（apps/web/src/app/api & src/server）
  ├─ 会话 / CSRF / 解析与生成队列 / 私有 PDF 和资产（SQLite via packages/storage）
  ├─ ↕ 服务令牌 + 有效任务租约（/_internal/agent/*）
  │    Python Agent（apps/agent）：简历解析图 → OpenAI 文本模型；生成图 → 可选图像 API
  │      ↓ DesignConfig + 成图资产 ID
  └─ 预览与编辑 → 用户主动请求 → 核实支付 → 正式分享 / 作品集导出
```

| 模块 | 所有权与依赖 |
| --- | --- |
| `apps/web` | Next.js App Router 全栈应用；新流程负责私有 PDF 上传与 Agent 草稿确认，旧浏览器解析为兼容入口；服务端独占项目、支付、任务、会话与资产存储 |
| `apps/launcher` | 启动、联调、集成测试与容器化部署入口；协调 Next.js 服务与 Python Agent 生命周期 |
| `apps/agent` | 唯一生成任务消费者；独立 Python Skill 注册表；通过私有 HTTP 读写本任务，不访问支付卷 |
| `packages/contracts` | TypeScript 类型、Node 校验、版本化 JSON Schema 和跨语言黄金样例 |
| `packages/skills` | 浏览器注册表、TS 评分映射、公共风格目录与仅服务端可用的固定资源校验 |
| `packages/storage` | SQLite 迁移、确认 brief 清洗、任务租约、重试取消和资产存储 |

所有作品集生成任务（含无照片作品）均经过 Python LangGraph 图执行。付款、分享和下载属于确定性服务端业务，不能作为 Agent 可调用的自由工具。

## 合同与图执行

新 Agent 简历使用 `GenerationBriefV3` / `DesignConfigV3`，其 `resume-v3.sections` 按用户确认顺序保存十模块条目，以及补充文字、命名链接和图片 ID。服务端按会话读取 `resumeId/revision` 对应草稿并重新投影；客户端不能自报新版本 content。Python 再做严格校验。兼容字段 `profile/projects/...` 从条目派生，作品渲染不重复展示兼容副本。

当前新 Agent 工作流为 `python-agent-v4`（`resume.compose.v4`、`artifact.qa.v3`），内容组装只验证和复制，不调用 LLM 改写用户补充内容。旧浏览器兼容入口及已有 v2/v3 任务继续按原版本处理；Worker 按任务版本分流，禁止混读。版本化 Schema 位于 `packages/contracts/schema`，Python 模型位于 `apps/agent/src/buildurprofile_agent/contracts.py`。

图顺序为：校验输入 → 选择 Skill 计划 → 评分 → 设计映射 → 注入确认内容 → 可选肖像 → 最终 QA → 提交配置。Skill 声明稳定 ID、版本、能力、输入输出和超时，执行器只授予当前节点所需能力。

新上传路径由 `resume-parse-v2/v3` 独立队列和 LangGraph 图解析。Web 在私有原件或本机 OCR 文字上复用旧浏览器解析算法，生成仅供 Agent 使用的 `resume-parse-plan-v1` 模块和条目锚点；Python 将来源块对齐锚点，再由 `resume.format.v1` 文本模型逐条整理标题与正文，不能自由拆分或合并条目。用户明确选择时，v3 只对无文字页运行本机 OCR，私有 `resume-source-v2` 标记 OCR 来源与置信度。固定映射和来源校验由代码执行，详见[解析流程 v2](../agent/resume-anchored-formatting.md)。十模块草稿经会话隔离持久化；用户在编辑页对照原 PDF 保存、排序、拆合、自动保存与恢复历史，显式清除待核对状态后，投影剥离来源及隐藏字段，按确认顺序输出 `resume-v3`。原件、块、草稿和历史从上传起 30 天自动删除，可提前删除。重解析候选独立于当前草稿，并在 revision 相同时才可应用。旧浏览器规则解析仍作为明确标注的兼容入口，候选只留浏览器内存；模型失败不回退旧路径。

图状态与 checkpoint 可保存任务 ID、清洗后的 brief、评分、配置、Skill 版本、风格与资产 ID、QA 结果。不得保存 PDF 原文、`sourceRefs`、照片字节、密钥和支付数据。照片及风格参考图仅在外部图像请求期间读取。

修改 Skill 合同或输出时，同步升级图和队列中的工作流版本及对应 Schema/测试；拒绝版本不匹配的任务。TS 规则和 Python 规则通过 `packages/contracts/fixtures/agent-golden.v1.json` 与 `agent-golden.v2.json` 检查一致性。维护工具 `scripts/export-agent-schemas.py` 从 Python 模型刷新 Schema，执行后需审阅差异。

## 私有任务协议 v1

前缀为 `/_internal/agent`（在 Next.js 中通过 `next.config.mjs` rewrites 映射到 `/api/_internal/agent/*` Route Handler），只接受 `Authorization: Bearer AGENT_SERVICE_TOKEN`，采用常数时间比较。服务令牌为 32–512 字符且不含空白；反向代理不得向公网转发此路径。

| 方法与相对路径 | 输入 / 输出 |
| --- | --- |
| `POST /lease` | `{workerId}` → `204` 或任务：`id, leaseToken, workflowVersion, brief, config, portraitAssetId, styleId, outputAssetId` |
| `POST /heartbeat` | `{workerId}` → `{ok:true}`，更新 worker 就绪心跳 |
| `POST /tasks/:id/heartbeat` | `{leaseToken}` → `{ok,cancelRequested}`，续租并检查取消 |
| `GET /tasks/:id/output` | `x-agent-lease` → `{assetId,exists}`，查询可复用成图 |
| `GET /tasks/:id/portrait` | `x-agent-lease` → 原图字节及 MIME |
| `GET /tasks/:id/recipe` | `x-agent-lease` → 已校验风格配方、来源与参考图 |
| `POST /tasks/:id/output` | `x-agent-lease` + 图片字节 → `{assetId}` |
| `POST /tasks/:id/complete` | `{leaseToken,config}` → `{ok}` |
| `POST /tasks/:id/fail` | `{leaseToken,errorCode,retryable}` → `{ok}` |
| `POST /tasks/:id/ack-cancel` | `{leaseToken}` → `{ok}` |

除照片下载和成图上传外使用 JSON。所有任务接口同时校验正在运行且未过期的租约；服务令牌不能替代任务租约或浏览器会话。

## 可靠性与存储

任务具有会话所有者、幂等键、工作流版本、次数、状态、租约和退避时间。执行中每 15 秒续租；写结果必须核对租约，过期 worker 不得覆盖新结果。每次租约使用独立 checkpoint thread；重试重跑确定性节点，通过成图资产 ID 幂等复用已写入产物。

排队任务可立即取消，运行中任务标记取消并尽力终止外部请求。已发出的供应商调用可能计费，取消不承诺退款。限流和暂不可用有限重试，超时不自动重试以降低重复计费风险。

当前为单机 SQLite WAL、私有本地资产和 Python 独立 SQLite checkpoint。多主机部署前需迁移共享任务数据库、对象存储及 checkpoint 适配器，不跨主机共享 SQLite 文件。持久化与健康检查见[部署说明](deployment.md)。

## 简历图片与作品资产

补充图片上传保存在私有 `resume_images`，按真实格式与尺寸校验：PNG/JPEG/WebP、1–8000 像素、单张 5 MiB、每条 6 张、整份 24 张且合计 50 MiB。原 PDF、来源块、草稿与这批图片沿用上传起 30 天期限。取消未保存的图片或保存时移除原引用会释放对应图片；未保存上传可通过属主的 `GET /api/resumes/:id/images` 列表恢复或逐张删除，避免刷新后占满额度；不在保存时批量清除另一编辑页面的未提交图片，且删除时再次拒绝已保存引用。孤立上传最迟随原简历到期清除。

生成入队在同一事务中复制已选图片到 `showcase_media` 并写 `generation_media`；生成 brief/config/checkpoint 仅含 ID。无肖像 v3 生成成功后，以任务为幂等来源创建未付款项目并关联 `project_media`。浏览器恢复成功任务时读取项目当前配置与权益，交接后清除旧任务指针，避免覆盖后续编辑。Wibi 肖像继续仅供本机演示，不自动保存为可付费交付项目。

作品图片按项目生命周期保留，删除原简历不影响作品。属主通过 `/api/showcase-media/:id` 预览；分享通过 `/api/shares/:token/media/:id` 读取，并校验令牌、付款、项目和快照引用。旧分享快照可保留更新前的图片；撤销、过期、删项目后即时拒绝。导出 ZIP 包含 `index.html` 和 `assets/*`，不依赖私有 PDF 路由。未形成项目的复制品最多保留 30 天；清理为有界批次，有效运行租约在到期边界完成前受保护，废弃排队任务到期转失败。项目删除或旧分享失效后，按引用关系释放无主作品图片。
