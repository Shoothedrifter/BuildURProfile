import { resumeV1View } from '../../../../packages/contracts/src/resume-v2.mjs';
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
    expect(resumeV1View(content.resume)?.workExperience).toEqual([]);
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
  it('accepts item supplements within limits and enforces their caps', () => {
    const draft = structuredClone(fixture) as contracts.ResumeDraftV1;
    const item = draft.sections[0].items[0];
    item.supplements = { text: '补充说明', links: [{ url: 'https://example.com/work' }],
      images: [{ imageId: 'img_1', caption: '作品截图' }] };
    expect(contracts.validateResumeDraft(draft, source).sections[0].items[0].supplements)
      .toEqual(item.supplements);
    // 历史草稿没有 supplements 字段，必须继续通过校验
    delete item.supplements;
    expect(contracts.validateResumeDraft(draft, source).sections[0].items[0].supplements).toBeUndefined();
    // 补充文字 ≤500、链接 ≤5 条且不可为空串、图片 ≤6 张、说明 ≤80 字
    item.supplements = { text: 'x'.repeat(501), links: [], images: [] };
    expect(() => contracts.validateResumeDraft(draft, source)).toThrow();
    item.supplements = { text: '', links: Array.from({ length: 6 }, () => ({ url: 'https://a.b' })), images: [] };
    expect(() => contracts.validateResumeDraft(draft, source)).toThrow();
    item.supplements = { text: '', links: [{ url: '' }], images: [] };
    expect(() => contracts.validateResumeDraft(draft, source)).toThrow();
    item.supplements = { text: '', links: [], images: Array.from({ length: 7 }, (_, i) => ({ imageId: `img_${i}`, caption: '' })) };
    expect(() => contracts.validateResumeDraft(draft, source)).toThrow();
    item.supplements = { text: '', links: [], images: [{ imageId: 'img_1', caption: 'x'.repeat(81) }] };
    expect(() => contracts.validateResumeDraft(draft, source)).toThrow();
    item.supplements = { text: '', links: [], images: [{ imageId: '../escape', caption: '' }] };
    expect(() => contracts.validateResumeDraft(draft, source)).toThrow();
  });
});

it('blocks oversized arrays and private text copied into display prose', () => {
  const draft = structuredClone(fixture);
  draft.sections[4].items = [{ ...draft.sections[0].items[0], itemId: 'item_work', title: '秘密电话', details: '秘密电话', sourceBlockIds: ['block_1'] }];
  const content = contracts.projectConfirmedResume(contracts.validateResumeDraft(draft, source));
  expect(resumeV1View(content.resume)?.workExperience[0]).toEqual({ title: '', details: '', facts: [{key:'name',label:'name',value:'合成用户'},{key:'email',label:'email',value:'synthetic@example.test'}] });
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

it.each(['\u0000', '😀'.repeat(6001)])('rejects confirmed prose incompatible with the display boundary', (details) => {
  const draft = structuredClone(fixture);
  draft.sections[4].items = [{ ...draft.sections[0].items[0], itemId: 'item_work', details }];
  const validated = contracts.validateResumeDraft(draft, source);
  expect(() => contracts.projectConfirmedResume(validated)).toThrow();
});

it('preserves supplementary Unicode within the confirmed display limit', () => {
  const draft = structuredClone(fixture);
  draft.sections[4].items = [{ ...draft.sections[0].items[0], itemId: 'item_work', details: '😀'.repeat(6000) }];
  expect(resumeV1View(contracts.projectConfirmedResume(contracts.validateResumeDraft(draft, source)).resume)?.workExperience[0].details).toBe('😀'.repeat(6000));
});

it('projects selected Agent experience into the existing showcase fields', () => {
  const draft = structuredClone(fixture);
  draft.sections[4].items = [{ ...draft.sections[0].items[0], itemId: 'work_1', order: 0,
    title: '示例公司', details: '前端开发', facts: [], sourceBlockIds: ['block_1'], included: true }];
  draft.sections[5].items = [{ ...draft.sections[0].items[0], itemId: 'project_1', order: 0,
    title: '示例项目', details: '合成说明', facts: [], sourceBlockIds: ['block_1'], included: true }];
  draft.sections[4].visible = true;
  draft.sections[5].visible = true;
  const content = contracts.projectConfirmedResume(contracts.validateResumeDraft(draft, source));
  expect(content.workExperience).toContain('示例公司\n前端开发');
  expect(content.projects[0]).toMatchObject({ title: '示例项目', description: '合成说明' });
  expect(JSON.stringify(content)).not.toContain('sourceBlockIds');
});
