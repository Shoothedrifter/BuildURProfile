export class ServiceError extends Error {
  constructor(status, message) { super(message); this.name = "ServiceError"; this.status = status; }
}

const RESUME_MODULES = ["selfEvaluation", "education", "workExperience", "projects", "awards", "campusExperience", "skills", "other"];

/** A strict allowlist prevents PDF evidence from entering queued or published content. */
export function cleanStructuredResume(resume) {
  const record = (value, keys) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
      throw new ServiceError(400, "简历模块字段无效或包含来源原文。");
    }
    return value;
  };
  const text = (value) => {
    if (typeof value !== "string" || value.length > 12000 || value.includes("\0")) throw new ServiceError(400, "简历模块文本无效。");
    return value;
  };
  const list = (value, map) => {
    if (!Array.isArray(value) || value.length > 100) throw new ServiceError(400, "简历模块条目无效或过多。");
    return value.map(map);
  };
  const fact = (input) => {
    const value = record(input, ["key", "label", "value"]);
    return { key: text(value.key), label: text(value.label), value: text(value.value) };
  };
  const entry = (input) => {
    const value = record(input, ["title", "details", "facts"]);
    return { title: text(value.title), details: text(value.details), facts: list(value.facts, fact) };
  };
  const value = record(resume, ["version", "basicInfo", "jobIntent", ...RESUME_MODULES]);
  if (value.version !== "resume-v1") throw new ServiceError(400, "简历模块版本无效。");
  return {
    version: "resume-v1",
    basicInfo: list(value.basicInfo, fact), jobIntent: list(value.jobIntent, fact),
    ...Object.fromEntries(RESUME_MODULES.map((key) => [key, list(value[key], entry)]))
  };
}

export function cleanConfig(config) {
  if (config?.heroArtwork) throw new ServiceError(403, "Wibi 肖像仅供本机预览，不能用于付费分享或导出。");
  if (!config || typeof config !== "object" || Array.isArray(config) ||
    !config.styleVector || !config.skin || !config.marquee || !config.stackedCards ||
    !config.content?.profile || !config.content?.expertise || !Array.isArray(config.content?.projects)) {
    throw new ServiceError(400, "Design Config 数据无效。");
  }
  const text = (value) => typeof value === "string" ? value : "";
  const imageText = (value) => typeof value === "string" ? value : "";
  const textList = (value) => {
    if (!Array.isArray(value)) return [];
    if (value.length > 100) throw new ServiceError(413, "项目字段数量超过限制，内容未被截断。");
    return value.map(text);
  };
  if (config.content.projects.length > 100 || (config.marquee.items?.length ?? 0) > 100) {
    throw new ServiceError(413, "项目条目数量超过限制，内容未被截断。");
  }
  const profile = config.content.profile, expertise = config.content.expertise;
  // Explicit allowlist: sourceRefs, PDF extraction data, and client-supplied ownership/payment flags are discarded.
  const clone = {
    styleVector: { E: Number(config.styleVector.E), K: Number(config.styleVector.K),
      P: Number(config.styleVector.P), S: Number(config.styleVector.S), PChoice: text(config.styleVector.PChoice) },
    skin: text(config.skin),
    marquee: { direction: text(config.marquee.direction), speed: Number(config.marquee.speed),
      bindToScroll: Boolean(config.marquee.bindToScroll), rows: Number(config.marquee.rows),
      tileSize: Number(config.marquee.tileSize), pauseOnHover: Boolean(config.marquee.pauseOnHover),
      items: Array.isArray(config.marquee.items) ? config.marquee.items.map((item) =>
        typeof item === "string" ? text(item) : ({ label: text(item?.label), image: imageText(item?.image) })) : [] },
    stackedCards: { scaleStep: Number(config.stackedCards.scaleStep), offsetStep: Number(config.stackedCards.offsetStep),
      stickyTop: Number(config.stackedCards.stickyTop), layout: text(config.stackedCards.layout),
      cardRadius: Number(config.stackedCards.cardRadius), enableTilt: Boolean(config.stackedCards.enableTilt),
      autoPlay: Boolean(config.stackedCards.autoPlay) },
    content: {
      profile: Object.fromEntries(["name", "role", "location", "availability", "intro", "summary", "email"]
        .map((key) => [key, text(profile[key])])),
      expertise: { eyebrow: text(expertise.eyebrow), headline: text(expertise.headline),
        summary: text(expertise.summary), skills: textList(expertise.skills), disciplines: textList(expertise.disciplines) },
      projects: config.content.projects.map((project) => ({
        id: text(project?.id), index: text(project?.index), title: text(project?.title),
        category: text(project?.category), year: text(project?.year), description: text(project?.description),
        tags: textList(project?.tags), visual: text(project?.visual),
        ...(project?.image ? { image: imageText(project.image) } : {}),
        ...(project?.link ? { link: text(project.link) } : {})
      })),
      workExperience: textList(config.content.workExperience),
      campusExperience: textList(config.content.campusExperience), education: textList(config.content.education),
      ...(config.content.resume === undefined ? {} : { resume: cleanStructuredResume(config.content.resume) })
    }
  };
  if (![clone.styleVector.E, clone.styleVector.K, clone.styleVector.P, clone.styleVector.S].every((score) =>
    Number.isFinite(score) && score >= 0 && score <= 1) ||
    !["dark-tech", "light-minimal", "high-saturation"].includes(clone.skin) ||
    !["left", "right"].includes(clone.marquee.direction) ||
    !["center", "offset", "fan"].includes(clone.stackedCards.layout) ||
    !Number.isFinite(clone.marquee.speed) || !Number.isFinite(clone.stackedCards.scaleStep)) {
    throw new ServiceError(400, "Design Config 参数无效。");
  }
  for (const project of clone.content.projects) {
    if (project?.image && !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(project.image)) {
      throw new ServiceError(400, "项目图片需要先在浏览器内嵌入。");
    }
  }
  for (const item of clone.marquee.items ?? []) {
    if (typeof item === "object" && item?.image && !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(item.image)) {
      throw new ServiceError(400, "跑马灯图片需要先在浏览器内嵌入。");
    }
  }
  const json = JSON.stringify(clone);
  if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw new ServiceError(413, "项目内容超过 8 MiB 限制。");
  return json;
}

