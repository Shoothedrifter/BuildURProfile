import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DesignConfig } from "../types/config";
import hwf from "./__fixtures__/hwf.json";
import hzy from "./__fixtures__/hzy.json";
import { ShowcasePage } from "./ShowcasePage";
// @ts-expect-error Server-only JavaScript module has no TypeScript declarations.
import { buildStaticHtml } from "../server/export.mjs";

const fixtures = [hwf as DesignConfig, hzy as DesignConfig];

describe("real exported showcase fixtures", () => {
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

  it("shows long HZY skills in the static list and avoids duplicated copy", () => {
    render(<ShowcasePage config={hzy as DesignConfig} />);
    expect(screen.queryByRole("region", { name: "Scrolling expertise" })).not.toBeInTheDocument();
    const list = screen.getByRole("list", { name: "完整技能" });
    for (const skill of hzy.content.expertise.skills) expect(list).toHaveTextContent(skill);
    expect(screen.getByRole("heading", { name: "技能与专长" })).toBeVisible();
    expect(screen.queryByText(hzy.content.expertise.skills[0], { selector: "p" })).not.toBeInTheDocument();
  });

  it("uses HWF's legacy GitHub category as a safe action", () => {
    render(<ShowcasePage config={hwf as DesignConfig} />);
    fireEvent.click(screen.getByRole("button", { name: "Next project" }));
    expect(screen.getByRole("link", { name: /查看项目链接/ })).toHaveAttribute("href", "https://github.com/Shoothedrifter/LearningFactory");
    expect(screen.queryByText("https://github.com/Shoothedrifter/LearningFactory")).not.toBeInTheDocument();
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
