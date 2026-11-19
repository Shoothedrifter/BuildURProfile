import { describe, expect, it } from "vitest";
import type { DesignConfigV4, ResumeDisplayItem, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import rawConfig from "../demo/config.json";
import { buildCyberCreatorPresentation } from "./cyber-creator-presentation";

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
    expect(result.marquee.labels).toEqual(["实习/工作经历", "设计实习生"]);
    expect(result.sections[1].items[0].details).toBe("原文\n第二段");
  });

  it("shows no experience marquee when confirmed work is absent", () => {
    const result = buildCyberCreatorPresentation(config([
      { kind: "skills", order: 0, items: [{ ...item("skill", [], "TypeScript"), order: 0 }] },
      { kind: "projects", order: 1, items: [] }
    ]));
    expect(result.projects).toEqual([]);
    expect(result.sections.map(section => section.kind)).toEqual(["skills"]);
    expect(result.marquee.labels).toEqual([]);
  });

  it("selects text, single, double and mosaic layouts without losing full descriptions", () => {
    const projects = [[], ["one"], ["one", "two"], ["one", "two", "three"]]
      .map((images, order) => ({ ...item(String(order), images, "第一段\n第二段"), order }));
    const result = buildCyberCreatorPresentation(config([{ kind: "projects", order: 0, items: projects }]));
    expect(result.projects.map(project => project.layout)).toEqual(["text", "single", "double", "mosaic"]);
    expect(result.projects.every(project => project.item.details === "第一段\n第二段")).toBe(true);
  });
});
