# 肖像 Demo：本机生图路线

## 选型

本机是 Apple M1 Pro、32 GB 统一内存。当前选择 **MFLUX 0.23.0 + FLUX.2 Klein 4B（distilled，MLX 社区预量化 8 位权重）**，通过 Apple MLX/Metal 在本机运行图像编辑。MFLUX 的 `mflux-generate-flux2-edit` 接受多张参考图、四步推理和低内存模式；原模型与预量化权重均标为 Apache 2.0。首次下载的预量化权重约 8.6 GB，安装依赖约 1.2 GB；实际推理速度和质量需要在目标机器验收。

Wibi Style 提供三种固定版本的视觉规则与风格参考图，**本身不包含生成模型**。LangGraph `generateAvatar` 节点把用户肖像放在第一张输入，把 Wibi 参考图放在其后；规则写入本地 prompt 文件。模型原生文本长度有限，因此每款风格先放一段从已校验 Wibi 规则提炼的重点，再附完整原规则。MFLUX 在本机生成 PNG，worker 把结果交回现有私有资产服务。图片不发送给云端生图 API，也不需要 `OPENAI_API_KEY`。首次运行会联网下载公开模型权重；源肖像不会参与模型下载。

| 方案 | 判断 |
| --- | --- |
| MFLUX + FLUX.2 Klein 4B | 当前选择。适配 Apple Silicon，支持多参考图编辑，模型较小，许可清晰。 |
| ComfyUI + 同模型 | 可扩展复杂节点，但当前三风格静态图的工作流和部署成本更高；暂不引入第二套图编排。 |
| Ollama 视觉模型 | 可理解输入图片；现有视觉 API 不直接输出图像编辑结果。 |
| FLUX 3 Image Klein | 支持更多参考图，但刚发布、模型更大；当前 demo 先用 FLUX.2 验证架构。 |

技术依据：[MFLUX 安装与模型列表](https://github.com/mflux-community/mflux/blob/main/README.md)、[MFLUX FLUX.2 编辑说明](https://github.com/mflux-community/mflux/blob/main/src/mflux/models/flux2/README.md)、[FLUX.2 Klein 4B 模型卡](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)、[MLX 社区 8 位权重](https://huggingface.co/mlx-community/flux2-klein-4b-8bit)、[Ollama 视觉能力](https://docs.ollama.com/capabilities/vision)。

## 本机使用

1. 确认是 Apple Silicon Mac，已装 Node.js 24+、`uv`、Git。运行 `npm run setup:avatar:local`。脚本验证 Wibi 固定版本，并将 MFLUX 0.23.0 和 Pillow 12.3.0 装进忽略目录 `data/avatar-venv`。Pillow 13.0.0 在本次本机验证中因导入错误无法启动 CLI，故暂时固定 12.3.0。
2. 在本机 `.env` 设 `PAYMENT_ENV=sandbox`，运行 `npm run dev`；开发脚本会给 API 和 worker 设置 `AVATAR_DEMO_ENABLED=1`。单独调试 worker 可运行 `AVATAR_DEMO_ENABLED=1 npm run dev:worker`。无需图像服务密钥。
3. 首次实际提交肖像时，模型会下载到 `data/avatar-model-cache`。当前机器上的 Xet 下载曾停滞，因此 worker 默认使用 Hugging Face 支持的非 Xet 路径；可通过 `HF_HUB_DISABLE_XET=0` 改回。源图和 prompt 仅写入权限为 `0700` 的系统临时目录，推理结束后删除；成图继续沿用会话绑定和过期清理。

当前 worker 只接受项目私有 CLI，环境变量 `AVATAR_MFLUX_COMMAND` 和 `AVATAR_MODEL_CACHE_ROOT` 可覆盖其路径。输出固定为 1024×1024 PNG、4 步、预量化 8 位权重、M1 的 float16 计算和低内存模式。重试时种子由照片与风格 ID 导出，便于复现。Wibi 风格参考不会变成生成内容白名单：人物身份、姿态、衣服仍以用户照片为准。

## 验收与限制

自动测试验证 LangGraph 节点接口、Wibi 哈希、参考图顺序、命令参数、临时文件清理和 API 资产约束。2026-10-31 在本机 Metal 环境用合成肖像完成真实推理：MFLUX CLI 输出 512×512 PNG，4 步推理约 66 秒、峰值 MLX 内存 6.03 GB；项目 provider 加载已校验的 Wibi 蜡笔规则并输出 1024×1024 PNG。人工查看后，后者保留了合成输入的黑发和蓝色衣服，并呈现白纸蜡笔风格。又用隔离的本机 API、LangGraph worker 和同一模型完成 `POST /api/portraits` → `POST /api/generations` → `SUCCEEDED` → `GET /api/hero-assets/:id`，取回有效 PNG；验收服务及测试数据库已关闭并清理。还需用用户授权的真人照片检查三种风格的身份保留、构图和首屏效果；合成肖像与自动测试都不能证明真人相似度。

Wibi 风格规则和参考图的许可仅覆盖个人非商业用途；当前图片不进入付费分享或 ZIP。透明抠图与指针跟随均属后续工作。

将来接入 [oil-motion](https://github.com/oil-oil/oil-motion) 时，当前静态 PNG 可作为首帧和加载失败时的回退图。真正的鼠标水平、垂直跟随需要同一角色的一组方向关键帧与连续性检查，再由 Oil Motion 编译成可随机访问的二维图集；单张图片不能提供转头或视线变化。若继续坚持本地生成，关键帧/视频也需要另选本机模型或预制素材，因为 Oil Motion 当前默认的 AI 生成功能使用 ZenMux。当前 demo 不生成任何动态素材，也不接入指针运行时。
