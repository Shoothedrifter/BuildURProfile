import { reflowResumeEntry } from "./resume";

export type ResumeEntryPresentation = {
  heading: string;
  subtitle: string;
  paragraphs: string[];
};

const dateRange = /(?:19|20)\d{2}[./-]\d{1,2}\s*[-–—~至]\s*(?:19|20)\d{2}[./-]\d{1,2}/u;
const degreeStart = /\b(?:Master of|Bachelor of|Doctor of|PhD|MSc|BSc)\b|计算机科学与技术\s*\||(?:本科|硕士|学士)(?=主修)/iu;
const detailLabel = /(?=(?:产品介绍|主修|奖项|成绩|语言|交换经历|成果|职责)\s*[:：])/u;

function paragraphsOf(value: string): string[] {
  return value.split("\n").flatMap((line) => line.split(detailLabel)).map((line) => line.trim()).filter(Boolean);
}

/** Present only structure supported by the source; ambiguous long lines stay readable as prose. */
export function resumeEntryPresentation(value: string, kind: "experience" | "education", confirmedRole = ""): ResumeEntryPresentation {
  const [rawFirst = "", ...rawRest] = reflowResumeEntry(value).split("\n").map((line) => line.trim()).filter(Boolean);
  let heading = rawFirst;
  let remainder = rawRest.join("\n");

  if (kind === "experience") {
    const match = dateRange.exec(rawFirst);
    if (match && match.index + match[0].length < rawFirst.length) {
      const end = match.index + match[0].length;
      heading = rawFirst.slice(0, end).trim();
      remainder = [rawFirst.slice(end).trim(), remainder].filter(Boolean).join("\n");
    }
  } else {
    const degreeAt = rawFirst.search(degreeStart);
    if (degreeAt > 0) {
      heading = rawFirst.slice(0, degreeAt).trim();
      remainder = [rawFirst.slice(degreeAt).trim(), remainder].filter(Boolean).join("\n");
    }
  }

  if (heading.length > 120) {
    return { heading: kind === "education" ? "教育原文" : "经历原文", subtitle: "", paragraphs: paragraphsOf([rawFirst, ...rawRest].join("\n")) };
  }

  let subtitle = "";
  const role = confirmedRole.trim();
  if (kind === "experience" && role) {
    const at = remainder.indexOf(role);
    if (at >= 0) {
      subtitle = role;
      remainder = [remainder.slice(0, at).trim(), remainder.slice(at + role.length).trim()].filter(Boolean).join("\n");
    }
  }
  if (kind === "education" && remainder) {
    const marker = remainder.search(/(?:主修|奖项|成绩|语言|交换经历)\s*[:：]/u);
    const candidate = (marker >= 0 ? remainder.slice(0, marker) : remainder.split("\n")[0]).trim();
    if (candidate && candidate.length <= 120) {
      subtitle = candidate;
      remainder = remainder.slice(candidate.length).trim();
    }
  }
  if (kind === "experience" && !subtitle && remainder) {
    const firstLine = remainder.split("\n")[0].trim();
    if (firstLine.length <= 100 && /实习生|工程师|设计师|开发者|经理/u.test(firstLine) && !/[。；:：]/u.test(firstLine)) {
      subtitle = firstLine;
      remainder = remainder.slice(firstLine.length).trim();
    }
  }

  return { heading, subtitle, paragraphs: paragraphsOf(remainder) };
}
