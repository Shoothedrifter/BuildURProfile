import { useState, type MouseEvent } from "react";
import type { DesignConfigV4, ResumeDisplayItem, ResumeModuleKindV2, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import { RESUME_KINDS, RESUME_LABELS, resumeDisplayContent, resumeItemHasContent, validHttpUrl } from "../../../../packages/contracts/src/resume-v2.mjs";
import { ResumeSupplement, type ResumeImageResolver } from "./ResumeDisplay";

export const pixelDefaultPortrait = "/pixel-world-default.webp";
type Section = StructuredResumeV3["sections"][number];
type Props = {
  config: DesignConfigV4;
  resolveResumeImage: ResumeImageResolver;
  preserveShareHash?: boolean;
  staticDecorations?: boolean;
  defaultPortraitUrl?: string;
};

function visibleSections(resume: StructuredResumeV3) {
  const sections = new Map<ResumeModuleKindV2, Section["items"][number][]>();
  for (const section of [...resume.sections].sort((a, b) => a.order - b.order)) {
    if (section.kind === "basicInfo") continue;
    for (const original of [...section.items].sort((a, b) => a.order - b.order)) {
      const facts = section.kind === "jobIntent"
        ? original.facts.filter(fact => !["name", "email", "phone", "location", "targetRole"].includes(fact.key))
        : original.facts;
      const sourceText = section.kind === "jobIntent" ? undefined : original.sourceText;
      const item = { ...original, sourceText, facts, supplement: { ...original.supplement,
        links: original.supplement.links.filter(link => validHttpUrl(link.url)) } };
      if (!resumeItemHasContent(item)) continue;
      const items = sections.get(section.kind);
      if (items) items.push(item);
      else sections.set(section.kind, [item]);
    }
  }
  return [...sections.entries()].map(([kind, items]) => ({ kind, items, label: RESUME_LABELS[RESUME_KINDS.indexOf(kind)] }));
}

function PixelEntry({ item, project, resolveImage }: { item: ResumeDisplayItem; project: boolean; resolveImage: ResumeImageResolver }) {
  const [cover, ...gallery] = item.supplement.images;
  const image = project ? cover : undefined;
  const rest = project ? gallery : item.supplement.images;
  const lines = item.details.split(/\r?\n/);
  const expandable = project && (lines.length > 3 || item.details.length > 240);
  const excerpt = expandable ? Array.from(lines.slice(0, 3).join("\n")).slice(0, 180).join("") : "";
  const sourceText = item.sourceText?.trim() !== item.details.trim() ? item.sourceText?.trim() : undefined;
  const links = item.supplement.links;
  const supplemental = { ...item, supplement: { ...item.supplement, images: [], links: [] } };
  const hasSupplemental = Boolean(item.facts.some(fact => fact.value.trim()) || item.supplement.text.trim());
  return <article className="pixel-entry">
    {image && <figure className="pixel-project-cover">
      <img src={resolveImage(image.imageId)} alt={image.caption || "项目图片"} loading="lazy" />
      {image.caption && <figcaption>{image.caption}</figcaption>}
    </figure>}
    {item.title && <h3>{item.title}</h3>}
    {item.details.trim() && <p className="pixel-copy">{expandable ? `${excerpt}…` : item.details}</p>}
    {Boolean(item.presentationHighlights?.length) && <dl className="pixel-highlights" aria-label="作品集成果">
      {item.presentationHighlights?.map(highlight => <div key={highlight.id}><dt>{highlight.label}</dt><dd>{highlight.value}{highlight.unit}</dd></div>)}
    </dl>}
    {links.length > 0 && <ul className="pixel-entry-links">{links.map((link, index) =>
      <li key={`${link.url}-${index}`}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label || link.url}</a></li>
    )}</ul>}
    {project && (expandable || sourceText || hasSupplemental || rest.length > 0)
      ? <details className="pixel-project-details"><summary>查看项目详情</summary>
        {expandable && <p className="pixel-copy">{item.details}</p>}
        {sourceText && <p className="pixel-copy">{sourceText}</p>}
        <ResumeSupplement item={{ ...supplemental, supplement: { ...supplemental.supplement, images: rest } }} resolveImage={resolveImage} />
      </details>
      : !project && (hasSupplemental || rest.length > 0) && <ResumeSupplement
          item={{ ...supplemental, supplement: { ...supplemental.supplement, images: rest } }} resolveImage={resolveImage} />}
    {!project && sourceText && <details className="pixel-project-details"><summary>查看详情</summary>
      <p className="pixel-copy">{sourceText}</p>
    </details>}
  </article>;
}

export function PixelWorldPage({ config, resolveResumeImage, preserveShareHash = false,
  staticDecorations = false, defaultPortraitUrl = pixelDefaultPortrait }: Props) {
  const resume = config.content.resume;
  const { profile } = resumeDisplayContent(resume);
  const sections = visibleSections(resume);
  const projectSection = sections.find(section => section.kind === "projects");
  const launch = projectSection ?? sections[0];
  const phone = resume.sections.filter(section => section.kind === "basicInfo").flatMap(section => section.items)
    .flatMap(item => item.facts).find(fact => fact.key === "phone" && fact.value.trim())?.value.trim();
  const phoneNumber = phone?.replace(/[^+\d]/g, "");
  const hasContact = Boolean(profile.email || phoneNumber);
  const portrait = config.heroArtwork?.assetUrl;
  const [failedPortrait, setFailedPortrait] = useState<string | null>(null);
  const showPortrait = Boolean(portrait && /^\/api\/hero-assets\/[a-f0-9-]{36}$/i.test(portrait) && failedPortrait !== portrait);
  const role = profile.role || config.content.profile.role;
  const intro = sections.find(section => section.kind === "selfEvaluation")?.items[0]?.details.trim();

  function keepShareHash(event: MouseEvent<HTMLDivElement>) {
    if (!preserveShareHash || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || !(event.target instanceof Element)) return;
    const href = event.target.closest('a[href^="#"]')?.getAttribute("href");
    if (!href) return;
    const section = event.currentTarget.querySelector<HTMLElement>(href);
    if (!section) return;
    event.preventDefault();
    section.focus({ preventScroll: true });
    section.scrollIntoView?.();
  }

  return <div className="pixel-world" data-testid="pixel-world-page" data-static={staticDecorations || undefined} onClick={keepShareHash}>
    <header className="pixel-nav pixel-width">
      <a className="pixel-brand" href="#pixel-top"><span aria-hidden="true" />{profile.name || "作品集"}</a>
      {(sections.length > 0 || hasContact) && <nav aria-label="作品集导航">
        {sections.map(section => <a key={section.kind} href={`#${section.kind}`}>{section.label}</a>)}
        {hasContact && <a href="#contact">联系</a>}
      </nav>}
    </header>
    <main>
      <section id="pixel-top" className="pixel-hero pixel-width" aria-labelledby="pixel-title" tabIndex={-1}>
        <div className="pixel-hero-copy">
          {role && <p className="pixel-role">{role}</p>}
          <h1 id="pixel-title">{profile.name || "作品集"}</h1>
          {intro && <p className="pixel-intro">{intro}</p>}
          {(launch || hasContact) && <div className="pixel-actions">
            {launch && <a className="pixel-button" href={`#${launch.kind}`}>启航 · {projectSection ? "查看项目" : "浏览作品集"}<span aria-hidden="true"> ↓</span></a>}
            {hasContact && <a className="pixel-secondary" href="#contact">联系我</a>}
          </div>}
        </div>
        <div className="pixel-stage">
          {showPortrait
            ? <img className="pixel-portrait" src={portrait} alt={config.heroArtwork?.alt || "个人像素头像"}
                onError={() => setFailedPortrait(portrait ?? null)} />
            : <img className="pixel-portrait pixel-portrait--default" src={defaultPortraitUrl} alt="像素世界风默认角色" width="384" height="384" />}
        </div>
      </section>
      {sections.map(section => <section id={section.kind} className="pixel-section pixel-width" key={section.kind} aria-labelledby={`pixel-title-${section.kind}`} tabIndex={-1}>
        <h2 id={`pixel-title-${section.kind}`}>{section.label}</h2>
        <div className={`pixel-section-grid${section.kind === "projects" ? " pixel-project-grid" : ""}`}>
          {section.items.map((item, index) => <PixelEntry key={`${item.itemId}-${index}`} item={item}
            project={section.kind === "projects"} resolveImage={resolveResumeImage} />)}
        </div>
      </section>)}
    </main>
    {hasContact && <footer id="contact" className="pixel-section pixel-width" aria-labelledby="pixel-contact-title" tabIndex={-1}>
      <h2 id="pixel-contact-title">联系</h2><div className="pixel-contact">
        {profile.email && <a href={`mailto:${profile.email}`}>{profile.email}</a>}
        {phoneNumber && <a href={`tel:${phoneNumber}`}>{phone}</a>}
      </div>
    </footer>}
  </div>;
}
