import { expect, it } from 'vitest';
import { applyLocalDelta, makeLocalDelta } from './resumeLocalDraft';
import { normalizeResumeDraft } from '../../../../packages/contracts/src/resume-draft';
import fixture from '../../../../packages/contracts/fixtures/resume-draft.v1.json';
import { splitResumeItem } from './resumeEdit';

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
