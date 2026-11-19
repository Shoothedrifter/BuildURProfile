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
  it("ends with a contact CTA linked to confirmed email and projects", () => {
    const { container } = render(<ShowcasePage config={config()} />);
    const cta = container.querySelector(".cyber-contact-cta") as HTMLElement;
    expect(cta).not.toBeNull();
    expect(within(cta).getByRole("heading", { name: "一起做点有意思的事。" })).toBeInTheDocument();
    expect(within(cta).getByRole("link", { name: "联系我 ↗" })).toHaveAttribute("href", "mailto:lin@example.test");
    expect(within(cta).getByRole("link", { name: "查看项目 ↗" })).toHaveAttribute("href", "#projects");
    expect(container.querySelector("#contact")).toContainElement(cta);
  });

  it("uses the confirmed phone for the CTA when email is absent", () => {
    const value = config();
    const sections = value.content.resume.sections.map(section => section.kind === "basicInfo"
      ? { ...section, items: section.items.map(item => ({ ...item, facts: [
        { key: "name", label: "姓名", value: "林青" }, { key: "phone", label: "电话", value: "123456789" }
      ] })) } : section);
    const { container } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
      resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
    const cta = container.querySelector(".cyber-contact-cta") as HTMLElement;
    expect(within(cta).getByRole("link", { name: "联系我 ↗" })).toHaveAttribute("href", "tel:123456789");
  });

  it("omits the contact CTA when no confirmed contact method exists", () => {
    const value = config();
    const sections = value.content.resume.sections.map(section => section.kind === "basicInfo"
      ? { ...section, items: section.items.map(item => ({ ...item, facts: [
        { key: "name", label: "姓名", value: "林青" }
      ] })) } : section);
    const { container } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
      resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
    expect(container.querySelector(".cyber-contact-cta")).toBeNull();
    expect(within(container.querySelector("#contact") as HTMLElement).getByText("林青")).toBeInTheDocument();
  });

  it("uses selected contact fields at the footer without a basic-info resume section", () => {
    const value = config();
    const sections = value.content.resume.sections.map(section => section.kind === "basicInfo"
      ? { ...section, items: section.items.map(item => ({ ...item, facts: [
        ...item.facts, { key: "phone", label: "电话", value: "123456789" },
        { key: "age", label: "年龄", value: "30" }
      ] })) } : section);
    const { container } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
      resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
    expect(container.querySelector("#basicInfo")).toBeNull();
    expect(within(container.querySelector("#contact") as HTMLElement).getByText("林青")).toBeInTheDocument();
    expect(container.querySelector(".cyber-nav")).not.toHaveTextContent("林青");
    expect(within(container.querySelector("#contact") as HTMLElement).getByRole("link", { name: /123456789/ })).toHaveAttribute("href", "tel:123456789");
    expect(within(container.querySelector("#contact") as HTMLElement).getByRole("link", { name: /lin@example.test/ })).toHaveAttribute("href", "mailto:lin@example.test");
    expect(screen.queryByText("30")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /联系我/ })[0]).toHaveAttribute("href", "#contact");
  });

  it("puts over-height desktop project cards in document flow", async () => {
    const value = config();
    const projects = value.content.resume.sections.find(section => section.kind === "projects")!;
    const first = projects.items[0];
    const sections = value.content.resume.sections.map(section => section.kind === "projects"
      ? { ...section, items: [{ ...first, details: "长正文".repeat(600) }, { ...first, itemId: "project-two", order: 1, title: "项目乙" }] }
      : section);
    let firstCardHeight = 1600;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.textContent?.includes("长正文") ? firstCardHeight : 500;
    });
    try {
      const { container } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
        resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
      const stack = container.querySelector(".cyber-project-stack");
      expect(stack).not.toHaveAttribute("data-stacked");
      firstCardHeight = 300;
      fireEvent.resize(window);
      await waitFor(() => expect(stack).toHaveAttribute("data-stacked"));
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
    expect(screen.getByRole("heading", { level: 1, name: "你好，我是林青" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "赛博科技默认中性动漫形象" })).toHaveAttribute("src", "/cyber-neutral-print-anime.webp");
    expect(screen.queryByText(/CREATOR PORTFOLIO|PORTFOLIO\./)).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll("main > section[id]")).map(section => section.id))
      .toEqual(["top", "selfEvaluation", "skills", "projects"]);
    expect(screen.getByRole("heading", { name: "能力与专长" })).toBeInTheDocument();
    expect(screen.getByText("TypeScript 与 React")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /作品地址/ })).toHaveAttribute("href", "https://example.test/work");
    expect(screen.getByText("用户确认的成果")).toBeInTheDocument();
  });

  it("shows portfolio sections without resume-style module markers", () => {
    const value = config();
    const sections = value.content.resume.sections.map(section => section.kind === "basicInfo"
      ? { ...section, items: section.items.map(item => ({ ...item, facts: [...item.facts,
        { key: "phone", label: "电话", value: "123456789" }] })) }
      : section);
    const withExperience = { ...value, content: { ...value.content, resume: { version: "resume-v3", sections: [
      ...sections, { kind: "workExperience", order: 4, items: [{ itemId: "work", order: 0, title: "实习经历", details: "完成项目交付", facts: [], supplement: { text: "", links: [], images: [] } }] }
    ] } } } as DesignConfigV4;
    const { container } = render(<ShowcasePage config={withExperience} />);
    expect(container.querySelector(".cyber-section-label")).toBeNull();
    expect(screen.getByRole("heading", { name: "实习/工作经历" })).toBeInTheDocument();
    expect(within(container.querySelector(".cyber-marquee") as HTMLElement).getByText("实习/工作经历")).toBeInTheDocument();
    expect(container.querySelectorAll("#workExperience h2")).toHaveLength(1);
    expect(within(container.querySelector(".cyber-marquee") as HTMLElement).getByText("实习经历")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目作品" })).toBeInTheDocument();
  });

  it("uses the given name in the hero and keeps the full name only in contact", () => {
    for (const [fullName, greeting] of [["林青", "你好，我是林青"], ["高艺云", "你好，我是艺云"], ["欧阳艺云", "你好，我是艺云"]]) {
      const value = config();
      const sections = value.content.resume.sections.map(section => section.kind === "basicInfo"
        ? { ...section, items: section.items.map(item => ({ ...item, facts: item.facts.map(fact => fact.key === "name" ? { ...fact, value: fullName } : fact) })) }
        : section);
      const { container, unmount } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
        resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
      expect(within(container).getByRole("heading", { level: 1, name: greeting })).toBeInTheDocument();
      expect(container.querySelector(".cyber-nav")).not.toHaveTextContent(fullName);
      expect(within(container.querySelector("#contact") as HTMLElement).getByText(fullName)).toBeInTheDocument();
      unmount();
    }
  });

  it("keeps the experience marquee tied to confirmed work entries", () => {
    const value = config();
    const sections = [...value.content.resume.sections,
      { kind: "workExperience" as const, order: 4, items: [{ itemId: "work", order: 0, title: "前端开发实习生", details: "完成项目交付", facts: [], supplement: { text: "", links: [], images: [] } }] }];
    const { container, rerender } = render(<ShowcasePage config={{ ...value, content: { ...value.content,
      resume: { version: "resume-v3", sections } } } as DesignConfigV4} />);
    const marquee = container.querySelector(".cyber-marquee") as HTMLElement;
    expect(within(marquee).getByText("实习/工作经历")).toBeInTheDocument();
    expect(within(marquee).getByText("前端开发实习生")).toBeInTheDocument();
    expect(within(marquee).queryByText("前端开发")).not.toBeInTheDocument();
    rerender(<ShowcasePage config={value} />);
    expect(container.querySelector(".cyber-marquee")).toBeNull();
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
    expect(container.querySelector(".cyber-hero-figure--poster img")).toHaveAttribute("alt", "本人照片");
  });

  it("places a transparent portrait on the hero stage when a cutout is available", () => {
    const value = { ...config(), heroArtwork: { assetUrl: "data:image/png;base64,AQID",
      cutoutAssetUrl: "data:image/webp;base64,BAUG", alt: "透明人物" } } as DesignConfigV4;
    const { container } = render(<ShowcasePage config={value} />);
    expect(container.querySelector(".cyber-hero-figure--cutout img")).toHaveAttribute("src", value.heroArtwork?.cutoutAssetUrl);
    expect(container.querySelector(".cyber-hero-figure--poster")).toBeNull();
    fireEvent.error(container.querySelector(".cyber-hero-figure--cutout img")!);
    expect(container.querySelector(".cyber-hero-figure--poster img")).toHaveAttribute("src", value.heroArtwork?.assetUrl);
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
