"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { DesignConfig, JobRole, ResumeContent } from "../../../packages/contracts/src/config";
import type { ResumeDraftV1 } from "../../../packages/contracts/src/resume-draft";
import { projectConfirmedResume } from "../../../packages/contracts/src/resume-draft";
import type { AvatarStyleId, GenerationStatus } from "./lib/generationApi";
import type { Offer, OwnedProject } from "./lib/paymentApi";
import type { DraftField, ResumeDraft } from "./lib/resume";
import type { DeliveryAction, DraftGroup, ReclassifyTarget } from "./components/BuilderExperience";
import type { WorkflowPhase } from "./components/BuilderChrome";
import { ShowcasePage } from "./ShowcasePage";
import { BuilderExperience } from "./components/BuilderExperience";
import { isAssessmentComplete } from "./lib/assessment";
import { inlineConfigImages } from "./lib/export";
import { extractPdfText } from "./lib/pdf";
import { parseResumePages, toResumeContent, validateResumeDraft } from "./lib/resume";
import { paymentApi, submitAlipayForm } from "./lib/paymentApi";
import { toPublishedConfig } from "./lib/publication";
import { generationApi } from "./lib/generationApi";
import { preparePortrait } from "./lib/portrait";
import { createDefaultSkillRegistry } from "../../../packages/skills/src/registry";
import { resumeApi } from "./lib/resumeApi";

const workflowSkills = createDefaultSkillRegistry();
const agentStatusText = (status: GenerationStatus): string => status === "QUEUED"
  ? "作品已排队，等待 Agent 工作流…"
  : status === "CANCELLING" ? "正在取消任务；已发出的图像请求可能无法撤回。" : "Agent 工作流正在生成作品…";

function touchInput(): boolean {
  return typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 ||
    (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) || false);
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

export default function App() {
  const avatarDemo = isAvatarDemoEnabled();
  const [shareView, setShareView] = useState<{ requested: boolean; config: DesignConfig | null; loading: boolean }>(() => {
    const hasShareHash = typeof window !== "undefined" && window.location.hash.startsWith("#share=");
    return { requested: hasShareHash, config: null, loading: hasShareHash };
  });
  const [phase, setPhase] = useState<WorkflowPhase>("landing");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const [agentDraft, setAgentDraft] = useState<ResumeDraftV1 | null>(null);
  const [role, setRole] = useState<JobRole>("frontend-creative-developer");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [generated, setGenerated] = useState<DesignConfig | null>(null);
  const [isTouch, setIsTouch] = useState(touchInput);
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
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState("");
  const [avatarStyle, setAvatarStyle] = useState<AvatarStyleId>("retro-flat-anime-head");
  const [generatingAvatar, setGeneratingAvatar] = useState(false);
  const generationVersion = useRef(0);
  const pdfVersion = useRef(0);
  const photoDataRef = useRef<string | null>(null);

  useEffect(() => {
    if (window.location.pathname === "/payment/return" || window.location.pathname.startsWith("/style/")) return;
    let active = true;
    const version = generationVersion.current;
    void generationApi.resumeGeneration((status) => {
      if (active && version === generationVersion.current) setProgress(agentStatusText(status));
    }).then((result) => {
      if (!active || version !== generationVersion.current || !result) return;
      if (!isRenderableConfig(result.config)) {
        setProgress("");
        setError("恢复的作品配置不完整，请重新生成。");
        setPhase("quiz");
        return;
      }
      setGenerated({ ...result.config, ...(result.heroArtwork ? { heroArtwork: result.heroArtwork } : {}) });
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
      setPaymentIntent(project.pendingAction);
      setPhase("delivery");
      void paymentApi.projects().then(setProjects).catch(() => {});
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
    const match = /^\/style\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname);
    if (!match) return;
    let active = true;
    setProgress("正在读取已确认的简历草稿…");
    void resumeApi.read(match[1]).then(({ draft: nextDraft }) => {
      projectConfirmedResume(nextDraft);
      if (!active) return;
      setAgentDraft(nextDraft);
      setProgress("");
      setPhase("quiz");
    }).catch((cause) => {
      if (!active) return;
      setProgress("");
      setError(cause instanceof Error ? cause.message : "读取简历草稿失败，请返回编辑页。");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
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
    setGenerated(null);
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
    setError("");
    const version = ++generationVersion.current;
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
    setGeneratingAvatar(true);
    setError("");
    setProgress("已提交肖像生成任务，正在应用所选风格…");
    try {
      const heroArtwork = await generationApi.generateAvatar(photoDataUrl, avatarStyle, baseConfig);
      if (version !== generationVersion.current || sourcePhoto !== photoDataRef.current) return;
      if (preserveEdits) {
        setGenerated((previous) => ({ ...(previous ?? baseConfig), heroArtwork }));
        setShare(null);
        setShareSnapshot("");
        setResultError("");
      } else {
        showResult({ ...baseConfig, heroArtwork });
      }
    } catch (cause) {
      if (version !== generationVersion.current) return;
      setError(cause instanceof Error ? cause.message : "肖像生成失败，请重试。");
    } finally {
      if (version === generationVersion.current) {
        setProgress("");
        setGeneratingAvatar(false);
      }
    }
  };

  const generate = async () => {
    if ((!draft && !agentDraft) || !isAssessmentComplete(answers)) return;
    let confirmation: { problems: string[]; content?: ResumeContent };
    try {
      confirmation = agentDraft ? { problems: [], content: projectConfirmedResume(agentDraft) }
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
    const sourcePhoto = photoDataRef.current;
    const version = ++generationVersion.current;
    void generationApi.cancelSavedGeneration();
    setGeneratingAvatar(true);
    setError("");
    setProgress(photoDataUrl ? "正在上传肖像，准备 Agent 工作流…" : "正在提交 Agent 工作流…");
    try {
      const result = await generationApi.generatePortfolio({ role, answers, content },
        avatarDemo && photoDataUrl ? { dataUrl: photoDataUrl, styleId: avatarStyle } : undefined,
        (status) => {
          if (version === generationVersion.current) setProgress(agentStatusText(status));
        });
      if (version !== generationVersion.current || (sourcePhoto && sourcePhoto !== photoDataRef.current)) return;
      if (!isRenderableConfig(result.config)) throw new Error("生成任务返回的作品配置不完整，请重试。");
      showResult({ ...result.config, ...(result.heroArtwork ? { heroArtwork: result.heroArtwork } : {}) });
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
    if (generated.heroArtwork) throw new Error("Wibi 肖像仅供本机预览，不能用于付费分享或导出。");
    const published = toPublishedConfig(await inlineConfigImages(generated));
    const current = projectId ? await paymentApi.project(projectId) : null;
    const project = current
      ? JSON.stringify(current.config) === JSON.stringify(published) ? current : await paymentApi.updateProject(projectId!, published)
      : await paymentApi.createProject(published);
    setProjectId(project.id);
    setProjectPaid(project.paid);
    setProjects(await paymentApi.projects());
    return project;
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
      const link = document.createElement("a");
      link.href = download.url;
      link.download = "buildurprofile-site.zip";
      document.body.append(link);
      link.click();
      link.remove();
    }
  };

  const requestDelivery = async (action: DeliveryAction) => {
    if (!generated || exporting) return;
    if (generated.heroArtwork) {
      setResultError("Wibi 肖像仅供本机预览，不能用于付费分享或导出。");
      return;
    }
    setPaymentIntent(action);
    setPhase("delivery");
    window.scrollTo({ top: 0, behavior: "instant" });
    setExporting(true);
    setResultError("");
    try {
      const project = await saveProject();
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
    if (!projectId || !paymentIntent) return;
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
    void generationApi.cancelSavedGeneration();
    setProgress("");
    setError("");
    setResultError("");
    setProjectId(project.id);
    setProjectPaid(project.paid);
    setGenerated(project.config);
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
    setAnswers({});
    setPhotoDataUrl(null);
    setPhotoName("");
    setGenerated(null);
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
    if (shareView.config) return <ShowcasePage config={shareView.config} preserveShareHash touchDowngraded={isTouch} />;
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
    role={role}
    answers={answers}
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
    shareSnapshot={shareSnapshot}
    resultError={resultError}
    exporting={exporting}
    photoDataUrl={photoDataUrl}
    photoName={photoName}
    avatarStyle={avatarStyle}
    generatingAvatar={generatingAvatar}
    avatarDemo={avatarDemo}
    onPhaseChange={setPhase}
    onSelectFile={selectFile}
    onParseFile={() => void parseSelectedFile()}
    onPhoto={onPhoto}
    onAvatarStyle={setAvatarStyle}
    onClearPhoto={clearPhoto}
    onUpdateSingle={updateSingle}
    onUpdateGroup={updateGroup}
    onReclassify={reclassify}
    onConfirm={confirm}
    onRoleChange={setRole}
    onAnswer={(questionId, optionIndex) => setAnswers((previous) => ({ ...previous, [questionId]: optionIndex }))}
    onApplyAnswers={setAnswers}
    onGenerate={() => void generate()}
    onRunAvatarGeneration={() => { if (generated) void runAvatarGeneration(generated, true); }}
    onEditGenerated={editGenerated}
    onRequestDelivery={(action) => void requestDelivery(action)}
    onStartPayment={() => void startPayment()}
    onCheckEntitlement={() => void checkEntitlement()}
    onResumeProject={resumeProject}
    onDeleteProject={deleteProject}
    onCopyShare={() => void copyShare()}
    onRemoveShare={() => void removeShare()}
    onRemoveSavedShare={(id) => void removeSavedShare(id)}
    onRestartQuiz={() => {
      setAnswers({});
      setError("");
      setPhase("quiz");
      window.scrollTo({ top: 0, behavior: "instant" });
    }}
  />;
}
