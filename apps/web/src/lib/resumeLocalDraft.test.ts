import { expect, it } from 'vitest';
import { applyLocalDelta, makeLocalDelta } from './resumeLocalDraft';
import { normalizeResumeDraft } from '../../../../packages/contracts/src/resume-draft';
import fixture from '../../../../packages/contracts/fixtures/resume-draft.v1.json';

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
