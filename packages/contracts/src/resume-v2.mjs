/** Public v2 data only. Shared by the server, browser and export renderer. */
export const RESUME_KINDS = ['basicInfo','jobIntent','selfEvaluation','education','workExperience','projects','awards','campusExperience','skills','other'];
export const RESUME_LABELS = ['基本信息','求职意向','自我评价','教育背景','实习/工作经历','项目经历','荣誉奖项','校园经历','专业技能','其他内容'];
export function validHttpUrl(value) {
  try { if (typeof value !== "string" || !/^https?:\/\//.test(value)) return false; decodeURIComponent(value); const u = new URL(value); return ['http:','https:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password; } catch { return false; }
}
export function cleanResumeV2(raw) {
  const fail = () => { throw new Error('简历展示内容无效。'); };
  const obj = (v, keys) => { if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).some(k=>!keys.includes(k)) || keys.some(k=>!(k in v))) fail(); return v; };
  const str = (v, max=12000) => { if (typeof v!=='string' || [...v].length>max || v.includes('\0')) fail(); return v; };
  const id = v => { str(v,100); if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v)) fail(); return v; };
  const list = (v,max,fn) => { if (!Array.isArray(v)||v.length>max) fail(); return v.map(fn); };
  obj(raw,['version','sections']); if(raw.version!=='resume-v2') fail();
  const ids=new Set(), kinds=new Set(), images=new Set(); let last=-1;
  const sections=list(raw.sections,10,s=>{
    obj(s,['kind','items']); const order=RESUME_KINDS.indexOf(s.kind);
    if(order<0 || order<=last || kinds.has(s.kind)) fail(); last=order; kinds.add(s.kind);
    return {kind:s.kind,items:list(s.items,100,i=>{
      obj(i,['itemId','title','details','facts','supplement']); id(i.itemId); if(ids.has(i.itemId)) fail(); ids.add(i.itemId);
      const factKeys=new Set();
      const facts=list(i.facts,100,f=>{obj(f,['key','label','value']); if(factKeys.has(f.key)) fail(); factKeys.add(f.key); return {key:str(f.key),label:str(f.label),value:str(f.value)};});
      const x=obj(i.supplement,['text','links','images']);
      const supplement={text:str(x.text,500),links:list(x.links,5,l=>{obj(l,['label','url']); str(l.url,2000); if(!validHttpUrl(l.url)) fail(); return {label:str(l.label,80),url:l.url};}),images:list(x.images,6,m=>{obj(m,['imageId','caption']); id(m.imageId); images.add(m.imageId); return {imageId:m.imageId,caption:str(m.caption,80)};})};
      return {itemId:i.itemId,title:str(i.title),details:str(i.details),facts,supplement};
    })};
  });
  if(images.size>24) fail();
  return {version:'resume-v2',sections};
}
export function resumeV1View(resume) {
  if (!resume || resume.version==='resume-v1') return resume;
  return {version:'resume-v1',...Object.fromEntries(RESUME_KINDS.map(kind=>{
    const items=resume.sections.find(s=>s.kind===kind)?.items ?? [];
    return [kind, ['basicInfo','jobIntent'].includes(kind) ? items.flatMap(i=>i.facts) : items.map(({title,details,facts})=>({title,details,facts}))];
  }))};
}
export function resumeImageIds(config) {
  const resume=config?.content?.resume;
  return ['resume-v2','resume-v3'].includes(resume?.version) ? [...new Set(resume.sections.flatMap(s=>s.items.flatMap(i=>i.supplement.images.map(m=>m.imageId))))] : [];
}
export function resumeItemHasContent(item) {
  return !!(item.title.trim() || item.details.trim() || item.facts.some(fact=>fact.value.trim())
    || item.supplement.text.trim() || item.supplement.links.length || item.supplement.images.length);
}
/** Compatibility fields are derived; v2 sections remain the editable source of truth. */
export function resumeDisplayContent(resume) {
  const v=resumeV1View(resume), basic=key=>v.basicInfo.find(f=>f.key===key)?.value.trim() ?? '', intent=key=>v.jobIntent.find(f=>f.key===key)?.value ?? '';
  const entry=i=>[i.title,i.details].filter(Boolean).join('\n');
  return {profile:{name:basic('name'),email:basic('email'),role:intent('targetRole'),location:basic('location'),availability:intent('availability'),intro:'',summary:v.selfEvaluation.map(entry).join('\n')},
    expertise:{eyebrow:'',headline:'技能与专长',summary:'',skills:v.skills.map(entry).filter(Boolean),disciplines:[]},
    projects:(resume.sections.find(s=>s.kind==='projects')?.items ?? []).map((i,index)=>({id:i.itemId,index:String(index+1).padStart(2,'0'),title:i.title,category:'',year:'',description:i.details,tags:[],visual:['mint','lilac','peach'][index%3]})),
    workExperience:v.workExperience.map(entry).filter(Boolean),campusExperience:v.campusExperience.map(entry).filter(Boolean),education:v.education.map(entry).filter(Boolean),resume};
}
