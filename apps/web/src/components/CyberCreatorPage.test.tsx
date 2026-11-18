import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesignConfig, DesignConfigV4 } from "../../../../packages/contracts/src/config";
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
  it("shows confirmed location in the hero and other selected basic facts in the body", () => {
    const value = config();
    const sections = value.content.resume.sections.map(section => section.kind === "basicInfo"
      ? { ...section, items: section.items.map(item => ({ ...item, facts: [
        ...item.facts, { key: "location", label: "所在地", value: "上海" },
        { key: "phone", label: "电话", value: "123456789" }
      ] })) } : section);
    const { container } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
      resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
    expect(within(container.querySelector(".cyber-hero") as HTMLElement).getByText(/上海/)).toBeInTheDocument();
    expect(within(container.querySelector("#basicInfo") as HTMLElement).getByText("123456789")).toBeInTheDocument();
  });

  it("puts over-height desktop project cards in document flow", async () => {
    const value = config();
    const projects = value.content.resume.sections.find(section => section.kind === "projects")!;
    const first = projects.items[0];
    const sections = value.content.resume.sections.map(section => section.kind === "projects"
      ? { ...section, items: [{ ...first, details: "长正文".repeat(600) }, { ...first, itemId: "project-two", order: 1, title: "项目乙" }] }
      : section);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("cyber-project-card") && this.textContent?.includes("长正文") ? 1600 : 500;
    });
    try {
      const { container } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
        resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
      await waitFor(() => expect(container.querySelector(".cyber-project-card")?.classList).toContain("cyber-project-card--flow"));
    } finally { vi.restoreAllMocks(); }
  });

  it("marks coarse-pointer rendering static and constrains project link layout", async () => {
    const { container } = render(<ShowcasePage config={config()} touchDowngraded />);
    await waitFor(() => expect(screen.getByTestId("cyber-creator-page")).toHaveAttribute("data-static", "true"));
    expect(container.querySelector(".cyber-project-top > a")).toHaveClass("cyber-project-link");
  });

  it("detects a coarse pointer without relying on its caller", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(pointer: coarse)", media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn()
    })));
    try {
      render(<ShowcasePage config={config()} />);
      await waitFor(() => expect(screen.getByTestId("cyber-creator-page")).toHaveAttribute("data-static", "true"));
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps an older dark-tech config on the legacy renderer", () => {
    const oldConfig = { ...rawConfig, skin: "dark-tech" } as DesignConfig;
    const { container } = render(<ShowcasePage config={oldConfig} />);
    expect(screen.queryByTestId("cyber-creator-page")).not.toBeInTheDocument();
    expect(container.querySelector(".showcase-page")).not.toBeNull();
  });

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

  it("frames a supplied portrait separately from the default 3D figure", () => {
    const value = { ...config(), heroArtwork: { assetUrl: "data:image/png;base64,AQID", alt: "本人照片" } } as DesignConfigV4;
    const { container } = render(<ShowcasePage config={value} />);
    expect(container.querySelector(".cyber-hero-figure--photo img")).toHaveAttribute("alt", "本人照片");
  });

  it("keeps project source text behind a readable detail control", () => {
    const value = config();
    const sections = value.content.resume.sections.map(section => section.kind === "projects"
      ? { ...section, items: section.items.map(item => ({ ...item, details: "简短概述", sourceText: "完整原文第一段\n完整原文第二段" })) }
      : section);
    const { container } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
      resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
    const card = container.querySelector(".cyber-project-card") as HTMLElement;
    expect(within(card).getByText("简短概述")).toBeInTheDocument();
    const detail = within(card).getByText("查看项目详情").closest("details");
    expect(detail).not.toBeNull();
    expect(detail).toHaveTextContent("完整原文第一段");
    expect(detail).toHaveTextContent("完整原文第二段");
    expect(card.querySelector(".cyber-project-content--text")).not.toBeNull();
  });

  it("keeps source text accessible for non-project resume sections", () => {
    const value = config();
    const sections = value.content.resume.sections.map(section => section.kind === "skills"
      ? { ...section, items: section.items.map(item => ({ ...item, sourceText: "技能原文说明" })) }
      : section);
    const { container } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
      resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
    const entry = container.querySelector("#skills .cyber-entry") as HTMLElement;
    expect(within(entry).getByText("查看详情").closest("details")).toHaveTextContent("技能原文说明");
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
