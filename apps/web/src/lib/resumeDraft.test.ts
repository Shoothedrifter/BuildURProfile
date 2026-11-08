import { describe, expect, it } from 'vitest';
import * as contracts from '../../../../packages/contracts/src/resume-draft';
import fixture from '../../../../packages/contracts/fixtures/resume-draft.v1.json';
import source from '../../../../packages/contracts/fixtures/resume-source.v1.json';

describe('private resume contracts', () => {
  it('accepts ten modules and projects only selected source-free content', () => {
    const draft = contracts.validateResumeDraft(fixture, source);
    const content = contracts.projectConfirmedResume(draft);
    expect(content.profile.name).toBe('合成用户');
    expect(content.profile.email).toBe('synthetic@example.test');
    expect(JSON.stringify(content)).not.toMatch(/sourceBlockIds|confidence|fileId|秘密电话|source text/);
    expect(content.resume?.workExperience).toEqual([]);
  });
  it.each(['missing', 'duplicate', 'mapping', 'source', 'length', 'confidence', 'extra', 'id'])('rejects invalid %s at the boundary', (mode) => {
    const draft = structuredClone(fixture);
    if (mode === 'missing') draft.sections.pop();
    if (mode === 'duplicate') draft.sections[9] = draft.sections[0];
    if (mode === 'mapping') draft.sections[0].mappedDesignModule = 'campus-timeline';
    if (mode === 'source') draft.sections[0].items[0].sourceBlockIds = ['missing'];
    if (mode === 'length') draft.sections[0].items[0].title = 'x'.repeat(301);
    if (mode === 'confidence') draft.sections[0].items[0].confidence = 1.01;
    if (mode === 'extra') Object.assign(draft, { source: 'private' });
    if (mode === 'id') draft.resumeId = '../unsafe';
    expect(() => contracts.validateResumeDraft(draft, source)).toThrow();
  });
  it('allows user additions without evidence but refuses agent additions without evidence', () => {
    const draft = structuredClone(fixture);
    draft.sections[0].items[0].sourceBlockIds = [];
    expect(() => contracts.validateResumeDraft(draft, source)).toThrow();
    draft.sections[0].items[0].origin = 'user';
    expect(contracts.validateResumeDraft(draft, source).sections).toHaveLength(10);
  });
  it('rejects confirmation without a name and contact', () => {
    const draft = structuredClone(fixture);
    draft.sections[0].items[0].facts = [];
    expect(() => contracts.projectConfirmedResume(contracts.validateResumeDraft(draft, source))).toThrow();
  });
});

it('blocks oversized arrays and private text copied into display prose', () => {
  const draft = structuredClone(fixture);
  draft.sections[4].items = [{ ...draft.sections[0].items[0], itemId: 'item_work', title: '秘密电话', details: '秘密电话', sourceBlockIds: ['block_1'] }];
  const content = contracts.projectConfirmedResume(contracts.validateResumeDraft(draft, source));
  expect(content.resume?.workExperience[0]).toEqual({ title: '', details: '', facts: [{key:'name',label:'name',value:'合成用户'},{key:'email',label:'email',value:'synthetic@example.test'}] });
  draft.sections[4].items[0].facts = Array.from({length:101}, (_,i) => ({ key: `key_${i}`, label:'',value:'',included:true }));
  expect(() => contracts.validateResumeDraft(draft, source)).toThrow();
});

it('refuses a confirmed fact list exceeding the legacy display contract', () => {
  const draft = structuredClone(fixture);
  draft.sections[0].items = Array.from({ length: 34 }, (_,n) => ({ ...draft.sections[0].items[0], itemId:`item_${n}`, order:n, facts:[{key:'name',label:'',value:'合成用户',included:true},{key:'email',label:'',value:'synthetic@example.test',included:true},{key:'location',label:'',value:'上海',included:true}] }));
  expect(() => contracts.projectConfirmedResume(contracts.validateResumeDraft(draft, source))).toThrow();
});

it.each(['date', 'retention', 'duplicate', 'page', 'bbox', 'order'])('rejects invalid PDF source %s', async (mode) => {
  const { validateResumeSource } = await import('../../../../packages/contracts/src/resume-source');
  const raw = structuredClone(source);
  if (mode === 'date') raw.uploadedAt = '2026-02-30T00:00:00Z';
  if (mode === 'retention') raw.expiresAt = '2026-12-10T00:00:00Z';
  if (mode === 'duplicate') raw.blocks.push(raw.blocks[0]);
  if (mode === 'page') raw.blocks[0].page = 2;
  if (mode === 'bbox') raw.blocks[0].bbox = [100, 0, 0, 20];
  if (mode === 'order') raw.blocks.push({...raw.blocks[0],blockId:'block_2'});
  expect(() => validateResumeSource(raw)).toThrow();
});
