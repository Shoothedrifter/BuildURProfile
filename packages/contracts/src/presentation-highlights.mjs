export const HIGHLIGHT_LEVELS = ['国际级', '国家级', '省部级', '省级', '市级', '校级'];
export const AWARD_UNITS = ['项', '个', '次'];
export const CAMPUS_UNITS = ['%', '百分点', '人', '人次', '场', '篇', '期', '次', '项', '个', '万'];
export const MAX_HIGHLIGHTS = 12;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u;
const valuePattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const uncertain = /未|没有|尚无|预计|计划|目标|有望|争取|力争|预期|暂定|拟|约|待确认/u;
const resultPrefix = /^(?:成果|成效|业绩|量化成果)[:：]/u;
const resultVerb = /^(?:实现|带动|使|推动|促进)/u;
const campusMetric = /^([\p{Script=Han}]{2,24}?(?:增长|提升|提高|降低|下降|减少|缩短|达到|突破|量|人数|人次|场次|篇数|期数|次数|数))了?[:：]?([+-]?\d+(?:\.\d+)?)(百分点|人次|[%人场篇期次项个万])$/u;
const tally = /(?:(?:共获(?:得)?|累计获(?:得)?)(?:(学科竞赛|竞赛)奖项?|(学科竞赛|竞赛)|奖项|获奖)?|(?:合计|共计)(?:(学科竞赛|竞赛)奖项?|奖项|获奖)|获奖总数|奖项总数|(?:(学科竞赛|竞赛)奖项|奖项))[:：]?(\d+)([项个次])$/u;
const tier = /^(?:(?:其中|包括|包含|分为):?|共获(?:得)?|累计获(?:得)?)?(国际级|国家级|省部级|省级|市级|校级)(竞赛)?(奖项|奖)?[:：]?(\d+)([项个次])$/u;
const awardBreakdown = /(?<=[项个次]):(?=(?:国际级|国家级|省部级|省级|市级|校级))/u;

export const normalizeHighlightText = (text) => text.normalize('NFKC').replace(/[^\S\r\n]+/gu, '');
const numeric = (value) => {
  const magnitude = value.replace(/^[+-]/u, '').replace(/^0+(?=\d)/u, '')
    .replace(/(\.\d*?[1-9])0+$|\.0+$/u, '$1');
  return value.startsWith('-') && magnitude !== '0' ? '-' + magnitude : magnitude;
};
export const highlightKey = (highlight) => highlight.type === 'award-tier'
  ? highlight.type + ':' + highlight.level : highlight.type === 'award-total'
    ? highlight.type : highlight.type + ':' + normalizeHighlightText(highlight.label).replace(/^平台(?=粉丝)/u, '');

export const supportsHighlights = (kind) => kind === 'campusExperience' || kind === 'awards';

export function highlightIsValid(kind, entry, confirmed) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !supportsHighlights(kind)) return false;
  const { id, type, label, value, unit, level } = entry;
  const campus = kind === 'campusExperience';
  if (typeof id !== 'string' || !idPattern.test(id)
      || (campus ? type !== 'campus-metric' : !['award-total', 'award-tier'].includes(type))
      || typeof label !== 'string' || [...label].length > 80 || /[\0\r\n]/u.test(label)
      || typeof value !== 'string' || value.length > 32 || /[\0\r\n]/u.test(value)
      || !(campus ? CAMPUS_UNITS : AWARD_UNITS).includes(unit)
      || (type === 'award-tier' ? !HIGHLIGHT_LEVELS.includes(level) : 'level' in entry)) return false;
  return !confirmed || Boolean(label.trim() && valuePattern.test(value) && (campus || /^\d+$/u.test(value)));
}

function validList(kind, entries, draft, sourceBlockIds = []) {
  if ((!draft && !supportsHighlights(kind)) || !Array.isArray(entries) || entries.length > MAX_HIGHLIGHTS) return false;
  const ids = new Set(), confirmed = new Set();
  return entries.every(entry => {
    const isConfirmed = !draft || entry?.selected === true;
    // A moved row can remain private for review in a section where it cannot be selected.
    const rowKind = isConfirmed ? kind : entry?.type === 'campus-metric' ? 'campusExperience' : 'awards';
    if (!highlightIsValid(rowKind, entry, isConfirmed)) return false;
    if (ids.has(entry.id)) return false;
    ids.add(entry.id);
    const allowed = ['id', 'type', 'label', 'value', 'unit', 'level'];
    if (draft) {
      allowed.push('selected', 'origin', 'sourceBlockId');
      if (typeof entry.selected !== 'boolean'
          || !['user', 'source'].includes(entry.origin)
          || (entry.origin === 'source'
            ? typeof entry.sourceBlockId !== 'string' || !sourceBlockIds.includes(entry.sourceBlockId)
            : 'sourceBlockId' in entry)) return false;
    }
    if (Object.keys(entry).some(key => !allowed.includes(key))) return false;
    if (!draft || entry.selected) {
      const key = highlightKey(entry);
      if (confirmed.has(key)) return false;
      confirmed.add(key);
    }
    return true;
  });
}

export const validDraftHighlights = (kind, item) => !('presentationHighlights' in item)
  || validList(kind, item.presentationHighlights, true, item.sourceBlockIds);
export const validPublicHighlights = (kind, item) => !('presentationHighlights' in item)
  || validList(kind, item.presentationHighlights, false);

export function highlightConflictsWithText(kind, highlight, texts) {
  const extraction = extractPresentationHighlights(kind, texts.map(text => ({ text, breakContext: true })));
  const key = highlightKey(highlight);
  const explicit = extraction.recognized.get(key);
  return extraction.conflicts.has(key)
    || Boolean(explicit && (numeric(highlight.value) !== explicit.value || highlight.unit !== explicit.unit));
}

export function highlightIsPrivate(highlight, hiddenValues) {
  const forComparison = (text) => normalizeHighlightText(text).replace(/[+-]?\d+(?:\.\d+)?/gu, numeric)
    .replace(/[\r\n:、,()。;!?\[\]{}「」“”"'‘’]|(?<!\d)\./gu, '');
  const amount = highlight.value + highlight.unit;
  const level = highlight.level ?? '';
  const publicTexts = [highlight.label, level, amount, highlight.label + amount, level + amount].map(forComparison);
  return hiddenValues.some(value => {
    const hidden = forComparison(value);
    return hidden && publicTexts.some(text => text.includes(hidden));
  });
}

/** Default selection uses only figures still backed by the item's public source excerpt. */
export function automaticDraftHighlightIds(kind, item) {
  const ids = new Set();
  const rows = item.presentationHighlights;
  if (!supportsHighlights(kind) || !item.sourceText || !rows?.length
      || item.editedFields?.includes('presentationHighlights') || rows.some(row => row.selected)) return ids;
  const { candidates } = extractPresentationHighlights(kind, [{ text: item.sourceText }]);
  const evidence = new Map(candidates.map(candidate => [highlightKey(candidate), candidate]));
  const hidden = item.facts.filter(fact => !fact.included && fact.value).map(fact => fact.value);
  const confirmed = [item.title, item.details, ...item.facts.filter(fact => fact.included)
    .map(fact => fact.label + '：' + fact.value)];
  for (const row of rows) {
    if (row.origin !== 'source' || !item.sourceBlockIds.includes(row.sourceBlockId)
        || !highlightIsValid(kind, row, true) || highlightIsPrivate(row, hidden)) continue;
    const key = highlightKey(row);
    const source = evidence.get(key);
    if (source && source.value === numeric(row.value) && source.unit === row.unit
        && !highlightConflictsWithText(kind, row, confirmed)) {
      ids.add(row.id);
      evidence.delete(key);
    }
  }
  return ids;
}

/** Extract only explicit matches within one item. Each input retains its evidence identity. */
export function extractPresentationHighlights(kind, inputs) {
  const found = new Map();
  const conflicts = new Set();
  function record(highlight, sourceBlockId) {
    const key = highlightKey(highlight);
    const existing = found.get(key);
    if (existing && (existing.value !== highlight.value || existing.unit !== highlight.unit)) conflicts.add(key);
    else if (!existing) found.set(key, { ...highlight, sourceBlockId });
  }
  let awardContext = false;
  for (const { text, sourceBlockId, breakContext } of inputs) {
    if (breakContext) awardContext = false;
    for (const line of normalizeHighlightText(text).split(/\r?\n/u)) {
      if (!line) awardContext = false;
      for (const sentence of line.split(/[。!?;]/u)) {
        const parts = sentence.replace(resultPrefix, '').split(/[,、()]/u);
        const clauses = kind === 'awards' ? parts.flatMap(part => part.split(awardBreakdown)) : parts;
        const uncertainSentence = uncertain.test(clauses[0] ?? '');
        for (const clause of clauses) {
          if (!clause) continue;
          if (uncertainSentence || uncertain.test(clause)) {
            awardContext = false;
            continue;
          }
          if (kind === 'campusExperience') {
            const match = clause.replace(resultVerb, '').replace(/^平台(?=粉丝)/u, '').match(campusMetric);
            if (match) record({ type: 'campus-metric', label: match[1], value: numeric(match[2]), unit: match[3] }, sourceBlockId);
            continue;
          }
          if (kind !== 'awards') continue;
          const match = clause.match(tally);
          const category = match && (match[1] || match[2] || match[3] || match[4]);
          if (match && (!match.index || /^(?:本科期间|在校期间|期间|[\p{Script=Han}]{0,12}(?:期间|共))$/u.test(clause.slice(0, match.index)))) {
            record({ type: 'award-total', label: category ? category + '奖项' : '奖项', value: numeric(match[5]), unit: match[6] }, sourceBlockId);
            awardContext = true;
            continue;
          }
          const level = clause.match(tier);
          if (level && (awardContext || level[3] || /^(?:共获|累计获)/u.test(clause))) {
            record({ type: 'award-tier', label: level[1], level: level[1], value: numeric(level[4]), unit: level[5] }, sourceBlockId);
            awardContext = true;
          } else {
            awardContext = false;
          }
        }
      }
    }
  }
  const candidates = [...found].filter(([key]) => !conflicts.has(key)).map(([, highlight]) => highlight);
  if (kind === 'awards') candidates.sort((a, b) => Number(b.type === 'award-total') - Number(a.type === 'award-total'));
  return { candidates, recognized: found, conflicts };
}
