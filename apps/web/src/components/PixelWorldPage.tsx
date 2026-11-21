import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { DesignConfigV4, ResumeDisplayItem } from "../../../../packages/contracts/src/config";
import {
  dateField, pixelAddressFromLocation, pixelAddressHref, pixelWorldPresentation,
  type PixelAddress, type PixelAddressMode, type PixelChapter,
} from "../lib/pixelWorldPresentation";
import { pixelFontChapterLabels, pixelFontFaceCss, pixelFontRequestHref } from "../lib/pixelFontLabels.mjs";
import { PixelProjectArchive, PixelProjectDialog, pixelProjectLinkId } from "./PixelWorldProjects";
import { ResumeSupplement, type ResumeImageResolver } from "./ResumeDisplay";

export const pixelDefaultPortrait = "/pixel-world-base.svg";
const chapterLabels: Record<PixelChapter, string> = pixelFontChapterLabels();
type VisibleSection = ReturnType<typeof pixelWorldPresentation>["experience"][number];
type Props = {
  config: DesignConfigV4;
  resolveResumeImage: ResumeImageResolver;
  preserveShareHash?: boolean;
  staticDecorations?: boolean;
  defaultPortraitUrl?: string;
};

function PixelEntry({ item, resolveImage, Title = "h4" }: { item: ResumeDisplayItem; resolveImage: ResumeImageResolver; Title?: "h3" | "h4" }) {
  const summary = item.details.trim();
  const source = item.sourceText?.trim();
  const long = summary.length > 480 || summary.split(/\r?\n/).length > 6;
  const highlights = item.presentationHighlights ?? [];
  const { text, links, images } = item.supplement;
  return <article className="pixel-entry">
    {item.title.trim() && <Title>{item.title}</Title>}
    {summary && (long ? <details className="pixel-entry-details"><summary>展开内容</summary>
      <p className="pixel-copy">{summary}</p></details> : <p className="pixel-copy">{summary}</p>)}
    {highlights.length > 0 && <dl className="pixel-highlights" aria-label="已确认成果">{highlights.map(highlight =>
      <div key={highlight.id}><dt>{highlight.label}</dt><dd>{highlight.value}{highlight.unit}</dd></div>)}</dl>}
    {(item.facts.length > 0 || text.trim() || links.length > 0 || images.length > 0) &&
      <ResumeSupplement item={item} resolveImage={resolveImage} />}
    {source && source !== summary && <details className="pixel-entry-details">
      <summary>查看条目原文</summary><p className="pixel-copy">{source}</p>
    </details>}
  </article>;
}

function ResumeSection({ section, resolveImage }: { section: VisibleSection; resolveImage: ResumeImageResolver }) {
  const headingId = useId();
  const chronological = ["workExperience", "education", "campusExperience"].includes(section.kind);
  return <section className="pixel-resume-section" aria-labelledby={headingId}>
    <h3 id={headingId}>{section.label}</h3>
    <div className={chronological ? "pixel-timeline" : undefined}>{section.items.map(item => {
      const date = chronological ? item.facts.find(fact => dateField.test(fact.key.trim()) || dateField.test(fact.label.trim())) : undefined;
      const entry = date ? { ...item, facts: item.facts.filter(fact => fact !== date) } : item;
      return <div className="pixel-resume-item" key={item.itemId}>
        {date && <dl className="pixel-resume-date"><dt>{date.label}</dt><dd>{date.value}</dd></dl>}
        <PixelEntry item={entry} resolveImage={resolveImage} />
      </div>;
    })}</div>
  </section>;
}

function PixelPortrait({ artwork, defaultUrl }: { artwork: DesignConfigV4["heroArtwork"]; defaultUrl: string }) {
  const [failedPortrait, setFailedPortrait] = useState<string | null>(null);
  const portrait = artwork?.assetUrl;
  const showPortrait = portrait && /^\/api\/hero-assets\/[a-f0-9-]{36}$/i.test(portrait) && failedPortrait !== portrait;
  return <div className="pixel-stage">
    <div className="pixel-stage-grid" aria-hidden="true" />
    <div className="pixel-speech pixel-label" aria-hidden="true">你好！<i /></div>
    <img className="pixel-portrait" src={showPortrait ? portrait : defaultUrl}
      alt={showPortrait ? artwork?.alt || "个人像素头像" : "像素世界风默认角色"} width="512" height="512"
      onError={showPortrait ? () => setFailedPortrait(portrait) : undefined} />
  </div>;
}

function plainClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function PixelWorldPage({ config, resolveResumeImage, preserveShareHash = false,
  staticDecorations = false, defaultPortraitUrl = pixelDefaultPortrait }: Props) {
  const { name, role, intro, about, projects, experience, email, phone, phoneNumber } = useMemo(() => pixelWorldPresentation(config), [config]);
  const hasAbout = about.length > 0;
  const hasWorks = projects.length > 0;
  const hasExperience = experience.length > 0;
  const hasContact = Boolean(email || phoneNumber);
  const chapters = useMemo<PixelChapter[]>(() => {
    const visible: PixelChapter[] = ["top"];
    if (hasAbout) visible.push("about");
    if (hasWorks) visible.push("works");
    if (hasExperience) visible.push("experience");
    if (hasContact) visible.push("contact");
    return visible;
  }, [hasAbout, hasWorks, hasExperience, hasContact]);
  const mode: PixelAddressMode = preserveShareHash ? "share" : staticDecorations ? "export" : "preview";
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentChapter, setCurrentChapter] = useState<PixelChapter>("top");
  const [projectId, setProjectId] = useState<string>();
  const openedFromArchive = useRef(false);
  const backPending = useRef(false);
  const focusProject = useRef<string | undefined>(undefined);
  const activeProject = projects.find(item => item.itemId === projectId);
  const chapter = chapters.includes(currentChapter) ? currentChapter : "top";
  const firstDestination = hasWorks ? "works" : hasExperience ? "experience" : hasAbout ? "about" : undefined;

  function addressHref(address: PixelAddress) {
    return pixelAddressHref(address, mode, typeof window === "undefined" ? undefined : window.location);
  }

  const goToChapter = useCallback((next: PixelChapter, focus: boolean) => {
    setCurrentChapter(next);
    const section = root.current?.querySelector<HTMLElement>(`[data-pixel-chapter="${next}"]`);
    if (focus) section?.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: true });
    section?.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, []);

  useEffect(() => {
    if (mode === "export") return;
    // 预览与分享模式按需加载像素字体子集；离线导出由导出器内嵌 data URI。
    const style = document.createElement("style");
    style.textContent = pixelFontFaceCss(pixelFontRequestHref(name));
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, [mode, name]);

  useEffect(() => {
    if (mode === "preview") return;
    function readAddress(fromHistory: boolean) {
      const leavingCase = backPending.current || openedFromArchive.current;
      backPending.current = false;
      const requested = pixelAddressFromLocation(mode, window.location);
      const next = chapters.includes(requested.chapter) ? requested.chapter : "top";
      openedFromArchive.current = Boolean(requested.caseId && window.history.state?.pixelWorldCaseId === requested.caseId);
      if (openedFromArchive.current) focusProject.current = requested.caseId;
      setMenuOpen(false);
      setProjectId(requested.caseId);
      // Keep the archive in place when opening a local case or returning to its row.
      if (fromHistory && (leavingCase || openedFromArchive.current)) {
        setCurrentChapter(chapters.includes("works") ? "works" : next);
        return;
      }
      // Leave the default scroll position alone when mounting a regular share.
      if (fromHistory || next !== "top") goToChapter(next, false);
    }
    readAddress(false);
    const onAddressChange = () => readAddress(true);
    const eventType = mode === "export" ? "hashchange" : "popstate";
    window.addEventListener(eventType, onAddressChange);
    return () => window.removeEventListener(eventType, onAddressChange);
  }, [mode, chapters, goToChapter]);

  useEffect(() => {
    const sections = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-pixel-chapter]") ?? []).reverse();
    let frame = 0;
    function update() {
      frame = 0;
      const readingLine = Math.min(180, window.innerHeight * 0.24);
      let visible = sections.find(section => section.getBoundingClientRect().top <= readingLine);
      const last = sections[0];
      if (last && Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight &&
          last.getBoundingClientRect().top < window.innerHeight) visible = last;
      if (visible?.dataset.pixelChapter) setCurrentChapter(visible.dataset.pixelChapter as PixelChapter);
    }
    function scheduleUpdate() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }
    window.addEventListener("scroll", scheduleUpdate, { capture: true, passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [chapters]);

  // P1 滚动入场：区块首次进入视口时打上 data-revealed，CSS 以逐帧动画落位；
  // 无 IntersectionObserver 的环境（jsdom、无 JS 导出）自动跳过，不隐藏任何内容。
  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const sections = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-pixel-chapter]") ?? []);
    if (!sections.length) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        (entry.target as HTMLElement).dataset.revealed = "";
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12 });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [chapters]);

  useLayoutEffect(() => {
    if (activeProject || !focusProject.current) return;
    const link = document.getElementById(pixelProjectLinkId(focusProject.current));
    focusProject.current = undefined;
    link?.focus({ preventScroll: true });
    link?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [activeProject]);

  function writeAddress(address: PixelAddress, replace = false) {
    if (mode === "preview") return;
    const href = addressHref(address);
    if (mode === "export") {
      if (href === window.location.hash) return;
      if (replace) window.location.replace(href);
      else window.location.hash = href;
    } else if (href !== window.location.pathname + window.location.search + window.location.hash) {
      if (replace) window.history.replaceState(window.history.state, "", href);
      else window.history.pushState(window.history.state, "", href);
    }
  }

  function navigate(event: MouseEvent<HTMLAnchorElement>, next: PixelChapter) {
    if (!plainClick(event)) return;
    event.preventDefault();
    setMenuOpen(false);
    writeAddress({ chapter: next });
    goToChapter(next, true);
  }

  function openProject(event: MouseEvent<HTMLAnchorElement>, itemId: string) {
    if (!plainClick(event)) return;
    event.preventDefault();
    focusProject.current = itemId;
    if (mode !== "preview") {
      writeAddress({ chapter: "works", caseId: itemId });
      // Mark this entry without rewriting its URL so file:// exports also support Forward.
      window.history.replaceState({ ...window.history.state, pixelWorldCaseId: itemId }, "");
      openedFromArchive.current = true;
    }
    setCurrentChapter("works");
    setProjectId(itemId);
  }

  function dismissProject() {
    if (!activeProject || backPending.current) return;
    focusProject.current = activeProject.itemId;
    if (openedFromArchive.current) {
      backPending.current = true;
      window.history.back();
      return;
    }
    if (mode === "export") {
      // Wait for native fragment navigation before restoring the row's position.
      backPending.current = true;
      writeAddress({ chapter: "works" }, true);
      return;
    }
    writeAddress({ chapter: "works" }, true);
    setProjectId(undefined);
  }

  return <div ref={root} className="pixel-world" data-testid="pixel-world-page">
    <header className="pixel-header" onKeyDown={event => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    }}>
      <div className="pixel-header-inner pixel-width">
        <a className="pixel-brand pixel-label" href={addressHref({ chapter: "top" })} onClick={event => navigate(event, "top")}>
          <span aria-hidden="true" />{name}
        </a>
        {chapters.length > 1 && <>
          <button ref={menuButton} type="button" className="pixel-menu-toggle pixel-label" aria-controls={navId}
            aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>章节</button>
          <nav className="pixel-chapters" id={navId} aria-label="作品集导航" data-open={menuOpen || undefined}>
            {chapters.map(next => <a key={next} className="pixel-label" href={addressHref({ chapter: next })}
              aria-current={chapter === next ? "location" : undefined} onClick={event => navigate(event, next)}>
              <span className="pixel-chapter-no" aria-hidden="true">{String(chapters.indexOf(next) + 1).padStart(2, "0")}</span>
              <span>{chapterLabels[next]}</span><i aria-hidden="true" />
            </a>)}
          </nav>
        </>}
      </div>
    </header>

    <main className="pixel-main">
      <section id="top" data-pixel-chapter="top" className="pixel-hero pixel-width">
        <div className="pixel-hero-copy">
          {role && <p className="pixel-role">{role}</p>}
          <h1 tabIndex={-1}>{name}</h1>
        </div>
        {(firstDestination || hasContact) && <div className="pixel-actions">
          {firstDestination && <a className="pixel-button pixel-label" href={addressHref({ chapter: firstDestination })}
            onClick={event => navigate(event, firstDestination)}>
            {firstDestination === "works" ? "查看作品" : firstDestination === "experience" ? "查看经历" : "了解更多"}
            <span aria-hidden="true">↘</span>
          </a>}
          {hasContact && <a className="pixel-text-link" href={addressHref({ chapter: "contact" })}
            onClick={event => navigate(event, "contact")}>联系我</a>}
        </div>}
        <PixelPortrait artwork={config.heroArtwork} defaultUrl={defaultPortraitUrl} />
        {intro && <p className="pixel-hero-intro pixel-copy">{intro}</p>}
        <p className="pixel-press pixel-label" aria-hidden="true">▼ 向下滚动</p>
      </section>

      <div className="pixel-ticker" aria-hidden="true">
        <span>{"像素世界 PIXEL WORLD ★ ".repeat(10)}</span><span>{"像素世界 PIXEL WORLD ★ ".repeat(10)}</span>
      </div>

      {hasAbout && <section id="about" data-pixel-chapter="about" className="pixel-about pixel-width" aria-labelledby="pixel-about-title">
        <div className="pixel-about-glyph" aria-hidden="true"><i /><i /><i /></div>
        <div className="pixel-about-copy">
          <h2 id="pixel-about-title" tabIndex={-1}>关于我</h2>
          {about.map(item => <PixelEntry key={item.itemId} item={item} resolveImage={resolveResumeImage} Title="h3" />)}
        </div>
      </section>}

      {hasWorks && <PixelProjectArchive projects={projects} name={name} role={role} resolveImage={resolveResumeImage}
        homeHref={addressHref({ chapter: "top" })} onHome={event => navigate(event, "top")}
        caseHref={caseId => addressHref({ chapter: "works", caseId })} onProject={openProject} />}

      {hasExperience && <section id="experience" data-pixel-chapter="experience" className="pixel-section pixel-width" aria-labelledby="pixel-experience-title">
        <h2 id="pixel-experience-title" tabIndex={-1}>经历与能力</h2>
        <div className="pixel-experience">
          {experience.map(section => <ResumeSection key={section.kind} section={section} resolveImage={resolveResumeImage} />)}
        </div>
      </section>}
    </main>

    {hasContact && <section id="contact" data-pixel-chapter="contact" className="pixel-section pixel-contact pixel-width"
      aria-labelledby="pixel-contact-title">
      <h2 id="pixel-contact-title" tabIndex={-1}>取得联系</h2>
      <div>
        {email && <a href={"mailto:" + email}>{email}</a>}
        {phoneNumber && <a href={"tel:" + phoneNumber}>{phone}</a>}
      </div>
    </section>}

    <footer className="pixel-footer pixel-width">
      <span>{name}</span>
      <a className="pixel-text-link" href={addressHref({ chapter: "top" })} onClick={event => navigate(event, "top")}>
        回到起点 <span aria-hidden="true">↑</span>
      </a>
    </footer>
    {activeProject && <PixelProjectDialog item={activeProject} key={activeProject.itemId}
      resolveImage={resolveResumeImage} onDismiss={dismissProject} />}
  </div>;
}
