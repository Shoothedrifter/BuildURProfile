# 简历条目锚点与 Agent 排版（resume-parse-v2）

## 问题与目标

旧 `resume-parse-v1` 把 PDF 版面行逐行交给模型分类和拆条，结果允许一段项目描述变成多条，装饰性项目符号也可能成为“其他内容”。旧浏览器规则解析能较稳定地确定十模块及条目范围，但正文常是未经整理的大段原文。当前流程保留规则解析的条目边界，由 Agent 在每条内部提炼标题和排版正文。

## 数据流与合同

1. Web 私有保存 PDF 后，通过与兼容浏览器入口相同的 `normalizePdfTextItems`、`parseResumePages` 预解析原件。Web 对浏览器候选只取模块、页码和原文，生成 `resume-parse-plan-v1`。它是 Agent 内部输入，不是公开用户提交的字段，也不进入生成 brief。
2. Python 图使用 `pdfplumber` 提取 `resume-source-v1` 版面块；持有有效租约的 Agent 调用 `GET /_internal/agent/resume-tasks/:id/plan` 领取预解析计划。该接口同时要求服务令牌和租约。
3. `align_anchors` 将来源块匹配到计划条目。不能可靠匹配的块附到同页最近条目并标记待核对；没有匹配条目的页面归入 `other` 并标记待核对。每个来源块恰好归属一个条目，不由模型新增边界；计划条目若完全没有来源块则明确失败，不静默丢掉。
4. `resume.format.v1` 向当前配置的文本模型发送固定锚点，要求每个 `anchorId` 恰好返回一条标题和精简正文。模型不能拆分、合并条目或更改已知模块；仅 `other` 整条在高置信度时可改类。超长或无换行的大段正文会进行一次定向压缩重试；越界、缺失、重复 ID 或出现来源没有的数字会拒绝草稿，拒绝信息携带被拒数字、锚点 ID 与锚点原文便于线上定位，未知英文词标记待核对。数字回源按等价类比较，容忍排版性改写：逐字命中、分段去前导零且分隔符 `.,/-` 等价（`2022年9月` ≡ `2022.09` ≡ `2022/9`）、去分隔符后数字位完全一致（PDF 分离文本块去空白粘连成 `202209`）、数字位按原顺序落在原文数字流的子串里（`CET-6：575` 写作 `CET-6 575` 后粘连成 `6575`）；重排或编造的数字（如 `2022.90`、凭空放大数量级）仍然拒绝。
5. 图验证十模块、来源覆盖及隐私默认值后持久化 `resume-draft-v1`。原 PDF、提取文本、计划和模型提示只在 Web 私有文件或单次图执行内流转，不进入 checkpoint 或日志。用户在编辑页对照原 PDF 修改并确认后，才投影到作品集生成 brief。

`resume-parse-plan-v1` 的 JSON Schema 见 [`packages/contracts/schema/resume-parse-plan.v1.json`](../../packages/contracts/schema/resume-parse-plan.v1.json)。解析任务工作流版本是 `resume-parse-v2`，节点为 `validate_source → extract_layout → classify_sections → map_design_modules → format_items → verify_evidence → complete_draft`。`classify_sections` 在此版本执行确定性锚点对齐，`format_items` 才调用模型。排队中的 v1 任务在领取时升为 v2；已完成草稿不自动改写。

## 现有草稿与验收

编辑页“重新解析为新草稿”会从当前会话拥有的原 PDF 建立新私有文件和新任务，原草稿保持可用；新副本从重解析时起保留 30 天。重新上传同一 PDF 也能进入 v2。新草稿仍需用户核对，规则边界、跨解析器来源匹配和模型摘要均可能有歧义，`needsReview` 与原 PDF 预览用于人工校正。

合成回归覆盖工作职责项目符号不拆条、教育记录分界、技能与奖项识别、装饰性符号过滤、模型拆条拒绝、数字来源校验、私有接口令牌与租约、旧草稿保留。必要检查：`npm test`、`npm run build`、`npm run test:payment`、`npm run test:skills`、`npm run test:agent`。真实供应商联调只记录模块计数、条目数和长度等结构指标，不记录简历文字或密钥。
