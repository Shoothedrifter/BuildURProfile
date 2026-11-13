"use client";

import { useEffect, useRef, useState } from "react";
import { projectConfirmedResume, RESUME_MODULE_MAPPING } from "../../../../../../packages/contracts/src/resume-draft";
import type { ResumeDraftItemV2, ResumeDraftSectionV2, ResumeDraftV2, ResumeModuleKind } from "../../../../../../packages/contracts/src/resume-draft";
import { validHttpUrl } from "../../../../../../packages/contracts/src/resume-v2.mjs";
import { resumeApi, type PendingResumeImage } from "../../../lib/resumeApi";
import { AgentChrome } from "../../../components/AgentChrome";
import { ProofButton, ProofCard, StepHeader } from "../../../components/BuilderChrome";
import { ConfirmDialog, EntryCard, ModuleCard, ModuleChecklist } from "../../../components/AgentEditor";
import { mergeResumeItems, moveResumeItem, moveResumeSection, splitResumeItem } from "../../../lib/resumeEdit";

const labels: Record<ResumeModuleKind, string> = {
  basicInfo: "基本信息", jobIntent: "求职意向", selfEvaluation: "自我评价", education: "教育背景",
  workExperience: "实习 / 工作经历", projects: "项目经历", awards: "荣誉奖项",
  campusExperience: "校园经历", skills: "专业技能", other: "其他内容"
};

type DialogState = null | { kind: "reparse" } | { kind: "removeResume" }
  | { kind: "hideSection"; sectionKind: ResumeModuleKind }
  | { kind: "removeItem"; sectionKind: ResumeModuleKind; itemId: string }
  | { kind: "splitItem"; sectionKind: ResumeModuleKind; itemId: string }
  | { kind: "mergeItem"; sectionKind: ResumeModuleKind; itemId: string; nextId: string }
  | { kind: "saveFailed"; detail: string; retryStyle: boolean };

export default function ResumeEditorPage({ params }: { params: Promise<{ resumeId: string }> }) {
  const [resumeId, setResumeId] = useState("");
  const [draft, setDraft] = useState<ResumeDraftV2 | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [pendingImages, setPendingImages] = useState<PendingResumeImage[]>([]);
  const [recoveryTargets, setRecoveryTargets] = useState<Record<string, string>>({});
  const [expiresAt, setExpiresAt] = useState("");
  const [blocksById, setBlocksById] = useState<Record<string, { page: number; text: string }>>({});
  const uploading = useRef(false);
  const mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [expandedKind, setExpandedKind] = useState<ResumeModuleKind | null>("basicInfo");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [splitBoundary, setSplitBoundary] = useState(1);
  const [mergeChoice, setMergeChoice] = useState<'combine' | 'first' | 'second'>('combine');
  const dragged = useRef<{kind:'section';section:ResumeModuleKind} | {kind:'item';section:ResumeModuleKind;itemId:string} | null>(null);
  const basicSection = draft?.sections.find((section) => section.kind === "basicInfo");
  const selectedBasicFacts = basicSection?.visible ? basicSection.items.filter((item) => item.included)
    .flatMap((item) => item.facts).filter((fact) => fact.included && fact.value.trim()) : [];
  const hasName = selectedBasicFacts.some((fact) => fact.key === "name");
  const hasContact = selectedBasicFacts.some((fact) => fact.key === "email" || fact.key === "phone");
  const pendingSections = draft?.sections.filter((section) => section.items.some((item) => item.needsReview)).length ?? 0;
  const moduleOptions = Object.keys(RESUME_MODULE_MAPPING)
    .map((kind) => ({ kind: kind as ResumeModuleKind, label: labels[kind as ResumeModuleKind] }));

  useEffect(() => { void params.then(({ resumeId: id }) => setResumeId(id)); }, [params]);
  useEffect(() => {
    if (!resumeId) return;
    let active = true;
    void resumeApi.read(resumeId).then((result) => {
      if (!active) return;
      setDraft(result.draft); setExpiresAt(result.expiresAt);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "草稿读取失败。"); });
    void resumeApi.pendingImages(resumeId).then(result => {
      if (active) setPendingImages(result.images);
    }).catch(() => { /* 可以通过管理入口重试；不影响现有草稿。 */ });
    // 原文对照是辅助信息：拉取失败时静默降级为不显示，不阻塞编辑
    void resumeApi.blocks(resumeId).then((result) => {
      if (!active) return;
      setBlocksById(Object.fromEntries(result.blocks.map((block) =>
        [block.blockId, { page: block.page, text: block.text }])));
    }).catch(() => { /* 原文对照不可用即隐藏 */ });
    return () => { active = false; };
  }, [resumeId]);

  const updateSection = (kind: ResumeModuleKind, change: (section: ResumeDraftSectionV2) => Partial<ResumeDraftSectionV2>) => {
    setDraft((previous) => previous ? { ...previous, sections: previous.sections.map((section) =>
      section.kind === kind ? { ...section, ...change(section) } : section) } : previous);
    setError("");
  };
  const updateItem = (kind: ResumeModuleKind, itemId: string, change: (item: ResumeDraftItemV2) => ResumeDraftItemV2) =>
    updateSection(kind, (section) => ({ items: section.items.map((item) =>
      item.itemId === itemId ? change(item) : item) }));

  const patchItem = (kind: ResumeModuleKind, itemId: string, patch: Partial<ResumeDraftItemV2>) =>
    updateSection(kind, (section) => ({
      visible: patch.included ? true : section.visible,
      items: section.items.map((entry) => entry.itemId === itemId ? { ...entry, ...patch,
        editedFields: [...new Set([...(entry.editedFields ?? []), ...Object.keys(patch)])] } : entry)
    }));

  const includeFact = (kind: ResumeModuleKind, itemId: string, factKey: string, included: boolean) =>
    updateSection(kind, (section) => ({
      visible: included || section.visible,
      items: section.items.map((entry) => entry.itemId === itemId ? {
        ...entry, included: included || entry.included,
        facts: entry.facts.map((fact) => fact.key === factKey ? { ...fact, included } : fact),
        editedFields: [...new Set([...(entry.editedFields ?? []), `fact:${factKey}`])]
      } : entry)
    }));

  const addItem = (kind: ResumeModuleKind) => {
    updateSection(kind, (section) => ({ visible: true, items: [...section.items, {
      itemId: `manual-${crypto.randomUUID()}`, order: section.items.length, title: "", details: "",
      facts: kind === "basicInfo" ? ["name", "email", "phone"].map((key) => ({ key,
        label: ({ name: "姓名", email: "邮箱", phone: "电话" } as Record<string, string>)[key],
        value: "", included: false })) : [],
      sourceBlockIds: [], confidence: 1, segmentationConfidence: 1, needsReview: false,
      included: false, origin: "user" as const, editedFields: []
    }] }));
  };

  const releaseImage = (imageId: string) => {
    void resumeApi.deleteImage(resumeId, imageId).then(() => {
      if (mounted.current) setPendingImages(previous => previous.filter(image => image.imageId !== imageId));
    }).catch(() => { /* 已保存的引用在下一次草稿保存时释放。 */ });
  };
  const removeItem = (kind: ResumeModuleKind, itemId: string) => {
    for(const m of draft?.sections.find(s=>s.kind===kind)?.items.find(i=>i.itemId===itemId)?.supplements?.images ?? []) releaseImage(m.imageId);
    updateSection(kind, (section) => ({
    items: section.items.filter((item) => item.itemId !== itemId).map((item, order) => ({ ...item, order }))
  }));
  };

  // 条目在模块内上下移动：交换位置后按新顺序重编 order，保存时由服务端全量校验
  const moveItemWithin = (kind: ResumeModuleKind, itemId: string, delta: number) =>
    setDraft(previous => previous ? moveResumeItem(previous, kind, itemId, delta) : previous);
  const moveModule = (kind: ResumeModuleKind, delta: number) =>
    setDraft(previous => previous ? moveResumeSection(previous, kind, delta) : previous);
  const dropOnModule = (kind: ResumeModuleKind) => {
    const drag = dragged.current;
    if (drag?.kind === 'section' && draft) {
      const from = draft.sections.find(section => section.kind === drag.section)?.order;
      const to = draft.sections.find(section => section.kind === kind)?.order;
      if (from !== undefined && to !== undefined) moveModule(drag.section, to - from);
    }
    dragged.current = null;
  };
  const dropOnItem = (kind: ResumeModuleKind, itemId: string) => {
    const drag = dragged.current;
    if (drag?.kind === 'item' && drag.section === kind && draft) {
      const section = draft.sections.find(section => section.kind === kind);
      const from = section?.items.find(item => item.itemId === drag.itemId)?.order;
      const to = section?.items.find(item => item.itemId === itemId)?.order;
      if (from !== undefined && to !== undefined) moveItemWithin(kind, drag.itemId, to - from);
    }
    dragged.current = null;
  };

  const moveItem = (from: ResumeModuleKind, itemId: string, to: ResumeModuleKind) => {
    if (!draft || from === to) return;
    const item = draft.sections.find((section) => section.kind === from)?.items.find((entry) => entry.itemId === itemId);
    if (!item) return;
    setDraft({ ...draft, sections: draft.sections.map((section) => {
      if (section.kind === from) return { ...section, items: section.items.filter((entry) => entry.itemId !== itemId)
        .map((entry, order) => ({ ...entry, order })) };
      if (section.kind === to) return { ...section, visible: true, items: [...section.items, { ...item,
        order: section.items.length }] };
      return section;
    }) });
    setError("");
  };

  const save = async (continueToStyle = false) => {
    if (!draft || !resumeId) return;
    if (uploading.current) { setError("请等待图片上传完成。"); return; }
    const pending = draft.sections.find(s => s.items.some(i => i.needsReview));
    if (continueToStyle && pending) { selectModule(pending.kind); setError("请先完成待核对条目。"); return; }
    const normalized = structuredClone(draft);
    for (const section of normalized.sections) for (const item of section.items) {
      if (!item.supplements) continue;
      item.supplements.links = item.supplements.links.filter(l => l.url.trim() || l.label?.trim()).map(l => ({...l,url:l.url.trim()}));
      if (item.supplements.links.some(l => !validHttpUrl(l.url) || [...l.url].length>2000 || [...(l.label ?? "")].length>80)) {
        selectModule(section.kind); setError(`「${item.title || labels[section.kind]}」的链接须为有效 HTTP(S) 地址。`); return;
      }
    }
    setBusy(true); setError("");
    try {
      if (continueToStyle) projectConfirmedResume(normalized);
      const saved = await resumeApi.save(resumeId, normalized);
      setDraft(saved.draft);
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      setDialog(null);
      if (continueToStyle) window.location.assign(`/style/${encodeURIComponent(resumeId)}`);
    } catch (cause) {
      // 保存失败走挽留弹窗：改动仍在页面上，可一键重试或继续编辑
      const detail = cause instanceof Error ? cause.message : "保存失败。";
      setDialog({ kind: "saveFailed",
        detail: detail === "REVISION_CONFLICT" ? "草稿已在别处更新，请刷新页面后重试。"
          : detail === "Name and email or phone required" ? "请在基本信息中勾选姓名，以及邮箱或电话，再继续。" : detail,
        retryStyle: continueToStyle });
    } finally { setBusy(false); }
  };

  // 上传条目补充图片：先做类型与体积前置校验，成功后把引用写入草稿
  const uploadSupplementImage = async (kind: ResumeModuleKind, itemId: string, file: File) => {
    if (!resumeId || uploading.current) return;
    const item = draft?.sections.find(s=>s.kind===kind)?.items.find(i=>i.itemId===itemId);
    if ((item?.supplements?.images.length ?? 0) >= 6 || (draft?.sections.flatMap(s=>s.items.flatMap(i=>i.supplements?.images ?? [])).length ?? 0) >= 24) { setError("每条最多 6 张、整份简历最多 24 张图片。"); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("仅支持 PNG、JPG 或 WebP 图片。"); return;
    }
    if (file.size > 5 * 1024 * 1024) { setError("每张图片不超过 5MB。"); return; }
    try {
      uploading.current = true;
      const { imageId } = await resumeApi.uploadImage(resumeId, file, itemId);
      if(!mounted.current) { releaseImage(imageId); return; }
      const target = draftRef.current?.sections.find(section => section.items.some(entry => entry.itemId === itemId));
      if (!target) { await resumeApi.deleteImage(resumeId, imageId); return; }
      updateItem(target.kind, itemId, current => ({ ...current,
        editedFields: [...new Set([...(current.editedFields ?? []), 'supplements'])],
        supplements: { ...(current.supplements ?? { text: "", links: [], images: [] }),
          images: [...(current.supplements?.images ?? []), { imageId, caption: "" }] } }));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片上传失败。");
    } finally { uploading.current = false; }
  };

  // 删除简历：确认弹窗后执行，成功即回上传页
  const confirmRemove = async () => {
    if (!resumeId) return;
    setBusy(true); setError("");
    try {
      await resumeApi.remove(resumeId);
      sessionStorage.removeItem("burp-agent-resume-id");
      sessionStorage.removeItem("burp-agent-file-id");
      window.location.assign("/upload");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败。");
      setBusy(false); setDialog(null);
    }
  };

  // 重新解析：从原 PDF 创建新副本，当前草稿保留
  const confirmReparse = async () => {
    if (!resumeId) return;
    setBusy(true); setError("");
    try {
      const task = await resumeApi.reparse(resumeId);
      sessionStorage.setItem("burp-agent-resume-id", task.resumeId);
      if (task.fileId) sessionStorage.setItem("burp-agent-file-id", task.fileId);
      window.location.assign("/upload");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重新解析失败。");
      setBusy(false); setDialog(null);
    }
  };

  const refreshPendingImages = async () => {
    try { setPendingImages((await resumeApi.pendingImages(resumeId)).images); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "未保存图片读取失败。"); }
  };
  const recoverImage = (imageId: string, itemId: string) => {
    const target = draft?.sections.find(section => section.items.some(item => item.itemId === itemId));
    const item = target?.items.find(item => item.itemId === itemId);
    const count = draft?.sections.flatMap(section => section.items.flatMap(item => item.supplements?.images ?? [])).length ?? 0;
    if (!target || !item) { setError("请先选择要恢复的条目。"); return; }
    if ((item.supplements?.images.length ?? 0) >= 6 || count >= 24) { setError("每条最多 6 张、整份简历最多 24 张图片。"); return; }
    updateItem(target.kind, itemId, current => ({...current, supplements: {
      ...(current.supplements ?? {text:"", links:[], images:[]}),
      images: [...(current.supplements?.images ?? []), {imageId, caption:""}]
    }}));
    selectModule(target.kind);
  };
  const discardPendingImage = async (imageId: string) => {
    try {
      await resumeApi.deleteImage(resumeId, imageId);
      setPendingImages(previous => previous.filter(image => image.imageId !== imageId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "图片删除失败。"); }
  };
  const localImageIds = new Set(draft?.sections.flatMap(section => section.items.flatMap(item =>
    (item.supplements?.images ?? []).map(image => image.imageId))) ?? []);
  const recoverableImages = pendingImages.filter(image => !localImageIds.has(image.imageId));

  const selectModule = (kind: ResumeModuleKind) => {
    setExpandedKind(kind);
    document.getElementById(`resume-${kind}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const splitTarget = dialog?.kind === 'splitItem'
    ? draft?.sections.find(section=>section.kind===dialog.sectionKind)?.items.find(item=>item.itemId===dialog.itemId)
    : undefined;
  const splitParts = splitTarget?.details.split(/\n\s*\n/).map(part=>part.trim()).filter(Boolean) ?? [];
  const confirmSplit = () => {
    if (dialog?.kind !== 'splitItem' || !draft) return;
    try {
      setDraft(splitResumeItem(draft,dialog.sectionKind,dialog.itemId,splitBoundary,`manual-${crypto.randomUUID()}`));
      setDialog(null);setError('');
    } catch(cause) {setError(cause instanceof Error?cause.message:'拆分失败。');}
  };
  const confirmMerge = () => {
    if (dialog?.kind !== 'mergeItem' || !draft) return;
    try {
      setDraft(mergeResumeItems(draft,dialog.sectionKind,dialog.itemId,dialog.nextId,mergeChoice));
      setDialog(null);setError('');
    } catch(cause) {setError(cause instanceof Error?cause.message:'合并失败。');}
  };

  if (!draft && error) return <AgentChrome phase="confirm" backHref="/upload" backLabel="← 返回上传">
    <section className="proof-step-page">
      <ProofCard className="proof-error-card">
        <h1>简历不存在或已过期</h1>
        <p>{error}</p>
        <ProofButton onClick={() => window.location.assign("/upload")}>返回上传</ProofButton>
      </ProofCard>
    </section>
  </AgentChrome>;

  return <AgentChrome phase="confirm" backHref="/upload" backLabel="← 返回上传">
    <section className="proof-step-page">
      <StepHeader number={2} title="核对经历，把你的能力补充完整"
        description={`Agent 已按模块整理内容，只有主动勾选的内容会用于作品。原 PDF 与草稿保留至 ${expiresAt ? new Date(expiresAt).toLocaleString("zh-CN") : "上传 30 天后"} 自动删除。`} />
      <div className="proof-status-row">
        <p role="status">{savedAt ? `已保存 ${savedAt}` : "尚未保存"}
          {pendingSections > 0 ? ` · 待确认 ${pendingSections} 个模块` : ""}</p>
        <ProofButton disabled={busy || !draft} onClick={() => void refreshPendingImages()}>管理未保存图片</ProofButton>
        <ProofButton disabled={busy || !draft} onClick={() => void save()}>保存草稿</ProofButton>
        <ProofButton disabled={busy || !draft} onClick={() => setDialog({ kind: "reparse" })}>重新解析为新草稿</ProofButton>
      </div>
      {draft && recoverableImages.length > 0 && <section className="proof-card" aria-label="未保存图片">
        <h2>未保存图片</h2>
        <p>这些上传尚未进入已保存草稿，仍会占用图片额度。可恢复到条目或删除；请保留其他编辑页面仍在使用的图片。</p>
        <div className="resume-image-grid">{recoverableImages.map((image, index) => {
          const targetId = recoveryTargets[image.imageId] ?? image.itemId ?? "";
          return <article key={image.imageId}>
            <img src={resumeApi.imageUrl(resumeId, image.imageId)} alt={`未保存图片 ${index + 1}`} />
            <label className="proof-field"><span>恢复到条目 {index + 1}</span>
              <select value={targetId} onChange={event => setRecoveryTargets(previous => ({...previous, [image.imageId]:event.target.value}))}>
                <option value="">请选择条目</option>
                {draft.sections.flatMap(section => section.items.map((item, itemIndex) => <option key={item.itemId} value={item.itemId}>{labels[section.kind]} · {item.title || `条目 ${itemIndex + 1}`}</option>))}
              </select>
            </label>
            <ProofButton disabled={!targetId} onClick={() => recoverImage(image.imageId, targetId)}>恢复图片 {index + 1}</ProofButton>
            <ProofButton onClick={() => void discardPendingImage(image.imageId)}>删除未保存图片 {index + 1}</ProofButton>
          </article>;
        })}</div>
      </section>}
      {draft && <div className="proof-confirm-layout">
        <ModuleChecklist entries={[...draft.sections].sort((a,b)=>a.order-b.order).map((section) => ({ kind: section.kind,
          label: labels[section.kind], pending: section.items.some((item) => item.needsReview) }))}
          activeKind={expandedKind} onSelect={selectModule} />
        <div className="proof-editor-column">
          {[...draft.sections].sort((a,b)=>a.order-b.order).map((section) => <ModuleCard key={section.kind} kind={section.kind}
            label={labels[section.kind]} section={section} expanded={expandedKind === section.kind}
            onMoveUp={() => moveModule(section.kind,-1)} onMoveDown={() => moveModule(section.kind,1)}
            onDragStart={() => {dragged.current={kind:'section',section:section.kind};}}
            onDrop={() => dropOnModule(section.kind)}
            onToggleExpand={() => setExpandedKind(expandedKind === section.kind ? null : section.kind)}
            onVisibleChange={(visible) => { if (!visible && section.items.some(i=>i.needsReview)) setDialog({kind:"hideSection",sectionKind:section.kind}); else updateSection(section.kind, () => ({visible})); }}
            onAddItem={() => addItem(section.kind)}>
            {[...section.items].sort((a,b)=>a.order-b.order).map((item, index) => <EntryCard key={item.itemId} kind={section.kind}
              label={labels[section.kind]} item={item} index={index} total={section.items.length}
              canAddFacts={section.kind === "basicInfo" || section.kind === "jobIntent"}
              moduleOptions={moduleOptions}
              sourceExcerpt={item.sourceBlockIds.map((id) => blocksById[id])
                .filter((block): block is { page: number; text: string } => Boolean(block))}
              onPatchItem={(patch) => patchItem(section.kind, item.itemId, patch)}
              onPatchFactValue={(factKey, value) => updateItem(section.kind, item.itemId, (current) => ({ ...current,
                editedFields:[...new Set([...(current.editedFields ?? []),`fact:${factKey}`])],
                facts: current.facts.map((fact) => fact.key === factKey ? { ...fact, value } : fact) }))}
              onIncludeFact={(factKey, included) => includeFact(section.kind, item.itemId, factKey, included)}
              onAddFact={() => {const key=`custom-${crypto.randomUUID()}`;updateItem(section.kind, item.itemId, (current) => ({ ...current,
                editedFields:[...new Set([...(current.editedFields ?? []),`fact:${key}`])], facts: [...current.facts, {
                key, label: "新字段", value: "", included: false }] }));}}
              onPatchFactLabel={(factKey, nextLabel) => updateItem(section.kind, item.itemId, (current) => ({ ...current,
                editedFields:[...new Set([...(current.editedFields ?? []),`fact:${factKey}`])],
                facts: current.facts.map((fact) => fact.key === factKey ? { ...fact, label: nextLabel } : fact) }))}
              onUploadImage={(file) => { void uploadSupplementImage(section.kind, item.itemId, file); }}
              onRemoveImage={(imageId)=>{updateItem(section.kind,item.itemId,current=>({...current,
                editedFields:[...new Set([...(current.editedFields ?? []),'supplements'])],
                supplements:{...(current.supplements ?? {text:"",links:[],images:[]}),images:(current.supplements?.images ?? []).filter(m=>m.imageId!==imageId)}}));releaseImage(imageId);}}
              imageUrl={(imageId) => resumeApi.imageUrl(resumeId, imageId)}
              onMoveUp={() => moveItemWithin(section.kind, item.itemId, -1)}
              onMoveDown={() => moveItemWithin(section.kind, item.itemId, 1)}
              onDragStart={() => {dragged.current={kind:'item',section:section.kind,itemId:item.itemId};}}
              onDrop={() => dropOnItem(section.kind,item.itemId)}
              onSplit={['workExperience','projects','awards','campusExperience'].includes(section.kind)
                ? () => {setSplitBoundary(1);setDialog({kind:'splitItem',sectionKind:section.kind,itemId:item.itemId});} : undefined}
              onMerge={['workExperience','projects','awards','campusExperience'].includes(section.kind) && index < section.items.length-1
                ? () => {setMergeChoice('combine');setDialog({kind:'mergeItem',sectionKind:section.kind,itemId:item.itemId,
                    nextId:[...section.items].sort((a,b)=>a.order-b.order)[index+1].itemId});} : undefined}
              onRequestRemove={() => setDialog({ kind: "removeItem", sectionKind: section.kind, itemId: item.itemId })}
              onMoveTo={(to) => moveItem(section.kind, item.itemId, to)} />)}
          </ModuleCard>)}
        </div>
        <aside className="proof-pdf-panel" aria-label="原 PDF 预览">
          <h2>原 PDF</h2>
          <iframe title="原 PDF 预览" src={resumeApi.sourceUrl(resumeId)} />
        </aside>
      </div>}
      {draft && (!hasName || !hasContact) && <p className="proof-confirm-hint" id="resume-confirm-hint">
        请在基本信息中勾选姓名，以及邮箱或电话，再继续。<a href="#resume-basicInfo">返回基本信息 ↑</a>
      </p>}
      {error && <p role="alert" className="proof-inline-error">{error}</p>}
      <div className="proof-actions">
        <ProofButton variant="primary" disabled={busy || !draft}
          aria-describedby={draft && (!hasName || !hasContact) ? "resume-confirm-hint" : undefined}
          onClick={() => void save(true)}>确认并选择风格 →</ProofButton>
        <ProofButton variant="quiet" className="proof-danger-link" disabled={busy}
          onClick={() => setDialog({ kind: "removeResume" })}>删除本次简历</ProofButton>
      </div>
    </section>
    <ConfirmDialog open={dialog?.kind === "hideSection"} title="隐藏待核对模块"
      description="确认不展示该模块？内容会保留，待核对标记将清除。" confirmLabel="确认隐藏"
      onConfirm={() => { if (dialog?.kind === "hideSection") updateSection(dialog.sectionKind, s=>({visible:false,items:s.items.map(i=>({...i,needsReview:false}))})); setDialog(null); }} onClose={() => setDialog(null)} />
    <ConfirmDialog open={dialog?.kind === "reparse"} title="重新解析为新草稿"
      description="将从原 PDF 创建一份新草稿，当前草稿会保留。新副本从现在起保留 30 天。"
      confirmLabel="继续" busy={busy} onConfirm={() => void confirmReparse()} onClose={() => setDialog(null)} />
    <ConfirmDialog open={dialog?.kind === "removeItem"} title="删除条目"
      description="删除该条目及其补充内容？此操作不可撤销。" confirmLabel="确认删除"
      onConfirm={() => { if (dialog?.kind === "removeItem") removeItem(dialog.sectionKind, dialog.itemId); setDialog(null); }}
      onClose={() => setDialog(null)} />
    <ConfirmDialog open={dialog?.kind === 'splitItem'} title="拆分条目" confirmLabel="确认拆分"
      description={<><p>请选择两段经历之间的边界。第一条保留补充内容，第二条需要重新核对。</p>
        <p>{splitTarget?.details}</p><label>拆分位置<select value={splitBoundary}
          onChange={event=>setSplitBoundary(Number(event.target.value))}>
          {splitParts.slice(1).map((_,index)=><option key={index} value={index+1}>第 {index+1} 段后</option>)}
        </select></label></>}
      onConfirm={confirmSplit} onClose={() => setDialog(null)} />
    <ConfirmDialog open={dialog?.kind === 'mergeItem'} title="合并条目" confirmLabel="确认合并"
      description={<><p>选择两条经历的补充内容归属；超出单条上限时请先调整。</p>
        <label>补充内容<select value={mergeChoice}
          onChange={event=>setMergeChoice(event.target.value as typeof mergeChoice)}>
          <option value="combine">合并两条</option><option value="first">保留前一条</option>
          <option value="second">保留后一条</option>
        </select></label></>}
      onConfirm={confirmMerge} onClose={() => setDialog(null)} />
    <ConfirmDialog open={dialog?.kind === "removeResume"} title="删除简历与原 PDF"
      description="确定删除这份简历、原 PDF 和解析草稿吗？此操作无法撤销。" confirmLabel="确认删除"
      busy={busy} onConfirm={() => void confirmRemove()} onClose={() => setDialog(null)} />
    <ConfirmDialog open={dialog?.kind === "saveFailed"} title="保存失败"
      description={dialog?.kind === "saveFailed" ? <>
        <p>{dialog.detail}</p>
        <p>本次修改尚未保存，改动会保留在页面上。你可以重试保存，或先继续编辑。</p>
      </> : null}
      confirmLabel="重试保存" busy={busy}
      onConfirm={() => { if (dialog?.kind === "saveFailed") void save(dialog.retryStyle); }}
      onClose={() => setDialog(null)} />
  </AgentChrome>;
}
