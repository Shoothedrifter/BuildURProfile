import type { MarqueeConfig, MarqueeItem } from "../../../../packages/contracts/src/config";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export type MarqueeProps = MarqueeConfig & { items: readonly MarqueeItem[] };

type MarqueeStyle = CSSProperties & {
  "--marquee-duration": string;
  "--tile-size": string;
};

export function Marquee({
  direction,
  speed,
  bindToScroll,
  rows,
  tileSize,
  pauseOnHover,
  items
}: MarqueeProps) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const safeSpeed = Math.max(1, speed);
  const safeTileSize = Math.max(48, tileSize);
  const rowCount = Math.min(4, Math.max(1, Math.round(rows)));
  const segmentWidth = items.length * (safeTileSize + 16);

  useEffect(() => {
    if (!bindToScroll) return;
    let frame = 0;
    const update = () => {
      if (pauseOnHover && hoveredRow !== null) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrollOffset(window.scrollY * safeSpeed / 40));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
    };
  }, [bindToScroll, safeSpeed, pauseOnHover, hoveredRow]);

  if (items.length === 0) return null;

  return (
    <div className="marquee" role="region" aria-label="Scrolling expertise">
      {Array.from({ length: rowCount }, (_, rowIndex) => {
        const offset = segmentWidth === 0 ? 0 : scrollOffset % segmentWidth;
        const scrollX = direction === "left" ? -offset : -segmentWidth + offset;
        const style: MarqueeStyle = {
          "--marquee-duration": `${(segmentWidth / safeSpeed).toFixed(2)}s`,
          "--tile-size": `${safeTileSize}px`,
          animationName: bindToScroll ? "none" : "marquee-travel",
          animationDirection: direction === "right" ? "reverse" : "normal",
          animationPlayState: pauseOnHover && hoveredRow === rowIndex ? "paused" : "running",
          transform: bindToScroll ? `translate3d(${scrollX}px, 0, 0)` : undefined
        };

        return (
          <div
            className="marquee-row"
            data-testid={`marquee-row-${rowIndex}`}
            key={rowIndex}
            onMouseEnter={() => setHoveredRow(rowIndex)}
            onMouseLeave={() => setHoveredRow(null)}
          >
            <div className="marquee-track" data-testid={`marquee-track-${rowIndex}`} style={style}>
              {[0, 1].map((copy) => (
                <div className="marquee-group" key={copy} aria-hidden={copy === 1}>
                  {items.map((item, index) => (
                    <span className={typeof item === "string" ? "marquee-tile" : "marquee-tile marquee-tile--image"} key={`${copy}-${index}`}>
                      {typeof item === "string" ? <><span className="marquee-tile-mark" aria-hidden="true">✳</span>{item}</> : <>
                        <img className="marquee-tile-image" src={item.image} alt={item.label} />
                        <span className="marquee-tile-label" aria-hidden="true">{item.label}</span>
                      </>}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
