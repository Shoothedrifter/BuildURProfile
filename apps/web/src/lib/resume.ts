import type { ResumeContent, ResumeEntry, ResumeFact, StructuredResumeV1 } from "../../../../packages/contracts/src/config";
import type { ResumeCandidateField, ResumeCandidateV2 } from "../../../../packages/contracts/src/resume-candidate";

export type DraftField = ResumeCandidateField;
export type ResumeDraft = ResumeCandidateV2;

const monthDate = String.raw`\d{4}(?:[./]\d{1,2}|\s*年\s*\d{1,2}\s*月)`;
const dateRange = String.raw`${monthDate}\s*(?:[-–—~]|至)\s*(?:${monthDate}|至今|现在|Present)`;
const dateAtStart = new RegExp(`^${dateRange}`, "iu");
const dateAtEnd = new RegExp(`${dateRange}$`, "iu");
const dateAnywhere = new RegExp(dateRange, "iu");
const dateOnly = new RegExp(`^${dateRange}$`, "iu");
const skillHeading = /^(?:[•●·\uF000-\uF8FF]\s*)?(编程与数据|模型训练与\s*NLP|智能体开发|模型推理与部署|工程化开发)\s*[:：]/;
const bulletOnly = /^[•●·\uF000-\uF8FF\s]+$/;
const bulletStart = /^[•●·\uF000-\uF8FF]\s*/;
type Section = "basic" | "education" | "awards" | "projects" | "skills" | "work" | "campus" | "jobIntent" | "selfEvaluation" | "other";
const sectionNames: Record<string, Section> = {
  基本信息: "basic", 个人信息: "basic",
  求职意向: "jobIntent", 求职目标: "jobIntent", 自我评价: "selfEvaluation", 个人评价: "selfEvaluation",
  教育背景: "education", 教育经历: "education",
  获奖经历: "awards", 荣誉奖项: "awards",
  项目实践: "projects", 项目经历: "projects", 项目经验: "projects",
  专业技能: "skills", 相关技能: "skills", 个人技能: "skills",
  工作经历: "work", 实习经历: "work", 实习工作经历: "work", 职业经历: "work",
  校园经历: "campus", 校园工作: "campus", 校园活动: "campus", 校园实践: "campus", 校内经历: "campus",
  校内实践: "campus", 学生工作: "campus", 学生工作经历: "campus", 学生干部经历: "campus", 社团经历: "campus",
  其他内容: "other", 其他经历: "other", 自媒体经历: "other", 创业经历: "other"
};

const basicLabels: Record<string, string> = {
  英文名: "englishName", 性别: "gender", 年龄: "age", 出生日期: "birthDate", 政治面貌: "politicalStatus",
  国籍: "nationality", 所在地: "location", 电话: "phone", 手机: "phone", 微信: "wechat"
};
const intentLabels: Record<string, string> = { 目标岗位: "targetRole", 求职岗位: "targetRole", 到岗时间: "availability", 期待薪资: "expectedSalary", 期望薪资: "expectedSalary" };

function labeledFields(lines: string[], page: number, labels: Record<string, string>, included: boolean): DraftField[] {
  return lines.flatMap((line) => {
    const match = /^([^:：]{2,8})\s*[:：]\s*(.+)$/.exec(line);
    if (!match || !labels[match[1].trim()]) return [];
    return [{ ...field([line], page), label: match[1].trim(), fieldKey: labels[match[1].trim()], included }];
  });
}

function basicCandidates(lines: string[], page = 1): DraftField[] {
  const explicit = labeledFields(lines, page, basicLabels, false);
  const inferred = ([
    { key: "phone", label: "电话", pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/u },
    { key: "age", label: "年龄", pattern: /(?<!\d)\d{1,3}岁/u }
  ] as const).flatMap(({ key, label, pattern }) => {
    if (explicit.some((entry) => entry.fieldKey === key)) return [];
    const line = lines.find((candidate) => pattern.test(candidate));
    const value = line?.match(pattern)?.[0];
    return line && value ? [{ value, source: line, page, included: false, label, fieldKey: key }] : [];
  });
  return [...explicit, ...inferred];
}

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
  const title = line.normalize("NFKC").replace(/\s/g, "").replace(/^[•●·\uF000-\uF8FF]/, "").replace(/[：:]$/, "");
  return sectionNames[title] ?? (/^[\p{Script=Han}]{2,12}(?:经历|奖项|技能|评价)$/u.test(title) ? "other" : undefined);
}

function splitAt(lines: string[], page: number, isStart: (line: string) => boolean): DraftField[] {
  if (!lines.length) return [];
  const starts = lines.map((line, index) => isStart(line) ? index : -1).filter((index) => index >= 0);
  if (!starts.length) return [field(lines, page)];
  if (starts[0] > 0) starts.unshift(0);
  return splitBlocks(lines, starts, page);
}

const campusRoleLine = /(?:学生班主任助理|班主任助理|学生会|班长|团支书|学习委员|社团长|社长|干事|志愿者|工作人员)/u;
const campusOrganization = /(?:大学|学院|学生会|社团|班级|\d{2,4}班|团委|校园|校内)/u;

function looksLikeCampusEntry(entry: DraftField): boolean {
  const title = entry.value.split("\n")[0] ?? "";
  if (/(?:系统|平台|网站|应用|算法|模型|课程设计|竞赛|比赛|论文|科研)/u.test(title)) return false;
  return campusRoleLine.test(entry.value) && (campusOrganization.test(entry.value) || /^学生班主任助理/u.test(entry.value)) &&
    !/(?:项目描述|项目内容|技术栈|课题|科研项目)/u.test(entry.value);
}

function splitExperience(lines: string[], page: number, campus = false): DraftField[] {
  if (!lines.length) return [];
  const starts = [0];
  let seenDate = dateAnywhere.test(lines[0]);
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    const titleBeforeDate = seenDate && index + 1 < lines.length && dateAtStart.test(lines[index + 1]) &&
      !/[：:。；]$/u.test(line) && line.length <= 100;
    const newDate = seenDate && (dateAtStart.test(line) || dateAtEnd.test(line));
    const separateCampusRole = campus && bulletStart.test(line) && looksLikeCampusEntry(field([line], page));
    if (separateCampusRole || titleBeforeDate || newDate) {
      starts.push(index);
      seenDate = false;
    }
    if (dateAnywhere.test(line)) seenDate = true;
  }
  return splitBlocks(lines, starts, page);
}

function parseNamedSections(pages: string[][], firstHeading: number): Pick<ResumeDraft, "basicInfo" | "education" | "skills" | "workExperience" | "campusExperience" | "projects" | "awards" | "other" | "jobIntent" | "selfEvaluation"> {
  const sections: { kind: Section; heading: string; page: number; lines: string[] }[] = [];
  let current: (typeof sections)[number] | undefined;
  pages.forEach((lines, pageIndex) => {
    lines.forEach((line) => {
      const kind = sectionOf(line);
      if (kind) {
        current = { kind, heading: line, page: pageIndex + 1, lines: [] };
        sections.push(current);
      } else if (current) {
        if (current.page !== pageIndex + 1) {
          current = { kind: current.kind, heading: current.heading, page: pageIndex + 1, lines: [] };
          sections.push(current);
        }
        current.lines.push(line);
      }
    });
  });

  const education: DraftField[] = [];
  const skills: DraftField[] = [];
  const workExperience: DraftField[] = [];
  const campusExperience: DraftField[] = [];
  const projects: DraftField[] = [];
  const awards: DraftField[] = [];
  const other: DraftField[] = [];
  const jobIntent: DraftField[] = [];
  const selfEvaluation: DraftField[] = [];
  const basicInfo: DraftField[] = [];
  const headerSchool = pages[0].slice(0, firstHeading).find((line) => /大学|学院|学校/.test(line));
  sections.forEach((section) => {
    const lines = section.kind === "education" && section.page === 1 && headerSchool
      ? [headerSchool, ...section.lines]
      : section.lines;
    if (section.kind === "basic") {
      basicInfo.push(...basicCandidates(lines, section.page));
    } else if (section.kind === "education") {
      const awardLines = lines.filter((line) => /^(?:[•●·\uF000-\uF8FF]\s*)?荣誉奖项\s*[:：]/u.test(line));
      awards.push(...awardLines.map((line) => field([line], section.page)));
      const schoolLines = lines.filter((line) => !awardLines.includes(line));
      const schoolStart = (line: string) => /(?:大学|学院|学校)/u.test(line) && /(?:本科|硕士|博士)/u.test(line);
      education.push(...splitAt(schoolLines, section.page, schoolLines.some(schoolStart)
        ? schoolStart : (line) => dateAtStart.test(line)));
    } else if (section.kind === "skills") {
      skills.push(...splitAt(lines, section.page, (line) => bulletStart.test(line) || skillHeading.test(line)));
    } else if (section.kind === "work" || section.kind === "campus") {
      (section.kind === "campus" ? campusExperience : workExperience).push(...splitExperience(lines, section.page, section.kind === "campus"));
    } else if (section.kind === "projects") {
      const entries = splitAt(lines, section.page, (line) =>
        // Undated title rows in the supplied Word PDF end with a parenthesized project role.
        dateAtEnd.test(line) && !dateOnly.test(line) || campusRoleLine.test(line) && !/[：:。；，,]$/.test(line) ||
        (!bulletStart.test(line) && !/[：:。；，,]$/.test(line) && /[（(][^）)]{2,}[）)]$/.test(line)));
      for (const entry of entries) {
        if (looksLikeCampusEntry(entry)) campusExperience.push(...splitExperience(entry.source.split("\n"), section.page, true));
        else projects.push(entry);
      }
    } else if (section.kind === "awards") {
      awards.push(...splitAt(lines, section.page, (line) => dateAtStart.test(line) || /^\d{4}[./]\d{1,2}/.test(line) || bulletStart.test(line)));
    } else if (section.kind === "jobIntent") {
      jobIntent.push(...labeledFields(lines, section.page, intentLabels, true).map((entry) =>
        entry.fieldKey === "expectedSalary" ? { ...entry, included: false } : entry));
      const recognized = new Set(jobIntent.filter((entry) => entry.page === section.page).map((entry) => entry.source));
      other.push(...lines.filter((line) => !recognized.has(line)).map((line) => ({ ...field([line], section.page), label: section.heading })));
    } else if (section.kind === "selfEvaluation") {
      if (lines.length) selfEvaluation.push(field(lines, section.page));
    } else if (section.kind === "other") {
      if (lines.length) other.push({ ...field(lines, section.page), label: section.heading });
    }
  });
  return { basicInfo, education, skills, workExperience, campusExperience, projects, awards, other, jobIntent, selfEvaluation };
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
  const basicInfo = basicCandidates(header);
  const explicitName = first.find((line) => /^姓名\s*[:：]\s*\S+/.test(line));
  const linkedNameLine = header.find((line) => /^[\p{Script=Han}]{2,4}(?=\s*https?:\/\/)/iu.test(line));
  const linkedName = linkedNameLine?.match(/^[\p{Script=Han}]{2,4}/u)?.[0];
  const nameLine = explicitName?.replace(/^姓名\s*[:：]\s*/, "") ?? header.find((line) => /^[\p{Script=Han}]{2,3}$/u.test(line)) ??
    linkedName ?? header.find((line) => /^[A-Za-z]+(?:[ -][A-Za-z]+){1,3}$/.test(line) && line.toUpperCase() !== "RESUME") ?? "";
  const name = explicitName ? { value: nameLine, source: explicitName, page: 1, included: true }
    : linkedName && nameLine === linkedName ? { value: linkedName, source: linkedNameLine!, page: 1, included: true }
      : field(nameLine ? [nameLine] : [], 1);
  if (firstHeading >= 0) {
    const parsed = parseNamedSections(pages.map(linesOf), firstHeading);
    return { version: "resume-candidate-v2", name, email, ...parsed, basicInfo: [...basicInfo, ...parsed.basicInfo] };
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
    version: "resume-candidate-v2",
    name,
    email,
    basicInfo,
    jobIntent: [],
    selfEvaluation: [],
    workExperience,
    campusExperience: [],
    projects,
    awards: [],
    skills,
    education,
    other: []
  };
}

export function validateResumeDraft(draft: ResumeDraft): string[] {
  if (draft.version !== "resume-candidate-v2") return ["简历解析合同版本无效"];
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
    { label: "校园经历", entries: draft.campusExperience },
    { label: "项目", entries: draft.projects },
    { label: "技能", entries: draft.skills },
    { label: "教育", entries: draft.education },
    { label: "基本信息", entries: draft.basicInfo },
    { label: "求职意向", entries: draft.jobIntent },
    { label: "自我评价", entries: draft.selfEvaluation },
    { label: "荣誉奖项", entries: draft.awards },
    { label: "其他内容", entries: draft.other }
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
      const extractedBasicDetail = group.label === "基本信息" && ["phone", "age"].includes(entry.fieldKey ?? "");
      if (!extractedBasicDetail && valueNumbers.every((number) => sourceNumbers.includes(number)) &&
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

const detailKeys: Record<string, string> = {
  学校: "school", 院系: "department", 专业: "major", 成绩: "grade", 专业课程: "courses", 主修: "courses",
  公司: "company", 职位: "role", 工作内容: "responsibilities", 职责: "responsibilities", 成果: "outcomes",
  项目类型: "projectType", 奖项级别: "level", 获奖时间: "date", 组织: "organization", 岗位: "role",
  语言成绩: "language", 编程技能: "programming", 办公技能: "office"
};

function resumeFact(entry: DraftField): ResumeFact {
  const match = /^([^:：]+)\s*[:：]\s*(.*)$/.exec(entry.value.trim());
  const label = entry.label ?? match?.[1]?.trim() ?? "其他";
  return { key: entry.fieldKey ?? basicLabels[label] ?? intentLabels[label] ?? "other", label, value: match?.[2]?.trim() ?? entry.value.trim() };
}

function resumeEntry(entry: DraftField): ResumeEntry {
  const value = reflowVisualLines(entry.value);
  const lines = value.split("\n");
  const facts = lines.flatMap((line) => {
    const match = /^([^:：]{2,12})\s*[:：]\s*(.+)$/.exec(line);
    const label = match?.[1]?.trim() ?? "";
    return detailKeys[label] ? [{ key: detailKeys[label], label, value: match![2].trim() }] : [];
  });
  return { title: entry.label ?? lines[0] ?? "", details: value, facts };
}

function structuredResume(draft: ResumeDraft): StructuredResumeV1 {
  const selected = (entries: DraftField[]) => entries.filter((entry) => entry.included && entry.value.trim());
  return {
    version: "resume-v1",
    basicInfo: [
      { key: "name", label: "姓名", value: draft.name.value.trim() },
      ...(draft.email.value.trim() ? [{ key: "email", label: "邮箱", value: draft.email.value.trim() }] : []),
      ...selected(draft.basicInfo).map(resumeFact)
    ],
    jobIntent: selected(draft.jobIntent).map(resumeFact),
    selfEvaluation: selected(draft.selfEvaluation).map(resumeEntry),
    education: selected(draft.education).map(resumeEntry),
    workExperience: selected(draft.workExperience).map(resumeEntry),
    projects: selected(draft.projects).map(resumeEntry),
    awards: selected(draft.awards).map(resumeEntry),
    campusExperience: selected(draft.campusExperience).map(resumeEntry),
    skills: selected(draft.skills).map(resumeEntry),
    other: selected(draft.other).map(resumeEntry)
  };
}

export function toResumeContent(draft: ResumeDraft): ResumeContent & { resume: StructuredResumeV1 } {
  const included = (entries: DraftField[]) => entries.filter((entry) => entry.included && entry.value.trim());
  const skills = included(draft.skills);
  const work = included(draft.workExperience);
  const campus = included(draft.campusExperience);
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
  const resume = structuredResume(draft);
  const targetRole = resume.jobIntent.find((entry) => entry.key === "targetRole")?.value ?? "";
  const role = targetRole || work[0]?.value.split("\n").find((line) => /实习生|工程师|设计师|开发/.test(line) && !dateAtEnd.test(line)) || "";
  const roleSource = targetRole ? included(draft.jobIntent).find((entry) => resumeFact(entry).key === "targetRole") : work[0];
  if (role && roleSource) cite("profile.role", roleSource);
  return {
    profile: {
      name: draft.name.value.trim(),
      role,
      location: resume.basicInfo.find((entry) => entry.key === "location")?.value ?? "",
      availability: resume.jobIntent.find((entry) => entry.key === "availability")?.value ?? "",
      intro: "",
      summary: resume.selfEvaluation.map((entry) => entry.details).join("\n"),
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
    resume,
    sourceRefs
  };
}
