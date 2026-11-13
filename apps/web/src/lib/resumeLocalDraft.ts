import type { ResumeDraftItemV2, ResumeDraftV2, ResumeModuleKind } from '../../../../packages/contracts/src/resume-draft';

const editableKeys=['title','details','facts','needsReview','included','origin','supplements','editedFields','derivedFromItemId'] as const;
type EditableKey=typeof editableKeys[number];
type ItemPatch={itemId:string;isNew?:boolean;values:Partial<Pick<ResumeDraftItemV2,EditableKey>>};
type SectionPatch={kind:ResumeModuleKind;order?:number;visible?:boolean;itemOrder?:string[];items:ItemPatch[]};
export type ResumeLocalDelta={cacheScope:string;resumeId:string;baseRevision:number;expiresAt:string;updatedAt:number;sections:SectionPatch[]};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Persist editable differences only. Evidence IDs, PDF blocks and extraction scores stay server-side. */
export function makeLocalDelta(base:ResumeDraftV2,current:ResumeDraftV2,cacheScope:string,resumeId:string,expiresAt:string):ResumeLocalDelta {
  const original=new Map(base.sections.flatMap(section=>section.items.map(item=>[item.itemId,item] as const)));
  return {cacheScope,resumeId,baseRevision:base.revision,expiresAt,updatedAt:Date.now(),
    sections:current.sections.flatMap(section=>{
      const before=base.sections.find(entry=>entry.kind===section.kind);
      if(!before)throw new Error('本地草稿模块无效。');
      const patch:SectionPatch={kind:section.kind,items:[]};
      if(section.order!==before.order)patch.order=section.order;
      if(section.visible!==before.visible)patch.visible=section.visible;
      if(!same(section.items.map(item=>item.itemId),before.items.map(item=>item.itemId)))
        patch.itemOrder=section.items.map(item=>item.itemId);
      for(const item of section.items){
        const old=original.get(item.itemId);
        const values:ItemPatch['values']={};
        for(const key of editableKeys)if(!old||!same(item[key],old[key]))
          Object.assign(values,{[key]:item[key]});
        if(Object.keys(values).length)patch.items.push({itemId:item.itemId,...(!old?{isNew:true}:{}),values});
      }
      return patch.order!==undefined||patch.visible!==undefined||patch.itemOrder||patch.items.length?[patch]:[];
    })};
}

export function applyLocalDelta(base:ResumeDraftV2,delta:ResumeLocalDelta,cacheScope:string,resumeId:string,now:number):ResumeDraftV2 {
  if(delta.cacheScope!==cacheScope||delta.resumeId!==resumeId||delta.baseRevision!==base.revision
      ||Date.parse(delta.expiresAt)<=now)throw new Error('本地草稿与当前会话或版本不匹配。');
  const original=new Map(base.sections.flatMap(section=>section.items.map(item=>[item.itemId,item] as const)));
  const next=structuredClone(base);
  for(const patch of delta.sections){
    const section=next.sections.find(entry=>entry.kind===patch.kind);
    if(!section)throw new Error('本地草稿模块无效。');
    if(patch.order!==undefined)section.order=patch.order;
    if(patch.visible!==undefined)section.visible=patch.visible;
    const itemPatches=new Map(patch.items.map(item=>[item.itemId,item]));
    const ids=patch.itemOrder??section.items.map(item=>item.itemId);
    section.items=ids.map((id,index)=>{
      const baseline=original.get(id);
      const itemPatch=itemPatches.get(id);
      if(!baseline&&!itemPatch?.isNew)throw new Error('本地草稿条目无效。');
      const item=baseline?structuredClone(baseline):{
        itemId:id,order:index,title:'',details:'',facts:[],sourceBlockIds:[],
        confidence:1,segmentationConfidence:1,needsReview:false,included:false,
        origin:'user' as const,editedFields:[]
      };
      return {...item,...itemPatch?.values,order:index} as ResumeDraftItemV2;
    });
  }
  return next;
}

const databaseName='buildurprofile-unsaved-resume-v1';
function openLocalDatabase():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('本机恢复不可用。'));return;}
    const request=indexedDB.open(databaseName,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function localOperation<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore,done:(value:T)=>void)=>void):Promise<T>{
  const database=await openLocalDatabase();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('drafts',mode);
    let result:T;
    operation(tx.objectStore('drafts'),value=>{result=value;});
    tx.oncomplete=()=>{database.close();resolve(result);};
    tx.onerror=()=>{database.close();reject(tx.error);};
    tx.onabort=()=>{database.close();reject(tx.error);};
  });
}
const localKey=(cacheScope:string,resumeId:string)=>`${cacheScope}:${resumeId}`;
const pendingWrites=new Map<string,Promise<void>>();
function serializeWrite(key:string,work:()=>Promise<void>):Promise<void>{
  const previous=pendingWrites.get(key)??Promise.resolve();
  const next=previous.catch(()=>{}).then(work);
  pendingWrites.set(key,next);
  void next.finally(()=>{if(pendingWrites.get(key)===next)pendingWrites.delete(key);}).catch(()=>{});
  return next;
}
export async function putLocalDelta(delta:ResumeLocalDelta):Promise<void>{
  const key=localKey(delta.cacheScope,delta.resumeId);
  await serializeWrite(key,()=>localOperation<void>('readwrite',(store,done)=>{
    store.put(delta,localKey(delta.cacheScope,delta.resumeId));done();
  }));
}
export async function getLocalDelta(cacheScope:string,resumeId:string):Promise<ResumeLocalDelta|null>{
  const key=localKey(cacheScope,resumeId);
  await pendingWrites.get(key)?.catch(()=>{});
  const result=await localOperation<ResumeLocalDelta|null>('readonly',(store,done)=>{
    const request=store.get(key);request.onsuccess=()=>done(request.result??null);
  });
  if(result&&Date.parse(result.expiresAt)<=Date.now()){await removeLocalDelta(cacheScope,resumeId);return null;}
  return result;
}
export async function removeLocalDelta(cacheScope:string,resumeId:string):Promise<void>{
  const key=localKey(cacheScope,resumeId);
  await serializeWrite(key,()=>localOperation<void>('readwrite',(store,done)=>{
    store.delete(localKey(cacheScope,resumeId));done();
  }));
}
