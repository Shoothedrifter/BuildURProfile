import type { DesignConfig } from "../../../../packages/contracts/src/config";
import { toPublishedConfig } from "./publication";

export type AvatarStyleId = "retro-flat-anime-head" | "crayon-flat-naive" | "textile-toy-portrait";
export type HeroArtwork = NonNullable<DesignConfig["heroArtwork"]>;
const savedTaskKey = "burp-avatar-task";

let csrfPromise: Promise<string> | null = null;
let generationEpoch = 0;
function requireCurrent(epoch: number): void {
  if (epoch !== generationEpoch) throw new Error("肖像任务已取消。");
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  csrfPromise ??= fetch("/api/session", { credentials: "same-origin" }).then(async (response) => {
    if (!response.ok) throw new Error("无法建立安全会话。");
    return ((await response.json()) as { csrfToken: string }).csrfToken;
  }).catch((error) => { csrfPromise = null; throw error; });
  const csrf = await csrfPromise;
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json", "x-csrf-token": csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `请求失败（${response.status}）。`);
  }
  return response.json() as Promise<T>;
}

type GenerationTask = { status: string; error?: string; heroArtwork?: HeroArtwork; config?: DesignConfig };
async function waitForTask(id: string, epoch: number): Promise<GenerationTask> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    requireCurrent(epoch);
    const current = await request<GenerationTask>(`/api/generations/${encodeURIComponent(id)}`);
    requireCurrent(epoch);
    if (current.status === "SUCCEEDED" && current.heroArtwork) {
      return current;
    }
    if (current.status === "FAILED" || current.status === "EXPIRED") {
      sessionStorage.removeItem(savedTaskKey);
      throw new Error(current.error ?? "肖像生成失败，请重试。");
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("生成仍在进行；刷新页面后会继续查询任务。");
}

export const generationApi = {
  async generateAvatar(dataUrl: string, styleId: AvatarStyleId, config: DesignConfig): Promise<HeroArtwork> {
    const epoch = generationEpoch;
    const portrait = await request<{ id: string }>("/api/portraits", { dataUrl });
    requireCurrent(epoch);
    const task = await request<{ id: string }>("/api/generations", { portraitAssetId: portrait.id, styleId,
      idempotencyKey: crypto.randomUUID(), config: toPublishedConfig(config) });
    requireCurrent(epoch);
    sessionStorage.setItem(savedTaskKey, task.id);
    return (await waitForTask(task.id, epoch)).heroArtwork!;
  },
  async resumeGeneration(): Promise<{ config: DesignConfig; heroArtwork: HeroArtwork } | null> {
    const id = sessionStorage.getItem(savedTaskKey);
    if (!id) return null;
    const result = await waitForTask(id, generationEpoch);
    return result.config && result.heroArtwork ? { config: result.config, heroArtwork: result.heroArtwork } : null;
  },
  clearSavedGeneration(): void { generationEpoch++; sessionStorage.removeItem(savedTaskKey); }
};
