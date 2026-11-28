import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LaunchPage } from "./LaunchPage";

vi.mock("./DemoWorkbench", () => ({ DemoWorkbench: () => <section id="editor" /> }));

function renderLaunchPage() {
  const actions = { onProjects: vi.fn(), onSample: vi.fn(), onLegacyParse: vi.fn() };
  return { ...render(<LaunchPage projectCount={2} {...actions} />), actions };
}

describe("LaunchPage", () => {
  it("links each homepage control to its section and routes uploads to the standalone page", () => {
    const { container, actions } = renderLaunchPage();
    expect(screen.getByRole("heading", { name: /你的经历.*值得被看见/ })).toBeInTheDocument();

    const destinations = [
      ["了解功能", "write"],
      ["作品集样例", "design"],
      ["预览与编辑", "editor"],
      ["返回 BuildURProfile 首页顶部", "intro"]
    ];
    for (const [label, anchor] of destinations) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", '#' + anchor);
      expect(container.querySelector('#' + anchor)).toBeInTheDocument();
    }
    // 上传不再是首页内嵌锚点，而是跳转独立步骤页
    expect(screen.getByRole("link", { name: "开始制作 →" })).toHaveAttribute("href", "/upload");
    expect(screen.getByRole("link", { name: "上传简历，免费开始" })).toHaveAttribute("href", "/upload");
    expect(screen.queryByText(/将 PDF 拖到这里/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传并解析简历" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看完整作品集样例" }));
    expect(actions.onSample).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "我的项目，共 2 个" }));
    expect(actions.onProjects).toHaveBeenCalledOnce();
    // 兼容入口保留在页脚
    fireEvent.click(screen.getByRole("button", { name: "使用浏览器解析（兼容）" }));
    expect(actions.onLegacyParse).toHaveBeenCalledOnce();
  });

  it("accepts or keeps the sample text and restores both versions on undo", () => {
    renderLaunchPage();
    const scene = within(screen.getByRole("region", { name: /把经历.*讲清楚/ }));
    const original = /负责通勤产品的用户研究/;
    const rewrite = /通过站点访谈与换乘任务测试/;
    fireEvent.click(scene.getByRole("button", { name: "接受建议" }));
    expect(scene.queryByText(original)).not.toBeInTheDocument();
    expect(scene.getByText(rewrite)).toBeInTheDocument();
    expect(scene.getByRole("status")).toHaveTextContent("已接受建议");

    fireEvent.click(scene.getByRole("button", { name: "保留原文" }));
    expect(scene.getByText(original)).toBeInTheDocument();
    expect(scene.queryByText(rewrite)).not.toBeInTheDocument();
    fireEvent.click(scene.getByRole("button", { name: "撤销" }));
    expect(scene.getByText(original)).toBeInTheDocument();
    expect(scene.getByText(rewrite)).toBeInTheDocument();
    expect(scene.getByRole("status")).toHaveTextContent("已撤销选择");
  });

  it("changes the comparison reveal and selects one of the five templates", () => {
    const { container } = renderLaunchPage();
    const scene = within(screen.getByRole("region", { name: /同一份经历.*你的表达/ }));
    expect(scene.getAllByRole("button", { pressed: false })).toHaveLength(4);
    const pixel = scene.getByRole("button", { name: "像素世界风" });
    fireEvent.click(pixel);
    expect(pixel).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector('.journey-comparison-overlay .journey-sheet')).toHaveAttribute("data-template", "pixel-world-v1");

    fireEvent.change(scene.getByRole("slider", { name: "样式对比滑杆" }), { target: { value: "30" } });
    expect(container.querySelector(".journey-divider")).toHaveStyle("left:30%");
  });

  it("defaults the comparison scene to warm macaron", () => {
    const { container } = renderLaunchPage();
    const scene = within(screen.getByRole("region", { name: /同一份经历.*你的表达/ }));
    expect(scene.getByRole("button", { name: "暖调马卡龙" })).toHaveAttribute("aria-pressed", "true");
    expect(scene.queryByRole("button", { name: "温暖创意" })).not.toBeInTheDocument();
    expect(container.querySelector(".journey-comparison-overlay .journey-sheet"))
      .toHaveAttribute("data-template", "warm-macaron-v1");
  });

  it("toggles the evidence magnifier's pinned state", () => {
    renderLaunchPage();
    const control = screen.getByRole("button", { name: "固定放大镜" });
    expect(control).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-pressed", "false");
  });
});
