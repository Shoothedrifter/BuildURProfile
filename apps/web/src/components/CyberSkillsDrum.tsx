import { useEffect, useRef, useState } from "react";
import type { ResumeDisplayItem } from "../../../../packages/contracts/src/config";
import { ResumeSupplement, type ResumeImageResolver } from "./ResumeDisplay";

/** A local 3D instrument: page scrolling remains available outside and over the drum. */
export function CyberSkillsDrum({ items, animate, resolveResumeImage }: {
  items: readonly ResumeDisplayItem[]; animate: boolean; resolveResumeImage: ResumeImageResolver;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const target = useRef(0);
  const wakeSpring = useRef<() => void>(() => {});
  const [active, setActive] = useState(0);
  const slots = Math.max(8, Math.ceil(8 / Math.max(1, items.length)) * items.length);
  const step = 360 / slots;
  const radius = Math.max(360, 244 / (2 * Math.sin(Math.PI / slots)));

  useEffect(() => {
    const node = stage.current;
    const drum = ring.current;
    if (!node || !drum || !animate || items.length < 2) return;
    let angle = target.current, velocity = 0, frame = 0, previous = 0;
    let drag: { y: number; angle: number; id: number } | undefined;
    const render = (now: number) => {
      const dt = Math.min((now - (previous || now - 16)) / 1000, .064);
      previous = now;
      const steps = Math.max(1, Math.ceil(dt / .004));
      for (let i = 0; i < steps; i++) {
        velocity += (72.25 * (target.current - angle) - 17 * velocity) * dt / steps;
        angle += velocity * dt / steps;
      }
      drum.style.transform = `translateZ(-${radius}px) rotateX(${angle}deg)`;
      setActive(((Math.round(angle / step) % items.length) + items.length) % items.length);
      if (Math.abs(target.current - angle) > .001 || Math.abs(velocity) > .01) frame = requestAnimationFrame(render);
      else { frame = 0; previous = 0; }
    };
    const wake = () => { if (!frame) frame = requestAnimationFrame(render); };
    wakeSpring.current = wake;
    const pane = node.closest<HTMLElement>("[data-showcase-scroll]");
    const scrollTarget = pane ?? window;
    let lastScroll = pane?.scrollTop ?? window.scrollY;
    const scroll = () => {
      const next = pane?.scrollTop ?? window.scrollY;
      const delta = next - lastScroll;
      lastScroll = next;
      const rect = node.getBoundingClientRect();
      const bounds = pane?.getBoundingClientRect();
      if (rect.bottom > (bounds?.top ?? 0) && rect.top < (bounds?.bottom ?? window.innerHeight)) {
        target.current += delta * step / 280; wake();
      }
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { y: e.clientY, angle: target.current, id: e.pointerId };
      node.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      target.current = drag.angle + (drag.y - e.clientY) * step / 180; wake();
    };
    const up = () => { drag = undefined; };
    scrollTarget.addEventListener("scroll", scroll, { passive: true });
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    wake();
    return () => {
      wakeSpring.current = () => {};
      cancelAnimationFrame(frame);
      scrollTarget.removeEventListener("scroll", scroll);
      node.removeEventListener("pointerdown", down); node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up); node.removeEventListener("pointercancel", up);
    };
  }, [animate, items.length, step, radius]);

  if (!items.length) return null;
  const activeIndex = active % items.length;
  const item = items[activeIndex];
  const select = (index: number) => {
    // Keep selections near the current turn, including after many complete revolutions.
    const current = Math.round(target.current / step);
    const offset = ((index - current) % items.length + items.length) % items.length;
    target.current = (current + (offset > items.length / 2 ? offset - items.length : offset)) * step;
    setActive(index);
    // Scroll is not required for a button selection to start the spring.
    wakeSpring.current();
  };
  return <div className="cyber-skills-layout" data-drum={animate && items.length > 1 ? "true" : undefined}>
    <div className="cyber-skills-copy">
      <h2>能力与专长</h2>
      {animate && items.length > 1 && <p className="cyber-skills-hint">滚动探索 · 拖动卡片切换</p>}
      <div className="cyber-skills-tabs" role="group" aria-label="选择专业技能">
        {items.map((entry, index) => <button type="button" key={entry.itemId}
          aria-pressed={activeIndex === index} onClick={() => select(index)}>{entry.title || `技能 ${index + 1}`}</button>)}
      </div>
      <article className="cyber-entry cyber-skill-detail" aria-live="polite">
        <h3>{item.title}</h3>
        {item.details && <p className="cyber-preserve-lines">{item.details}</p>}
        {item.sourceText?.trim() && item.sourceText.trim() !== item.details.trim() && <details className="cyber-text-detail">
          <summary>查看详情</summary><div className="cyber-detail-body"><p>{item.sourceText}</p></div>
        </details>}
        <ResumeSupplement item={item} resolveImage={resolveResumeImage} />
      </article>
    </div>
    {animate && items.length > 1 && <div className="cyber-skills-stage" ref={stage} aria-hidden="true">
      <div className="cyber-skills-ring" ref={ring} style={{ transform: `translateZ(-${radius}px)` }}>
        {Array.from({ length: slots }, (_, index) => <div className="cyber-skill-face" key={index}
          style={{ transform: `rotateX(${-step * index}deg) translateZ(${radius}px)` }}>
          <span>{String(index % items.length + 1).padStart(2, "0")}</span>
          <strong>{items[index % items.length].title || "专业技能"}</strong><i>✦</i>
        </div>)}
      </div>
    </div>}
  </div>;
}
