import { useEffect, useId, useRef } from "react";
import type { ResumeDisplayItem } from "../../../../packages/contracts/src/config";
import { validHttpUrl } from "../../../../packages/contracts/src/resume-v2.mjs";
import { presentOptionalEntry, type OptionalSectionKind } from "../lib/cyber-optional-content";
import { ResumeSupplement, type ResumeImageResolver } from "./ResumeDisplay";

type SectionProps = {
  items: readonly ResumeDisplayItem[];
  resolveResumeImage: ResumeImageResolver;
  animate: boolean;
};

function OptionalEntry({ item, kind, resolveResumeImage }: {
  item: ResumeDisplayItem;
  kind: OptionalSectionKind;
  resolveResumeImage: ResumeImageResolver;
}) {
  const { summary, period, metadata, highlights, supplementalFacts } = presentOptionalEntry(item, kind);
  const source = item.sourceText?.trim();
  const { text, images } = item.supplement;
  const links = item.supplement.links.filter(link => validHttpUrl(link.url));
  const hasEvidence = images.length > 0 || links.length > 0;

  return (
    <article className="cyber-optional-entry" data-item-id={item.itemId}>
      {item.title.trim() && <h3>{item.title}</h3>}
      {(metadata.length > 0 || period) && <dl className="cyber-optional-meta">
        {metadata.map(fact => <div key={fact.key}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        {period && <div><dt>时间</dt><dd>{period}</dd></div>}
      </dl>}
      {highlights.length > 0 && <dl className="cyber-optional-highlights"
        aria-label={kind === "awards" ? "竞赛奖项统计" : "实践成果"}>
        {highlights.map(({ id, label, value, total }) => <div key={id ?? JSON.stringify([label, value])} data-total={total || undefined}>
          <dt>{label}</dt><dd>{value}</dd>
        </div>)}
      </dl>}
      {summary.trim() && <p className="cyber-optional-summary cyber-preserve-lines">{summary}</p>}
      {(text.trim() || supplementalFacts.length > 0) && <ResumeSupplement
        item={{ ...item, facts: supplementalFacts, supplement: { text, links: [], images: [] } }}
        resolveImage={resolveResumeImage} />}
      {source && source !== item.details.trim() && <details className="cyber-text-detail">
        <summary>查看详情</summary>
        <div className="cyber-detail-body"><p>{item.sourceText}</p></div>
      </details>}
      {hasEvidence && <details className="cyber-text-detail cyber-optional-evidence">
        <summary>查看补充资料</summary>
        <ResumeSupplement item={{ ...item, facts: [], supplement: { text: "", links, images } }}
          resolveImage={resolveResumeImage} />
      </details>}
    </article>
  );
}

function OptionalSection({ kind, title, items, resolveResumeImage, animate }: SectionProps & {
  kind: OptionalSectionKind;
  title: string;
}) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!animate || !section || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      section.setAttribute("data-revealed", "");
      observer.disconnect();
    }, { rootMargin: "0px 0px -12% 0px" });
    observer.observe(section);
    return () => {
      observer.disconnect();
      section.removeAttribute("data-revealed");
    };
  }, [animate]);

  const renderItem = (item: ResumeDisplayItem) => <OptionalEntry
    item={item} kind={kind} resolveResumeImage={resolveResumeImage} />;

  if (items.length === 0) return null;
  const variant = kind === "awards" ? "awards" : "campus";
  return (
    <section className={`cyber-optional-section cyber-optional-section--${variant} cyber-page-width`}
      id={kind} aria-labelledby={headingId} ref={sectionRef}>
      <h2 id={headingId}>{title}</h2>
      {items.length === 1 ? renderItem(items[0]) :
        <ol className="cyber-optional-list" role="list">
          {items.map(item => <li key={item.itemId}>{renderItem(item)}</li>)}
        </ol>}
    </section>
  );
}

export function CyberCampusSection(props: SectionProps) {
  return <OptionalSection {...props} kind="campusExperience" title="校园经历" />;
}

export function CyberAwardsSection(props: SectionProps) {
  return <OptionalSection {...props} kind="awards" title="荣誉奖项" />;
}
