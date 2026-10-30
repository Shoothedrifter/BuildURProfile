import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { DesignConfig, JobRole } from "../../../packages/contracts/src/config";
import rawConfig from "./demo/config.json";
import { ShowcasePage } from "./ShowcasePage";
import { EditorPanel } from "./components/EditorPanel";
import { QUESTIONS, isAssessmentComplete, scoreAnswers } from "./lib/assessment";
import { inlineConfigImages } from "./lib/export";
import { styleToConfig } from "./lib/mapping";
import { extractPdfText } from "./lib/pdf";
import { parseResumePages, skillShortLabels, toResumeContent, validateResumeDraft } from "./lib/resume";
import type { DraftField, ResumeDraft } from "./lib/resume";
import { paymentApi, submitAlipayForm } from "./lib/paymentApi";
import type { Offer, OwnedProject } from "./lib/paymentApi";
import { toPublishedConfig } from "./lib/publication";

type Phase = "upload" | "confirm" | "quiz" | "result" | "mock";
type DraftGroup = "workExperience" | "projects" | "skills" | "education";

const groups: { key: DraftGroup; title: string; hint: string }[] = [
  { key: "workExperience", title: "工作经历", hint: "任职、职责与成果" },
  { key: "projects", title: "项目", hint: "仅保留 PDF 原文可核查的项目" },
  { key: "skills", title: "技能", hint: "技术、工具与方法" },
  { key: "education", title: "教育", hint: "学校、学位与学习经历" }
];
const roles: { value: JobRole; label: string }[] = [
  { value: "ui-ux-designer", label: "UI / UX 设计师" },
  { value: "frontend-creative-developer", label: "前端 / 创意开发" },
  { value: "brand-motion-copy", label: "品牌 / 动效 / 文案" }
];

function confirmationGroupTitle(key: DraftGroup, title: string, entries: DraftField[]): string {
  return key === "workExperience" && entries.some((entry) => entry.experienceKind === "campus")
    ? "工作 / 校园经历"
    : title;
}

function confirmationEntryTitle(key: DraftGroup, title: string, entry: DraftField): string {
  return key === "workExperience" && entry.experienceKind === "campus" ? "校园经历" : title;
}

function touchInput(): boolean {
  // Touch: keep card controls manual while replacing scroll-driven marquee motion with a constant loop.
  return typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 ||
    (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) || false);
}

function shareToken(): string | null {
  const match = /^#share=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
  return match?.[1] ?? null;
}

function touchSafe(config: DesignConfig): DesignConfig {
  // Touch readers keep manual card controls while marquee motion becomes a constant loop.
  return {
    ...config,
    marquee: { ...config.marquee, bindToScroll: false, pauseOnHover: false },
    stackedCards: { ...config.stackedCards, enableTilt: false, autoPlay: false }
  };
}

export default function App() {
  const staticPreview = import.meta.env.MODE === "pages";
  const [shareView, setShareView] = useState<{ requested: boolean; config: DesignConfig | null; loading: boolean }>(
    () => ({ requested: !staticPreview && window.location.hash.startsWith("#share="), config: null,
      loading: !staticPreview && window.location.hash.startsWith("#share=") }));
  const [phase, setPhase] = useState<Phase>("upload");
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const [role, setRole] = useState<JobRole>("frontend-creative-developer");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [generated, setGenerated] = useState<DesignConfig | null>(null);
  const [resultTab, setResultTab] = useState<"json" | "preview">("json");
  const [isTouch, setIsTouch] = useState(touchInput);
  const [share, setShare] = useState<{ id: string; url: string; expiresAt: number } | null>(null);
  const [savedShares, setSavedShares] = useState<Array<{ id: string; url: string; expiresAt: number }>>([]);
  const [projects, setProjects] = useState<OwnedProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [quotedAmountYuan, setQuotedAmountYuan] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<"share" | "export" | null>(null);
  const [shareSnapshot, setShareSnapshot] = useState("");
  const [resultError, setResultError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (staticPreview) return;
    let sequence = 0;
    const onHashChange = () => {
      const current = ++sequence;
      const token = shareToken();
      if (!window.location.hash.startsWith("#share=")) { setShareView({ requested: false, config: null, loading: false }); return; }
      setShareView({ requested: true, config: null, loading: true });
      if (!token) { setShareView({ requested: true, config: null, loading: false }); return; }
      void paymentApi.readShare(token).then((value) => {
        if (current === sequence) setShareView({ requested: true, config: value.config, loading: false });
      }).catch(() => { if (current === sequence) setShareView({ requested: true, config: null, loading: false }); });
    };
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => { sequence++; window.removeEventListener("hashchange", onHashChange); };
  }, [staticPreview]);

  useEffect(() => {
    if (staticPreview) return;
    void paymentApi.offer().then(setOffer).catch(() => {});
    void paymentApi.projects().then(setProjects).catch(() => {});
  }, [staticPreview]);

  useEffect(() => {
    if (staticPreview) return;
    if (window.location.pathname !== "/payment/return") return;
    const id = new URLSearchParams(window.location.search).get("project_id");
    window.history.replaceState(null, "", "/#work");
    if (!id) return;
    void (async () => {
      let project: OwnedProject;
      let queryError = "";
      try { project = await paymentApi.reconcile(id); }
      catch (cause) {
        queryError = cause instanceof Error ? cause.message : "支付状态查询失败，请稍后重试。";
        try { project = await paymentApi.project(id); }
        catch { setError(queryError); return; }
      }
      setProjectId(id); setGenerated(project.config); setPhase("result");
      void paymentApi.projects().then(setProjects).catch(() => {});
      if (queryError) { setResultError(`${queryError}。作品草稿已保留，请重试原操作。`); return; }
      if (!project.paid) { setResultError("付款尚未确认。作品草稿已保留，稍后可重试或再次查单。"); return; }
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
  }, [staticPreview]);

  useEffect(() => {
    const onTouch = () => setIsTouch(true);
    window.addEventListener("touchstart", onTouch, { passive: true, once: true });
    return () => window.removeEventListener("touchstart", onTouch);
  }, []);

  useEffect(() => {
    if (!isTouch) return;
    setGenerated((previous) => previous ? {
      ...previous,
      marquee: { ...previous.marquee, bindToScroll: false, pauseOnHover: false },
      stackedCards: { ...previous.stackedCards, enableTilt: false, autoPlay: false }
    } : previous);
  }, [isTouch]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setProjectId(null); setShare(null); setSavedShares([]);
    setError("");
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("请选择 PDF 文件。");
      return;
    }
    setFileName(file.name);
    setProgress("正在读取 PDF…");
    try {
      const extracted = await extractPdfText(file, (done, total) => setProgress(`正在读取第 ${done} / ${total} 页…`));
      if (!extracted.text.trim()) throw new Error("这份 PDF 没有可提取文本。当前版本暂不支持扫描件 OCR。");
      const nextDraft = parseResumePages(extracted.pages);
      if (!nextDraft.name.value || (!nextDraft.projects.length && !nextDraft.workExperience.length)) {
        throw new Error("PDF 文本已提取，但未能自动识别简历章节。请检查排版或换一份带清晰章节标题的 PDF。");
      }
      setDraft(nextDraft);
      setProgress("");
      setPhase("confirm");
    } catch (cause) {
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
  const confirm = () => {
    if (!draft) return;
    const problems = validateResumeDraft(draft);
    if (problems.length) {
      setError(problems.slice(0, 3).join("；"));
      return;
    }
    setError("");
    setPhase("quiz");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const generate = () => {
    if (!draft || !isAssessmentComplete(answers)) return;
    const vector = scoreAnswers(answers);
    const mapped = styleToConfig(vector, role);
    const content = toResumeContent(draft);
    const config: DesignConfig = {
      ...mapped,
      marquee: {
        ...mapped.marquee,
        ...(isTouch ? { bindToScroll: false, pauseOnHover: false } : {}),
        items: skillShortLabels(content.expertise.skills)
      },
      stackedCards: isTouch ? { ...mapped.stackedCards, enableTilt: false, autoPlay: false } : mapped.stackedCards,
      content
    };
    setGenerated(config);
    setShare(null);
    setShareSnapshot("");
    setResultError("");
    setResultTab("json");
    setPhase("result");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const editGenerated = (update: (current: DesignConfig) => DesignConfig) => {
    setGenerated((previous) => previous ? update(previous) : previous);
    setResultTab("preview");
    setResultError("");
  };
  const saveProject = async (): Promise<OwnedProject> => {
    if (!generated) throw new Error("请先生成作品。");
    const published = toPublishedConfig(await inlineConfigImages(generated));
    const current = projectId ? await paymentApi.project(projectId) : null;
    const project = current
      ? JSON.stringify(current.config) === JSON.stringify(published) ? current : await paymentApi.updateProject(projectId!, published)
      : await paymentApi.createProject(published);
    setProjectId(project.id);
    setProjects(await paymentApi.projects());
    return project;
  };
  const syncShares = async (id: string) => {
    const links = await paymentApi.shares(id);
    setSavedShares(links.map((link) => ({ id: link.token, url: `${window.location.origin}/#share=${link.token}`, expiresAt: link.expires_at })));
  };
  const deliver = async (id: string, action: "share" | "export", config: DesignConfig) => {
    if (action === "share") {
      const next = await paymentApi.publish(id);
      setShare({ id: next.token, url: next.url.startsWith("http") ? next.url : `${window.location.origin}/#share=${next.token}`,
        expiresAt: next.expiresAt });
      setShareSnapshot(JSON.stringify(config));
      await syncShares(id);
    } else {
      const download = await paymentApi.export(id);
      const link = document.createElement("a");
      link.href = download.url;
      link.download = "buildurprofile-site.zip";
      document.body.append(link); link.click(); link.remove();
    }
  };
  const requestDelivery = async (action: "share" | "export") => {
    if (!generated || exporting) return;
    setExporting(true); setResultError("");
    try {
      const project = await saveProject();
      const checked = !project.paid && project.pendingAmountFen ? await paymentApi.reconcile(project.id) : project;
      if (checked.paid) await deliver(project.id, action, generated);
      else {
        const currentOffer = await paymentApi.offer();
        setOffer(currentOffer);
        setQuotedAmountYuan(checked.pendingAmountFen ? (checked.pendingAmountFen / 100).toFixed(2) : currentOffer.priceYuan);
        setPaymentIntent(action);
      }
    } catch (cause) {
      setResultError(cause instanceof Error ? cause.message : "作品保存失败，请重试。");
    } finally { setExporting(false); }
  };
  const startPayment = async () => {
    if (!projectId || !paymentIntent) return;
    setExporting(true); setResultError("");
    try {
      const project = await saveProject();
      const result = await paymentApi.checkout(project.id, paymentIntent);
      if (result.alreadyPaid) {
        setPaymentIntent(null);
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
    } finally { setExporting(false); }
  };
  const removeShare = async () => {
    if (!share || !projectId) return;
    try {
      await paymentApi.revoke(projectId, share.id);
      setShare(null); setShareSnapshot(""); await syncShares(projectId); setResultError("");
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
  const savedShareList = savedShares.length > 0 && <section className="saved-shares" aria-labelledby="saved-shares-heading"><div><h2 id="saved-shares-heading">已发布链接</h2><p>服务端保存，默认 7 天后失效。项目已付费可重新发布。</p></div><ul>{savedShares.map((saved) => <li key={saved.id}><div><strong>{saved.id.slice(0, 12)}…</strong><span>有效至 {new Date(saved.expiresAt).toLocaleString("zh-CN")}</span></div><a href={saved.url} target="_blank" rel="noopener noreferrer">打开分享 ↗</a><button type="button" aria-label={"删除分享 " + saved.id} onClick={() => void removeSavedShare(saved.id)}>删除</button></li>)}</ul></section>;

  if (shareView.requested) {
    return shareView.loading ? <div className="share-unavailable"><p>正在读取分享作品…</p></div> : shareView.config
      ? <ShowcasePage config={isTouch ? touchSafe(shareView.config) : shareView.config} preserveShareHash touchDowngraded={isTouch} />
      : <div className="share-unavailable"><div className="builder-brand"><span>b<span>u</span>.</span><strong>BUILD YOUR PROFILE</strong></div><h1>分享链接已失效</h1><p>链接可能已过期或被发布者撤销。</p><a className="primary-button" href="#work" onClick={() => { window.location.hash = "work"; window.location.reload(); }}>返回生成器 <span>↗</span></a></div>;
  }

  if (phase === "mock") return <div><button className="back-to-builder" type="button" onClick={() => setPhase("upload")}>← 返回生成器</button><ShowcasePage config={rawConfig as DesignConfig} allowSkinSwitch /></div>;

  return <div className="builder-page">
    <header className="builder-header"><div className="builder-brand"><span>b<span>u</span>.</span><strong>BUILD YOUR PROFILE</strong></div><span className="builder-header-note">PDF → JSON → SHOWCASE</span></header>
    <main className="builder-main">
      <div className="builder-progress" aria-label="生成进度"><span className={phase === "upload" ? "active" : "done"}>01 上传</span><i /><span className={phase === "confirm" ? "active" : phase === "upload" ? "" : "done"}>02 确认</span><i /><span className={phase === "quiz" ? "active" : phase === "result" ? "done" : ""}>03 测评</span><i /><span className={phase === "result" ? "active" : ""}>04 生成</span></div>

      {phase === "upload" && <section className="builder-intro">
        <div className="intro-kicker">YOUR WORK, IN MOTION <span>✳</span></div>
        <h1>让简历成为<br /><em>可探索的作品集。</em></h1>
        <p className="intro-lede">上传一份可选中文本的 PDF，先确认提取内容，再用 8 个选择决定视觉与互动方式。</p>
        <div className="upload-grid">
          <label className="upload-card"><span className="upload-icon">↗</span><strong>选择 PDF 简历</strong><small>PDF 只在浏览器内存中读取，不上传服务器</small><input aria-label="选择 PDF 简历" type="file" accept=".pdf,application/pdf" onChange={onFile} /></label>
          <div className="upload-side"><span className="side-number">01 / 04</span><h2>先核对事实。<br />再决定风格。</h2><p>姓名、工作经历、项目、技能和教育都能在下一步修改。展示内容保留原文出处。</p><button type="button" className="ghost-button" onClick={() => setPhase("mock")}>查看视觉样例 ↗</button></div>
        </div>
        {progress && <p className="builder-status" role="status">{progress}</p>}
        {projects.length > 0 && <section className="saved-shares"><div><h2>我的作品草稿</h2><p>草稿与付款资格绑定到当前浏览器的服务端匿名会话。</p></div><ul>{projects.map((project) => <li key={project.id}><div><strong>{project.config.content.profile.name || "未命名作品"}</strong><span>{project.paid ? "已解锁分享与导出" : "未付款 · 可继续编辑"}</span></div><button type="button" onClick={() => {
          setProjectId(project.id); setGenerated(project.config); setPhase("result"); setShare(null);
          void syncShares(project.id);
        }}>继续编辑 ↗</button></li>)}</ul></section>}
      </section>}

      {phase === "confirm" && draft && <section className="builder-stage">
        <div className="stage-heading"><div><p className="stage-kicker">02 / CONFIRM THE FACTS</p><h1>确认并修正<br /><em>简历内容。</em></h1></div><p>已从 <strong>{fileName}</strong> 提取。这里的每一项都附有 PDF 原文，修改后才会进入展示页。</p></div>
        <div className="identity-grid"><label className="input-field"><span>姓名</span><input aria-label="姓名" value={draft.name.value} onChange={(event) => updateSingle("name", event.target.value)} /></label><label className="input-field"><span>邮箱</span><input aria-label="邮箱" value={draft.email.value} onChange={(event) => updateSingle("email", event.target.value)} /></label></div>
        <div className="source-inline">姓名原文 · 第 {draft.name.page} 页：{draft.name.source}</div>
        {groups.map((group) => <section className="confirm-group" key={group.key} aria-labelledby={`group-${group.key}`}><div className="confirm-group-heading"><div><span>/{group.key.toUpperCase()}</span><h2 id={`group-${group.key}`}>{confirmationGroupTitle(group.key, group.title, draft[group.key])} <small>{draft[group.key].length}</small></h2></div><p>{group.hint}</p></div>{draft[group.key].map((entry, index) => <div className="confirm-entry" key={`${group.key}-${index}`}><div className="confirm-entry-top"><label className="include-control"><input type="checkbox" checked={entry.included} onChange={(event) => updateGroup(group.key, index, { included: event.target.checked })} />用于展示</label><span>PDF · 第 {entry.page} 页</span></div><label className="input-field"><span>{confirmationEntryTitle(group.key, group.title, entry)} {index + 1}</span><textarea aria-label={`${confirmationEntryTitle(group.key, group.title, entry)} ${index + 1}`} rows={Math.min(8, Math.max(3, entry.value.split("\n").length + 1))} value={entry.value} disabled={!entry.included} onChange={(event) => updateGroup(group.key, index, { value: event.target.value })} /></label><details className="source-detail"><summary>查看 PDF 原文 ↗</summary><pre>{entry.source}</pre></details></div>)}</section>)}
        <div className="stage-actions"><p>可删减内容、调整空格和标点；项目标题及数字须与原文一致。</p><button type="button" className="primary-button" onClick={confirm}>确认内容，进入测评 <span>↗</span></button></div>
      </section>}

      {phase === "quiz" && <section className="builder-stage"><div className="stage-heading"><div><p className="stage-kicker">03 / YOUR STYLE VECTOR</p><h1>8 个选择，<br /><em>找到你的节奏。</em></h1></div><p>回答会转换为 E / K / P / S 四维分数，并直接映射到皮肤、跑马灯和堆叠卡片参数。</p></div>
        <div className="role-select"><label htmlFor="job-role">展示方向</label><select id="job-role" value={role} onChange={(event) => setRole(event.target.value as JobRole)}>{roles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        <div className="quiz-list">{QUESTIONS.map((question, index) => <fieldset className="quiz-question" key={question.id}><legend><span>{String(index + 1).padStart(2, "0")}</span>{question.prompt}</legend><div className="quiz-options">{question.options.map((option, optionIndex) => <label key={optionIndex} className={answers[question.id] === optionIndex ? "quiz-option selected" : "quiz-option"}><input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={() => setAnswers((previous) => ({ ...previous, [question.id]: optionIndex }))} /><span>{option.label}</span><b aria-hidden="true">↗</b></label>)}</div></fieldset>)}</div>
        {isTouch && <p className="touch-note">检测到触屏：卡片改为手动切换，跑马灯恒定滚动。</p>}
        <div className="stage-actions"><p>已回答 {Object.keys(answers).length} / 8 题</p><button className="primary-button" type="button" disabled={!isAssessmentComplete(answers)} onClick={generate}>生成 Design Config <span>↗</span></button></div>
      </section>}

      {phase === "result" && generated && <section className="builder-stage result-stage"><div className="stage-heading"><div><p className="stage-kicker">04 / DESIGN CONFIG</p><h1>已生成，<br /><em>开始探索。</em></h1></div><p>{staticPreview ? "在编辑面板改文字、换图或调整交互强度，预览会实时更新。静态预览版不会保存作品；刷新后需重新上传 PDF。" : "在编辑面板改文字、换图或调整交互强度，预览会实时更新。分享与导出都使用当前配置。"}</p></div>
        <div className="result-stats"><span>SKIN <strong>{generated.skin}</strong></span><span>MARQUEE <strong>{generated.marquee.speed} px/s</strong></span><span>STACK DEPTH <strong>{generated.stackedCards.scaleStep}</strong></span><span>PROJECTS <strong>{generated.content.projects.length}</strong></span></div>
        {isTouch && <p className="touch-note">检测到触屏：卡片可手动切换，跑马灯恒定滚动。</p>}
        <div className="result-workspace">
          <EditorPanel config={generated} onChange={editGenerated} isTouch={isTouch} />
          <div className="result-display">
            <div className="result-toolbar"><div role="tablist" aria-label="结果视图"><button type="button" role="tab" aria-selected={resultTab === "json"} className={resultTab === "json" ? "selected" : ""} onClick={() => setResultTab("json")}>Design Config JSON</button><button type="button" role="tab" aria-selected={resultTab === "preview"} className={resultTab === "preview" ? "selected" : ""} onClick={() => setResultTab("preview")}>网页预览</button></div><div className="result-toolbar-actions"><button type="button" className="ghost-button" onClick={() => { setAnswers({}); setPhase("quiz"); }}>重新作答 ↗</button></div></div>
            <pre hidden={resultTab !== "json"} className="json-output" data-testid="design-config-json">{JSON.stringify(generated, null, 2)}</pre>
            <div hidden={resultTab !== "preview"} className="preview-frame"><ShowcasePage config={generated} /></div>
          </div>
        </div>
        {!staticPreview && <div className="publish-bar"><div><span>PUBLISH / 02</span><h2>分享或带走你的作品集</h2><p>正式分享与离线 ZIP 由同一项目的一次付款解锁。静态网站解压后可直接打开 index.html。</p></div><div className="publish-actions"><button type="button" className="ghost-button" disabled={exporting} onClick={() => void requestDelivery("share")}>{share ? "更新分享链接 ↗" : "发布并分享 ↗"}</button><button type="button" className="primary-button" disabled={exporting} onClick={() => void requestDelivery("export")}>{exporting ? "正在处理…" : "导出静态网站 ZIP"} <span>↓</span></button></div></div>}
        {!staticPreview && paymentIntent && <section className="share-card" role="region" aria-label="确认购买"><div><strong>解锁作品发布与导出</strong></div><p>{offer?.service ?? "正式托管分享与静态导出，一次解锁当前项目两项能力。"}</p><p>本项目价格：<strong>{quotedAmountYuan ? `¥${quotedAmountYuan}` : "服务端尚未配置价格"}</strong>。公开分享链接默认 7 天有效，可撤销；到期后同项目重新发布无需再次付款。已下载 ZIP 无法撤回。</p>{offer?.mode === "sandbox" && <p>沙箱测试：普通支付宝无法支付沙箱订单。请在电脑收银台使用沙箱买家账号和支付密码；扫码仅使用 Android 沙箱支付宝。</p>}{offer?.configurationError && <p role="alert">支付配置：{offer.configurationError}</p>}<div className="share-actions"><button type="button" onClick={() => setPaymentIntent(null)}>暂不付款，保留草稿</button><button type="button" disabled={!offer?.configured || exporting} onClick={() => void startPayment()}>{offer?.mode === "production" ? "前往支付宝收银台（正式付款）" : "前往支付宝沙箱收银台"} ↗</button></div></section>}
        {!staticPreview && share && <div className="share-card"><div><strong>正式链接已创建</strong><span>有效至 {new Date(share.expiresAt).toLocaleString("zh-CN")}</span></div><p>任何接收者可免费访问有效链接。链接到期或被撤销后失效。</p>{shareSnapshot !== JSON.stringify(generated) && <p className="share-stale">预览已更新。点击“更新分享链接”可同步当前版本。</p>}<label className="share-url"><span>分享链接</span><input readOnly value={share.url} onFocus={(event) => event.currentTarget.select()} /></label><div className="share-actions"><a href={share.url} target="_blank" rel="noopener noreferrer">在新标签页打开 ↗</a><button type="button" onClick={() => void copyShare()}>复制链接</button><button type="button" onClick={() => void removeShare()}>撤销链接</button></div></div>}
        {!staticPreview && savedShareList}
        {resultError && <p role="alert" className="builder-error">{resultError}</p>}
      </section>}

      {error && <p role="alert" className="builder-error">{error}</p>}
    </main>
    <footer className="builder-footer"><span>BUILD YOUR PROFILE / MVP</span><span>浏览器本地处理 · 不上传 PDF</span></footer>
  </div>;
}
