import type { MouseEvent } from "react";
import type { ResumeFact } from "../../../../packages/contracts/src/config";
import { macaronImageAlt, type WarmMacaronCard, type WarmMacaronModel, type WarmMacaronSection } from "../lib/warmMacaron";
import type { ResumeImageResolver } from "./ResumeDisplay";

/** 分幕底部的「继续下滑」文案：页面骨架（首屏按钮）与区块渲染共用一份。 */
export const MACARON_NEXT_LABEL = "继续下滑，探索更多";

type Props = Readonly<{
  model: WarmMacaronModel;
  resolveResumeImage: ResumeImageResolver;
  /** Task 5 灯箱接管点：点击任一内容图时上报解析后的 src 与图注。 */
  onOpenImage?: (src: string, caption: string) => void;
  /** Task 5 项目详情模态接管点：项目卡「了解详情 →」把整张卡交给详情。 */
  onOpenProject?: (card: WarmMacaronCard) => void;
  /** Task 5 作品轮播接管点：多图展示卡「查看作品 →」。 */
  onOpenShowcase?: (card: WarmMacaronCard) => void;
  /** 页面级锚点接管（Task 3 骨架的 navigate 同源）；缺省回落浏览器默认锚点跳转。 */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
  /** 区块锚点地址生成器（分享模式携带 ?section= 与 #share= 令牌）；缺省回落纯 #<id> 片段。 */
  actHref?: (id: string) => string;
}>;

type CardProps = Readonly<{
  card: WarmMacaronCard;
  resolveResumeImage: ResumeImageResolver;
  onOpenImage?: (src: string, caption: string) => void;
}>;

/** 内容图统一外壳：有灯箱接管点时是按钮，否则退化为静态 figure；src 一律经 resolveResumeImage。 */
function MacaronFigure({ image, title, resolveResumeImage, onOpenImage, className }: Readonly<{
  image: WarmMacaronCard["images"][number];
  title: string;
  resolveResumeImage: ResumeImageResolver;
  onOpenImage?: (src: string, caption: string) => void;
  className: string;
}>) {
  const src = resolveResumeImage(image.imageId);
  // 按钮的可访问名称由图的可访问名称提供：图注 → 卡标题 → 固定兜底，三层都不会为空串。
  const img = <img src={src} alt={macaronImageAlt(image.caption, title)} loading="lazy" />;
  if (!onOpenImage) return <figure className={className}>{img}</figure>;
  return <button type="button" className={className} onClick={() => onOpenImage(src, image.caption)}>{img}</button>;
}

/** 蓝粉双色交替 chip 行：工作 meta、展示 facts 与技能条目共用。 */
function MacaronChips({ facts }: Readonly<{ facts: readonly ResumeFact[] }>) {
  if (facts.length === 0) return null;
  return <ul className="macaron-chips">
    {facts.map((fact, index) => <li key={`${fact.key}:${index}`} className="macaron-chip"
      data-tone={index % 2 === 0 ? "rose" : "sky"}>{fact.value}</li>)}
  </ul>;
}

/** 学历/学位类 fact（按 label 关键词识别）并入信息行的副标题，其余 facts 才是高亮数字行。 */
const degreeLabel = /学历|学位/u;

function MacaronEducationCard({ card, resolveResumeImage, onOpenImage }: CardProps) {
  // 共享引用只读：解构取卡面，其余图走缩略图行，原数组不动。
  const [cover, ...rest] = card.images;
  const degrees = card.facts.filter(fact => degreeLabel.test(fact.label));
  const metrics = card.facts.filter(fact => !degreeLabel.test(fact.label));
  return <article className="macaron-card macaron-edu-card">
    {cover && <MacaronFigure className="macaron-card-cover" image={cover} title={card.title}
      resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} />}
    <div className="macaron-card-copy">
      <h3 className="macaron-card-title">{card.title}</h3>
      {degrees.length > 0 && <p className="macaron-card-sub">{degrees.map(fact => fact.value).join(" · ")}</p>}
      {card.time && <p className="macaron-card-time">{card.time}</p>}
      {card.paragraphs.map((line, index) => <p key={index} className="macaron-card-text">{line}</p>)}
      {rest.length > 0 && <div className="macaron-card-thumbs">
        {rest.map(image => <MacaronFigure key={image.imageId} className="macaron-thumb" image={image}
          title={card.title} resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} />)}
      </div>}
      {(metrics.length > 0 || card.highlights.length > 0) && <dl className="macaron-facts">
        {metrics.map((fact, index) => <div key={`${fact.key}:${index}`}>
          <dt>{fact.label}</dt><dd>{fact.value}</dd>
        </div>)}
        {card.highlights.map(highlight => <div key={highlight.id}>
          <dt>{highlight.label}</dt><dd>{highlight.value}{highlight.unit}</dd>
        </div>)}
      </dl>}
    </div>
  </article>;
}

function MacaronWorkCard({ card, resolveResumeImage, onOpenImage }: CardProps) {
  // 图片列最多前两张补充图；slice 返回新数组，不变异模型里的共享引用。
  const gallery = card.images.slice(0, 2);
  return <article className="macaron-card macaron-work-card">
    {gallery.length > 0 && <div className="macaron-work-media">
      {gallery.map(image => <MacaronFigure key={image.imageId} className="macaron-work-figure" image={image}
        title={card.title} resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} />)}
    </div>}
    <div className="macaron-card-copy">
      <h3 className="macaron-card-title">{card.title}</h3>
      {card.time && <p className="macaron-card-time">{card.time}</p>}
      {card.paragraphs.length > 0 && <ul className="macaron-dot-list">
        {card.paragraphs.map((line, index) => <li key={index}>{line}</li>)}
      </ul>}
      <MacaronChips facts={card.facts} />
    </div>
  </article>;
}

function MacaronProjectCard({ card, resolveResumeImage, onOpenImage, onOpenProject }: Readonly<CardProps & {
  onOpenProject?: (card: WarmMacaronCard) => void;
}>) {
  const cover = card.images[0];
  // 卡面只读一句话说明；其余段落、图与链接由详情模态收纳（Task 5）。
  const summary = card.paragraphs[0];
  return <article className="macaron-card macaron-project-card">
    {cover && <MacaronFigure className="macaron-card-cover" image={cover} title={card.title}
      resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} />}
    <div className="macaron-card-copy">
      <h3 className="macaron-card-title">{card.title}</h3>
      {card.time && <p className="macaron-card-time">{card.time}</p>}
      {summary && <p className="macaron-card-text">{summary}</p>}
      <button type="button" className="macaron-more" onClick={() => onOpenProject?.(card)}>了解详情 →</button>
    </div>
  </article>;
}

function MacaronShowcaseCard({ card, resolveResumeImage, onOpenImage, onOpenShowcase }: Readonly<CardProps & {
  onOpenShowcase?: (card: WarmMacaronCard) => void;
}>) {
  const cover = card.images[0];
  return <article className="macaron-card macaron-showcase-card">
    {cover && <MacaronFigure className="macaron-card-cover" image={cover} title={card.title}
      resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} />}
    <div className="macaron-card-copy">
      <h3 className="macaron-card-title">{card.title}</h3>
      {card.time && <p className="macaron-card-time">{card.time}</p>}
      {card.paragraphs.map((line, index) => <p key={index} className="macaron-card-text">{line}</p>)}
      {card.highlights.length > 0 && <dl className="macaron-highlights">
        {card.highlights.map(highlight => <div key={highlight.id}>
          <dt>{highlight.label}</dt><dd>{highlight.value}{highlight.unit}</dd>
        </div>)}
      </dl>}
      <MacaronChips facts={card.facts} />
      {card.images.length > 1 && <button type="button" className="macaron-more"
        onClick={() => onOpenShowcase?.(card)}>查看作品 →</button>}
    </div>
  </article>;
}

function MacaronSkillCard({ card, resolveResumeImage, onOpenImage }: CardProps) {
  const cover = card.images[0];
  return <article className="macaron-card macaron-skill-card">
    {cover && <MacaronFigure className="macaron-card-cover" image={cover} title={card.title}
      resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} />}
    <div className="macaron-card-copy">
      <h3 className="macaron-card-title">{card.title}</h3>
      {card.paragraphs.map((line, index) => <p key={index} className="macaron-card-text">{line}</p>)}
      <MacaronChips facts={card.facts} />
    </div>
  </article>;
}

function SectionCards({ section, resolveResumeImage, onOpenImage, onOpenProject, onOpenShowcase }: Readonly<
  Omit<Props, "model" | "onNavigate"> & { section: WarmMacaronSection }
>) {
  switch (section.id) {
    case "education":
      return <div className="macaron-edu-stack">
        {section.cards.map(card => <MacaronEducationCard key={card.itemId} card={card}
          resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} />)}
      </div>;
    case "workExperience":
      return <div className="macaron-work-stack">
        {section.cards.map(card => <MacaronWorkCard key={card.itemId} card={card}
          resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} />)}
      </div>;
    case "projects":
      return <div className="macaron-project-grid">
        {section.cards.map(card => <MacaronProjectCard key={card.itemId} card={card}
          resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} onOpenProject={onOpenProject} />)}
      </div>;
    case "showcase":
      return <div className="macaron-showcase-grid">
        {section.cards.map(card => <MacaronShowcaseCard key={card.itemId} card={card}
          resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} onOpenShowcase={onOpenShowcase} />)}
      </div>;
    case "skills":
      return <div className="macaron-skill-grid">
        {section.cards.map(card => <MacaronSkillCard key={card.itemId} card={card}
          resolveResumeImage={resolveResumeImage} onOpenImage={onOpenImage} />)}
      </div>;
  }
}

/** 六大内容区块：按展示模型逐幕渲染教育、工作、项目、展示与技能卡，技能区尾带版权行。 */
export function WarmMacaronSections({ model, resolveResumeImage, onOpenImage, onOpenProject, onOpenShowcase, onNavigate, actHref }: Props) {
  const { sections } = model;
  return <>
    {sections.map((section, index) => {
      const next = sections[index + 1];
      return <section key={section.id} id={section.id} data-macaron-section={section.id}
        className="macaron-act" aria-labelledby={`macaron-${section.id}-title`}>
        <div className="macaron-act-inner">
          <p className="macaron-eyebrow">{section.eyebrow}</p>
          <h2 id={`macaron-${section.id}-title`} tabIndex={-1}>{section.title}</h2>
          <div className="macaron-act-body">
            <SectionCards section={section} resolveResumeImage={resolveResumeImage}
              onOpenImage={onOpenImage} onOpenProject={onOpenProject} onOpenShowcase={onOpenShowcase} />
          </div>
          {section.id === "skills" && <p className="macaron-footer-line">
            © {new Date().getFullYear()}{model.hero.name ? ` ${model.hero.name}` : ""}
          </p>}
        </div>
        {next && <a className="macaron-next" href={actHref ? actHref(next.id) : `#${next.id}`}
          onClick={event => onNavigate?.(event, next.id)}>{MACARON_NEXT_LABEL}</a>}
      </section>;
    })}
  </>;
}
