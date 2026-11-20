import { expect, it } from 'vitest';
import { applyLocalDelta, makeLocalDelta } from './resumeLocalDraft';
import { normalizeResumeDraft } from '../../../../packages/contracts/src/resume-draft';
import fixture from '../../../../packages/contracts/fixtures/resume-draft.v1.json';
import { mergeResumeItems, splitResumeItem } from './resumeEdit';

it('stores only unsaved changes, excludes PDF provenance and restores within the same scope and revision',()=>{
  const base=normalizeResumeDraft(fixture);
  const changed=structuredClone(base);
  changed.sections[0].items[0].title='人工改写';
  changed.sections[0].order=1;changed.sections[1].order=0;
  const delta=makeLocalDelta(base,changed,'scope-a','resume-a','2099-01-01T00:00:00Z');
  const encoded=JSON.stringify(delta);
  expect(encoded).toContain('人工改写');
  expect(encoded).not.toMatch(/sourceBlockIds|confidence|source text|fileId|blocks|pdf/i);
  expect(applyLocalDelta(base,delta,'scope-a','resume-a',Date.now()).sections[0].items[0].title).toBe('人工改写');
  expect(()=>applyLocalDelta(base,delta,'scope-b','resume-a',Date.now())).toThrow();
  expect(()=>applyLocalDelta({...base,revision:base.revision+1},delta,'scope-a','resume-a',Date.now())).toThrow();
});

it('recovers an unsaved split using server evidence without caching source IDs',()=>{
  const base=normalizeResumeDraft(fixture);
  const section=base.sections.find(entry=>entry.kind==='projects')!;
  section.items=[{...base.sections[0].items[0],itemId:'project-base',
    details:'First result\n\nSecond result'}];
  const changed=splitResumeItem(base,'projects',section.items[0].itemId,1,'manual-child');
  const delta=makeLocalDelta(base,changed,'scope-a','resume-a','2099-01-01T00:00:00Z');
  expect(JSON.stringify(delta)).not.toContain('sourceBlockIds');
  const recovered=applyLocalDelta(base,delta,'scope-a','resume-a',Date.now());
  const items=recovered.sections.find(entry=>entry.kind==='projects')!.items;
  expect(items).toHaveLength(2);
  expect(items[1].sourceBlockIds).toEqual(items[0].sourceBlockIds);
  expect(items[1].origin).toBe('agent');
});

it('recovers source selections and manual highlights without caching source evidence', () => {
  const base = normalizeResumeDraft(fixture);
  const campus = base.sections.find(section => section.kind === 'campusExperience')!;
  campus.items = [{ ...base.sections[0].items[0], itemId: 'campus', sourceBlockIds: ['private-block'],
    presentationHighlights: [{ id: 'source-entry', type: 'campus-metric', label: '志愿服务人次',
      value: '200', unit: '人次', selected: false, origin: 'source', sourceBlockId: 'private-block' }] }];
  const changed = structuredClone(base);
  const item = changed.sections.find(section => section.kind === 'campusExperience')!.items[0];
  item.presentationHighlights![0].selected = true;
  item.presentationHighlights!.push({ id: 'manual-entry', type: 'campus-metric', label: '参加人数',
    value: '36', unit: '人', selected: false, origin: 'user' });
  const encoded = JSON.stringify(makeLocalDelta(base, changed, 'scope-a', 'resume-a', '2099-01-01T00:00:00Z'));
  expect(encoded).not.toMatch(/sourceBlockId|private-block|志愿服务人次/);
  expect(encoded).toContain('参加人数');
  const recovered = applyLocalDelta(base, JSON.parse(encoded), 'scope-a', 'resume-a', Date.now());
  expect(recovered.sections.find(section => section.kind === 'campusExperience')!.items[0].presentationHighlights)
    .toEqual(item.presentationHighlights);
});

it('recovers an explicit empty highlight list when activating a legacy entry', () => {
  const base = normalizeResumeDraft(fixture);
  const campus = base.sections.find(section => section.kind === 'campusExperience')!;
  campus.items = [{ ...base.sections[0].items[0], itemId: 'campus' }];
  const changed = structuredClone(base);
  changed.sections.find(section => section.kind === 'campusExperience')!.items[0].presentationHighlights = [];
  const delta = makeLocalDelta(base, changed, 'scope-a', 'resume-a', '2099-01-01T00:00:00Z');
  const recovered = applyLocalDelta(base, delta, 'scope-a', 'resume-a', Date.now());
  expect(recovered.sections.find(section => section.kind === 'campusExperience')!.items[0].presentationHighlights).toEqual([]);
});

it('recovers source candidates with colliding IDs after a merge from their original items', () => {
  const base = normalizeResumeDraft(fixture);
  const campus = base.sections.find(section => section.kind === 'campusExperience')!;
  campus.items = [
    { ...base.sections[0].items[0], itemId: 'campus-a', order: 0, title: '社团运营', details: '粉丝增长25%',
      sourceBlockIds: ['block-a'], presentationHighlights: [{ id: 'metric', type: 'campus-metric',
        label: '粉丝增长', value: '25', unit: '%', selected: true, origin: 'source', sourceBlockId: 'block-a' }] },
    { ...base.sections[0].items[0], itemId: 'campus-b', order: 1, title: '志愿者活动', details: '志愿服务人次200人次',
      sourceBlockIds: ['block-b'], presentationHighlights: [{ id: 'metric', type: 'campus-metric',
        label: '志愿服务人次', value: '200', unit: '人次', selected: true, origin: 'source', sourceBlockId: 'block-b' }] },
  ];
  const changed = mergeResumeItems(base, 'campusExperience', 'campus-a', 'campus-b', 'combine');
  const encoded = JSON.stringify(makeLocalDelta(base, changed, 'scope-a', 'resume-a', '2099-01-01T00:00:00Z'));
  expect(encoded).not.toMatch(/sourceBlockId|block-a|block-b/);
  const recovered = applyLocalDelta(base, JSON.parse(encoded), 'scope-a', 'resume-a', Date.now());
  const [item] = recovered.sections.find(section => section.kind === 'campusExperience')!.items;
  expect(item.presentationHighlights).toEqual(changed.sections.find(section => section.kind === 'campusExperience')!.items[0].presentationHighlights);
  expect(new Set(item.presentationHighlights!.map(row => row.id)).size).toBe(2);
  expect(item.sourceBlockIds).toEqual(['block-a', 'block-b']);
});
