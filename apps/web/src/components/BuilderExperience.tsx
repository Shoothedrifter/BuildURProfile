"use client";

import { useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { DesignConfig, JobRole } from "../../../../packages/contracts/src/config";
import rawConfig from "../demo/config.json";
import { QUESTIONS } from "../lib/assessment";
import type { DraftField, ResumeDraft } from "../lib/resume";
import type { AvatarStyleId } from "../lib/generationApi";
import type { Offer, OwnedProject } from "../lib/paymentApi";
import { AVATAR_STYLES } from "../../../../packages/skills/src/avatar-catalog";
import { ShowcasePage } from "../ShowcasePage";
import { EditorPanel } from "./EditorPanel";
import {
  BuilderChrome,
  ProjectsDialog,
  ProofButton,
  ProofCard,
  StepHeader,
  WorkflowProgress
} from "./BuilderChrome";
import type { WorkflowPhase } from "./BuilderChrome";

export type DraftGroup = "basicInfo" | "jobIntent" | "selfEvaluation" | "workExperience" | "campusExperience" | "projects" | "awards" | "skills" | "education" | "other";
export type ReclassifyTarget = DraftGroup;
export type DeliveryAction = "share" | "export";
type ConfirmModule = "basic" | DraftGroup;
type StylePresetId = "warm" | "minimal" | "bold";

const confirmationGroups: Array<{ key: DraftGroup; title: string; hint: string }> = [
  { key: "basicInfo", title: "更多基本信息", hint: "电话、所在地等默认不展示，请主动选择" },
  { key: "jobIntent", title: "求职意向", hint: "目标岗位、到岗时间与薪资" },
  { key: "selfEvaluation", title: "自我评价", hint: "保留原文可核查的评价" },
  { key: "education", title: "教育经历", hint: "学校、学位与学习经历" },
  { key: "workExperience", title: "实习/工作经历", hint: "公司、职位、工作时间与职责" },
  { key: "projects", title: "项目经历", hint: "仅保留 PDF 原文可核查的项目" },
  { key: "awards", title: "荣誉奖项", hint: "奖项名称、级别与时间" },
  { key: "campusExperience", title: "校园经历", hint: "校内组织、岗位与成果" },
  { key: "skills", title: "技能与链接", hint: "技术、工具与方法" },
  { key: "other", title: "其他内容", hint: "尚未归入以上模块的经历" }
];

const roles: Array<{ value: JobRole; label: string }> = [
  { value: "ui-ux-designer", label: "UI / UX 设计师" },
  { value: "frontend-creative-developer", label: "前端 / 创意开发者" },
  { value: "brand-motion-copy", label: "品牌 / 动效 / 文案" }
];

const stylePresets: Array<{
  id: StylePresetId;
  label: string;
  description: string;
  tone: string;
  answers: Record<string, number>;
}> = [
  {
    id: "warm",
    label: "温暖创意",
    description: "桃橙 / 描边 / 轻松表达",
    tone: "Aa / 你好",
    answers: {
      "e-presence": 3,
      "e-type": 2,
      "k-pace": 2,
      "k-cards": 2,
      "p-tone": 2,
      "p-strength": 2,
      "s-browse": 2,
      "s-control": 2
    }
  },
  {
    id: "minimal",
    label: "理性简约",
    description: "留白 / 秩序 / 内容优先",
    tone: "Aa / 你好",
    answers: {
      "e-presence": 1,
      "e-type": 0,
      "k-pace": 1,
      "k-cards": 1,
      "p-tone": 1,
      "p-strength": 1,
      "s-browse": 3,
      "s-control": 3
    }
  },
  {
    id: "bold",
    label: "大胆实验",
    description: "对比 / 动态 / 个性探索",
    tone: "Aa / 你好",
    answers: {
      "e-presence": 4,
      "e-type": 4,
      "k-pace": 4,
      "k-cards": 4,
      "p-tone": 3,
      "p-strength": 4,
      "s-browse": 0,
      "s-control": 4
    }
  }
];

function BrandPreview() {
  return <div className="proof-mini-showcase" aria-label="Showcase 演示预览">
    <p>SHOWCASE / 个人作品集</p>
    <div className="proof-mini-window">
      <span>林予安 / UI·UX Designer</span>
      <strong>把复杂的问题，<br />变成自然的体验。</strong>
      <small>产品设计 / 交互原型 / 用户研究</small>
      <div className="proof-mini-projects">
        <div><b>01</b><span>通勤出行体验</span></div>
        <div><b>02</b><span>创作者工作台</span></div>
      </div>
    </div>
    <strong>↗ 页面本身，就是你的下一件作品。</strong>
  </div>;
}

function AvatarPicker({ enabled, photoDataUrl, photoName, avatarStyle, generating, onPhoto, onStyle, onClear }: {
  enabled: boolean;
  photoDataUrl: string | null;
  photoName: string;
  avatarStyle: AvatarStyleId;
  generating: boolean;
  onPhoto: (event: ChangeEvent<HTMLInputElement>) => void;
  onStyle: (style: AvatarStyleId) => void;
  onClear: () => void;
}) {
  return <ProofCard as="section" className="proof-avatar-card" aria-labelledby="avatar-heading">
    <h2 id="avatar-heading">01 / 头像</h2>
    <p>上传照片，使用原照或生成风格头像。</p>
    {enabled ? <>
      <label className="proof-avatar-upload">
        <span className="proof-avatar-placeholder">
          {photoDataUrl ? <img src={photoDataUrl} alt="待生成的肖像照片预览" /> : "◯"}
        </span>
        <strong>{photoDataUrl ? "重新选择照片" : "上传照片"}</strong>
        <small>照片在点击生成前只保留在浏览器内存中</small>
        <input aria-label="选择个人肖像照片" type="file" accept="image/png,image/jpeg,image/webp" onChange={onPhoto} />
      </label>
      {photoName && <p className="proof-file-name">{photoName}</p>}
      <div className="proof-avatar-styles" aria-label="虚拟形象风格">
        {AVATAR_STYLES.map((style) => <button key={style.id} type="button" aria-pressed={avatarStyle === style.id}
          className={avatarStyle === style.id ? "is-selected" : ""} onClick={() => onStyle(style.id)}>
          <strong>{style.label}</strong><small>{style.hint}</small>
        </button>)}
      </div>
      {photoDataUrl && <ProofButton variant="quiet" aria-busy={generating || undefined} onClick={onClear}>移除照片</ProofButton>}
      <p className="proof-microcopy">图片生成会把照片发送给配置的图像供应商；Wibi Style 当前仅供个人非商业预览。</p>
    </> : <>
      <span className="proof-avatar-placeholder" aria-hidden="true">◯</span>
      <p className="proof-muted">当前部署未启用头像生成，可跳过并在生成后继续编辑。</p>
    </>}
  </ProofCard>;
}

export type BuilderExperienceProps = {
  phase: WorkflowPhase;
  fileName: string;
  selectedFile: File | null;
  progress: string;
  error: string;
  draft: ResumeDraft | null;
  role: JobRole;
  answers: Record<string, number>;
  generated: DesignConfig | null;
  projectId: string | null;
  projectPaid: boolean;
  isTouch: boolean;
  share: { id: string; url: string; expiresAt: number } | null;
  savedShares: Array<{ id: string; url: string; expiresAt: number }>;
  projects: readonly OwnedProject[];
  offer: Offer | null;
  quotedAmountYuan: string | null;
  paymentIntent: DeliveryAction | null;
  shareSnapshot: string;
  resultError: string;
  exporting: boolean;
  photoDataUrl: string | null;
  photoName: string;
  avatarStyle: AvatarStyleId;
  generatingAvatar: boolean;
  avatarDemo: boolean;
  onPhaseChange: (phase: WorkflowPhase) => void;
  onSelectFile: (file: File) => void;
  onParseFile: () => void;
  onPhoto: (event: ChangeEvent<HTMLInputElement>) => void;
  onAvatarStyle: (style: AvatarStyleId) => void;
  onClearPhoto: () => void;
  onUpdateSingle: (key: "name" | "email", value: string) => void;
  onUpdateGroup: (key: DraftGroup, index: number, change: Partial<DraftField>) => void;
  onReclassify: (key: DraftGroup, index: number, target: ReclassifyTarget) => void;
  onConfirm: () => void;
  onRoleChange: (role: JobRole) => void;
  onAnswer: (questionId: string, optionIndex: number) => void;
  onApplyAnswers: (answers: Record<string, number>) => void;
  onGenerate: () => void;
  onRunAvatarGeneration: () => void;
  onEditGenerated: (update: (current: DesignConfig) => DesignConfig) => void;
  onRequestDelivery: (action: DeliveryAction) => void;
  onStartPayment: () => void;
  onCheckEntitlement: () => void;
  onResumeProject: (project: OwnedProject) => void;
  onDeleteProject: (project: OwnedProject) => Promise<void>;
  onCopyShare: () => void;
  onRemoveShare: () => void;
  onRemoveSavedShare: (id: string) => void;
  onRestartQuiz: () => void;
};

export function BuilderExperience(props: BuilderExperienceProps) {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [confirmModule, setConfirmModule] = useState<ConfirmModule>("basic");
  const [selectedPreset, setSelectedPreset] = useState<StylePresetId | null>(null);
  const {
    phase, fileName, selectedFile, progress, error, draft, role, answers, generated, isTouch, share, savedShares,
    projects, projectId, projectPaid, offer, quotedAmountYuan, paymentIntent, shareSnapshot, resultError, exporting, photoDataUrl, photoName,
    avatarStyle, generatingAvatar, avatarDemo
  } = props;

  const go = (next: WorkflowPhase) => {
    props.onPhaseChange(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const goLanding = (section?: "about" | "process") => {
    props.onPhaseChange("landing");
    window.setTimeout(() => {
      if (section) document.getElementById(section)?.scrollIntoView({ behavior: "smooth" });
      else window.scrollTo({ top: 0, behavior: "instant" });
    }, 0);
  };
  const answer = (questionId: string, optionIndex: number) => {
    setSelectedPreset(null);
    props.onAnswer(questionId, optionIndex);
  };
  const applyPreset = (preset: (typeof stylePresets)[number]) => {
    setSelectedPreset(preset.id);
    props.onApplyAnswers(preset.answers);
  };
  const isPresetSelected = (presetId: StylePresetId) => selectedPreset === presetId && Object.keys(answers).length === 8;
  const hasVisibleError = Boolean(error);
  const deliveryUnlocked = projectPaid || Boolean(projects.find((project) => project.id === projectId)?.paid);

  if (phase === "mock") {
    return <div className="proof-demo-page">
      <div className="proof-demo-toolbar">
        <ProofButton onClick={() => go("landing")}>← 返回生成器</ProofButton>
        <span>作品集样例 / LIVE PREVIEW</span>
      </div>
      <ShowcasePage config={rawConfig as DesignConfig} allowSkinSwitch />
    </div>;
  }

  const progressNumber = phase === "upload" ? 1 : phase === "confirm" ? 2 : phase === "quiz" ? 3 : phase === "result" ? 4 : phase === "delivery" ? 5 : 0;

  return <BuilderChrome projectCount={projects.length}
    onHome={() => goLanding()}
    onProjects={() => setProjectsOpen(true)}
    onSample={() => go("mock")}
    onSection={(section) => goLanding(section)}>
    {phase !== "landing" && <><WorkflowProgress phase={phase} />{progressNumber > 0 && <div className="proof-step-shell" data-step={progressNumber} />}</>}

    {phase === "landing" && <div className="proof-landing">
      <div className="proof-landing-title">
        <p>BUILD YOUR PROOF / 01</p>
        <h1>你的能力，值得一个可以体验的网页。</h1>
        <span>上传简历，找到你的风格。让求职、Networking 和个人展示，从一份可以交互的作品开始。</span>
      </div>
      <section className="proof-landing-hero" aria-label="BuildURProfile 介绍">
        <BrandPreview />
        <div className="proof-value">
          <h2>别只说你会。<br />让对方亲自体验。</h2>
          <p>设计师用页面展示审美与叙事，开发者用交互展示技术与创意。把静态经历，变成可探索的能力证明。</p>
          <ProofButton variant="primary" onClick={() => go("upload")}>免费开始制作 →</ProofButton>
          <ProofButton onClick={() => go("mock")}>浏览作品集样例</ProofButton>
          <small>免费生成、预览和编辑<br />满意后，按项目解锁发布与导出。</small>
        </div>
      </section>
      <section className="proof-landing-section" id="process" aria-labelledby="process-title">
        <h2 id="process-title">从一份 PDF，到属于你的 Showcase</h2>
        <div className="proof-three-grid">
          <ProofCard><strong>01 / 上传与核对</strong><p>提取简历模块，补充项目过程、成果链接与图片。</p></ProofCard>
          <ProofCard><strong>02 / 找到你的表达</strong><p>选择模板或完成偏好测评，让风格与专业相契合。</p></ProofCard>
          <ProofCard><strong>03 / 让作品被看见</strong><p>免费预览编辑，确认满意后解锁分享和导出。</p></ProofCard>
        </div>
      </section>
      <section className="proof-landing-section" id="about" aria-labelledby="roles-title">
        <h2 id="roles-title">为不同的能力，找到不同的表达</h2>
        <div className="proof-three-grid">
          <ProofCard><strong>UI / UX 设计师</strong><p>从洞察到交互，让作品集体现你的设计判断。</p></ProofCard>
          <ProofCard><strong>前端 / 创意开发者</strong><p>让界面、动效与体验，成为可以操作的技术 Demo。</p></ProofCard>
          <ProofCard><strong>跨领域探索者</strong><p>以项目与成果串联经历，让对方快速理解你的价值。</p></ProofCard>
        </div>
      </section>
      <section className="proof-landing-section" aria-labelledby="faq-title">
        <h2 id="faq-title">开始之前，你可能想知道</h2>
        <ProofCard className="proof-faq"><strong>什么时候需要付费？</strong><p>生成、预览与编辑免费。点击分享链接或导出时，为当前项目支付一次费用，解锁该项目的发布与导出资格。</p></ProofCard>
      </section>
    </div>}

    {phase === "upload" && <section className="proof-step-page">
      <StepHeader number={2} title="从你的简历开始" description="上传一份 PDF，我们帮你整理经历；你始终决定最终展示什么。" />
      <div className="proof-upload-layout">
        <label className={`proof-upload-card ${selectedFile ? "has-file" : ""}`} onDragOver={(event: DragEvent<HTMLLabelElement>) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) props.onSelectFile(file);
          }}>
          <input aria-label="选择 PDF 简历" type="file" accept=".pdf,application/pdf" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) props.onSelectFile(file);
            event.currentTarget.value = "";
          }} />
          <span className="proof-upload-arrow" aria-hidden="true">↑</span>
          <strong>{selectedFile ? "文件已选择" : "将简历 PDF 拖到这里"}</strong>
          <span>{selectedFile ? fileName : "或选择本地文件，开始建立你的个人资料。"}</span>
          <span className="proof-button proof-button--primary">{selectedFile ? "重新选择 PDF" : "选择 PDF 文件"}</span>
          <small>支持包含可选中文字的 PDF。扫描件可先转为文本 PDF。</small>
        </label>
        <ProofCard className="proof-upload-guide">
          <h2>一份好 Showcase，从真实经历开始</h2>
          <p>建议包含基本信息、教育经历、工作经历和项目成果。</p>
          <ol>
            <li>先读取，再由你确认</li>
            <li>可删除不希望公开的信息</li>
            <li>后续可补充链接与图片</li>
          </ol>
        </ProofCard>
      </div>
      {selectedFile && <ProofCard className="proof-file-ready">
        <div><strong>已选择：{fileName}</strong><p>文件已就绪 · 可替换文件后再继续</p></div>
        <ProofButton variant="primary" disabled={Boolean(progress)} onClick={props.onParseFile}>{progress || "解析简历 →"}</ProofButton>
      </ProofCard>}
      {hasVisibleError && <ProofCard className="proof-error-card" role="alert"><strong>无法读取这份文件</strong><p>{error}</p></ProofCard>}
      <section className="proof-edge-section" aria-labelledby="upload-help-title">
        <h2 id="upload-help-title">异常状态说明</h2>
        <div className="proof-two-grid">
          <ProofCard><strong>未读取到文字</strong><p>可能是扫描版 PDF。请更换文件，或先转成可选中文字的 PDF。</p></ProofCard>
          <ProofCard><strong>上传失败</strong><p>文件未成功读取。请重新选择 PDF 后重试，已有资料会保留。</p></ProofCard>
        </div>
      </section>
      <div className="proof-actions"><ProofButton onClick={() => go("landing")}>← 返回首页</ProofButton></div>
    </section>}

    {phase === "confirm" && draft && <section className="proof-step-page">
      <StepHeader number={3} title="让每一段经历，都有证据可循" description={`已从 ${fileName} 提取。请逐项核对，再补充能体现思考与结果的内容。`} />
      <div className="proof-confirm-layout">
        <ProofCard className="proof-module-nav">
          <h2>资料模块</h2>
          <p>完成核对后，继续选择你的风格。</p>
          <nav aria-label="资料模块">
            <button type="button" className={confirmModule === "basic" ? "is-active" : ""} onClick={() => setConfirmModule("basic")}>
              <span>{draft.name.value.trim() ? "✓" : "○"}</span> 基本信息
            </button>
            {confirmationGroups.map((group) => <button type="button" key={group.key}
              className={confirmModule === group.key ? "is-active" : ""} onClick={() => setConfirmModule(group.key)}>
              <span>{group.key === "projects" && confirmModule === group.key ? "●" : draft[group.key].length ? "✓" : "○"}</span>
              {group.title}
              <small>{draft[group.key].length}</small>
            </button>)}
          </nav>
        </ProofCard>
        <ProofCard as="section" className="proof-confirm-editor" aria-label="当前资料模块">
          {confirmModule === "basic" ? <div className="proof-form-stack">
            <header><h2>基本信息</h2><p>姓名与邮箱用于作品页；其他个人信息需单独选择展示。</p></header>
            <label className="proof-field"><span>姓名</span><input aria-label="姓名" value={draft.name.value} onChange={(event) => props.onUpdateSingle("name", event.target.value)} /></label>
            <label className="proof-field"><span>邮箱</span><input aria-label="邮箱" value={draft.email.value} onChange={(event) => props.onUpdateSingle("email", event.target.value)} /></label>
            <details className="proof-source"><summary>查看 PDF 原文 →</summary><pre>姓名 · 第 {draft.name.page} 页：{draft.name.source}</pre></details>
          </div> : (() => {
            const group = confirmationGroups.find((entry) => entry.key === confirmModule)!;
            return <div className="proof-form-stack">
              <header><h2>{group.title}</h2><p>{group.hint}</p></header>
              {draft[group.key].length === 0 ? <ProofCard className="proof-empty-module"><strong>这段简历没有识别到内容</strong><p>返回上传页更换文件，或继续核对其他模块。</p></ProofCard> :
                draft[group.key].map((entry, index) => <article className="proof-confirm-entry" key={`${group.key}-${index}`}>
                  <div className="proof-entry-top">
                    <label><input type="checkbox" checked={entry.included} onChange={(event) => props.onUpdateGroup(group.key, index, { included: event.target.checked })} />用于展示</label>
                    <span>PDF · 第 {entry.page} 页</span>
                  </div>
                  <label className="proof-field"><span>条目分类 {index + 1}</span><select aria-label={`条目分类 ${index + 1}`}
                    value={group.key}
                    onChange={(event) => props.onReclassify(group.key, index, event.target.value as ReclassifyTarget)}>
                    {confirmationGroups.map((option) => <option key={option.key} value={option.key}>{option.title}</option>)}
                  </select></label>
                  <label className="proof-field">
                    <span>{group.title} {index + 1}</span>
                    <textarea aria-label={`${group.title} ${index + 1}`}
                      rows={Math.min(9, Math.max(4, entry.value.split("\n").length + 1))} value={entry.value} disabled={!entry.included}
                      onChange={(event) => props.onUpdateGroup(group.key, index, { value: event.target.value })} />
                  </label>
                  <details className="proof-source"><summary>查看 PDF 原文 →</summary><pre>{entry.source}</pre></details>
                </article>)}
            </div>;
          })()}
        </ProofCard>
        <ProofCard className="proof-confirm-help">
          <h2>让 HR 看到你的判断</h2>
          <p>经历说明你做过什么；过程与证据说明你为什么能做好。</p>
          <strong>可以补充</strong>
          <ul><li>你解决了什么问题</li><li>你做了哪些关键决策</li><li>结果如何得到验证</li></ul>
          <p className="proof-microcopy">为避免编造内容，当前只允许修改 PDF 中已经存在且可核查的材料。</p>
        </ProofCard>
      </div>
      {error && <p className="proof-inline-error" role="alert">{error}</p>}
      <div className="proof-actions">
        <ProofButton onClick={() => go("upload")}>← 返回上传</ProofButton>
        <ProofButton variant="primary" onClick={props.onConfirm}>确认资料，选择风格 →</ProofButton>
      </div>
    </section>}

    {phase === "quiz" && <section className="proof-step-page">
      <StepHeader number={4} title="让你的风格，先开口介绍你" description="从头像到页面表达，选择一个与你的专业和个性都契合的方向。" />
      <div className="proof-style-layout">
        <AvatarPicker enabled={avatarDemo} photoDataUrl={photoDataUrl} photoName={photoName} avatarStyle={avatarStyle}
          generating={generatingAvatar} onPhoto={props.onPhoto} onStyle={props.onAvatarStyle} onClear={props.onClearPhoto} />
        <ProofCard className="proof-style-card">
          <h2>02 / 网站风格</h2>
          <p>直接选择模板，或逐项完成 8 道偏好问题。模板会填入全部答案，之后仍可修改。</p>
          <div className="proof-style-options">
            {stylePresets.map((preset) => <button type="button" key={preset.id} className={isPresetSelected(preset.id) ? "is-selected" : ""}
              aria-pressed={isPresetSelected(preset.id)} onClick={() => applyPreset(preset)}>
              <strong>{preset.tone}</strong><b>{preset.label}{isPresetSelected(preset.id) ? " ✓" : ""}</b><span>{preset.description}</span>
            </button>)}
          </div>
          <label className="proof-role-select"><span>展示方向</span><select id="job-role" value={role} onChange={(event) => props.onRoleChange(event.target.value as JobRole)}>
            {roles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          <div className="proof-question-heading"><div><h2>你的偏好画像</h2><p>回答会转换为 E / K / P / S 四维分数。</p></div><strong>{Object.keys(answers).length} / 8</strong></div>
          <div className="proof-question-list">
            {QUESTIONS.map((question, index) => <fieldset className="proof-question" key={question.id}>
              <legend><span>{String(index + 1).padStart(2, "0")}</span>{question.prompt}</legend>
              <div>
                {question.options.map((option, optionIndex) => <label key={optionIndex} className={answers[question.id] === optionIndex ? "is-selected" : ""}>
                  <input type="radio" name={question.id} checked={answers[question.id] === optionIndex}
                    onChange={() => answer(question.id, optionIndex)} />
                  <span>{option.label}</span><b aria-hidden="true">→</b>
                </label>)}
              </div>
            </fieldset>)}
          </div>
          {isTouch && <p className="proof-note">检测到触屏：卡片可手动切换，跑马灯恒定滚动。</p>}
          {progress && <p className="proof-status" role="status">{progress}</p>}
          {error && <p className="proof-inline-error" role="alert">{error}</p>}
        </ProofCard>
      </div>
      <div className="proof-actions">
        <ProofButton onClick={() => go("confirm")}>← 返回资料</ProofButton>
        <ProofButton variant="primary" disabled={Object.keys(answers).length !== 8 || generatingAvatar} onClick={props.onGenerate}>
          {generatingAvatar ? "正在生成作品…" : "生成我的 Showcase →"}
        </ProofButton>
      </div>
    </section>}

    {(phase === "result" || phase === "delivery") && !generated && <section className="proof-step-page" aria-labelledby="missing-result-title">
      <StepHeader number={phase === "result" ? 5 : 6} title="作品配置暂时不可用" description="你的操作没有被当作成功生成。请返回风格设置重新生成，已有简历确认内容会保留。" />
      <ProofCard className="proof-error-card">
        <strong id="missing-result-title">没有可预览的作品配置</strong>
        <p>{error || resultError || "生成结果不完整，请重新生成后再继续。"}</p>
        <div className="proof-actions">
          <ProofButton onClick={() => go("confirm")}>← 返回资料确认</ProofButton>
          <ProofButton variant="primary" onClick={() => go("quiz")}>重新生成作品 →</ProofButton>
        </div>
      </ProofCard>
    </section>}

    {phase === "result" && generated && <section className="proof-step-page">
      <StepHeader number={5} title="你的经历，正在成为一件作品" description="预览真实的表达效果，调整内容和风格。满意之后，再决定发布。" />
      {generated.heroArtwork && <p className="proof-note">Wibi Style 头像仅供本机预览，暂不支持付费分享或 ZIP 导出。</p>}
      {!generated.heroArtwork && <div className="proof-result-next">
        <div><p>STEP 5 / DELIVERY</p><strong>作品已生成。下一步选择分享或导出。</strong></div>
        <ProofButton variant="primary" disabled={exporting} onClick={() => props.onRequestDelivery("share")}>下一步：前往分享与付费 →</ProofButton>
      </div>}
      {avatarDemo && <details className="proof-regenerate">
        <summary>更换头像或风格 →</summary>
        <AvatarPicker enabled photoDataUrl={photoDataUrl} photoName={photoName} avatarStyle={avatarStyle} generating={generatingAvatar}
          onPhoto={props.onPhoto} onStyle={props.onAvatarStyle} onClear={props.onClearPhoto} />
        <ProofButton variant="primary" disabled={!photoDataUrl || generatingAvatar} onClick={props.onRunAvatarGeneration}>
          {generatingAvatar ? "正在生成头像…" : "应用当前头像风格 →"}
        </ProofButton>
        {progress && <p className="proof-status" role="status">{progress}</p>}
      </details>}
      <div className="proof-result-layout">
        <div className="proof-editor-column" id="proof-editor"><EditorPanel config={generated} onChange={props.onEditGenerated} isTouch={isTouch} /></div>
        <div className="proof-preview-column">
          <div className="proof-preview-toolbar"><span>LIVE PREVIEW</span><ProofButton variant="quiet" onClick={props.onRestartQuiz}>重新作答</ProofButton></div>
          <div className="proof-preview-frame"><ShowcasePage config={generated} touchDowngraded={isTouch} /></div>
          <details className="proof-advanced">
            <summary>高级参数 / 调试信息 →</summary>
            <div className="proof-result-stats"><span>SKIN <strong>{generated.skin}</strong></span><span>SPEED <strong>{generated.marquee.speed} px/s</strong></span><span>PROJECTS <strong>{generated.content.projects.length}</strong></span></div>
            <pre data-testid="design-config-json">{JSON.stringify(generated, null, 2)}</pre>
          </details>
        </div>
      </div>
      {isTouch && <p className="proof-note">检测到触屏：卡片可手动切换，跑马灯恒定滚动。</p>}
      {error && <p className="proof-inline-error" role="alert">{error}</p>}
      {resultError && <p className="proof-inline-error" role="alert">{resultError}</p>}
      {!generated.heroArtwork && <ProofCard className="proof-publish-card">
        <div><p>FREE PREVIEW / NOT PUBLISHED</p><h2>分享或带走你的作品集</h2><span>正式分享与静态 ZIP 使用同一项目的一次付款解锁。</span></div>
        <div className="proof-publish-actions">
          <ProofButton disabled={exporting} onClick={() => props.onRequestDelivery("share")}>{share ? "更新分享链接 →" : "发布并分享 →"}</ProofButton>
          <ProofButton variant="primary" disabled={exporting} onClick={() => props.onRequestDelivery("export")}>{exporting ? "正在准备…" : "分享链接 / 导出 →"}</ProofButton>
        </div>
      </ProofCard>}
    </section>}

    {phase === "delivery" && generated && <section className="proof-step-page">
      <StepHeader number={6} title="让对的人，看见你的作品" description="确认作品后，按项目解锁发布与导出。一次解锁，用于当前项目。" />
      <div className="proof-delivery-layout">
        <ProofCard className="proof-delivery-summary">
          <h2>{generated.content.profile.name || "你的"} Showcase</h2>
          <p>{generated.skin} · 桌面预览已就绪</p>
          <strong>你的作品，已准备好出发。</strong>
          <ul><li>✓ 免费生成、预览与编辑</li><li>✓ 发布网页并获取分享链接</li><li>✓ 导出下载作品文件</li></ul>
          <ProofButton onClick={() => go("result")}>返回预览，继续编辑</ProofButton>
          {deliveryUnlocked && <div className="proof-unlock-actions">
            <ProofButton disabled={exporting} onClick={() => props.onRequestDelivery("share")}>重新发布分享链接</ProofButton>
            <ProofButton variant="primary" disabled={exporting} onClick={() => props.onRequestDelivery("export")}>导出静态网站 ZIP</ProofButton>
          </div>}
        </ProofCard>
        <ProofCard className="proof-unlock-card">
          <h2>解锁当前项目</h2>
          <p>单项目一次付费 · {offer?.shareDays ?? 7} 天分享链接</p>
          <strong className="proof-price">{quotedAmountYuan || offer?.priceYuan ? `¥${quotedAmountYuan ?? offer?.priceYuan}` : "服务端尚未配置价格"}</strong>
          <p>{offer?.service || "正式托管分享与静态作品集导出，一次解锁当前项目两项能力。"}</p>
          <p>付款前将明确展示实际金额。此权益仅适用于当前项目，不代表解锁全部项目。</p>
          {offer?.mode === "sandbox" && <p className="proof-note">沙箱测试：普通支付宝无法支付沙箱订单，请使用对应沙箱买家账号。</p>}
          {offer?.configurationError && <p className="proof-inline-error" role="alert">支付配置：{offer.configurationError}</p>}
          <div className="proof-unlock-actions">
            <ProofButton variant="primary" disabled={!offer?.configured || exporting || !paymentIntent} onClick={props.onStartPayment}>
              {offer?.mode === "production" ? "支付宝支付并解锁 →" : "前往支付宝沙箱收银台 →"}
            </ProofButton>
            <ProofButton disabled={exporting || !paymentIntent} onClick={props.onCheckEntitlement}>{exporting ? "正在检查…" : "检查已有权益"}</ProofButton>
          </div>
          <span className="proof-microcopy">支付渠道：支付宝 · 只有服务端确认权益后才能分享或导出</span>
        </ProofCard>
      </div>
      <section className="proof-status-section" aria-labelledby="delivery-status-title">
        <h2 id="delivery-status-title">支付与交付状态</h2>
        <div className="proof-three-grid">
          <ProofCard className={!share && !deliveryUnlocked ? "is-current" : ""}><strong>等待支付</strong><p>请在支付宝完成支付。取消付款可返回预览继续编辑。</p></ProofCard>
          <ProofCard className={exporting ? "is-current" : ""}><strong>已支付 · 正在发布</strong><p>正在处理网页或导出。失败可重试，无需重复付款。</p></ProofCard>
          <ProofCard className={share || deliveryUnlocked ? "is-current" : ""}><strong>已解锁 · 交付完成</strong><p>分享链接与导出由服务端权益控制。</p></ProofCard>
        </div>
      </section>
      {share && <ProofCard className="proof-share-card">
        <div><strong>正式链接已创建</strong><span>有效至 {new Date(share.expiresAt).toLocaleString("zh-CN")}</span></div>
        <p>任何接收者可免费访问有效链接。到期或撤销后失效。</p>
        {shareSnapshot !== JSON.stringify(generated) && <p className="proof-warning">预览已更新，请重新发布以同步当前版本。</p>}
        <label className="proof-field"><span>分享链接</span><input readOnly value={share.url} onFocus={(event) => event.currentTarget.select()} /></label>
        <div className="proof-share-actions">
          <a href={share.url} target="_blank" rel="noopener noreferrer">在新标签页打开 →</a>
          <ProofButton variant="quiet" onClick={props.onCopyShare}>复制链接</ProofButton>
          <ProofButton variant="quiet" onClick={props.onRemoveShare}>撤销链接</ProofButton>
        </div>
      </ProofCard>}
      {savedShares.length > 0 && <ProofCard as="section" className="proof-saved-shares">
        <h2>已发布链接</h2>
        <ul>{savedShares.map((saved) => <li key={saved.id}><div><strong>{saved.id.slice(0, 12)}…</strong><span>有效至 {new Date(saved.expiresAt).toLocaleString("zh-CN")}</span></div>
          <a href={saved.url} target="_blank" rel="noopener noreferrer">打开分享 →</a>
          <ProofButton variant="quiet" aria-label={`删除分享 ${saved.id}`} onClick={() => props.onRemoveSavedShare(saved.id)}>删除</ProofButton></li>)}</ul>
      </ProofCard>}
      {resultError && <p className="proof-inline-error" role="alert">{resultError}</p>}
      <div className="proof-actions"><ProofButton onClick={() => go("result")}>← 返回预览</ProofButton></div>
    </section>}

    {error && phase !== "upload" && phase !== "confirm" && phase !== "quiz" && phase !== "result" && <p className="proof-inline-error" role="alert">{error}</p>}
    <ProjectsDialog open={projectsOpen} projects={projects} onClose={() => setProjectsOpen(false)}
      onSelect={props.onResumeProject} onDelete={props.onDeleteProject} />
  </BuilderChrome>;
}
