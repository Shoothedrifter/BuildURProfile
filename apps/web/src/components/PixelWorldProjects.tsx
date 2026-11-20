import { useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { ResumeDisplayItem } from "../../../../packages/contracts/src/config";
import { isPixelProjectMeta, pixelCaseBody, pixelProjectExcerpt } from "../lib/pixelWorldPresentation";
import { ResumeSupplement, type ResumeImageResolver } from "./ResumeDisplay";

export const pixelProjectTitle = (item: ResumeDisplayItem) => item.title.trim() || "未命名项目";
export const pixelProjectLinkId = (itemId: string) => `pixel-project-${itemId}`;

type ArchiveProps = {
  projects: readonly ResumeDisplayItem[];
  name: string;
  role: string;
  homeHref: string;
  onHome: (event: MouseEvent<HTMLAnchorElement>) => void;
  caseHref: (itemId: string) => string;
  onProject: (event: MouseEvent<HTMLAnchorElement>, itemId: string) => void;
  resolveImage: ResumeImageResolver;
};

export function PixelProjectArchive({ projects, name, role, homeHref, onHome, caseHref, onProject, resolveImage }: ArchiveProps) {
  return <section id="works" className="pixel-section pixel-width" aria-labelledby="pixel-works-title" data-pixel-chapter="works">
    <h2 id="pixel-works-title" tabIndex={-1}>作品档案</h2>
    <div className="pixel-archive">
      <div className="pixel-archive-sidebar">
        <div><p className="pixel-archive-name">{name}</p>{role && <p className="pixel-archive-role">{role}</p>}</div>
        <p className="pixel-count pixel-label">{projects.length} 个项目</p>
        <a className="pixel-text-link pixel-label" href={homeHref} onClick={onHome}>回到起点 <span aria-hidden="true">↑</span></a>
      </div>
      <div className="pixel-archive-list">
        {projects.map((item, index) => {
          const title = pixelProjectTitle(item);
          const metadata = item.facts.filter(isPixelProjectMeta);
          const excerpt = pixelProjectExcerpt(item);
          const cover = item.supplement.images[0];
          return <article className="pixel-project-row" key={item.itemId}>
            <div className="pixel-project-summary">
              <p className="pixel-slot pixel-label" aria-hidden="true">存档 {String(index + 1).padStart(2, "0")}</p>
              <h3>{title}</h3>
              {excerpt && <p className="pixel-project-excerpt">{excerpt}</p>}
              {metadata.length > 0 && <dl className="pixel-project-meta">{metadata.map(fact =>
                <div key={fact.key}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
              <a className="pixel-text-link pixel-label" id={pixelProjectLinkId(item.itemId)} aria-haspopup="dialog" aria-label={`进入项目 ${title}`}
                href={caseHref(item.itemId)} onClick={event => onProject(event, item.itemId)}>进入项目 <span aria-hidden="true">▶</span></a>
            </div>
            {cover && <figure className="pixel-project-cover">
              <img loading="lazy" src={resolveImage(cover.imageId)} alt={cover.caption || `${title}封面`} />
              {cover.caption && <figcaption>{cover.caption}</figcaption>}
            </figure>}
          </article>;
        })}
      </div>
    </div>
  </section>;
}

export function PixelProjectDialog({ item, resolveImage, onDismiss }: {
  item: ResumeDisplayItem;
  resolveImage: ResumeImageResolver;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [zoomedImage, setZoomedImage] = useState<number | null>(null);
  const title = pixelProjectTitle(item);
  const body = pixelCaseBody(item);
  const sourceText = item.sourceText?.trim();
  const excerpt = sourceText && sourceText !== item.details.trim() ? sourceText : undefined;
  const { images, text, links } = item.supplement;
  const metadata = item.facts.filter(isPixelProjectMeta);
  const facts = item.facts.filter(fact => !isPixelProjectMeta(fact));

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const style = document.body.style;
    const previousOverflow = style.overflow;
    style.overflow = "hidden";
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
    close.current?.focus({ preventScroll: true });
    return () => {
      style.overflow = previousOverflow;
      if (node.open && typeof node.close === "function") node.close();
    };
  }, []);

  return <dialog ref={dialog} className="pixel-case" aria-labelledby={titleId} aria-modal="true"
    onCancel={event => { event.preventDefault(); onDismiss(); }}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }
    }}>
    <div className="pixel-case-bar pixel-label">
      <span className="pixel-case-lights" aria-hidden="true"><i /><i /><i /></span>
      <span>项目详情</span><button ref={close} type="button" onClick={onDismiss}>关闭项目详情 <span aria-hidden="true">×</span></button>
    </div>
    <div className="pixel-case-content">
      <h2 id={titleId}>{title}</h2>
      {metadata.length > 0 && <dl className="pixel-project-meta">{metadata.map(fact =>
        <div key={fact.key}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
      {images.length > 0 && <div className="pixel-case-gallery">{images.map((image, index) => {
        const caption = image.caption || `作品图 ${index + 1}`;
        const zoomed = zoomedImage === index;
        return <figure key={`${image.imageId}-${index}`} data-zoomed={zoomed || undefined}>
          <button type="button" aria-label={`放大${caption}`} aria-pressed={zoomed}
            onClick={() => setZoomedImage(zoomed ? null : index)}>
            <img src={resolveImage(image.imageId)} alt={caption} loading={index === 0 ? "eager" : "lazy"} />
          </button>
          {image.caption && <figcaption>{image.caption}</figcaption>}
        </figure>;
      })}</div>}
      {body.length > 0 && <div className="pixel-case-body">{body.map((block, index) =>
        <div key={index}>{block.heading && <h3>{block.heading}</h3>}<p className="pixel-copy">{block.text}</p></div>)}</div>}
      {(facts.length > 0 || text.trim() || links.length > 0) && <ResumeSupplement item={{ ...item, facts,
        supplement: { text, links, images: [] } }} resolveImage={resolveImage} />}
      {excerpt && <details className="pixel-entry-details"><summary>查看项目原文</summary><p className="pixel-copy">{excerpt}</p></details>}
    </div>
  </dialog>;
}
