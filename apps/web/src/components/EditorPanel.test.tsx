import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { DesignConfig } from "../../../../packages/contracts/src/config";
import rawConfig from "../demo/config.json";
import { EditorPanel } from "./EditorPanel";

const base = rawConfig as DesignConfig;

function Harness({ isTouch = false, initial = base }: { isTouch?: boolean; initial?: DesignConfig }) {
  const [config, setConfig] = useState(initial);
  return <><EditorPanel config={config} onChange={setConfig} isTouch={isTouch} /><output data-testid="edited-config">{JSON.stringify(config)}</output></>;
}

function edited(): DesignConfig {
  return JSON.parse(screen.getByTestId("edited-config").textContent ?? "") as DesignConfig;
}

describe("result editor", () => {
  it("edits profile, expertise, and project copy in the live config", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "New Name" } });
    fireEvent.change(screen.getByRole("textbox", { name: "技能 1" }), { target: { value: "Interface systems" } });
    fireEvent.change(screen.getByRole("textbox", { name: "项目 1 描述" }), { target: { value: "An edited project description." } });
    expect(edited().content.profile.name).toBe("New Name");
    expect(edited().content.expertise.skills[0]).toBe("Interface systems");
    expect(edited().content.projects[0].description).toBe("An edited project description.");
  });

  it("removes PDF source citations for manually changed text", () => {
    const cited: DesignConfig = {
      ...base,
      content: {
        ...base.content,
        sourceRefs: {
          "profile.name": { page: 1, excerpt: "Original Name" },
          "projects.0": { page: 1, excerpt: "Original project" },
          "profile.email": { page: 1, excerpt: "Original email" }
        }
      }
    };
    render(<Harness initial={cited} />);
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "Changed Name" } });
    fireEvent.change(screen.getByRole("textbox", { name: "项目 1 描述" }), { target: { value: "Changed description" } });
    expect(edited().content.sourceRefs?.["profile.name"]).toBeUndefined();
    expect(edited().content.sourceRefs?.["projects.0"]).toBeUndefined();
    expect(edited().content.sourceRefs?.["profile.email"]).toBeDefined();
  });

  it("makes the intensity slider change marquee speed and card depth immediately", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("slider", { name: "交互强度" }), { target: { value: "95" } });
    expect(edited().styleVector.K).toBe(0.95);
    expect(edited().styleVector.S).toBe(0.95);
    expect(edited().marquee.speed).toBeGreaterThan(base.marquee.speed);
    expect(edited().stackedCards.scaleStep).toBeGreaterThan(base.stackedCards.scaleStep);
  });

  it("keeps the slider value valid when React applies its updater after the event ends", () => {
    let pending: ((current: DesignConfig) => DesignConfig) | undefined;
    render(<EditorPanel config={base} isTouch={false} onChange={(update) => { pending = update; }} />);
    fireEvent.change(screen.getByRole("slider", { name: "交互强度" }), { target: { value: "88" } });
    expect(pending).toBeDefined();
    expect(pending?.(base).styleVector.K).toBe(0.88);
  });

  it("stores replacement images in the config for marquee tiles and project cards", async () => {
    render(<Harness />);
    const png = new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("跑马灯 1 图片"), { target: { files: [png] } });
    await waitFor(() => expect(typeof edited().marquee.items?.[0]).toBe("object"));
    fireEvent.change(screen.getByLabelText("项目 1 图片"), { target: { files: [png] } });
    await waitFor(() => expect(edited().content.projects[0].image).toMatch(/^data:image\/png;base64,/));
    expect(edited().marquee.items?.[0]).toMatchObject({ label: "Product design", image: expect.stringMatching(/^data:image\/png;base64,/) });
  });

  it("rejects unsupported image formats without changing the config", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("项目 1 图片"), { target: { files: [new File(["oops"], "bad.svg", { type: "image/svg+xml" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("PNG、JPEG 或 WebP");
    expect(edited().content.projects[0].image).toBeUndefined();
  });

  it("moves a legacy URL category into the editable link field", () => {
    const url = "https://github.com/example/repo";
    const initial: DesignConfig = { ...base, content: { ...base.content, projects: [{ ...base.content.projects[0], category: url }] } };
    render(<Harness initial={initial} />);
    expect(screen.getByRole("textbox", { name: "项目 1 分类" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /项目 1 链接/ })).toHaveValue(url);
    fireEvent.change(screen.getByRole("textbox", { name: /项目 1 链接/ }), { target: { value: "" } });
    expect(edited().content.projects[0].category).toBe("");
    expect(edited().content.projects[0].link).toBe("");
  });
});
