import type { ResumeDraftV2 } from "../../../../packages/contracts/src/resume-draft";

export type ResumeStatus = { resumeId: string; fileId?: string; status: string; stage?: string; progress?: number; errorCode?: string | null };
export type PendingResumeImage = { imageId: string; itemId: string | null; contentType: string; size: number };
export type StoredResume = { draft: ResumeDraftV2; revision: number; expiresAt: string; cacheScope?: string };
export type ResumeVersion = { revision:number; createdAt:number };
export type ResumeCandidate = {taskId:string;resumeId:string;status:string;stage?:string|null;progress?:number;
  errorCode?:string|null;mode:'overwrite'|'fillEmpty';baseRevision:number;appliedRevision?:number|null;
  preview?:{kind:string;items:{itemId:string;title:string;details:string;facts:{key:string;label:string;value:string}[]}[]}[]|null};
// 原文对照摘录（服务端已裁剪：仅 blockId/page/readingOrder/text）
export type SourceBlockExcerpt = { blockId: string; page: number; readingOrder: number; text: string };
export type SourceBlocks = { blocks: SourceBlockExcerpt[] };

let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  csrfPromise ??= fetch("/api/session", { credentials: "same-origin" }).then(async (response) => {
    if (!response.ok) throw new Error("无法建立安全会话。");
    return ((await response.json()) as { csrfToken: string }).csrfToken;
  }).catch((error) => { csrfPromise = null; throw error; });
  return csrfPromise;
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin",
    headers: method === "GET" ? {} : { "content-type": "application/json", "x-csrf-token": await csrfToken() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `请求失败（${response.status}）。`);
  }
  return response.json() as Promise<T>;
}

export const resumeApi = {
  async upload(file: File, onProgress?: (percent: number) => void): Promise<{ fileId: string; pageCount: number }> {
    const token = await csrfToken();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/resumes/upload");
      xhr.withCredentials = true;
      xhr.setRequestHeader("content-type", "application/pdf");
      xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
      xhr.setRequestHeader("x-csrf-token", token);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
      };
      xhr.onload = () => {
        if (xhr.status === 201) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("上传响应无效。")); }
        } else {
          let error = "上传失败，请重试。";
          try { error = JSON.parse(xhr.responseText).error ?? error; } catch { /* retain message */ }
          reject(new Error(error));
        }
      };
      xhr.onerror = () => reject(new Error("上传失败，请检查网络后重试。"));
      xhr.send(file);
    });
  },
  parse(fileId: string): Promise<ResumeStatus> {
    return request("/api/resumes/parse", "POST", { fileId, idempotencyKey: crypto.randomUUID() });
  },
  reparse(resumeId: string): Promise<ResumeStatus> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/reparse`, "POST",
      { idempotencyKey: crypto.randomUUID() });
  },
  createCandidate(resumeId:string,expectedRevision:number,mode:'overwrite'|'fillEmpty'):Promise<ResumeCandidate>{
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/reparse-candidates`,'POST',
      {expectedRevision,mode,idempotencyKey:crypto.randomUUID()});
  },
  candidate(resumeId:string,taskId:string):Promise<ResumeCandidate>{
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/reparse-candidates/${encodeURIComponent(taskId)}`);
  },
  applyCandidate(resumeId:string,taskId:string,expectedRevision:number):Promise<{draft?:ResumeDraftV2;revision:number}>{
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/reparse-candidates/${encodeURIComponent(taskId)}/apply`,'POST',{expectedRevision});
  },
  cancelCandidate(resumeId:string,taskId:string):Promise<{status:string}>{
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/reparse-candidates/${encodeURIComponent(taskId)}/cancel`,'POST',{});
  },
  status(resumeId: string): Promise<ResumeStatus> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/status`);
  },
  read(resumeId: string): Promise<StoredResume> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}`);
  },
  versions(resumeId:string):Promise<{versions:ResumeVersion[]}>{
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/versions`);
  },
  version(resumeId:string,revision:number):Promise<{draft:ResumeDraftV2;revision:number;expiresAt:string}>{
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/versions/${revision}`);
  },
  restore(resumeId:string,expectedRevision:number,targetRevision:number):Promise<{draft:ResumeDraftV2;revision:number}>{
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/restore`,'POST',{expectedRevision,targetRevision});
  },
  blocks(resumeId: string): Promise<SourceBlocks> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/blocks`);
  },
  // 条目补充图片：按文件声明类型原样上传，服务端返回 imageId 供草稿引用
  async uploadImage(resumeId: string, file: File, itemId?: string): Promise<{ imageId: string }> {
    const response = await fetch(`/api/resumes/${encodeURIComponent(resumeId)}/images`, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": file.type || "application/octet-stream", ...(itemId ? { "x-resume-item": itemId } : {}), "x-csrf-token": await csrfToken() },
      body: file
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? `图片上传失败（${response.status}）。`);
    }
    return response.json() as Promise<{ imageId: string }>;
  },
  pendingImages(resumeId: string): Promise<{images: PendingResumeImage[]}> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/images`);
  },
  deleteImage(resumeId: string, imageId: string): Promise<{ok: boolean}> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/images/${encodeURIComponent(imageId)}`, "DELETE");
  },
  save(resumeId: string, draft: ResumeDraftV2): Promise<StoredResume> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}`, "PATCH", { revision: draft.revision, draft });
  },
  cancel(resumeId: string): Promise<{ status: string }> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/cancel`, "POST", {});
  },
  remove(resumeId: string): Promise<{ ok: boolean }> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}`, "DELETE");
  },
  sourceUrl(resumeId: string): string {
    return `/api/resumes/${encodeURIComponent(resumeId)}/source`;
  },
  imageUrl(resumeId: string, imageId: string): string {
    return `/api/resumes/${encodeURIComponent(resumeId)}/images/${encodeURIComponent(imageId)}`;
  }
};
