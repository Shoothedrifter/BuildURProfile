import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { macaronImageAlt, type WarmMacaronCard, type WarmMacaronHero, type WarmMacaronModel } from "../lib/warmMacaron";
import type { ResumeImageResolver } from "./ResumeDisplay";

/* ============ 地址与深链（对齐像素世界风的地址约定） ============ */

export type MacaronAddressMode = "preview" | "share" | "export";
export type MacaronAddress = { sectionId: string; caseId?: string };
/** 详情模态的种类：项目详情与展示轮播共用一套打开/关闭与地址写入逻辑。 */
export type MacaronDetailKind = "project" | "showcase";
export type MacaronDetail = { kind: MacaronDetailKind; card: WarmMacaronCard };

const MACARON_SECTION_IDS = new Set(["about", "education", "workExperience", "projects", "showcase", "skills"]);

function macaronSectionFromValue(value: string | null): string {
  return value && MACARON_SECTION_IDS.has(value) ? value : "about";
}

/** 条目直达的目标：项目卡可开详情、多图展示卡可开轮播；单图展示卡与其余条目（教育/工作/技能）视为未知。 */
export function findMacaronDetail(model: WarmMacaronModel, caseId: string): MacaronDetail | undefined {
  for (const section of model.sections) {
    if (section.id !== "projects" && section.id !== "showcase") continue;
    const card = section.cards.find(entry => entry.itemId === caseId
      && (section.id === "projects" || entry.images.length > 1));
    if (card) return { kind: section.id === "projects" ? "project" : "showcase", card };
  }
  return undefined;
}

/** 从当前地址读暖调马卡龙的定位请求：分享用查询参数，导出用片段锚点，未知条目回到所在区块。 */
export function macaronAddressFromLocation(model: WarmMacaronModel, mode: MacaronAddressMode, location: Location): MacaronAddress {
  if (mode === "share") {
    const params = new URLSearchParams(location.search);
    const caseId = params.get("case");
    if (caseId) {
      const owner = findMacaronDetail(model, caseId);
      // 已知条目以属主区块为准；未知条目回到 section 参数指定的所在区块。
      return owner ? { sectionId: owner.kind === "project" ? "projects" : "showcase", caseId }
        : { sectionId: macaronSectionFromValue(params.get("section")) };
    }
    return { sectionId: macaronSectionFromValue(params.get("section")) };
  }
  const hash = location.hash.slice(1);
  if (hash.startsWith("case=")) {
    const caseId = new URLSearchParams(hash).get("case") ?? "";
    const owner = findMacaronDetail(model, caseId);
    // 导出片段未携带区块信息：未知条目与像素世界风一致回落项目区。
    return owner ? { sectionId: owner.kind === "project" ? "projects" : "showcase", caseId } : { sectionId: "projects" };
  }
  return { sectionId: macaronSectionFromValue(hash) };
}

/** 生成定位地址：分享模式改写查询参数并保留 hash（含 #share=<token>），导出模式生成片段锚点。 */
export function macaronAddressHref(address: MacaronAddress, mode: MacaronAddressMode, location?: Location): string {
  if (mode !== "share" || !location) {
    return address.caseId ? `#case=${encodeURIComponent(address.caseId)}` : `#${address.sectionId}`;
  }
  const params = new URLSearchParams(location.search);
  if (address.sectionId === "about") params.delete("section");
  else params.set("section", address.sectionId);
  if (address.caseId) params.set("case", address.caseId);
  else params.delete("case");
  const query = params.toString();
  return location.pathname + (query ? "?" + query : "") + location.hash;
}

/* ============ 模态公共生命周期 ============ */

// 正文滚动锁用引用计数：详情叠灯箱时两层各持一把，全部关闭后才真正解锁。
let macaronBodyLockCount = 0;
let macaronBodyOverflowBeforeLock = "";

function lockMacaronBodyScroll() {
  if (macaronBodyLockCount === 0) macaronBodyOverflowBeforeLock = document.body.style.overflow;
  macaronBodyLockCount += 1;
  document.body.style.overflow = "hidden";
}

function unlockMacaronBodyScroll() {
  macaronBodyLockCount = Math.max(0, macaronBodyLockCount - 1);
  if (macaronBodyLockCount === 0) document.body.style.overflow = macaronBodyOverflowBeforeLock;
}

/** 模态公共生命周期：锁正文滚动、以 showModal 打开（无支持环境退回 open 属性）、聚焦关闭按钮、卸载时恢复触发焦点。 */
function useMacaronDialog(dialogRef: RefObject<HTMLDialogElement | null>, closeRef?: RefObject<HTMLButtonElement | null>) {
  useLayoutEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockMacaronBodyScroll();
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
    closeRef?.current?.focus({ preventScroll: true });
    return () => {
      unlockMacaronBodyScroll();
      if (node.open && typeof node.close === "function") node.close();
      else node.removeAttribute("open");
      trigger?.focus?.({ preventScroll: true });
    };
    // 模态的打开与清理只在其挂载周期内执行一次，依赖数组刻意为空。
  }, []);
}

/** 图片灯箱：大图与图注，Escape 或点击遮罩关闭，关闭后恢复触发元素焦点与正文滚动。 */
export function MacaronLightbox({ src, caption, onClose }: Readonly<{
  src: string;
  caption: string;
  onClose: () => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const alt = macaronImageAlt(caption, "");
  useMacaronDialog(dialogRef, closeRef);
  return <dialog ref={dialogRef} className="macaron-lightbox" aria-label={alt}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}>
    <figure className="macaron-lightbox-figure">
      <img src={src} alt={alt} />
      {caption.trim() && <figcaption>{caption}</figcaption>}
    </figure>
    <button ref={closeRef} type="button" className="macaron-lightbox-close">关闭图片预览 <span aria-hidden="true">×</span></button>
  </dialog>;
}

/** 项目详情：标题与元数据 → 图画廊 → 正文（含补充说明）→ 外部链接；画廊图可升级为灯箱（嵌套关闭只关灯箱）。 */
export function MacaronDetailDialog({ card, resolveResumeImage, onOpenImage, onClose }: Readonly<{
  card: WarmMacaronCard;
  resolveResumeImage: ResumeImageResolver;
  onOpenImage: (src: string, caption: string) => void;
  onClose: () => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useMacaronDialog(dialogRef, closeRef);
  return <dialog ref={dialogRef} className="macaron-case macaron-detail-case" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}>
    <div className="macaron-case-bar">
      <span className="macaron-case-label">项目详情</span>
      <button ref={closeRef} type="button" onClick={onClose}>关闭详情 <span aria-hidden="true">×</span></button>
    </div>
    <div className="macaron-case-content">
      <h2 id={titleId}>{card.title}</h2>
      {(card.time || card.facts.length > 0) && <div className="macaron-case-meta">
        {card.time && <p className="macaron-card-time">{card.time}</p>}
        {card.facts.length > 0 && <ul className="macaron-chips">
          {card.facts.map((fact, index) => <li key={`${fact.key}:${index}`} className="macaron-chip"
            data-tone={index % 2 === 0 ? "rose" : "sky"}>{fact.value}</li>)}
        </ul>}
      </div>}
      {card.images.length > 0 && <div className="macaron-case-gallery">
        {card.images.map(image => {
          const alt = macaronImageAlt(image.caption, card.title);
          return <button key={image.imageId} type="button" className="macaron-case-figure"
            aria-label={`放大查看 ${alt}`}
            onClick={() => onOpenImage(resolveResumeImage(image.imageId), image.caption)}>
            <img src={resolveResumeImage(image.imageId)} alt={alt} loading="lazy" />
          </button>;
        })}
      </div>}
      {(card.paragraphs.length > 0 || card.supplementText) && <div className="macaron-case-body">
        {card.paragraphs.map((line, index) => <p key={index}>{line}</p>)}
        {card.supplementText && <p className="macaron-case-supplement">{card.supplementText}</p>}
      </div>}
      {card.links.length > 0 && <ul className="macaron-case-links">
        {card.links.map((link, index) => <li key={`${link.url}:${index}`}>
          <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label || link.url}</a>
        </li>)}
      </ul>}
    </div>
  </dialog>;
}

/** 作品轮播：前后按钮 + 圆点指示器 + 方向键，末尾循环；Escape 或遮罩关闭。 */
export function MacaronShowcaseDialog({ card, resolveResumeImage, onClose }: Readonly<{
  card: WarmMacaronCard;
  resolveResumeImage: ResumeImageResolver;
  onClose: () => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [index, setIndex] = useState(0);
  const total = card.images.length;
  useMacaronDialog(dialogRef, closeRef);
  if (total === 0) return null;
  const step = (delta: number) => setIndex(current => (current + delta + total) % total);
  const image = card.images[index];
  return <dialog ref={dialogRef} className="macaron-case macaron-carousel-case" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
    }}>
    <div className="macaron-case-bar">
      <span className="macaron-case-label">作品展示</span>
      <button ref={closeRef} type="button" onClick={onClose}>关闭作品展示 <span aria-hidden="true">×</span></button>
    </div>
    <h2 id={titleId} className="macaron-carousel-title">{card.title}</h2>
    <div className="macaron-carousel" aria-roledescription="轮播" aria-label={card.title.trim() || "作品轮播"}>
      <button type="button" className="macaron-carousel-arrow" aria-label="上一张" onClick={() => step(-1)}>
        <span aria-hidden="true">‹</span>
      </button>
      <figure className="macaron-carousel-figure">
        <img src={resolveResumeImage(image.imageId)} alt={macaronImageAlt(image.caption, card.title)} />
        {image.caption.trim() && <figcaption>{image.caption}</figcaption>}
      </figure>
      <button type="button" className="macaron-carousel-arrow" aria-label="下一张" onClick={() => step(1)}>
        <span aria-hidden="true">›</span>
      </button>
    </div>
    <div className="macaron-carousel-dots">
      {card.images.map((entry, position) => <button key={entry.imageId} type="button" className="macaron-carousel-dot"
        aria-label={`第 ${position + 1} 张，共 ${total} 张`}
        aria-current={position === index ? "true" : undefined}
        data-active={position === index || undefined}
        onClick={() => setIndex(position)} />)}
    </div>
  </dialog>;
}

/** 联系卡：只读渲染已确认公开的联系字段，空字段不出场。 */
export function MacaronContactDialog({ contact, onClose }: Readonly<{
  contact: WarmMacaronHero["contact"];
  onClose: () => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useMacaronDialog(dialogRef, closeRef);
  return <dialog ref={dialogRef} className="macaron-case macaron-contact-case" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}>
    <div className="macaron-case-bar">
      <span className="macaron-case-label">联系方式</span>
      <button ref={closeRef} type="button" onClick={onClose}>关闭联系方式 <span aria-hidden="true">×</span></button>
    </div>
    <div className="macaron-case-content">
      <h2 id={titleId}>联系方式</h2>
      <dl className="macaron-contact-fields">
        {contact.email && <div>
          <dt>邮箱</dt>
          <dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd>
        </div>}
        {contact.phone && <div>
          <dt>电话</dt>
          <dd><a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>{contact.phone}</a></dd>
        </div>}
      </dl>
    </div>
  </dialog>;
}
