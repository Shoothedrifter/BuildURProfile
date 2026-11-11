import type { DesignConfig, JobRole, ResumeContent } from "../../../../packages/contracts/src/config";
import type { AvatarStyleId } from "../../../../packages/skills/src/avatar-catalog";
import { toPublishedConfig } from "./publication";

export type { AvatarStyleId } from "../../../../packages/skills/src/avatar-catalog";
export type HeroArtwork = NonNullable<DesignConfig["heroArtwork"]>;
export type GenerationBrief = { role: JobRole; answers: Record<string, number>; content: Omit<ResumeContent, "sourceRefs"> };
export type GenerationResult = { projectId?: string; config: DesignConfig; heroArtwork?: HeroArtwork };
export type GenerationStatus = "QUEUED" | "RUNNING" | "CANCELLING";
// Retain the old key so a task started before this migration can still be restored.
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

async function retainTaskOrCancel(id: string, epoch: number): Promise<void> {
  if (epoch !== generationEpoch) {
    // The task may have been queued while the user switched input. Cancel it
    // before it can consume an image API call.
    await request(`/api/generations/${encodeURIComponent(id)}/cancel`, {}).catch(() => {});
    throw new Error("肖像任务已取消。");
  }
  sessionStorage.setItem(savedTaskKey, id);
}

type GenerationTask = { projectId?: string; status: string; error?: string; heroArtwork?: HeroArtwork; config?: DesignConfig };
async function waitForTask(id: string, epoch: number, onStatus?: (status: GenerationStatus) => void): Promise<GenerationResult> {
  // Local image generation may legitimately take longer than five minutes on Apple Silicon.
  const deadline = Date.now() + 35 * 60 * 1000;
  while (Date.now() < deadline) {
    requireCurrent(epoch);
    const current = await request<GenerationTask>(`/api/generations/${encodeURIComponent(id)}`);
    requireCurrent(epoch);
    if (current.status === "SUCCEEDED") {
      if (!current.config) throw new Error("生成任务缺少作品配置，请重新生成。");
      return { config: current.config, ...(current.projectId ? {projectId:current.projectId} : {}), ...(current.heroArtwork ? { heroArtwork: current.heroArtwork } : {}) };
    }
    if (current.status === "FAILED" || current.status === "EXPIRED" || current.status === "CANCELLED") {
      sessionStorage.removeItem(savedTaskKey);
      throw new Error(current.status === "CANCELLED" ? "作品生成已取消。" : current.error ?? "作品生成失败，请重试。");
    }
    if (current.status === "QUEUED" || current.status === "RUNNING" || current.status === "CANCELLING") onStatus?.(current.status);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("生成仍在进行；刷新页面后会继续查询任务。");
}

export const generationApi = {
  async generatePortfolio(brief: GenerationBrief | {resumeId: string; revision: number; role: JobRole; answers: Record<string,number>}, portrait?: { dataUrl: string; styleId: AvatarStyleId },
    onStatus?: (status: GenerationStatus) => void): Promise<GenerationResult> {
    const epoch = generationEpoch;
    let portraitAssetId: string | null = null;
    if (portrait) {
      const uploaded = await request<{ id: string }>("/api/portraits", { dataUrl: portrait.dataUrl });
      requireCurrent(epoch);
      portraitAssetId = uploaded.id;
    }
    const task = await request<{ id: string }>("/api/generations", {
      ...("resumeId" in brief ? brief : {brief}), portraitAssetId, styleId: portrait?.styleId ?? null, idempotencyKey: crypto.randomUUID()
    });
    await retainTaskOrCancel(task.id, epoch);
    return waitForTask(task.id, epoch, onStatus);
  },
  async generateAvatar(dataUrl: string, styleId: AvatarStyleId, config: DesignConfig): Promise<HeroArtwork> {
    const epoch = generationEpoch;
    const portrait = await request<{ id: string }>("/api/portraits", { dataUrl });
    requireCurrent(epoch);
    const task = await request<{ id: string }>("/api/generations", { portraitAssetId: portrait.id, styleId,
      idempotencyKey: crypto.randomUUID(), config: toPublishedConfig(config) });
    await retainTaskOrCancel(task.id, epoch);
    const result = await waitForTask(task.id, epoch);
    if (!result.heroArtwork) throw new Error("生成任务缺少肖像资产，请重新生成。");
    return result.heroArtwork;
  },
  async resumeGeneration(onStatus?: (status: GenerationStatus) => void): Promise<GenerationResult | null> {
    const id = sessionStorage.getItem(savedTaskKey);
    if (!id) return null;
    return waitForTask(id, generationEpoch, onStatus);
  },
  async cancelSavedGeneration(): Promise<{ status: string } | null> {
    const id = sessionStorage.getItem(savedTaskKey);
    generationEpoch++;
    sessionStorage.removeItem(savedTaskKey);
    if (!id) return null;
    try { return await request<{ status: string }>(`/api/generations/${encodeURIComponent(id)}/cancel`, {}); }
    catch { return null; }
  },
  clearSavedGeneration(): void { generationEpoch++; sessionStorage.removeItem(savedTaskKey); }
};
