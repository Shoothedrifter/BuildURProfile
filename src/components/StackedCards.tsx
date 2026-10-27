import { useEffect, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, SyntheticEvent } from "react";
import type { ProjectCard, StackedCardsConfig } from "../../types/config";
import { projectPresentation, projectPreview } from "../lib/presentation";

export type StackedCardsProps = StackedCardsConfig & { cards: readonly ProjectCard[] };

type DeckStyle = CSSProperties & {
  "--stack-scale-step": string;
  "--stack-offset-step": string;
  "--stack-x": string;
  "--stack-rotate": string;
};

function touchDevice(): boolean {
  return typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 ||
    (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) || false);
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false);
}

export function StackedCards({
  scaleStep, offsetStep, stickyTop, layout, cardRadius, enableTilt, autoPlay, cards
}: StackedCardsProps) {
  const [active, setActive] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [isTouch, setIsTouch] = useState(touchDevice);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(reducedMotion);
  const [interacted, setInteracted] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const current = Math.min(active, Math.max(0, cards.length - 1));

  useEffect(() => {
    const onTouch = () => setIsTouch(true);
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => setPrefersReducedMotion(Boolean(media?.matches));
    window.addEventListener("touchstart", onTouch, { passive: true });
    media?.addEventListener?.("change", onMotionChange);
    return () => {
      window.removeEventListener("touchstart", onTouch);
      media?.removeEventListener?.("change", onMotionChange);
    };
  }, []);

  useEffect(() => {
    if (!autoPlay || isTouch || prefersReducedMotion || interacted || hovered || detailOpen || cards.length < 2) return;
    const timer = window.setInterval(() => setActive((index) => (index + 1) % cards.length), 6000);
    return () => window.clearInterval(timer);
  }, [autoPlay, isTouch, prefersReducedMotion, interacted, hovered, detailOpen, cards.length]);

  if (cards.length === 0) return <p className="empty-cards">暂无项目内容</p>;

  const card = cards[current];
  const { category, link } = projectPresentation(card);
  const preview = projectPreview(card.description);
  const displayTitle = card.title.trim() || "项目 " + (current + 1);
  const move = (amount: number) => {
    setInteracted(true);
    setDetailOpen(false);
    setActive((index) => Math.max(0, Math.min(cards.length - 1, index + amount)));
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!enableTilt || isTouch || prefersReducedMotion || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
    const y = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
    setTilt({ x: x * 1.2, y: y * -1.2 });
  };
  const handleDetailToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setDetailOpen(Boolean(event.currentTarget.closest(".project-card")?.querySelector("details[open]")));
  };
  const style: DeckStyle = {
    scrollMarginTop: stickyTop + "px",
    "--stack-scale-step": String(scaleStep),
    "--stack-offset-step": offsetStep + "px",
    "--stack-x": layout === "offset" ? "12px" : layout === "fan" ? "20px" : "0px",
    "--stack-rotate": layout === "fan" ? "1.5deg" : "0deg"
  };

  return <div className="stacked-wrap" style={style}>
    <div className="stacked-deck" data-testid="stacked-deck" style={style} tabIndex={0} role="region" aria-label="Selected work cards"
      onKeyDown={handleKeyDown} onPointerMove={handlePointerMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setInteracted(true)}>
      <article className={"project-card" + (card.image ? " project-card--with-image" : " project-card--text")}
        data-testid={"card-layer-" + card.id} key={card.id}
        style={{ borderRadius: cardRadius + "px", transform: enableTilt && !isTouch && !prefersReducedMotion ? "perspective(1300px) rotateX(" + tilt.y + "deg) rotateY(" + tilt.x + "deg)" : undefined }}>
        <div className="project-info">
          {(card.index.trim() || category || card.year.trim()) && <div className="project-topline">
            <span>{[card.index.trim(), category].filter(Boolean).join(" / ")}</span>
            {card.year.trim() && <span>{card.year}</span>}
          </div>}
          <div className="project-copy">
            <p className="project-overline">Selected work</p>
            <h3>{displayTitle}</h3>
            {preview.overview ? <p className="project-description"><strong>{preview.overviewIsExcerpt ? "概述节选" : "概述"}</strong>{preview.overview}{preview.overviewIsExcerpt && <span aria-hidden="true">…</span>}</p>
              : card.description.trim() && <p className="project-description project-description--neutral">完整说明请查看项目详情</p>}
            {preview.points.length > 0 && <ul className="project-points">{preview.points.map((point, index) =>
              <li key={point.label + "-" + index}><strong>{point.label}{point.isExcerpt ? "节选" : ""}</strong>{point.text}{point.isExcerpt && <span aria-hidden="true">…</span>}</li>)}</ul>}
            {card.tags.filter(Boolean).length > 0 && <div className="project-tags">{card.tags.filter(Boolean).map((tag) => <span key={tag}>{tag}</span>)}</div>}
          </div>
          <div className="project-actions">
            {card.description.trim() && <details className="project-detail" onToggle={handleDetailToggle}>
              <summary>查看项目详情</summary>
              <div className="project-detail-body"><p>{card.description}</p></div>
            </details>}
            {link && <a href={link} target="_blank" rel="noopener noreferrer" className="project-link">查看项目链接 ↗</a>}
            {card.image && <details className="project-image-detail" onToggle={handleDetailToggle}>
              <summary>查看完整图片</summary>
              <img src={card.image} alt={displayTitle + "完整图片"} />
            </details>}
          </div>
        </div>
        {card.image && <div className="project-art project-art--image"><img className="project-art-image" src={card.image} alt={displayTitle} /></div>}
      </article>
    </div>
    <div className="stacked-controls">
      <div className="stacked-progress" aria-live="polite"><span>{String(current + 1).padStart(2, "0")}</span><span className="progress-line" /><span>{String(cards.length).padStart(2, "0")}</span></div>
      {cards.length > 1 && <div className="stacked-buttons">
        <button type="button" aria-label="Previous project" onClick={() => move(-1)} disabled={current === 0}>←</button>
        <button type="button" aria-label="Next project" onClick={() => move(1)} disabled={current === cards.length - 1}>→</button>
      </div>}
    </div>
  </div>;
}
