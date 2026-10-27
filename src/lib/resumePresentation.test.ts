import { describe, expect, it } from "vitest";
import { resumeEntryPresentation } from "./resumePresentation";

describe("resumeEntryPresentation", () => {
  it("separates a confirmed role and source prose from a merged work heading", () => {
    const role = "AI Agent 开发实习生（Software Engineer Intern, Algorithm）";
    const raw = `Halliday 北京霍达视界科技有限公司 2026.04 - 2026.08 产品介绍：https://example.com/featured${role} 会议 Agent 业务开发：负责决策卡。\n成果：吞吐提升。`;
    const view = resumeEntryPresentation(raw, "experience", role);
    expect(view.heading).toBe("Halliday 北京霍达视界科技有限公司 2026.04 - 2026.08");
    expect(view.subtitle).toBe(role);
    expect(view.paragraphs.join(" ")).toContain("https://example.com/featured");
    expect(view.paragraphs.join(" ")).toContain("会议 Agent 业务开发：负责决策卡。");
    expect(view.paragraphs.join(" ")).toContain("成果：吞吐提升。");
  });

  it("keeps degree and details beneath an education heading", () => {
    const view = resumeEntryPresentation("2026.09 - 2027.12 香港大学 Master of Science in Computer Science | 全日制硕士主修：Large Language Models 奖项：Delta X Fellowship", "education");
    expect(view.heading).toBe("2026.09 - 2027.12 香港大学");
    expect(view.subtitle).toBe("Master of Science in Computer Science | 全日制硕士");
    expect(view.paragraphs.join(" ")).toContain("主修：Large Language Models");
    expect(view.paragraphs.join(" ")).toContain("奖项：Delta X Fellowship");
  });

  it("uses a neutral label when a merged line has no reliable structure", () => {
    const raw = "未分段的经历说明 ".repeat(25);
    const view = resumeEntryPresentation(raw, "experience");
    expect(view.heading).toBe("经历原文");
    expect(view.paragraphs.join(" ")).toContain(raw.trim());
  });
});
