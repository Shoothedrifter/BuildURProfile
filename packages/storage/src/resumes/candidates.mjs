import { randomUUID } from 'node:crypto';
import { highlightIsPrivate } from '../../../contracts/src/presentation-highlights.mjs';

const overlap=(a,b)=>a.sourceBlockIds.some(id=>b.sourceBlockIds.includes(id));
const clone=value=>structuredClone(value);

export function mergeEmptyDraft(current,candidate,deletedSourceIds=new Set(),allowHiddenItems=false) {
  const result=clone(current);
  const usedIds=new Set(result.sections.flatMap(section=>section.items.map(item=>item.itemId)));
  for(const section of result.sections){
    if(!section.visible&&!allowHiddenItems)continue;
    const incoming=candidate.sections.find(entry=>entry.kind===section.kind);
    if(!incoming)continue;
    for(const entry of incoming.items){
      const original=section.items.find(item=>overlap(item,entry));
      if(!section.visible&&original)continue;
      if(!original){
        if(entry.sourceBlockIds.some(id=>deletedSourceIds.has(id)))continue;
        const itemId=usedIds.has(entry.itemId)?randomUUID():entry.itemId;
        usedIds.add(itemId);
        section.items.push({...clone(entry),itemId,
          order:section.items.length,included:false,needsReview:true,editedFields:[]});
        continue;
      }
      let changed=false;
      // sourceText 允许显式 null（Agent worker 非 exclude dump），?? '' 保证判空 null-safe
      for(const field of ['title','details','sourceText']){
        if(!(original[field]??'').trim()&&!original.editedFields.includes(field)&&(entry[field]??'').trim()){
          original[field]=entry[field];changed=true;
        }
      }
      for(const fact of entry.facts){
        const existing=original.facts.find(value=>value.key===fact.key);
        if(!existing){
          original.facts.push({...clone(fact),included:false});changed=true;
        }else if(!existing.value.trim()&&!original.editedFields.includes(`fact:${fact.key}`)&&fact.value.trim()){
          existing.value=fact.value;changed=true;
        }
      }
      if(changed){
        original.needsReview=true;
        original.sourceBlockIds=[...new Set([...original.sourceBlockIds,...entry.sourceBlockIds])];
      }
    }
  }
  return result;
}

export function reconcileCandidateSource(existing,candidate,draft,taskId) {
  const v2=candidate.version==='resume-source-v2'||existing.version==='resume-source-v2';
  const oldBlocks=v2?existing.blocks.map(block=>block.sourceType?block:{...block,sourceType:'pdf',ocrConfidence:null}):existing.blocks;
  const nextOrder=new Map();
  for(const block of oldBlocks)nextOrder.set(block.page,Math.max(nextOrder.get(block.page)??-1,block.readingOrder));
  const oldByContent=new Map(existing.blocks.map(block=>[
    JSON.stringify([block.page,block.readingOrder,block.text]),block.blockId]));
  const mapped=new Map(),newBlocks=[];
  for(const [index,block] of candidate.blocks.entries()){
    const key=JSON.stringify([block.page,block.readingOrder,block.text]);
    const id=oldByContent.get(key)??`reparse_${taskId.replaceAll('-','').slice(0,16)}_${index}`;
    mapped.set(block.blockId,id);
    if(!oldByContent.has(key)){
      const readingOrder=(nextOrder.get(block.page)??-1)+1;
      nextOrder.set(block.page,readingOrder);
      newBlocks.push({...block,blockId:id,readingOrder});
    }
  }
  const next=clone(draft);
  for(const section of next.sections)for(const item of section.items) {
    item.sourceBlockIds=[...new Set(item.sourceBlockIds.map(id=>mapped.get(id)??id))];
    for (const highlight of item.presentationHighlights ?? []) {
      if (highlight.sourceBlockId) highlight.sourceBlockId = mapped.get(highlight.sourceBlockId) ?? highlight.sourceBlockId;
    }
  }
  return {draft:next,newBlocks,source:{...existing,
    ...(v2?{version:'resume-source-v2',extractionVersion:'pdf-layout-v2'}:{}),blocks:[...oldBlocks,...newBlocks]}};
}

export async function recordDeletedItems(db,resumeId,previous,next) {
  const nextIds=new Set(next.sections.flatMap(section=>section.items.map(item=>item.itemId)));
  const insert=db.prepare('INSERT INTO resume_deleted_items(resume_id,item_id,kind,source_ids_json) VALUES(?,?,?,?) ON CONFLICT(resume_id,item_id) DO UPDATE SET kind=excluded.kind,source_ids_json=excluded.source_ids_json');
  for(const section of previous.sections)for(const item of section.items)
    if(!nextIds.has(item.itemId)&&item.sourceBlockIds.length)
      await insert.run(resumeId,item.itemId,section.kind,JSON.stringify(item.sourceBlockIds));
  for(const itemId of nextIds)
    await db.prepare('DELETE FROM resume_deleted_items WHERE resume_id=? AND item_id=?').run(resumeId,itemId);
}

export function overwriteDraft(current,candidate) {
  const result=clone(candidate);
  const matchedIds=new Set(),matches=new Map();
  for(const section of result.sections){
    const previous=current.sections.find(entry=>entry.kind===section.kind);
    for(const item of section.items){
      const related = previous?.items.filter(entry => overlap(entry, item)) ?? [];
      const matched = related.find(entry => !matchedIds.has(entry.itemId));
      if(matched){
        matchedIds.add(matched.itemId);
        matches.set(item, { matched, unique: related.length === 1
          && section.items.filter(entry => overlap(matched, entry)).length === 1 });
      }
    }
  }
  const usedIds=new Set();
  result.sections=result.sections.map(section=>{
    return {...section,items:section.items.map(item=>{
      const match = matches.get(item);
      const matched = match?.matched;
      let itemId=matched?.itemId??item.itemId;
      while(!matched&&(usedIds.has(itemId)||matchedIds.has(itemId)))itemId=randomUUID();
      usedIds.add(itemId);
      const previousHighlights = matched?.presentationHighlights;
      let manualHighlights = matched?.editedFields?.includes('presentationHighlights');
      if (previousHighlights !== undefined) {
        const sameEvidence = match.unique && matched.sourceBlockIds.length === item.sourceBlockIds.length
          && matched.sourceBlockIds.every(id => item.sourceBlockIds.includes(id));
        const hidden = matched.facts.filter(fact => !fact.included && fact.value).map(fact => fact.value);
        if (!sameEvidence || previousHighlights.some(highlight => highlightIsPrivate(highlight, hidden))) {
          manualHighlights = true;
        }
        item.presentationHighlights = previousHighlights
          .filter(highlight => !highlight.sourceBlockId || item.sourceBlockIds.includes(highlight.sourceBlockId))
          .map(highlight => ({ ...highlight, selected: highlight.selected && sameEvidence && !highlightIsPrivate(highlight, hidden) }));
        if (!sameEvidence) item.needsReview = true;
      }
      return {...item,itemId,
        needsReview:matched?item.needsReview:true,
        editedFields:manualHighlights ? ['presentationHighlights'] : []};
    })};
  });
  return result;
}
