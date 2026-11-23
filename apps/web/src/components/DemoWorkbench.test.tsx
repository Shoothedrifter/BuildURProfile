import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanConfig } from "../../../../packages/contracts/src/validation.mjs";
import { createDemoShowcaseConfig, demoDraftKey, demoTemplates } from "../demo/showcaseDemo";
import { openShowcasePreview } from "../lib/showcasePreview";
import { DemoWorkbench } from "./DemoWorkbench";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("creates valid examples for all five templates with the same source content", () => {
  const examples = demoTemplates.map(({ id }) => JSON.parse(cleanConfig(createDemoShowcaseConfig(id))));
  expect(examples.map(example => example.templateId)).toEqual(demoTemplates.map(({ id }) => id));
  expect(examples.every(example => example.content.profile.name === "林予安"
    && example.content.projects[0]?.title === "城市通勤服务")).toBe(true);
});

it("updates the iframe snapshot and persists the sample without touching real draft data", () => {
  const { unmount } = render(<DemoWorkbench />);
  const frame = screen.getByTitle("实时样例预览") as HTMLIFrameElement;
  const peer = frame.contentWindow!;
  const postMessage = vi.spyOn(peer, "postMessage").mockImplementation(() => {});
  const nonce = new URLSearchParams(new URL(frame.src).hash.slice(1)).get("preview")!;
  fireEvent(window, new MessageEvent("message", {
    source: peer, origin: window.location.origin,
    data: { type: "buildurprofile:showcase-preview", nonce, action: "ready" }
  }));

  fireEvent.change(screen.getByRole("textbox", { name: "姓名" }), { target: { value: "设计演示" } });
  fireEvent.click(screen.getByRole("button", { name: "上移工作经历" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "显示项目经历" }));
  fireEvent.click(screen.getByRole("tab", { name: "样式" }));
  fireEvent.click(screen.getByRole("button", { name: "大胆实验" }));

  const latest = postMessage.mock.calls.at(-1)?.[0];
  expect(latest.snapshot).toMatchObject({
    sample: true,
    config: { templateId: "bold-v1", content: { profile: { name: "设计演示" }, projects: [] } }
  });
  expect(latest.snapshot.config.content.resume.sections[2].kind).toBe("workExperience");
  fireEvent.click(screen.getByRole("button", { name: "保存样例草稿" }));
  expect(localStorage.getItem(demoDraftKey)).toContain("设计演示");
  expect(localStorage.length).toBe(1);

  unmount();
  render(<DemoWorkbench />);
  expect(screen.getByRole("textbox", { name: "姓名" })).toHaveValue("设计演示");
  expect(within(screen.getByRole("tabpanel")).getByRole("checkbox", { name: "显示项目经历" })).not.toBeChecked();
});

it("only sends a popup snapshot once to the same origin, window and nonce", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  try {
    const peer = frame.contentWindow!;
    const postMessage = vi.spyOn(peer, "postMessage").mockImplementation(() => {});
    const open = vi.spyOn(window, "open").mockReturnValue(peer);
    const config = createDemoShowcaseConfig("minimal-v1");
    const opened = openShowcasePreview(config);
    const url = new URL(open.mock.calls[0][0]!, window.location.href);
    const nonce = new URLSearchParams(url.hash.slice(1)).get("preview")!;
    const ready = { type: "buildurprofile:showcase-preview", nonce, action: "ready" };

    window.dispatchEvent(new MessageEvent("message", { source: window, origin: window.location.origin, data: ready }));
    window.dispatchEvent(new MessageEvent("message", { source: peer, origin: "https://example.test", data: ready }));
    window.dispatchEvent(new MessageEvent("message", {
      source: peer, origin: window.location.origin, data: { ...ready, nonce: "wrong" }
    }));
    expect(postMessage).not.toHaveBeenCalled();

    const sendFromPopup = (data: typeof ready) =>
      window.dispatchEvent(new MessageEvent("message", { source: peer, origin: window.location.origin, data }));
    sendFromPopup(ready);
    sendFromPopup(ready);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      ...ready, action: "snapshot", snapshot: { config, sample: undefined }
    }, window.location.origin);
    expect(url.pathname).toBe("/preview");
    expect(url.searchParams.size).toBe(0);
    sendFromPopup({ ...ready, action: "received" });
    await expect(opened).resolves.toBeUndefined();
  } finally {
    frame.remove();
  }
});
