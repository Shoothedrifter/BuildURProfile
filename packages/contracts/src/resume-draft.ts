import { resumeV1View, resumeDisplayContent, validHttpUrl } from './resume-v2.mjs';
import schema from '../schema/resume-draft.v1.json' with { type: 'json' };
import { cleanStructuredResume } from './validation.mjs';
import type { ResumeContent, StructuredResumeV1, StructuredResumeV2 } from './config';
import { validateResumeSource, validateSchema } from './resume-source.ts';
export const RESUME_MODULE_MAPPING = { basicInfo: 'hero-profile', jobIntent: 'job-intent-strip', selfEvaluation: 'intro-card', education: 'education-timeline', workExperience: 'work-timeline', projects: 'project-stacked-cards', awards: 'award-badges', campusExperience: 'campus-timeline', skills: 'skill-tags', other: 'free-content-card' } as const;
export type ResumeModuleKind = keyof typeof RESUME_MODULE_MAPPING;
export type DraftFact = { key: string; label: string; value: string; included: boolean };
// 条目补充内容：用户手写的补充文字、相关链接与上传图片（可选字段，历史草稿没有）
export type ItemSupplements = { text: string; links: { label?: string; url: string }[]; images: { imageId: string; caption: string }[] };
export type ResumeDraftItem = { itemId: string; order: number; title: string; details: string; facts: DraftFact[]; sourceBlockIds: string[]; confidence: number; segmentationConfidence: number; needsReview: boolean; included: boolean; origin: 'agent' | 'user'; supplements?: ItemSupplements };
export type ResumeDraftSection = { id: ResumeModuleKind; kind: ResumeModuleKind; mappedDesignModule: string; order: number; visible: boolean; items: ResumeDraftItem[] };
export type ResumeDraftV1 = { version: 'resume-draft-v1'; resumeId: string; fileId: string; revision: number; sections: ResumeDraftSection[] };
function validateShape(raw: unknown): ResumeDraftV1 {
  validateSchema(raw, schema);
  const draft = raw as ResumeDraftV1;
  const unique = (values: unknown[]) => new Set(values).size === values.length;
  if (!unique(draft.sections.map(s => s.kind)) || !unique(draft.sections.map(s => s.order)) || !unique(draft.sections.flatMap(s => s.items.map(i => i.itemId)))) throw new Error('Duplicate module/item');
  for (const s of draft.sections) {
    if (s.id !== s.kind || s.mappedDesignModule !== RESUME_MODULE_MAPPING[s.kind] || !unique(s.items.map(i => i.order))) throw new Error('Invalid module mapping/order');
    for (const i of s.items) if (i.origin === 'agent' && !i.sourceBlockIds.length || !unique(i.sourceBlockIds) || !unique(i.facts.map(f => f.key))) throw new Error('Invalid evidence/facts');
  }
  const images = draft.sections.flatMap(s => s.items.flatMap(i => i.supplements?.images ?? []));
  if (images.length > 24) throw new Error('每份简历最多 24 张图片。');
  for (const s of draft.sections) for (const i of s.items) for (const link of i.supplements?.links ?? []) if (!validHttpUrl(link.url)) throw new Error('链接须为有效 HTTP(S) 地址。');
  return structuredClone(draft);
}
/** Cross-reference checks require the actual same-file source, never model-supplied IDs. */
export function validateResumeDraft(raw: unknown, rawSource: unknown): ResumeDraftV1 {
  const draft = validateShape(raw), source = validateResumeSource(rawSource);
  const ids = new Set(source.blocks.map(b => b.blockId));
  if (draft.fileId !== source.fileId || draft.sections.some(s => s.items.some(i => i.sourceBlockIds.some(id => !ids.has(id))))) throw new Error('Unknown PDF evidence');
  return draft;
}
/** Explicit allowlist projection. Private provenance and hidden values never enter generation. */
export function projectConfirmedResume(raw: ResumeDraftV1): ResumeContent {
  const draft = validateShape(raw);
  if (draft.sections.some(s => s.items.some(i => i.needsReview))) throw new Error('请先完成待核对条目。');
  const sections = (Object.keys(RESUME_MODULE_MAPPING) as ResumeModuleKind[]).flatMap(kind => {
    const s = draft.sections.find(s => s.kind === kind)!;
    if (!s.visible) return [];
    const items = [...s.items].sort((a,b) => a.order-b.order).filter(i => i.included).map(i => {
      const hidden = i.facts.filter(f => !f.included && f.value).map(f => f.value);
      const safe = (text: string) => hidden.some(v => text.includes(v)) ? '' : text;
      const supplement = {text:i.supplements?.text ?? '', links:(i.supplements?.links ?? []).map(l=>({label:l.label ?? '',url:l.url})),images:i.supplements?.images ?? []};
      if (hidden.some(v => [supplement.text,...supplement.links.flatMap(l=>[l.label,l.url,decodeURIComponent(l.url)]),...supplement.images.map(m=>m.caption)].some(t=>t.includes(v)))) throw new Error('补充内容包含未勾选字段，请移除后重试。');
      return {itemId:i.itemId,title: ['basicInfo','jobIntent'].includes(kind)?'':safe(i.title),details:['basicInfo','jobIntent'].includes(kind)?'':safe(i.details), facts:i.facts.filter(f=>f.included).map(({key,label,value})=>({key,label,value})),supplement};
    });
    return items.length ? [{kind,items}] : [];
  });
  const resume = cleanStructuredResume({version:'resume-v2',sections}) as unknown as StructuredResumeV2;
  const structured = cleanStructuredResume(resumeV1View(resume)) as unknown as StructuredResumeV1;
  const basic = (key: string) => structured.basicInfo.find(f => f.key === key)?.value.trim() ?? '';
  if (!basic('name') || !(basic('email') || basic('phone'))) throw new Error('Name and email or phone required');
  const content = resumeDisplayContent(resume) as ResumeContent;
  // Reserve the exact fixed assessment envelope using the longest supported role.
  const envelope = { role: 'frontend-creative-developer', answers: {
    'e-presence': 3, 'e-type': 3, 'k-pace': 3, 'k-cards': 3,
    'p-tone': 3, 'p-strength': 3, 's-browse': 3, 's-control': 3
  }, content };
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > 256 * 1024) {
    throw new Error('生成内容超过 256 KiB，请精简展示内容；草稿内容未被截断。');
  }
  return content;
}
