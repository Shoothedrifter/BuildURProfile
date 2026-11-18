import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DesignConfigV4 } from "../../../../packages/contracts/src/config";
import rawConfig from "../demo/config.json";
import { ShowcasePage } from "../ShowcasePage";

function config(images: string[] = []): DesignConfigV4 {
  return { ...rawConfig, templateId: "cyber-creator-v1", content: { ...rawConfig.content,
    resume: { version: "resume-v3", sections: [
      { kind: "basicInfo", order: 0, items: [{ itemId: "basic", order: 0, title: "", details: "",
        facts: [{ key: "name", label: "姓名", value: "林青" }, { key: "email", label: "邮箱", value: "lin@example.test" }],
        supplement: { text: "", links: [], images: [] } }] },
      { kind: "selfEvaluation", order: 1, items: [{ itemId: "about", order: 0, title: "自我评价", details: "设计与开发并重。",
        facts: [], supplement: { text: "持续学习。", links: [], images: [] } }] },
      { kind: "skills", order: 2, items: [{ itemId: "skill", order: 0, title: "前端开发", details: "TypeScript 与 React",
        facts: [], supplement: { text: "", links: [], images: [] } }] },
      { kind: "projects", order: 3, items: [{ itemId: "project", order: 0, title: "项目甲", details: "完整说明\n第二段",
        facts: [], supplement: { text: "用户确认的成果", links: [{ label: "作品地址", url: "https://example.test/work" }],
          images: images.map(imageId => ({ imageId, caption: `图片${imageId}` })) } }] }
    ] } } } as unknown as DesignConfigV4;
}

describe("赛博科技固定模板", () => {
  it("uses a full-screen figure hero and confirmed sections in user order", () => {
    const { container } = render(<ShowcasePage config={config()} />);
    expect(screen.getByTestId("cyber-creator-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "林青" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "赛博科技默认立体人物" })).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll("main > section[id]")).map(section => section.id))
      .toEqual(["top", "selfEvaluation", "skills", "projects"]);
    expect(screen.getByRole("heading", { name: "能力与专长" })).toBeInTheDocument();
    expect(screen.getByText("TypeScript 与 React")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /作品地址/ })).toHaveAttribute("href", "https://example.test/work");
    expect(screen.getByText("用户确认的成果")).toBeInTheDocument();
  });

  it("renders a three-image mosaic and keeps additional images accessible", () => {
    const { container } = render(<ShowcasePage config={config(["a", "b", "c", "d"])} resolveResumeImage={id => `/media/${id}`} />);
    expect(container.querySelectorAll(".cyber-project-mosaic img")).toHaveLength(3);
    expect(screen.getByRole("img", { name: "图片a" })).toHaveAttribute("src", "/media/a");
    fireEvent.click(screen.getByText("查看其余图片"));
    expect(screen.getByRole("img", { name: "图片d" })).toHaveAttribute("src", "/media/d");
  });

  it("does not invent a project section or email action when both are absent", () => {
    const value = config();
    const sections = value.content.resume.sections.filter(section => section.kind !== "projects");
    const basic = sections[0];
    const withoutEmail = { ...value, content: { ...value.content, resume: { version: "resume-v3", sections: [
      { ...basic, items: basic.items.map(item => ({ ...item, facts: item.facts.filter(fact => fact.key !== "email") })) }, ...sections.slice(1)
    ] } } } as DesignConfigV4;
    render(<ShowcasePage config={withoutEmail} />);
    expect(screen.queryByRole("heading", { name: "项目甲" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /联系我/ })).not.toBeInTheDocument();
  });
});
