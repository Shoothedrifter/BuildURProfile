# Pixel World 照片识别与图层合成实施计划

> 实施时使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`。每项先观察行为断言失败，再实现、复测和审查。提交信息用简体中文。

**目标**　作者主动提交照片后，用可见的发型、发色、眼镜和头颈配饰线索，为同一个 Pixel World 角色生成私有预览候选。

**架构**　视觉模型做有限分类，Agent 将分类映射到经过审查的素材，Pillow 在固定画布上合成。新照片任务使用 `python-agent-v8` 与 `avatar.pixel.v2`，复用现有租约和 PNG 资产接口。

**技术栈**　现有 Next.js、SQLite、FastAPI、LangGraph、Pydantic、httpx、Pillow、Cloudflare Workers AI。测试使用 pytest、Node `node:test`、Vitest 和浏览器。

**规格依据**　[Pixel World 作品集架构](../web/pixel-world-architecture.md)、[项目约束](../../AGENTS.md)、[架构与协议](../shared/architecture.md)。默认角色以提交 `9e07433` 的 SVG 为准。

## 设计规格

### 素材与实施范围

四份设计稿的画布均为 `1254 × 1254`。当前模板已直接使用 [默认 SVG](../../apps/web/public/pixel-world-base.svg)。`glasses.svg`、`long-hair.svg` 和 `twin-tails.svg` 都是完整角色图，逐像素对比时在衣服区域也能看到差异。以三张图为美术依据制作局部图层，可以组合发型和眼镜，也能用测试锁定角色的脸和衣服。整图选预设可以较快演示分类，但会继承这些差异并增加组合图数量，因此只用局部图层进入实现。

| 属性 | 识别值 | 首批合成规则 |
| --- | --- | --- |
| 人物可用性 | `usable`、`multiple_people`、`no_person`、`unclear` | 一位清晰的主要人物才继续。背景路人和手持道具不算主要人物 |
| 发型 `hair_style` | `short`、`long`、`twin_tails`、`other`、`unknown` | 短发对应底稿，长发与双马尾对应审核过的替换层。低扎双束或双辫可归入 `twin_tails` |
| 发色 `hair_color` | `dark`、`brown`、`blond`、`gray_white`、`vivid`、`unknown` | 首批使用原稿深色及暖棕。暖棕暗部、中间色、高光的初始提案为 `#30201F`、`#59382D`、`#8A5C43`，在素材验收时定稿。其他颜色保持所选发型的原稿色 |
| 眼镜 `glasses` | `none`、`frames`、`other`、`unknown` | `frames` 叠透明镜片区域的镜框。墨镜归入 `other`，保留角色眼睛 |
| 头饰 `headwear` | `none`、`hair_clip`、`headband`、`hat`、`other`、`unknown` | 先校验识别。按类别接入通过审查的素材 |
| 耳部佩戴 `earwear` | `none`、`earring`、`headphones`、`other`、`unknown` | 先校验识别。按类别接入通过审查的素材 |
| 颈饰 `neckwear` | `none`、`choker`、`necklace`、`scarf`、`other`、`unknown` | 先校验识别。首批可补 `choker`，仅覆盖颈圈的批准范围 |

例如，参考照片可以映射到深色双马尾和颈圈。以首批已有素材运行时，候选展示双马尾。颈圈图层审查通过后，同一识别结果再叠加颈圈。发型、发色和镜框为首批功能，头饰、耳饰、颈饰的渲染可逐件接入。识别正常但没有适用的变更时，页面提示可继续使用默认角色或换一张照片。已有选用的候选时，尝试新照片失败仍保留已选候选。

发型为 `other` 或 `unknown` 时保留短发形状。清楚识别的暖棕色或镜框仍可单独应用。素材版本固定在对应工作流，`python-agent-v8` 使用首批图层清单 `2.0.0`。未来新增可显示的配饰时，按版本接入新素材包，让已入队任务继续读取最初的素材。

### 固定角色与交付

- 底稿锁定画布、头身比例、脸部关键区域、表情、姿态和服装。长发可以遮到肩部，限定为挂在服装前的发丝区域。
- 合成始终只装载项目打包的静态素材。发型、发色和配饰互相独立，模型输出只能选择枚举。确认后的简历和页面配置不进入识别请求。
- 新识别和个性化候选继续受 `AVATAR_DEMO_ENABLED`、本机主机限制和既有非生产条件控制。照片只在明确点击后发送给 Cloudflare，源照片按现有规则保留 1 天，私有候选保留 7 天。
- 作者显式选用候选才替换当前预览。刷新、保存、在线分享和单文件 HTML 均用 `pixel-world-base.svg`。无照片的作品继续走现有 Agent 基础生成。

### 数据流与版本

```text
选择照片 → 本地压缩 → 点击「识别照片特征」
  → 现有私有照片上传与生成队列 → v8 租约
  → Cloudflare 分类一张照片 → Agent 严格校验枚举
  → 查找本地批准图层 → 固定底稿合成透明 PNG
  → 现有私有成图接口 → 编辑预览候选 → 作者选用
```

| 边界 | 接口 |
| --- | --- |
| Provider | `CloudflarePixelVisionProvider.classify(portrait: Portrait) -> PixelAvatarTraits`，异步，只负责请求和校验 |
| Agent 内部数据 | Pydantic 严格模型 `PixelAvatarTraits`，发布内部 Schema `pixel-avatar-traits.v1.json`。字段为 `subject` 与上表六个外观枚举，不传给 Node 或浏览器，不写 checkpoint |
| 资产合成 | `load_pixel_avatar_layers() -> PixelAvatarLayers`、`select_pixel_layers(traits: PixelAvatarTraits, layers: PixelAvatarLayers) -> PixelLayerSelection`、`compose_pixel_avatar(selection: PixelLayerSelection, layers: PixelAvatarLayers) -> GeneratedImage`。选层结果带 `is_default`，以是否有可应用的视觉变化为准 |
| Graph | `avatar.pixel.v2`，注册版本 `2.0.0`，`commercial_allowed=False`，初始总超时 35 秒。输入仍为 `taskId/styleId`，输出为 `outputAssetId/recipeVersion`，图只保存后两项和原有任务字段 |
| 任务 | 新的 Pixel 带照片任务为 `python-agent-v8`。Worker 领取时声明 `supportsPixelLayerAvatar: true`。v8 只允许带照片、显式 Pixel 模板和已生成配置的任务。基础生成与历史 v7 任务仍使用 v7 的模板映射和原配方。新旧继续使用 `pixel-world-v1` 和 `pixel-halfbody-v1` 标识模板及交付限制 |
| Web | 复用 `POST /api/portraits`、`POST /api/generations`、任务轮询和私有图片 URL。沿用已有 `heroArtwork` 候选结构 |

现有接入点是 [生成图](../../apps/agent/src/buildurprofile_agent/graph.py)、[任务队列](../../packages/storage/src/generation/queue.mjs)、[内部接口](../../apps/web/src/server/routes/internal-agent.mjs) 和 [头像编辑器](../../apps/web/src/components/PixelAvatarEditor.tsx)。原 v7 的 Cloudflare 整图、32 格处理和 14 色配方保留在 v7 分支。v8 使用设计稿的色板和画布。

### 识别模型与判断规则

首测 Cloudflare Workers AI 的 `@cf/cloudflare/clef`。它可以接收一张内嵌图片和带选项的分类问题，返回各选项的概率，适合这一组有限属性。备选 Moondream 3.1 可以接受图片并回答问题，若 Clef 实测未达到门槛，再用同一组照片和合同评估它。两者都只承担识别。 [Clef 模型文档](https://developers.cloudflare.com/workers-ai/models/clef/) · [Clef 输入输出 Schema](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/clef.json) · [Moondream 3.1](https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/)

- 复用 Agent 的 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。验证 JPEG、PNG 或 WebP，做 EXIF 正向旋转、移除元数据、按比例缩到最长边 1024px，重新编码成 JPEG，限制解码 16MP、外发字节 1 MiB。浏览器继续沿用现有预处理，Agent 独立校验直传请求。
- 向 Workers AI REST 发一次带 `model: "clef"`、固定 `state`、一张 `images` 和七条 `choice` 问题的请求。图片表示为 `{"content_type":"image/jpeg","base64":"…"}`，每个枚举附具体可见定义。响应仅读取 `result.answers` 的预期字段。分值有限且位于 `[0,1]`，每项概率分布覆盖精确的选项集合，和值误差至多 `0.001`，`choice` 须为最高分选项。缺键、未知值或格式错误为 `PIXEL_TRAITS_INVALID`。
- 首批阈值作为本地评测起点。主体被判为 `usable` 时须满足最高分 ≥ `0.80` 且领先第二名 ≥ `0.20`。其他外观项须满足最高分 ≥ `0.70` 且领先 ≥ `0.20`，否则归为 `unknown`。使用选项概率做判断，供应商的 `confidence` 字段不当成已校准的正确率。人物不清楚时停止组装，提示作者换清晰单人照。
- 默认连接超时 5 秒、请求总超时 20 秒。沿用队列对 429 和 5xx 的有界重试。无凭据、不可用的照片、无匹配素材、响应结构无效和超时给出明确错误码。超时后由作者决定是否重试，避免自动重复调用。

## 按 TDD 实施

### 任务 1　从原稿制作可审查的图层包

**文件**　新增 `scripts/prepare-pixel-avatar-assets.py`、`apps/agent/src/buildurprofile_agent/skills/pixel_avatar_layers.py` 和 `apps/agent/src/buildurprofile_agent/resources/pixel-avatar-v1/`，pytest 位于 `apps/agent/tests/test_pixel_avatar_layers.py`。在 `apps/agent/pyproject.toml` 声明资源包数据。本任务负责 `load_pixel_avatar_layers`，任务 2 在同一模块加入选层和合成。

设计稿交接以文件名和 SHA-256 确认。底稿来自仓库，其他原稿来自本次用户提供的三个附件。保存审核后的图层和遮罩作为版本化运行资源。导入脚本通过 `--base` 和 `--variants-dir` 获取源文件，通过 `--output-dir` 写入工作目录。

| 源文件 | SHA-256 |
| --- | --- |
| `pixel-world-base.svg` | `21c0d92bc051a2d8f51372930d0823a01598b70e10ef6ba09b632663d2c10fc7` |
| `glasses.svg` | `757f8bbc5d8526815408298df125230ed7ee2f67a74063dbb62b1f3565f11fa6` |
| `long-hair.svg` | `294f4b419a910ca8e4953ad7b4f2d64054ac4b637d23bc58f26e68c8ab098aad` |
| `twin-tails.svg` | `e4ce1d489bb88244c9d94f1b01875558175180f8f03c438a034ef32f555d0ac4` |

- [ ] 写资源测试。以透明原稿为基准，断言画布 `1254 × 1254`、二值透明、原稿哈希及所有运行时资源哈希匹配。注入尺寸错误、损坏素材、清单指向包外路径及越过保护区的图层，断言加载拒绝。
- [ ] 运行命令观察缺失图层包或校验断言失败。先创建最薄的可导入接口时，断言应落在资产验证行为上。
- [ ] 用固定 RGBA 输出栅格化底稿。原四稿是矩形平涂路径，可用导入脚本复现其坐标，遇到其他 SVG 几何即提示由设计工具导出图层。脚本只用于制作受审素材，由显式文件参数导入。应用运行时读取随安装包分发的本地 PNG 和清单。
- [ ] 从 `long-hair`、`twin-tails` 稿圈定发际线、侧发和肩前发束。将原短发需去除或露出额头的位置做成批准的替换遮罩，露出的额头使用固定底稿色。镜框单独提取，镜片区透明。标注头发内部的暗部、中间色、高光蒙版。
- [ ] 保存 `base.png`、独立审核的 `hard-lock.png`、按操作独立批准的二值允许遮罩、各图层及 `manifest.json`。加载器固定清单的 SHA-256，再按清单校验素材与各类遮罩的哈希。保护遮罩固定五官、嘴和颈躯干未批准覆盖区域。与四张原稿并排检查发际线、眼镜对齐及发丝覆盖肩部的边界。
- [ ] 校验每个写操作的像素集合。覆盖读取图层非零 alpha，擦除和复原读取相应二值操作遮罩，重着色读取头发色板遮罩。每个集合都必须是独立批准允许区的子集，并与 `hard-lock.png` 无交集。新增用例验证图层试图扩大允许遮罩到眼睛或用透明擦除碰到保护区时被拒绝。
- [ ] 复跑资源测试。从已构建 wheel 的安装位置加载图层包，验证运行期不要求 Downloads 或 Web 构建目录。建议提交 `制作像素角色分层素材`。

```sh
uv run --project apps/agent --frozen --extra test pytest -q apps/agent/tests/test_pixel_avatar_layers.py -k assets
```

### 任务 2　实现确定性合成与像素不变校验

**文件**　扩展 `apps/agent/src/buildurprofile_agent/skills/pixel_avatar_layers.py` 和 `apps/agent/tests/test_pixel_avatar_layers.py`。在 `apps/agent/src/buildurprofile_agent/contracts.py` 定义 `PixelAvatarTraits`，将 Pydantic Schema 导出到 `packages/contracts/schema/pixel-avatar-traits.v1.json`，在 `apps/agent/tests/test_contract_schema.py` 比较。

- [ ] 先测试原稿、长发、双马尾、双马尾加眼镜、暖棕长发、发型未知但眼镜可用、无对应配饰七类输入。全默认的输出须与 `base.png` 完全相同。其余组合的 RGBA 差异限定在本次选中的各允许区的并集内，且保护区逐字节相等。合成出图前也执行同一校验。加入只改 RGB 的失败样例，明确同时比较 RGB 与 alpha。
- [ ] 在当前代码上观察合成行为测试与 Schema 测试失败。实现 `select_pixel_layers` 和 `compose_pixel_avatar`。从透明画布依次绘制后发、按批准遮罩修补短发的角色底稿、前发、镜框及已配置的配饰。仅在头发遮罩内按三档色板替换颜色。用同一组资源验收所有组合，检查透明背景和镜片区域。
- [ ] 用独立的输出图对象处理每个请求。确认执行顺序、并行调用和重试不会修改缓存中的底稿。首版输出透明 `1254 × 1254` PNG，让默认 SVG 和候选使用相同坐标空间。现有服务端 PNG 与尺寸校验可接收。
- [ ] 复跑图层及 Schema 测试。建议提交 `锁定底稿并合成像素造型`。

```sh
uv run --project apps/agent --frozen --extra test pytest -q apps/agent/tests/test_pixel_avatar_layers.py apps/agent/tests/test_contract_schema.py
```

### 任务 3　接入 Cloudflare 照片分类

**文件**　新增 `apps/agent/src/buildurprofile_agent/providers/cloudflare_pixel_vision.py` 和 `apps/agent/tests/test_cloudflare_pixel_vision.py`。

- [ ] 用 `httpx.MockTransport` 断言只发一张预处理图、七道固定问题和有限类别，验证无照片元数据、无简历或角色原稿输入。失败用例覆盖旋转 JPEG、多帧 WebP、超尺寸、错误 MIME、置信度临界、相近类别、未知枚举、错误 `choice`、错误概率合计、无/多人、401、429、5xx、超时和模型返回非法 JSON。
- [ ] 运行定向测试，观察请求或校验断言失败。实现 `classify(portrait)`。正常响应只返回 `PixelAvatarTraits`。使用已有 `ImageProviderError` 分类，日志只含允许的错误码与耗时。超时和失败没有整图回退。
- [ ] 复跑定向测试，检查异常字符串和日志都没有照片、响应正文或认证头。建议提交 `用 Cloudflare 识别像素造型特征`。

```sh
uv run --project apps/agent --frozen --extra test pytest -q apps/agent/tests/test_cloudflare_pixel_vision.py
```

### 任务 4　接通版本化头像任务

**文件**　修改 `apps/agent/src/buildurprofile_agent/{__init__,graph,server,worker}.py`、`skills/registry.py`、`transport/node_api.py`、`packages/storage/src/generation/queue.mjs`、`packages/skills/src/avatar-catalog.ts` 和 `apps/web/src/server/routes/internal-agent.mjs`。新增 `apps/agent/src/buildurprofile_agent/skills/pixel_avatar_v2.py`。测试沿用 `test_graph.py`、`test_node_bridge.py`、`apps/launcher/src/{generations,internal-agent}.test.mjs` 及真实桥接 fixture。

- [ ] 先写队列用例。v8 只用于带照片的 Pixel 预览，新 Worker 可领 v7/v8，旧 Worker 跳过 v8 并能处理下一条旧任务，未领取的 v8 不增加尝试次数。部署前后的相同幂等键返回原任务。无照片任务仍创建一个免费项目，v8 候选完成不创建项目。
- [ ] 写真实图与私有 HTTP 桥接用例。分类成功时写入一张透明 PNG，原始作品配置逐项一致。已存有效输出复用，供应商零调用。已绑定输出过期后在读取照片前停止，同样零调用。分类中取消、租约丢失、后续请求被别的会话读取、损坏图层或合法分类没有可用图层时均有对应结果。检查 SQLite checkpoint 无照片、特征分布或模型正文。新 Worker 处理旧 v7 有照与无照任务时仍使用原图步骤，Wibi 回归继续通过。
- [ ] 运行定向测试，确认版本与领取断言失败。Node 更新工作流白名单、能力过滤和 v8 完成时的模板及内容一致校验。Python 将 v7 和 v8 定义为独立常量与分支，避免只改当前 `WORKFLOW_VERSION` 时让旧版落入其他模板。保持 `avatar-styles` 对外 ID 和业务状态结构，更新固定模板当前 `pipelineId`。v8 继续使用已租约的 `portrait/output/complete`。配方在 Agent 安装包内，v8 图无需调用旧 `recipe`。
- [ ] 注册 `avatar.pixel.v2`。授予 `read_portrait`、`classify_portrait`、`compose_layers`、`read_output_status`、`store_output`、`output_exists`、`check_cancel`。`read_output_status` 直接读取现有租约输出接口的 `{assetId, exists}`。有 ID 且有效时复用，有 ID 但已失效时返回 `PIXEL_CANDIDATE_EXPIRED`，无 ID 才识别照片。分类后和写出前校验取消与租约。由 `compose_layers` 在选层结果为默认时返回 `PIXEL_NO_SUPPORTED_TRAITS`，原有任务状态仍要求成功时有真正的候选资产。Worker 按已安装的流程声明能力，凭据缺失或素材损坏时只让 v8 任务明确失败，基础作品生成照常运行。
- [ ] Node 增加不可重试的 `PIXEL_PHOTO_INVALID`、`PIXEL_PHOTO_UNCLEAR`、`PIXEL_TRAITS_INVALID`、`PIXEL_NO_SUPPORTED_TRAITS`、`PIXEL_PHOTO_EXPIRED` 和 `PIXEL_CANDIDATE_EXPIRED` 映射。源照片过期对应已租约读取返回 404。两个过期提示均引导作者重新选择照片。凭据错误、限流与超时沿用现有状态。上传、生成、读取、取消和交付继续走原有会话保护。
- [ ] 跑 Agent、TS Skills 与 Launcher 回归。建议提交 `接通分层像素头像的版本化任务`。

```sh
npm run test:agent
npm run test:skills
npm run test:payment
```

### 任务 5　更新编辑体验并验证公开交付

**文件**　修改 `apps/web/src/components/PixelAvatarEditor.tsx`、`apps/web/src/App.test.tsx`，按需补 `apps/web/src/lib/generationApi.test.ts` 和 Launcher 导出回归。更新 `AGENTS.md`、`docs/agent/README.md`、`docs/shared/architecture.md`、`docs/web/README.md` 中对应规则。现有 32 格和 14 色注明属于 v7 整图配方。

- [ ] 写 UI 测试。选文件时没有上传请求。点击「识别照片特征」前用户已看到 Cloudflare、用途、保存期限、首批支持的发型／发色／镜框和预览范围。候选需明确选用。中途换照片、恢复默认、离开项目时旧响应不能覆盖当前预览。没有支持的特征时提示默认角色可用，已选头像可继续保留。
- [ ] 写交付测试。v8 私有候选不可写进共享配置，正式分享和离线 HTML 仍能读出原默认 SVG。现有默认 SVG、旧导出格式和其他模板通过原回归。
- [ ] 运行定向测试，确认新文案及候选行为缺失。将旧「生成像素头像」交互改成「识别照片特征」，复用现有取消、错误、结果和 `恢复默认角色`。保持现有首屏容器和响应式规则。
- [ ] 跑全量 Web、构建与本地交付回归。浏览器检查宽屏与窄屏。检查 Agent 非 editable 安装和 Compose 健康检查与重启。兼容发布顺序是先启动支持 v8 的 Agent，再切换入队端。回退时暂停本机编辑端发起新的头像请求，保持现有 Node 和 Agent 对已入队任务的读写，等排队与运行中的 v8 全部到达终态后再回退 Node。
- [ ] 能访问真实 Cloudflare 的本机，用获准传输的合成照片运行联调。首批验证集建议为 12 张清晰单人照和 6 张困难照。清晰组覆盖短发、长发、双尾、深色、暖棕、带框与无镜框组合，另含至少一张带颈圈的照片。困难组各取 2 张遮挡或暗光、多人和无主要人物。记录预期枚举、实际枚举、未知比例和耗时。首批门槛建议为清晰组至少 10 张的发型与镜框同时正确，4 张多人或无主体照均无候选，遮挡项没有误加图层，全部 PNG 通过像素不变测试。真实联调用于确定模型和阈值。
- [ ] 建议提交 `完善像素造型预览与交付验收`。

```sh
npm test
npm run build
npm run test:payment
```

## 审查重点

| 容易漏掉的输入 | 归属与可观察结果 |
| --- | --- |
| 镜框完整覆盖镜片、肩部像素被整图副本替换 | 任务 1、2，保护区逐像素一致，长发只影响批准允许区 |
| 夜景让深色发色偏判、道具挡住一束头发 | 任务 3、5，分数接近时落到 `unknown`，仍可采用清楚的其他属性 |
| 模型能识别出颈饰但暂无该素材 | 任务 2、4，应用其他批准图层；没有适用改动时明确反馈 |
| 老 Worker 抢到新版任务、候选越权或取消后迟到 | 任务 4、5，按能力领取，租约、会话与编辑器取消都能拦截 |
| 真模型调用失败，用户仍要导出作品 | 任务 4、5，基础作品和默认 SVG 仍可用，导出不调用视觉服务 |

首批交付以发型、暖棕色和镜框的组合通过验收为准。后续的头饰、耳饰和颈饰沿用识别字段与合成接口，按新的素材版本扩充组合用例。真实模型可用性和效果以联调结果为准。
