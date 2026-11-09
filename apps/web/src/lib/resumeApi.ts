import type { ResumeDraftV1 } from "../../../../packages/contracts/src/resume-draft";

export type ResumeStatus = { resumeId: string; status: string; stage?: string; progress?: number; errorCode?: string | null };
export type StoredResume = { draft: ResumeDraftV1; revision: number; expiresAt: string };

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
  status(resumeId: string): Promise<ResumeStatus> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}/status`);
  },
  read(resumeId: string): Promise<StoredResume> {
    return request(`/api/resumes/${encodeURIComponent(resumeId)}`);
  },
  save(resumeId: string, draft: ResumeDraftV1): Promise<StoredResume> {
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
  }
};
