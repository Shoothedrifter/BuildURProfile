import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import type { DesignConfigV4 } from "../../../../packages/contracts/src/config";
import { buildWarmMacaronModel, type WarmMacaronSection } from "../lib/warmMacaron";
import type { ResumeImageResolver } from "./ResumeDisplay";

type Props = {
  config: DesignConfigV4;
  /** Task 4 内容区块消费的媒体解析器；骨架阶段仅在合同中保留。 */
  resolveResumeImage: ResumeImageResolver;
  preserveShareHash?: boolean;
  staticDecorations?: boolean;
  defaultPhotoUrl?: string;
  /** 与 PixelWorldPage 的 loadFont 对齐的预览开关；马卡龙用系统衬线降级，暂无运行时字体请求。 */
  samplePreview?: boolean;
};

const NEXT_LABEL = "继续下滑，探索更多";

function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function reducedMotionPreference(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false);
}

/** 首屏（关于我）：问候、姓名、岗位、介绍盒、联系入口与外扩描边相框；气泡为纯装饰。 */
function MacaronHero({ model, defaultPhotoUrl, contactHref, nextHref, onNavigate }: {
  model: ReturnType<typeof buildWarmMacaronModel>;
  defaultPhotoUrl?: string;
  contactHref?: string;
  nextHref?: string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const { hero } = model;
  const photoSrc = hero.photo?.assetUrl || defaultPhotoUrl;
  const photoAlt = hero.photo?.alt ?? `${hero.name}的默认形象`;
  const introLines = hero.intro ? hero.intro.split(/\r?\n/) : [];
  return <section id="about" data-macaron-section="about" className="macaron-hero" aria-labelledby="macaron-hero-title">
    <div className="macaron-hero-inner">
      <div className="macaron-hero-copy">
        {hero.greeting && <p className="macaron-greeting">{hero.greeting}</p>}
        <h1 id="macaron-hero-title">{hero.name}</h1>
        {hero.role && <p className="macaron-role">{hero.role}</p>}
        {introLines.length > 0 && <div className="macaron-intro">
          {introLines.map((line, index) => <p key={index}>{line}</p>)}
        </div>}
        {contactHref && <div className="macaron-hero-actions">
          <a className="macaron-contact" href={contactHref}>联系我</a>
        </div>}
      </div>
      <div className="macaron-photo-frame">
        {photoSrc && <img src={photoSrc} alt={photoAlt} />}
      </div>
    </div>
    {nextHref && <a className="macaron-next macaron-next--hero" href={nextHref}
      onClick={event => onNavigate(event, nextHref.slice(1))}>{NEXT_LABEL}</a>}
  </section>;
}

export function WarmMacaronPage({ config, staticDecorations = false, defaultPhotoUrl }: Props) {
  const model = useMemo(() => buildWarmMacaronModel(config), [config]);
  const { hero, sections } = model;
  const [reduceMotion, setReduceMotion] = useState(reducedMotionPreference);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState("about");
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navId = useId();
  // 静态导出与「减弱动态效果」共用同一停用开关：气泡与平滑滚动降级，内容与导航保持完整可达。
  const still = staticDecorations || reduceMotion;
  const navItems = useMemo(() => [{ id: "about", label: "关于我" as string },
    ...sections.map((section: WarmMacaronSection) => ({ id: section.id, label: section.title }))], [sections]);
  // 联系入口只在任一公开联系字段非空时渲染；详情模态由 Task 5 接管。
  const contactHref = hero.contact.email ? `mailto:${hero.contact.email}`
    : hero.contact.phone ? `tel:${hero.contact.phone.replace(/[^+\d]/g, "")}` : undefined;

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduceMotion(Boolean(media?.matches));
    media?.addEventListener?.("change", onChange);
    return () => media?.removeEventListener?.("change", onChange);
  }, []);

  // 滚动高亮：视口上沿的阅读线落到哪一幕，就把导航与幕标记为当前区；无滚动事件时保持首屏。
  useEffect(() => {
    const panes = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-macaron-section]") ?? []).reverse();
    if (!panes.length) return;
    const update = () => {
      const readingLine = Math.min(200, window.innerHeight * 0.25);
      const visible = panes.find(pane => pane.getBoundingClientRect().top <= readingLine);
      const id = visible?.dataset.macaronSection ?? panes.at(-1)?.dataset.macaronSection;
      if (id) setActiveId(id);
    };
    window.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [sections]);

  const goToSection = useCallback((next: string) => {
    setMenuOpen(false);
    setActiveId(next);
    const pane = root.current?.querySelector<HTMLElement>(`[data-macaron-section="${next}"]`);
    pane?.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: true });
    pane?.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [still]);

  // 站内锚点统一接管：普通点击不改写地址栏（分享令牌与预览 URL 均保持原样），
  // 带修饰键的点击回落到浏览器默认行为，离线导出的片段定位不受影响。
  function navigate(event: MouseEvent<HTMLAnchorElement>, next: string) {
    if (!plainClick(event)) return;
    event.preventDefault();
    goToSection(next);
  }

  return <div ref={root} className="warm-macaron" data-testid="warm-macaron-page" data-static={still ? "true" : undefined}>
    <header className="macaron-topbar" onKeyDown={event => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    }}>
      <div className="macaron-topbar-inner">
        <a className="macaron-brand" href="#about" onClick={event => navigate(event, "about")}>{hero.name}</a>
        {navItems.length > 1 && <>
          <button ref={menuButton} type="button" className="macaron-menu-toggle" aria-controls={navId}
            aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>目录</button>
          <nav className="macaron-chapters" id={navId} aria-label="作品集导航" data-open={menuOpen || undefined}>
            {navItems.map(item => <a key={item.id} href={`#${item.id}`}
              aria-current={activeId === item.id ? "location" : undefined}
              onClick={event => navigate(event, item.id)}>{item.label}</a>)}
          </nav>
        </>}
      </div>
    </header>

    <div className="macaron-bubbles" aria-hidden="true">
      {[1, 2, 3, 4, 5, 6].map(index => <i key={index} className={`macaron-bubble macaron-bubble--${index}`}
        style={still ? { animation: "none" } : undefined} />)}
    </div>

    <main>
      <MacaronHero model={model} defaultPhotoUrl={defaultPhotoUrl} contactHref={contactHref}
        nextHref={sections[0] ? `#${sections[0].id}` : undefined} onNavigate={navigate} />

      {sections.map((section, index) => {
        const next = sections[index + 1];
        return <section key={section.id} id={section.id} data-macaron-section={section.id}
          className="macaron-act" aria-labelledby={`macaron-${section.id}-title`}>
          <div className="macaron-act-inner">
            <p className="macaron-eyebrow">{section.eyebrow}</p>
            <h2 id={`macaron-${section.id}-title`} tabIndex={-1}>{section.title}</h2>
            {/* Task 4 在此挂载内容区块；骨架阶段的空容器不渲染任何占位卡。 */}
            <div className="macaron-act-body" />
          </div>
          {next && <a className="macaron-next" href={`#${next.id}`}
            onClick={event => navigate(event, next.id)}>{NEXT_LABEL}</a>}
        </section>;
      })}
    </main>
  </div>;
}
