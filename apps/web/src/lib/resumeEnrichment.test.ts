import { expect, it } from 'vitest';
import fixture from '../../../../packages/contracts/fixtures/resume-draft.v1.json';
import { projectConfirmedResume, type ResumeDraftV1 } from '../../../../packages/contracts/src/resume-draft';
import { cleanStructuredResume } from '../../../../packages/contracts/src/validation.mjs';
import { resumeItemHasContent, resumeDisplayContent } from '../../../../packages/contracts/src/resume-v2.mjs';
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
const displayItem = (overrides: Record<string, unknown> = {}) => ({ itemId: 'p1', title: '作品', details: '总结',
  facts: [], supplement: { text: '', links: [], images: [] }, ...overrides });
it('cleanResumeV2 keeps optional sourceText, accepts legacy and explicit null, caps at 12000', () => {
  const withText = { version: 'resume-v2', sections: [{ kind: 'projects', items: [displayItem({ sourceText: '原文样例' })] }] };
  expect(cleanStructuredResume(withText)).toEqual(withText);
  // 旧数据：缺键通过，输出不含该键
  const legacy = cleanStructuredResume({ version: 'resume-v2', sections: [{ kind: 'projects', items: [displayItem()] }] }) as { sections: { items: object[] }[] };
  expect('sourceText' in legacy.sections[0].items[0]).toBe(false);
  // Agent worker 以非 exclude 的 model_dump 提交草稿时会带显式 null：视同缺键接受
  const explicitNull = cleanStructuredResume({ version: 'resume-v2', sections: [{ kind: 'projects', items: [displayItem({ sourceText: null })] }] }) as { sections: { items: object[] }[] };
  expect('sourceText' in explicitNull.sections[0].items[0]).toBe(false);
  expect(() => cleanStructuredResume({ version: 'resume-v2', sections: [{ kind: 'projects', items: [displayItem({ sourceText: 'x'.repeat(12001) })] }] })).toThrow(/简历展示内容无效/);
});
it('resumeItemHasContent counts sourceText when everything else is empty', () => {
  const base = { title: '   ', details: '', facts: [], supplement: { text: '', links: [], images: [] } };
  expect(resumeItemHasContent({ ...base, sourceText: '原文' })).toBe(true);
  expect(resumeItemHasContent(base)).toBe(false);
  expect(resumeItemHasContent({ ...base, sourceText: '   \n' })).toBe(false);
});
it('resumeDisplayContent carries item sourceText into v2 and v3 project cards', () => {
  const v2 = resumeDisplayContent(cleanStructuredResume({ version: 'resume-v2',
    sections: [{ kind: 'projects', items: [displayItem({ sourceText: '原文B' })] }] }));
  expect(v2.projects[0].sourceText).toBe('原文B');
  const v3 = resumeDisplayContent(cleanStructuredResume({ version: 'resume-v3',
    sections: [{ kind: 'projects', order: 0, items: [{ ...displayItem({ sourceText: '原文C' }), order: 0 }] }] }));
  expect(v3.projects[0].sourceText).toBe('原文C');
  const legacy = resumeDisplayContent(cleanStructuredResume({ version: 'resume-v2',
    sections: [{ kind: 'projects', items: [displayItem()] }] }));
  expect(legacy.projects[0].sourceText).toBe('');
});
