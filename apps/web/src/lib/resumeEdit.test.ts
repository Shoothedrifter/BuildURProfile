import { expect, it } from 'vitest';
import fixture from '../../../../packages/contracts/fixtures/resume-draft.v1.json';
import { normalizeResumeDraft } from '../../../../packages/contracts/src/resume-draft';
import { mergeResumeItems, moveResumeItem, moveResumeSection, splitResumeItem } from './resumeEdit';

function projectDraft() {
  const draft = normalizeResumeDraft(fixture);
  const projects = draft.sections.find(section => section.kind === 'projects')!;
  projects.items = [{ ...draft.sections[0].items[0], itemId: 'project-one', order: 0,
    title: '项目甲', details: '第一段\n\n第二段', sourceBlockIds: ['block_1'],
    supplements: { text: '说明', links: [{url:'https://example.com'}],
      images: [{imageId:'img_1',caption:'截图'}] } }];
  return draft;
}

it('moves modules and items with contiguous explicit order', () => {
  const draft = projectDraft();
  const moved = moveResumeSection(draft, 'projects', -1);
  expect(moved.sections.map(section => section.kind).indexOf('projects')).toBe(4);
  expect(moved.sections.map(section => section.order)).toEqual(Array.from({length:10},(_,i)=>i));
  const section = draft.sections.find(section => section.kind === 'projects')!;
  section.items.push({...section.items[0],itemId:'project-two',order:1});
  expect(moveResumeItem(draft,'projects','project-two',-1).sections.find(s=>s.kind==='projects')!.items.map(i=>i.itemId))
    .toEqual(['project-two','project-one']);
});

it('splits only at a selected paragraph boundary and keeps supplements on the first item', () => {
  const draft = projectDraft();
  expect(() => splitResumeItem(draft,'projects','project-one',0,'new-id')).toThrow();
  const result = splitResumeItem(draft,'projects','project-one',1,'new-id');
  const [first,second] = result.sections.find(s=>s.kind==='projects')!.items;
  expect(first).toMatchObject({itemId:'project-one',details:'第一段',needsReview:true});
  expect(first.supplements?.images).toEqual([{imageId:'img_1',caption:'截图'}]);
  expect(second).toMatchObject({itemId:'new-id',details:'第二段',needsReview:true,derivedFromItemId:'project-one'});
  expect(second.supplements?.images).toEqual([]);
  expect(draft.sections.find(s=>s.kind==='projects')!.items).toHaveLength(1);
});

it('splits sourceText by its own blank-line paragraphs at the same boundary', () => {
  const draft = projectDraft();
  const section = draft.sections.find(s=>s.kind==='projects')!;
  section.items[0].sourceText = '原文甲\n\n原文乙';
  const result = splitResumeItem(draft,'projects','project-one',1,'new-id');
  const [first,second] = result.sections.find(s=>s.kind==='projects')!.items;
  expect(first.sourceText).toBe('原文甲');
  expect(second.sourceText).toBe('原文乙');
  expect(first.editedFields).toContain('sourceText');
  expect(second.editedFields).toEqual(['details','sourceText']);
});

it('keeps the full sourceText on the first item when its paragraphs are fewer than the boundary', () => {
  const draft = projectDraft();
  const section = draft.sections.find(s=>s.kind==='projects')!;
  section.items[0].sourceText = '只有一段原文';
  const result = splitResumeItem(draft,'projects','project-one',1,'new-id');
  const [first,second] = result.sections.find(s=>s.kind==='projects')!.items;
  expect(first.sourceText).toBe('只有一段原文');
  expect(second.sourceText).toBe('');
  expect(first.editedFields).toContain('sourceText');
  expect(second.editedFields).toEqual(['details','sourceText']);
});

it('merges sourceText with a blank line and rejects results over the per-item limit', () => {
  const draft = projectDraft();
  const section = draft.sections.find(s=>s.kind==='projects')!;
  section.items[0].sourceText = '原文甲';
  section.items.push({...section.items[0],itemId:'project-two',order:1,title:'项目乙',
    sourceText:'原文乙',supplements:{text:'',links:[],images:[]}});
  const merged = mergeResumeItems(draft,'projects','project-one','project-two','combine');
  const item = merged.sections.find(s=>s.kind==='projects')!.items[0];
  expect(item.sourceText).toBe('原文甲\n\n原文乙');
  expect(item.editedFields).toContain('sourceText');
  section.items[1].sourceText = '长'.repeat(12000);
  expect(() => mergeResumeItems(draft,'projects','project-one','project-two','combine'))
    .toThrow('合并后的详情原文超过单条上限。');
});

it('does not lose assets when merging over a per-item limit', () => {
  const draft = projectDraft();
  const section = draft.sections.find(s=>s.kind==='projects')!;
  section.items.push({...section.items[0],itemId:'project-two',order:1,title:'项目乙',
    supplements:{text:'第二条说明',links:[],images:Array.from({length:6},(_,i)=>({imageId:`img_${i+2}`,caption:''}))}});
  expect(() => mergeResumeItems(draft,'projects','project-one','project-two','combine')).toThrow();
  expect(section.items).toHaveLength(2);
  const merged = mergeResumeItems(draft,'projects','project-one','project-two','first');
  expect(merged.sections.find(s=>s.kind==='projects')!.items).toHaveLength(1);
  expect(merged.sections.find(s=>s.kind==='projects')!.items[0].supplements?.images).toHaveLength(1);
  expect(merged.sections.find(s=>s.kind==='projects')!.items[0].details).toContain('项目乙');
});
