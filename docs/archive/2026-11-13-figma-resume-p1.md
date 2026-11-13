# 简历编辑与重解析 P1 实施记录（2026-11-13）

本记录归档已实施的产品取舍和验证结果。当前接口、合同与部署要求以[文档导航](../README.md)为准；详细 Spec/Plan 可在 Git 历史中查看（起点 `eb05905`，实现提交 `c990927`、`7cf9196`、`92e30d2`、`5768715`、`39e4f48`、`dc24ceb`）。

## 范围与决定

- 私有草稿升级为 `resume-draft-v2`，十模块及条目均有稳定 ID 与顺序；编辑页可排序、手动拆合经历，确认后用 `resume-v3` 同顺序生成作品、分享快照与 ZIP。真正第十一个自定义模块留待单独设计，“其他内容”可建自命名条目。
- 服务端保留当前版本和最近 10 个历史版本，图片按历史引用回收；自动保存串行提交并检测 revision 冲突，断网时按当前会话在本机缓存无来源文字的差异，恢复网络后重试。
- 同一未过期原 PDF 可创建独立重解析候选；覆盖与补空均须核对后应用。补空保护人工修改和删除记录，新增内容待核对，基准版本变化时拒绝应用。
- 扫描件可进入 30 天私有存储。普通解析无文字时仍报 `PDF_NO_TEXT`，用户明确选择后才运行 `resume-parse-v3`：PDFium 渲染无文字页、本机 Tesseract 中英文识别、Web 旧解析器确定模块和条目、`resume.format.v2` 逐条排版。混合 PDF 的 OCR 走独立候选。`resume-source-v2` 记录 OCR 来源、坐标和置信度，低置信度条目待核对；页面图像不交给新的第三方，也不进 checkpoint 或日志。

## 审查与验证

独立审查发现五项重要边界问题，已修复：并发普通解析与 OCR 的工作流复用、覆盖候选的重复条目 ID、断网后自动保存缺少重试、拆分条目的本机恢复丢失来源关联、同一页不同位置的重复 OCR 文字被误删。另修复了 OCR 补空对隐藏空模块不添加新条目的问题。

- `npm test`：218 个 Web 测试通过；`npm run build`：TypeScript 和 Next.js 生产构建通过。
- `npm run test:payment`：98 个服务端测试通过；`npm run test:agent`：67 个 Python 和 23 个 Node 测试通过；`npm run test:skills`：7 个测试通过；`git diff --check` 通过。
- 真实本机 Tesseract（含 `eng`、`chi_sim`）对合成扫描 PDF 识别出 3 个带来源的文本块；Web 上传校验标记该页无文字。Node HTTP ↔ Python OCR 图的合成集成测试通过。

## 未完成的部署现场验收

Agent Dockerfile 已安装 Tesseract 及中英文语言包，Compose 仍保留独立 checkpoint 与应用数据卷。本机 `/Applications/Docker.app` 缺可执行文件且 Docker daemon 未运行，因此无法在这台机器上构建两端镜像或验证 Compose 健康检查、卷和重启；部署环境需要补做。真实文本模型、付款和公网回调仍按独立上线验收执行。
