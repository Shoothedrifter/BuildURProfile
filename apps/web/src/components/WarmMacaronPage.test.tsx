import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DesignConfigV4, HeroPhoto, ResumeContent, ResumeFact, ResumeModuleKindV2, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import { resumeDisplayContent } from "../../../../packages/contracts/src/resume-v2.mjs";
import { templateToConfig } from "../../../../packages/skills/src/mapping";
import { WarmMacaronPage } from "./WarmMacaronPage";

type Item = StructuredResumeV3["sections"][number]["items"][number];
type Section = StructuredResumeV3["sections"][number];

function item(itemId: string, title: string, details = "", facts: readonly ResumeFact[] = []): Item {
  return { itemId, order: 0, title, details, facts, supplement: { text: "", links: [], images: [] } };
}

function section(kind: ResumeModuleKindV2, order: number, items: readonly Item[]): Section {
  return { kind, order, items };
}

/** 合成简历：身份与公开联系在 basicInfo，求职岗位在 jobIntent，自述与四类内容模块各一条。 */
const identity = section("basicInfo", 0, [item("identity", "", "", [
  { key: "name", label: "姓名", value: "林予安" },
  { key: "email", label: "邮箱", value: "lin@example.test" },
  { key: "phone", label: "电话", value: "+86 138 0000 0000" }
])]);

const fullResume: readonly Section[] = [
  identity,
  section("jobIntent", 8, [item("intent", "", "", [{ key: "targetRole", label: "目标岗位", value: "产品体验设计师" }])]),
  section("selfEvaluation", 9, [item("self-1", "自我评价", "用设计让复杂变简单。\n关注无障碍与信息层次。")]),
  section("skills", 1, [item("skill-1", "产品体验设计", "用户研究 / 信息架构")]),
  section("workExperience", 2, [item("work-1", "内容平台设计组", "负责组件库建设。")]),
  section("education", 3, [item("edu-1", "视觉传达设计", "关注交互系统与信息设计。")]),
  section("projects", 4, [item("proj-1", "城市通勤服务", "路线比较原型。")])
];

function makeConfig(sections: readonly Section[] = fullResume, heroPhoto?: HeroPhoto): DesignConfigV4 {
  const resume: StructuredResumeV3 = { version: "resume-v3", sections: [...sections] };
  const mapped = templateToConfig("warm-macaron-v1", "ui-ux-designer");
  return {
    ...mapped,
    content: { ...resumeDisplayContent(resume) as ResumeContent, resume },
    ...(heroPhoto ? { heroPhoto } : {})
  };
}

const resolveImage = () => "/media/synthetic";

it("loads the macaron layout and portrait styles without the app-wide stylesheet", () => {
  const { container } = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  const root = container.querySelector<HTMLElement>(".warm-macaron")!;
  const hero = container.querySelector<HTMLElement>(".macaron-hero-inner")!;
  const portrait = container.querySelector<HTMLImageElement>(".macaron-photo-frame img")!;
  expect(getComputedStyle(root).backgroundAttachment).toBe("fixed");
  expect(getComputedStyle(hero).display).toBe("grid");
  expect(getComputedStyle(portrait).objectFit).toBe("cover");
});

it("renders the hero identity, intro box and confirmed contact entry", () => {
  const { container } = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  expect(screen.getByText("Hi，")).toBeVisible();
  expect(screen.getByRole("heading", { level: 1, name: "林予安" })).toBeVisible();
  expect(screen.getByText("产品体验设计师")).toBeVisible();
  expect(screen.getByText("用设计让复杂变简单。")).toBeVisible();
  // 联系入口是联系卡模态的触发按钮，mailto 本身进入联系卡。
  expect(screen.getByRole("button", { name: "联系我" })).toBeVisible();
  // 相框容器存在；未上传照片时渲染原创默认形象（spec：非真人、非 Wibi 资源）。
  expect(container.querySelector(".macaron-photo-frame")).not.toBeNull();
  expect(container.querySelector(".macaron-photo-frame img")).toHaveAttribute("src", "/warm-macaron-default.svg");
  expect(container.querySelector(".macaron-photo-frame img")).toHaveAttribute("alt", "林予安的默认形象");
});

it("omits the contact button when no public contact is confirmed", () => {
  const sections = [
    section("basicInfo", 0, [item("identity", "", "", [{ key: "name", label: "姓名", value: "林予安" }])]),
    section("skills", 1, [item("skill-1", "产品体验设计", "用户研究")])
  ];
  render(<WarmMacaronPage config={makeConfig(sections)} resolveResumeImage={resolveImage} />);
  expect(screen.queryByRole("button", { name: "联系我" })).toBeNull();
});

it("mirrors the rendered sections in the fixed nav", () => {
  render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  const nav = screen.getByRole("navigation", { name: "作品集导航" });
  expect(within(nav).getAllByRole("link").map(link => [link.textContent, link.getAttribute("href")])).toEqual([
    ["关于我", "#about"],
    ["个人技能", "#skills"],
    ["工作/实习", "#workExperience"],
    ["教育背景", "#education"],
    ["项目经历", "#projects"]
  ]);
});

it("carries query params and the share token through navigation anchors in share mode", () => {
  const history = window.location.href;
  const token = "x".repeat(43);
  window.history.replaceState(null, "", `/#share=${token}`);
  try {
    render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} preserveShareHash />);
    // 品牌与固定导航的锚点携带 ?section= 与 #share= 令牌：修饰键/中键回落浏览器默认行为也不丢令牌。
    expect(screen.getByRole("link", { name: "林予安" })).toHaveAttribute("href", `/#share=${token}`);
    const nav = screen.getByRole("navigation", { name: "作品集导航" });
    expect(within(nav).getByRole("link", { name: "项目经历" })).toHaveAttribute("href", `/?section=projects#share=${token}`);
    // 「继续下滑」锚点同样走查询参数。
    expect(screen.getAllByRole("link", { name: "继续下滑，探索更多" }).map(link => link.getAttribute("href"))).toEqual([
      `/?section=skills#share=${token}`,
      `/?section=workExperience#share=${token}`,
      `/?section=education#share=${token}`,
      `/?section=projects#share=${token}`
    ]);
    // 普通点击接管导航：写入 ?section= 并保留令牌。
    fireEvent.click(within(nav).getByRole("link", { name: "项目经历" }));
    expect(location.search).toBe("?section=projects");
    expect(location.hash).toBe(`#share=${token}`);
  } finally {
    window.history.replaceState(null, "", history);
  }
});

it("keeps the page standing with an empty section model", () => {
  render(<WarmMacaronPage config={makeConfig([identity])} resolveResumeImage={resolveImage} />);
  expect(screen.getByRole("heading", { level: 1, name: "林予安" })).toBeVisible();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.queryByRole("link", { name: "继续下滑，探索更多" })).toBeNull();
});

it("highlights the current section while scrolling", () => {
  const { container } = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  const panes = new Map(Array.from(container.querySelectorAll<HTMLElement>("[data-macaron-section]"),
    pane => [pane.dataset.macaronSection ?? "", pane]));
  const setTop = (pane: HTMLElement, top: number) =>
    Object.defineProperty(pane, "getBoundingClientRect", { configurable: true, value: () => ({ top }) as DOMRect });

  setTop(panes.get("about")!, 0);
  for (const [id, pane] of panes) if (id !== "about") setTop(pane, 4000);
  fireEvent(window, new Event("scroll"));
  expect(screen.getByRole("link", { name: "关于我" })).toHaveAttribute("aria-current", "location");
  expect(screen.getByRole("link", { name: "教育背景" })).not.toHaveAttribute("aria-current");

  setTop(panes.get("education")!, 120);
  fireEvent(window, new Event("scroll"));
  expect(screen.getByRole("link", { name: "教育背景" })).toHaveAttribute("aria-current", "location");
  expect(screen.getByRole("link", { name: "关于我" })).not.toHaveAttribute("aria-current");
});

it("steps to the next act and stops at the last", () => {
  const { container } = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  const nexts = screen.getAllByRole("link", { name: "继续下滑，探索更多" });
  expect(nexts.map(link => link.getAttribute("href"))).toEqual(["#skills", "#workExperience", "#education", "#projects"]);
  const projectsPane = container.querySelector('[data-macaron-section="projects"]') as HTMLElement;
  expect(within(projectsPane).queryByRole("link", { name: "继续下滑，探索更多" })).toBeNull();

  const scrollIntoView = vi.fn();
  Object.defineProperty(container.querySelector('[data-macaron-section="skills"]'), "scrollIntoView",
    { configurable: true, value: scrollIntoView });
  fireEvent.click(nexts[0]);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  expect(screen.getByRole("heading", { level: 2, name: "个人技能" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "个人技能" })).toHaveAttribute("aria-current", "location");
});

it("leaves bubble animation to the stylesheet in preview mode", () => {
  const { container } = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  expect(container.querySelector<HTMLElement>(".macaron-bubbles i")!.style.animation).toBe("");
  const scrollIntoView = vi.fn();
  Object.defineProperty(container.querySelector('[data-macaron-section="skills"]'), "scrollIntoView",
    { configurable: true, value: scrollIntoView });
  fireEvent.click(screen.getAllByRole("link", { name: "继续下滑，探索更多" })[0]);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
});

it("keeps decorations and instant scrolling still under reduced motion", () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("prefers-reduced-motion"), media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn()
  })));
  try {
    const { container } = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
    const bubbles = Array.from(container.querySelectorAll<HTMLElement>(".macaron-bubbles i"));
    expect(bubbles.length).toBeGreaterThan(0);
    for (const bubble of bubbles) expect(bubble).toHaveStyle({ animation: "none" });
    const scrollIntoView = vi.fn();
    Object.defineProperty(container.querySelector('[data-macaron-section="skills"]'), "scrollIntoView",
      { configurable: true, value: scrollIntoView });
    fireEvent.click(screen.getAllByRole("link", { name: "继续下滑，探索更多" })[0]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("freezes decorations for static decorations without touching the media query", () => {
  const { container } = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} staticDecorations />);
  expect(container.querySelector(".warm-macaron")).toHaveAttribute("data-static", "true");
  const bubbles = Array.from(container.querySelectorAll<HTMLElement>(".macaron-bubbles i"));
  expect(bubbles.length).toBeGreaterThan(0);
  for (const bubble of bubbles) expect(bubble).toHaveStyle({ animation: "none" });
});

it("prefers the hero photo and falls back to the built-in default portrait", () => {
  const photo: HeroPhoto = { assetUrl: "data:image/png;base64,eA=", alt: "林予安的照片" };
  const withPhoto = render(<WarmMacaronPage config={makeConfig(fullResume, photo)} resolveResumeImage={resolveImage} />);
  expect(screen.getByRole("img", { name: "林予安的照片" })).toHaveAttribute("src", "data:image/png;base64,eA=");
  withPhoto.unmount();

  const withDefault = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} defaultPhotoUrl="/macaron-default.svg" />);
  const img = screen.getByRole("img") as HTMLImageElement;
  expect(img).toHaveAttribute("src", "/macaron-default.svg");
  expect(img.alt).toContain("林予安");
  withDefault.unmount();

  const bare = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  expect(bare.container.querySelector(".macaron-photo-frame img")).toHaveAttribute("src", "/warm-macaron-default.svg");
  expect(bare.container.querySelector(".macaron-photo-frame img")).toHaveAttribute("alt", "林予安的默认形象");
});

it("falls back to the name template when the photo alt is blank", () => {
  const photo: HeroPhoto = { assetUrl: "data:image/png;base64,eA=", alt: "   " };
  render(<WarmMacaronPage config={makeConfig(fullResume, photo)} resolveResumeImage={resolveImage} />);
  expect(screen.getByRole("img")).toHaveAttribute("alt", "林予安的默认形象");
});

it("falls back to 设计师 when both the photo alt and the name are blank", () => {
  const sections = [
    section("basicInfo", 0, [item("identity", "", "", [
      { key: "email", label: "邮箱", value: "lin@example.test" }
    ])]),
    section("skills", 1, [item("skill-1", "产品体验设计", "用户研究")])
  ];
  const photo: HeroPhoto = { assetUrl: "data:image/png;base64,eA=", alt: "" };
  render(<WarmMacaronPage config={makeConfig(sections, photo)} resolveResumeImage={resolveImage} />);
  expect(screen.getByRole("img")).toHaveAttribute("alt", "设计师的默认形象");
});
