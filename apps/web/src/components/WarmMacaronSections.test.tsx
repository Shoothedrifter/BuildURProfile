import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DesignConfigV4, PresentationHighlight, ResumeContent, ResumeFact, ResumeModuleKindV2, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import { resumeDisplayContent } from "../../../../packages/contracts/src/resume-v2.mjs";
import { templateToConfig } from "../../../../packages/skills/src/mapping";
import { buildWarmMacaronModel, type WarmMacaronModel } from "../lib/warmMacaron";
import { WarmMacaronSections } from "./WarmMacaronSections";
import { WarmMacaronPage } from "./WarmMacaronPage";

type Item = StructuredResumeV3["sections"][number]["items"][number];
type Section = StructuredResumeV3["sections"][number];

function item(itemId: string, title: string, details = "", facts: readonly ResumeFact[] = [], overrides: Partial<Item> = {}): Item {
  return { itemId, order: 0, title, details, facts, supplement: { text: "", links: [], images: [] }, ...overrides };
}

function section(kind: ResumeModuleKindV2, order: number, items: readonly Item[]): Section {
  return { kind, order, items };
}

// 80+ 字超长中文标题：断言渲染层为它提供防溢出排版。
const longTitle = "跨端设计系统重构与品牌视觉语言升级以及无障碍可读性专项治理".repeat(3);

const awardHighlights: readonly PresentationHighlight[] = [
  { id: "hl-award-1", type: "award-tier", label: "奖项级别", value: "国家级", unit: "", level: "finalist" }
];

/** 全模块合成简历：五类区块各至少一条，覆盖有图/无图、多图、facts 与 highlights。 */
const fullResume: readonly Section[] = [
  section("basicInfo", 0, [item("identity", "", "", [
    { key: "name", label: "姓名", value: "林予安" },
    { key: "email", label: "邮箱", value: "lin@example.test" }
  ])]),
  section("skills", 1, [
    item("skill-1", "产品体验设计", "用户研究 / 信息架构", [
      { key: "tool", label: "工具", value: "Figma" },
      { key: "method", label: "方法", value: "卡片分类" }
    ]),
    item("skill-2", "视觉设计", "", [{ key: "tool", label: "工具", value: "Procreate" }], { order: 1 })
  ]),
  section("workExperience", 2, [item("work-1", "内容平台设计组", "负责组件库建设。\n推动设计令牌落地。", [
    { key: "dateRange", label: "任职时间", value: "2023 — 至今" },
    { key: "title", label: "职位", value: "高级设计师" }
  ], { supplement: { text: "", links: [], images: [
    { imageId: "img-work-1", caption: "工位白板" },
    { imageId: "img-work-2", caption: "组件库界面" },
    { imageId: "img-work-3", caption: "第三张不应上卡" }
  ] } })]),
  section("education", 3, [
    item("edu-1", "视觉传达设计", "关注交互系统与信息设计。", [
      { key: "dateRange", label: "在校时间", value: "2023.09 - 2027.06" },
      { key: "degree", label: "学历", value: "艺术学本科" },
      { key: "gpa", label: "GPA", value: "3.8/4.0" },
      { key: "ranking", label: "排名", value: "专业前 5%" }
    ]),
    item("edu-2", "香港大学", "交换学习一学期。", [
      { key: "dateRange", label: "在校时间", value: "2024.09 - 2025.01" }
    ], { order: 1, supplement: { text: "", links: [], images: [
      { imageId: "img-edu-2a", caption: "交换校园" },
      { imageId: "img-edu-2b", caption: "课堂" }
    ] } })
  ]),
  section("projects", 4, [
    item("proj-1", "城市通勤服务", "路线比较原型。", [
      { key: "dateRange", label: "项目时间", value: "2024.03 - 2024.08" },
      { key: "role", label: "项目角色", value: "用户研究" }
    ], { supplement: { text: "", links: [{ label: "项目链接", url: "https://example.com/commute" }], images: [
      { imageId: "img-proj-1", caption: "通勤原型" }
    ] } }),
    item("proj-2", longTitle, "长标题条目。", [], { order: 1 })
  ]),
  section("campusExperience", 5, [item("campus-1", "设计协会", "组织校园工作坊。", [], { supplement: { text: "", links: [], images: [
    { imageId: "img-campus-1", caption: "工作坊现场" },
    { imageId: "img-campus-2", caption: "社团展览" }
  ] } })]),
  section("awards", 6, [item("award-1", "校园设计奖", "决赛入围。", [
    { key: "issuer", label: "颁奖单位", value: "合成教育厅" }
  ], { order: 0, presentationHighlights: awardHighlights })])
];

function makeConfig(sections: readonly Section[]): DesignConfigV4 {
  const resume: StructuredResumeV3 = { version: "resume-v3", sections: [...sections] };
  return {
    ...templateToConfig("warm-macaron-v1", "ui-ux-designer"),
    content: { ...resumeDisplayContent(resume) as ResumeContent, resume }
  };
}

function makeModel(sections: readonly Section[] = fullResume): WarmMacaronModel {
  return buildWarmMacaronModel(makeConfig(sections));
}

const resolveImage = (imageId: string) => `/media/${imageId}`;

/** 定位某张内容卡：以三级标题为锚向上取最近的 article。 */
function cardOf(headingName: string | RegExp): HTMLElement {
  return screen.getByRole("heading", { level: 3, name: headingName }).closest("article")!;
}

it("renders education cards with school, degree line, time and highlighted metric facts", () => {
  render(<WarmMacaronSections model={makeModel()} resolveResumeImage={resolveImage} />);
  const eduPane = document.getElementById("education")!;
  const eduCard = within(eduPane).getByRole("heading", { level: 3, name: "视觉传达设计" }).closest("article")!;

  // 学校为标题，学历并入信息行（副标题），时间为独立信息行。
  expect(within(eduCard).getByText("艺术学本科").className).toContain("macaron-card-sub");
  expect(within(eduCard).getByText("2023.09 - 2027.06").className).toContain("macaron-card-time");
  // 其余 facts 构成高亮数字行：label 与 value 同现，学历不再重复出现。
  const metrics = within(eduCard).getByText("GPA").closest("dl")!;
  expect(metrics.className).toContain("macaron-facts");
  expect(within(metrics).getByText("3.8/4.0")).toBeVisible();
  expect(within(metrics).getByText("排名")).toBeVisible();
  expect(within(metrics).getByText("专业前 5%")).toBeVisible();
  expect(within(metrics).queryByText("学历")).toBeNull();
});

it("caps horizontal work cards at the first two supplement images without mutating the model", () => {
  const model = makeModel();
  const workImages = model.sections.find(section => section.id === "workExperience")!.cards[0].images;
  render(<WarmMacaronSections model={model} resolveResumeImage={resolveImage} />);

  const workCard = cardOf("内容平台设计组");
  // 横向卡：图列与文案列并列。
  expect(workCard.className).toContain("macaron-work-card");
  const media = workCard.querySelector<HTMLElement>(".macaron-work-media")!;
  expect(media).not.toBeNull();
  expect(workCard.querySelector(".macaron-card-copy")).not.toBeNull();
  // 最多前两张补充图；第三张不上卡。
  const sources = Array.from(media.querySelectorAll("img")).map(img => img.getAttribute("src"));
  expect(sources).toEqual(["/media/img-work-1", "/media/img-work-2"]);
  expect(screen.queryByText("第三张不应上卡")).toBeNull();
  // 粉点列表按段展示 details。
  const dots = workCard.querySelectorAll(".macaron-dot-list li");
  expect(Array.from(dots).map(li => li.textContent)).toEqual(["负责组件库建设。", "推动设计令牌落地。"]);
  // 渲染层不得变异共享 images 引用：仍为三张且保持原序。
  expect(model.sections.find(section => section.id === "workExperience")!.cards[0].images).toBe(workImages);
  expect(workImages.map(image => image.imageId)).toEqual(["img-work-1", "img-work-2", "img-work-3"]);
});

it("lays project cards in a two-column grid and opens the detail modal via callback", () => {
  const onOpenProject = vi.fn();
  render(<WarmMacaronSections model={makeModel()} resolveResumeImage={resolveImage} onOpenProject={onOpenProject} />);

  const projectPane = document.getElementById("projects")!;
  expect(projectPane.querySelector(".macaron-project-grid")).not.toBeNull();
  const projectCard = cardOf("城市通勤服务");
  expect(within(projectCard).getByText("路线比较原型。")).toBeVisible();
  // 「了解详情 →」把整张卡交给详情模态接管点。
  fireEvent.click(within(projectCard).getByRole("button", { name: "了解详情 →" }));
  expect(onOpenProject).toHaveBeenCalledTimes(1);
  expect(onOpenProject.mock.calls[0][0]).toMatchObject({ itemId: "proj-1", title: "城市通勤服务" });
});

it("renders showcase highlights, fact chips and the carousel entry for multi-image cards", () => {
  const onOpenShowcase = vi.fn();
  render(<WarmMacaronSections model={makeModel()} resolveResumeImage={resolveImage} onOpenShowcase={onOpenShowcase} />);

  const showcasePane = document.getElementById("showcase")!;
  // 已确认亮点（presentationHighlights）按 label/value 呈现。
  const awardCard = within(showcasePane).getByRole("heading", { level: 3, name: "校园设计奖" }).closest("article")!;
  const highlights = within(awardCard).getByText("奖项级别").closest("dl")!;
  expect(highlights.className).toContain("macaron-highlights");
  expect(within(highlights).getByText("国家级")).toBeVisible();
  // facts 渲染为 chip。
  const chips = within(awardCard).getAllByText("合成教育厅").map(node => node.closest(".macaron-chip")!);
  expect(chips).toHaveLength(1);
  // 多图展示卡提供「查看作品 →」轮播入口；单图/无图卡不提供。
  fireEvent.click(screen.getByRole("button", { name: "查看作品 →" }));
  expect(onOpenShowcase).toHaveBeenCalledTimes(1);
  expect(onOpenShowcase.mock.calls[0][0]).toMatchObject({ itemId: "campus-1", title: "设计协会" });
  expect(within(awardCard).queryByRole("button", { name: "查看作品 →" })).toBeNull();
});

it("groups skills into cards with alternating rose and sky chips, then a named copyright line", () => {
  render(<WarmMacaronSections model={makeModel()} resolveResumeImage={resolveImage} />);
  const skillsPane = document.getElementById("skills")!;

  // 每个技能条目即一个分组卡，title 为分组名。
  expect(within(skillsPane).getByRole("heading", { level: 3, name: "产品体验设计" })).toBeVisible();
  expect(within(skillsPane).getByRole("heading", { level: 3, name: "视觉设计" })).toBeVisible();
  // facts 逐项成 chip，蓝粉双色交替。
  const chips = Array.from(skillsPane.querySelectorAll(".macaron-chip"));
  expect(chips.map(chip => chip.textContent)).toEqual(["Figma", "卡片分类", "Procreate"]);
  expect(new Set(chips.map(chip => chip.getAttribute("data-tone")))).toEqual(new Set(["rose", "sky"]));
  // 区尾版权行含姓名。
  const footer = skillsPane.querySelector(".macaron-footer-line")!;
  expect(footer).not.toBeNull();
  expect(footer.textContent).toContain("©");
  expect(footer.textContent).toContain("林予安");
});

it("omits figure boxes entirely for image-less cards", () => {
  render(<WarmMacaronSections model={makeModel()} resolveResumeImage={resolveImage} />);
  for (const name of ["视觉传达设计", "校园设计奖", longTitle]) {
    const card = cardOf(name);
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector(".macaron-card-cover")).toBeNull();
    expect(card.querySelector(".macaron-work-media")).toBeNull();
  }
});

it("keeps oversized Chinese titles wrapped in break-safe card copy containers", () => {
  render(<WarmMacaronSections model={makeModel()} resolveResumeImage={resolveImage} />);
  const heading = screen.getByRole("heading", { level: 3, name: longTitle });
  // 标题与文案容器均带防溢出类（样式规则由样式合同用例锁定）。
  expect(heading.className).toContain("macaron-card-title");
  expect(heading.parentElement!.className).toContain("macaron-card-copy");
});

it("locks the layout guardrails of the macaron stylesheet", () => {
  // vitest 把 import.meta.url 映射为 vite root 下的 http 地址，样式文件按运行目录双候选定位。
  const cssPath = ["apps/web/src/styles.css", "src/styles.css"]
    .map(candidate => resolve(process.cwd(), candidate))
    .find(candidate => existsSync(candidate))!;
  const css = readFileSync(cssPath, "utf8");
  // 超长中文在卡片标题处强制折行。
  expect(css).toMatch(/\.macaron-card-title[^{]*\{[^}]*overflow-wrap\s*:\s*anywhere/s);
  // 项目卡双列。
  expect(css).toMatch(/\.macaron-project-grid[^{]*\{[^}]*grid-template-columns[^}]*repeat\(2/s);
  // 蓝系 chip 消费预留令牌 --macaron-sky-soft。
  expect(css).toMatch(/\.macaron-chip\[data-tone="sky"\][^{]*\{[^}]*--macaron-sky-soft/s);
});

it("wires every content image to the lightbox callback with resolved sources", () => {
  const onOpenImage = vi.fn();
  const wired = render(<WarmMacaronSections model={makeModel()} resolveResumeImage={resolveImage} onOpenImage={onOpenImage} />);

  const open = (alt: string) => fireEvent.click(screen.getByRole("button", { name: alt }));
  // 教育卡面与其余缩略图、工作图列、项目卡面、展示卡面均可点开灯箱，src 一律经解析器。
  open("交换校园");
  open("课堂");
  open("工位白板");
  open("通勤原型");
  open("工作坊现场");
  expect(onOpenImage.mock.calls).toEqual([
    ["/media/img-edu-2a", "交换校园"],
    ["/media/img-edu-2b", "课堂"],
    ["/media/img-work-1", "工位白板"],
    ["/media/img-proj-1", "通勤原型"],
    ["/media/img-campus-1", "工作坊现场"]
  ]);
  wired.unmount();

  // 未提供灯箱接管点时，图片退化为静态 figure，不渲染可点击外壳。
  render(<WarmMacaronSections model={makeModel()} resolveResumeImage={resolveImage} />);
  const cover = cardOf("城市通勤服务").querySelector(".macaron-card-cover")!;
  expect(cover.tagName).toBe("FIGURE");
  expect(cover.querySelector("button")).toBeNull();
});

it("mounts the sections inside the page skeleton with acts and footers intact", () => {
  render(<WarmMacaronPage config={makeConfig([...fullResume])} resolveResumeImage={resolveImage} />);
  // 骨架内的分幕容器拿到了内容卡。
  expect(document.querySelector("#education .macaron-act-body .macaron-card")).not.toBeNull();
  expect(screen.getByRole("heading", { level: 3, name: "视觉传达设计" })).toBeVisible();
  expect(document.querySelector("#skills .macaron-footer-line")).not.toBeNull();
  // 分幕节奏不受影响：首屏与每个非末区都有「继续下滑，探索更多」。
  expect(screen.getAllByRole("link", { name: "继续下滑，探索更多" })).toHaveLength(5);
});
