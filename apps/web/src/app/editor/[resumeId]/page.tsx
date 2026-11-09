"use client";

import { useEffect, useState } from "react";
import { projectConfirmedResume, RESUME_MODULE_MAPPING } from "../../../../../../packages/contracts/src/resume-draft";
import type { ResumeDraftItem, ResumeDraftSection, ResumeDraftV1, ResumeModuleKind } from "../../../../../../packages/contracts/src/resume-draft";
import { resumeApi } from "../../../lib/resumeApi";

const labels: Record<ResumeModuleKind, string> = {
  basicInfo: "基本信息", jobIntent: "求职意向", selfEvaluation: "自我评价", education: "教育背景",
  workExperience: "实习 / 工作经历", projects: "项目经历", awards: "荣誉奖项",
  campusExperience: "校园经历", skills: "专业技能", other: "其他内容"
};

export default function ResumeEditorPage({ params }: { params: Promise<{ resumeId: string }> }) {
  const [resumeId, setResumeId] = useState("");
  const [draft, setDraft] = useState<ResumeDraftV1 | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void params.then(({ resumeId: id }) => setResumeId(id)); }, [params]);
  useEffect(() => {
    if (!resumeId) return;
    let active = true;
    void resumeApi.read(resumeId).then((result) => {
      if (!active) return;
      setDraft(result.draft); setExpiresAt(result.expiresAt);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "草稿读取失败。"); });
    return () => { active = false; };
  }, [resumeId]);

  const updateSection = (kind: ResumeModuleKind, change: (section: ResumeDraftSection) => ResumeDraftSection) => {
    setDraft((previous) => previous ? { ...previous, sections: previous.sections.map((section) =>
      section.kind === kind ? change(section) : section) } : previous);
    setMessage("");
  };
  const updateItem = (kind: ResumeModuleKind, itemId: string, change: (item: ResumeDraftItem) => ResumeDraftItem) =>
    updateSection(kind, (section) => ({ ...section, items: section.items.map((item) =>
      item.itemId === itemId ? change(item) : item) }));

  const addItem = (kind: ResumeModuleKind) => {
    updateSection(kind, (section) => ({ ...section, visible: true, items: [...section.items, {
      itemId: `manual-${crypto.randomUUID()}`, order: section.items.length, title: "", details: "",
      facts: kind === "basicInfo" ? ["name", "email", "phone"].map((key) => ({ key,
        label: ({ name: "姓名", email: "邮箱", phone: "电话" } as Record<string, string>)[key],
        value: "", included: false })) : [],
      sourceBlockIds: [], confidence: 1, segmentationConfidence: 1, needsReview: false,
      included: false, origin: "user" as const
    }] }));
  };

  const removeItem = (kind: ResumeModuleKind, itemId: string) => updateSection(kind, (section) => ({
    ...section, items: section.items.filter((item) => item.itemId !== itemId).map((item, order) => ({ ...item, order }))
  }));

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
    setMessage("");
  };

  const save = async (continueToStyle = false) => {
    if (!draft || !resumeId) return;
    setBusy(true); setError("");
    try {
      if (continueToStyle) projectConfirmedResume(draft);
      const saved = await resumeApi.save(resumeId, draft);
      setDraft(saved.draft);
      setMessage("已保存草稿。");
      if (continueToStyle) window.location.assign(`/style/${encodeURIComponent(resumeId)}`);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "保存失败。";
      setError(detail === "REVISION_CONFLICT" ? "草稿已在别处更新，请刷新页面后重试。"
        : detail === "Name and email or phone required" ? "请先勾选姓名，以及邮箱或电话，再继续。" : detail);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!resumeId) return;
    if (!window.confirm("确定删除这份简历、原 PDF 和解析草稿吗？此操作无法撤销。")) return;
    setBusy(true);
    try {
      await resumeApi.remove(resumeId);
      sessionStorage.removeItem("burp-agent-resume-id");
      window.location.assign("/upload");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败。"); setBusy(false); }
  };

  return <main className="resume-flow">
    <a href="/upload">← 返回上传</a>
    <h1>核对简历资料</h1>
    <p>Agent 已按模块整理内容。你可以增删、修改和移动条目，只有主动勾选的内容会用于作品。原 PDF 与草稿会在上传 30 天后自动删除。</p>
    {expiresAt && <p>保留至：{new Date(expiresAt).toLocaleString("zh-CN")}</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {draft && <div className="resume-editor-layout">
      <div className="resume-editor-sections">
        {draft.sections.map((section) => <section key={section.kind} className="resume-module">
          <div className="resume-module-heading">
            <h2>{labels[section.kind]}</h2>
            <label><input type="checkbox" checked={section.visible} onChange={(event) => updateSection(section.kind,
              (current) => ({ ...current, visible: event.target.checked }))} />用于展示</label>
            <span>{section.items.length} 条</span>
          </div>
          {section.items.map((item) => <article key={item.itemId} className="resume-item">
            <div className="resume-item-top">
              <label><input type="checkbox" checked={item.included} onChange={(event) => updateSection(section.kind,
                (current) => ({ ...current, visible: event.target.checked || current.visible,
                  items: current.items.map((entry) => entry.itemId === item.itemId
                    ? { ...entry, included: event.target.checked } : entry) }))} />展示此条</label>
              {item.needsReview && <strong>请核对拆分与分类</strong>}
              <span>分类 {Math.round(item.confidence * 100)}% · 拆条 {Math.round(item.segmentationConfidence * 100)}%</span>
            </div>
            <label>标题<input value={item.title} onChange={(event) => updateItem(section.kind, item.itemId,
              (current) => ({ ...current, title: event.target.value }))} /></label>
            <label>内容<textarea value={item.details} onChange={(event) => updateItem(section.kind, item.itemId,
              (current) => ({ ...current, details: event.target.value }))} /></label>
            {item.facts.map((fact) => <div key={fact.key} className="resume-fact">
              <label>{fact.label}<input value={fact.value} onChange={(event) => updateItem(section.kind, item.itemId,
                (current) => ({ ...current, facts: current.facts.map((entry) => entry.key === fact.key
                  ? { ...entry, value: event.target.value } : entry) }))} /></label>
              <label><input type="checkbox" checked={fact.included} onChange={(event) => updateSection(section.kind,
                (current) => ({ ...current, visible: event.target.checked || current.visible,
                  items: current.items.map((entry) => entry.itemId === item.itemId ? {
                    ...entry, included: event.target.checked || entry.included,
                    facts: entry.facts.map((value) => value.key === fact.key
                      ? { ...value, included: event.target.checked } : value)
                  } : entry) }))} />展示</label>
            </div>)}
            {(section.kind === "basicInfo" || section.kind === "jobIntent") && <button type="button"
              onClick={() => updateItem(section.kind, item.itemId, (current) => ({ ...current, facts: [...current.facts, {
                key: `custom-${crypto.randomUUID()}`, label: "新字段", value: "", included: false
              }] }))}>添加字段</button>}
            {item.facts.some((fact) => fact.key.startsWith("custom-")) && item.facts.filter((fact) => fact.key.startsWith("custom-")).map((fact) =>
              <label key={`${fact.key}-label`}>字段名称<input value={fact.label} onChange={(event) => updateItem(section.kind,
                item.itemId, (current) => ({ ...current, facts: current.facts.map((entry) => entry.key === fact.key
                  ? { ...entry, label: event.target.value } : entry) }))} /></label>)}
            <div className="resume-actions">
              <label>移动到<select value={section.kind} onChange={(event) => moveItem(section.kind, item.itemId,
                event.target.value as ResumeModuleKind)}>{Object.keys(RESUME_MODULE_MAPPING).map((kind) =>
                  <option key={kind} value={kind}>{labels[kind as ResumeModuleKind]}</option>)}</select></label>
              <button type="button" onClick={() => removeItem(section.kind, item.itemId)}>删除条目</button>
            </div>
          </article>)}
          <button type="button" onClick={() => addItem(section.kind)}>添加{labels[section.kind]}</button>
        </section>)}
      </div>
      <aside className="resume-pdf-panel"><h2>原 PDF</h2><iframe title="原 PDF 预览" src={resumeApi.sourceUrl(resumeId)} /></aside>
    </div>}
    <div className="resume-actions">
      <button type="button" disabled={busy || !draft} onClick={() => void save()}>保存草稿</button>
      <button type="button" disabled={busy || !draft} onClick={() => void save(true)}>确认并选择风格 →</button>
      <button type="button" disabled={busy} onClick={() => void remove()}>删除简历与原 PDF</button>
    </div>
  </main>;
}
