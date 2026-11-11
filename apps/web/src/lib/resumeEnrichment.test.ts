import { expect, it } from 'vitest';
import fixture from '../../../../packages/contracts/fixtures/resume-draft.v1.json';
import { projectConfirmedResume, type ResumeDraftV1 } from '../../../../packages/contracts/src/resume-draft';
import { cleanStructuredResume } from '../../../../packages/contracts/src/validation.mjs';
const draft = () => structuredClone(fixture) as ResumeDraftV1;
it('projects ordered, source-free supplements into v2 and retains legacy links', () => {
  const d = draft();
  d.sections[0].items[0].supplements = {text:'😀'.repeat(500), links:[{label:'主页',url:'https://example.test'}],images:[{imageId:'img_1',caption:'示意图'}]};
  const resume = projectConfirmedResume(d).resume;
  expect(resume?.version).toBe('resume-v2');
  if (resume?.version !== 'resume-v2') throw new Error('v2 required');
  expect(resume.sections[0].items[0].supplement).toEqual({text:'😀'.repeat(500),links:[{label:'主页',url:'https://example.test'}],images:[{imageId:'img_1',caption:'示意图'}]});
  expect(JSON.stringify(resume)).not.toMatch(/sourceBlockIds|confidence|秘密电话/);
  expect(cleanStructuredResume(resume)).toEqual(resume);
});
it.each(['text','label','url','caption'])('rejects hidden fact leaked through %s', (field) => {
  const d = draft(), i = d.sections[0].items[0];
  i.supplements = {text:field==='text'?'秘密电话':'',links:[{label:field==='label'?'秘密电话':'',url:field==='url'?'https://example.test/秘密电话':'https://example.test'}],images:[{imageId:'img_1',caption:field==='caption'?'秘密电话':''}]};
  expect(() => projectConfirmedResume(d)).toThrow();
});
it('blocks pending review and invalid HTTP links', () => {
  const d=draft(), i=d.sections[0].items[0]; i.needsReview=true;
  expect(()=>projectConfirmedResume(d)).toThrow(/核对/);
  i.needsReview=false; i.supplements={text:'',links:[{url:'https://'}],images:[]};
  expect(()=>projectConfirmedResume(d)).toThrow();
});
it('rejects oversized confirmed content before leaving the review page without truncation', () => {
  const d=draft();
  d.sections[5].items=Array.from({length:40},(_,n)=>({...d.sections[0].items[0],itemId:`project_${n}`,order:n,title:'项目',details:'内容'.repeat(2000),facts:[]}));
  const before=JSON.stringify(d);
  expect(()=>projectConfirmedResume(d)).toThrow(/256 KiB/);
  expect(JSON.stringify(d)).toBe(before);
});
it('rejects percent-encoded hidden facts in supplementary URLs', () => {
  const d=draft(), item=d.sections[0].items[0];
  item.facts.push({key:'private_email',label:'私人邮件',value:'hidden@example.test',included:false});
  item.supplements={text:'',links:[{url:'https://example.test/?email=hidden%40example.test'}],images:[]};
  expect(()=>projectConfirmedResume(d)).toThrow(/未勾选/);
});
it('does not bypass review merely because a legacy draft already hides a module', () => {
  const d=draft();d.sections[0].visible=false;d.sections[0].items[0].needsReview=true;
  expect(()=>projectConfirmedResume(d)).toThrow(/核对/);
});
