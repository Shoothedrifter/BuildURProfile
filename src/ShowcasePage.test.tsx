import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesignConfig } from "../types/config";
import rawConfig from "./data/config.json";
import { ShowcasePage } from "./ShowcasePage";

const defaultConfig = rawConfig as DesignConfig;

describe("ShowcasePage image content", () => {
  it("prefers marquee items from config and counts those items", () => {
    const config: DesignConfig = {
      ...defaultConfig,
      marquee: {
        ...defaultConfig.marquee,
        items: ["Custom skill", { label: "Design systems", image: "data:image/png;base64,AAAA" }]
      }
    };
    render(<ShowcasePage config={config} />);

    expect(screen.getAllByAltText("Design systems")).toHaveLength(4);
    expect(screen.getAllByText("Custom skill")).toHaveLength(4);
    expect(screen.getByRole("region", { name: "Scrolling expertise" })).not.toHaveTextContent("Product design");
    expect(screen.getByRole("list", { name: "完整技能" })).toHaveTextContent("Product design");
    expect(screen.getByText("01 / 02")).toBeInTheDocument();
  });

  it("uses expertise skills when marquee items are absent", () => {
    render(<ShowcasePage config={defaultConfig} />);

    expect(screen.getAllByText("Product design").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("01 / 06")).toBeInTheDocument();
  });

  it("keeps long confirmed skills in a static list without repeating the first sentence as a headline", () => {
    const skill = "熟悉 C/C++、Java、Python 等编程语言，能够利用QT实现简易交互界面";
    const config: DesignConfig = {
      ...defaultConfig,
      marquee: { ...defaultConfig.marquee, items: undefined },
      content: {
        ...defaultConfig.content,
        profile: { ...defaultConfig.content.profile, role: "", intro: "" },
        expertise: { eyebrow: "相关技能", headline: skill, summary: skill, skills: [skill, "熟悉 STM32 及相关单片机开发，能自主完成相关的综合实践项目"], disciplines: [skill] }
      }
    };
    render(<ShowcasePage config={config} />);
    expect(screen.getByRole("heading", { name: "技能与专长" })).toBeVisible();
    expect(screen.getAllByText(skill)).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Scrolling expertise" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "完整技能" })).toHaveTextContent("熟悉 STM32");
    expect(screen.queryByText("RESUME SHOWCASE")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看项目/ })).toHaveAttribute("href", "#work");
  });

  it("shows edited profile summary and availability in the live showcase", () => {
    const withProfile = (summary: string, availability: string): DesignConfig => ({
      ...defaultConfig,
      content: {
        ...defaultConfig.content,
        profile: { ...defaultConfig.content.profile, summary, availability }
      }
    });
    const { rerender } = render(<ShowcasePage config={withProfile("I build humane tools.", "Open for work in November")} />);

    expect(screen.getByText("I build humane tools.")).toBeVisible();
    expect(screen.getByText("Open for work in November")).toBeVisible();
    rerender(<ShowcasePage config={withProfile("I design clear systems.", "Booked until January")} />);
    expect(screen.getByText("I design clear systems.")).toBeVisible();
    expect(screen.getByText("Booked until January")).toBeVisible();
    expect(screen.queryByText("I build humane tools.")).not.toBeInTheDocument();
  });

  it("scrolls section links without replacing a share hash", () => {
    const originalHash = window.location.hash;
    window.location.hash = "#share=abc123";
    try {
      render(<ShowcasePage config={defaultConfig} preserveShareHash />);
      const links = [
        ["BuildURProfile home", "top"],
        ["Skills", "about"],
        ["Projects", "work"],
        ["Contact", "contact"],
        ["EXPLORE", "about"],
        ["BACK TO TOP", "top"]
      ] as const;
      for (const [name, id] of links) {
        const target = document.getElementById(id);
        expect(target).not.toBeNull();
        const scrollIntoView = vi.fn();
        Object.defineProperty(target, "scrollIntoView", { configurable: true, value: scrollIntoView });
        const link = screen.getAllByRole("link", { name: new RegExp(name, "i") }).find((entry) => entry.getAttribute("href") === `#${id}`);
        expect(link).toBeDefined();
        expect(fireEvent.click(link!)).toBe(false);
        expect(scrollIntoView).toHaveBeenCalledOnce();
        expect(window.location.hash).toBe("#share=abc123");
      }
    } finally {
      window.location.hash = originalHash;
    }
  });

  it("shows the touch downgrade note only when requested", () => {
    const { rerender } = render(<ShowcasePage config={defaultConfig} />);
    expect(screen.queryByText(/检测到触屏/)).not.toBeInTheDocument();

    rerender(<ShowcasePage config={defaultConfig} touchDowngraded />);
    expect(screen.getByText(/检测到触屏.*卡片手动切换.*跑马灯恒定滚动/)).toBeVisible();
  });

  it("downgrades scroll-bound marquee in the standalone renderer on touch", () => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
    try {
      const config: DesignConfig = { ...defaultConfig, marquee: { ...defaultConfig.marquee, bindToScroll: true, pauseOnHover: true } };
      render(<ShowcasePage config={config} />);
      expect(screen.getByText(/检测到触屏/)).toBeVisible();
      const track = screen.getByTestId("marquee-track-0");
      expect(track).toHaveStyle({ animationName: "marquee-travel", animationPlayState: "running" });
      expect(track.style.transform).toBe("");
    } finally {
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
    }
  });
});
