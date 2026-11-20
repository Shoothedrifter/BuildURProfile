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
    { key: "name", label: "姓名", value: "合成设计师" }, { key: "age", label: "年龄", value: "不公开年龄" }
  ] }]
} as const;

function config(sections: StructuredResumeV3["sections"]): DesignConfigV4 {
  const mapped = templateToConfig("pixel-world-v1", "ui-ux-designer");
  return { ...mapped, content: { ...mapped.content, resume: { version: "resume-v3", sections: [basic, ...sections] } } };
}

it("shows one continuous story with ordered project rows, skill and experience chapters", () => {
  render(<ShowcasePage config={config([
    { kind: "projects", order: 5, items: [item("second", "第二个项目", 1), item("first", "无图项目", 0), item("empty", "", 2)] },
    { kind: "skills", order: 2, items: [item("skills", "数据处理")] },
    { kind: "workExperience", order: 1, items: [{ ...item("work", "合成实习"), details: "负责交互原型",
      facts: [{ key: "date", label: "任职时间", value: "2025.06—2025.12" }] }] },
    { kind: "selfEvaluation", order: 6, items: [{ ...item("intro", ""), details: "关注产品与交互。" }] }
  ])} />);
  const main = screen.getByRole("main");
  expect(within(main).getAllByRole("heading", { level: 1 }).map(node => node.textContent)).toEqual(["合成设计师"]);
  expect(main.querySelector("#top")).toHaveTextContent("关注产品与交互。");
  expect(within(main).getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual(["关于我", "作品档案", "经历与能力"]);
  const archive = screen.getByRole("region", { name: "作品档案" });
  const rows = within(archive).getAllByRole("article");
  expect(rows.map(row => within(row).getByRole("heading").textContent)).toEqual(["无图项目", "第二个项目"]);
  expect(within(rows[0]).queryByRole("img")).toBeNull();
  expect(screen.getByText("数据处理")).toBeVisible();
  expect(screen.getByText("2025.06—2025.12")).toBeVisible();
  expect(screen.queryByText("不公开年龄")).toBeNull();
  expect(screen.queryByRole("link", { name: "联系" })).toBeNull();

  fireEvent.click(screen.getByRole("link", { name: "查看作品" }));
  expect(screen.getByRole("heading", { name: "作品档案" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "作品" })).toHaveAttribute("aria-current", "location");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("合成设计师");
});

it("opens the right project by item ID, preserves evidence and restores focus on Escape", () => {
  const selected = { ...item("second", "同名作品", 1),
    details: "背景：访客难以找到展览。\n我的职责：负责调研与原型。\n设计选择：先验证地图阅读路径。\n交付：完成可用原型。",
    sourceText: "核对通过的原始摘录",
    supplement: { text: "现场验证环节", links: [
      { label: "演示原型", url: "https://example.test/" }, { label: "危险入口", url: "javascript:alert(1)" }
    ], images: [{ imageId: "cover", caption: "完整展板" }, { imageId: "process", caption: "过程图" }] } };
  render(<ShowcasePage config={config([
    { kind: "projects", order: 1, items: [{ ...item("first", "同名作品"), details: "第一个项目摘要" }, selected] }
  ])} resolveResumeImage={id => `/media/${id}`} />);
  const rows = within(screen.getByRole("region", { name: "作品档案" })).getAllByRole("article");
  const open = within(rows[1]).getByRole("link", { name: /进入项目/ });
  fireEvent.click(open);
  const dialog = screen.getByRole("dialog", { name: "同名作品" });
  expect(within(dialog).getByRole("button", { name: "关闭项目详情" })).toHaveFocus();
  expect(within(dialog).getByRole("heading", { name: "设计选择" })).toBeVisible();
  expect(within(dialog).getByText("完成可用原型。")).toBeVisible();
  expect(within(dialog).getByText("核对通过的原始摘录")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "演示原型" })).toHaveAttribute("href", "https://example.test/");
  expect(within(dialog).queryByText("危险入口")).toBeNull();
  expect(within(dialog).queryByText("第一个项目摘要")).toBeNull();
  expect(within(dialog).getByAltText("过程图")).toHaveAttribute("src", "/media/process");
  const zoom = within(dialog).getByRole("button", { name: "放大完整展板" });
  fireEvent.click(zoom);
  expect(zoom).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(zoom, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(open).toHaveFocus();
});

it("preserves share tokens, loads deep links, and handles back and unknown project IDs", () => {
  const history = window.location.href;
  const token = "x".repeat(43);
  window.history.replaceState(null, "", `/?section=works&case=second#share=${token}`);
  try {
    const projects = { kind: "projects", order: 4, items: [item("first", "第一个项目"), item("second", "无图项目", 1)] } as const;
    const page = <ShowcasePage config={config([projects])} preserveShareHash />;
    const { unmount } = render(page);
    const dialog = screen.getByRole("dialog", { name: "无图项目" });
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭项目详情" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const open = screen.getByRole("link", { name: "进入项目 无图项目" });
    expect(open).toHaveFocus();
    expect(location.search).toBe("?section=works");
    expect(location.hash).toBe(`#share=${token}`);
    expect(open).toHaveAttribute("href", `/?section=works&case=second#share=${token}`);
    fireEvent.click(open);
    expect(location.search).toBe("?section=works&case=second");
    expect(location.hash).toBe(`#share=${token}`);
    const caseHistory = window.history.state;

    window.history.replaceState(null, "", `/?section=works#share=${token}`);
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(open).toHaveFocus();
    window.history.replaceState(caseHistory, "", `/?section=works&case=second#share=${token}`);
    fireEvent(window, new PopStateEvent("popstate"));
    const goBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
    try {
      fireEvent.click(within(screen.getByRole("dialog", { name: "无图项目" })).getByRole("button", { name: "关闭项目详情" }));
      expect(goBack).toHaveBeenCalledOnce();
      expect(location.search).toBe("?section=works&case=second");
    } finally { goBack.mockRestore(); }
    unmount();
    window.history.replaceState(null, "", `/?section=works&case=deleted#share=${token}`);
    render(page);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("link", { name: "作品" })).toHaveAttribute("aria-current", "location");
  } finally {
    window.history.replaceState(null, "", history);
  }
});

it("uses the next available chapter and keeps the preview URL isolated", () => {
  const before = location.href;
  const { rerender } = render(<ShowcasePage config={config([
    { kind: "skills", order: 2, items: [{ ...item("skill", "专业技能"), details: "设计研究与原型验证" }] }
  ])} />);
  expect(screen.queryByRole("link", { name: "作品" })).toBeNull();
  expect(screen.queryByRole("link", { name: "关于" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "查看经历" }));
  expect(screen.getByRole("heading", { name: "经历与能力" })).toHaveFocus();
  expect(location.href).toBe(before);
  expect(screen.getByText("设计研究与原型验证")).toBeVisible();
  rerender(<ShowcasePage config={config([])} />);
  expect(screen.queryByRole("navigation", { name: "作品集导航" })).toBeNull();
  expect(screen.queryByRole("link", { name: "查看经历" })).toBeNull();
});

it("handles a repeated close while the browser is still navigating back", () => {
  const history = window.location.href;
  const token = "y".repeat(43);
  window.history.replaceState(null, "", `/?section=works#share=${token}`);
  const goBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
  try {
    render(<ShowcasePage config={config([{ kind: "projects", order: 1, items: [item("project", "合成项目")] }])} preserveShareHash />);
    fireEvent.click(screen.getByRole("link", { name: "进入项目 合成项目" }));
    const close = screen.getByRole("button", { name: "关闭项目详情" });
    fireEvent.keyDown(close, { key: "Escape" });
    fireEvent.click(close);
    expect(goBack).toHaveBeenCalledTimes(1);
  } finally {
    goBack.mockRestore();
    window.history.replaceState(null, "", history);
  }
});

it("restores focus when dismissing the chapter menu", () => {
  render(<ShowcasePage config={config([{ kind: "projects", order: 1, items: [item("project", "合成项目")] }])} />);
  const menu = screen.getByRole("button", { name: "章节" });
  fireEvent.click(menu);
  const current = screen.getByRole("link", { name: "作品" });
  current.focus();
  fireEvent.keyDown(current, { key: "Escape" });
  expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(menu).toHaveFocus();
});

it("limits the project excerpt while keeping unstructured prose in the dialog", () => {
  const details = "负责原型验证与关键流程设计。".repeat(12);
  render(<ShowcasePage config={config([
    { kind: "projects", order: 1, items: [{ ...item("project", "设计项目"), details }] }
  ])} />);
  const row = within(screen.getByRole("region", { name: "作品档案" })).getByRole("article");
  const summary = row.querySelector(".pixel-project-excerpt");
  expect(summary?.textContent).toMatch(/…$/);
  expect(Array.from(summary?.textContent ?? "").length).toBeLessThanOrEqual(111);
  fireEvent.click(within(row).getByRole("link", { name: /进入项目/ }));
  expect(within(screen.getByRole("dialog")).getByText(details)).toBeVisible();
});

it("keeps line breaks in confirmed experience text without a title", () => {
  const duties = "独立完成需求文档\n参与上线评审";
  render(<ShowcasePage config={config([{ kind: "workExperience", order: 1, items: [
    { ...item("work", ""), details: `合成单位\n设计岗\n${duties}` }
  ] }])} />);
  expect(screen.getByText(/参与上线评审/).textContent).toContain(duties);
});

it("adds pixel-world decorations: speech bubble, scroll hint, chapter numbers, save slots and window lights", () => {
  render(<ShowcasePage config={config([
    { kind: "projects", order: 1, items: [item("project", "合成项目"), item("another", "第二个项目", 1)] }
  ])} />);
  // 头像对话气泡与向下滚动提示：纯装饰，对辅助技术隐藏
  const speech = document.querySelector(".pixel-speech");
  expect(speech?.getAttribute("aria-hidden")).toBe("true");
  expect(speech?.textContent).toContain("你好");
  const press = document.querySelector(".pixel-press");
  expect(press?.getAttribute("aria-hidden")).toBe("true");
  expect(press?.textContent).toContain("向下滚动");
  // 章节导航带关卡编号（起点 01，作品 02……编号对辅助技术隐藏）
  const worksLink = screen.getByRole("link", { name: "作品" });
  expect(worksLink.querySelector(".pixel-chapter-no")?.textContent).toBe("02");
  expect(worksLink.querySelector(".pixel-chapter-no")?.getAttribute("aria-hidden")).toBe("true");
  // 项目行带存档槽编号，打开链接文案进入像素语汇
  const rows = within(screen.getByRole("region", { name: "作品档案" })).getAllByRole("article");
  expect(rows[0].querySelector(".pixel-slot")?.textContent).toContain("存档 01");
  expect(rows[1].querySelector(".pixel-slot")?.textContent).toContain("存档 02");
  expect(within(rows[0]).getByRole("link", { name: /进入项目/ })).toBeVisible();
  // 项目弹窗顶栏带复古窗口灯装饰
  fireEvent.click(within(rows[0]).getByRole("link", { name: /进入项目/ }));
  const dialog = screen.getByRole("dialog", { name: "合成项目" });
  expect(dialog.querySelector(".pixel-case-lights")?.getAttribute("aria-hidden")).toBe("true");
  expect(dialog.querySelectorAll(".pixel-case-lights i")).toHaveLength(3);
});

it("reveals chapters with IntersectionObserver once they scroll into view", () => {
  const instances: { callback: IntersectionObserverCallback; targets: Element[] }[] = [];
  class FakeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) { instances.push({ callback, targets: [] }); }
    observe(target: Element) { instances.at(-1)?.targets.push(target); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  try {
    render(<ShowcasePage config={config([
      { kind: "projects", order: 1, items: [item("project", "合成项目")] }
    ])} />);
    const observer = instances[0];
    expect(observer.targets.length).toBeGreaterThan(1);
    const works = observer.targets.find(node => (node as HTMLElement).dataset.pixelChapter === "works")!;
    observer.callback([{ isIntersecting: true, target: works } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver);
    expect((works as HTMLElement).dataset.revealed).toBe("");
    // 同一区块只 reveal 一次：再次触发不重复（unobserve 已被调用则无副作用，这里验证属性稳定）
    observer.callback([{ isIntersecting: true, target: works } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver);
    expect((works as HTMLElement).dataset.revealed).toBe("");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps the reveal helper inert when IntersectionObserver is unavailable", () => {
  // jsdom 默认无 IntersectionObserver：导出态等无 JS 环境不得因缺 API 报错
  expect(() => render(<ShowcasePage config={config([
    { kind: "projects", order: 1, items: [item("project", "合成项目")] }
  ])} staticDecorations />)).not.toThrow();
});

it("applies the pixel label font to UI labels and injects the subset font once in preview", () => {
  render(<ShowcasePage config={config([
    { kind: "projects", order: 1, items: [item("project", "合成项目")] }
  ])} />);
  // 标签层使用像素字体 class：章节导航、主按钮、档案计数
  expect(screen.getByRole("link", { name: "作品" }).className).toContain("pixel-label");
  expect(screen.getByRole("link", { name: /查看作品/ }).className).toContain("pixel-label");
  expect(screen.getByText("1 个项目").className).toContain("pixel-label");
  // 预览模式注入一次子集字体样式，字符集包含姓名与标签字形
  const styleTags = Array.from(document.head.querySelectorAll("style")).filter(node => node.textContent?.includes("/api/pixel-font?text="));
  expect(styleTags).toHaveLength(1);
  expect(decodeURIComponent(styleTags[0].textContent ?? "")).toContain("合");
  expect(decodeURIComponent(styleTags[0].textContent ?? "")).toContain("起点");
  // 像素跑马灯装饰存在且对辅助技术隐藏
  const ticker = document.querySelector(".pixel-ticker");
  expect(ticker?.getAttribute("aria-hidden")).toBe("true");
});

it("skips the runtime font request for offline exports", () => {
  render(<ShowcasePage config={config([
    { kind: "projects", order: 1, items: [item("project", "合成项目")] }
  ])} staticDecorations />);
  const styleTags = Array.from(document.head.querySelectorAll("style"))
    .filter(node => node.textContent?.includes("/api/pixel-font"));
  expect(styleTags).toHaveLength(0);
});
