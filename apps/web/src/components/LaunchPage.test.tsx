import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LaunchPage } from "./LaunchPage";

const renderLaunchPage = (overrides: Partial<React.ComponentProps<typeof LaunchPage>> = {}) => {
  const props: React.ComponentProps<typeof LaunchPage> = {
    projectCount: 0,
    onProjects: vi.fn(),
    onSample: vi.fn(),
    onLegacyParse: vi.fn(),
    ...overrides
  };
  return { ...render(<LaunchPage {...props} />), props };
};

afterEach(() => vi.restoreAllMocks());

describe("LaunchPage", () => {
  it("renders the Figma launch information architecture with real destinations", () => {
    renderLaunchPage();

    expect(screen.getByRole("heading", { name: /把一份 PDF 简历.*变成你的个人网站/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "开始生成" })).toHaveAttribute("href", "/upload");
    expect(screen.getByRole("link", { name: "上传简历，免费开始" })).toHaveAttribute("href", "/upload");

    ["AI 智能解析", "模块化补充", "挑选网站风格", "一键发布"].forEach((title) => {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    });
    ["体验设计作品集", "创意开发实验室", "我的项目与故事"].forEach((title) => {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    });
    ["1 上传 PDF →", "2 确认内容 →", "3 生成网站"].forEach((step) => {
      expect(screen.getByText(step)).toBeInTheDocument();
    });

    ["隐私政策", "服务条款", "联系我们"].forEach((label) => {
      expect(screen.getByText(label).tagName).not.toBe("A");
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    });
  });

  it("keeps scrolling, samples, projects and legacy parsing as separate actions", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    const onProjects = vi.fn();
    const onSample = vi.fn();
    const onLegacyParse = vi.fn();
    renderLaunchPage({ projectCount: 2, onProjects, onSample, onLegacyParse });

    fireEvent.click(screen.getByRole("button", { name: "查看样例" }));
    fireEvent.click(screen.getByRole("button", { name: "查看样例 ↓" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });

    ["查看体验设计作品集样例", "查看创意开发实验室样例", "查看我的项目与故事样例"].forEach((label) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
    });
    expect(onSample).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "我的项目，共 2 个" }));
    expect(onProjects).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole("button", { name: "使用浏览器解析（兼容）" })[0]);
    expect(onLegacyParse).toHaveBeenCalledOnce();

    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    expect(() => fireEvent.click(screen.getByRole("button", { name: "查看样例" }))).not.toThrow();
  });
});
