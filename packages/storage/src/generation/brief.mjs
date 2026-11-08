import { ServiceError, cleanStructuredResume } from "../../../contracts/src/validation.mjs";
import { QUESTIONS, isAssessmentComplete } from "../../../skills/src/assessment.ts";

const ROLES = new Set(["ui-ux-designer", "frontend-creative-developer", "brand-motion-copy"]);
const PROFILE_FIELDS = ["name", "role", "location", "availability", "intro", "summary", "email"];
const EXPERTISE_FIELDS = ["eyebrow", "headline", "summary", "skills", "disciplines"];
const PROJECT_FIELDS = ["id", "index", "title", "category", "year", "description", "tags", "visual", "image", "link"];

function record(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))) throw new ServiceError(400, `${label}字段无效。`);
  return value;
}
function fieldText(value, label, max = 12000) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new ServiceError(400, `${label}字段无效或过长。`);
  return value;
}
function fieldList(value, label, max = 100) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new ServiceError(400, `${label}字段数量超过限制。`);
  return value.map((entry) => fieldText(entry, label));
}

/** Return a strict, serializable brief. PDF bytes, excerpts and provenance cannot enter a checkpoint. */
export function cleanGenerationBrief(input) {
  let size;
  try { size = Buffer.byteLength(JSON.stringify(input)); } catch { throw new ServiceError(400, "生成内容无效。"); }
  if (size > 256 * 1024) throw new ServiceError(413, "生成内容过大（最大 256 KiB）。");
  const brief = record(input, ["role", "answers", "content"], "生成请求");
  if (!ROLES.has(brief.role)) throw new ServiceError(400, "目标角色无效。");
  const answers = record(brief.answers, QUESTIONS.map((question) => question.id), "测评答案");
  if (Object.keys(answers).length !== QUESTIONS.length || !isAssessmentComplete(answers)) {
    throw new ServiceError(400, "测评答案无效或不完整。");
  }
  const content = record(brief.content,
    ["profile", "expertise", "projects", "workExperience", "campusExperience", "education", "resume"], "展示内容");
  const profile = record(content.profile, PROFILE_FIELDS, "个人资料");
  const expertise = record(content.expertise, EXPERTISE_FIELDS, "能力资料");
  if (!Array.isArray(content.projects) || content.projects.length > 100) throw new ServiceError(400, "项目字段无效或过多。");
  const projects = content.projects.map((entry) => {
    const project = record(entry, PROJECT_FIELDS, "项目");
    if (project.visual !== undefined && !["mint", "lilac", "peach"].includes(project.visual)) {
      throw new ServiceError(400, "项目视觉字段无效。");
    }
    if (project.image !== undefined && !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,/i.test(project.image)) {
      throw new ServiceError(400, "项目图片必须是内嵌图片。");
    }
    if (project.link !== undefined && !/^https?:\/\//i.test(project.link)) {
      throw new ServiceError(400, "项目链接必须是 HTTP(S) 地址。");
    }
    return {
      id: fieldText(project.id, "项目 ID", 100), index: fieldText(project.index, "项目序号", 30),
      title: fieldText(project.title, "项目标题"), category: fieldText(project.category, "项目类别"),
      year: fieldText(project.year, "项目年份", 30), description: fieldText(project.description, "项目描述"),
      tags: fieldList(project.tags, "项目标签"), visual: project.visual ?? "mint",
      ...(project.image === undefined ? {} : { image: fieldText(project.image, "项目图片", 256 * 1024) }),
      ...(project.link === undefined ? {} : { link: fieldText(project.link, "项目链接", 2048) })
    };
  });
  const result = {
    role: brief.role,
    answers: Object.fromEntries(QUESTIONS.map(({ id }) => [id, answers[id]])),
    content: {
      profile: Object.fromEntries(PROFILE_FIELDS.map((key) => [key, fieldText(profile[key], `个人资料 ${key}`)])),
      expertise: { eyebrow: fieldText(expertise.eyebrow, "能力标题"), headline: fieldText(expertise.headline, "能力标题"),
        summary: fieldText(expertise.summary, "能力简介"), skills: fieldList(expertise.skills, "技能"),
        disciplines: fieldList(expertise.disciplines, "能力领域") },
      projects,
      workExperience: fieldList(content.workExperience, "工作经历"),
      campusExperience: fieldList(content.campusExperience, "校园经历"),
      education: fieldList(content.education, "教育经历"),
      ...(content.resume === undefined ? {} : { resume: cleanStructuredResume(content.resume) })
    }
  };
  if (!result.content.profile.name.trim()) throw new ServiceError(400, "请确认简历姓名。");
  return result;
}
