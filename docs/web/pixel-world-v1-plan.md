# 像素世界风 Pixel World V1 实施计划

> **执行技能**　逐任务实施时使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。每项生产行为先写测试并观察预期失败，再实现、复测和重构。

**目标**　让用户从已核对的简历生成一份偏开发者的像素作品集，并在本机编辑预览中选择是否生成个人像素角色。

**架构**　`pixel-world-v1` 是显式固定模板，由 `python-agent-v7` 处理，预览、分享和单文件导出使用同一个 `PixelWorldPage`。基础作品先经过 Agent 并生成免费项目。个人角色在基础作品完成后通过独立的头像任务生成，复用现有队列和私有资产区。

**技术栈**　现有 Next.js、React、TypeScript、SQLite、FastAPI、LangGraph、Pydantic、Pillow、Cloudflare Workers AI。测试沿用 Vitest、Node `node:test`、pytest 和浏览器检查。

**规格依据**　本计划内的 V1 范围，以及现有[项目约束](../../AGENTS.md)、[架构与协议](../shared/architecture.md)、[Web 规格](README.md)和 [Agent 图像流程](../agent/README.md)。版式参考 [JLD’2nd](https://jld2nd.dev/) 的像素角色和 [Soumyajit 项目页](https://soumyajit.vercel.app/project) 的项目导航与证据布局。

**实施调整**　实测表明 Cloudflare 会偏移配方指定的纯色背景。后处理在至少三个角落颜色一致时校准玫红背景，只校正紧邻透明区的边缘染色。复测三张合成样本均得到 512×512 透明 PNG，保留了不同发型及眼镜差异。基础模板与个人头像的交付边界由应用服务层校验，资产到期后由运行时清理。任务 3–7 的实现跨同一组页面与交付入口，合并为一个功能提交。

## V1 范围与约束

- Pixel World 作为第五套模板，卡片排在赛博科技之后，对现有三种职业角色开放。首屏为墨蓝底、暖琥珀强调色、左侧身份与入口、右侧原创像素半身像。默认角色为自有静态资产。宽屏项目两列、窄屏单列，长内容允许展开。V1 使用静态角色，交互动效限于可减少或关闭的界面反馈。
- 顶部导航只列出实际可达的章节。`启航 · 查看项目` 指向项目区。没有项目时指向第一段可见正文，正文为空时省略入口。联系按钮以明确公开的邮箱或电话为前提。正文及卡片顺序沿用已保存的 `resume-v3`，项目文案、技术、成果、链接和图片均来自已确认条目。用已有标题和字段呈现信息，缺字段时省略对应块。
- 基础作品先走无照片生成，使用默认角色保存、预览、免费导出、按既有权益正式分享。个人角色只在既有本机肖像演示开关开启时可生成。作者显式点击生成才上传，先看到候选，再选用到当前私有预览。刷新后回到默认角色，成图仍按私有资产生命周期管理。进入保存、分享或导出前提示交付会使用默认角色。
- 本机原照片和成图沿用 1 天、7 天的资产有效期。照片只交给 Cloudflare 的图像编辑模型。Checkpoint 只留任务需要的确认字段、版本和资产 ID。原照片、生成图字节、配方参考图字节及供应商密钥均留在节点运行范围内。保留会话、CSRF、租约、取消和有界重试。日志按既有格式记录任务 ID 和错误码。
- V1 生成一张角色图。像素化由 Agent 本地后处理完成，透明边缘通过质检时采用透明版本，其他情况生成带底色的角色卡。配方与默认角色有明确的原创来源，只引用项目自有的素材。访问作品、刷新分享和打开离线 HTML 都无需调用 Cloudflare。
- 新模块遵守 `1600px` 内容宽度上限。JSON 继续只承载受校验的数据。现有 `dark-tech` 和其他四套模板继续走各自现有版本、配方及渲染入口。提交信息用简体中文。

## TDD 执行与审查重点

每个用例单独经历 RED、GREEN、REFACTOR。先用筛选命令运行到有意义的断言失败，记录失败原因。再写最小实现，重复原命令，重构后跑任务列出的相关套件。新增模块的入口缺失时，可先通过既有入口写断言，或用最薄的可导入空壳让失败落在行为断言上。测试使用合成 PDF、合成图片、内存或临时 SQLite。仅模拟外部 HTTP 或不可控的浏览器行为。

| 审查输入 | 首个捕获它的用例 |
| --- | --- |
| 同一幂等键提交其他模板或草稿修订，旧 Agent 和新 Agent 同时在线 | 任务 2 的队列与租约测试 |
| 隐藏模块、未确认联系方式、缺项目图和超长中文项目 | 任务 3 的展示与交互测试 |
| 分享 URL 中的 `#share=` 被章节跳转覆盖，或者离线时默认图 404 | 任务 3、4 的导航与交付测试 |
| 服务端被直接提交包含本机像素头像的作品配置，或尝试从别的会话读取成图 | 任务 4、5 的项目写入和私有资产测试 |
| 成图回来时已取消、失去租约、选了新照片或切换作品 | 任务 6、7 的图与编辑器测试 |

## 任务 1　锁定模板合同与映射

**改动文件**　`packages/contracts/src/config.ts`、`packages/contracts/src/validation.mjs`、`packages/storage/src/generation/brief.mjs`、`packages/contracts/schema/{generation-brief,design-config}.v4.json`、`packages/skills/src/mapping.ts`、`apps/agent/src/buildurprofile_agent/{contracts.py,skills/design.py}`。跨语言测试放 `apps/agent/tests/test_template_contract.py`，Node 入口断言放 `apps/launcher/src/generations.test.mjs`。

**接口**　`TemplateId` 增加 `pixel-world-v1`。沿用 `GenerationBriefV4` 与 `DesignConfigV4` 的字段形状。共用现有 `templateToConfig(templateId, role)` 和 `template_to_config(template_id, role)`，Pixel 的兼容映射固定为 `{ E: 0.75, K: 0.25, P: 0.75, S: 0.75, PChoice: "cool" }`，墨蓝和暖琥珀由渲染器 CSS 控制。

- [ ] 写 `test_pixel_world_contract_round_trips`，断言 Pixel brief/config 可通过 Python 和 Node 校验并保留 ID。未知 ID、缺少 `resume-v3` 的 Pixel 配置，以及 V4 brief 中的 `answers` 或额外 UI 字段被拒绝。Node 的 `cleanConfig` 继续按白名单投影，断言额外的 `html` 字段不会出现在保存结果。旧 V3 样例仍可读。
- [ ] 扩展 `test_template_mapping_parity_and_schema_files` 到 5 套模板 × 3 种角色共 15 个用例。为 Pixel 的开发者角色钉住 `templateId`、`skin === "dark-tech"`、`marquee.speed === 55` 等独立预期。两个 schema 要与 Pydantic 实时导出结果一致。
- [ ] RED，用 `uv run --project apps/agent --frozen --extra test pytest -q apps/agent/tests/test_template_contract.py` 和 `node --test --test-name-pattern='Pixel World contract' apps/launcher/src/generations.test.mjs`，验证 Pixel ID 在合同和映射入口被拒绝。
- [ ] GREEN，在现有类型、白名单和映射处增加字面量。为 Pixel 保存配置校验 `resume-v3`，并用更新后的 Python 模型再生成两个 V4 Schema。项目按显式 ID 区分两套兼容皮肤相同的模板。
- [ ] 复跑原命令、`npm run test:skills` 和 `npm run test:agent`。通过后提交 `为像素世界风补齐跨语言模板合同`。

## 任务 2　生成基础作品并隔离工作流版本

**改动文件**　`packages/storage/src/generations.mjs`、`packages/storage/src/generation/queue.mjs`、`apps/web/src/server/routes/internal-agent.mjs`、`apps/agent/src/buildurprofile_agent/{__init__.py,graph.py,skills/registry.py,transport/node_api.py}`。从 `apps/launcher/src/{resume-enrichment,internal-agent}.test.mjs` 和 `apps/agent/tests/test_graph.py` 写测试。

**接口**　`POST /api/generations` 复用 `{resumeId, revision, role, templateId: "pixel-world-v1", idempotencyKey}`。仅 Pixel 任务选择 `python-agent-v7`。`POST /_internal/agent/lease` 新增可选 `supportsPixelWorld: true`，缺省为 `false`。`design.template.v2` 承接 v7 固定映射，复用 `resume.compose.v5` 与 `artifact.qa.v4`。

- [ ] 写 `Pixel World queues a confirmed revision exactly once`，断言同会话同请求返回同任务，改模板或修订版返回 409，外会话请求返回 404。输出逐字保留服务端按已保存草稿投影的可见 `resume-v3` 和图片 ID。
- [ ] 写 `Pixel World lease skips workers without support`，让旧 Worker 越过队首 v7 领取后面的 v6。新 Worker 领到 v7，旧查询不能消费其尝试次数，过期租约不得提交。扩展一个旧 v6 赛博肖像的回归断言，确保仍使用 `avatar.wibi.v2`。
- [ ] 写 `test_v7_pixel_world_runs_without_portrait`，用真实 LangGraph 断言 `qa` 成功、`config.templateId` 保留、`output_asset_id` 为空、图路径没有头像节点。用 Node 测试确认两次完成最多创建一个免费项目，媒体跟随该项目。
- [ ] RED，用 `node --test --test-name-pattern='Pixel World' apps/launcher/src/resume-enrichment.test.mjs apps/launcher/src/internal-agent.test.mjs` 和 `uv run --project apps/agent --frozen --extra test pytest -q apps/agent/tests/test_graph.py -k 'v7_pixel'`，验证当前队列落到 v6 或 Agent 不支持 v7。
- [ ] GREEN，在入队处按模板选择 v7。Node 查询在领取前筛掉不兼容任务。新 Python 客户端显式声明能力。图同时验证版本和模板组合，完成校验、确认内容比较及无肖像自动建项目纳入 v7。其他模板仍按原版本入队，保留 v2–v6 分支和旧客户端兼容。
- [ ] 复跑原命令、`npm run test:agent` 和 `npm run test:payment`。通过后提交 `接通像素世界风的版本化生成任务`。

## 任务 3　模板页面与选择入口

**改动文件**　新增 `apps/web/src/components/PixelWorldPage.tsx`、`apps/web/src/components/PixelWorldPage.test.tsx`、`apps/web/public/pixel-world-default.webp`。修改 `apps/web/src/{ShowcasePage.tsx,styles.css,App.tsx,components/BuilderExperience.tsx}`。从 `apps/web/src/{App.test.tsx,ShowcasePage.test.tsx}` 扩展分流与选择测试。

**接口**　`PixelWorldPage` 接收 `config: DesignConfigV4`、`resolveResumeImage`、`preserveShareHash`、`staticDecorations`、可选 `defaultPortraitUrl`。章节 ID 采用 `resume-v3` 模块键，联系区用 `contact`。列表中每张项目卡展示首张确认图，额外图片、长正文和补充内容在卡片内的原生展开区域可见。链接保留作者标签并走现有安全 URL 校验。

- [ ] 写 `Pixel World renders confirmed projects in order without inventing content`，输入乱序的 `order`、一个 0 图项目和一个 6 图项目，按确认顺序渲染且六张图可达。断言长中文及原有换行可读，空条目、隐私字段、危险 URL、无依据的技术标签与占位链接均未进入页面。GitHub／Demo 测试使用作者已确认的链接和标签。
- [ ] 写 `Pixel World launch jumps to an available section`，断言有项目时定位 `projects`，无项目时使用首个可见模块，全空时省略 CTA。没有公开联系方式时省略对应 CTA。键盘可展开项目详情，现有 `#share=` 保持可刷新，非分享页锚点可直接访问。重复同类模块时仍有唯一锚点。
- [ ] 写 `selecting Pixel World generates the confirmed resume without a portrait`，断言新流程模板卡可选，提交显式 ID 且无 `answers`、无上传请求。旧浏览器兼容流程不会提供一个无法生成的 Pixel 选项。保留赛博模板和旧 `dark-tech` 的分流断言。
- [ ] RED，用 `npm test -- PixelWorldPage App.test ShowcasePage`，验证选择入口、渲染入口、章节结构或锚点行为缺失。
- [ ] GREEN，仅在 `templateId === "pixel-world-v1"` 且 `resume-v3` 时进入专用渲染器，复用 `resumeDisplayContent`、现有正文组件及媒体解析。按语义结构实现首屏、正文、可见导航和默认角色，CSS 采用 `minmax(0, 1fr)`、长文本断行与 `prefers-reduced-motion`。将 CSS 放在现有离线导出会读取的样式入口。风格选择卡位于赛博科技之后。
- [ ] 复跑原命令、`npm test`、`npm run build`。在 `1600×900`、`768×1024`、`390×844` 检查首屏、网格、长中文、键盘导航和默认角色。通过后提交 `实现像素世界风首屏和开发者作品展示`。

## 任务 4　打通默认角色的分享和离线导出

**改动文件**　`apps/web/src/server/{service.mjs,export.mjs}`、`apps/web/src/export-entry.tsx`。测试放 `apps/launcher/src/{export,payment,resume-enrichment}.test.mjs`。复用原有项目、媒体和权限接口。

**接口**　`buildStaticHtml(config, javascript, css, mediaReader)` 根据模板自动内嵌原创默认角色。`createProject`、`updateProject` 对 Pixel 配置里的 `heroArtwork` 一律返回 400。任务 7 为工作台提供独立的预览配置。`publish`、`readShare`、`issueDownload` 和 `getDownload` 对意外读到带 `heroArtwork` 的 Pixel 配置同样拒绝，避免读取已签发的分享或下载时绕过限制。

- [ ] 写 `Pixel World offline export embeds its own default portrait and all project media`，用真实导出 bundle 打开 HTML，断言 Pixel 首屏存在、角色为正确 WebP 的 data URI、已确认图片都可见，页面加载没有项目 App 或 Cloudflare 网络依赖。导航及展开使用同一套渲染器。
- [ ] 写 `Pixel World personal artwork cannot be persisted or delivered`，用真实服务/API 验证直接构造包含内嵌头像的创建、更新请求返回 400。伪造其他 `styleId` 也被拒绝。用临时库里的异常项目验证发布和导出拒绝，并确认失败时项目修订和有效分享保持原值。
- [ ] 写 `Pixel World default art is exportable for free and sharing requires entitlement`，断言项目属主可免费下载且权益未改变，非属主访问失败，未付款分享仍走现有 402，既有已授权测试路径能读取分享快照中的 Pixel ID 和确认媒体。测试走现有合成验签机制。
- [ ] RED，先运行 `npm run pretest:payment` 生成导出 bundle，再运行 `node --test --test-name-pattern='Pixel World' apps/launcher/src/export.test.mjs apps/launcher/src/payment.test.mjs apps/launcher/src/resume-enrichment.test.mjs`，观察离线角色缺失和直接写入肖像未被拒绝。
- [ ] GREEN，扩展默认角色内嵌规则和服务端 Pixel 配置守卫。分享快照和离线文件继续复用确认媒体和独立渲染器。该阶段完整交付默认角色版本。
- [ ] 复跑定向测试、`npm run test:payment`、`npm run build`，并在浏览器断网打开导出的 HTML。通过后提交 `接通像素世界风的免费导出和授权分享`。

## 任务 5　版本化肖像配方与私有任务

**改动文件**　新增 `packages/skills/src/pixel-avatar.ts` 和 `packages/skills/src/resources/pixel-world-v1/` 下的原创参考图与来源说明。修改 `packages/skills/src/avatar-catalog.ts`、`packages/storage/src/generation/queue.mjs`、`apps/web/src/server/routes/{generations,internal-agent}.mjs`。测试放 `packages/skills/src/registry.test.mjs` 与 `apps/launcher/src/{generations,internal-agent}.test.mjs`。

**接口**　`TEMPLATE_PORTRAIT_POLICIES["pixel-world-v1"]` 绑定 `pipelineId: "avatar.pixel.v1"` 与 `styleId: "pixel-halfbody-v1"`。私有 `/recipe` 返回该 ID、固定 `version: "1.0.0"`、原创来源和许可信息、提示词及哈希校验通过的参考图。头像使用现有 `{portraitAssetId, idempotencyKey, config}` 请求，`config` 为当前预览的 Pixel V4 配置，移除 `heroArtwork` 和 `sourceRefs`，项目媒体保留 ID。

- [ ] 写 `Pixel World photo tasks are local, session-owned and pinned to a recipe`，断言本机开启时按配置入队 v7。关闭肖像开关时上传/生成返回 403，照片不属于当前会话时返回 404，错配配方或向无模板任务提交 Pixel 配方时返回 400，同键重放只返回原任务。
- [ ] 写 `Pixel World uses the existing leased recipe and asset endpoints`，断言无有效租约时读配方、读照片或写结果失败，跨会话无法下载成图，有效租约看到正确配方和素材。头像任务完成后原项目的配置与修订不变，`heroArtwork.assetUrl` 只出现在属主任务结果上。覆盖未知配方、篡改参考图和旧 Wibi 配方仍可读。
- [ ] RED，用 `node --test --test-name-pattern='Pixel World' apps/launcher/src/generations.test.mjs apps/launcher/src/internal-agent.test.mjs packages/skills/src/registry.test.mjs`，验证模板策略与配方分流缺失。
- [ ] GREEN，扩充模板策略，新增按配方 ID 分发的原生加载器。Pixel 参考图固定 SHA-256，旧 Wibi 加载器继续读原安装目录。照片许可与版本由服务端确定。保留头像型任务的租约、取消、重试和资产过期规则。Pixel 的带照任务只走现有配置再生入口，服务端拒绝同时提交简历修订和像素照片的混合请求。
- [ ] 复跑定向测试、`npm run test:skills`、`npm run test:payment`。通过后提交 `新增像素角色的私有配方与任务策略`。

## 任务 6　Cloudflare Skill 与像素化质检

**改动文件**　新增 `apps/agent/src/buildurprofile_agent/skills/pixel_avatar.py` 和 `apps/agent/tests/test_pixel_avatar.py`。修改 `apps/agent/src/buildurprofile_agent/{graph.py,skills/registry.py,providers/cloudflare_images.py,server.py,worker.py}`、`apps/agent/tests/{test_cloudflare_provider,test_graph}.py` 和 `apps/web/src/server/routes/internal-agent.mjs` 的错误码表。

**接口**　`generate_pixel_avatar(inputs, tools) -> {outputAssetId, recipeVersion}`，使用 `read_portrait`、`load_recipe`、`existing_output`、`store_output`、`output_exists`、`image_provider`、`check_cancel`。`normalize_pixel_avatar(image: GeneratedImage) -> GeneratedImage` 输出一张 `512×512` PNG，由 `64×64` 像素母版整数倍放大。v7 配方只调用现有 Cloudflare Workers AI 模型，复用已有凭据。若默认供应商设为 OpenAI，仍向 Pixel 分支注入 Cloudflare 适配器。其他模板继续使用既有供应商选择。

- [ ] 写 `test_pixel_avatar_quantizes_and_upscales_without_blurring`，用合成色块断言每个 `8×8` 输出块像素相等，至多 32 种不透明颜色、无抖动、输出为 PNG，重复输入得到相同像素。测试合格的透明边缘、与背景同色但被主体包围的像素、不可用的背景色和占比异常。验收通过时 alpha 只有 `0/255`。边界不可靠时，断言得到完整不透明卡片。损坏、超过 10 MiB、边长不在 `256–2048` 或非方形成图返回 `PIXEL_OUTPUT_INVALID`。
- [ ] 写 `test_pixel_avatar_reuses_stored_output` 和 `test_v7_pixel_avatar_uses_leased_capabilities`，断言已有有效产物时 Cloudflare 无新请求。构造完整编辑 HTTP 响应，检查送出的 multipart 只有授权照片、已审核参考图和固定提示词。通过 `process_task` 验证取消或租约失效不发布资产，已有成图的重试只读取已保存 ID，供应商超时或配方错误保留可识别失败原因。现有 Wibi v6 成图和去背景用例仍通过。
- [ ] RED，用 `uv run --project apps/agent --frozen --extra test pytest -q apps/agent/tests/test_pixel_avatar.py apps/agent/tests/test_graph.py apps/agent/tests/test_cloudflare_provider.py -k 'pixel or v7'`，验证尚无像素规范和 v7 肖像分支。
- [ ] GREEN，注册 `avatar.pixel.v1` 版本 `1.0.0`，使用 200 秒 Skill 上限覆盖现有 180 秒供应商调用与本地处理。头像分支校验版本和授权配方后调用 Cloudflare。第一版配方要求 `#F000A8` 纯色背景和无阴影。用 Pillow 缩至母版，量化前以角点校准背景色，再按 RGB 每通道差值 ≤24 识别候选背景。从母版边界做四连通填充，主体占比在 `14%–88%` 且中心像素仍不透明时才输出二值蒙版，并校正外缘染色。质检失败时用量化后的不透明画面。最后以最近邻放大。只存最终图，沿用输出 ID 和租约语义。
- [ ] 将 `PIXEL_OUTPUT_INVALID` 加入既有 Node 错误码表并断言返回可重试操作提示，当前任务不自动重试不可解码成图。Cloudflare `429` 和 `5xx` 沿用现有有界重试。对供应商已经收到请求但本地未收到结果的情况，记录现有语义只保证已落库成图复用。
- [ ] 复跑定向测试、`npm run test:agent`、`npm run test:payment`。通过后提交 `用 Cloudflare 生成并校验个人像素角色`。

## 任务 7　编辑页候选体验与端到端验收

**改动文件**　`apps/web/src/{App.tsx,App.test.tsx,components/BuilderExperience.tsx,components/PixelWorldPage.tsx,lib/generationApi.ts,lib/generationApi.test.ts}`、`apps/agent/tests/test_node_bridge.py` 及相邻 `fixtures/`、`docs/{web/README.md,agent/README.md,shared/architecture.md,api/README.md}`。

**接口**　Pixel 结果页提供「选择照片」「生成像素头像」「使用此头像」「恢复默认角色」。候选、选用结果和头像任务指针只放在页面内存中，以当前作品和请求代次为边界。预览临时把选用结果合并到渲染配置。保存、分享和导出一律使用基础作品配置，项目内容编辑仍按现有路径保存。

- [ ] 写 `Pixel World photo upload requires an explicit generation action`，断言选择文件时 0 个上传请求，上传前展示 Cloudflare 和 1 天／7 天的说明，点击生成才按顺序提交 `/api/portraits` 与 `/api/generations`。未启用本机演示时编辑页没有该操作，默认角色仍有完整作品预览。
- [ ] 写 `Pixel World candidate is applied only after selection`，断言生成成功先显示候选，主预览仍默认。选用才切换主预览，再生失败保留已选角色。切换照片、项目或恢复默认后，旧响应不回写。成图过期或加载失败回退默认，编辑中的正文和项目素材仍在。
- [ ] 写 `Pixel World preview artwork is not exported or published`，断言当前私有预览可显示选用角色，交付操作显示默认角色说明，项目写入 payload 不含 `heroArtwork`。模拟刷新期间曾有 Pixel 头像任务的场景，恢复基础作品，不能用旧头像任务的 config 替换其内容。头像任务使用独立的前端恢复策略，现有基础作品和 Wibi 恢复逻辑仍按旧路径执行。
- [ ] 写 `test_real_node_bridge_pixel_avatar_stays_private`，沿用真实 Node 进程、临时 SQLite 和 Python 客户端，只替换 Cloudflare HTTP。验证照片提交、领取、配方读取、Agent 成图、私有 GET、基础项目原配置完整保留这一条路径。断言请求完成时浏览器属主能读到 PNG，另一会话读不到，Agent 没有把图片写入 checkpoint。
- [ ] RED，用 `npm test -- App.test generationApi PixelWorldPage`，验证当前再生流程会直接替换头像或缺少 Pixel 私有候选入口。
- [ ] GREEN，复用现有图片预处理、CSRF、请求轮询和取消接口，Pixel 候选单独维护请求代次。基础作品生成恢复指针与 Pixel 私有头像任务隔离。加入失败状态、默认回退和交付提示。同步更新受影响的模块文档与模板、工作流清单。
- [ ] 复跑定向测试及全部发布前命令。用 `uv run --project apps/agent --frozen --extra test pytest -q apps/agent/tests/test_node_bridge.py -k pixel_avatar` 跑真实 Node／Agent 集成。若后端三个任务已经连通，新增的桥接用例可以直接作为集成验收，与本任务的前端 RED 结果分别记录。使用合成 PDF 查看「核对 → 选择 Pixel → 生成默认作品 → 编辑 → 分享入口／免费导出」。使用外部 HTTP 测试替身贯通「选照片 → 生成候选 → 选用 → 恢复默认」。各验证完成后提交 `接通像素角色候选预览与交付验收`。

## 发布前验收

- [ ] 在仓库根目录运行 `npm test`、`npm run build`、`npm run test:skills`、`npm run test:agent`、`npm run test:payment` 和 `git diff --check`。记录实际失败用例、修复与复测结果。
- [ ] 用宽屏、平板和手机尺寸浏览默认角色与有图项目，检查无项目、无联系方式、长中文、六图展开、断网导出、分享页刷新，以及键盘和系统减少动态效果设置。
- [ ] 在具备 Cloudflare 配置的本机环境，通过真实 provider 发送至少三张可提交、可传输的合成肖像。覆盖无配饰、戴眼镜、发型轮廓明显三类，记录模型、配方版本、耗时、输出大小及透明或卡片结果。三张均能解码、符合像素块规范，并能凭发型或配饰辨认输入差异，才将头像标为本机可验收。账号可用性、生成质量与计费数据由这一步核实。
- [ ] 验证其他四套模板、旧 `dark-tech`、旧任务完成及 Wibi 本机路径。正式分享继续依赖既有权益核验。真实支付与公网回调的验收按[支付文档](../api/payment.md)执行。

实施顺序为任务 1 → 2 → 3 → 4，先完成可交付的默认角色模板，再做任务 5 → 6 → 7。默认模板的验收可在无 Cloudflare 凭据的环境进行，个人头像的真实出图验收依赖已配置的 Cloudflare 账号。
