import type { DesignConfigV4, ResumeContent, ResumeFact, StructuredResumeV3, TemplateId } from "../../../../packages/contracts/src/config";
import { resumeDisplayContent } from "../../../../packages/contracts/src/resume-v2.mjs";
import { templateToConfig } from "../../../../packages/skills/src/mapping";

export const demoTemplates: readonly { id: TemplateId; name: string; background: string; foreground: string }[] = [
  { id: "cyber-creator-v1", name: "赛博科技", background: "#152337", foreground: "#d6e9ff" },
  { id: "pixel-world-v1", name: "像素世界风", background: "#091d22", foreground: "#d3ff9c" },
  { id: "warm-v1", name: "温暖创意", background: "#f7eadd", foreground: "#814831" },
  { id: "minimal-v1", name: "理性简约", background: "#f7f7f2", foreground: "#292925" },
  { id: "bold-v1", name: "大胆实验", background: "#e5dafd", foreground: "#302063" }
];

export const demoModules = [
  { kind: "projects", label: "项目经历" },
  { kind: "workExperience", label: "工作经历" },
  { kind: "skills", label: "专业技能" },
  { kind: "education", label: "教育背景" }
] as const;

type DemoModule = (typeof demoModules)[number]["kind"];
type Section = StructuredResumeV3["sections"][number];

export type DemoDraft = {
  name: string;
  role: string;
  headline: string;
  templateId: TemplateId;
  modules: { kind: DemoModule; visible: boolean }[];
  showContact: boolean;
};

export const demoDraftKey = "burp-showcase-demo-v1";
export const defaultDemoDraft: DemoDraft = {
  name: "林予安",
  role: "产品体验设计师",
  headline: "用设计，让复杂变简单。",
  templateId: "warm-v1",
  modules: demoModules.map(({ kind }) => ({ kind, visible: true })),
  showContact: true
};

function item(itemId: string, title: string, details = "", facts: readonly ResumeFact[] = []): Section["items"][number] {
  return { itemId, order: 0, title, details, facts, supplement: { text: "", links: [], images: [] } };
}

const entries: Record<DemoModule, Section["items"]> = {
  projects: [
    item("demo-commute", "城市通勤服务", "项目背景：换乘信息分散，通勤者难以比较不同路线。\n设计过程：通过站点访谈与换乘任务测试，梳理通勤信息层级。\n交付：用户旅程、关键流程图与路线比较交互原型。",
      [{ key: "projectRole", label: "项目角色", value: "用户研究 / 信息架构 / 交互设计" }])
  ],
  workExperience: [
    item("demo-team", "出行服务团队", "参与从需求梳理到原型验证的完整设计过程。",
      [{ key: "role", label: "职责", value: "体验设计师" }, { key: "dateRange", label: "任职时间", value: "2023 — 至今" }])
  ],
  skills: [item("demo-skills", "产品体验设计", "用户研究 / 信息架构 / Figma / 交互原型")],
  education: [item("demo-education", "视觉传达设计", "关注交互系统与信息设计。")]
};

/** Use the same source content and template mapping as the real Showcase renderers. */
export function createDemoShowcaseConfig(templateId: TemplateId, draft: DemoDraft = defaultDemoDraft): DesignConfigV4 {
  const identity = [
    { key: "name", label: "姓名", value: draft.name.trim() },
    ...(draft.showContact ? [{ key: "email", label: "邮箱", value: "lin@example.test" }] : [])
  ];
  const sections: Omit<Section, "order">[] = [
    { kind: "basicInfo", items: [item("demo-identity", "", "", identity)] },
    { kind: "jobIntent", items: [item("demo-role", "", "", [{ key: "targetRole", label: "目标岗位", value: draft.role.trim() }])] },
    ...draft.modules.filter(({ visible }) => visible).map(({ kind }) => ({ kind, items: entries[kind] }))
  ];
  const resume: StructuredResumeV3 = { version: "resume-v3", sections: sections.map((section, order) => ({ ...section, order })) };
  const content = resumeDisplayContent(resume) as ResumeContent;
  const base = templateToConfig(templateId, "ui-ux-designer");

  return {
    ...base,
    content: { ...content, profile: { ...content.profile, intro: draft.headline.trim() }, resume }
  };
}

export function readDemoDraft(raw: string | null): DemoDraft {
  try {
    const draft = raw ? JSON.parse(raw) as Partial<DemoDraft> | null : null;
    if (!draft || !Array.isArray(draft.modules) || draft.modules.length !== demoModules.length ||
        new Set(draft.modules.map(module => module?.kind)).size !== demoModules.length ||
        !draft.modules.every(module => demoModules.some(({ kind }) => kind === module?.kind) && typeof module.visible === "boolean")) {
      return defaultDemoDraft;
    }
    const text = (value: unknown, fallback: string, limit: number) =>
      typeof value === "string" ? value.replaceAll("\0", "").slice(0, limit) : fallback;
    return {
      name: text(draft.name, defaultDemoDraft.name, 30),
      role: text(draft.role, defaultDemoDraft.role, 50),
      headline: text(draft.headline, defaultDemoDraft.headline, 80),
      templateId: demoTemplates.find(({ id }) => id === draft.templateId)?.id ?? defaultDemoDraft.templateId,
      modules: draft.modules,
      showContact: typeof draft.showContact === "boolean" ? draft.showContact : defaultDemoDraft.showContact
    };
  } catch {
    return defaultDemoDraft;
  }
}
