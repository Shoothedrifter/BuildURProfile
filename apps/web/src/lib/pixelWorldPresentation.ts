import type { DesignConfigV4, ResumeDisplayItem, ResumeFact, ResumeModuleKindV2, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import { RESUME_KINDS, RESUME_LABELS, resumeDisplayContent, resumeItemHasContent, validHttpUrl } from "../../../../packages/contracts/src/resume-v2.mjs";

type Item = StructuredResumeV3["sections"][number]["items"][number];
export const dateField = /^(?:dateRange|dates?|period|timeRange|employmentPeriod|year|年份|时间|项目时间|起止时间|在校时间|工作时间|任职时间)$/iu;
const projectMeta = /^(?:role|projectRole|category|tags?|client|角色|项目角色|分类|标签|客户)$/iu;
const aboutHeading = /^(自我评价|个人简介|关于我)$/u;

function visibleSections(resume: StructuredResumeV3) {
  const sections = new Map<ResumeModuleKindV2, Item[]>();
  for (const section of [...resume.sections].sort((a, b) => a.order - b.order)) {
    if (section.kind === "basicInfo") continue;
    const items = sections.get(section.kind) ?? [];
    for (const original of [...section.items].sort((a, b) => a.order - b.order)) {
      const identity = section.kind === "jobIntent";
      const facts = original.facts.filter(fact => fact.value.trim() &&
        !(identity && ["name", "email", "phone", "location", "targetRole"].includes(fact.key)));
      const item = { ...original, facts, sourceText: identity ? undefined : original.sourceText,
        supplement: { ...original.supplement, links: original.supplement.links.filter(link => validHttpUrl(link.url)) } };
      if (resumeItemHasContent(item)) items.push(item);
    }
    if (items.length) sections.set(section.kind, items);
  }
  return [...sections].map(([kind, items]) => ({ kind, items, label: RESUME_LABELS[RESUME_KINDS.indexOf(kind)] }));
}

export function pixelWorldPresentation(config: DesignConfigV4) {
  const resume = config.content.resume;
  const { profile } = resumeDisplayContent(resume);
  const sections = visibleSections(resume);
  const about = sections.find(section => section.kind === "selfEvaluation")?.items
    .map(item => ({ ...item, title: aboutHeading.test(item.title.trim()) ? "" : item.title }))
    .filter(resumeItemHasContent) ?? [];
  const firstLine = about.find(item => item.details.trim())?.details.trim().split(/\r?\n/)[0] ?? "";
  const introCharacters = Array.from(firstLine);
  const introExcerpt = introCharacters.length > 100 ? introCharacters.slice(0, 100).join("").trimEnd() + "…" : firstLine;
  const phone = resume.sections.filter(section => section.kind === "basicInfo").flatMap(section => section.items)
    .flatMap(item => item.facts).find(fact => fact.key === "phone" && fact.value.trim())?.value.trim();
  return {
    name: profile.name || "作品集",
    role: profile.role.trim() || config.content.profile.role.trim(),
    intro: config.content.profile.intro.trim() || introExcerpt,
    email: profile.email,
    phone,
    phoneNumber: phone?.replace(/[^+\d]/g, ""),
    projects: sections.find(section => section.kind === "projects")?.items ?? [],
    about,
    experience: sections.filter(section => section.kind !== "projects" && section.kind !== "selfEvaluation"),
  };
}

export type PixelChapter = "top" | "about" | "works" | "experience" | "contact";
export type PixelAddress = { chapter: PixelChapter; caseId?: string };
export type PixelAddressMode = "preview" | "share" | "export";

function chapterFromValue(value: string | null): PixelChapter {
  switch (value) {
    case "about": case "selfEvaluation": return "about";
    case "works": case "projects": return "works";
    case "experience": case "resume": case "education": case "workExperience": case "skills":
    case "campusExperience": case "awards": case "jobIntent": case "other": return "experience";
    case "contact": return "contact";
    default: return "top";
  }
}

export function pixelAddressFromLocation(mode: PixelAddressMode, location: Location): PixelAddress {
  if (mode === "share") {
    const params = new URLSearchParams(location.search);
    const caseId = params.get("case");
    return caseId ? { chapter: "works", caseId } : { chapter: chapterFromValue(params.get("section") ?? params.get("view")) };
  }
  const hash = location.hash.slice(1);
  if (hash.startsWith("case=")) return { chapter: "works", caseId: new URLSearchParams(hash).get("case") ?? "" };
  return { chapter: chapterFromValue(hash) };
}

export function pixelAddressHref(address: PixelAddress, mode: PixelAddressMode, location?: Location): string {
  if (mode !== "share" || !location) return address.caseId ? `#case=${encodeURIComponent(address.caseId)}` : `#${address.chapter}`;
  const params = new URLSearchParams(location.search);
  params.delete("view");
  if (address.chapter === "top") params.delete("section");
  else params.set("section", address.chapter);
  if (address.caseId) params.set("case", address.caseId);
  else params.delete("case");
  const query = params.toString();
  return location.pathname + (query ? "?" + query : "") + location.hash;
}

export function isPixelProjectMeta(fact: ResumeFact): boolean {
  return [fact.key, fact.label].some(value => dateField.test(value.trim()) || projectMeta.test(value.trim()));
}

const caseHeading = /^(?:#{1,3}\s+)?(项目背景|背景|项目目标|目标|问题|我的职责|个人职责|项目职责|职责|个人贡献|设计选择|设计过程|方案|实现|交付|成果|结果|项目成果)(?:\s*[:：]\s*(.*)|\s*)$/u;

export function pixelCaseBody(item: ResumeDisplayItem) {
  const blocks: { heading: string; text: string }[] = [{ heading: "", text: "" }];
  let current = blocks[0];
  for (const line of item.details.trim().split(/\r?\n/)) {
    const matched = line.trim().match(caseHeading);
    if (matched) {
      current = { heading: matched[1], text: matched[2] ?? "" };
      blocks.push(current);
    } else {
      current.text += current.text ? `\n${line}` : line;
    }
  }
  return blocks.filter(block => block.text.trim()).map(block => ({ ...block, text: block.text.trim() }));
}

export function pixelProjectExcerpt(item: ResumeDisplayItem): string {
  const excerpt = pixelCaseBody(item)[0]?.text.split(/\r?\n/).find(line => line.trim())?.trim()
    || item.supplement.text.trim().split(/\r?\n/)[0]
    || "";
  const characters = Array.from(excerpt);
  return characters.length > 110 ? characters.slice(0, 110).join("").trimEnd() + "…" : excerpt;
}
