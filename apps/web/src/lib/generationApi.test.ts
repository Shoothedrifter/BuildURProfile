import { beforeEach, expect, it, vi } from "vitest";
import type { DesignConfig } from "../../../../packages/contracts/src/config";
import rawConfig from "../demo/config.json";
import { generationApi } from "./generationApi";

beforeEach(() => {
  sessionStorage.clear();
  generationApi.clearSavedGeneration();
  vi.unstubAllGlobals();
});

it("does not enqueue or retain a task after the user removes a pending portrait", async () => {
  let finishUpload!: (response: Response) => void;
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn((path: string) => {
    calls.push(path);
    if (path === "/api/session") return Promise.resolve(new Response(JSON.stringify({ csrfToken: "csrf" }), { status: 200 }));
    if (path === "/api/portraits") return new Promise<Response>((resolve) => { finishUpload = resolve; });
    throw new Error(`Unexpected request: ${path}`);
  }));
  const pending = generationApi.generateAvatar("data:image/png;base64,aGVsbG8=", "retro-flat-anime-head", rawConfig as DesignConfig);
  await vi.waitFor(() => expect(calls).toContain("/api/portraits"));
  generationApi.clearSavedGeneration();
  finishUpload(new Response(JSON.stringify({ id: "portrait-id" }), { status: 201 }));
  await expect(pending).rejects.toThrow(/取消/);
  expect(calls).not.toContain("/api/generations");
  expect(sessionStorage.getItem("burp-avatar-task")).toBeNull();
});
