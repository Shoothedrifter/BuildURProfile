import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ResumeDisplayItem } from "../../../../packages/contracts/src/config";
import { CyberSkillsDrum } from "./CyberSkillsDrum";

const items: ResumeDisplayItem[] = ["界面设计", "前端开发", "三维创作"].map((title, index) => ({
  itemId: `skill-${index}`, order: index, title, details: `${title}的说明`, sourceText: `${title}的完整原文`,
  facts: [], supplement: { text: "", links: [], images: [] }
}));

describe("赛博技能滚筒", () => {
  it("selects real skills without losing their full source details", () => {
    const { container } = render(<CyberSkillsDrum items={items} animate resolveResumeImage={() => ""} />);
    fireEvent.click(screen.getByRole("button", { name: "三维创作" }));
    expect(screen.getByRole("heading", { name: "三维创作" })).toBeInTheDocument();
    expect(screen.getByText("三维创作的完整原文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "三维创作" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".cyber-skills-stage")).toHaveAttribute("aria-hidden", "true");
  });
  it("keeps all skills selectable with motion disabled and handles empty or single skills", () => {
    const { container, rerender } = render(<CyberSkillsDrum items={items} animate={false} resolveResumeImage={() => ""} />);
    expect(container.querySelector(".cyber-skills-stage")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "前端开发" }));
    expect(screen.getByText("前端开发的说明")).toBeInTheDocument();
    rerender(<CyberSkillsDrum items={items.slice(0, 1)} animate resolveResumeImage={() => ""} />);
    expect(container.querySelector(".cyber-skills-stage")).toBeNull();
    expect(screen.getByRole("button", { name: "界面设计" })).toHaveAttribute("aria-pressed", "true");
    rerender(<CyberSkillsDrum items={[]} animate resolveResumeImage={() => ""} />);
    expect(container).toBeEmptyDOMElement();
  });
});
