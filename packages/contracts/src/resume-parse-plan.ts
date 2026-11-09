import schema from '../schema/resume-parse-plan.v1.json' with { type: 'json' };
import { validateSchema } from './resume-source.ts';
import type { ResumeModuleKind } from './resume-draft.ts';

export type ResumeParseAnchorV1 = { anchorId: string; kind: ResumeModuleKind; page: number; text: string };
export type ResumeParsePlanV1 = { version: 'resume-parse-plan-v1'; anchors: ResumeParseAnchorV1[] };

export function validateResumeParsePlan(raw: unknown): ResumeParsePlanV1 {
  validateSchema(raw, schema);
  const plan = raw as ResumeParsePlanV1;
  if (plan.anchors.some((anchor, index) => anchor.anchorId !== `a${index}` || !anchor.text.trim()) ||
      plan.anchors.reduce((length, anchor) => length + anchor.text.length, 0) > 200_000) {
    throw new Error('Invalid private resume plan');
  }
  return structuredClone(plan);
}
