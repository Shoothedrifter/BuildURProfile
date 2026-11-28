import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DesignConfigV4, ResumeContent, ResumeFact, ResumeModuleKindV2, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import { resumeDisplayContent } from "../../../../packages/contracts/src/resume-v2.mjs";
import { templateToConfig } from "../../../../packages/skills/src/mapping";
import { buildWarmMacaronModel } from "../lib/warmMacaron";
import { macaronAddressFromLocation, macaronAddressHref } from "./WarmMacaronModals";
import { WarmMacaronPage } from "./WarmMacaronPage";

type Item = StructuredResumeV3["sections"][number]["items"][number];
type Section = StructuredResumeV3["sections"][number];

function item(itemId: string, title: string, details = "", facts: readonly ResumeFact[] = [], overrides: Partial<Item> = {}): Item {
  return { itemId, order: 0, title, details, facts, supplement: { text: "", links: [], images: [] }, ...overrides };
}

function section(kind: ResumeModuleKindV2, order: number, items: readonly Item[]): Section {
  return { kind, order, items };
}

/** 模态合成简历：联系字段、可点内容图、全要素项目卡与三图展示卡各就各位。 */
const identity = section("basicInfo", 0, [item("identity", "", "", [
  { key: "name", label: "姓名", value: "林予安" },
  { key: "email", label: "邮箱", value: "lin@example.test" },
  { key: "phone", label: "电话", value: "+86 138 0000 0000" }
])]);

const fullResume: readonly Section[] = [
  identity,
  section("skills", 1, [item("skill-1", "产品体验设计", "用户研究 / 信息架构")]),
  section("education", 2, [item("edu-1", "视觉传达设计", "关注交互系统与信息设计。", [
    { key: "dateRange", label: "在校时间", value: "2023.09 - 2027.06" },
    { key: "degree", label: "学历", value: "艺术学本科" }
  ], { supplement: { text: "", links: [], images: [
    { imageId: "img-edu-2a", caption: "交换校园" },
    { imageId: "img-edu-2b", caption: "课堂" }
  ] } })]),
  section("projects", 3, [item("proj-1", "城市通勤服务", "项目背景：换乘信息分散。\n交付：路线比较原型。", [
    { key: "dateRange", label: "项目时间", value: "2024.03 - 2024.08" },
    { key: "role", label: "项目角色", value: "用户研究" }
  ], { supplement: {
    text: "补充说明：覆盖三类通勤场景。",
    links: [
      { label: "项目链接", url: "https://example.com/commute" },
      { label: "危险入口", url: "javascript:alert(1)" }
    ],
    images: [{ imageId: "img-proj-1", caption: "通勤原型" }, { imageId: "img-proj-2", caption: "换乘流程" }]
  } })]),
  section("campusExperience", 4, [item("campus-1", "设计协会", "组织校园工作坊。", [], { supplement: { text: "", links: [], images: [
    { imageId: "img-campus-1", caption: "工作坊现场" },
    { imageId: "img-campus-2", caption: "社团展览" },
    { imageId: "img-campus-3", caption: "成员合影" }
  ] } })])
];

function makeConfig(sections: readonly Section[] = fullResume): DesignConfigV4 {
  const resume: StructuredResumeV3 = { version: "resume-v3", sections: [...sections] };
  return {
    ...templateToConfig("warm-macaron-v1", "ui-ux-designer"),
    content: { ...resumeDisplayContent(resume) as ResumeContent, resume }
  };
}

const resolveImage = (imageId: string) => `/media/${imageId}`;

/** 三图展示卡的当前轮播图源：轮播正文区只呈现一张大图。 */
function carouselImage(dialog: HTMLElement): string {
  return within(dialog).getByRole("img").getAttribute("src")!;
}

it("opens the lightbox from a content image with its caption and closes via overlay and Escape", () => {
  render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  const trigger = screen.getByRole("button", { name: "课堂" });
  // jsdom 的 fireEvent 不模拟点击聚焦：真实浏览器点击即聚焦，这里显式对齐后再触发。
  trigger.focus();

  fireEvent.click(trigger);
  const lightbox = screen.getByRole("dialog", { name: "课堂" });
  expect(lightbox).toHaveAttribute("aria-modal", "true");
  expect(within(lightbox).getByRole("img", { name: "课堂" })).toHaveAttribute("src", "/media/img-edu-2b");
  expect(within(lightbox).getByText("课堂")).toBeVisible();
  // 打开即锁正文滚动，焦点移入模态的关闭按钮。
  expect(document.body.style.overflow).toBe("hidden");
  expect(within(lightbox).getByRole("button", { name: "关闭图片预览" })).toHaveFocus();

  // 点击遮罩关闭：焦点回到触发图片的按钮，正文滚动解锁。
  fireEvent.click(lightbox);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe("");

  // Escape 同样可关。
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("dialog", { name: "课堂" }), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});

it("renders the project detail as title, gallery, body then links and nests the lightbox dismissal", () => {
  render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  const open = screen.getByRole("button", { name: "了解详情 →" });
  open.focus();
  fireEvent.click(open);

  const dialog = screen.getByRole("dialog", { name: "城市通勤服务" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(within(dialog).getByRole("button", { name: "关闭详情" })).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");
  // 「标题与元数据 → 图画廊 → 正文 → 外部链接」的阅读顺序。
  const ordered = [
    within(dialog).getByRole("heading", { name: "城市通勤服务" }),
    within(dialog).getByText("2024.03 - 2024.08"),
    within(dialog).getByRole("button", { name: "放大查看 通勤原型" }),
    within(dialog).getByText("项目背景：换乘信息分散。"),
    within(dialog).getByText("补充说明：覆盖三类通勤场景。"),
    within(dialog).getByRole("link", { name: "项目链接" })
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    expect(ordered[index - 1].compareDocumentPosition(ordered[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }

  // 详情内点图升级为灯箱：两个模态同时在场，Escape 只关灯箱，详情保留。
  const galleryButton = within(dialog).getByRole("button", { name: "放大查看 换乘流程" });
  galleryButton.focus();
  fireEvent.click(galleryButton);
  const lightbox = screen.getByRole("dialog", { name: "换乘流程" });
  expect(within(lightbox).getByRole("img")).toHaveAttribute("src", "/media/img-proj-2");
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  fireEvent.keyDown(lightbox, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "换乘流程" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "城市通勤服务" })).toBeTruthy();
  // 灯箱关闭后焦点回到画廊图，正文滚动仍被详情锁住。
  expect(galleryButton).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");

  // 关闭详情：解锁正文滚动并恢复触发按钮焦点。
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭详情" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("");
  expect(open).toHaveFocus();
});

it("keeps malicious external links out of the detail modal and hardens safe ones", () => {
  render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  fireEvent.click(screen.getByRole("button", { name: "了解详情 →" }));
  const dialog = screen.getByRole("dialog", { name: "城市通勤服务" });
  // 投影层已滤掉 javascript: 伪协议链接；保留的链接经 noopener 新窗口打开。
  expect(within(dialog).queryByText("危险入口")).toBeNull();
  const link = within(dialog).getByRole("link", { name: "项目链接" });
  expect(link).toHaveAttribute("href", "https://example.com/commute");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

it("drives the showcase carousel via buttons, dots and arrow keys with wrapping", () => {
  render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  const open = screen.getByRole("button", { name: "查看作品 →" });
  open.focus();
  fireEvent.click(open);
  const dialog = screen.getByRole("dialog", { name: "设计协会" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(carouselImage(dialog)).toBe("/media/img-campus-1");
  expect(document.body.style.overflow).toBe("hidden");

  // 下一张按钮前进，圆点指示器反映当前位置。
  fireEvent.click(within(dialog).getByRole("button", { name: "下一张" }));
  expect(carouselImage(dialog)).toBe("/media/img-campus-2");
  expect(within(dialog).getByRole("button", { name: "第 2 张，共 3 张" })).toHaveAttribute("aria-current", "true");

  // 方向键左右切换，末尾循环回到首张。
  fireEvent.keyDown(dialog, { key: "ArrowRight" });
  expect(carouselImage(dialog)).toBe("/media/img-campus-3");
  fireEvent.keyDown(dialog, { key: "ArrowRight" });
  expect(carouselImage(dialog)).toBe("/media/img-campus-1");
  // 首张再向左循环到末张。
  fireEvent.keyDown(dialog, { key: "ArrowLeft" });
  expect(carouselImage(dialog)).toBe("/media/img-campus-3");
  fireEvent.keyDown(dialog, { key: "ArrowLeft" });
  expect(carouselImage(dialog)).toBe("/media/img-campus-2");

  // 圆点直达任意一张。
  fireEvent.click(within(dialog).getByRole("button", { name: "第 1 张，共 3 张" }));
  expect(carouselImage(dialog)).toBe("/media/img-campus-1");

  // Escape 关闭轮播并恢复触发焦点。
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(open).toHaveFocus();
  expect(document.body.style.overflow).toBe("");
});

it("renders only confirmed contact fields in the contact card", () => {
  const first = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  const contactButton = screen.getByRole("button", { name: "联系我" });
  contactButton.focus();
  fireEvent.click(contactButton);
  const dialog = screen.getByRole("dialog", { name: "联系方式" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(within(dialog).getByRole("link", { name: "lin@example.test" })).toHaveAttribute("href", "mailto:lin@example.test");
  expect(within(dialog).getByRole("link", { name: "+86 138 0000 0000" })).toHaveAttribute("href", "tel:+8613800000000");
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭联系方式" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(contactButton).toHaveFocus();
  first.unmount();

  // 未公开电话的简历：联系卡不渲染电话行，空字段不出场。
  const noPhone = [section("basicInfo", 0, [item("identity", "", "", [
    { key: "name", label: "姓名", value: "林予安" },
    { key: "email", label: "邮箱", value: "lin@example.test" }
  ])]), ...fullResume.slice(1, 2), fullResume[4]];
  render(<WarmMacaronPage config={makeConfig(noPhone)} resolveResumeImage={resolveImage} />);
  fireEvent.click(screen.getByRole("button", { name: "联系我" }));
  const card = screen.getByRole("dialog", { name: "联系方式" });
  expect(within(card).getByRole("link", { name: "lin@example.test" })).toBeVisible();
  expect(within(card).queryByText("电话")).toBeNull();
  expect(within(card).queryByRole("link", { name: /0000/ })).toBeNull();
});

it("loads share deep links to the matching section and detail, then clears the case param on close", () => {
  const history = window.location.href;
  const token = "x".repeat(43);
  try {
    // 项目深链：定位项目经历并直接打开详情模态。
    window.history.replaceState(null, "", `/?section=projects&case=proj-1#share=${token}`);
    const first = render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} preserveShareHash />);
    const dialog = screen.getByRole("dialog", { name: "城市通勤服务" });
    expect(screen.getByRole("link", { name: "项目经历" })).toHaveAttribute("aria-current", "location");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭详情" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // 关闭后清理条目参数：区块定位与分享令牌原样保留。
    expect(location.search).toBe("?section=projects");
    expect(location.hash).toBe(`#share=${token}`);
    first.unmount();

    // 展示深链：定位展示区并打开轮播模态。
    window.history.replaceState(null, "", `/?section=showcase&case=campus-1#share=${token}`);
    render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} preserveShareHash />);
    expect(screen.getByRole("dialog", { name: "设计协会" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "展示区" })).toHaveAttribute("aria-current", "location");
  } finally {
    window.history.replaceState(null, "", history);
  }
});

it("falls back to the section when a deep-linked case is unknown", () => {
  const history = window.location.href;
  const token = "y".repeat(43);
  try {
    window.history.replaceState(null, "", `/?section=showcase&case=missing#share=${token}`);
    render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} preserveShareHash />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("link", { name: "展示区" })).toHaveAttribute("aria-current", "location");
  } finally {
    window.history.replaceState(null, "", history);
  }
});

it("writes the address when opening details locally and goes back on close in share mode", () => {
  const history = window.location.href;
  const token = "z".repeat(43);
  try {
    window.history.replaceState(null, "", `/#share=${token}`);
    render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} preserveShareHash />);
    const open = screen.getByRole("button", { name: "了解详情 →" });
    fireEvent.click(open);
    expect(location.search).toBe("?section=projects&case=proj-1");
    expect(location.hash).toBe(`#share=${token}`);
    const caseHistory = window.history.state;

    // 浏览器后退离开详情：地址同步回列表，模态关闭。
    window.history.replaceState(null, "", `/#share=${token}`);
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.queryByRole("dialog")).toBeNull();

    // 前进回到详情：模态重新打开且不重置滚动定位。
    window.history.replaceState(caseHistory, "", `/?section=projects&case=proj-1#share=${token}`);
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByRole("dialog", { name: "城市通勤服务" })).toBeTruthy();

    // 从列表打开的详情关闭时走历史回退而不是改写地址。
    const goBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
    try {
      fireEvent.click(within(screen.getByRole("dialog", { name: "城市通勤服务" })).getByRole("button", { name: "关闭详情" }));
      expect(goBack).toHaveBeenCalledOnce();
    } finally {
      goBack.mockRestore();
    }
  } finally {
    window.history.replaceState(null, "", history);
  }
});

it("keeps the preview URL untouched while modals open and close", () => {
  const before = window.location.href;
  render(<WarmMacaronPage config={makeConfig()} resolveResumeImage={resolveImage} />);
  fireEvent.click(screen.getByRole("button", { name: "了解详情 →" }));
  expect(screen.getByRole("dialog", { name: "城市通勤服务" })).toBeTruthy();
  expect(window.location.href).toBe(before);
  fireEvent.click(within(screen.getByRole("dialog", { name: "城市通勤服务" })).getByRole("button", { name: "关闭详情" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(window.location.href).toBe(before);
});

it("generates offline and share addresses as pure functions", () => {
  const model = buildWarmMacaronModel(makeConfig());
  const asLocation = (patch: Partial<Location>): Location => ({ ...window.location, ...patch }) as Location;

  // 离线导出片段锚点：区块直达与条目直达（条目 ID 编码）。
  expect(macaronAddressHref({ sectionId: "education" }, "export")).toBe("#education");
  expect(macaronAddressHref({ sectionId: "showcase", caseId: "campus 1" }, "export")).toBe("#case=campus%201");
  // 分享地址：查询参数承载区块与条目，未知参数保留、分享令牌不动。
  const share = asLocation({ pathname: "/p/", search: "?section=projects&case=proj-1", hash: "#share=t" });
  expect(macaronAddressHref({ sectionId: "about" }, "share", share)).toBe("/p/#share=t");
  expect(macaronAddressHref({ sectionId: "skills" }, "share", share)).toBe("/p/?section=skills#share=t");
  expect(macaronAddressHref({ sectionId: "showcase", caseId: "campus-1" }, "share",
    asLocation({ pathname: "/p/", search: "?x=1", hash: "#share=t" }))).toBe("/p/?x=1&section=showcase&case=campus-1#share=t");

  // 地址读取：条目属主区块优先于 section 参数，未知条目回到所在区块，无效区块回落首屏。
  expect(macaronAddressFromLocation(model, "share", asLocation({ search: "?section=projects&case=proj-1", hash: "" })))
    .toEqual({ sectionId: "projects", caseId: "proj-1" });
  expect(macaronAddressFromLocation(model, "share", asLocation({ search: "?section=skills&case=campus-1", hash: "" })))
    .toEqual({ sectionId: "showcase", caseId: "campus-1" });
  expect(macaronAddressFromLocation(model, "share", asLocation({ search: "?section=showcase&case=missing", hash: "" })))
    .toEqual({ sectionId: "showcase" });
  // 单图展示卡不构成轮播直达目标：视为未知条目回到所在区块。
  const singleImage = makeConfig([
    identity,
    section("campusExperience", 1, [item("campus-single", "广播站", "负责午间栏目。", [], {
      supplement: { text: "", links: [], images: [{ imageId: "img-single", caption: "直播间" }] }
    })])
  ]);
  const singleModel = buildWarmMacaronModel(singleImage);
  expect(macaronAddressFromLocation(singleModel, "share", asLocation({ search: "?section=showcase&case=campus-single", hash: "" })))
    .toEqual({ sectionId: "showcase" });
  expect(macaronAddressFromLocation(singleModel, "export", asLocation({ search: "", hash: "#case=campus-single" })))
    .toEqual({ sectionId: "projects" });
  expect(macaronAddressFromLocation(model, "share", asLocation({ search: "", hash: "" }))).toEqual({ sectionId: "about" });
  expect(macaronAddressFromLocation(model, "share", asLocation({ search: "?section=bogus", hash: "" }))).toEqual({ sectionId: "about" });
  // 离线片段读取：#case= 直达条目，#<section> 直达区块。
  expect(macaronAddressFromLocation(model, "export", asLocation({ search: "", hash: "#case=campus-1" })))
    .toEqual({ sectionId: "showcase", caseId: "campus-1" });
  expect(macaronAddressFromLocation(model, "export", asLocation({ search: "", hash: "#education" })))
    .toEqual({ sectionId: "education" });
  expect(macaronAddressFromLocation(model, "export", asLocation({ search: "", hash: "" }))).toEqual({ sectionId: "about" });
});

it("locks the modal layout guardrails of the macaron stylesheet", () => {
  const cssPath = ["apps/web/src/components/WarmMacaronPage.css", "src/components/WarmMacaronPage.css"]
    .map(candidate => resolve(process.cwd(), candidate))
    .find(candidate => existsSync(candidate))!;
  const css = readFileSync(cssPath, "utf8");
  // 模态遮罩：半透明加模糊（导航与模态遮罩使用半透明加模糊）。
  expect(css).toMatch(/\.warm-macaron :is\(\.macaron-case, \.macaron-lightbox\)::backdrop[^{]*\{[^}]*backdrop-filter/s);
  // 灯箱大图居中呈现。
  expect(css).toMatch(/\.warm-macaron \.macaron-lightbox[^{]*\{[^}]*place-items/s);
  // 轮播主图保留原比例。
  expect(css).toMatch(/\.warm-macaron \.macaron-carousel-figure img[^{]*\{[^}]*object-fit\s*:\s*contain/s);
});
