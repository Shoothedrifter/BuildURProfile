import { describe, expect, it } from "vitest";
import type { ProjectCard } from "../../../../packages/contracts/src/config";
import { projectPresentation, projectPreview, shouldAnimateMarquee } from "./presentation";

const card: ProjectCard = {
  id: "one", index: "01", title: "A project", category: "",
  year: "", description: "", tags: [], visual: "mint"
};

describe("showcase presentation", () => {
  it("promotes a legacy URL category to a safe project link without displaying it as category", () => {
    expect(projectPresentation({ ...card, category: "https://github.com/example/repo" })).toEqual({
      category: "", link: "https://github.com/example/repo"
    });
    expect(projectPresentation({ ...card, category: "Research", link: "javascript:alert(1)" })).toEqual({
      category: "Research", link: undefined
    });
    expect(projectPresentation({ ...card, category: "Research", link: "https://example.com/path" })).toEqual({
      category: "Research", link: "https://example.com/path"
    });
  });

  it("shows labeled overview and role/outcome excerpts while retaining the complete source", () => {
    const source = `简介：${"这是一段经过确认的中文项目说明。".repeat(25)} 分工：负责模型与电路设计。 成果：完成验证。`;
    const preview = projectPreview(source);
    expect(preview.overview).toContain("这是一段经过确认");
    expect(preview.overview.length).toBeLessThan(source.length);
    expect(preview.overviewIsExcerpt).toBe(true);
    expect(preview.points).toEqual([
      { label: "分工", text: "负责模型与电路设计。", isExcerpt: false },
      { label: "成果", text: "完成验证。", isExcerpt: false }
    ]);
  });

  it("falls back to the whole unlabeled description as the card overview", () => {
    const source = "Built with google/byt5-base and checked against BLEU. Full research detail remains here.";
    expect(projectPreview(source)).toEqual({ overview: source, overviewIsExcerpt: false, points: [] });
  });

  it("collapses multiline unlabeled details into a single-line overview", () => {
    const preview = projectPreview("- 第一行要点\n- 第二行要点\n- 第三行要点");
    expect(preview.overview).toBe("- 第一行要点 - 第二行要点 - 第三行要点");
    expect(preview.overviewIsExcerpt).toBe(false);
  });

  it("excerpts an unlabeled overview longer than the card limit", () => {
    const source = "无标签的自由正文应当被节选。".repeat(40);
    const preview = projectPreview(source);
    expect(preview.overview.length).toBeLessThan(source.length);
    expect(preview.overviewIsExcerpt).toBe(true);
  });

  it("keeps long skill statements out of the animated track without truncating their text", () => {
    expect(shouldAnimateMarquee(["编程与数据", "模型训练与 NLP"])).toBe(true);
    expect(shouldAnimateMarquee(["熟悉 C/C++、Java、Python 等编程语言，能够利用 QT 实现简易交互界面"])).toBe(false);
    expect(shouldAnimateMarquee(["unbroken_identifier_that_exceeds_a_single_tile_width"])).toBe(false);
  });
});
