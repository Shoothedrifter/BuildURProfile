import { describe, expect, it, vi } from 'vitest';
import { createResumeAutosave } from './resumeAutosave';

type Draft = {revision:number;value:string};
const saved=(draft:Draft)=>({draft:{...draft,revision:draft.revision+1},revision:draft.revision+1});

describe('resume autosave',()=>{
  it('debounces edits, serializes in-flight saves and preserves newer local changes',async()=>{
    vi.useFakeTimers();
    try {
      const pending:{draft:Draft;resolve:(value:ReturnType<typeof saved>)=>void}[]=[];
      const save=vi.fn((draft:Draft)=>new Promise<ReturnType<typeof saved>>(resolve=>pending.push({draft,resolve})));
      const revisions:number[]=[];
      const autosave=createResumeAutosave<Draft>({save,onSaved:result=>revisions.push(result.revision),delayMs:800});
      autosave.initialize({revision:1,value:'原稿'});
      autosave.update({revision:1,value:'修改一'});
      await vi.advanceTimersByTimeAsync(799);expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);expect(save).toHaveBeenCalledTimes(1);
      autosave.update({revision:1,value:'修改二'});
      pending[0].resolve(saved(pending[0].draft));
      await Promise.resolve();await Promise.resolve();
      expect(save).toHaveBeenCalledTimes(2);
      expect(pending[1].draft).toEqual({revision:2,value:'修改二'});
      pending[1].resolve(saved(pending[1].draft));
      await autosave.flush();
      expect(revisions).toEqual([2,3]);
      expect(save).toHaveBeenCalledTimes(2);
    } finally {vi.useRealTimers();}
  });
  it('stops on revision conflict and leaves the local draft available',async()=>{
    const save=vi.fn(async()=>{throw new Error('REVISION_CONFLICT');});
    const autosave=createResumeAutosave<Draft>({save,delayMs:800});
    autosave.initialize({revision:1,value:'原稿'});
    autosave.update({revision:1,value:'本地修改'});
    await expect(autosave.flush()).rejects.toThrow('REVISION_CONFLICT');
    expect(autosave.status()).toBe('conflict');
    expect(autosave.latest()?.value).toBe('本地修改');
    autosave.update({revision:1,value:'再次修改'});
    expect(save).toHaveBeenCalledTimes(1);
    autosave.dispose();
  });
});
