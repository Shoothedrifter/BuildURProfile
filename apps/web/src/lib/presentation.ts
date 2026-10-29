import type { MarqueeItem, ProjectCard } from "../../../../packages/contracts/src/config";

export type PreviewPoint = { label: string; text: string; isExcerpt: boolean };
export type ProjectPreview = { overview: string; overviewIsExcerpt: boolean; points: PreviewPoint[] };

function safeProjectUrl(value: string | undefined): string | undefined {
  if (!value || /\s/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) return url.href;
  } catch {
    // User-entered labels are plain text unless they are a complete safe URL.
  }
  return undefined;
}

export function projectPresentation(card: ProjectCard): { category: string; link?: string } {
  const category = card.category.trim();
  const legacyLink = safeProjectUrl(category);
  return {
    category: legacyLink || /^[a-z][a-z\d+.-]*:/i.test(category) ? "" : category,
    link: safeProjectUrl(card.link) ?? legacyLink
  };
}

function excerpt(text: string, limit: number): { text: string; isExcerpt: boolean } {
  const value = text.trim();
  const characters = Array.from(value);
  if (characters.length <= limit) return { text: value, isExcerpt: false };
  const first = characters.slice(0, limit).join("");
  const sentenceEnd = Math.max(first.lastIndexOf("。"), first.lastIndexOf("；"), first.lastIndexOf("."));
  const space = first.lastIndexOf(" ");
  const end = sentenceEnd >= Math.floor(limit * 0.55) ? sentenceEnd + 1 : space >= Math.floor(limit * 0.75) ? space : first.length;
  return { text: first.slice(0, end).trimEnd(), isExcerpt: true };
}

const segmentPattern = /(?:^|\s)(项目描述与职责|项目描述|项目内容|项目工作|项目成果|技术栈|简介|概述|分工|职责|成果)\s*[:：]\s*/gu;
const overviewLabels = new Set(["项目描述与职责", "项目描述", "简介", "概述"]);
const pointLabels = new Set(["分工", "职责", "成果", "项目工作", "项目成果"]);

export function projectPreview(description: string): ProjectPreview {
  const matches = Array.from(description.matchAll(segmentPattern));
  const segments = matches.map((match, index) => ({
    label: match[1],
    text: description.slice(match.index! + match[0].length, matches[index + 1]?.index ?? description.length).trim()
  }));
  const overviewSource = segments.find((segment) => overviewLabels.has(segment.label) && segment.text);
  const overview = overviewSource ? excerpt(overviewSource.text, 175) : { text: "", isExcerpt: false };
  const points = segments.filter((segment) => pointLabels.has(segment.label) && segment.text).slice(0, 2)
    .map((segment) => ({ label: segment.label, ...excerpt(segment.text, 120) }));
  return { overview: overview.text, overviewIsExcerpt: overview.isExcerpt, points };
}

/** An animated tile is for short labels only; the full skill list stays static in ShowcasePage. */
export function shouldAnimateMarquee(items: readonly MarqueeItem[]): boolean {
  return items.length > 0 && items.every((item) => {
    const label = (typeof item === "string" ? item : item.label).trim();
    return label.length > 0 && Array.from(label).length <= 24 && !/[。；！？\n]/u.test(label);
  });
}
