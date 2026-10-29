import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StackedCards } from "./StackedCards";

const longTitle = "基于AI Studio计算机视觉的运动自行车环境感知系统（省级大创优秀结题项目·技术负责人）";
const longDescription = `简介：${"确认后的项目正文保持完整。".repeat(90)} 分工：负责模型设计。 成果：完成验证。`;
const cards = [
  { id: "a", index: "01", title: longTitle, category: "", year: "", description: longDescription, tags: [], visual: "mint" as const },
  { id: "b", index: "02", title: "Second project", category: "https://github.com/example/repo", year: "2026", description: "No structured introduction, but this complete text must remain readable.", tags: [], visual: "lilac" as const }
];
const props = { scaleStep: 0.08, offsetStep: 22, stickyTop: 96, layout: "offset" as const, cardRadius: 18, enableTilt: true, autoPlay: false, cards };

describe("StackedCards", () => {
  it("keeps the active card in normal flow with complete title and a full-text detail disclosure", () => {
    render(<StackedCards {...props} />);
    const deck = screen.getByRole("region", { name: "Selected work cards" });
    const card = screen.getByRole("article");
    expect(deck).toContainElement(card);
    expect(card).toHaveClass("project-card");
    expect(screen.getByRole("heading", { name: longTitle })).toBeVisible();
    expect(screen.getByText(/概述节选/)).toBeVisible();
    expect(screen.getByText("分工", { exact: true })).toBeVisible();
    const details = screen.getByText("查看项目详情").closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("查看项目详情"));
    expect(details).toHaveAttribute("open");
    expect(details).toHaveTextContent(longDescription);
    expect(screen.queryByText(/Concept preview/i)).not.toBeInTheDocument();
    expect(card.querySelector(".project-category, .project-tags, .project-art")).toBeNull();
  });

  it("keeps manual buttons and keyboard selection available while using deck parameters", () => {
    const { rerender } = render(<StackedCards {...props} />);
    const deck = screen.getByRole("region", { name: "Selected work cards" });
    expect(deck.style.getPropertyValue("--stack-scale-step")).toBe("0.08");
    expect(deck.style.getPropertyValue("--stack-offset-step")).toBe("22px");
    fireEvent.click(screen.getByRole("button", { name: "Next project" }));
    expect(screen.getByRole("heading", { name: "Second project" })).toBeVisible();
    expect(screen.getByRole("link", { name: /查看项目链接/ })).toHaveAttribute("href", "https://github.com/example/repo");
    expect(screen.queryByText("https://github.com/example/repo")).not.toBeInTheDocument();
    expect(screen.getByText("完整说明请查看项目详情")).toBeVisible();
    fireEvent.keyDown(deck, { key: "ArrowLeft" });
    expect(screen.getByRole("heading", { name: longTitle })).toBeVisible();
    rerender(<StackedCards {...props} scaleStep={0.2} offsetStep={40} />);
    expect(deck.style.getPropertyValue("--stack-scale-step")).toBe("0.2");
    expect(deck.style.getPropertyValue("--stack-offset-step")).toBe("40px");
  });

  it("lets touch readers control selection instead of forcing autoplay", () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
    try {
      render(<StackedCards {...props} autoPlay />);
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByRole("heading", { name: longTitle })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Next project" }));
      expect(screen.getByRole("heading", { name: "Second project" })).toBeVisible();
    } finally {
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
      vi.useRealTimers();
    }
  });

  it("keeps the active project stable when reduced motion is preferred", () => {
    vi.useFakeTimers();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    try {
      render(<StackedCards {...props} autoPlay />);
      act(() => vi.advanceTimersByTime(12_000));
      expect(screen.getByRole("heading", { name: longTitle })).toBeVisible();
      expect((screen.getByRole("article") as HTMLElement).style.transform).toBe("");
      fireEvent.click(screen.getByRole("button", { name: "Next project" }));
      expect(screen.getByRole("heading", { name: "Second project" })).toBeVisible();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
      vi.useRealTimers();
    }
  });

  it("handles zero and one project without inaccessible controls", () => {
    const { rerender } = render(<StackedCards {...props} cards={[]} />);
    expect(screen.getByText("暂无项目内容")).toBeVisible();
    rerender(<StackedCards {...props} cards={[cards[0]]} />);
    expect(screen.getByRole("heading", { name: longTitle })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Next project" })).not.toBeInTheDocument();
  });

  it("shows a real project image and a full-image disclosure", () => {
    const image = "data:image/png;base64,BBBB";
    render(<StackedCards {...props} cards={[{ ...cards[0], image }]} />);
    expect(screen.getByRole("img", { name: longTitle })).toHaveAttribute("src", image);
    fireEvent.click(screen.getByText("查看完整图片"));
    expect(screen.getByText("查看完整图片").closest("details")).toHaveAttribute("open");
  });
});
