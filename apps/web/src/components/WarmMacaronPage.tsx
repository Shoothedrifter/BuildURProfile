import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import type { DesignConfigV4 } from "../../../../packages/contracts/src/config";
import { buildWarmMacaronModel, type WarmMacaronCard, type WarmMacaronSection } from "../lib/warmMacaron";
import type { ResumeImageResolver } from "./ResumeDisplay";
import { MACARON_NEXT_LABEL, WarmMacaronSections } from "./WarmMacaronSections";
import {
  MacaronContactDialog, MacaronDetailDialog, MacaronLightbox, MacaronShowcaseDialog,
  findMacaronDetail, macaronAddressFromLocation, macaronAddressHref,
  type MacaronAddress, type MacaronAddressMode, type MacaronDetail, type MacaronDetailKind,
} from "./WarmMacaronModals";

type Props = {
  config: DesignConfigV4;
  /** 内容区块消费的媒体解析器。 */
  resolveResumeImage: ResumeImageResolver;
  preserveShareHash?: boolean;
  staticDecorations?: boolean;
  defaultPhotoUrl?: string;
  /** 与 PixelWorldPage 的 loadFont 对齐的预览开关；马卡龙用系统衬线降级，暂无运行时字体请求。 */
  samplePreview?: boolean;
};

function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function reducedMotionPreference(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false);
}

/** 首屏（关于我）：问候、姓名、岗位、介绍盒、联系入口与外扩描边相框；气泡为纯装饰。 */
function MacaronHero({ model, defaultPhotoUrl, onOpenContact, nextId, nextHref, onNavigate }: {
  model: ReturnType<typeof buildWarmMacaronModel>;
  defaultPhotoUrl?: string;
  onOpenContact?: () => void;
  nextId?: string;
  nextHref?: string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const { hero } = model;
  const photoSrc = hero.photo?.assetUrl || defaultPhotoUrl;
  // 空白 alt 与空姓名都回退到可读模板，避免读屏拿到空替代文本或裸前缀。
  const photoAlt = hero.photo?.alt.trim() || `${hero.name.trim() || "设计师"}的默认形象`;
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
        {onOpenContact && <div className="macaron-hero-actions">
          <button type="button" className="macaron-contact" onClick={onOpenContact}>联系我</button>
        </div>}
      </div>
      <div className="macaron-photo-frame">
        {photoSrc && <img src={photoSrc} alt={photoAlt} />}
      </div>
    </div>
    {nextHref && nextId && <a className="macaron-next macaron-next--hero" href={nextHref}
      onClick={event => onNavigate(event, nextId)}>{MACARON_NEXT_LABEL}</a>}
  </section>;
}

export function WarmMacaronPage({ config, resolveResumeImage, preserveShareHash = false, staticDecorations = false,
  defaultPhotoUrl = "/warm-macaron-default.svg" }: Props) {
  const model = useMemo(() => buildWarmMacaronModel(config), [config]);
  const { hero, sections } = model;
  const [reduceMotion, setReduceMotion] = useState(reducedMotionPreference);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState("about");
  const [detail, setDetail] = useState<MacaronDetail>();
  const [zoom, setZoom] = useState<{ src: string; caption: string }>();
  const [contactOpen, setContactOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navId = useId();
  // 详情模态的地址簿记（对齐像素世界风）：列表打开的详情关闭时走历史回退，深链打开的改写参数。
  const openedFromList = useRef(false);
  const backPending = useRef(false);
  const detailSection = useRef<string | undefined>(undefined);
  const navItems = useMemo(() => [{ id: "about", label: "关于我" as string },
    ...sections.map((section: WarmMacaronSection) => ({ id: section.id, label: section.title }))], [sections]);
  // 静态导出与「减弱动态效果」共用同一停用开关：气泡与平滑滚动降级，内容与导航保持完整可达。
  const still = staticDecorations || reduceMotion;
  const mode: MacaronAddressMode = preserveShareHash ? "share" : staticDecorations ? "export" : "preview";
  // 联系入口只在任一公开联系字段非空时出现，点击打开联系卡模态。
  const hasContact = Boolean(hero.contact.email || hero.contact.phone);

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

  const goToSection = useCallback((next: string, focus = true) => {
    setMenuOpen(false);
    setActiveId(next);
    const pane = root.current?.querySelector<HTMLElement>(`[data-macaron-section="${next}"]`);
    if (focus) pane?.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: true });
    pane?.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [still]);

  function addressHref(address: MacaronAddress) {
    return macaronAddressHref(address, mode, typeof window === "undefined" ? undefined : window.location);
  }

  function writeAddress(address: MacaronAddress, replace = false) {
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

  // 分享与导出模式读取地址定位（对齐像素世界风）：挂载时消费深链，popstate/hashchange 时同步。
  useEffect(() => {
    if (mode === "preview") return;
    function readAddress(fromHistory: boolean) {
      const leavingCase = backPending.current || openedFromList.current;
      backPending.current = false;
      const requested = macaronAddressFromLocation(model, mode, window.location);
      openedFromList.current = Boolean(requested.caseId && window.history.state?.macaronCaseId === requested.caseId);
      setDetail(requested.caseId ? findMacaronDetail(model, requested.caseId) : undefined);
      setZoom(undefined);
      setContactOpen(false);
      // 离开或返回条目详情时停留在详情所在区块，不把视口拽回首屏。
      if (fromHistory && (leavingCase || openedFromList.current)) {
        setActiveId(detailSection.current ?? requested.sectionId);
        return;
      }
      if (fromHistory || requested.sectionId !== "about") goToSection(requested.sectionId, false);
    }
    readAddress(false);
    const onAddressChange = () => readAddress(true);
    const eventType = mode === "export" ? "hashchange" : "popstate";
    window.addEventListener(eventType, onAddressChange);
    return () => window.removeEventListener(eventType, onAddressChange);
  }, [mode, model, goToSection]);

  function openDetail(kind: MacaronDetailKind, card: WarmMacaronCard) {
    const sectionId = kind === "project" ? "projects" : "showcase";
    detailSection.current = sectionId;
    setActiveId(sectionId);
    if (mode !== "preview") {
      writeAddress({ sectionId, caseId: card.itemId });
      // 标记当前历史条目（不改写 URL）：前进也能重开同一条目，文件导出同样可用。
      window.history.replaceState({ ...window.history.state, macaronCaseId: card.itemId }, "");
      openedFromList.current = true;
    }
    setDetail({ kind, card });
  }

  function dismissDetail() {
    if (!detail || backPending.current) return;
    const sectionId = detail.kind === "project" ? "projects" : "showcase";
    if (openedFromList.current) {
      backPending.current = true;
      window.history.back();
      return;
    }
    if (mode === "export") {
      // 等原生片段跳转完成后再恢复列表位置。
      backPending.current = true;
      writeAddress({ sectionId }, true);
      return;
    }
    writeAddress({ sectionId }, true);
    setDetail(undefined);
    setZoom(undefined);
  }

  const openZoom = (src: string, caption: string) => setZoom({ src, caption });
  const closeZoom = () => setZoom(undefined);

  // 站内锚点统一接管：普通点击经 writeAddress 落地址（分享模式写 ?section= 并保留令牌，
  // 预览模式不改写地址栏）；带修饰键的点击回落到浏览器默认行为，锚点 href 已按模式携带完整地址。
  function navigate(event: MouseEvent<HTMLAnchorElement>, next: string) {
    if (!plainClick(event)) return;
    event.preventDefault();
    writeAddress({ sectionId: next });
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
        <a className="macaron-brand" href={addressHref({ sectionId: "about" })} onClick={event => navigate(event, "about")}>{hero.name}</a>
        {navItems.length > 1 && <>
          <button ref={menuButton} type="button" className="macaron-menu-toggle" aria-controls={navId}
            aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>目录</button>
          <nav className="macaron-chapters" id={navId} aria-label="作品集导航" data-open={menuOpen || undefined}>
            {navItems.map(item => <a key={item.id} href={addressHref({ sectionId: item.id })}
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
      <MacaronHero model={model} defaultPhotoUrl={defaultPhotoUrl}
        onOpenContact={hasContact ? () => setContactOpen(true) : undefined}
        nextId={sections[0]?.id} nextHref={sections[0] ? addressHref({ sectionId: sections[0].id }) : undefined}
        onNavigate={navigate} />

      {/* 内容区块（教育/工作/项目/展示/技能）整体由 WarmMacaronSections 渲染，
          含分幕外壳与「继续下滑」；灯箱、详情与轮播接管点在这里接线。 */}
      <WarmMacaronSections model={model} resolveResumeImage={resolveResumeImage}
        onOpenImage={openZoom}
        onOpenProject={card => openDetail("project", card)}
        onOpenShowcase={card => openDetail("showcase", card)}
        onNavigate={navigate}
        actHref={id => addressHref({ sectionId: id })} />
    </main>

    {detail?.kind === "project" && <MacaronDetailDialog key={detail.card.itemId} card={detail.card}
      resolveResumeImage={resolveResumeImage} onOpenImage={openZoom} onClose={dismissDetail} />}
    {detail?.kind === "showcase" && <MacaronShowcaseDialog key={detail.card.itemId} card={detail.card}
      resolveResumeImage={resolveResumeImage} onClose={dismissDetail} />}
    {zoom && <MacaronLightbox src={zoom.src} caption={zoom.caption} onClose={closeZoom} />}
    {contactOpen && <MacaronContactDialog contact={hero.contact} onClose={() => setContactOpen(false)} />}
  </div>;
}
