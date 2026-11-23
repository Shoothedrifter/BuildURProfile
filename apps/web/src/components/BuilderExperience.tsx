"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import type { DesignConfig, JobRole, ResumeContent, TemplateId } from "../../../../packages/contracts/src/config";
import rawConfig from "../demo/config.json";
import type { DraftField, ResumeDraft } from "../lib/resume";
import type { Offer, OwnedProject } from "../lib/paymentApi";
import type { HeroArtwork } from "../lib/generationApi";
import { TEMPLATE_PORTRAIT_POLICIES } from "../../../../packages/skills/src/avatar-catalog";
import { ShowcasePage } from "../ShowcasePage";
import { EditorPanel, InteractionSettings } from "./EditorPanel";
import { openShowcasePreview } from "../lib/showcasePreview";
import "./result-ui.css";
import { PixelAvatarEditor } from "./PixelAvatarEditor";
import { pixelDefaultPortrait } from "./PixelWorldPage";
import { LaunchPage } from "./LaunchPage";
import {
  BuilderChrome,
  ProjectsDialog,
  ProofButton,
  ProofCard,
  StepHeader,
  WorkflowProgress
} from "./BuilderChrome";
import type { WorkflowPhase, WorkflowStepTarget } from "./BuilderChrome";

export type DraftGroup = "basicInfo" | "jobIntent" | "selfEvaluation" | "workExperience" | "campusExperience" | "projects" | "awards" | "skills" | "education" | "other";
export type ReclassifyTarget = DraftGroup;
export type DeliveryAction = "share" | "export";
type ConfirmModule = "basic" | DraftGroup;
type StylePresetId = "warm" | "minimal" | "bold" | "cyber" | "pixel";

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
  templateId: TemplateId;
  label: string;
  description: string;
  tone: string;
  answers: Record<string, number>;
}> = [
  {
    id: "cyber",
    templateId: "cyber-creator-v1",
    label: "赛博科技",
    description: "暗色舞台 / 立体视觉 / 紫色光感",
    tone: "3D / 未来",
    answers: {
      "e-presence": 4,
      "e-type": 4,
      "k-pace": 3,
      "k-cards": 3,
      "p-tone": 0,
      "p-strength": 3,
      "s-browse": 2,
      "s-control": 3
    }
  },
  {
    id: "pixel", templateId: "pixel-world-v1", label: "像素世界风",
    description: "像素角色 / 开发者作品 / 项目导航", tone: "Pixel World", answers: {}
  },
  {
    id: "warm",
    templateId: "warm-v1",
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
    templateId: "minimal-v1",
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
    templateId: "bold-v1",
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

function AvatarPicker({ enabled, photoDataUrl, photoName, generating, disabledReason, inline = false, onPhoto, onClear }: {
  enabled: boolean;
  photoDataUrl: string | null;
  photoName: string;
  generating: boolean;
  disabledReason?: string;
  inline?: boolean;
  onPhoto: (event: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  const content = <>
    <h2 id="avatar-heading">个人头像</h2>
    <p>照片可选；此处不展示原图，生成后再查看与模板匹配的头像。</p>
    {enabled ? <>
      <label className="proof-avatar-upload">
        <strong>{photoDataUrl ? "重新选择照片" : "上传照片"}</strong>
        <input aria-label="选择个人肖像照片" type="file" accept="image/png,image/jpeg,image/webp" onChange={onPhoto} />
      </label>
      <p className="proof-avatar-formats">PNG、JPEG、WebP，单张不超过 10 MiB。</p>
      {photoName && <p className="proof-file-name">{photoName}</p>}
      {photoDataUrl && <ProofButton variant="quiet" aria-busy={generating || undefined} onClick={onClear}>移除照片</ProofButton>}
    </> : <>
      <p className="proof-muted">{disabledReason ?? "当前部署未启用头像生成，可跳过并在生成后继续编辑。"}</p>
      {photoDataUrl && <ProofButton variant="quiet" onClick={onClear}>移除照片</ProofButton>}
    </>}
  </>;
  return inline
    ? <section className="proof-avatar-inline" aria-labelledby="avatar-heading">{content}</section>
    : <ProofCard as="section" className="proof-avatar-card" aria-labelledby="avatar-heading">{content}</ProofCard>;
}

function PortfolioSnapshot({ name, role, intro, project, projectDescription = "", photo, tone = "minimal", draftPreview = false, hidePortrait = false }: {
  name: string; role: string; intro: string; project: string; projectDescription?: string; photo?: string | null; tone?: StylePresetId; draftPreview?: boolean; hidePortrait?: boolean;
}) {
  const displayName = name.trim() || "你的名字";
  return <div className={`proof-portfolio-snapshot proof-portfolio-snapshot--${tone}${draftPreview ? " proof-portfolio-snapshot--draft" : ""}${draftPreview && photo && !hidePortrait ? " proof-portfolio-snapshot--draft-portrait" : ""}`}>
    <span>{displayName} / 个人作品集</span>
    <small>{role.trim() || "个人作品集"}</small>
    <strong>{displayName}</strong>
    <h3>{intro.trim() || "用你的经历，讲述自己的故事。"}</h3>
    <div className="proof-snapshot-avatar" aria-hidden={hidePortrait || undefined}>{hidePortrait ? null : photo ? <img src={photo} alt={draftPreview && tone === "cyber" ? "赛博科技默认中性动漫形象" : "作品集头像预览"} /> : <span aria-label="姓名首字头像">{[...displayName][0]}</span>}</div>
    <b>精选项目&nbsp; 01</b>
    <h4>{project.trim() || "你的精选项目"}</h4>
    {projectDescription.trim() && <p className="proof-snapshot-project-description">{projectDescription.trim()}</p>}
  </div>;
}

const resultTabs = [
  ["content", "内容"],
  ["style", "样式"],
  ["settings", "设置"]
] as const;
type ResultTab = typeof resultTabs[number][0];

export type BuilderExperienceProps = {
  phase: WorkflowPhase;
  fileName: string;
  selectedFile: File | null;
  progress: string;
  error: string;
  draft: ResumeDraft | null;
  hasConfirmedResume: boolean;
  confirmedContent: ResumeContent | null;
  styleResumeId: string | null;
  resultResumeId: string | null;
  role: JobRole;
  selectedTemplate: TemplateId | null;
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
  restoredDelivery: boolean;
  draftSaved: boolean;
  shareSnapshot: string;
  resultError: string;
  exporting: boolean;
  photoDataUrl: string | null;
  photoName: string;
  generatingAvatar: boolean;
  avatarDemo: boolean;
  onPhaseChange: (phase: WorkflowPhase) => void;
  onSelectFile: (file: File) => void;
  onParseFile: () => void;
  onPhoto: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearPhoto: () => void;
  onUpdateSingle: (key: "name" | "email", value: string) => void;
  onUpdateGroup: (key: DraftGroup, index: number, change: Partial<DraftField>) => void;
  onReclassify: (key: DraftGroup, index: number, target: ReclassifyTarget) => void;
  onConfirm: () => void;
  onRoleChange: (role: JobRole) => void;
  onApplyAnswers: (answers: Record<string, number>) => void;
  onSelectTemplate: (templateId: TemplateId) => void;
  onGenerate: () => void;
  onRunAvatarGeneration: () => void;
  onEditGenerated: (update: (current: DesignConfig) => DesignConfig) => void;
  onSaveDraft: () => void;
  onRequestDelivery: (action: DeliveryAction) => void;
  onGitHubPages?: () => void;
  githubPagesDialog?: ReactNode;
  onConfirmPublish: () => void;
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
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>("content");
  const [zoom, setZoom] = useState(100);
  const [previewError, setPreviewError] = useState("");
  const deliveryHeading = useRef<HTMLHeadingElement>(null);
  const publishButton = useRef<HTMLButtonElement>(null);
  const focusPublish = useRef(false);
  const {
    phase, fileName, selectedFile, progress, error, draft, role, generated, isTouch, share, savedShares,
    projects, projectId, projectPaid, offer, quotedAmountYuan, paymentIntent, shareSnapshot, resultError, exporting, photoDataUrl, photoName,
    generatingAvatar, avatarDemo
  } = props;
  const selectedPreset = stylePresets.find(preset => preset.templateId === props.selectedTemplate)?.id ?? null;
  const pixelSelected = props.selectedTemplate === "pixel-world-v1";
  const pixelResult = generated && "templateId" in generated && generated.templateId === "pixel-world-v1";
  const [pixelPreview, setPixelPreview] = useState<{ projectId: string | null; artwork: HeroArtwork } | null>(null);
  const pixelArtwork = pixelPreview?.projectId === projectId ? pixelPreview?.artwork ?? null : null;
  useEffect(() => { setPixelPreview(null); }, [projectId, pixelResult]);
  const portraitPolicy = props.selectedTemplate ? TEMPLATE_PORTRAIT_POLICIES[props.selectedTemplate] : undefined;
  useEffect(() => { if (phase === "result") setPublishConfirmed(false); }, [phase]);
  useEffect(() => {
    if (phase === "delivery") {
      if (props.restoredDelivery) setPublishConfirmed(true);
      deliveryHeading.current?.focus();
    }
    if (phase === "result" && focusPublish.current) {
      focusPublish.current = false;
      publishButton.current?.focus();
    }
  }, [phase, props.restoredDelivery]);
  useEffect(() => {
    setResultTab("content");
    setZoom(100);
    setPreviewError("");
  }, [projectId, generated && "templateId" in generated ? generated.templateId : null]);

  const go = (next: WorkflowPhase) => {
    props.onPhaseChange(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const goLanding = (section?: "about" | "process" | "upload") => {
    const id = section === "about" ? "write" : section;
    const url = id ? `/#${id}` : "/";
    if (window.location.pathname !== "/") {
      window.location.assign(url);
      return;
    }
    props.onPhaseChange("landing");
    window.history.replaceState(null, "", url);
    window.setTimeout(() => {
      const target = id ? document.getElementById(id) : null;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (target) target.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth" });
      else window.scrollTo({ top: 0, behavior: "instant" });
    }, 0);
  };
  const applyPreset = (preset: (typeof stylePresets)[number]) => {
    props.onSelectTemplate(preset.templateId);
    if (!props.hasConfirmedResume) props.onApplyAnswers(preset.answers);
  };
  const isPresetSelected = (presetId: StylePresetId) => selectedPreset === presetId;
  const hasVisibleError = Boolean(error);
  const deliveryUnlocked = projectPaid || Boolean(projects.find((project) => project.id === projectId)?.paid);
  const styleResumeId = props.styleResumeId;
  const editorResumeId = phase === "result" || phase === "delivery" ? props.resultResumeId : styleResumeId;
  const editorHref = editorResumeId ? `/editor/${encodeURIComponent(editorResumeId)}` : null;
  const [draftProjectTitle = "", ...draftProjectDetails] = draft?.projects[0]?.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
  const previewProjectTitle = draftProjectTitle || props.confirmedContent?.projects[0]?.title || "";
  const previewProjectDescription = draftProjectDetails.join(" ") || props.confirmedContent?.projects[0]?.description || "";
  const stepTargets: Partial<Record<number, WorkflowStepTarget>> = {
    1: draft || phase === "upload" ? { onClick: () => go("upload") }
      : { onClick: () => goLanding("upload") },
    ...(editorHref ? { 2: { href: editorHref } }
      : draft ? { 2: { onClick: () => go("confirm") } } : {}),
    ...((draft || props.hasConfirmedResume || props.resultResumeId) ? {
      3: { onClick: phase === "result" || phase === "delivery" ? props.onRestartQuiz : () => go("quiz") }
    } : {}),
    ...(generated ? { 4: { onClick: () => go("result") },
      5: { onClick: () => props.onRequestDelivery("share") } } : {})
  };

  if (phase === "mock") {
    return <div className="proof-demo-page">
      <div className="proof-demo-toolbar">
        <ProofButton onClick={() => go("landing")}>← 返回生成器</ProofButton>
        <span>作品集样例 / LIVE PREVIEW</span>
      </div>
      <ShowcasePage config={rawConfig as DesignConfig} allowSkinSwitch />
    </div>;
  }

  if (phase === "landing") {
    return <div className="launch-shell">
      <LaunchPage projectCount={projects.length}
        onProjects={() => setProjectsOpen(true)}
        onSample={() => go("mock")}
        onLegacyParse={() => go("upload")} />
      <ProjectsDialog open={projectsOpen} projects={projects} onClose={() => setProjectsOpen(false)}
        onSelect={props.onResumeProject} onDelete={props.onDeleteProject} />
    </div>;
  }

  const shareNeedsUpdate = Boolean(share && shareSnapshot !== JSON.stringify(generated));
  const workbenchConfig = generated && pixelResult && pixelArtwork ? { ...generated, heroArtwork: pixelArtwork } : generated;
  const activeTemplate = generated && "templateId" in generated ? stylePresets.find(preset => preset.templateId === generated.templateId) : null;
  const canChangeTemplate = Boolean(draft || props.hasConfirmedResume || props.resultResumeId);
  const returnToEditor = () => {
    setPublishConfirmed(false);
    focusPublish.current = true;
    props.onPhaseChange("result");
  };

  const progressNumber = phase === "upload" ? 1 : phase === "confirm" ? 2 : phase === "quiz" ? 3 : phase === "result" ? 4 : phase === "delivery" ? 5 : 0;

  return <BuilderChrome projectCount={projects.length}
    onHome={() => goLanding()}
    onStart={() => goLanding("upload")}
    onProjects={() => setProjectsOpen(true)}
    onSample={() => go("mock")}
    onSection={(section) => goLanding(section)}>
    <WorkflowProgress phase={phase} targets={stepTargets} />
    {progressNumber > 0 && <div className="proof-step-shell" data-step={progressNumber} />}

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

    {phase === "quiz" && !draft && !props.hasConfirmedResume && <section className="proof-step-page">
      <StepHeader number={4} title="04 头像与网站风格" description="正在准备已确认的简历草稿。" />
      <ProofCard role={error ? "alert" : "status"}>
        <p>{error || progress || "正在读取已确认的简历草稿…"}</p>
        {error && styleResumeId && <a href={`/editor/${encodeURIComponent(styleResumeId)}`}>← 返回资料编辑</a>}
      </ProofCard>
    </section>}

    {phase === "quiz" && (draft || props.hasConfirmedResume) && <section className="proof-step-page">
      <StepHeader number={4} title="04 头像与网站风格" description="头像可选；选择网站风格后查看首屏样张，再生成完整作品集。" />
      <div className="proof-style-layout">
        <ProofCard as="section" className="proof-style-preview" aria-label="首屏实时预览">
          <h2>实时预览 / {stylePresets.find((preset) => preset.id === selectedPreset)?.label ?? "风格示意"}</h2>
          <PortfolioSnapshot name={draft?.name.value ?? props.confirmedContent?.profile.name ?? ""} role={roles.find((entry) => entry.value === role)?.label ?? ""}
            intro={draft?.selfEvaluation[0]?.value ?? props.confirmedContent?.profile.summary ?? ""}
            project={previewProjectTitle} projectDescription={previewProjectDescription} tone={selectedPreset ?? "minimal"}
            photo={selectedPreset === "cyber" ? "/cyber-neutral-print-anime.webp" : pixelSelected ? pixelDefaultPortrait : null}
            draftPreview hidePortrait={selectedPreset !== "cyber" && !pixelSelected} />
          <p>{pixelSelected ? "作品使用默认像素角色。" : selectedPreset === "cyber" ? "当前样张展示赛博科技默认形象；上传照片后的专属头像以生成结果为准。" : "完整首屏样张会随模板更新。头像位置暂时留空，生成后再查看头像效果。"}</p>
        </ProofCard>
        <ProofCard as="section" className="proof-style-controls" aria-label="头像与网站模板">
        {!pixelSelected && <AvatarPicker inline enabled={avatarDemo && (!props.selectedTemplate || Boolean(portraitPolicy))}
          disabledReason={avatarDemo ? "当前模板暂不支持照片生成；移除照片后可继续生成。" : undefined}
          photoDataUrl={photoDataUrl} photoName={photoName}
          generating={generatingAvatar} onPhoto={props.onPhoto} onClear={props.onClearPhoto} />}
        <section className="proof-style-card" aria-labelledby="website-style-heading">
          <h2 id="website-style-heading">网站模板</h2>
          <div className="proof-style-options">
            {stylePresets.filter(preset => props.hasConfirmedResume || preset.id !== "pixel").map((preset) => <button type="button" key={preset.id} data-preset={preset.id} className={isPresetSelected(preset.id) ? "is-selected" : ""}
              aria-pressed={isPresetSelected(preset.id)} disabled={generatingAvatar} onClick={() => applyPreset(preset)}>
              <strong aria-hidden="true">{preset.id === "cyber" ? "3D" : "Aa"}</strong><b>{preset.label}{isPresetSelected(preset.id) ? "　✓ 已选" : ""}</b>
            </button>)}
          </div>
          <p className="proof-style-preserve">更换模板会保留已确认的资料和照片。</p>
          {isTouch && <p className="proof-note">检测到触屏：卡片可手动切换，跑马灯恒定滚动。</p>}
          {progress && <p className="proof-status" role="status">{progress}</p>}
          {error && <p className="proof-inline-error" role="alert">{error}</p>}
          <ProofButton variant="primary" disabled={!props.selectedTemplate || generatingAvatar || Boolean(!pixelSelected && photoDataUrl && !portraitPolicy)} onClick={props.onGenerate}>
            {generatingAvatar ? "正在生成作品…" : "生成我的 Showcase →"}
          </ProofButton>
        </section>
        </ProofCard>
      </div>
      <div className="proof-actions proof-style-actions">
        {editorHref ? <a className="proof-button proof-button--secondary" href={editorHref}>← 返回资料</a>
          : <ProofButton onClick={() => go("confirm")}>← 返回资料</ProofButton>}
        <label className="proof-role-select"><span>展示方向</span><select id="job-role" value={role} disabled={generatingAvatar} onChange={(event) => props.onRoleChange(event.target.value as JobRole)}>
          {roles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
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

    {(phase === "result" || phase === "delivery") && generated && workbenchConfig && <section className="proof-step-page result-workbench">
      <div className="result-heading">
        <div>
          <h1>05 网站预览与轻量编辑</h1>
          <p>左侧预览作品，右侧调整内容与发布。</p>
        </div>
        {props.draftSaved && <span role="status">草稿已保存</span>}
      </div>
      <div className="proof-result-layout">
        <div className="proof-preview-column">
          {"templateId" in generated && generated.templateId === "cyber-creator-v1" && generated.heroArtwork && !generated.heroArtwork.cutoutAssetUrl &&
            <p className="proof-note" role="status">透明去背景未完成，当前首屏以带背景海报展示。请联系管理员检查图像服务，再重新生成。</p>}
          <div className="proof-preview-frame result-canvas">
            <div className="proof-preview-toolbar">
              <span>{share || deliveryUnlocked ? "作品预览" : "草稿预览 · 尚未公开"}</span>
              <ProofButton variant="quiet" aria-label="缩小预览" disabled={zoom <= 50}
                onClick={() => setZoom(value => value - 10)}>−</ProofButton>
              <ProofButton variant="quiet" aria-label={`重置预览缩放，当前 ${zoom}%`}
                onClick={() => setZoom(100)}>{zoom}%</ProofButton>
              <ProofButton variant="quiet" aria-label="放大预览" disabled={zoom >= 140}
                onClick={() => setZoom(value => value + 10)}>＋</ProofButton>
            </div>
            <div className="result-canvas-scroll" data-showcase-scroll tabIndex={0} role="region" aria-label="作品预览画布">
              <div style={{ zoom: zoom / 100 }}><ShowcasePage config={workbenchConfig} touchDowngraded={isTouch} /></div>
            </div>
          </div>
          <details className="proof-advanced">
            <summary>高级参数 / 调试信息 →</summary>
            <pre data-testid="design-config-json">{JSON.stringify(generated, null, 2)}</pre>
          </details>
        </div>
        <aside className="proof-editor-column result-inspector" aria-label={phase === "delivery" ? "分享与付费" : "作品集编辑"}>
          {phase === "result" ? <>
            <h2>调整你的网站</h2>
            <div className="result-tabs" role="tablist" aria-label="作品集编辑选项" onKeyDown={(event) => {
              const index = resultTabs.findIndex(([id]) => id === resultTab);
              const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!offset && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? resultTabs.length - 1
                : (index + offset + resultTabs.length) % resultTabs.length;
              setResultTab(resultTabs[next][0]);
              event.currentTarget.querySelectorAll("button")[next]?.focus();
            }}>
              {resultTabs.map(([id, label]) => <button type="button" role="tab" key={id} id={`result-tab-${id}`}
                aria-selected={resultTab === id} aria-controls="result-tab-panel"
                tabIndex={resultTab === id ? 0 : -1} onClick={() => setResultTab(id)}>{label}</button>)}
            </div>
            <div role="tabpanel" id="result-tab-panel" aria-labelledby={`result-tab-${resultTab}`}>
              {resultTab === "content" && <EditorPanel config={generated} onChange={props.onEditGenerated} isTouch={isTouch} contentOnly />}
              {resultTab === "style" && <div className="result-tab-content">
                <p>当前模板 <strong>{activeTemplate?.label ?? "兼容模板"}</strong></p>
                {canChangeTemplate ? <ProofButton onClick={props.onRestartQuiz}>更换模板</ProofButton>
                  : <p className="proof-note">原简历草稿不可用，可以继续编辑当前作品。</p>}
              </div>}
              {resultTab === "settings" && <div className="result-tab-content">
                <InteractionSettings config={generated} onChange={props.onEditGenerated} isTouch={isTouch} />
                {pixelResult && <PixelAvatarEditor key={projectId ?? "pixel-preview"} config={generated} applied={pixelArtwork}
                  onApply={artwork => setPixelPreview(artwork ? { projectId, artwork } : null)} />}
                {!pixelResult && avatarDemo && (!("templateId" in generated) || (typeof generated.templateId === "string" && Object.hasOwn(TEMPLATE_PORTRAIT_POLICIES, generated.templateId))) && <details className="proof-regenerate">
                  <summary>更换照片 →</summary>
                  <AvatarPicker enabled photoDataUrl={photoDataUrl} photoName={photoName} generating={generatingAvatar}
                    onPhoto={props.onPhoto} onClear={props.onClearPhoto} />
                  <ProofButton variant="primary" disabled={!photoDataUrl || generatingAvatar} onClick={props.onRunAvatarGeneration}>
                    {generatingAvatar ? "正在生成头像…" : "应用新照片 →"}
                  </ProofButton>
                  {progress && <p className="proof-status" role="status">{progress}</p>}
                </details>}
              </div>}
            </div>
            <div className="result-actions">
              <ProofButton onClick={() => {
                setPreviewError("");
                void openShowcasePreview(workbenchConfig).catch((cause: unknown) => {
                  setPreviewError(cause instanceof Error ? cause.message : "无法打开预览，请重试。");
                });
              }}>新标签页预览 ↗</ProofButton>
              {editorHref ? <a className="proof-button proof-button--secondary" href={editorHref}>返回编辑详细内容</a>
                : draft ? <ProofButton onClick={() => go("confirm")}>返回编辑详细内容</ProofButton> : null}
              <ProofButton disabled={exporting} onClick={props.onSaveDraft}>保存草稿</ProofButton>
              <ProofButton disabled={exporting} onClick={() => props.onRequestDelivery("export")}>导出文件</ProofButton>
              <ProofButton ref={publishButton} variant="primary" disabled={exporting}
                onClick={() => props.onRequestDelivery("share")}>发布并获取链接 →</ProofButton>
            </div>
            {pixelResult && <p className="proof-note">分享和导出将使用默认角色。</p>}
            {previewError && <p className="proof-inline-error" role="alert">{previewError}</p>}
          </> : <>
            <h2 ref={deliveryHeading} tabIndex={-1}>06 分享确认与发布</h2>
            {pixelResult && <p className="proof-note">分享和导出将使用默认角色。</p>}
            {!publishConfirmed ? <ProofCard className="proof-unlock-card">
              <h2>准备好公开分享了吗？</h2>
              <p>拿到链接的人可以查看你选择公开的资料。分享链接有有效期，也可以提前撤销。</p>
              <p>当前项目一次付款解锁发布与分享；同一项目更新无需重复付款。</p>
              <div className="proof-unlock-actions">
                <ProofButton variant="primary" disabled={exporting} onClick={() => { setPublishConfirmed(true); props.onConfirmPublish(); }}>确认并发布</ProofButton>
                <ProofButton disabled={exporting} onClick={returnToEditor}>暂不分享，返回预览</ProofButton>
              </div>
            </ProofCard> : !deliveryUnlocked && !share &&
            <ProofCard className="proof-unlock-card">
              <h2>{projectId ? "解锁当前项目" : "保存当前作品"}</h2>
              <p>单项目一次付费 · {offer?.shareDays ?? 7} 天分享链接</p>
              <strong className="proof-price">{quotedAmountYuan || offer?.priceYuan ? `¥${quotedAmountYuan ?? offer?.priceYuan}` : "服务端尚未配置价格"}</strong>
              <p>{offer?.service || "一次付款解锁当前项目的发布与分享，静态网站导出免费。"}</p>
              {offer?.mode === "sandbox" && <p className="proof-note">沙箱测试：普通支付宝无法支付沙箱订单，请使用对应沙箱买家账号。</p>}
              {offer?.configurationError && <p className="proof-inline-error" role="alert">支付配置：{offer.configurationError}</p>}
              {!projectId && !exporting && <ProofButton onClick={props.onConfirmPublish}>重试保存并检查权益</ProofButton>}
              <div className="proof-unlock-actions">
                <ProofButton variant="primary" disabled={!offer?.configured || exporting || !paymentIntent || !projectId} onClick={props.onStartPayment}>
                  {offer?.mode === "production" ? "支付宝支付并解锁 →" : "前往支付宝沙箱收银台 →"}
                </ProofButton>
                <ProofButton disabled={exporting || !paymentIntent || !projectId} onClick={props.onCheckEntitlement}>{exporting ? "正在检查…" : "检查已有权益"}</ProofButton>
              </div>
              <span className="proof-microcopy">支付渠道：支付宝 · 服务端确认权益后才能发布分享</span>
            </ProofCard>}
            {publishConfirmed && <>
              {deliveryUnlocked && !share && <ProofCard className="proof-unlock-card">
                <h3>当前项目已解锁</h3>
                {exporting ? <p role="status">正在发布分享链接…</p> :
                  <ProofButton onClick={props.onConfirmPublish}>重试发布分享链接</ProofButton>}
              </ProofCard>}
              {share && <ProofCard className="proof-share-card">
                <div><strong>正式链接已创建</strong><span>有效至 {new Date(share.expiresAt).toLocaleString("zh-CN")}</span></div>
                <p>任何接收者可免费访问有效链接。到期或撤销后失效。</p>
                {shareNeedsUpdate && <p className="proof-warning">预览已更新，请重新发布以同步当前版本。</p>}
                <label className="proof-field"><span>分享链接</span><input readOnly value={share.url} onFocus={(event) => event.currentTarget.select()} /></label>
                <div className="proof-share-actions">
                  <a href={share.url} target="_blank" rel="noopener noreferrer">在新标签页打开 →</a>
                  <ProofButton variant="quiet" onClick={props.onCopyShare}>复制链接</ProofButton>
                  <ProofButton variant="quiet" onClick={props.onRemoveShare}>撤销链接</ProofButton>
                  {shareNeedsUpdate && <ProofButton disabled={exporting} onClick={props.onConfirmPublish}>更新分享链接</ProofButton>}
                </div>
                {props.onGitHubPages && <ProofButton disabled={exporting} onClick={props.onGitHubPages}>部署到 GitHub Pages</ProofButton>}
              </ProofCard>}
              {savedShares.length > 0 && <ProofCard as="section" className="proof-saved-shares">
                <h2>已发布链接</h2>
                <ul>{savedShares.map((saved) => <li key={saved.id}><div><strong>{saved.id.slice(0, 12)}…</strong><span>有效至 {new Date(saved.expiresAt).toLocaleString("zh-CN")}</span></div>
                  <a href={saved.url} target="_blank" rel="noopener noreferrer">打开分享 →</a>
                  <ProofButton variant="quiet" aria-label={`删除分享 ${saved.id}`} onClick={() => props.onRemoveSavedShare(saved.id)}>删除</ProofButton></li>)}</ul>
              </ProofCard>}
              <div className="result-actions">
                <ProofButton disabled={exporting} onClick={returnToEditor}>返回预览，继续编辑</ProofButton>
                <ProofButton disabled={exporting} onClick={() => props.onRequestDelivery("export")}>导出文件</ProofButton>
              </div>
            </>}
          </>}
          {error && <p className="proof-inline-error" role="alert">{error}</p>}
          {resultError && <p className="proof-inline-error" role="alert">{resultError}</p>}
        </aside>
      </div>
    </section>}

    {error && phase !== "upload" && phase !== "confirm" && phase !== "quiz" && phase !== "result" && phase !== "delivery" && <p className="proof-inline-error" role="alert">{error}</p>}
    <ProjectsDialog open={projectsOpen} projects={projects} onClose={() => setProjectsOpen(false)}
      onSelect={props.onResumeProject} onDelete={props.onDeleteProject} />
    {props.githubPagesDialog}
  </BuilderChrome>;
}
