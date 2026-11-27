import { describe, expect, it } from "vitest";
import type { DesignConfigV4, HeroPhoto, PresentationHighlight, ResumeContent, ResumeFact, ResumeModuleKindV2, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import { resumeDisplayContent } from "../../../../packages/contracts/src/resume-v2.mjs";
import { templateToConfig } from "../../../../packages/skills/src/mapping";
import { buildWarmMacaronModel } from "./warmMacaron";

type Item = StructuredResumeV3["sections"][number]["items"][number];
type Section = StructuredResumeV3["sections"][number];

function item(itemId: string, title: string, details = "", facts: readonly ResumeFact[] = [], overrides: Partial<Item> = {}): Item {
  return { itemId, order: 0, title, details, facts, supplement: { text: "", links: [], images: [] }, ...overrides };
}

function section(kind: ResumeModuleKindV2, order: number, items: readonly Item[]): Section {
  return { kind, order, items };
}

function makeConfig(resume: StructuredResumeV3, heroPhoto?: HeroPhoto): DesignConfigV4 {
  return {
    ...templateToConfig("warm-macaron-v1", "ui-ux-designer"),
    content: { ...resumeDisplayContent(resume) as ResumeContent, resume },
    ...(heroPhoto ? { heroPhoto } : {})
  };
}

const awardHighlights: readonly PresentationHighlight[] = [
  { id: "hl-award-1", type: "award-tier", label: "奖项级别", value: "国家级", unit: "", level: "finalist" }
];

describe("buildWarmMacaronModel", () => {
  it("projects the hero plus five sections in resume order and merges showcase modules", () => {
    const resume: StructuredResumeV3 = {
      version: "resume-v3",
      sections: [
        // 数组顺序故意打乱：区块与条目只按 order 字段排列。
        section("skills", 1, [item("skill-ux", "产品体验设计", "用户研究 / 信息架构", [{ key: "tool", label: "工具", value: "Figma" }])]),
        section("workExperience", 2, [
          item("work-b", "出行服务团队", "参与需求梳理。", [], { order: 1 }),
          item("work-a", "内容平台设计组", "负责组件库建设。", [{ key: "dateRange", label: "任职时间", value: "2023 — 至今" }], { order: 0 })
        ]),
        section("education", 3, [
          item("edu-1", "视觉传达设计", "关注交互系统与信息设计。", [
            { key: "dateRange", label: "在校时间", value: "2023.09 - 2027.06" },
            { key: "gpa", label: "GPA", value: "3.8/4.0" },
            { key: "ranking", label: "排名", value: "  " }
          ], { order: 1 }),
          item("edu-0", "香港大学", "交换学习一学期。", [], { order: 0 })
        ]),
        section("projects", 4, [item("proj-1", "城市通勤服务", "项目背景：换乘信息分散。\n交付：路线比较原型。", [{ key: "role", label: "项目角色", value: "用户研究" }],
          { supplement: { text: "补充说明：覆盖三类通勤场景。", links: [{ label: "项目链接", url: "https://example.com/commute" }, { label: "坏链接", url: "javascript:alert(1)" }], images: [] } })]),
        section("campusExperience", 5, [item("campus-1", "设计协会", "组织校园工作坊。")]),
        section("awards", 6, [item("award-1", "校园设计奖", "决赛入围。", [], { presentationHighlights: awardHighlights })]),
        section("other", 7, [item("other-1", "自媒体", "发布设计教程。")]),
        section("basicInfo", 0, [item("identity", "", "", [
          { key: "name", label: "姓名", value: "林予安" },
          { key: "email", label: "邮箱", value: "lin@example.test" },
          { key: "phone", label: "电话", value: "+86 138 0000 0000" }
        ])]),
        section("jobIntent", 8, [item("intent", "", "", [{ key: "targetRole", label: "目标岗位", value: "产品体验设计师" }])]),
        section("selfEvaluation", 9, [item("self-1", "自我评价", "用设计让复杂变简单。\n关注无障碍与信息层次。")])
      ]
    };
    const model = buildWarmMacaronModel(makeConfig(resume));

    expect(model.hero.greeting).toBe("Hi，");
    expect(model.hero.name).toBe("林予安");
    expect(model.hero.role).toBe("产品体验设计师");
    expect(model.hero.intro).toContain("用设计让复杂变简单。");
    expect(model.hero.contact).toEqual({ email: "lin@example.test", phone: "+86 138 0000 0000" });
    expect(model.hero.photo).toBeNull();

    expect(model.sections.map(entry => entry.id)).toEqual(["skills", "workExperience", "education", "projects", "showcase"]);
    expect(model.sections.map(entry => entry.eyebrow)).toEqual(["SKILLS", "EXPERIENCE", "EDUCATION", "PROJECTS", "SHOWCASE"]);
    expect(model.sections.map(entry => entry.title)).toEqual(["个人技能", "工作/实习", "教育背景", "项目经历", "展示区"]);

    const [, experience, education, projects, showcase] = model.sections;
    // 条目按自身 order 排序，itemId 稳定透传。
    expect(experience.cards.map(card => card.itemId)).toEqual(["work-a", "work-b"]);
    expect(education.cards.map(card => card.itemId)).toEqual(["edu-0", "edu-1"]);

    // 时间类 fact 提升为 time 行；facts 只保留有值项。
    const eduCard = education.cards.find(card => card.itemId === "edu-1")!;
    expect(eduCard.time).toBe("2023.09 - 2027.06");
    expect(eduCard.facts).toEqual([{ key: "gpa", label: "GPA", value: "3.8/4.0" }]);
    expect(eduCard.images).toEqual([]);

    const projCard = projects.cards[0];
    expect(projCard.paragraphs).toEqual(["项目背景：换乘信息分散。", "交付：路线比较原型。"]);
    // 补充说明（supplement.text）由项目详情模态收纳：投影保留 trim 后的全文。
    expect(projCard.supplementText).toBe("补充说明：覆盖三类通勤场景。");
    expect(projCard.links).toEqual([{ label: "项目链接", url: "https://example.com/commute" }]);
    // 无补充说明的条目投影为空串，详情模态据此省略该段。
    expect(experience.cards[0].supplementText).toBe("");

    // campusExperience/awards/other 合并进 showcase 区，模块与条目均按 order 排列。
    expect(showcase.cards.map(card => card.itemId)).toEqual(["campus-1", "award-1", "other-1"]);
    expect(showcase.cards.find(card => card.itemId === "award-1")!.highlights).toEqual(awardHighlights);
    expect(showcase.cards.find(card => card.itemId === "campus-1")!.highlights).toEqual([]);
  });

  it("omits sections whose modules hold no display content", () => {
    const resume: StructuredResumeV3 = {
      version: "resume-v3",
      sections: [
        section("basicInfo", 0, [item("identity", "", "", [{ key: "name", label: "姓名", value: "林予安" }])]),
        section("education", 1, [item("edu-empty", "", "", [{ key: "gpa", label: "GPA", value: "" }])]),
        section("workExperience", 2, [item("work-empty", "", "")]),
        section("projects", 3, [item("proj-1", "城市通勤服务", "换乘信息分散。")]),
        section("campusExperience", 4, []),
        section("awards", 5, [item("award-empty", "", "")]),
        section("other", 6, []),
        section("skills", 7, [item("skill-empty", "", "", [{ key: "tool", label: "工具", value: " " }])])
      ]
    };
    const model = buildWarmMacaronModel(makeConfig(resume));
    expect(model.sections.map(entry => entry.id)).toEqual(["projects"]);
  });

  it("keeps both contact fields undefined when no public contact is selected", () => {
    const resume: StructuredResumeV3 = {
      version: "resume-v3",
      sections: [
        section("basicInfo", 0, [item("identity", "", "", [{ key: "name", label: "姓名", value: "林予安" }])]),
        section("skills", 1, [item("skill-1", "产品设计", "调研与原型")])
      ]
    };
    const model = buildWarmMacaronModel(makeConfig(resume));
    expect(model.hero.contact.email).toBeUndefined();
    expect(model.hero.contact.phone).toBeUndefined();
    expect(model.hero.contact).toEqual({});
  });

  it("passes the hero photo through and treats missing or null as absent", () => {
    const resume: StructuredResumeV3 = {
      version: "resume-v3",
      sections: [section("basicInfo", 0, [item("identity", "", "", [{ key: "name", label: "姓名", value: "林予安" }])])]
    };
    const photo: HeroPhoto = { assetUrl: "data:image/png;base64,eA=", alt: "林予安的个人照片" };
    expect(buildWarmMacaronModel(makeConfig(resume, photo)).hero.photo).toEqual(photo);
    expect(buildWarmMacaronModel(makeConfig(resume)).hero.photo).toBeNull();
    // Agent 序列化后的配置可能带 null，投影须与缺失同样归为无照片。
    expect(buildWarmMacaronModel({ ...makeConfig(resume), heroPhoto: null as unknown as undefined }).hero.photo).toBeNull();
  });

  it("carries supplement images onto cards and keeps same-title items apart by itemId", () => {
    const resume: StructuredResumeV3 = {
      version: "resume-v3",
      sections: [
        section("basicInfo", 0, [item("identity", "", "", [{ key: "name", label: "姓名", value: "林予安" }])]),
        section("campusExperience", 1, [
          item("campus-1", "设计协会", "组织校园工作坊。", [], { supplement: { text: "", links: [], images: [{ imageId: "img-campus-1", caption: "工作坊现场" }] } }),
          item("campus-2", "设计协会", "运营社团公众号。", [], { order: 1 })
        ])
      ]
    };
    const model = buildWarmMacaronModel(makeConfig(resume));
    expect(model.sections[0].cards.map(card => card.itemId)).toEqual(["campus-1", "campus-2"]);
    expect(model.sections[0].cards[0].images).toEqual([{ imageId: "img-campus-1", caption: "工作坊现场" }]);
    expect(model.sections[0].cards[1].images).toEqual([]);
  });

  it("prefers the confirmed profile intro over the self evaluation fallback", () => {
    const resume: StructuredResumeV3 = {
      version: "resume-v3",
      sections: [
        section("basicInfo", 0, [item("identity", "", "", [{ key: "name", label: "姓名", value: "林予安" }])]),
        section("selfEvaluation", 1, [item("self-1", "自我评价", "关注无障碍与信息层次。")])
      ]
    };
    const base = makeConfig(resume);
    const config: DesignConfigV4 = { ...base, content: { ...base.content, profile: { ...base.content.profile, intro: "用设计，让复杂变简单。" } } };
    expect(buildWarmMacaronModel(config).hero.intro).toBe("用设计，让复杂变简单。");
    expect(buildWarmMacaronModel(makeConfig(resume)).hero.intro).toBe("关注无障碍与信息层次。");
  });
});
