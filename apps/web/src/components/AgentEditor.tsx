"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { ProofButton, ProofCard } from "./BuilderChrome";
import type { ResumeDraftItem, ResumeDraftSection, ResumeModuleKind } from "../../../../packages/contracts/src/resume-draft";

// 左栏模块核对清单：「确认进度 n / 10」+ 每个模块的 ✓/○ 状态，点击展开对应模块
export function ModuleChecklist({ entries, activeKind, onSelect }: {
  entries: { kind: ResumeModuleKind; label: string; pending: boolean }[];
  activeKind: ResumeModuleKind | null;
  onSelect: (kind: ResumeModuleKind) => void;
}) {
  const done = entries.filter((entry) => !entry.pending).length;
  return <ProofCard className="proof-module-nav proof-checklist">
    <h2>确认进度 {done} / {entries.length}</h2>
    <nav aria-label="模块核对清单">
      {entries.map((entry) => <button type="button" key={entry.kind}
        className={activeKind === entry.kind ? "is-active" : ""}
        aria-current={activeKind === entry.kind ? "true" : undefined}
        onClick={() => onSelect(entry.kind)}>
        <span>{entry.pending ? "○" : "✓"}</span> {entry.label}
      </button>)}
    </nav>
  </ProofCard>;
}

// 单个模块卡片：折叠头（标题、已识别/待确认徽章、显示开关、展开）+ 隐藏提示 + 展开内容
export function ModuleCard({ kind, label, section, expanded, onToggleExpand, onVisibleChange, onAddItem, children }: {
  kind: ResumeModuleKind;
  label: string;
  section: ResumeDraftSection;
  expanded: boolean;
  onToggleExpand: () => void;
  onVisibleChange: (visible: boolean) => void;
  onAddItem: () => void;
  children: ReactNode;
}) {
  const pending = section.items.some((item) => item.needsReview);
  return <section id={`resume-${kind}`} className="proof-card proof-module-card">
    <div className="proof-module-head">
      <h2>{label}</h2>
      <span className="proof-module-badge" data-pending={pending || undefined}>
        {section.items.length === 0 ? "空" : pending ? "待确认" : `已识别 ${section.items.length} 条`}
      </span>
      <label className="proof-module-switch">
        <input type="checkbox" checked={section.visible} aria-label={`显示${label}`}
          onChange={(event) => onVisibleChange(event.target.checked)} />
        显示
      </label>
      <ProofButton variant="quiet" aria-expanded={expanded} aria-controls={`module-${kind}-body`}
        onClick={onToggleExpand}>{expanded ? "收起 ⌃" : "展开 ⌄"}</ProofButton>
    </div>
    {!section.visible && <div className="proof-hidden-note">
      <p>已隐藏，不进入生成网站；数据仍保留。</p>
      <ProofButton variant="quiet" onClick={() => onVisibleChange(true)}>显示模块</ProofButton>
    </div>}
    {expanded && <div className="proof-module-body" id={`module-${kind}-body`}>
      {section.items.length === 0 && <ProofCard className="proof-empty-module">
        <strong>未识别到内容，可手动添加。</strong>
      </ProofCard>}
      {children}
      <ProofButton variant="quiet" onClick={onAddItem}>添加{label}</ProofButton>
    </div>}
  </section>;
}

// 单条经历条目：勾选展示、低置信度警示、标题/内容编辑、事实字段、上下移动与删除
export function EntryCard({ kind, label, item, index, total, canAddFacts, moduleOptions,
  onPatchItem, onPatchFactValue, onIncludeFact, onAddFact, onPatchFactLabel,
  onMoveUp, onMoveDown, onRequestRemove, onMoveTo }: {
  kind: ResumeModuleKind;
  label: string;
  item: ResumeDraftItem;
  index: number;
  total: number;
  canAddFacts: boolean;
  moduleOptions: { kind: ResumeModuleKind; label: string }[];
  onPatchItem: (patch: Partial<ResumeDraftItem>) => void;
  onPatchFactValue: (factKey: string, value: string) => void;
  onIncludeFact: (factKey: string, included: boolean) => void;
  onAddFact: () => void;
  onPatchFactLabel: (factKey: string, label: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRequestRemove: () => void;
  onMoveTo: (to: ResumeModuleKind) => void;
}) {
  const lowConfidence = item.needsReview || item.confidence < 0.7 || item.segmentationConfidence < 0.7;
  const customFacts = item.facts.filter((fact) => fact.key.startsWith("custom-"));
  return <article className="proof-confirm-entry" aria-label={`${label}条目 ${index + 1}`}>
    <div className="proof-entry-top">
      <label><input type="checkbox" checked={item.included}
        onChange={(event) => onPatchItem({ included: event.target.checked })} />展示此条</label>
      <div className="proof-entry-tools">
        <ProofButton variant="quiet" disabled={index === 0} onClick={onMoveUp}>↑ 上移</ProofButton>
        <ProofButton variant="quiet" disabled={index === total - 1} onClick={onMoveDown}>↓ 下移</ProofButton>
        <ProofButton variant="quiet" onClick={onRequestRemove}>删除条目</ProofButton>
      </div>
    </div>
    {lowConfidence && <p className="proof-entry-warn">⚠ AI 识别置信度较低，请确认内容与分类
      （分类 {Math.round(item.confidence * 100)}% · 拆条 {Math.round(item.segmentationConfidence * 100)}%）</p>}
    <label className="proof-field"><span>标题</span>
      <input value={item.title} onChange={(event) => onPatchItem({ title: event.target.value })} /></label>
    <label className="proof-field"><span>内容</span>
      <textarea rows={Math.min(9, Math.max(4, item.details.split("\n").length + 1))} value={item.details}
        onChange={(event) => onPatchItem({ details: event.target.value })} /></label>
    {item.facts.map((fact) => <div key={fact.key} className="proof-fact-row">
      <label className="proof-field"><span>{fact.label}</span>
        <input value={fact.value} onChange={(event) => onPatchFactValue(fact.key, event.target.value)} /></label>
      <label className="proof-fact-check"><input type="checkbox" checked={fact.included}
        onChange={(event) => onIncludeFact(fact.key, event.target.checked)} />展示</label>
    </div>)}
    {canAddFacts && <ProofButton variant="quiet" onClick={onAddFact}>添加字段</ProofButton>}
    {customFacts.map((fact) => <label key={`${fact.key}-label`} className="proof-field"><span>字段名称</span>
      <input value={fact.label} onChange={(event) => onPatchFactLabel(fact.key, event.target.value)} /></label>)}
    <label className="proof-field proof-entry-move"><span>移动到</span>
      <select value={kind} aria-label={`移动${label}条目 ${index + 1} 到其他模块`}
        onChange={(event) => onMoveTo(event.target.value as ResumeModuleKind)}>
        {moduleOptions.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
      </select></label>
  </article>;
}

// 通用确认弹窗：删除条目、删除简历、重新解析等危险操作前的二次确认
export function ConfirmDialog({ open, title, description, confirmLabel = "确认", busy = false, onConfirm, onClose }: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);
  if (!open) return null;
  return <div className="proof-dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="proof-dialog proof-dialog--confirm" role="dialog" aria-modal="true" aria-label={title}>
      <header><div><p>CONFIRM</p><h2>{title}</h2></div></header>
      <div className="proof-dialog-body">{description}</div>
      <div className="proof-dialog-actions">
        <ProofButton onClick={onClose} disabled={busy}>取消</ProofButton>
        <ProofButton variant="primary" onClick={onConfirm} disabled={busy}>{busy ? "处理中…" : confirmLabel}</ProofButton>
      </div>
    </section>
  </div>;
}
