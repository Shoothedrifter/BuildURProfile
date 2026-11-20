import type { ResumeDisplayItem } from "../../../../packages/contracts/src/config";

export type OptionalSectionKind = "campusExperience" | "awards";
type Highlight = { label: string; value: string; total?: true };

const campusFields = /^(?:organization|role|position|dateRange|period|组织|机构|角色|职务|岗位|时间|起止时间)$/iu;
const awardFields = /^(?:issuer|organizer|level|year|date|awardLevel|主办方|颁发机构|级别|年份|日期|获奖时间|获奖级别)$/iu;
const campusPeriod = /^((?:19|20)\d{2}[./年-]\d{1,2}月?\s*[-–—~～至]\s*(?:(?:19|20)\d{2}[./年-]\d{1,2}月?|至今|现在|present))(?=\s|[，,：:]|$)/iu;
const uncertain = /(?:未|没有|尚无|预计|计划|目标|有望|争取|力争|预期|拟|约|待确认)/u;
const resultPattern = /^(?:(?:实现|带动|使|推动|促进))?([\p{Script=Han}]{2,16}(?:增长|提升|提高|降低|下降|减少|缩短))\s*了?\s*([+-]?\d+(?:[.．]\d+)?\s*[%％])$/u;
const awardTotal = /(?:共获(?:得)?|累计获(?:得)?|合计|共计)\s*((?:学科)?竞赛奖项|奖项|获奖)\s*[:：]?\s*(\d+\s*(?:项|个|次))(?=\s*(?:[，,、。；;）)]|$))|(?:^|[，,；;。])\s*(获奖总数|奖项总数|(?:学科)?竞赛奖项)\s*[:：]?\s*(\d+\s*(?:项|个|次))(?=\s*(?:[，,、。；;）)]|$))/gu;
const awardLevel = /(?:^|[，,、；;：:]|其中|共获(?:得)?|累计获(?:得)?)\s*(国际级|国家级|省部级|省级|市级|校级)(?:竞赛奖项|奖项|奖)?\s*[:：]?\s*(\d+\s*(?:项|个|次))(?=\s*(?:[，,、。；;）)]|$))/gu;

function campusHighlights(lines: readonly string[]) {
  const results = new Map<string, Highlight>();
  for (const line of lines) {
    for (const clause of line.split(/[、，,；;。！？!?]/u)) {
      const plain = clause.trim();
      if (uncertain.test(plain)) continue;
      const match = plain.match(resultPattern);
      if (!match) continue;
      const [, label, value] = match;
      results.set(label + value, { label, value });
    }
  }
  return Array.from(results.values()).slice(0, 3);
}

function awardHighlights(lines: readonly string[]) {
  let total: Highlight | undefined;
  const levels = new Map<string, Highlight | null>();
  let conflictingTotal = false;
  for (const line of lines) {
    if (uncertain.test(line) || !/获奖|共获|奖项|获.{0,16}奖/u.test(line)) continue;
    for (const count of line.matchAll(awardTotal)) {
      const label = count[1] ?? count[3];
      const value = count[2] ?? count[4];
      if (total && total.value.replace(/\s/gu, "") !== value.replace(/\s/gu, "")) conflictingTotal = true;
      total ??= { label, value, total: true };
    }
    for (const [, label, value] of line.matchAll(awardLevel)) {
      const previous = levels.get(label);
      if (previous === null) continue;
      levels.set(label, previous && previous.value.replace(/\s/gu, "") !== value.replace(/\s/gu, "")
        ? null : { label, value });
    }
  }
  return [...(total && !conflictingTotal ? [total] : []), ...Array.from(levels.values()).filter(result => result !== null)];
}

export function presentOptionalEntry(item: ResumeDisplayItem, kind: OptionalSectionKind) {
  const campus = kind === "campusExperience";
  const fieldNames = campus ? campusFields : awardFields;
  const metadata = item.facts.filter(fact =>
    fact.value.trim() && (fieldNames.test(fact.key.trim()) || fieldNames.test(fact.label.trim())));
  const lines = [item.title, item.details, ...item.facts.map(fact => fact.label + "：" + fact.value)]
    .flatMap(value => value.split(/\r?\n/u));
  const period = campus ? item.details.trimStart().match(campusPeriod)?.[1] : undefined;
  const showPeriod = period && !metadata.some(fact => fact.value.trim() === period);
  const summary = showPeriod
    ? item.details.trimStart().slice(period.length).replace(/^[\s，,：:]+/u, "")
    : item.details;
  return {
    summary,
    period: showPeriod ? period : undefined,
    metadata,
    highlights: campus ? campusHighlights(lines) : awardHighlights(lines),
    supplementalFacts: item.facts.filter(fact => !metadata.includes(fact))
  };
}
