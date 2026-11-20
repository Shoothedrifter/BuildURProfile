import { describe, expect, it } from "vitest";
import type { DesignConfigV4, ResumeDisplayItem, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import rawConfig from "../demo/config.json";
import { buildCyberCreatorPresentation } from "./cyber-creator-presentation";
import { presentOptionalEntry } from "./cyber-optional-content";

const item = (id: string, images: string[] = [], details = "完整项目说明\n第二行"): ResumeDisplayItem & { order: number } => ({
  itemId: id, order: 0, title: `项目${id}`, details, facts: [],
  supplement: { text: "补充成果", links: [{ label: "作品地址", url: "https://example.test/work" }],
    images: images.map(imageId => ({ imageId, caption: `图片${imageId}` })) }
});

function config(sections: StructuredResumeV3["sections"]): DesignConfigV4 {
  return { ...rawConfig, templateId: "cyber-creator-v1", content: { ...rawConfig.content,
    resume: { version: "resume-v3", sections } } } as unknown as DesignConfigV4;
}

describe("赛博科技展示映射", () => {
  it("preserves user module order and binds each image to its own project", () => {
    const result = buildCyberCreatorPresentation(config([
      { kind: "projects", order: 0, items: [{ ...item("a", ["a1", "a2", "a3", "a4", "a5", "a6"]), order: 0 },
        { ...item("b", ["b1"]), order: 1 }] },
      { kind: "workExperience", order: 1, items: [{ ...item("work", [], "原文\n第二段"), title: "设计实习生", order: 0 }] }
    ]));
    expect(result.sections.map(section => section.kind)).toEqual(["projects", "workExperience"]);
    expect(result.projects[0].images.map(image => image.imageId)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    expect(result.projects[0].layout).toBe("mosaic");
    expect(result.projects[0].link?.url).toBe("https://example.test/work");
    expect(result.projects[1].images.map(image => image.imageId)).toEqual(["b1"]);
    expect(result.projects[1].layout).toBe("single");
    expect(result.sections[1].items[0].title).toBe("设计实习生");
    expect(result.sections[1].items[0].details).toBe("原文\n第二段");
  });

  it("omits sections without confirmed content", () => {
    const result = buildCyberCreatorPresentation(config([
      { kind: "skills", order: 0, items: [{ ...item("skill", [], "TypeScript"), order: 0 }] },
      { kind: "projects", order: 1, items: [] }
    ]));
    expect(result.projects).toEqual([]);
    expect(result.sections.map(section => section.kind)).toEqual(["skills"]);
  });

  it("selects text, single, double and mosaic layouts without losing full descriptions", () => {
    const projects = [[], ["one"], ["one", "two"], ["one", "two", "three"]]
      .map((images, order) => ({ ...item(String(order), images, "第一段\n第二段"), order }));
    const result = buildCyberCreatorPresentation(config([{ kind: "projects", order: 0, items: projects }]));
    expect(result.projects.map(project => project.layout)).toEqual(["text", "single", "double", "mosaic"]);
    expect(result.projects.every(project => project.item.details === "第一段\n第二段")).toBe(true);
  });

  it("promotes stated campus outcomes and keeps an explicit date available", () => {
    const entry = { ...item("campus", [], "2022.10-2024.09 任宣传组成员\n实现粉丝增长25%，互动量增长40%\n预计转化率增长30%，50%"),
      title: "宣传组成员", sourceText: "阅读量增长80%" };
    const presentation = presentOptionalEntry(entry, "campusExperience");
    expect(presentation.period).toBe("2022.10-2024.09");
    expect(presentation.summary).toContain("任宣传组成员");
    expect(presentation.highlights).toEqual([
      { label: "粉丝增长", value: "25%" }, { label: "互动量增长", value: "40%" }
    ]);
  });

  it("uses explicit award totals and tiers without making an aggregate", () => {
    const entry = { ...item("awards", [], "GPA：4.04/4.5 (TOP 2%)，2024 年毕业\n本科期间共获学科竞赛奖项60项，其中国家级18项，省级33项，国际级9项"),
      title: "成绩与竞赛" };
    expect(presentOptionalEntry(entry, "awards").highlights).toEqual([
      { label: "学科竞赛奖项", value: "60项", total: true }, { label: "国家级", value: "18项" },
      { label: "省级", value: "33项" }, { label: "国际级", value: "9项" }
    ]);
    expect(presentOptionalEntry({ ...entry, details: "国家级奖项18项、省级奖项33项" }, "awards").highlights)
      .toEqual([{ label: "国家级", value: "18项" }, { label: "省级", value: "33项" }]);
  });
});
