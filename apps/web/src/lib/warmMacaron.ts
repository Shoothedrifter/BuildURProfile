import type { DesignConfigV4, HeroPhoto, PresentationHighlight, ResumeFact, ResumeModuleKindV2, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import { resumeItemHasContent, validHttpUrl } from "../../../../packages/contracts/src/resume-v2.mjs";

/** 时间类 fact 的键或标签：命中即提升为卡片的 time 行，不再重复出现在 facts。 */
const timeField = /^(?:dateRange|dates?|period|timeRange|employmentPeriod|year|年份|时间|项目时间|起止时间|在校时间|工作时间|任职时间)$/iu;

type OrderedItem = StructuredResumeV3["sections"][number]["items"][number];
type SectionId = "education" | "workExperience" | "projects" | "showcase" | "skills";

export type WarmMacaronCard = Readonly<{
  itemId: string;
  title: string;
  time: string;
  paragraphs: readonly string[];
  /** 补充说明（supplement.text）：项目详情模态在正文之后收纳的一段确认文字。 */
  supplementText: string;
  facts: readonly ResumeFact[];
  highlights: readonly PresentationHighlight[];
  links: readonly { label: string; url: string }[];
  images: readonly { imageId: string; caption: string }[];
}>;
export type WarmMacaronSection = Readonly<{
  id: SectionId;
  eyebrow: "EDUCATION" | "EXPERIENCE" | "PROJECTS" | "SHOWCASE" | "SKILLS";
  title: string;
  cards: readonly WarmMacaronCard[];
}>;
export type WarmMacaronHero = Readonly<{
  greeting: string;
  name: string;
  role: string;
  intro: string;
  contact: Readonly<{ email?: string; phone?: string }>;
  photo: HeroPhoto | null;
}>;
export type WarmMacaronModel = Readonly<{
  hero: WarmMacaronHero;
  sections: readonly WarmMacaronSection[];
}>;

const SECTION_TITLES: Readonly<Record<SectionId, { eyebrow: WarmMacaronSection["eyebrow"]; title: string }>> = {
  education: { eyebrow: "EDUCATION", title: "教育背景" },
  workExperience: { eyebrow: "EXPERIENCE", title: "工作/实习" },
  projects: { eyebrow: "PROJECTS", title: "项目经历" },
  showcase: { eyebrow: "SHOWCASE", title: "展示区" },
  skills: { eyebrow: "SKILLS", title: "个人技能" }
};

/** 简历模块到展示区块的归属；basicInfo/jobIntent/selfEvaluation 归入首屏，不单独成区。 */
const SECTION_BY_KIND: Readonly<Partial<Record<ResumeModuleKindV2, SectionId>>> = {
  education: "education",
  workExperience: "workExperience",
  projects: "projects",
  campusExperience: "showcase",
  awards: "showcase",
  other: "showcase",
  skills: "skills"
};

const GREETING = "Hi，";

function isTimeFact(fact: ResumeFact): boolean {
  return [fact.key, fact.label].some(value => timeField.test(value.trim()));
}

function cardOf(entry: OrderedItem): WarmMacaronCard {
  return {
    itemId: entry.itemId,
    title: entry.title,
    time: entry.facts.find(fact => fact.value.trim() && isTimeFact(fact))?.value.trim() ?? "",
    paragraphs: entry.details.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
    supplementText: entry.supplement.text.trim(),
    facts: entry.facts.filter(fact => fact.value.trim() && !isTimeFact(fact)),
    highlights: entry.presentationHighlights ?? [],
    links: entry.supplement.links.filter(link => validHttpUrl(link.url)),
    images: entry.supplement.images
  };
}

/** 图片可访问名称的兜底链：图注 → 所属卡标题 → 固定文案；caption 与标题同时为空时仍给出名称。 */
export function macaronImageAlt(caption: string, title: string): string {
  return caption.trim() || title.trim() || "作品图片";
}

/** 首屏文字侧：身份与联系字段沿用 LegacyShowcasePage 的读取方式（profile.email + basicInfo 的 phone fact）。 */
function heroOf(config: DesignConfigV4, resume: StructuredResumeV3): WarmMacaronHero {
  const { profile } = config.content;
  const email = profile.email.trim();
  const phone = resume.sections.filter(section => section.kind === "basicInfo")
    .flatMap(section => section.items).flatMap(entry => entry.facts)
    .find(fact => fact.key === "phone" && fact.value.trim())?.value.trim();
  // 真实链路的 profile.intro 恒为空串，确认过的自述位于 selfEvaluation；预览草稿可显式覆盖 intro。
  const intro = profile.intro.trim() || resume.sections.filter(section => section.kind === "selfEvaluation")
    .flatMap(section => [...section.items].sort((a, b) => a.order - b.order))
    .map(entry => entry.details.trim()).filter(Boolean).join("\n");
  return {
    greeting: GREETING,
    name: profile.name.trim(),
    role: profile.role.trim(),
    intro,
    contact: { ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
    // 经 Agent 序列化的配置可能带 null，与缺失同样归为无照片。
    photo: config.heroPhoto ? { assetUrl: config.heroPhoto.assetUrl, alt: config.heroPhoto.alt } : null
  };
}

/** 把确认后的 resume-v3 投影为暖调马卡龙页面的展示模型；纯映射，无 React 依赖。 */
export function buildWarmMacaronModel(config: DesignConfigV4): WarmMacaronModel {
  const resume = config.content.resume;
  const cardsBySection = new Map<SectionId, WarmMacaronCard[]>();
  for (const section of [...resume.sections].sort((a, b) => a.order - b.order)) {
    const id = SECTION_BY_KIND[section.kind];
    if (!id) continue;
    const cards = cardsBySection.get(id) ?? [];
    for (const entry of [...section.items].sort((a, b) => a.order - b.order)) {
      if (resumeItemHasContent(entry)) cards.push(cardOf(entry));
    }
    if (cards.length) cardsBySection.set(id, cards);
  }
  return {
    hero: heroOf(config, resume),
    sections: [...cardsBySection].map(([id, cards]) => ({ id, ...SECTION_TITLES[id], cards }))
  };
}
