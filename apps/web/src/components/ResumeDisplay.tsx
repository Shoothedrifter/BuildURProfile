import type { ResumeDisplayItem, StructuredResumeV2, StructuredResumeV3 } from '../../../../packages/contracts/src/config';
import { RESUME_KINDS, RESUME_LABELS, resumeItemHasContent, validHttpUrl } from '../../../../packages/contracts/src/resume-v2.mjs';
export type ResumeImageResolver = (imageId: string) => string;
export function ResumeSupplement({item,resolveImage,excludeIdentity=false}:{item:ResumeDisplayItem;resolveImage:ResumeImageResolver;excludeIdentity?:boolean}) {
  const facts=item.facts.filter(f=>f.value.trim() && !(excludeIdentity && ['name','email','location'].includes(f.key)));
  return <div className="resume-supplement">
    {!!facts.length && <dl>{facts.map(f=><div key={f.key}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
    {item.supplement.text && <p className="resume-entry-body">{item.supplement.text}</p>}
    {!!item.supplement.links.length && <ul>{item.supplement.links.filter(l=>validHttpUrl(l.url)).map((l,n)=><li key={n}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label || l.url}</a></li>)}</ul>}
    <div className="resume-image-grid">{item.supplement.images.map(m=><figure key={m.imageId}><img loading="lazy" src={resolveImage(m.imageId)} alt={m.caption || '补充图片'} />{m.caption && <figcaption>{m.caption}</figcaption>}</figure>)}</div>
  </div>;
}
export function ResumeDisplay({resume,resolveImage,skipBasicInfo=false}:{resume:StructuredResumeV2 | StructuredResumeV3;resolveImage:ResumeImageResolver;skipBasicInfo?:boolean}) {
  return <>{resume.sections.filter(s=>s.kind!=='projects' && !(skipBasicInfo && s.kind==='basicInfo') && s.items.some(resumeItemHasContent)).map(s=><section key={s.kind} className="resume-section page-container" aria-label={RESUME_LABELS[RESUME_KINDS.indexOf(s.kind)]} id={s.kind==='skills'?'about':s.kind==='selfEvaluation'?'self-evaluation':s.kind}>
    <div className="section-marker"><span>{RESUME_LABELS[RESUME_KINDS.indexOf(s.kind)]}</span><span className="marker-line"/></div>
    <h2>{RESUME_LABELS[RESUME_KINDS.indexOf(s.kind)]}</h2>
    {s.items.filter(resumeItemHasContent).map(i => {
      // 统一降级规则（与 StackedCards 同构）：sourceText 有效时展示原文，否则回退 details
      const detailText = i.sourceText?.trim() ? i.sourceText : i.details;
      return <article className="resume-entry" key={i.itemId}>{i.title && <h3>{i.title}</h3>}
        {i.details && <p className="resume-entry-body">{i.details}</p>}
        {Boolean(i.presentationHighlights?.length) && <dl aria-label="作品集成果">
          {i.presentationHighlights?.map(highlight => <div key={highlight.id}>
            <dt>{highlight.label}</dt><dd>{highlight.value}{highlight.unit}</dd>
          </div>)}
        </dl>}
        {detailText.trim() && <details className="resume-entry-detail"><summary>查看详情</summary><div className="project-detail-body"><p>{detailText}</p></div></details>}
        <ResumeSupplement item={i} resolveImage={resolveImage} excludeIdentity={resume.version==='resume-v2' && s.kind==='basicInfo'}/>
      </article>;
    })}
  </section>)}</>;
}
