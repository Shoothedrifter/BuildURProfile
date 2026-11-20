import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DesignConfigV4, ResumeDisplayItem, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import { templateToConfig } from "../../../../packages/skills/src/mapping";
import { ShowcasePage } from "../ShowcasePage";

const noSupplement = { text: "", links: [], images: [] };
const item = (itemId: string, title: string, order = 0): ResumeDisplayItem & { order: number } => ({
  itemId, title, order, details: "", facts: [], supplement: noSupplement
});
const basic = {
  kind: "basicInfo", order: 0, items: [{ ...item("name", ""), facts: [
    { key: "name", label: "姓名", value: "合成开发者" }, { key: "age", label: "年龄", value: "不公开年龄" }
  ] }]
} as const;

function config(sections: StructuredResumeV3["sections"]): DesignConfigV4 {
  const mapped = templateToConfig("pixel-world-v1", "frontend-creative-developer");
  return { ...mapped, content: { ...mapped.content, resume: { version: "resume-v3", sections: [basic, ...sections] } } };
}

it("Pixel World renders confirmed projects in order without inventing content", () => {
  const project = { ...item("more", "工程架构与可观测性工具".repeat(4), 1), details: "本人负责调度\n覆盖失败重试",
    supplement: { text: "来自确认条目的补充", links: [
      { label: "GitHub", url: "https://github.com/example/demo" }, { label: "Demo", url: "https://example.test/" },
      { label: "危险入口", url: "javascript:alert(1)" }
    ], images: Array.from({ length: 6 }, (_, index) => ({ imageId: `img${index}`, caption: `验证图 ${index + 1}` })) } };
  render(<ShowcasePage config={config([
    { kind: "projects", order: 5, items: [project, item("text", "无图项目", 0), item("empty", "", 2)] },
    { kind: "skills", order: 2, items: [item("skills", "数据处理")] }
  ])} resolveResumeImage={id => `/media/${id}`} />);
  expect(screen.getByRole("heading", { level: 1, name: "合成开发者" })).toBeInTheDocument();
  const main = screen.getByRole("main");
  expect(within(main).getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual(["专业技能", "项目经历"]);
  const projects = screen.getByRole("region", { name: "项目经历" });
  expect(within(projects).getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["无图项目", project.title]);
  expect(screen.getByText(/本人负责调度/).textContent).toBe("本人负责调度\n覆盖失败重试");
  expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/example/demo");
  expect(screen.getByRole("link", { name: "Demo" })).toHaveAttribute("href", "https://example.test/");
  expect(screen.queryByText("危险入口")).toBeNull();
  expect(screen.queryByText("不公开年龄")).toBeNull();
  for (let index = 0; index < 6; index++) {
    expect(screen.getByAltText(`验证图 ${index + 1}`)).toHaveAttribute("src", `/media/img${index}`);
  }
});

it("Pixel World launch jumps to an available section without destroying the share hash", () => {
  const history = window.location.href;
  window.history.replaceState(null, "", "/#share=test");
  try {
    const skills = { kind: "skills", order: 3, items: [item("skills", "数据处理")] } as const;
    const projects = { kind: "projects", order: 4, items: [item("text", "无图项目")] } as const;
    const { rerender } = render(<ShowcasePage config={config([skills, projects])} preserveShareHash />);
    const launch = screen.getByRole("link", { name: "启航 · 查看项目" });
    expect(launch).toHaveAttribute("href", "#projects");
    const section = screen.getByRole("region", { name: "项目经历" });
    section.scrollIntoView = vi.fn();
    expect(fireEvent.click(launch)).toBe(false);
    expect(section.scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(section);
    expect(location.hash).toBe("#share=test");
    rerender(<ShowcasePage config={config([skills, { ...skills, order: 6 }])} />);
    expect(screen.getByRole("link", { name: "启航 · 浏览作品集" })).toHaveAttribute("href", "#skills");
    expect(document.querySelectorAll("#skills")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "联系我" })).toBeNull();
    rerender(<ShowcasePage config={config([])} />);
    expect(screen.queryByRole("link", { name: /启航/ })).toBeNull();
  } finally {
    window.history.replaceState(null, "", history);
  }
});

it("Pixel World keeps confirmed project and section detail text in expandable content", () => {
  render(<ShowcasePage config={config([
    { kind: "projects", order: 2, items: [{ ...item("project", "投递服务"), details: "项目摘要", sourceText: "核对通过的项目详情" }] },
    { kind: "other", order: 3, items: [{ ...item("proof", ""), sourceText: "核对通过的其他详情" }] }
  ])} />);
  const project = screen.getByRole("region", { name: "项目经历" });
  fireEvent.click(within(project).getByText("查看项目详情"));
  expect(within(project).getByText("核对通过的项目详情").closest("details")).toHaveAttribute("open");
  const other = screen.getByRole("region", { name: "其他内容" });
  fireEvent.click(within(other).getByText("查看详情"));
  expect(within(other).getByText("核对通过的其他详情")).toBeVisible();
});
