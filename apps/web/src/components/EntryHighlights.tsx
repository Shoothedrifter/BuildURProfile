import { useId, useState } from "react";
import type { DraftPresentationHighlight, ResumeDraftItem, ResumeModuleKind } from "../../../../packages/contracts/src/resume-draft";
import {
  AWARD_UNITS, CAMPUS_UNITS, HIGHLIGHT_LEVELS, MAX_HIGHLIGHTS,
  automaticDraftHighlightIds, highlightConflictsWithText, highlightIsPrivate, highlightIsValid, highlightKey, supportsHighlights
} from "../../../../packages/contracts/src/presentation-highlights.mjs";
import { ProofButton } from "./BuilderChrome";

export function EntryHighlights({ kind, item, sourceExcerpt, visible, onChange }: {
  kind: ResumeModuleKind;
  item: ResumeDraftItem & { editedFields?: readonly string[] };
  sourceExcerpt?: { blockId: string; page: number; text: string }[];
  visible: boolean;
  onChange: (highlights: DraftPresentationHighlight[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const automatic = automaticDraftHighlightIds(kind, item);
  const highlights = (item.presentationHighlights ?? []).map(row =>
    automatic.has(row.id) ? { ...row, selected: true } : row);
  const eligibleModule = supportsHighlights(kind);
  const campus = kind === "campusExperience";
  const units = campus ? CAMPUS_UNITS : AWARD_UNITS;
  const hiddenValues = item.facts.filter(fact => !fact.included && fact.value).map(fact => fact.value);
  const shownTexts = [item.title, item.details,
    ...item.facts.filter(fact => fact.included).map(fact => `${fact.label}：${fact.value}`)];
  const rows = highlights.map(highlight => {
    const compatible = highlightIsValid(kind, highlight, false);
    return { highlight, compatible,
      conflict: compatible && (highlight.selected || expanded)
        && highlightConflictsWithText(kind, highlight, shownTexts),
      isPrivate: compatible && highlightIsPrivate(highlight, hiddenValues),
    };
  });

  const replace = (next: DraftPresentationHighlight) =>
    onChange(highlights.map(highlight => highlight.id === next.id ? next : highlight));

  const edit = (highlight: DraftPresentationHighlight, patch: Partial<DraftPresentationHighlight>) => {
    const next = { ...highlight, ...patch, selected: false, origin: "user" as const };
    delete next.sourceBlockId;
    replace(next);
  };

  const add = (type: DraftPresentationHighlight["type"]) => onChange([...highlights, {
    id: `manual-${crypto.randomUUID()}`, type, selected: false, origin: "user",
    label: type === "award-total" ? "获奖总数" : type === "award-tier" ? HIGHLIGHT_LEVELS[0] : "",
    value: "", unit: units[0], ...(type === "award-tier" ? { level: HIGHLIGHT_LEVELS[0] } : {}),
  }]);

  return <section className="proof-highlights">
    <ProofButton className="proof-highlights-toggle" variant="quiet" aria-expanded={expanded} aria-controls={panelId}
      onClick={() => setExpanded(!expanded)}>
      <span>作品集成果</span><span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
    </ProofButton>
    {!expanded && rows.some(({ highlight, compatible, conflict, isPrivate }) =>
      !compatible || (highlight.selected && (conflict || isPrivate))) &&
      <p className="proof-highlights-warning">有成果待核对。</p>}
    <div id={panelId} hidden={!expanded}>
      {expanded && <div className="proof-highlights-body">
        {eligibleModule && (item.presentationHighlights === undefined
          ? <div className="proof-highlights-actions">
            <p>当前从公开正文识别成果。开启手动管理后，只突出你勾选的成果。</p>
            <ProofButton variant="quiet" onClick={() => onChange([])}>手动管理成果</ProofButton>
          </div>
          : <p className="proof-microcopy">{automatic.size
            ? "已从作品集公开原文选出可核实的成果。你可以取消勾选，正文照常展示。"
            : "勾选后在作品集中突出展示。可以全部取消勾选，正文仍按模块的显示设置保留。"}</p>)}
        {eligibleModule && !visible && <p className="proof-microcopy">模块已隐藏。下方预览仅供核对。</p>}
        {rows.map(({ highlight, compatible, conflict, isPrivate }, index) => {
          const source = highlight.sourceBlockId && sourceExcerpt?.find(block => block.blockId === highlight.sourceBlockId);
          const evidence = highlight.origin === "source" && <div className="proof-entry-source">
            <p className="proof-entry-source-head">{source ? `PDF 来源 · 第 ${source.page} 页` : "PDF 来源暂不可用"}</p>
            {source && <p className="proof-entry-source-text">{source.text}</p>}
          </div>;
          const remove = <ProofButton variant="quiet" onClick={() => onChange(highlights.filter(entry => entry.id !== highlight.id))}>
            移除成果
          </ProofButton>;
          if (!compatible) {
            const target = highlight.type === "campus-metric" ? "校园经历" : "荣誉奖项";
            return <fieldset key={highlight.id} className="proof-highlight-row">
              <legend>成果 {index + 1} · 待核对</legend>
              <p>{`${highlight.label || "未命名成果"} ${highlight.value}${highlight.unit}`}</p>
              {evidence}
              <div className="proof-highlights-actions">
                <p className="proof-microcopy">移至{target}后可编辑和勾选。</p>{remove}
              </div>
            </fieldset>;
          }
          const valid = highlightIsValid(kind, highlight, true);
          const duplicate = highlights.some(other => other.id !== highlight.id && other.selected
            && highlightKey(other) === highlightKey(highlight));
          const unavailable = !valid || conflict || isPrivate || duplicate;
          const warning = conflict ? "与条目中的数值冲突，请核对标题、内容和用于网站的字段。"
            : isPrivate ? "成果包含未选用的字段，请核对。"
              : duplicate ? "已勾选同类成果，请先取消另一项。" : "";
          return <fieldset key={highlight.id} className="proof-highlight-row">
            <legend>成果 {index + 1}</legend>
            {evidence}
            <div className="proof-highlight-fields">
              <label className="proof-field"><span>名称</span>
                <input value={highlight.label} onChange={(event) => edit(highlight,
                  { label: [...event.target.value].slice(0, 80).join("") })} />
              </label>
              <label className="proof-field"><span>数值</span>
                <input value={highlight.value} inputMode={campus ? "decimal" : "numeric"} maxLength={32}
                  onChange={(event) => edit(highlight, { value: event.target.value.slice(0, 32) })} />
              </label>
              <label className="proof-field"><span>单位</span>
                <select value={highlight.unit} onChange={(event) => edit(highlight, { unit: event.target.value })}>
                  {units.map(unit => <option key={unit}>{unit}</option>)}
                </select>
              </label>
              {highlight.type === "award-tier" && <label className="proof-field"><span>级别</span>
                <select value={highlight.level} onChange={(event) => {
                  const level = event.target.value;
                  edit(highlight, { level, ...(highlight.label === highlight.level ? { label: level } : {}) });
                }}>
                  {HIGHLIGHT_LEVELS.map(level => <option key={level}>{level}</option>)}
                </select>
              </label>}
            </div>
            {warning && <p className="proof-highlights-warning" aria-live="polite">{warning}</p>}
            {!valid && <p className="proof-microcopy">填写名称和数值后即可勾选。数值示例 {campus ? "25 或 -2.5" : "25"}。</p>}
            <div className="proof-highlights-actions">
              <label className="proof-highlight-check">
                <input type="checkbox" checked={highlight.selected} disabled={!highlight.selected && unavailable}
                  onChange={(event) => replace({ ...highlight, selected: event.target.checked })} />
                突出展示
              </label>
              <output className="proof-highlight-preview" aria-label="预览">
                {unavailable ? "暂不突出展示" : <>{highlight.label.trim()} <strong>{highlight.value}{highlight.unit}</strong></>}
              </output>
              {remove}
            </div>
          </fieldset>;
        })}
        {eligibleModule && <div className="proof-highlights-actions">
          {campus ? <ProofButton variant="quiet" disabled={highlights.length >= MAX_HIGHLIGHTS}
            onClick={() => add("campus-metric")}>添加成果</ProofButton>
            : <>
              <ProofButton variant="quiet" disabled={highlights.length >= MAX_HIGHLIGHTS}
                onClick={() => add("award-total")}>添加获奖总数</ProofButton>
              <ProofButton variant="quiet" disabled={highlights.length >= MAX_HIGHLIGHTS}
                onClick={() => add("award-tier")}>添加分级统计</ProofButton>
            </>}
          {highlights.length >= MAX_HIGHLIGHTS && <p className="proof-microcopy">每条经历最多 {MAX_HIGHLIGHTS} 项成果。</p>}
        </div>}
      </div>}
    </div>
  </section>;
}
