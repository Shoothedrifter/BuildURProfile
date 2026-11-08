import type { DesignConfig, JobRole, ResumeContent, StructuredResumeV1, StyleVector } from "../../contracts/src/config.ts";
import type { ResumeCandidateV1 } from "../../contracts/src/resume-candidate.ts";
import { isAssessmentComplete, scoreAnswers } from "./assessment.ts";
import { styleToConfig } from "./mapping.ts";
import { AVATAR_STYLES } from "./avatar-catalog.ts";

export type SkillRuntime = "browser" | "api" | "worker";
export type SkillUsage = "preview" | "commercial";
export type SkillCapability = "extractPdfText" | "parseResumePages" | "validateResumeDraft" | "toResumeContent" |
  "readPortrait" | "storeOutput" | "outputExists" | "existingOutput" | "imageProvider" | "loadStyleRecipe";
export type SkillLicense = Readonly<{ id: string; commercialAllowed: boolean }>;
export type SkillDescriptor = Readonly<{
  id: string;
  version: string;
  runtime: readonly SkillRuntime[];
  capabilities: readonly SkillCapability[];
  timeoutMs: number;
  license: SkillLicense;
  validateInput: (input: unknown) => boolean;
  validateOutput: (output: unknown) => boolean;
  execute: (input: any, capabilities: any, execution: { signal: AbortSignal }) => unknown | Promise<unknown>;
}>;
export type SkillContext = Readonly<{
  runtime: SkillRuntime;
  usage?: SkillUsage;
  capabilities?: Readonly<Record<string, unknown>>;
}>;

const knownCapabilities = new Set<SkillCapability>([
  "extractPdfText", "parseResumePages", "validateResumeDraft", "toResumeContent",
  "readPortrait", "storeOutput", "outputExists", "existingOutput", "imageProvider", "loadStyleRecipe"
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const validVector = (value: unknown): value is StyleVector => isRecord(value) &&
  ["E", "K", "P", "S"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1) &&
  ["cool", "neutral", "warm", "vivid"].includes(String(value.PChoice));
const validConfig = (value: unknown): value is DesignConfig => isRecord(value) && validVector(value.styleVector) &&
  ["dark-tech", "light-minimal", "high-saturation"].includes(String(value.skin)) &&
  isRecord(value.marquee) && isRecord(value.stackedCards) && isRecord(value.content) &&
  isRecord(value.content.profile) && isRecord(value.content.expertise) && Array.isArray(value.content.projects);
const validTextList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(isString);
const candidateModules = ["basicInfo", "jobIntent", "selfEvaluation", "education", "workExperience", "projects", "awards", "skills", "other"] as const;
const validCandidateField = (value: unknown): boolean => isRecord(value) &&
  Object.keys(value).every((key) => ["value", "source", "page", "included", "experienceKind", "label", "fieldKey"].includes(key)) &&
  isString(value.value) && isString(value.source) && Number.isInteger(value.page) && Number(value.page) >= 1 &&
  typeof value.included === "boolean" && (value.experienceKind === undefined || value.experienceKind === "campus") &&
  (value.label === undefined || isString(value.label)) && (value.fieldKey === undefined || isString(value.fieldKey));
function validCandidate(value: unknown): value is ResumeCandidateV1 {
  return isRecord(value) && value.version === "resume-candidate-v1" &&
    Object.keys(value).every((key) => ["version", "name", "email", ...candidateModules].includes(key)) &&
    validCandidateField(value.name) && validCandidateField(value.email) &&
    candidateModules.every((key) => Array.isArray(value[key]) && value[key].length <= 100 && value[key].every(validCandidateField));
}
const resumeModules = ["selfEvaluation", "education", "workExperience", "projects", "awards", "campusExperience", "skills", "other"] as const;
const validFact = (value: unknown): boolean => isRecord(value) && Object.keys(value).every((key) => ["key", "label", "value"].includes(key)) &&
  ["key", "label", "value"].every((key) => isString(value[key]));
const validEntry = (value: unknown): boolean => isRecord(value) && Object.keys(value).every((key) => ["title", "details", "facts"].includes(key)) &&
  isString(value.title) && isString(value.details) && Array.isArray(value.facts) && value.facts.length <= 100 && value.facts.every(validFact);
function validResume(value: unknown): value is StructuredResumeV1 {
  return isRecord(value) && value.version === "resume-v1" &&
    Object.keys(value).every((key) => ["version", "basicInfo", "jobIntent", ...resumeModules].includes(key)) &&
    ["basicInfo", "jobIntent"].every((key) => Array.isArray(value[key]) && value[key].length <= 100 && value[key].every(validFact)) &&
    resumeModules.every((key) => Array.isArray(value[key]) && value[key].length <= 100 && value[key].every(validEntry));
}

function publicResume(resume: StructuredResumeV1): StructuredResumeV1 {
  const fact = (value: StructuredResumeV1["basicInfo"][number]) => ({ key: value.key, label: value.label, value: value.value });
  const entry = (value: StructuredResumeV1["awards"][number]) => ({ title: value.title, details: value.details, facts: value.facts.map(fact) });
  return { version: "resume-v1", basicInfo: resume.basicInfo.map(fact), jobIntent: resume.jobIntent.map(fact),
    selfEvaluation: resume.selfEvaluation.map(entry), education: resume.education.map(entry),
    workExperience: resume.workExperience.map(entry), projects: resume.projects.map(entry), awards: resume.awards.map(entry),
    campusExperience: resume.campusExperience.map(entry), skills: resume.skills.map(entry), other: resume.other.map(entry) };
}
function validContent(value: unknown): value is ResumeContent {
  if (!isRecord(value) || !isRecord(value.profile) || !isRecord(value.expertise) || !Array.isArray(value.projects)) return false;
  const { profile, expertise, projects } = value;
  return ["name", "role", "location", "availability", "intro", "summary", "email"].every((key) => isString(profile[key])) &&
    ["eyebrow", "headline", "summary"].every((key) => isString(expertise[key])) &&
    validTextList(expertise.skills) && validTextList(expertise.disciplines) && projects.length <= 100 &&
    projects.every((project) => isRecord(project) &&
      ["id", "index", "title", "category", "year", "description"].every((key) => isString(project[key])) &&
      ["mint", "lilac", "peach"].includes(String(project.visual)) && validTextList(project.tags) &&
      (project.image === undefined || isString(project.image)) && (project.link === undefined || isString(project.link))) &&
    ["workExperience", "campusExperience", "education"].every((key) => value[key] === undefined || validTextList(value[key])) &&
    (value.resume === undefined || validResume(value.resume));
}

function publicContent(content: ResumeContent): ResumeContent {
  const text = (value: unknown) => typeof value === "string" ? value : "";
  const list = (value: unknown) => Array.isArray(value) ? value.filter(isString).slice(0, 100) : [];
  return {
    profile: Object.fromEntries(["name", "role", "location", "availability", "intro", "summary", "email"]
      .map((key) => [key, text(content.profile[key as keyof typeof content.profile])])) as ResumeContent["profile"],
    expertise: { eyebrow: text(content.expertise.eyebrow), headline: text(content.expertise.headline),
      summary: text(content.expertise.summary), skills: list(content.expertise.skills), disciplines: list(content.expertise.disciplines) },
    projects: content.projects.map((project) => ({ id: text(project.id), index: text(project.index), title: text(project.title),
      category: text(project.category), year: text(project.year), description: text(project.description), tags: list(project.tags),
      visual: project.visual, ...(project.image ? { image: project.image } : {}), ...(project.link ? { link: project.link } : {}) })),
    workExperience: list(content.workExperience), campusExperience: list(content.campusExperience), education: list(content.education),
    ...(content.resume ? { resume: publicResume(content.resume) } : {})
  };
}

/** Only explicit short headings become marquee labels; no truncation or invented prose. */
function skillShortLabels(skills: readonly string[]): string[] {
  return skills.flatMap((skill) => {
    const heading = skill.match(/^([^\n：:]{1,24})\s*[:：]/u)?.[1]?.trim();
    return heading ? [heading] : [];
  });
}

function metadata(definition: SkillDescriptor) {
  return { id: definition.id, version: definition.version, runtime: [...definition.runtime],
    capabilities: [...definition.capabilities], timeoutMs: definition.timeoutMs, license: { ...definition.license } };
}

/** Grants only a declared capability set to a skill and never forwards the caller context itself. */
export function createSkillRegistry() {
  const definitions = new Map<string, SkillDescriptor>();
  function prepare(id: string, input: unknown, context: SkillContext) {
    const definition = definitions.get(id);
    if (!definition) throw new Error(`未知 Skill：${id}`);
    if (!definition.runtime.includes(context.runtime)) throw new Error(`Skill ${id} 不能在 ${context.runtime} 运行。`);
    if (context.usage === "commercial" && !definition.license.commercialAllowed) {
      throw new Error(`Skill ${id} 只获准非商业预览；商业用途需要授权。`);
    }
    if (!definition.validateInput(input)) throw new Error(`Skill ${id} 输入无效。`);
    const provided = context.capabilities ?? {};
    if (Object.keys(provided).some((key) => !definition.capabilities.includes(key as SkillCapability))) {
      throw new Error(`Skill ${id} 收到未批准的能力。`);
    }
    const grants = Object.create(null) as Record<string, unknown>;
    for (const key of definition.capabilities) {
      const value = provided[key];
      if (key === "imageProvider" ? !isRecord(value) || typeof value.edit !== "function" : typeof value !== "function") {
        throw new Error(`Skill ${id} 缺少能力 ${key}。`);
      }
      grants[key] = value;
    }
    return { definition, grants: Object.freeze(grants) };
  }
  return {
    register(definition: SkillDescriptor): void {
      if (!/^[a-z][a-z0-9.-]+\.v\d+$/.test(definition.id) || !definition.version ||
          !definition.runtime.length || !Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs <= 0 ||
          definition.capabilities.some((capability) => !knownCapabilities.has(capability))) {
        throw new Error("Skill 合同无效或请求了未批准的能力。");
      }
      if (definitions.has(definition.id)) throw new Error(`Skill ${definition.id} 已注册。`);
      definitions.set(definition.id, definition);
    },
    describe(id: string) {
      const definition = definitions.get(id);
      if (!definition) throw new Error(`未知 Skill：${id}`);
      return metadata(definition);
    },
    list() { return [...definitions.values()].map(metadata); },
    runSync(id: string, input: unknown, context: SkillContext): any {
      const { definition, grants } = prepare(id, input, context);
      const started = performance.now();
      const output = definition.execute(input, grants, { signal: new AbortController().signal });
      if (isRecord(output) && typeof output.then === "function") throw new Error(`Skill ${id} 是异步 Skill，请使用 run。`);
      if (performance.now() - started > definition.timeoutMs) throw new Error(`Skill ${id} 执行超时。`);
      if (!definition.validateOutput(output)) throw new Error(`Skill ${id} 输出无效。`);
      return output;
    },
    async run(id: string, input: unknown, context: SkillContext): Promise<any> {
      const { definition, grants } = prepare(id, input, context);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(`Skill ${id} 执行超时。`)); controller.abort(); }, definition.timeoutMs);
      });
      try {
        const output = await Promise.race([
          Promise.resolve().then(() => definition.execute(input, grants, { signal: controller.signal })), timeout
        ]);
        if (!definition.validateOutput(output)) throw new Error(`Skill ${id} 输出无效。`);
        return output;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };
}

const internal: SkillLicense = { id: "BuildURProfile-internal", commercialAllowed: true };
const wibi: SkillLicense = { id: "MIT AND LicenseRef-Wibi-Personal-NonCommercial-1.0", commercialAllowed: false };

export function createDefaultSkillRegistry() {
  const registry = createSkillRegistry();
  registry.register({ id: "resume.extract.v1", version: "1.0.0", runtime: ["browser"], capabilities: ["extractPdfText"],
    timeoutMs: 2 * 60 * 1_000, license: internal,
    validateInput: (input) => isRecord(input) && isRecord(input.file) && isString(input.file.name) &&
      input.file.name.toLowerCase().endsWith(".pdf") && (input.onProgress === undefined || typeof input.onProgress === "function"),
    validateOutput: (output) => isRecord(output) && isString(output.text) && Array.isArray(output.pages) && output.pages.every(isString),
    execute: async ({ file, onProgress }: { file: unknown; onProgress?: (done: number, total: number) => void }, tools: any,
      { signal }: { signal: AbortSignal }) => {
      const result = await tools.extractPdfText(file, onProgress, signal);
      if (signal.aborted) throw new Error("PDF 读取已取消。");
      return result;
    } });
  registry.register({ id: "resume.parse.v2", version: "2.0.0", runtime: ["browser"], capabilities: ["parseResumePages"],
    timeoutMs: 5_000, license: internal,
    validateInput: (input) => isRecord(input) && Array.isArray(input.pages) && input.pages.length > 0 && input.pages.every(isString),
    validateOutput: (output) => isRecord(output) && validCandidate(output.draft),
    execute: ({ pages }: { pages: string[] }, tools: any) => ({ draft: tools.parseResumePages(pages) }) });
  registry.register({ id: "resume.confirm.v2", version: "2.0.0", runtime: ["browser"],
    capabilities: ["validateResumeDraft", "toResumeContent"], timeoutMs: 5_000, license: internal,
    validateInput: (input) => isRecord(input) && validCandidate(input.draft),
    validateOutput: (output) => isRecord(output) && validTextList(output.problems) &&
      (output.problems.length > 0 ? output.content === undefined : validContent(output.content) && !("sourceRefs" in output.content)),
    execute: ({ draft }: { draft: unknown }, tools: any) => {
      const problems = tools.validateResumeDraft(draft);
      if (!validTextList(problems)) throw new Error("简历确认结果无效。");
      if (problems.length) return { problems };
      const content = tools.toResumeContent(draft);
      if (!validContent(content)) throw new Error("简历展示内容无效。");
      return { problems: [], content: publicContent(content) };
    } });
  registry.register({ id: "assessment.score.v1", version: "1.0.0", runtime: ["browser", "worker"], capabilities: [],
    timeoutMs: 1_000, license: internal,
    validateInput: (input) => isRecord(input) && isRecord(input.answers) && isAssessmentComplete(input.answers as Record<string, number>),
    validateOutput: (output) => isRecord(output) && validVector(output.vector),
    execute: ({ answers }: { answers: Record<string, number> }) => ({ vector: scoreAnswers(answers) }) });
  registry.register({ id: "design.map.v1", version: "1.0.0", runtime: ["browser", "worker"], capabilities: [],
    timeoutMs: 1_000, license: internal,
    validateInput: (input) => isRecord(input) && validVector(input.vector) &&
      ["ui-ux-designer", "frontend-creative-developer", "brand-motion-copy"].includes(String(input.role)),
    validateOutput: (output) => isRecord(output) && validConfig(output.config),
    execute: ({ vector, role }: { vector: StyleVector; role: JobRole }) => ({ config: styleToConfig(vector, role) }) });
  registry.register({ id: "resume.compose.v2", version: "2.0.0", runtime: ["browser", "worker"], capabilities: [],
    timeoutMs: 1_000, license: internal,
    validateInput: (input) => isRecord(input) && validConfig(input.config) && validContent(input.content),
    validateOutput: (output) => isRecord(output) && validConfig(output.config) && !isRecord(output.config.content.sourceRefs),
    execute: ({ config, content }: { config: DesignConfig; content: ResumeContent }) => {
      const clean = publicContent(content);
      return { config: { ...config, marquee: { ...config.marquee, items: skillShortLabels(clean.expertise.skills) }, content: clean } };
    } });
  registry.register({ id: "avatar.wibi.v1", version: "1.0.0", runtime: ["worker"],
    capabilities: ["readPortrait", "storeOutput", "outputExists", "existingOutput", "imageProvider", "loadStyleRecipe"],
    timeoutMs: 30 * 60 * 1_000, license: wibi,
    validateInput: (input) => isRecord(input) && isString(input.taskId) && isString(input.portraitAssetId) &&
      AVATAR_STYLES.some(({ id }) => id === input.styleId),
    validateOutput: (output) => isRecord(output) && isString(output.outputAssetId) && isString(output.recipeVersion),
    execute: async ({ taskId, portraitAssetId, styleId, leaseToken }: { taskId: string; portraitAssetId: string; styleId: string; leaseToken?: string },
      tools: any, { signal }: { signal: AbortSignal }) => {
      const recipe = tools.loadStyleRecipe(styleId) as { id: string; version: string };
      if (!recipe || recipe.id !== styleId || !isString(recipe.version)) throw new Error("Wibi 风格配方无效。");
      const existing = tools.existingOutput(taskId);
      if (existing && tools.outputExists(existing)) return { outputAssetId: existing, recipeVersion: recipe.version };
      const portrait = tools.readPortrait(portraitAssetId);
      const image = await tools.imageProvider.edit({ portrait, recipe, signal });
      if (signal.aborted) throw new Error("肖像生成已取消。");
      const outputAssetId = tools.storeOutput(taskId, image, leaseToken);
      if (!tools.outputExists(outputAssetId)) throw new Error("成图未通过资产校验。");
      return { outputAssetId, recipeVersion: recipe.version };
    } });
  registry.register({ id: "artifact.qa.v1", version: "1.0.0", runtime: ["worker"], capabilities: ["outputExists"],
    timeoutMs: 1_000, license: internal,
    validateInput: (input) => isRecord(input) && validConfig(input.config),
    validateOutput: (output) => isRecord(output) && output.ok === true,
    execute: ({ config, portraitAssetId, styleId, outputAssetId }: { config: DesignConfig; portraitAssetId?: string; styleId?: string; outputAssetId?: string }, tools: any) => {
      if ("sourceRefs" in config.content) throw new Error("产物包含 PDF 来源片段。");
      if (portraitAssetId && (!styleId || !outputAssetId || !tools.outputExists(outputAssetId))) {
        throw new Error("首屏肖像缺失或无效。");
      }
      if (!portraitAssetId && (styleId || outputAssetId)) throw new Error("无肖像任务包含了肖像产物。");
      return { ok: true };
    } });
  return registry;
}
