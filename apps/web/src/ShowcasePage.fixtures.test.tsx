import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DesignConfig } from "../../../packages/contracts/src/config";
import fourProjects from "./fixtures/four-projects.json";
import twoProjects from "./fixtures/two-projects.json";
import { ShowcasePage } from "./ShowcasePage";
// @ts-expect-error Server-only JavaScript module has no TypeScript declarations.
import { buildStaticHtml } from "../../api/src/export.mjs";

const fixtures = [fourProjects as DesignConfig, twoProjects as DesignConfig];

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
