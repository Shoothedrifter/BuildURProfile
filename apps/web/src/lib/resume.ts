import type { ResumeContent } from "../../../../packages/contracts/src/config";

export type DraftField = { value: string; source: string; page: number; included: boolean; experienceKind?: "campus" };
export type ResumeDraft = {
  name: DraftField;
  email: DraftField;
  workExperience: DraftField[];
  projects: DraftField[];
  skills: DraftField[];
  education: DraftField[];
};

const dateAtStart = /^\d{4}[./]\d{2}\s*[-–—~至]\s*\d{4}[./]\d{2}/;
const dateAtEnd = /\d{4}[./]\d{2}\s*[-–—~至]\s*\d{4}[./]\d{2}\s*$/;
const skillHeading = /^(?:[•●·\uF000-\uF8FF]\s*)?(编程与数据|模型训练与\s*NLP|智能体开发|模型推理与部署|工程化开发)\s*[:：]/;
const bulletOnly = /^[•●·\uF000-\uF8FF\s]+$/;
const bulletStart = /^[•●·\uF000-\uF8FF]\s*/;
type Section = "education" | "awards" | "projects" | "skills" | "work" | "campus";
const sectionNames: Record<string, Section> = {
  教育背景: "education", 教育经历: "education",
  获奖经历: "awards", 荣誉奖项: "awards",
  项目实践: "projects", 项目经历: "projects", 项目经验: "projects",
  专业技能: "skills", 相关技能: "skills",
  工作经历: "work", 实习经历: "work", 校园经历: "campus"
};

function canonical(text: string): string {
  return text.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

/** Permit trimming and punctuation fixes while keeping every claim in PDF reading order. */
function followsSourceOrder(value: string, source: string): boolean {
  const original = canonical(source);
  let cursor = 0;
  for (const character of canonical(value)) {
    const at = original.indexOf(character, cursor);
    if (at < 0) return false;
    cursor = at + 1;
  }
  return true;
}

function linesOf(page: string): string[] {
  return page.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !bulletOnly.test(line));
}

function field(lines: string[], page: number): DraftField {
  const text = lines.join("\n").trim();
  // Keep the PDF excerpt intact for provenance; remove decorative bullets only from editable copy.
  const value = lines.map((line) => line.replace(/^[•●·\uF000-\uF8FF]\s*/, "")).join("\n").trim();
  return { value, source: text, page, included: true };
}

function splitBlocks(lines: string[], starts: number[], page: number): DraftField[] {
  return starts.map((start, index) => field(lines.slice(start, starts[index + 1] ?? lines.length), page));
}

function sectionOf(line: string): Section | undefined {
  return sectionNames[line.normalize("NFKC").replace(/\s/g, "").replace(/^[•●·\uF000-\uF8FF]/, "").replace(/[：:]$/, "")];
}

function splitAt(lines: string[], page: number, isStart: (line: string) => boolean): DraftField[] {
  if (!lines.length) return [];
  const starts = lines.map((line, index) => isStart(line) ? index : -1).filter((index) => index >= 0);
  if (!starts.length) return [field(lines, page)];
  if (starts[0] > 0) starts.unshift(0);
  return splitBlocks(lines, starts, page);
}

function parseNamedSections(pages: string[][], firstHeading: number): Pick<ResumeDraft, "education" | "skills" | "workExperience" | "projects"> {
  const sections: { kind: Section; page: number; lines: string[] }[] = [];
  let current: (typeof sections)[number] | undefined;
  pages.forEach((lines, pageIndex) => {
    lines.forEach((line) => {
      const kind = sectionOf(line);
      if (kind) {
        current = { kind, page: pageIndex + 1, lines: [] };
        sections.push(current);
      } else if (current) {
        if (current.page !== pageIndex + 1) {
          current = { kind: current.kind, page: pageIndex + 1, lines: [] };
          sections.push(current);
        }
        current.lines.push(line);
      }
    });
  });

  const education: DraftField[] = [];
  const skills: DraftField[] = [];
  const workExperience: DraftField[] = [];
  const projects: DraftField[] = [];
  const headerSchool = pages[0].slice(0, firstHeading).find((line) => /大学|学院|学校/.test(line));
  sections.forEach((section) => {
    const lines = section.kind === "education" && section.page === 1 && headerSchool
      ? [headerSchool, ...section.lines]
      : section.lines;
    if (section.kind === "education") {
      education.push(...splitAt(lines, section.page, (line) => dateAtStart.test(line)));
    } else if (section.kind === "skills") {
      skills.push(...splitAt(lines, section.page, (line) => bulletStart.test(line) || skillHeading.test(line)));
    } else if (section.kind === "work" || section.kind === "campus") {
      const entries = splitAt(lines, section.page, (line) =>
        dateAtStart.test(line) || dateAtEnd.test(line) || section.kind === "campus" && bulletStart.test(line));
      workExperience.push(...(section.kind === "campus"
        ? entries.map((entry) => ({ ...entry, experienceKind: "campus" as const }))
        : entries));
    } else if (section.kind === "projects") {
      projects.push(...splitAt(lines, section.page, (line) =>
        // Undated title rows in the supplied Word PDF end with a parenthesized project role.
        dateAtEnd.test(line) || (!bulletStart.test(line) && !/[：:。；，,]$/.test(line) && /[（(][^）)]{2,}[）)]$/.test(line))));
    }
  });
  return { education, skills, workExperience, projects };
}

function identifyEmail(lines: string[]): DraftField {
  const full = lines.find((line) => /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(line))
    ?.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0];
  if (full) return field([full], 1);

  const suffixIndex = lines.findIndex((line) => /^@[\w.-]+\.[A-Za-z]{2,}$/.test(line));
  if (suffixIndex < 0) return field([], 1);
  const start = Math.max(0, suffixIndex - 4);
  const local = lines.slice(start, suffixIndex)
    .flatMap((line, offset) => (line.match(/[A-Za-z0-9._+-]+/g) ?? []).map((token) => ({ token, index: start + offset })))
    .filter(({ token }) => token.length >= 5 && !/^1[3-9]\d{9}$/.test(token))
    .at(-1);
  if (!local) return field([], 1);
  return { value: `${local.token}${lines[suffixIndex]}`, source: lines.slice(local.index, suffixIndex + 1).join("\n"), page: 1, included: true };
}

export function parseResumePages(pages: string[]): ResumeDraft {
  const first = linesOf(pages[0] ?? "");
  const email = identifyEmail(first);
  const firstHeading = first.findIndex((line) => sectionOf(line));
  const header = firstHeading >= 0 ? first.slice(0, firstHeading) : first;
  const nameLine = header.find((line) => /^[\p{Script=Han}]{2,3}$/u.test(line)) ??
    header.find((line) => line !== "RESUME" && line !== email.source && !dateAtStart.test(line)) ?? "";
  if (firstHeading >= 0) {
    return { name: field(nameLine ? [nameLine] : [], 1), email, ...parseNamedSections(pages.map(linesOf), firstHeading) };
  }
  const skillStart = first.findIndex((line) => skillHeading.test(line));
  const workStart = first.findIndex((line, index) => index > skillStart && dateAtEnd.test(line) && !dateAtStart.test(line));
  const educationLimit = skillStart >= 0 ? skillStart : workStart >= 0 ? workStart : first.length;
  const educationStarts = first.map((line, index) => dateAtStart.test(line) && index < educationLimit ? index : -1).filter((index) => index >= 0);
  const education = educationStarts.map((start, index) => field(first.slice(start, educationStarts[index + 1] ?? educationLimit), 1));

  const skills: DraftField[] = [];
  if (skillStart >= 0) {
    const limit = workStart >= 0 ? workStart : first.length;
    const skillLines = first.slice(skillStart, limit);
    const starts = skillLines.map((line, index) => skillHeading.test(line) ? index : -1).filter((index) => index >= 0);
    skills.push(...splitBlocks(skillLines, starts, 1));
  }

  const workExperience = workStart >= 0 ? [field(first.slice(workStart), 1)] : [];
  const projects: DraftField[] = [];
  pages.forEach((page, pageIndex) => {
    const lines = linesOf(page);
    const heading = lines.findIndex((line) => line === "项目经历" || line === "项目经验");
    if (pageIndex === 0 && heading < 0) return;
    const candidateLines = heading >= 0 ? lines.slice(heading + 1) : lines;
    const starts = candidateLines.map((line, index) => dateAtEnd.test(line) && !dateAtStart.test(line) ? index : -1).filter((index) => index >= 0);
    projects.push(...splitBlocks(candidateLines, starts, pageIndex + 1));
  });

  return {
    name: field(nameLine ? [nameLine] : [], 1),
    email,
    workExperience,
    projects,
    skills,
    education
  };
}

export function validateResumeDraft(draft: ResumeDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.value.trim()) errors.push("请确认姓名");
  if (draft.name.value.trim() && !followsSourceOrder(draft.name.value, draft.name.source)) {
    errors.push("姓名含 PDF 原文没有的表述");
  }
  if (draft.email.value.trim() && !followsSourceOrder(draft.email.value, draft.email.source)) {
    errors.push("邮箱含 PDF 原文没有的表述");
  }
  const groups: { label: string; entries: DraftField[] }[] = [
    { label: "工作经历", entries: draft.workExperience },
    { label: "项目", entries: draft.projects },
    { label: "技能", entries: draft.skills },
    { label: "教育", entries: draft.education }
  ];
  for (const group of groups) {
    group.entries.forEach((entry, index) => {
      if (!entry.included) return;
      if (group.label === "项目" && canonical(entry.value.split("\n")[0] ?? "") !== canonical(entry.source.split("\n")[0] ?? "")) {
        errors.push(`项目 ${index + 1} 的标题与 PDF 原文不符`);
      }
      if (!followsSourceOrder(entry.value, entry.source)) {
        errors.push(`${group.label} ${index + 1} 含 PDF 原文没有的表述`);
      }
      const sourceNumbers: string[] = entry.source.match(/\d+(?:[.,]\d+)?/g) ?? [];
      const valueNumbers: string[] = entry.value.match(/\d+(?:[.,]\d+)?/g) ?? [];
      for (const number of valueNumbers) {
        if (!sourceNumbers.includes(number)) errors.push(`${group.label} ${index + 1} 含原文没有的数字：${number}`);
      }
      if (valueNumbers.every((number) => sourceNumbers.includes(number)) &&
          (valueNumbers.length !== sourceNumbers.length || valueNumbers.some((number, at) => number !== sourceNumbers[at]))) {
        errors.push(`${group.label} ${index + 1} 的数字顺序或次数与原文不符`);
      }
    });
  }
  return errors;
}

/** Rejoin PDF visual lines without erasing paragraph boundaries or breaking identifiers. */
export function reflowVisualLines(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => line.trim());
  let result = "";
  for (const line of lines) {
    if (!line) {
      if (result && !result.endsWith("\n")) result += "\n";
      continue;
    }
    if (!result || result.endsWith("\n")) { result += line; continue; }
    const previous = result.split("\n").at(-1) ?? "";
    const newParagraph = /^(?:[•●·\uF000-\uF8FF-]\s*|(?:简介|概述|项目描述|项目内容|技术栈|分工|职责|成果|仓库|产品介绍|主修|奖项|成绩|语言|交换经历)\s*[:：])/u.test(line) ||
      /[。！？；;]$/u.test(previous);
    if (newParagraph) { result += "\n" + line; continue; }
    const urlContinues = /https?:\/\/\S+$/i.test(previous) && (
      /[/?#&=._~-]$/u.test(previous) || /^[a-z\d./?&#%+=:@~-]+$/u.test(line)
    );
    const hyphenContinues = /[A-Za-z0-9_-]-$/.test(previous) && /^[A-Za-z0-9_]/.test(line);
    const hanContinues = /[\p{Script=Han}]$/u.test(previous) && /^[\p{Script=Han}]/u.test(line);
    result += (urlContinues || hyphenContinues || hanContinues ? "" : " ") + line;
  }
  return result.trim();
}

/** Only explicit, short headings can become animated labels; never truncate skill prose. */
export function skillShortLabels(skills: readonly string[]): string[] {
  return skills.flatMap((skill) => {
    const heading = skill.match(/^([^\n：:]{1,24})\s*[:：]/u)?.[1]?.trim();
    return heading ? [heading] : [];
  });
}

export function reflowResumeEntry(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 2) return lines.join("\n");
  return [...lines.slice(0, 2), reflowVisualLines(lines.slice(2).join("\n"))].filter(Boolean).join("\n");
}

export function toResumeContent(draft: ResumeDraft): ResumeContent {
  const included = (entries: DraftField[]) => entries.filter((entry) => entry.included && entry.value.trim());
  const skills = included(draft.skills);
  const work = included(draft.workExperience).filter((entry) => entry.experienceKind !== "campus");
  const campus = included(draft.workExperience).filter((entry) => entry.experienceKind === "campus");
  const education = included(draft.education);
  const projects = included(draft.projects);
  const sourceRefs: Record<string, { page: number; excerpt: string }> = {};
  const cite = (key: string, entry: DraftField) => { sourceRefs[key] = { page: entry.page, excerpt: entry.source }; };
  cite("profile.name", draft.name);
  if (draft.email.value) cite("profile.email", draft.email);
  skills.forEach((entry, index) => cite(`skills.${index}`, entry));
  work.forEach((entry, index) => cite(`workExperience.${index}`, entry));
  campus.forEach((entry, index) => cite(`campusExperience.${index}`, entry));
  education.forEach((entry, index) => cite(`education.${index}`, entry));
  projects.forEach((entry, index) => cite(`projects.${index}`, entry));
  const role = work[0]?.value.split("\n").find((line) => /实习生|工程师|设计师|开发/.test(line) && !dateAtEnd.test(line)) ?? "";
  if (role && work[0]) cite("profile.role", work[0]);
  return {
    profile: {
      name: draft.name.value.trim(),
      role,
      location: "",
      availability: "",
      intro: "",
      summary: "",
      email: draft.email.value.trim()
    },
    expertise: {
      eyebrow: "相关技能",
      headline: "技能与专长",
      summary: "",
      skills: skills.map((entry) => reflowVisualLines(entry.value)).filter(Boolean),
      disciplines: []
    },
    projects: projects.map((entry, index) => {
      const [firstLine = "", ...rest] = entry.value.split("\n");
      const firstIsDetail = /^(?:简介|项目描述|项目内容|项目介绍|概述|背景|职责|分工|成果|技术栈)\s*[:：]/.test(rest[0] ?? "");
      const categoryCandidate = firstIsDetail ? "" : rest[0]?.trim() ?? "";
      const safeLink = /^https?:\/\/[^\s]+$/i.test(categoryCandidate) ? categoryCandidate : undefined;
      return {
        id: `pdf-project-${index + 1}`,
        index: String(index + 1).padStart(2, "0"),
        title: firstLine.replace(dateAtEnd, "").trim(),
        category: safeLink ? "" : categoryCandidate,
        year: firstLine.match(dateAtEnd)?.[0]?.match(/\d{4}/)?.[0] ?? "",
        description: reflowVisualLines((firstIsDetail ? rest : rest.slice(1)).join("\n")),
        tags: [],
        visual: (["mint", "lilac", "peach"] as const)[index % 3],
        ...(safeLink ? { link: safeLink } : {})
      };
    }),
    workExperience: work.map((entry) => reflowResumeEntry(entry.value)),
    campusExperience: campus.map((entry) => reflowResumeEntry(entry.value)),
    education: education.map((entry) => reflowResumeEntry(entry.value)),
    sourceRefs
  };
}
