import schema from '../schema/resume-draft.v1.json' with { type: 'json' };
import { cleanStructuredResume } from './validation.mjs';
import type { ResumeContent, ResumeEntry, ResumeFact, StructuredResumeV1 } from './config';
import { validateResumeSource, validateSchema } from './resume-source.ts';
export const RESUME_MODULE_MAPPING = { basicInfo: 'hero-profile', jobIntent: 'job-intent-strip', selfEvaluation: 'intro-card', education: 'education-timeline', workExperience: 'work-timeline', projects: 'project-stacked-cards', awards: 'award-badges', campusExperience: 'campus-timeline', skills: 'skill-tags', other: 'free-content-card' } as const;
export type ResumeModuleKind = keyof typeof RESUME_MODULE_MAPPING;
export type DraftFact = { key: string; label: string; value: string; included: boolean };
// 条目补充内容：用户手写的补充文字、相关链接与上传图片（可选字段，历史草稿没有）
export type ItemSupplements = { text: string; links: { url: string }[]; images: { imageId: string; caption: string }[] };
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
  const resume = { version: 'resume-v1' } as Record<string, unknown>;
  for (const s of draft.sections) {
    const selected = s.visible ? [...s.items].sort((a,b) => a.order-b.order).filter(i => i.included) : [];
    const facts = (i: ResumeDraftItem): ResumeFact[] => i.facts.filter(f => f.included).map(({key,label,value}) => ({key,label,value}));
    // Basic/contact and intent values are projected only from individually selected facts.
    resume[s.kind] = s.kind === 'basicInfo' || s.kind === 'jobIntent' ? selected.flatMap(facts) : selected.map(i => {
      const hidden = i.facts.filter(f => !f.included && f.value).map(f => f.value);
      const safe = (text: string) => hidden.some(value => text.includes(value)) ? '' : text;
      return { title: safe(i.title), details: safe(i.details), facts: facts(i) } satisfies ResumeEntry;
    });
  }
  const structured = cleanStructuredResume(resume) as unknown as StructuredResumeV1;
  const basic = (key: string) => structured.basicInfo.find(f => f.key === key)?.value.trim() ?? '';
  if (!basic('name') || !(basic('email') || basic('phone'))) throw new Error('Name and email or phone required');
  const entryText = (entry: ResumeEntry): string => [entry.title, entry.details].filter(Boolean).join('\n');
  const projectVisuals = ['mint', 'lilac', 'peach'] as const;
  return {
    profile: {
      name: basic('name'), role: structured.jobIntent.find(f => f.key === 'targetRole')?.value ?? '',
      location: basic('location'), availability: structured.jobIntent.find(f => f.key === 'availability')?.value ?? '',
      intro: '', summary: structured.selfEvaluation.map(entryText).join('\n'), email: basic('email')
    },
    expertise: { eyebrow: '', headline: '技能与专长', summary: '',
      skills: structured.skills.map(entryText).filter(Boolean), disciplines: [] },
    projects: structured.projects.map((entry, index) => ({
      id: `resume-project-${index + 1}`, index: String(index + 1).padStart(2, '0'),
      title: entry.title, category: '', year: '', description: entry.details,
      tags: [], visual: projectVisuals[index % projectVisuals.length]
    })),
    workExperience: structured.workExperience.map(entryText).filter(Boolean),
    campusExperience: structured.campusExperience.map(entryText).filter(Boolean),
    education: structured.education.map(entryText).filter(Boolean),
    resume: structured
  };
}
