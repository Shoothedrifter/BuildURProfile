import type { ResumeDraftItemV2, ResumeDraftV2, ResumeModuleKind } from '../../../../packages/contracts/src/resume-draft';

const multiItemKinds = new Set<ResumeModuleKind>(['workExperience', 'projects', 'awards', 'campusExperience']);
const supplementsOf = (item: ResumeDraftItemV2) =>
  item.supplements ?? { text: '', links: [], images: [] };
const withEdited = (item: ResumeDraftItemV2, ...fields: string[]) =>
  [...new Set([...item.editedFields, ...fields])];

export function moveResumeSection(draft: ResumeDraftV2, kind: ResumeModuleKind, delta: number): ResumeDraftV2 {
  const next = structuredClone(draft);
  const sections = [...next.sections].sort((a, b) => a.order - b.order);
  const index = sections.findIndex(section => section.kind === kind), target = index + delta;
  if (index < 0 || target < 0 || target >= sections.length) return next;
  [sections[index], sections[target]] = [sections[target], sections[index]];
  next.sections = sections.map((section, order) => ({ ...section, order }));
  return next;
}

export function moveResumeItem(draft: ResumeDraftV2, kind: ResumeModuleKind, itemId: string, delta: number): ResumeDraftV2 {
  const next = structuredClone(draft);
  const section = next.sections.find(section => section.kind === kind);
  if (!section) throw new Error('模块不存在。');
  const items = [...section.items].sort((a, b) => a.order - b.order);
  const index = items.findIndex(item => item.itemId === itemId), target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return next;
  [items[index], items[target]] = [items[target], items[index]];
  section.items = items.map((item, order) => ({ ...item, order }));
  return next;
}

export function splitResumeItem(draft: ResumeDraftV2, kind: ResumeModuleKind, itemId: string,
  boundary: number, newId: string): ResumeDraftV2 {
  if (!multiItemKinds.has(kind)) throw new Error('该模块不支持拆分条目。');
  const next = structuredClone(draft);
  const section = next.sections.find(section => section.kind === kind);
  const index = section?.items.findIndex(item => item.itemId === itemId) ?? -1;
  if (!section || index < 0 || next.sections.some(s => s.items.some(i => i.itemId === newId))) throw new Error('条目不存在或 ID 已存在。');
  const item = section.items[index];
  const paragraphs = item.details.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean);
  // 详情原文按自身空行段落用同一边界切分；段落数不足边界时 slice 天然让前条保留全部、后条为空串
  const sourceParagraphs = (item.sourceText ?? '').split(/\n\s*\n/).map(text => text.trim()).filter(Boolean);
  if (!Number.isInteger(boundary) || boundary <= 0 || boundary >= paragraphs.length) throw new Error('请选择两段之间的拆分位置。');
  const first = { ...item, details: paragraphs.slice(0, boundary).join('\n\n'),
    sourceText: sourceParagraphs.slice(0, boundary).join('\n\n'), needsReview: true,
    editedFields: withEdited(item, 'details', 'sourceText') };
  const second: ResumeDraftItemV2 = { ...item, itemId: newId, title: '', details: paragraphs.slice(boundary).join('\n\n'),
    sourceText: sourceParagraphs.slice(boundary).join('\n\n'),
    facts: [], supplements: { text: '', links: [], images: [] }, included: false, needsReview: true,
    derivedFromItemId: itemId, editedFields: ['details', 'sourceText'] };
  section.items.splice(index, 1, first, second);
  section.items = section.items.map((entry, order) => ({ ...entry, order }));
  return next;
}

export function mergeResumeItems(draft: ResumeDraftV2, kind: ResumeModuleKind, firstId: string,
  secondId: string, assetChoice: 'combine' | 'first' | 'second'): ResumeDraftV2 {
  if (!multiItemKinds.has(kind)) throw new Error('该模块不支持合并条目。');
  const next = structuredClone(draft);
  const section = next.sections.find(section => section.kind === kind);
  const index = section?.items.findIndex(item => item.itemId === firstId) ?? -1;
  if (!section || index < 0 || section.items[index + 1]?.itemId !== secondId) throw new Error('只能与下一条经历合并。');
  const first = section.items[index], second = section.items[index + 1];
  const a = supplementsOf(first), b = supplementsOf(second);
  const supplements = assetChoice === 'first' ? a : assetChoice === 'second' ? b : {
    text: [a.text, b.text].filter(Boolean).join('\n\n'),
    links: [...a.links, ...b.links], images: [...a.images, ...b.images]
  };
  if (supplements.images.length > 6 || supplements.links.length > 5 || [...supplements.text].length > 500)
    throw new Error('合并后的补充内容超过单条上限，请先调整图片、链接或文字。');
  const facts = [...first.facts];
  for (const fact of second.facts) {
    const existing = facts.find(entry => entry.key === fact.key);
    if (existing && (existing.value !== fact.value || existing.included !== fact.included))
      throw new Error('两条经历的同名字段不同，请先手动处理。');
    if (!existing) facts.push(fact);
  }
  const mergedDetails = [first.details, second.title && second.title !== first.title ? second.title : '',
    second.details].filter(Boolean).join('\n\n');
  if ([...mergedDetails].length > 12000) throw new Error('合并后的内容超过单条上限。');
  // 详情原文以空行连接；存量草稿可能携带显式 null，filter(Boolean) 天然过滤
  const mergedSourceText = [first.sourceText, second.sourceText].filter(Boolean).join('\n\n');
  if ([...mergedSourceText].length > 12000) throw new Error('合并后的详情原文超过单条上限。');
  section.items.splice(index, 2, { ...first, details: mergedDetails,
    sourceText: mergedSourceText,
    facts, sourceBlockIds: [...new Set([...first.sourceBlockIds, ...second.sourceBlockIds])],
    supplements, needsReview: true, editedFields: withEdited(first, 'details', 'sourceText') });
  section.items = section.items.map((item, order) => ({ ...item, order }));
  return next;
}
