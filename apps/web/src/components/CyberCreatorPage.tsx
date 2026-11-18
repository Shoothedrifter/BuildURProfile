import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { DesignConfigV4, ResumeDisplayItem } from "../../../../packages/contracts/src/config";
import { RESUME_KINDS, RESUME_LABELS } from "../../../../packages/contracts/src/resume-v2.mjs";
import { buildCyberCreatorPresentation, type CyberProject } from "../lib/cyber-creator-presentation";
import { CyberPortrait } from "./CyberPortrait";
import { ResumeSupplement, type ResumeImageResolver } from "./ResumeDisplay";

type Props = {
  config: DesignConfigV4;
  resolveResumeImage: ResumeImageResolver;
  preserveShareHash?: boolean;
  touchDowngraded?: boolean;
  defaultPortraitUrl?: string;
};

function safeArtwork(value: string | undefined): boolean {
  return Boolean(value && /^(?:\/api\/hero-assets\/[0-9a-f-]{36}|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(value));
}

function ProjectCard({ project, resolveResumeImage }: { project: CyberProject; resolveResumeImage: ResumeImageResolver }) {
  const { item, images, layout, link } = project;
  const primary = images.slice(0, 3);
  const remaining = images.slice(3);
  return <article className="cyber-project-card" data-layout={layout}>
    <div className="cyber-project-top"><span>{String(project.index).padStart(2, "0")}</span><h3>{item.title || `项目 ${project.index}`}</h3>
      {link && <a className="cyber-project-link" href={link.url} target="_blank" rel="noopener noreferrer">{link.label || "查看项目"} ↗</a>}</div>
    <div className="cyber-project-content">
      <div className="cyber-project-copy">
        {item.details && <p className="cyber-preserve-lines">{item.details}</p>}
        {item.supplement.text && <p className="cyber-preserve-lines">{item.supplement.text}</p>}
        {item.facts.length > 0 && <dl>{item.facts.filter(fact => fact.value.trim()).map(fact => <div key={fact.key}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
        {item.supplement.links.length > 1 && <ul>{item.supplement.links.slice(1).map((extra, index) => <li key={`${extra.url}-${index}`}><a href={extra.url} target="_blank" rel="noopener noreferrer">{extra.label || extra.url} ↗</a></li>)}</ul>}
      </div>
      {primary.length > 0 && <div className={`cyber-project-mosaic cyber-project-mosaic--${layout}`}>
        {primary.map(image => <figure key={image.imageId}><img loading="lazy" src={resolveResumeImage(image.imageId)} alt={image.caption || `${item.title}的项目图片`} />{image.caption && <figcaption>{image.caption}</figcaption>}</figure>)}
      </div>}
    </div>
    {remaining.length > 0 && <details className="cyber-project-more"><summary>查看其余图片</summary><div>{remaining.map(image => <figure key={image.imageId}><img loading="lazy" src={resolveResumeImage(image.imageId)} alt={image.caption || `${item.title}的项目图片`} />{image.caption && <figcaption>{image.caption}</figcaption>}</figure>)}</div></details>}
  </article>;
}

function ItemContent({ item, resolveResumeImage }: { item: ResumeDisplayItem; resolveResumeImage: ResumeImageResolver }) {
  return <article className="cyber-entry">{item.title && <h3>{item.title}</h3>}{item.details && <p className="cyber-preserve-lines">{item.details}</p>}
    <ResumeSupplement item={item} resolveImage={resolveResumeImage} />
  </article>;
}

export function CyberCreatorPage({ config, resolveResumeImage, preserveShareHash = false, touchDowngraded = false, defaultPortraitUrl = "/cyber-creator-bust.webp" }: Props) {
  const view = buildCyberCreatorPresentation(config);
  const [defaultPortraitFailed, setDefaultPortraitFailed] = useState(false);
  const [staticMode, setStaticMode] = useState(touchDowngraded);
  const marqueeRef = useRef<HTMLElement>(null);
  const projectRef = useRef<HTMLElement>(null);
  const { profile } = view;
  const email = profile.email.trim();
  const hasAbout = view.sections.some(section => section.kind === "selfEvaluation");
  const hasSkills = view.sections.some(section => section.kind === "skills");
  const hasProjects = view.projects.length > 0;

  useEffect(() => {
    const pointer = window.matchMedia?.("(pointer: coarse)");
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setStaticMode(touchDowngraded || navigator.maxTouchPoints > 0 || Boolean(pointer?.matches || motion?.matches));
    update();
    pointer?.addEventListener?.("change", update);
    motion?.addEventListener?.("change", update);
    return () => { pointer?.removeEventListener?.("change", update); motion?.removeEventListener?.("change", update); };
  }, [touchDowngraded]);

  useEffect(() => {
    const cards = [...(projectRef.current?.querySelectorAll<HTMLElement>(".cyber-project-card") ?? [])];
    const update = () => cards.forEach(card => card.classList.toggle("cyber-project-card--flow",
      card.offsetHeight > window.innerHeight - 115));
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    cards.forEach(card => observer?.observe(card));
    window.addEventListener("resize", update);
    update();
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [config.content.resume]);

  useEffect(() => {
    if (staticMode) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const marquee = marqueeRef.current;
      if (marquee) {
        const offset = (window.scrollY - (marquee.getBoundingClientRect().top + window.scrollY) + window.innerHeight) * 0.3;
        marquee.style.setProperty("--cyber-scroll", `${offset}px`);
      }
      projectRef.current?.querySelectorAll<HTMLElement>(".cyber-project-card").forEach((card, index) => {
        const amount = Math.max(0, Math.min(1, (110 + index * 25 - card.getBoundingClientRect().top) / window.innerHeight));
        card.style.setProperty("--cyber-card-scale", String(1 - amount * 0.055));
      });
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); if (frame) window.cancelAnimationFrame(frame); };
  }, [staticMode]);

  const preserveHash = (event: MouseEvent<HTMLDivElement>) => {
    if (!preserveShareHash || !(event.target instanceof Element)) return;
    const link = event.target.closest("a[href^='#']");
    const id = link?.getAttribute("href")?.slice(1);
    if (id && document.getElementById(id)) { event.preventDefault(); document.getElementById(id)?.scrollIntoView(); }
  };

  return <div className="cyber-creator-page" data-testid="cyber-creator-page" data-skin="dark-tech" data-static={staticMode ? "true" : undefined} onClickCapture={preserveHash}>
    <header className="cyber-nav"><a href="#top" aria-label={`${profile.name} 首页`}>{profile.name || "PORTFOLIO"}<span className="cyber-nav-dot">.</span></a>
      <nav aria-label="作品集导航">{hasAbout && <a href="#selfEvaluation">关于</a>}{hasSkills && <a href="#skills">能力</a>}{hasProjects && <a href="#projects">项目</a>}{email && <a href="#contact">联系</a>}</nav></header>
    <main>
      <section className="cyber-hero" id="top" aria-labelledby="cyber-hero-title">
        <p className="cyber-hero-kicker">CREATOR PORTFOLIO <span>✦</span> {profile.role}</p>
        <h1 id="cyber-hero-title">{profile.name}</h1>
        <div className="cyber-hero-figure">{safeArtwork(config.heroArtwork?.assetUrl)
          ? <img src={config.heroArtwork?.assetUrl} alt={config.heroArtwork?.alt || "用户肖像"} />
          : defaultPortraitFailed ? <CyberPortrait />
          : <img src={defaultPortraitUrl} alt="赛博科技默认立体人物" onError={() => setDefaultPortraitFailed(true)} />}</div>
        <div className="cyber-hero-bottom"><p>{[profile.role, profile.location].filter(Boolean).join(" · ") || profile.summary || ""}</p>
          {email && <a href={`mailto:${email}`} className="cyber-contact-button">联系我 ↗</a>}</div>
        <span className="cyber-hero-side">SCROLL TO EXPLORE ↓</span>
      </section>

      {(view.marquee.mode === "images" || view.marquee.labels.length > 0) && <section className="cyber-marquee" aria-label="作品与能力预览" ref={marqueeRef}>
        {view.marquee.mode === "images" ? [0, 1].map(row => <div className={`cyber-marquee-row cyber-marquee-row--${row}`} key={row}>
          {[...view.marquee.images, ...view.marquee.images].map((image, index) => <figure key={`${row}-${index}`} aria-hidden="true"><img loading="lazy" src={resolveResumeImage(image.imageId)} alt="" /><figcaption>{image.projectTitle}</figcaption></figure>)}
        </div>) : <div className="cyber-marquee-text">{view.marquee.labels.map((label, index) => <span key={`${label}-${index}`}>{label} ✦</span>)}</div>}
      </section>}

      {view.sections.map(section => {
        if (section.kind === "basicInfo" || section.kind === "jobIntent") {
          const items = section.items.filter(item => item.facts.some(fact => fact.value.trim() && !["name", "email", "location", "targetRole"].includes(fact.key))
            || item.supplement.text.trim() || item.supplement.links.length || item.supplement.images.length);
          if (!items.length) return null;
          return <section className="cyber-generic cyber-page-width" id={section.kind} key={section.kind}><p className="cyber-section-label">PROFILE / {section.order + 1}</p>
            <h2>{RESUME_LABELS[RESUME_KINDS.indexOf(section.kind)]}</h2><div className="cyber-entry-grid">{items.map(item => <ItemContent item={{ ...item, facts: item.facts.filter(fact => !["name", "email", "location", "targetRole"].includes(fact.key)) }} resolveResumeImage={resolveResumeImage} key={item.itemId} />)}</div></section>;
        }
        if (section.kind === "selfEvaluation") return <section className="cyber-about cyber-page-width" id={section.kind} key={section.kind}>
          <p className="cyber-section-label">ABOUT / {String(section.order + 1).padStart(2, "0")}</p><h2>ABOUT ME</h2>
          <div className="cyber-about-copy">{section.items.map(item => <ItemContent item={item} resolveResumeImage={resolveResumeImage} key={item.itemId} />)}</div>
          {email && <a href={`mailto:${email}`} className="cyber-contact-button">联系我 ↗</a>}
        </section>;
        if (section.kind === "skills") return <section className="cyber-capabilities" id={section.kind} key={section.kind}><div className="cyber-page-width">
          <p className="cyber-section-label">CAPABILITIES / {String(section.order + 1).padStart(2, "0")}</p><h2>能力与专长</h2>
          <div className="cyber-capability-list">{section.items.map((item, index) => <div className="cyber-capability" key={item.itemId}><span>{String(index + 1).padStart(2, "0")}</span><ItemContent item={item} resolveResumeImage={resolveResumeImage} /></div>)}</div>
        </div></section>;
        if (section.kind === "projects") return <section className="cyber-projects" id={section.kind} key={section.kind} ref={projectRef}><div className="cyber-page-width">
          <p className="cyber-section-label">SELECTED WORK / {String(section.order + 1).padStart(2, "0")}</p><h2>PROJECTS</h2>
          <div className="cyber-project-stack">{view.projects.map(project => <ProjectCard project={project} resolveResumeImage={resolveResumeImage} key={project.item.itemId} />)}</div>
        </div></section>;
        return <section className="cyber-generic cyber-page-width" id={section.kind} key={section.kind}><p className="cyber-section-label">EXPERIENCE / {String(section.order + 1).padStart(2, "0")}</p>
          <h2>{RESUME_LABELS[RESUME_KINDS.indexOf(section.kind)]}</h2><div className="cyber-entry-grid">{section.items.map(item => <ItemContent item={item} resolveResumeImage={resolveResumeImage} key={item.itemId} />)}</div></section>;
      })}
    </main>
    <footer className="cyber-footer" id="contact"><span>{profile.name}</span>{email && <a href={`mailto:${email}`}>{email} ↗</a>}<a href="#top">返回顶部 ↑</a></footer>
  </div>;
}
