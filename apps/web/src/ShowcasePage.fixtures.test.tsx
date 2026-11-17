import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DesignConfig } from "../../../packages/contracts/src/config";
import resumeEnrichmentV3 from "../../../packages/contracts/fixtures/resume-enrichment.v3.json";
import fourProjects from "./fixtures/four-projects.json";
import twoProjects from "./fixtures/two-projects.json";
import { ShowcasePage } from "./ShowcasePage";
import { buildStaticHtml } from "./server/export.mjs";

const fixtures = [fourProjects as DesignConfig, twoProjects as DesignConfig];
// Task 2 在 contracts fixture 的 v3 workExperience 条目上落了 sourceText 样例，用于渲染层验证
const sourceDetailConfig = { ...twoProjects, content: { ...twoProjects.content, resume: resumeEnrichmentV3 } } as DesignConfig;
const legacyV3Config = {
  ...twoProjects,
  content: {
    ...twoProjects.content,
    resume: {
      ...resumeEnrichmentV3,
      sections: resumeEnrichmentV3.sections.map((section) => ({
        ...section,
        // 先补齐 sourceText 键再解构剔除，统一处理有条目/无条目两种形状，得到旧 v3 数据形态
        items: section.items.map((item) => {
          const { sourceText: _omit, ...rest } = { sourceText: undefined, ...item };
          return rest;
        })
      }))
    }
  }
} as DesignConfig;

describe("synthetic exported showcase fixtures", () => {
  it.each(fixtures)("keeps every project reachable by controls and full details: $content.profile.name", (config) => {
    render(<ShowcasePage config={config} />);
    for (const [index, project] of config.content.projects.entries()) {
      expect(screen.getByRole("heading", { name: project.title })).toBeVisible();
      const detail = screen.getByText("查看项目详情").closest("details");
      expect(detail).not.toBeNull();
      fireEvent.click(screen.getByText("查看项目详情"));
      expect(detail).toHaveTextContent(project.description);
      if (index < config.content.projects.length - 1) fireEvent.click(screen.getByRole("button", { name: "Next project" }));
    }
  });

  it("shows long skills in the static list and avoids duplicated copy", () => {
    render(<ShowcasePage config={twoProjects as DesignConfig} />);
    expect(screen.queryByRole("region", { name: "Scrolling expertise" })).not.toBeInTheDocument();
    const list = screen.getByRole("list", { name: "完整技能" });
    for (const skill of twoProjects.content.expertise.skills) expect(list).toHaveTextContent(skill);
    expect(screen.getByRole("heading", { name: "技能与专长" })).toBeVisible();
    expect(screen.queryByText(twoProjects.content.expertise.skills[0], { selector: "p" })).not.toBeInTheDocument();
  });

  it("uses a legacy GitHub category as a safe action", () => {
    render(<ShowcasePage config={fourProjects as DesignConfig} />);
    fireEvent.click(screen.getByRole("button", { name: "Next project" }));
    expect(screen.getByRole("link", { name: /查看项目链接/ })).toHaveAttribute("href", "https://github.com/example/portfolio-demo");
    expect(screen.queryByText("https://github.com/example/portfolio-demo")).not.toBeInTheDocument();
  });

  it.each(fixtures)("embeds the same confirmed config in a network-free export shell: $content.profile.name", (config) => {
    const html = buildStaticHtml(config, "window.ready = true;", "body { margin: 0; }");
    const page = new DOMParser().parseFromString(html, "text/html");
    const exported = JSON.parse(page.querySelector("#buildurprofile-config")!.textContent!) as DesignConfig;
    expect(exported.content.projects.map((project) => project.description)).toEqual(config.content.projects.map((project) => project.description));
    expect(page.querySelectorAll("script[src], link[href]")).toHaveLength(0);
    expect(page.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("connect-src 'none'");
  });
});

describe("resume sourceText 详情展开", () => {
  it("v3 条目带 sourceText 时出现查看详情且展开体含原文", () => {
    render(<ShowcasePage config={sourceDetailConfig} />);
    expect(screen.getByRole("heading", { name: "合成公司" })).toBeVisible();
    const details = screen.getByText("查看详情").closest("details");
    expect(details).not.toBeNull();
    fireEvent.click(screen.getByText("查看详情"));
    expect(details).toHaveTextContent("负责官网改版：使用 React 与 Next.js 重构首页与项目展示模块，首屏加载时间由 3.2 秒降至 1.1 秒。");
  });

  it("旧 v3 数据无 sourceText 时条目照常显示且展开体降级为 details", () => {
    render(<ShowcasePage config={legacyV3Config} />);
    expect(screen.getByRole("heading", { name: "合成公司" })).toBeVisible();
    // 条目正文照常显示，且展开体降级为 details（两处出现属于规格预期的重复）
    expect(screen.getAllByText("参与界面开发").length).toBe(2);
    const details = screen.getByText("查看详情").closest("details");
    expect(details).not.toBeNull();
    fireEvent.click(screen.getByText("查看详情"));
    expect(details).toHaveTextContent("参与界面开发");
  });
});
