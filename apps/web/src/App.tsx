"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { DesignConfig, JobRole, ResumeContent, TemplateId } from "../../../packages/contracts/src/config";
import type { ResumeDraftV2 } from "../../../packages/contracts/src/resume-draft";
import { projectConfirmedResumeV3 } from "../../../packages/contracts/src/resume-draft";
import type { GenerationStatus } from "./lib/generationApi";
import type { GitHubDeployment, Offer, OwnedProject } from "./lib/paymentApi";
import type { DraftField, ResumeDraft } from "./lib/resume";
import type { DeliveryAction, DraftGroup, ReclassifyTarget } from "./components/BuilderExperience";
import type { WorkflowPhase } from "./components/BuilderChrome";
import { ShowcasePage } from "./ShowcasePage";
import { BuilderExperience } from "./components/BuilderExperience";
import { GitHubPagesDialog } from "./components/GitHubPagesDialog";
import { isAssessmentComplete } from "./lib/assessment";
import { inlineConfigImages } from "./lib/export";
import { extractPdfText } from "./lib/pdf";
import { parseResumePages, toResumeContent, validateResumeDraft } from "./lib/resume";
import { githubPagesApi, paymentApi, submitAlipayForm } from "./lib/paymentApi";
import { toPublishedConfig } from "./lib/publication";
import { generationApi } from "./lib/generationApi";
import { preparePortrait } from "./lib/portrait";
import { createDefaultSkillRegistry } from "../../../packages/skills/src/registry";
import { TEMPLATE_PORTRAIT_POLICIES } from "../../../packages/skills/src/avatar-catalog";
import { resumeApi } from "./lib/resumeApi";

const workflowSkills = createDefaultSkillRegistry();
const agentStatusText = (status: GenerationStatus): string => status === "QUEUED"
  ? "作品已排队，等待 Agent 工作流…"
  : status === "CANCELLING" ? "正在取消任务；已发出的图像请求可能无法撤回。" : "Agent 工作流正在生成作品…";

function touchInput(): boolean {
  return typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 ||
    (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) || false);
}

function hasExplicitHomeTarget(): boolean {
  const hash = window.location.hash;
  return hash.startsWith("#share=") || /^#(?:intro|write|design|check|upload|editor|process)$/.test(hash);
}

function shareToken(): string | null {
  if (typeof window === "undefined") return null;
  const match = /^#share=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
  return match?.[1] ?? null;
}

function isAvatarDemoEnabled(): boolean {
  const viteEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  if (viteEnv && (viteEnv.DEV === true || viteEnv.MODE === "tunnel")) return true;
  if (typeof process !== "undefined" && process.env) {
    if (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_APP_MODE === "tunnel") return true;
  }
  return false;
}

function isRenderableConfig(value: DesignConfig | null | undefined): value is DesignConfig {
  return Boolean(value?.content && value.marquee && value.stackedCards && value.styleVector);
}

export default function App({ initialPhase = "landing", styleResumeId = null }: {
  initialPhase?: WorkflowPhase;
  styleResumeId?: string | null;
}) {
  const avatarDemo = isAvatarDemoEnabled();
  const [shareView, setShareView] = useState<{ requested: boolean; config: DesignConfig | null; loading: boolean }>({ requested: false, config: null, loading: false });
  const [restoredDelivery, setRestoredDelivery] = useState(false);
  const [savedConfig, setSavedConfig] = useState<DesignConfig | null>(null);
  const [phase, setPhase] = useState<WorkflowPhase>(initialPhase);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const [agentDraft, setAgentDraft] = useState<ResumeDraftV2 | null>(null);
  const [confirmedContent, setConfirmedContent] = useState<ResumeContent | null>(null);
  const [role, setRole] = useState<JobRole>("frontend-creative-developer");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId | null>(null);
  const [generated, setGenerated] = useState<DesignConfig | null>(null);
  const [resultResumeId, setResultResumeId] = useState<string | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [share, setShare] = useState<{ id: string; url: string; expiresAt: number } | null>(null);
  const [savedShares, setSavedShares] = useState<Array<{ id: string; url: string; expiresAt: number }>>([]);
  const [projects, setProjects] = useState<OwnedProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectPaid, setProjectPaid] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [quotedAmountYuan, setQuotedAmountYuan] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<DeliveryAction | null>(null);
  const [shareSnapshot, setShareSnapshot] = useState("");
  const [resultError, setResultError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [githubDialog, setGitHubDialog] = useState<{ paymentReturn: boolean; deployment: GitHubDeployment | null } | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState("");
  const [pixelAvatarEnabled, setPixelAvatarEnabled] = useState(false);
  const [pixelArtwork, setPixelArtwork] = useState<NonNullable<DesignConfig["heroArtwork"]> | null>(null);
  const pixelAvatarRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void generationApi.pixelAvatarEnabled().then(enabled => {
      if (active) setPixelAvatarEnabled(enabled);
    }).catch(() => {});
    return () => { active = false; pixelAvatarRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    if (phase !== "result") {
      pixelAvatarRequest.current?.abort();
      setPixelArtwork(null);
    }
  }, [phase]);
  const [generatingAvatar, setGeneratingAvatar] = useState(false);
  const generationVersion = useRef(0);
  const pdfVersion = useRef(0);
  const photoDataRef = useRef<string | null>(null);

  useEffect(() => {
    if (window.location.pathname === "/payment/return" || window.location.pathname.startsWith("/style/") ||
      hasExplicitHomeTarget() ||
      new URLSearchParams(window.location.search).has("github_deployment")) return;
    let active = true;
    const version = generationVersion.current;
    void generationApi.resumeGeneration((status) => {
      if (active && version === generationVersion.current) setProgress(agentStatusText(status));
    }).then((result) => {
      if (!active || version !== generationVersion.current || !result || hasExplicitHomeTarget()) return;
      if (!isRenderableConfig(result.config)) {
        setProgress("");
        setError("恢复的作品配置不完整，请重新生成。");
        setPhase("quiz");
        return;
      }
      if (result.projectId) { setProjectId(result.projectId); setProjectPaid(result.projectPaid ?? false); }
      setGenerated({ ...result.config, ...(result.heroArtwork ? { heroArtwork: result.heroArtwork } : {}) });
      setResultResumeId(result.resumeId ?? null);
      setProgress("");
      setPhase("result");
    }).catch((cause) => {
      if (!active || version !== generationVersion.current) return;
      setProgress("");
      setError(cause instanceof Error ? cause.message : "恢复生成任务失败，请重新上传简历。");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let sequence = 0;
    const onHashChange = () => {
      const current = ++sequence;
      const token = shareToken();
      if (!window.location.hash.startsWith("#share=")) {
        setShareView({ requested: false, config: null, loading: false });
        return;
      }
      setShareView({ requested: true, config: null, loading: true });
      if (!token) {
        setShareView({ requested: true, config: null, loading: false });
        return;
      }
      void paymentApi.readShare(token).then((value) => {
        if (current === sequence) setShareView({ requested: true, config: value.config, loading: false });
      }).catch(() => {
        if (current === sequence) setShareView({ requested: true, config: null, loading: false });
      });
    };
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => { sequence++; window.removeEventListener("hashchange", onHashChange); };
  }, []);

  useEffect(() => {
    void paymentApi.offer().then(setOffer).catch(() => {});
    void paymentApi.projects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (window.location.pathname !== "/payment/return") return;
    const id = new URLSearchParams(window.location.search).get("project_id");
    window.history.replaceState(null, "", "/#work");
    if (!id) return;
    void (async () => {
      let project: OwnedProject;
      let queryError = "";
      try {
        project = await paymentApi.reconcile(id);
      } catch (cause) {
        queryError = cause instanceof Error ? cause.message : "支付状态查询失败，请稍后重试。";
        try {
          project = await paymentApi.project(id);
        } catch {
          setError(queryError);
          setPhase("delivery");
          return;
        }
      }
      if (!isRenderableConfig(project.config)) {
        setResultError("支付返回的作品配置不完整，请返回制作流程重试。");
        setPhase("quiz");
        return;
      }
      setProjectId(id);
      setProjectPaid(project.paid);
      setGenerated(project.config);
      setResultResumeId(project.resumeId ?? null);
      void paymentApi.projects().then(setProjects).catch(() => {});
      if (project.pendingAction === "github-pages") {
        setPhase("result");
        setGitHubDialog({ paymentReturn: true, deployment: null });
        if (queryError) setResultError(queryError);
        return;
      }
      setPaymentIntent(project.pendingAction);
      setRestoredDelivery(project.pendingAction === "share");
      setQuotedAmountYuan(project.pendingAmountFen ? (project.pendingAmountFen / 100).toFixed(2) : null);
      setPhase("delivery");
      if (queryError) {
        setResultError(`${queryError}。作品草稿已保留，请重试原操作。`);
        return;
      }
      if (!project.paid) {
        setResultError("付款尚未确认。作品草稿已保留，稍后可重试或再次查单。");
        return;
      }
      try {
        if (project.pendingAction === "share") {
          const published = await paymentApi.publish(id);
          setShare({ id: published.token, url: published.url, expiresAt: published.expiresAt });
          setShareSnapshot(JSON.stringify(project.config));
        } else if (project.pendingAction === "export") {
          const download = await paymentApi.export(id);
          window.location.assign(download.url);
        }
      } catch (cause) {
        setResultError(cause instanceof Error ? cause.message : "交付失败，请重试原操作。");
      }
    })();
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("github_deployment");
    if (!id) return;
    let active = true;
    void (async () => {
      try {
        const deployment = await githubPagesApi.status(id);
        const project = await paymentApi.project(deployment.projectId);
        if (!active) return;
        if (!isRenderableConfig(project.config)) throw new Error("无法读取部署对应的作品。");
        setProjectId(project.id);
        setProjectPaid(project.paid);
        setGenerated(project.config);
        setResultResumeId(project.resumeId ?? null);
        setPhase("result");
        setGitHubDialog({ paymentReturn: false, deployment });
      } catch (cause) {
        if (!active) return;
        setPhase("upload");
        setError(cause instanceof Error ? cause.message : "无法恢复 GitHub Pages 部署。");
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const match = /^\/style\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname);
    if (!match) return;
    let active = true;
    const version = generationVersion.current;
    setProgress("正在读取已确认的简历草稿…");
    void resumeApi.read(match[1]).then(({ draft: nextDraft }) => {
      const content = projectConfirmedResumeV3(nextDraft);
      if (!active || version !== generationVersion.current) return;
      setAgentDraft(nextDraft);
      setConfirmedContent(content);
      setProgress("");
      setPhase("quiz");
    }).catch((cause) => {
      if (!active || version !== generationVersion.current) return;
      setProgress("");
      setError(cause instanceof Error ? cause.message : "读取简历草稿失败，请返回编辑页。");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setIsTouch(touchInput());
    const onTouch = () => setIsTouch(true);
    window.addEventListener("touchstart", onTouch, { passive: true, once: true });
    return () => window.removeEventListener("touchstart", onTouch);
  }, []);

  const selectFile = (file: File) => {
    setError("");
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("请选择 PDF 文件。");
      return;
    }
    pdfVersion.current++;
    generationVersion.current++;
    void generationApi.cancelSavedGeneration();
    setGeneratingAvatar(false);
    setProgress("");
    setProjectId(null);
    setProjectPaid(false);
    setShare(null);
    setSavedShares([]);
    setPaymentIntent(null);
    setSelectedFile(file);
    setFileName(file.name);
    setDraft(null);
    setAgentDraft(null);
    setConfirmedContent(null);
    setSelectedTemplate(null);
    setGenerated(null);
    setResultResumeId(null);
  };

  const parseSelectedFile = async () => {
    if (!selectedFile) return;
    const currentPdfVersion = pdfVersion.current;
    setProgress("正在读取 PDF…");
    setError("");
    try {
      const extracted = await workflowSkills.run("resume.extract.v1", {
        file: selectedFile,
        onProgress: (done: number, total: number) => {
          if (currentPdfVersion === pdfVersion.current) setProgress(`正在读取第 ${done} / ${total} 页…`);
        }
      }, { runtime: "browser", capabilities: { extractPdfText } }) as { text: string; pages: string[] };
      if (currentPdfVersion !== pdfVersion.current) return;
      if (!extracted.text.trim()) throw new Error("这份 PDF 没有可提取文本。当前版本暂不支持扫描件 OCR。");
      const { draft: nextDraft } = workflowSkills.runSync("resume.parse.v3", { pages: extracted.pages },
        { runtime: "browser", capabilities: { parseResumePages } }) as { draft: ResumeDraft };
      if (!nextDraft.name.value) {
        throw new Error("PDF 文本已提取，但未能识别姓名。请检查排版或换一份带清晰姓名的 PDF。");
      }
      setDraft(nextDraft);
      setProgress("");
      setPhase("confirm");
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (cause) {
      if (currentPdfVersion !== pdfVersion.current) return;
      setProgress("");
      setError(cause instanceof Error ? cause.message : "PDF 读取失败，请重试。");
    }
  };

  const updateSingle = (key: "name" | "email", value: string) => {
    setDraft((previous) => previous ? { ...previous, [key]: { ...previous[key], value } } : previous);
  };

  const updateGroup = (key: DraftGroup, index: number, change: Partial<DraftField>) => {
    setDraft((previous) => {
      if (!previous) return previous;
      const next = previous[key].map((entry, entryIndex) => entryIndex === index ? { ...entry, ...change } : entry);
      return { ...previous, [key]: next };
    });
  };

  const reclassify = (key: DraftGroup, index: number, target: ReclassifyTarget) => {
    setDraft((previous) => {
      if (!previous) return previous;
      const entry = previous[key][index];
      if (!entry || key === target) return previous;
      const next = { ...previous, [key]: previous[key].filter((_, at) => at !== index) };
      const moved: DraftField = { ...entry, included: target === "basicInfo" ? false : entry.included,
        label: target === "other" ? entry.label ?? "其他内容" : undefined,
        fieldKey: target === "basicInfo" || target === "jobIntent" ? entry.fieldKey : undefined };
      return { ...next, [target]: [...next[target], moved] };
    });
  };

  const confirm = () => {
    if (!draft) return;
    const { problems } = workflowSkills.runSync("resume.confirm.v3", { draft },
      { runtime: "browser", capabilities: { validateResumeDraft, toResumeContent } }) as { problems: string[] };
    if (problems.length) {
      setError(problems.slice(0, 3).join("；"));
      return;
    }
    setError("");
    setPhase("quiz");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const onPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    event.currentTarget.value = "";
    setError("");
    const version = ++generationVersion.current;
    pixelAvatarRequest.current?.abort();
    photoDataRef.current = null;
    void generationApi.cancelSavedGeneration();
    setGeneratingAvatar(false);
    setProgress("正在压缩照片…");
    setPhotoDataUrl(null);
    setPhotoName("");
    void preparePortrait(file).then((dataUrl) => {
      if (version !== generationVersion.current) return;
      photoDataRef.current = dataUrl;
      setPhotoDataUrl(dataUrl);
      setPhotoName(file.name);
      setProgress("");
    }).catch((cause) => {
      if (version !== generationVersion.current) return;
      setError(cause instanceof Error ? cause.message : "照片读取失败，请重新选择。");
      setProgress("");
    });
  };

  const clearPhoto = () => {
    generationVersion.current++;
    pixelAvatarRequest.current?.abort();
    setPixelArtwork(null);
    photoDataRef.current = null;
    void generationApi.cancelSavedGeneration();
    setPhotoDataUrl(null);
    setPhotoName("");
    setGeneratingAvatar(false);
    setProgress("");
    setGenerated((previous) => {
      if (!previous?.heroArtwork) return previous;
      const { heroArtwork: _ignored, ...withoutArtwork } = previous;
      return withoutArtwork;
    });
  };

  const showResult = (config: DesignConfig) => {
    if (!isRenderableConfig(config)) {
      setError("生成结果缺少完整作品配置，请重试。");
      setPhase("quiz");
      return;
    }
    setGenerated(config);
    setPixelArtwork(null);
    setShare(null);
    setShareSnapshot("");
    setResultError("");
    setPaymentIntent(null);
    setPhase("result");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const runAvatarGeneration = async (sourceConfig: DesignConfig, preserveEdits: boolean) => {
    if (!photoDataUrl) return;
    const sourcePhoto = photoDataRef.current;
    const version = ++generationVersion.current;
    const { heroArtwork: _oldArtwork, ...baseConfig } = sourceConfig;
    pixelAvatarRequest.current?.abort();
    const controller = new AbortController();
    pixelAvatarRequest.current = controller;
    setGeneratingAvatar(true);
    setError("");
    setProgress("已提交肖像生成任务，正在应用网站模板的头像风格…");
    try {
      const pixel = "templateId" in baseConfig && baseConfig.templateId === "pixel-world-v1";
      const heroArtwork = pixel
        ? await generationApi.generatePixelAvatar(photoDataUrl, baseConfig, controller.signal)
        : await generationApi.generateAvatar(photoDataUrl, baseConfig);
      if (controller.signal.aborted || version !== generationVersion.current || sourcePhoto !== photoDataRef.current) return;
      if (pixel) {
        setPixelArtwork(heroArtwork);
      } else if (preserveEdits) {
        setGenerated((previous) => ({ ...(previous ?? baseConfig), heroArtwork }));
        setShare(null);
        setShareSnapshot("");
        setResultError("");
      } else {
        showResult({ ...baseConfig, heroArtwork });
      }
    } catch (cause) {
      if (controller.signal.aborted || version !== generationVersion.current) return;
      setError(cause instanceof Error ? cause.message : "肖像生成失败，请重试。");
    } finally {
      if (pixelAvatarRequest.current === controller) pixelAvatarRequest.current = null;
      if (version === generationVersion.current) {
        setProgress("");
        setGeneratingAvatar(false);
      }
    }
  };

  const generate = async () => {
    if ((!draft && !agentDraft) || !selectedTemplate || (!agentDraft && !isAssessmentComplete(answers))) return;
    const portrait = selectedTemplate !== "pixel-world-v1" && avatarDemo && photoDataUrl ? { dataUrl: photoDataUrl } : undefined;
    if (selectedTemplate !== "pixel-world-v1" && photoDataUrl && !TEMPLATE_PORTRAIT_POLICIES[selectedTemplate]) {
      setError("当前模板暂不支持照片生成，请移除照片或选择赛博科技。");
      return;
    }
    let confirmation: { problems: string[]; content?: ResumeContent };
    try {
      confirmation = agentDraft ? { problems: [], content: projectConfirmedResumeV3(agentDraft) }
        : workflowSkills.runSync("resume.confirm.v3", { draft },
          { runtime: "browser", capabilities: { validateResumeDraft, toResumeContent } }) as
          { problems: string[]; content?: ResumeContent };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请重新确认简历内容。");
      return;
    }
    if (confirmation.problems.length || !confirmation.content) {
      setError(confirmation.problems.slice(0, 3).join("；") || "请重新确认简历内容。");
      return;
    }
    const content = confirmation.content;
    const sourcePhoto = portrait ? photoDataRef.current : null;
    const version = ++generationVersion.current;
    void generationApi.cancelSavedGeneration();
    setGeneratingAvatar(true);
    setError("");
    setProgress(portrait ? "正在上传肖像，准备 Agent 工作流…" : "正在提交 Agent 工作流…");
    try {
      const result = await generationApi.generatePortfolio(agentDraft
        ? { resumeId: agentDraft.resumeId, revision: agentDraft.revision, role, templateId: selectedTemplate }
        : { role, answers, content },
        portrait,
        (status) => {
          if (version === generationVersion.current) setProgress(agentStatusText(status));
        });
      if (version !== generationVersion.current || (sourcePhoto && sourcePhoto !== photoDataRef.current)) return;
      if (!isRenderableConfig(result.config)) throw new Error("生成任务返回的作品配置不完整，请重试。");
      if (result.projectId) { setProjectId(result.projectId); setProjectPaid(result.projectPaid ?? false); }
      setResultResumeId(result.projectId ? result.resumeId ?? null : result.resumeId ?? agentDraft?.resumeId ?? null);
      void paymentApi.projects().then(setProjects).catch(()=>{});
      showResult({ ...result.config, ...(result.heroArtwork ? { heroArtwork: result.heroArtwork } : {}) });
      if (selectedTemplate === "pixel-world-v1" && pixelAvatarEnabled && photoDataUrl) {
        await runAvatarGeneration(result.config, true);
      }
    } catch (cause) {
      if (version !== generationVersion.current) return;
      setError(cause instanceof Error ? cause.message : "作品生成失败，请重试。");
    } finally {
      if (version === generationVersion.current) {
        setProgress("");
        setGeneratingAvatar(false);
      }
    }
  };

  const editGenerated = (update: (current: DesignConfig) => DesignConfig) => {
    setGenerated((previous) => previous ? update(previous) : previous);
    setResultError("");
  };

  const saveProject = async (): Promise<OwnedProject> => {
    if (!generated) throw new Error("请先生成作品。");
    const version = generationVersion.current;
    const published = toPublishedConfig(await inlineConfigImages(generated));
    const current = projectId ? await paymentApi.project(projectId) : null;
    const project = current
      ? JSON.stringify(current.config) === JSON.stringify(published) ? current : await paymentApi.updateProject(current.id, published)
      : resultResumeId ? await paymentApi.createProject(published, resultResumeId) : await paymentApi.createProject(published);
    if (version === generationVersion.current) {
      setProjectId(project.id);
      setProjectPaid(project.paid);
      setResultResumeId(project.resumeId ?? null);
      setSavedConfig(generated);
    }
    void paymentApi.projects().then(setProjects).catch(() => {});
    return project;
  };

  const saveDraft = async () => {
    if (!generated || exporting) return;
    const version = generationVersion.current;
    setExporting(true);
    setResultError("");
    try {
      await saveProject();
    } catch (cause) {
      if (version === generationVersion.current) {
        setResultError(cause instanceof Error ? cause.message : "草稿保存失败，请重试。");
      }
    } finally {
      setExporting(false);
    }
  };

  const syncShares = async (id: string) => {
    const links = await paymentApi.shares(id);
    setSavedShares(links.map((link) => ({
      id: link.token,
      url: `${window.location.origin}/#share=${link.token}`,
      expiresAt: link.expires_at
    })));
  };

  const deliver = async (id: string, action: DeliveryAction, config: DesignConfig) => {
    if (action === "share") {
      const next = await paymentApi.publish(id);
      setShare({
        id: next.token,
        url: next.url.startsWith("http") ? next.url : `${window.location.origin}/#share=${next.token}`,
        expiresAt: next.expiresAt
      });
      setShareSnapshot(JSON.stringify(config));
      await syncShares(id);
    } else {
      const download = await paymentApi.export(id);
      const response = await fetch(download.url, { credentials: "same-origin" });
      if (!response.ok) throw new Error("导出文件生成失败，请重试。");
      const url = URL.createObjectURL(await response.blob());
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "buildurprofile-site.html";
        document.body.append(link);
        link.click();
        link.remove();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
  };

  const requestDelivery = async (action: DeliveryAction, confirmed = false) => {
    if (!generated || exporting) return;
    if (action === "share") {
      setPaymentIntent(action);
      if (!confirmed) setRestoredDelivery(false);
      setPhase("delivery");
      if (!confirmed) return;
    }
    setExporting(true);
    setResultError("");
    try {
      const project = await saveProject();
      if (action === "export") {
        await deliver(project.id, action, generated);
        return;
      }
      const checked = !project.paid && project.pendingAmountFen ? await paymentApi.reconcile(project.id) : project;
      setProjectPaid(checked.paid);
      if (checked.paid) {
        await deliver(project.id, action, generated);
      } else {
        const currentOffer = await paymentApi.offer();
        setOffer(currentOffer);
        setQuotedAmountYuan(checked.pendingAmountFen ? (checked.pendingAmountFen / 100).toFixed(2) : currentOffer.priceYuan);
      }
    } catch (cause) {
      setResultError(cause instanceof Error ? cause.message : "作品保存失败，请重试。");
    } finally {
      setExporting(false);
    }
  };

  const startPayment = async () => {
    if (!projectId || !paymentIntent || exporting) return;
    setExporting(true);
    setResultError("");
    try {
      const project = await saveProject();
      const result = await paymentApi.checkout(project.id, paymentIntent);
      if (result.alreadyPaid) {
        setProjectPaid(true);
        await deliver(project.id, paymentIntent, generated!);
      } else {
        if (result.amountYuan !== quotedAmountYuan) {
          setQuotedAmountYuan(result.amountYuan ?? null);
          throw new Error("订单金额已更新，请确认当前价格后重试。");
        }
        if (!result.paymentHtml) throw new Error("支付宝支付表单缺失。");
        if (!offer?.mode) throw new Error("支付宝支付环境未配置。");
        submitAlipayForm(result.paymentHtml, offer.mode);
      }
    } catch (cause) {
      setResultError(cause instanceof Error ? cause.message : "启动支付失败，请重试。");
    } finally {
      setExporting(false);
    }
  };

  const checkEntitlement = async () => {
    if (!generated || !paymentIntent || exporting) return;
    setExporting(true);
    setResultError("");
    try {
      const project = await saveProject();
      const checked = await paymentApi.reconcile(project.id);
      setProjectId(checked.id);
      setProjectPaid(checked.paid);
      const currentOffer = await paymentApi.offer();
      setOffer(currentOffer);
      setQuotedAmountYuan(checked.pendingAmountFen ? (checked.pendingAmountFen / 100).toFixed(2) : currentOffer.priceYuan);
      if (!checked.paid) {
        setResultError("尚未检测到当前项目的有效权益，请先完成支付。");
        return;
      }
      await deliver(checked.id, paymentIntent, generated);
    } catch (cause) {
      setResultError(cause instanceof Error ? cause.message : "权益检查失败，请重试。");
    } finally {
      setExporting(false);
    }
  };

  const resumeProject = (project: OwnedProject) => {
    if (!isRenderableConfig(project.config)) {
      setError("该项目的作品配置不完整，无法继续编辑。");
      return;
    }
    generationVersion.current++;
    pixelAvatarRequest.current?.abort();
    setGeneratingAvatar(false);
    setPixelArtwork(null);
    pdfVersion.current++;
    void generationApi.cancelSavedGeneration();
    if (project.id !== projectId) {
      setDraft(null);
      setAgentDraft(null);
      setConfirmedContent(null);
    }
    setProgress("");
    setError("");
    setResultError("");
    setProjectId(project.id);
    setProjectPaid(project.paid);
    setGenerated(project.config);
    setSavedConfig(project.config);
    setRestoredDelivery(false);
    setResultResumeId(project.resumeId ?? null);
    setPaymentIntent(null);
    setShare(null);
    setShareSnapshot("");
    setPhase("result");
    void syncShares(project.id).catch(() => {});
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const deleteProject = async (project: OwnedProject) => {
    await paymentApi.deleteProject(project.id);
    setProjects((previous) => previous.filter((item) => item.id !== project.id));
    if (projectId !== project.id) return;
    pdfVersion.current++;
    generationVersion.current++;
    void generationApi.cancelSavedGeneration();
    photoDataRef.current = null;
    setSelectedFile(null);
    setFileName("");
    setDraft(null);
    setAgentDraft(null);
    setAnswers({});
    setConfirmedContent(null);
    setSelectedTemplate(null);
    setPhotoDataUrl(null);
    setPhotoName("");
    setGenerated(null);
    setResultResumeId(null);
    setProjectId(null);
    setProjectPaid(false);
    setShare(null);
    setSavedShares([]);
    setShareSnapshot("");
    setPaymentIntent(null);
    setProgress("");
    setError("");
    setResultError("");
    setPhase("landing");
  };

  const removeShare = async () => {
    if (!share || !projectId) return;
    try {
      await paymentApi.revoke(projectId, share.id);
      setShare(null);
      setShareSnapshot("");
      await syncShares(projectId);
      setResultError("");
    } catch (cause) {
      setResultError(cause instanceof Error ? cause.message : "删除分享链接失败，请重试。");
    }
  };

  const copyShare = async () => {
    if (!share || !projectId) return;
    try {
      const [project, links] = await Promise.all([paymentApi.project(projectId), paymentApi.shares(projectId)]);
      if (!project.paid || !links.some((link) => link.token === share.id)) {
        setShare(null);
        throw new Error("当前分享链接已失效，请重新发布。");
      }
      if (!navigator.clipboard?.writeText) throw new Error("当前浏览器无法自动复制，请选中链接手动复制。");
      await navigator.clipboard.writeText(share.url);
      setResultError("");
    } catch (cause) {
      setResultError(cause instanceof Error ? cause.message : "复制失败，请选中链接手动复制。");
    }
  };

  const removeSavedShare = async (id: string) => {
    if (!projectId) return;
    try {
      await paymentApi.revoke(projectId, id);
      await syncShares(projectId);
      if (share?.id === id) {
        setShare(null);
        setShareSnapshot("");
      }
      setError("");
      setResultError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "删除分享链接失败，请重试。";
      setError(message);
      setResultError(message);
    }
  };

  if (shareView.requested) {
    if (shareView.loading) return <div className="share-unavailable proof-share-unavailable"><p>正在读取分享作品…</p></div>;
    if (shareView.config) return <ShowcasePage config={shareView.config} resolveResumeImage={id=>`/api/shares/${encodeURIComponent(shareToken() ?? "")}/media/${encodeURIComponent(id)}`} preserveShareHash touchDowngraded={isTouch} />;
    return <div className="share-unavailable proof-share-unavailable">
      <div className="builder-brand"><span>b<span>u</span>.</span><strong>BUILD YOUR PROFILE</strong></div>
      <h1>分享链接已失效</h1>
      <p>链接可能已过期或被发布者撤销。</p>
      <button className="proof-button proof-button--primary" onClick={() => {
        window.history.replaceState(null, "", "/");
        setShareView({ requested: false, config: null, loading: false });
        setPhase("landing");
      }}>返回生成器 →</button>
    </div>;
  }

  return <BuilderExperience
    phase={phase}
    fileName={fileName}
    selectedFile={selectedFile}
    progress={progress}
    error={error}
    draft={draft}
    hasConfirmedResume={Boolean(agentDraft)}
    confirmedContent={confirmedContent}
    styleResumeId={styleResumeId}
    resultResumeId={resultResumeId}
    role={role}
    selectedTemplate={selectedTemplate}
    generated={generated}
    projectId={projectId}
    projectPaid={projectPaid}
    isTouch={isTouch}
    share={share}
    savedShares={savedShares}
    projects={projects}
    offer={offer}
    quotedAmountYuan={quotedAmountYuan}
    paymentIntent={paymentIntent}
    restoredDelivery={restoredDelivery}
    draftSaved={Boolean(generated && generated === savedConfig)}
    shareSnapshot={shareSnapshot}
    resultError={resultError}
    exporting={exporting}
    photoDataUrl={photoDataUrl}
    photoName={photoName}
    generatingAvatar={generatingAvatar}
    avatarDemo={avatarDemo}
    pixelAvatarEnabled={pixelAvatarEnabled}
    pixelArtwork={pixelArtwork ?? null}
    onPhaseChange={setPhase}
    onSelectFile={selectFile}
    onParseFile={() => void parseSelectedFile()}
    onPhoto={onPhoto}
    onClearPhoto={clearPhoto}
    onUpdateSingle={updateSingle}
    onUpdateGroup={updateGroup}
    onReclassify={reclassify}
    onConfirm={confirm}
    onRoleChange={setRole}
    onApplyAnswers={setAnswers}
    onSelectTemplate={setSelectedTemplate}
    onGenerate={() => void generate()}
    onRunAvatarGeneration={() => { if (generated) void runAvatarGeneration(generated, true); }}
    onEditGenerated={editGenerated}
    onSaveDraft={() => void saveDraft()}
    onRequestDelivery={(action) => void requestDelivery(action)}
    onGitHubPages={offer?.githubPagesEnabled ? () => setGitHubDialog({ paymentReturn: false, deployment: null }) : undefined}
    githubPagesDialog={githubDialog && generated && <GitHubPagesDialog
      projectId={projectId} paid={projectPaid} offer={offer} pixel={"templateId" in generated && generated.templateId === "pixel-world-v1"}
      paymentReturn={githubDialog.paymentReturn} initialDeployment={githubDialog.deployment}
      saveProject={saveProject} onPaid={() => setProjectPaid(true)} onClose={() => {
        if (new URLSearchParams(window.location.search).has("github_deployment")) {
          window.history.replaceState(null, "", "/#work");
        }
        setGitHubDialog(null);
      }} />}
    onConfirmPublish={() => void requestDelivery("share", true)}
    onStartPayment={() => void startPayment()}
    onCheckEntitlement={() => void checkEntitlement()}
    onResumeProject={resumeProject}
    onDeleteProject={deleteProject}
    onCopyShare={() => void copyShare()}
    onRemoveShare={() => void removeShare()}
    onRemoveSavedShare={(id) => void removeSavedShare(id)}
    onRestartQuiz={() => {
      if (resultResumeId && styleResumeId !== resultResumeId) {
        window.location.assign(`/style/${encodeURIComponent(resultResumeId)}`);
        return;
      }
      setError("");
      setPhase("quiz");
      window.scrollTo({ top: 0, behavior: "instant" });
    }}
  />;
}
