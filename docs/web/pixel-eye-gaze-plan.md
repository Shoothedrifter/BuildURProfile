# Pixel World 二维瞳孔随动实施计划

> 执行本计划时使用 superpowers:executing-plans，逐任务完成失败测试、实现与验证。复核可使用 superpowers:requesting-code-review。

**目标**　在默认像素角色及固定底稿合成的个性化 IP 上实现左右、上下二维瞳孔随动，首屏外复位，兼容模板样张、作品预览、分享和单文件 HTML。

**架构**　保留完整静态头像作为首帧与降级资源。前端用经审核的固定眼部配置重建眼睛，只在明确匹配既有角色眼部像素的图片上启用。浏览器负责坐标换算和逐帧绘制，照片识别与当前头像生成输出合同保持现有版本。

**技术栈**　React、TypeScript、Canvas 2D、Pointer Events、requestAnimationFrame、ResizeObserver、IntersectionObserver。素材准备沿用 Pillow，单元与组件测试沿用 Vitest。

**需求依据**　用户已选择 jld2nd 的二维瞳孔随动方式。参考其公开脚本中的 SVG 局部坐标换算、眼眶限位与 pointerleave 复位，使用本项目原创角色和图层。

## 已确认的代码基础

- `apps/web/src/components/PixelHero.tsx` 被模板选择页与作品页复用，当前通过 `<img>` 展示默认 SVG 或 `/api/hero-assets/…` 的个性化 PNG。
- 默认 SVG 为 1254 × 1254，路径按颜色合并，缺少独立眼睛分组。
- Python 分层头像沿用固定五官，眼镜最后叠加，现有生成输出为完整 PNG。
- 导出入口 `apps/web/src/export-entry.tsx` 将默认 SVG 的 data URI 传给 `ShowcasePage`，并设置 `staticDecorations`。
- 个性化 IP 只用于当前作者预览，正式分享和导出使用默认角色。随动是角色展示能力，默认角色在分享和导出中也应能随动。

## 本版交互与技术决策

1. 鼠标位于当前 Hero 内时，两眼分别朝向同一个鼠标目标。以每只眼睛自身中心计算位移。
2. 通过当前头像实际显示矩形，将 CSS 坐标映射回 1254 × 1254 素材坐标。计算时处理等比缩放及 object-fit 留白。
3. 初始参数为位移增益 0.03，横向上限 ±12、纵向上限 ±6 素材像素，按 3 素材像素取整。最终限位还要受审核眼眶及瞳孔尺寸约束，取更小值。Pilot 可收紧幅度，调整时同步测试。
4. 离开 Hero、窗口失焦、页面隐藏或角色离开可见区域时，立即回到中性视线。滚动或缩放后丢弃旧坐标，恢复中性。
5. 首版支持 fine pointer 且可 hover 的设备。触摸输入保持静态，尊重 `prefers-reduced-motion`。不新增点击、音效、角色翻转或头部倾斜。
6. 鼠标事件仅更新 ref。最多安排一个 rAF，只有目标位移改变才重绘，静止时停止调度。pointer handlers 不触发整页 React state 更新。
7. 原 `<img>` 始终保留为可访问名称和降级资源，Canvas 设置 `aria-hidden`，只覆盖眼部区域，原图其余部分始终显示。动画失败立即隐藏眼部画布。
8. 新增素材只包含眼部修复底片、瞳孔与高光、眼眶裁剪和眼镜等遮挡信息。不得将整张人物生成成动画视频。

## 眼部配置与兼容策略

新增版本化本地资源 `apps/web/src/assets/pixel-gaze-v1/`，由固定底稿和已有眼镜图层派生，两种配置分别为 `plain`、`frames`。所有坐标使用素材坐标。

每种配置必须包含可移动瞳孔及高光、可恢复的眼部底片、逐眼裁剪区域和前景遮挡。背景肌肤细节从底稿逐像素恢复，镜框、刘海与脸部保持正确前后顺序。

`matchPixelEyeProfile(source: ImageData): PixelEyeProfile | null` 只比较审核掩膜内的 RGBA，匹配固定底稿的 plain 或 frames 配置才启用。比较逐像素完成，不依赖 secure-context-only API。匹配区域包含眼睛及运动可影响的区域，不能仅凭尺寸或文件扩展名放行。

这使既有同底稿 PNG 可以直接使用随动。旧整图生成、未知头像、被改动的眼部或跨域不可读资源保留静态。为避免给所有长发头像误用同一眼部区域，Pilot 必须覆盖当前各发型，并确认头发覆盖运动区域时的遮挡规则。

当前计划不改变 Agent 输出、Skill 能力和任务合同，因而不新增工作流版本。若 Pilot 证明固定眼区无法可靠复原某类头像，则该类先静态降级，再单独设计新版本的分层输出合同，不能靠放宽匹配条件继续上线。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| `scripts/prepare-pixel-gaze-assets.py` | 从固定资源生成并校验新眼部资源，输出可复现清单 |
| `apps/web/src/assets/pixel-gaze-v1/` | 独立版本的眼部资源和配置，构建内嵌，无运行时第三方依赖 |
| `apps/web/src/lib/pixelGaze.ts` | 匹配、坐标换算、限位、像素取整及绘制纯函数 |
| `apps/web/src/lib/pixelGaze.test.ts` | 数学边界、匹配、绘制与中性图像一致性测试 |
| `apps/web/src/components/PixelGazePortrait.tsx` | 图片加载、Canvas、指针事件、可见性与资源清理 |
| `apps/web/src/components/PixelGazePortrait.test.tsx` | 生命周期、降级和事件行为测试 |
| `apps/web/src/components/PixelHero.tsx` | 接入统一角色组件，传递 Hero 交互区域 |
| `apps/web/src/components/PixelHero.test.tsx` | 默认和个性化头像、样张入口回归 |
| `apps/web/src/components/PixelWorldPage.tsx` | 沿用 touch/reduced-motion 语义并传递必要显示参数 |
| `apps/web/src/styles.css` | 设置图片和 Canvas 同尺寸叠放 |
| `apps/web/src/lib/export.test.ts`、`scripts/build-export.mjs` | 验证离线 HTML 中的资源与运行时打包 |
| `docs/web/README.md` | 更新交互、降级与导出说明 |

保持已有 Hero 和样式结构。新增 `pixel-gaze-v1/index.ts` 导出内嵌 RLE 编码像素与类型化坐标，资源脚本同步生成此模块，保证 Next.js 与离线导出共用同一资源。

## 任务 1　准备眼部资源和中性重建 Pilot

- [ ] 写失败测试 `neutral_plain_matches_original_rgba`、`neutral_frames_matches_original_rgba`。在各自审核区域内，中性合成必须逐像素等于原角色，区域外 RGBA 完全一致。
- [ ] 添加 `moving_pupils_stays_inside_eye_masks`、`glasses_remain_in_front`、`unknown_eye_region_returns_null`。用本地合成发型输出覆盖短发、长发、双马尾和碎刘海，禁止上传真实照片作为测试。
- [ ] 运行定向测试，记录缺失资源或绘制函数导致的预期失败。
- [ ] 在 `pixelGaze.ts` 定义 `PixelEyeProfile`、`matchPixelEyeProfile`、`drawPixelGaze(context, profile, offsets)`。`offsets` 为左右眼各自的 `{x, y}`。
- [ ] 实现资源准备脚本及配置。原头像作底图，眼部底片先恢复，再画移动瞳孔与高光，最后恢复镜框等前景。每次重绘从原图开始，避免拖影。
- [ ] 运行测试及同尺寸浏览器 Pilot，查看中性、左上、右下和戴眼镜状态。任何重影、肤色补丁或镜框漂移均在素材侧修正。
- [ ] 验证通过后提交，建议信息为 `准备像素角色二维视线图层`。

## 任务 2　实现坐标换算与限位

- [ ] 写失败测试 `same_target_aligns_both_eyes`、`diagonal_offset_is_clamped`、`scaled_portrait_keeps_same_gaze`、`object_fit_padding_is_excluded`、`invalid_rect_returns_neutral`。
- [ ] 测试 gain 0.03、±12/±6 上限、3 像素取整，以及实际眼眶小于上限的边界。取整后再次限位，保证最终结果仍合法。
- [ ] 运行 `npx vitest run --config vitest.config.ts apps/web/src/lib/pixelGaze.test.ts`，观察预期失败。
- [ ] 实现 `computePixelGaze(pointer, imageRect, profile): EyeOffsets`。输入坐标和矩形使用同一 viewport 坐标系；不要将 pageX 与 getBoundingClientRect 混用。
- [ ] 同命令验证通过，提交 `实现像素瞳孔二维坐标和边界控制`。

## 任务 3　实现角色组件和生命周期

- [ ] 写失败测试，覆盖一帧内多次移动只安排一次绘制、静止无持续 rAF、pointerleave/blur/hidden 复位、touch 忽略及 reduced-motion 切换。
- [ ] 覆盖源图切换时旧加载回调失效、尺寸变化后重新换算、未匹配图片静态展示、读取 Canvas 失败静态展示。
- [ ] 覆盖卸载后移除监听器、取消 rAF、断开 observer。图片有可访问名称，Canvas 不重复进入可访问树。
- [ ] 运行组件测试，观察预期失败。
- [ ] 实现 `PixelGazePortrait`，输入为 `src`、`alt`、`interactionRef` 和 `disabled`。交互范围使用 Hero，不使用 document 全局 pointermove。
- [ ] 资源仅加载一次并缓存解码结果；首屏外停用渲染，图片准备完成前显示静态图。将 CSS 显示尺寸与源图坐标分开，避免 DPR 改变位移幅度。
- [ ] 验证测试通过，提交 `接入像素角色指针随动与静态降级`。

## 任务 4　接通所有产品入口和 HTML 导出

- [ ] 在 `PixelHero.test.tsx` 增加默认角色和个性化头像共用组件的失败测试。头像请求失败时回到默认角色，并重新匹配默认眼部配置。
- [ ] 在导出测试中覆盖内嵌默认 SVG、眼部资源和随动运行时，无需网络请求也能工作。分享和导出继续展示默认角色，其眼睛同样能随动。
- [ ] 单独覆盖 `staticDecorations=true`。该值用于现有装饰动画降级，不能据此误关掉此次要求的指针随动；touch 与 reduced-motion 独立决定是否启用。
- [ ] 接入 `PixelHero`，保持现有角色尺寸、原图 fallback 和上传后的个性化预览隔离。用构建可内嵌的资源模块，避免新增公共运行时图片请求。
- [ ] 运行 PixelHero、App、export、generationApi 相关测试，确认上传、换照片、保存和导出的原有行为。
- [ ] 更新 Web 说明，提交 `统一像素角色随动入口并支持离线导出`。

## 任务 5　浏览器验收与全量回归

- [ ] 桌面检查 1440/1600 宽屏，手机检查 390 宽度；同时检查预览画布缩放 75%、100%、140%。
- [ ] 用实际鼠标位置验证上、下、左、右和四个对角线，两眼朝向一致且始终受限。快速跨越屏幕无重影和瞳孔越界。
- [ ] 验证戴眼镜、粉发、蓝色碎刘海、单马尾和双马尾。比较静止截图，除眼睛目标位置外角色其他部分没有变化。
- [ ] 鼠标离开、切换标签、滚动出首屏及切换作品后复位。触屏不截获页面滚动，减少动态效果立即显示中性图。
- [ ] 在导出 HTML 中断网检查同样的交互；资源失败时文字和静态头像正常显示。
- [ ] 检查静止时无持续 rAF，画布更新不触发整页渲染；记录新增包体和解码内存，不在移动设备重复建立全尺寸离屏画布。
- [ ] 执行 `npm test`、`npm run build`、`npm run test:skills`、`git diff --check`。眼部资源脚本使用 Python时，加运行相关图层测试；若改动生成、私有协议或存储，则额外执行 `npm run test:agent` 与 `npm run test:payment`。
- [ ] 使用当前 Node 环境时，若命中已知实验性 Web Storage 行为，沿用已验证的 `NODE_OPTIONS=--no-experimental-webstorage npm test`，记录实际命令。
- [ ] 代码复核及浏览器验收通过后提交 `验收像素角色二维瞳孔随动`，是否合并按用户当时指令处理。

## 完成条件

默认角色与已匹配的个性化 IP 都能二维跟随并复位；眼镜、刘海及肤色无破坏；旧图和资源失败可静态降级；宽窄屏与缩放下坐标一致；离线导出可用；测试与生产构建通过。

本计划只交付眼睛随动。oil-motion 已用于适用范围评估，此次不新增生成服务、视频资源或产品内 Skill 注册。


## 实施结果

已接入 `PixelHero`，默认 SVG 与同底稿个性化 PNG 共用二维随动。实际使用 396 × 80 的眼部覆盖层，保留原图显示，避免每次移动重绘 1254 × 1254 的角色。固定资源经 RLE 编码，源码约 170 KiB，gzip 约 17.2 KiB，解码数据约 0.78 MiB。旧图不匹配时静态降级。

中性重建、方向限位、真实 media 变化、窗口失焦、滚动/缩放复位、离屏暂停、换图、绘制失败、资源不可读、observer 清理及离线脚本运行均已覆盖。391 项 Web 测试、9 项 Skills 测试、52 项相关图层检查和生产构建通过。Agent 全量测试使用临时专用 PostgreSQL 容器，最初未设置 TEST_DATABASE_URL 的环境失败已通过隔离测试库重跑解决。

浏览器使用真实单文件 HTML 验收，默认 SVG 和戴眼镜 PNG 均匹配；实际指针左右及对角线移动有响应。1440/1600/390 视口无横向溢出，75% 与 140% 缩放的眼部覆盖比例一致。导出页面 CSP 禁止网络连接，眼部素材与运行时内嵌后仍能工作。新资源脚本提供 --check，180 组现有发型组合的眼区兼容性通过逐像素检查。
