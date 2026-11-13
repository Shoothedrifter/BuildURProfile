"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { ProofButton, ProofCard } from "./BuilderChrome";
import type { ItemSupplements, ResumeDraftItem, ResumeDraftSection, ResumeModuleKind } from "../../../../packages/contracts/src/resume-draft";

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
export function ModuleCard({ kind, label, section, expanded, onToggleExpand, onVisibleChange, onAddItem,
  onMoveUp, onMoveDown, onDragStart, onDrop, children }: {
  kind: ResumeModuleKind;
  label: string;
  section: ResumeDraftSection;
  expanded: boolean;
  onToggleExpand: () => void;
  onVisibleChange: (visible: boolean) => void;
  onAddItem: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart?: () => void;
  onDrop?: () => void;
  children: ReactNode;
}) {
  const pending = section.items.some((item) => item.needsReview);
  return <section id={`resume-${kind}`} className="proof-card proof-module-card"
    onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); onDrop?.();}}>
    <div className="proof-module-head">
      <span draggable aria-label="拖动模块" role="button" tabIndex={0}
        onDragStart={onDragStart} onKeyDown={event => {
          if (event.key === 'ArrowUp') { event.preventDefault(); onMoveUp(); }
          if (event.key === 'ArrowDown') { event.preventDefault(); onMoveDown(); }
        }}>☷</span>
      <h2>{label}</h2>
      <ProofButton variant="quiet" onClick={onMoveUp} aria-label="模块上移">↑</ProofButton>
      <ProofButton variant="quiet" onClick={onMoveDown} aria-label="模块下移">↓</ProofButton>
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

// 单条经历条目：勾选展示、低置信度警示、原文对照、标题/内容编辑、事实字段、补充内容、上下移动与删除
export function EntryCard({ kind, label, item, index, total, canAddFacts, moduleOptions, sourceExcerpt,
  onPatchItem, onPatchFactValue, onIncludeFact, onAddFact, onPatchFactLabel,
  onUploadImage, onRemoveImage, imageUrl, onMoveUp, onMoveDown, onRequestRemove, onMoveTo,
  onSplit, onMerge, onDragStart, onDrop }: {
  kind: ResumeModuleKind;
  label: string;
  item: ResumeDraftItem;
  index: number;
  total: number;
  canAddFacts: boolean;
  moduleOptions: { kind: ResumeModuleKind; label: string }[];
  sourceExcerpt?: { page: number; text: string }[];
  onPatchItem: (patch: Partial<ResumeDraftItem>) => void;
  onPatchFactValue: (factKey: string, value: string) => void;
  onIncludeFact: (factKey: string, included: boolean) => void;
  onAddFact: () => void;
  onPatchFactLabel: (factKey: string, label: string) => void;
  onUploadImage: (file: File) => void;
  onRemoveImage: (imageId: string) => void;
  imageUrl: (imageId: string) => string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRequestRemove: () => void;
  onMoveTo: (to: ResumeModuleKind) => void;
  onSplit?: () => void;
  onMerge?: () => void;
  onDragStart?: () => void;
  onDrop?: () => void;
}) {
  const lowConfidence = item.needsReview || item.confidence < 0.7 || item.segmentationConfidence < 0.7;
  const customFacts = item.facts.filter((fact) => fact.key.startsWith("custom-"));
  const supplements = item.supplements ?? { text: "", links: [], images: [] };
  const patchSupplements = (patch: Partial<ItemSupplements>) =>
    onPatchItem({ supplements: { ...supplements, ...patch } });
  return <article className="proof-confirm-entry" aria-label={`${label}条目 ${index + 1}`}
    onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); onDrop?.();}}>
    <div className="proof-entry-top">
      <label><input type="checkbox" checked={item.included}
        onChange={(event) => onPatchItem({ included: event.target.checked })} />展示此条</label>
      <div className="proof-entry-tools">
        <span draggable role="button" tabIndex={0} aria-label={`拖动条目 ${index + 1}`}
          onDragStart={onDragStart} onKeyDown={event => {
            if (event.key === 'ArrowUp') { event.preventDefault(); onMoveUp(); }
            if (event.key === 'ArrowDown') { event.preventDefault(); onMoveDown(); }
          }}>☷</span>
        <ProofButton variant="quiet" disabled={index === 0} onClick={onMoveUp}>↑ 上移</ProofButton>
        <ProofButton variant="quiet" disabled={index === total - 1} onClick={onMoveDown}>↓ 下移</ProofButton>
        {onSplit && <ProofButton variant="quiet" onClick={onSplit}>拆分此条</ProofButton>}
        {onMerge && <ProofButton variant="quiet" onClick={onMerge}>与下一条合并</ProofButton>}
        <ProofButton variant="quiet" onClick={onRequestRemove}>删除条目</ProofButton>
      </div>
    </div>
    {lowConfidence && <p className="proof-entry-warn">⚠ AI 识别置信度较低，请确认内容与分类
      （分类 {Math.round(item.confidence * 100)}% · 拆条 {Math.round(item.segmentationConfidence * 100)}%）</p>}
    {item.needsReview && <ProofButton onClick={() => onPatchItem({ needsReview: false })}>已核对</ProofButton>}
    {!!sourceExcerpt?.length && <div className="proof-entry-source">
      <p className="proof-entry-source-head">原文对照（PDF 摘录）</p>
      {sourceExcerpt.map((block, blockIndex) => <p key={blockIndex} className="proof-entry-source-text">
        {/* 相邻摘录同页时页码只标一次，避免逐行重复 */}
        {(blockIndex === 0 || sourceExcerpt[blockIndex - 1].page !== block.page) &&
          <span className="proof-entry-source-page">第 {block.page} 页</span>}{block.text}</p>)}
    </div>}
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
    <div className="proof-supplement">
      <p className="proof-supplement-head">补充内容</p>
      <label className="proof-field"><span>补充说明</span>
        <textarea rows={3}  value={supplements.text}
          placeholder="可补充说明该经历的细节、成果或背景…"
          onChange={(event) => patchSupplements({ text: [...event.target.value].slice(0, 500).join("") })} /></label>
      <p className="proof-supplement-count">{[...supplements.text].length}/500</p>
      <div className="proof-supplement-row">
        <span>相关链接 {supplements.links.length}/5</span>
        <ProofButton variant="quiet" disabled={supplements.links.length >= 5}
          onClick={() => patchSupplements({ links: [...supplements.links, { url: "" }] })}>添加链接</ProofButton>
      </div>
      {supplements.links.map((link, linkIndex) => <div key={linkIndex} className="proof-supplement-link">
        <label className="proof-field"><span>链接名称 {linkIndex + 1}</span>
          <input value={link.label ?? ""} onChange={(event) => patchSupplements({ links: supplements.links.map((entry, i) => i === linkIndex ? { ...entry, label: [...event.target.value].slice(0,80).join("") } : entry) })} /></label>
        <label className="proof-field"><span>相关链接 {linkIndex + 1}</span>
          <input placeholder="粘贴相关链接（作品、GitHub、文章等）" value={link.url}
            onChange={(event) => patchSupplements({ links:
              supplements.links.map((entry, i) => i === linkIndex ? { ...entry, url: event.target.value } : entry) })} /></label>
        <ProofButton variant="quiet" onClick={() => patchSupplements({ links:
          supplements.links.filter((_, i) => i !== linkIndex) })}>移除链接</ProofButton>
      </div>)}
      <div className="proof-supplement-row">
        <span>图片 {supplements.images.length}/6</span>
        <label className="proof-supplement-upload">
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传图片" disabled={supplements.images.length >= 6}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onUploadImage(file);
            }} />
          + 上传图片
        </label>
      </div>
      <p className="proof-supplement-note">每条最多 6 张，整份最多 24 张 / 50 MiB；单张最多 5 MiB、1–8000 像素，说明不超过 80 字</p>
      {supplements.images.map((image, imageIndex) => <div key={image.imageId} className="proof-supplement-image">
        <img src={imageUrl(image.imageId)} alt={`补充图片 ${imageIndex + 1}`} />
        <label className="proof-field"><span>图片说明</span>
          <input value={image.caption}
            onChange={(event) => patchSupplements({ images:
              supplements.images.map((entry, i) => i === imageIndex ? { ...entry, caption: [...event.target.value].slice(0,80).join("") } : entry) })} /></label>
        <ProofButton variant="quiet" onClick={() => onRemoveImage(image.imageId)}>移除图片</ProofButton>
      </div>)}
    </div>
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
