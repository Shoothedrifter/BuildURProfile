"use client";

import { useEffect, useState } from "react";
import { projectConfirmedResume, RESUME_MODULE_MAPPING } from "../../../../../../packages/contracts/src/resume-draft";
import type { ResumeDraftItem, ResumeDraftSection, ResumeDraftV1, ResumeModuleKind } from "../../../../../../packages/contracts/src/resume-draft";
import { resumeApi } from "../../../lib/resumeApi";
import { AgentChrome } from "../../../components/AgentChrome";
import { ProofButton, ProofCard, StepHeader } from "../../../components/BuilderChrome";
import { ConfirmDialog, EntryCard, ModuleCard, ModuleChecklist } from "../../../components/AgentEditor";

const labels: Record<ResumeModuleKind, string> = {
  basicInfo: "基本信息", jobIntent: "求职意向", selfEvaluation: "自我评价", education: "教育背景",
  workExperience: "实习 / 工作经历", projects: "项目经历", awards: "荣誉奖项",
  campusExperience: "校园经历", skills: "专业技能", other: "其他内容"
};

type DialogState = null | { kind: "reparse" } | { kind: "removeResume" }
  | { kind: "removeItem"; sectionKind: ResumeModuleKind; itemId: string };

export default function ResumeEditorPage({ params }: { params: Promise<{ resumeId: string }> }) {
  const [resumeId, setResumeId] = useState("");
  const [draft, setDraft] = useState<ResumeDraftV1 | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [blocksById, setBlocksById] = useState<Record<string, { page: number; text: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [expandedKind, setExpandedKind] = useState<ResumeModuleKind | null>("basicInfo");
  const [dialog, setDialog] = useState<DialogState>(null);
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
    // 原文对照是辅助信息：拉取失败时静默降级为不显示，不阻塞编辑
    void resumeApi.blocks(resumeId).then((result) => {
      if (!active) return;
      setBlocksById(Object.fromEntries(result.blocks.map((block) =>
        [block.blockId, { page: block.page, text: block.text }])));
    }).catch(() => { /* 原文对照不可用即隐藏 */ });
    return () => { active = false; };
  }, [resumeId]);

  const updateSection = (kind: ResumeModuleKind, change: (section: ResumeDraftSection) => Partial<ResumeDraftSection>) => {
    setDraft((previous) => previous ? { ...previous, sections: previous.sections.map((section) =>
      section.kind === kind ? { ...section, ...change(section) } : section) } : previous);
    setError("");
  };
  const updateItem = (kind: ResumeModuleKind, itemId: string, change: (item: ResumeDraftItem) => ResumeDraftItem) =>
    updateSection(kind, (section) => ({ items: section.items.map((item) =>
      item.itemId === itemId ? change(item) : item) }));

  const patchItem = (kind: ResumeModuleKind, itemId: string, patch: Partial<ResumeDraftItem>) =>
    updateSection(kind, (section) => ({
      visible: patch.included ? true : section.visible,
      items: section.items.map((entry) => entry.itemId === itemId ? { ...entry, ...patch } : entry)
    }));

  const includeFact = (kind: ResumeModuleKind, itemId: string, factKey: string, included: boolean) =>
    updateSection(kind, (section) => ({
      visible: included || section.visible,
      items: section.items.map((entry) => entry.itemId === itemId ? {
        ...entry, included: included || entry.included,
        facts: entry.facts.map((fact) => fact.key === factKey ? { ...fact, included } : fact)
      } : entry)
    }));

  const addItem = (kind: ResumeModuleKind) => {
    updateSection(kind, (section) => ({ visible: true, items: [...section.items, {
      itemId: `manual-${crypto.randomUUID()}`, order: section.items.length, title: "", details: "",
      facts: kind === "basicInfo" ? ["name", "email", "phone"].map((key) => ({ key,
        label: ({ name: "姓名", email: "邮箱", phone: "电话" } as Record<string, string>)[key],
        value: "", included: false })) : [],
      sourceBlockIds: [], confidence: 1, segmentationConfidence: 1, needsReview: false,
      included: false, origin: "user" as const
    }] }));
  };

  const removeItem = (kind: ResumeModuleKind, itemId: string) => updateSection(kind, (section) => ({
    items: section.items.filter((item) => item.itemId !== itemId).map((item, order) => ({ ...item, order }))
  }));

  // 条目在模块内上下移动：交换位置后按新顺序重编 order，保存时由服务端全量校验
  const moveItemWithin = (kind: ResumeModuleKind, itemId: string, delta: number) =>
    updateSection(kind, (section) => {
      const index = section.items.findIndex((item) => item.itemId === itemId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= section.items.length) return {};
      const items = [...section.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { items: items.map((item, order) => ({ ...item, order })) };
    });

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
    setBusy(true); setError("");
    try {
      if (continueToStyle) projectConfirmedResume(draft);
      const saved = await resumeApi.save(resumeId, draft);
      setDraft(saved.draft);
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      if (continueToStyle) window.location.assign(`/style/${encodeURIComponent(resumeId)}`);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "保存失败。";
      setError(detail === "REVISION_CONFLICT" ? "草稿已在别处更新，请刷新页面后重试。"
        : detail === "Name and email or phone required" ? "请在基本信息中勾选姓名，以及邮箱或电话，再继续。" : detail);
    } finally { setBusy(false); }
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

  const selectModule = (kind: ResumeModuleKind) => {
    setExpandedKind(kind);
    document.getElementById(`resume-${kind}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
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
        <ProofButton disabled={busy || !draft} onClick={() => void save()}>保存草稿</ProofButton>
        <ProofButton disabled={busy || !draft} onClick={() => setDialog({ kind: "reparse" })}>重新解析为新草稿</ProofButton>
      </div>
      {draft && <div className="proof-confirm-layout">
        <ModuleChecklist entries={draft.sections.map((section) => ({ kind: section.kind,
          label: labels[section.kind], pending: section.items.some((item) => item.needsReview) }))}
          activeKind={expandedKind} onSelect={selectModule} />
        <div className="proof-editor-column">
          {draft.sections.map((section) => <ModuleCard key={section.kind} kind={section.kind}
            label={labels[section.kind]} section={section} expanded={expandedKind === section.kind}
            onToggleExpand={() => setExpandedKind(expandedKind === section.kind ? null : section.kind)}
            onVisibleChange={(visible) => updateSection(section.kind, () => ({ visible }))}
            onAddItem={() => addItem(section.kind)}>
            {section.items.map((item, index) => <EntryCard key={item.itemId} kind={section.kind}
              label={labels[section.kind]} item={item} index={index} total={section.items.length}
              canAddFacts={section.kind === "basicInfo" || section.kind === "jobIntent"}
              moduleOptions={moduleOptions}
              sourceExcerpt={item.sourceBlockIds.map((id) => blocksById[id])
                .filter((block): block is { page: number; text: string } => Boolean(block))}
              onPatchItem={(patch) => patchItem(section.kind, item.itemId, patch)}
              onPatchFactValue={(factKey, value) => updateItem(section.kind, item.itemId, (current) => ({ ...current,
                facts: current.facts.map((fact) => fact.key === factKey ? { ...fact, value } : fact) }))}
              onIncludeFact={(factKey, included) => includeFact(section.kind, item.itemId, factKey, included)}
              onAddFact={() => updateItem(section.kind, item.itemId, (current) => ({ ...current, facts: [...current.facts, {
                key: `custom-${crypto.randomUUID()}`, label: "新字段", value: "", included: false }] }))}
              onPatchFactLabel={(factKey, nextLabel) => updateItem(section.kind, item.itemId, (current) => ({ ...current,
                facts: current.facts.map((fact) => fact.key === factKey ? { ...fact, label: nextLabel } : fact) }))}
              onMoveUp={() => moveItemWithin(section.kind, item.itemId, -1)}
              onMoveDown={() => moveItemWithin(section.kind, item.itemId, 1)}
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
    <ConfirmDialog open={dialog?.kind === "reparse"} title="重新解析为新草稿"
      description="将从原 PDF 创建一份新草稿，当前草稿会保留。新副本从现在起保留 30 天。"
      confirmLabel="继续" busy={busy} onConfirm={() => void confirmReparse()} onClose={() => setDialog(null)} />
    <ConfirmDialog open={dialog?.kind === "removeItem"} title="删除条目"
      description="删除该条目及其补充内容？此操作不可撤销。" confirmLabel="确认删除"
      onConfirm={() => { if (dialog?.kind === "removeItem") removeItem(dialog.sectionKind, dialog.itemId); setDialog(null); }}
      onClose={() => setDialog(null)} />
    <ConfirmDialog open={dialog?.kind === "removeResume"} title="删除简历与原 PDF"
      description="确定删除这份简历、原 PDF 和解析草稿吗？此操作无法撤销。" confirmLabel="确认删除"
      busy={busy} onConfirm={() => void confirmRemove()} onClose={() => setDialog(null)} />
  </AgentChrome>;
}
