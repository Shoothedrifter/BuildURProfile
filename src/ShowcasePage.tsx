import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import type { DesignConfig, SkinId } from "../types/config";
import { Marquee } from "./components/Marquee";
import { StackedCards } from "./components/StackedCards";
import { shouldAnimateMarquee } from "./lib/presentation";
import { resumeEntryPresentation } from "./lib/resumePresentation";

const skinOptions: { id: SkinId; label: string; short: string }[] = [
  { id: "dark-tech", label: "Dark tech", short: "01" },
  { id: "light-minimal", label: "Light minimal", short: "02" },
  { id: "high-saturation", label: "High saturation", short: "03" }
];

const sectionIds = new Set(["top", "about", "work", "contact"]);

function touchInput(): boolean {
  return typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 ||
    (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) || false);
}

function ResumeEntry({ value, kind, role = "" }: { value: string; kind: "experience" | "education"; role?: string }) {
  const { heading, subtitle, paragraphs } = resumeEntryPresentation(value, kind, role);
  if (!heading) return null;
  return <article className="resume-entry">
    <h3>{heading}</h3>
    {subtitle && <p className="resume-entry-subtitle">{subtitle}</p>}
    {paragraphs.map((line, index) => <p key={index} className="resume-entry-body">{line}</p>)}
  </article>;
}

export function ShowcasePage({ config, allowSkinSwitch = false, preserveShareHash = false, touchDowngraded = false }: { config: DesignConfig; allowSkinSwitch?: boolean; preserveShareHash?: boolean; touchDowngraded?: boolean }) {
  const [skin, setSkin] = useState<SkinId>(config.skin);
  const [touchDetected, setTouchDetected] = useState(touchInput);
  const touchMode = touchDowngraded || touchDetected;
  const { profile, expertise, projects, workExperience = [], campusExperience = [], education = [] } = config.content;
  const hasExperience = workExperience.length > 0 || campusExperience.length > 0;
  const marqueeItems = config.marquee.items ?? expertise.skills;
  const marqueeLabels = marqueeItems.map((item) => (typeof item === "string" ? item : item.label).trim());
  const skills = expertise.skills.map((skill) => skill.trim()).filter(Boolean);
  const showMarquee = shouldAnimateMarquee(marqueeItems);
  const staticSkills = showMarquee ? skills : [...new Set([...skills, ...marqueeItems.map((item) => typeof item === "string" ? item.trim() : item.label.trim()).filter(Boolean)])];
  const sourceHeadline = expertise.headline.trim();
  const headline = sourceHeadline && !staticSkills.includes(sourceHeadline) ? sourceHeadline : "技能与专长";
  const summary = expertise.summary.trim() && !staticSkills.includes(expertise.summary.trim()) && expertise.summary.trim() !== headline
    ? expertise.summary : "";
  const disciplines = expertise.disciplines.filter((item) => item.trim() && !staticSkills.includes(item.trim()) && !marqueeLabels.includes(item.trim()) && item.trim() !== headline && item.trim() !== summary.trim());
  const hasAbout = Boolean(sourceHeadline || expertise.summary.trim() || staticSkills.length || disciplines.length || profile.summary.trim());
  const exploreTarget = hasAbout ? "#about" : projects.length ? "#work" : profile.email.trim() ? "#contact" : "#top";
  const nameParts = profile.name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? "";
  const restOfName = nameParts.slice(1).join(" ");

  useEffect(() => setSkin(config.skin), [config.skin]);
  useEffect(() => {
    const onTouch = () => setTouchDetected(true);
    window.addEventListener("touchstart", onTouch, { passive: true, once: true });
    return () => window.removeEventListener("touchstart", onTouch);
  }, []);

  const handleSectionClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a[href^='#']");
    const targetId = link?.getAttribute("href")?.slice(1);
    if (!targetId || !sectionIds.has(targetId)) return;
    event.preventDefault();
    document.getElementById(targetId)?.scrollIntoView();
  };

  return (
    <div className="showcase-page" data-testid="showcase-page" data-skin={skin} data-palette={config.styleVector.PChoice} onClickCapture={preserveShareHash ? handleSectionClick : undefined}>
      <header className="site-header page-container">
        <a className="brand" href="#top" aria-label="BuildURProfile home"><span className="brand-symbol">b<span>u</span>.</span><span className="brand-word">BUILD YOUR<br />PROFILE</span></a>
        <nav className="main-nav" aria-label="Main navigation">{hasAbout && <a href="#about">Skills</a>}<a href="#work">Projects</a>{profile.email && <a href="#contact">Contact</a>}</nav>
        <span className="header-status"><span className="status-dot" /> SHOWCASE</span>
      </header>

      {touchMode && <p className="showcase-touch-note page-container" role="note">检测到触屏：卡片手动切换，跑马灯恒定滚动。</p>}

      <main id="top">
        <section className="hero page-container" aria-labelledby="hero-title">
          <div className="hero-meta">{profile.role.trim() && <span>{profile.role}</span>}<span>PROFILE / {new Date().getFullYear()}</span></div>
          <div className="hero-content">
            <div>
              <p className="hero-eyebrow"><span className="hero-eyebrow-line" /> PROFILE</p>
              <h1 id="hero-title" aria-label={profile.name}><span>{firstName}</span>{restOfName && <span className="hero-last">{restOfName}</span>}</h1>
            </div>
            <div className="hero-aside"><div className="hero-stamp" aria-hidden="true"><span>WORK<br />IN<br />MOTION</span><span className="stamp-arrow">↗</span></div>{profile.intro && <p>{profile.intro}</p>}</div>
          </div>
          <div className="hero-bottom"><div className="hero-identity">{(profile.role.trim() || profile.location.trim()) && <p>{profile.role}{profile.role.trim() && profile.location.trim() && <br />}{profile.location.trim() && <span>{profile.location}</span>}</p>}{profile.availability.trim() && <p className="hero-availability">{profile.availability}</p>}</div><div className="hero-links">{projects.length > 0 && <a className="hero-project-link" href="#work">查看项目 ↗</a>}<a className="scroll-hint" href={exploreTarget}>EXPLORE <span>↓</span></a></div></div>
        </section>

        {showMarquee && <section className="ticker-section" aria-label="Skills highlights">
          <div className="ticker-caption page-container"><span>SKILLS</span><span>01 / {String(marqueeItems.length).padStart(2, "0")}</span></div>
          <Marquee {...config.marquee} bindToScroll={touchMode ? false : config.marquee.bindToScroll} pauseOnHover={touchMode ? false : config.marquee.pauseOnHover} items={marqueeItems} />
        </section>}

        {hasAbout && <section className="about-section page-container" id="about" aria-labelledby="about-title">
          <div className="section-marker"><span>01 / SKILLS</span><span className="marker-line" /></div>
          <div className="about-grid">
            <div className="about-heading">{expertise.eyebrow.trim() && <p className="section-overline">{expertise.eyebrow}</p>}<h2 id="about-title">{headline}</h2><div className="about-symbol" aria-hidden="true">↗</div></div>
            <div className="about-copy">
              {profile.summary.trim() && <p className="profile-summary">{profile.summary}</p>}
              {summary && <p className="expertise-summary">{summary}</p>}
              {disciplines.length > 0 && <div className="discipline-list">{disciplines.map((discipline) => <span key={discipline}>{discipline}</span>)}</div>}
              {staticSkills.length > 0 && <ul className="skills-list" aria-label="完整技能">{staticSkills.map((skill, index) => <li key={index}>{skill}</li>)}</ul>}
              {profile.email.trim() && <a href={"mailto:" + profile.email} className="text-link">CONTACT <span aria-hidden="true">↗</span></a>}
            </div>
          </div>
        </section>}

        <section className="work-section page-container" id="work" aria-labelledby="work-title">
          <div className="section-marker"><span>02 / PROJECTS</span><span className="marker-line" /></div>
          <div className="work-heading"><div><p className="section-overline">{projects.length} projects</p><h2 id="work-title">Selected<br /><em>work</em><span className="work-period">.</span></h2></div><p>FROM THE CONFIRMED RESUME</p></div>
          <StackedCards {...config.stackedCards} cards={projects} />
        </section>

        {(hasExperience || education.length > 0) && <section className="resume-section page-container" aria-label="Experience and education">
          <div className="section-marker"><span>03 / EXPERIENCE</span><span className="marker-line" /></div>
          <div className={hasExperience && education.length > 0 ? "resume-columns" : "resume-columns resume-columns--single"}>
            {hasExperience && <div>{workExperience.length > 0 && <><h2>Experience</h2>{workExperience.map((entry, index) => <ResumeEntry key={`work-${index}`} value={entry} kind="experience" role={profile.role} />)}</>}{campusExperience.length > 0 && <><h2>Campus experience</h2>{campusExperience.map((entry, index) => <ResumeEntry key={`campus-${index}`} value={entry} kind="experience" />)}</>}</div>}
            {education.length > 0 && <div><h2>Education</h2>{education.map((entry, index) => <ResumeEntry key={index} value={entry} kind="education" />)}</div>}
          </div>
        </section>}

        {profile.email && <section className="contact-section page-container" id="contact" aria-labelledby="contact-title"><div className="section-marker"><span>04 / CONTACT</span><span className="marker-line" /></div><p className="section-overline">CONTACT</p><h2 id="contact-title">Get in<br /><em>touch.</em></h2><a className="contact-link" href={`mailto:${profile.email}`}><span className="contact-link-address">{profile.email}</span><span className="contact-link-arrow" aria-hidden="true">↗</span></a></section>}
      </main>

      <footer className="site-footer page-container"><span>{profile.name}</span><span>BUILD YOUR PROFILE</span><a href="#top">BACK TO TOP ↑</a></footer>

      {allowSkinSwitch && <aside className="skin-panel" aria-label="Preview skin selector"><div className="skin-panel-heading"><span className="skin-panel-dot" /> LIVE PREVIEW <span className="skin-panel-counter">3 SKINS</span></div><div className="skin-choices">{skinOptions.map((option) => <button key={option.id} type="button" aria-label={option.label} aria-pressed={skin === option.id} className={skin === option.id ? "skin-choice is-active" : "skin-choice"} onClick={() => setSkin(option.id)}><span className={`skin-swatch skin-swatch--${option.id}`} /><span>{option.label}</span><small>{option.short}</small></button>)}</div><p>Config-driven showcase demo</p></aside>}
    </div>
  );
}
