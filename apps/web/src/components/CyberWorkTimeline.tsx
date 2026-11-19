import { useEffect, useId, useRef } from "react";
import type { ResumeDisplayItem } from "../../../../packages/contracts/src/config";
import { ResumeSupplement, type ResumeImageResolver } from "./ResumeDisplay";

const companyFields = /^(?:company|employer|organization|公司|机构|工作单位)$/iu;
const roleFields = /^(?:position|role|jobTitle|岗位|职位|职务)$/iu;
const dateFields = /^(?:dateRange|dates?|period|timeRange|employmentPeriod|工作时间|任职时间|起止时间|时间)$/iu;

function confirmedField(item: ResumeDisplayItem, names: RegExp) {
  return item.facts.find(entry =>
    entry.value.trim() && (names.test(entry.key.trim()) || names.test(entry.label.trim())));
}

function workHeading(title: string, employer: string, position: string) {
  const parts = title.split(/\s+[-–—·]\s+|[｜|]/u).map(part => part.trim());
  if (parts.length === 2 && parts.every(Boolean)) {
    return { company: parts[0], role: parts[1] };
  }

  const company = (title === position && employer) || title || employer || position;
  return { company, role: position && !company.includes(position) ? position : "" };
}

function WorkEntry({ item, resolveResumeImage }: { item: ResumeDisplayItem; resolveResumeImage: ResumeImageResolver }) {
  const employer = confirmedField(item, companyFields);
  const position = confirmedField(item, roleFields);
  const date = confirmedField(item, dateFields);
  const { company, role } = workHeading(item.title.trim(), employer?.value.trim() ?? "", position?.value.trim() ?? "");
  const headingText = `${company} ${role}`;
  const facts = item.facts.filter(fact => fact !== date &&
    !((fact === employer || fact === position) && headingText.includes(fact.value.trim())));
  const source = item.sourceText?.trim();
  return (
    <li className="cyber-work-item">
      <article className="cyber-work-entry">
        {(company || date) && <header className="cyber-work-entry-header">
          {company && <div>
            <h3>{company}</h3>
            {role && <p className="cyber-work-role">{role}</p>}
          </div>}
          {date && <p className="cyber-work-date">{date.value.trim()}</p>}
        </header>}
        {item.details && <p className="cyber-work-summary cyber-preserve-lines">{item.details}</p>}
        {source && source !== item.details.trim() && <details className="cyber-text-detail">
          <summary>查看详情</summary>
          <div className="cyber-detail-body"><p>{item.sourceText}</p></div>
        </details>}
        <ResumeSupplement item={{ ...item, facts }} resolveImage={resolveResumeImage} />
      </article>
    </li>
  );
}

export function CyberWorkTimeline({ items, resolveResumeImage, animate }: {
  items: readonly ResumeDisplayItem[];
  resolveResumeImage: ResumeImageResolver;
  animate: boolean;
}) {
  const headingId = useId();
  const sweepRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const sweep = sweepRef.current;
    const list = listRef.current;
    if (!animate || !sweep || !list) return;

    const entries = Array.from(list.children);
    let frame = 0;
    let current: Element | undefined;
    const update = () => {
      frame = 0;
      const height = window.innerHeight;
      const sweepTop = sweep.getBoundingClientRect().top;
      const progress = Math.max(0, Math.min(1, (height * .86 - sweepTop) / (height * .52)));
      const bounds = list.getBoundingClientRect();
      let next: Element | undefined;
      if (bounds.bottom > 0 && bounds.top < height) {
        const readingLine = height * .52;
        for (const entry of entries) {
          const rect = entry.getBoundingClientRect();
          if (rect.bottom <= 0 || rect.top >= height) continue;
          if (!next || rect.top <= readingLine) next = entry;
          if (rect.top > readingLine) break;
        }
      }
      if (current !== next) {
        current?.removeAttribute("data-current");
        next?.setAttribute("data-current", "");
        current = next;
      }
      sweep.style.setProperty("--work-sweep-progress", String(progress));
    };

    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(list);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      current?.removeAttribute("data-current");
      sweep.style.removeProperty("--work-sweep-progress");
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [animate, items]);

  return (
    <section className="cyber-work cyber-page-width" id="workExperience" aria-labelledby={headingId}>
      <h2 id={headingId}>实习与工作经历</h2>
      <div className="cyber-work-sweep" ref={sweepRef} aria-hidden="true" />
      <ol className="cyber-work-timeline" ref={listRef} role="list">
        {items.map(item => <WorkEntry key={item.itemId} item={item} resolveResumeImage={resolveResumeImage} />)}
      </ol>
    </section>
  );
}
