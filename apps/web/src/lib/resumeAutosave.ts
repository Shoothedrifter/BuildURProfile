type VersionedDraft = { revision: number };
type Saved<T> = { draft: T; revision: number };
type AutosaveStatus = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'invalid';

/** One writer per editor tab. Every response updates the server revision before another write. */
export function createResumeAutosave<T extends VersionedDraft>({save,onSaved,onStatus,delayMs=800}:{
  save:(draft:T)=>Promise<Saved<T>>;
  onSaved?:(result:Saved<T>,sent:T)=>void;
  onStatus?:(status:AutosaveStatus)=>void;
  delayMs?:number;
}) {
  let current:T|null=null;
  let serverRevision=0;
  let savedFingerprint='';
  let status:AutosaveStatus='saved';
  let timer:ReturnType<typeof setTimeout>|null=null;
  let running:Promise<void>|null=null;
  let disposed=false;
  const fingerprint=(draft:T)=>JSON.stringify({...draft,revision:0});
  const emit=(next:AutosaveStatus)=>{status=next;onStatus?.(next);};
  const clear=()=>{if(timer){clearTimeout(timer);timer=null;}};
  const api={
    initialize(draft:T){
      clear();current=draft;serverRevision=draft.revision;savedFingerprint=fingerprint(draft);
      emit('saved');
    },
    update(draft:T){
      if(disposed)return;
      if(!current){api.initialize(draft);return;}
      current=draft;
      if(status==='conflict')return;
      if(fingerprint(draft)===savedFingerprint){if(!running)emit('saved');return;}
      if(!running)emit('dirty');
      clear();
      if(!running)timer=setTimeout(()=>{void api.flush().catch(()=>{});},delayMs);
    },
    async flush(draft?:T):Promise<void>{
      if(draft)api.update(draft);
      clear();
      if(disposed||status==='conflict'||!current) return;
      if(running){await running;return api.flush();}
      if(fingerprint(current)===savedFingerprint){emit('saved');return;}
      const sent={...current,revision:serverRevision} as T;
      emit('saving');
      running=(async()=>{
        try{
          const result=await save(sent);
          serverRevision=result.revision;
          const sentFingerprint=fingerprint(sent);
          savedFingerprint=fingerprint(result.draft);
          if(current && fingerprint(current)===sentFingerprint)current=result.draft;
          else if(current)current={...current,revision:result.revision};
          onSaved?.(result,sent);
        }catch(error){
          emit(error instanceof Error && error.message==='REVISION_CONFLICT'?'conflict':
            error instanceof Error && error.message==='INVALID_LINK'?'invalid':'offline');
          throw error;
        }
      })();
      try{await running;}finally{running=null;}
      if(['conflict','offline','invalid'].includes(api.status()))return;
      if(current && fingerprint(current)!==savedFingerprint)return api.flush();
      emit('saved');
    },
    status:()=>status,
    latest:()=>current,
    dispose(){disposed=true;clear();}
  };
  return api;
}
