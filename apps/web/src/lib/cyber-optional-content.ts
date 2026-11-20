import type { ResumeDisplayItem } from "../../../../packages/contracts/src/config";
import { extractPresentationHighlights } from "../../../../packages/contracts/src/presentation-highlights.mjs";

export type OptionalSectionKind = "campusExperience" | "awards";
type Highlight = { id?: string; label: string; value: string; total?: true };

const campusFields = /^(?:organization|role|position|dateRange|period|组织|机构|角色|职务|岗位|时间|起止时间)$/iu;
const awardFields = /^(?:issuer|organizer|level|year|date|awardLevel|主办方|颁发机构|级别|年份|日期|获奖时间|获奖级别)$/iu;
const campusPeriod = /^(?:(?:时间|起止时间|任期)\s*[:：]\s*)?((?:[1１][9９]|[2２][0０])[\d０-９]{2}[./年-][\d０-９]{1,2}月?\s*[-–—~～至]\s*(?:(?:[1１][9９]|[2２][0０])[\d０-９]{2}[./年-][\d０-９]{1,2}月?|今|至今|现在|present))(?=\s|[，,：:]|$)/iu;

export function presentOptionalEntry(item: ResumeDisplayItem, kind: OptionalSectionKind) {
  const campus = kind === "campusExperience";
  const fieldNames = campus ? campusFields : awardFields;
  const metadata = item.facts.filter(fact =>
    fact.value.trim() && (fieldNames.test(fact.key.trim()) || fieldNames.test(fact.label.trim())));
  const dates = campus ? item.details.trimStart().match(campusPeriod) : null;
  const period = dates?.[1];
  const showPeriod = dates && !metadata.some(fact => fact.value.trim() === period);
  const summary = showPeriod
    ? item.details.trimStart().slice(dates[0].length).replace(/^[\s，,：:]+/u, "")
    : item.details;
  const inferred = () => extractPresentationHighlights(kind, [
    { text: item.title }, { text: item.details, breakContext: true },
    ...item.facts.map(fact => ({ text: fact.label + "：" + fact.value, breakContext: true }))
  ]).candidates.slice(0, campus ? 3 : undefined);
  const highlights: Highlight[] = (item.presentationHighlights ?? inferred()).map(highlight => ({
    label: highlight.label, value: highlight.value + highlight.unit,
    ...("id" in highlight ? { id: String(highlight.id) } : {}),
    ...(highlight.type === "award-total" ? { total: true as const } : {})
  }));
  return {
    summary, period: showPeriod ? period : undefined, metadata, highlights,
    supplementalFacts: item.facts.filter(fact => !metadata.includes(fact))
  };
}
