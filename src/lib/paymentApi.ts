import type { DesignConfig } from "../../types/config";

export type OwnedProject = { id: string; config: DesignConfig; revision: number; paid: boolean; pendingAction: "share" | "export" | null; pendingAmountFen: number | null };
export type Offer = { configured: boolean; mode: "sandbox" | "production" | null; configurationError?: string | null; priceFen: number | null; priceYuan: string | null; service: string; shareDays: number };
export type PublishedShare = { token: string; url: string; expiresAt: number };

let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  csrfPromise ??= fetch("/api/session", { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) throw new Error("无法建立安全会话。");
      return ((await response.json()) as { csrfToken: string }).csrfToken;
    }).catch((error) => { csrfPromise = null; throw error; });
  return csrfPromise;
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const csrf = await csrfToken();
  const response = await fetch(path, {
    method, credentials: "same-origin",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { "x-csrf-token": csrf }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `请求失败（${response.status}）。`);
  }
  return response.json() as Promise<T>;
}

export const paymentApi = {
  offer: () => request<Offer>("/api/offer"),
  projects: () => request<OwnedProject[]>("/api/projects"),
  project: (id: string) => request<OwnedProject>(`/api/projects/${encodeURIComponent(id)}`),
  createProject: (config: DesignConfig) => request<OwnedProject>("/api/projects", "POST", { config }),
  updateProject: (id: string, config: DesignConfig) => request<OwnedProject>(`/api/projects/${encodeURIComponent(id)}`, "PUT", { config }),
  checkout: (id: string, action: "share" | "export") => request<{ alreadyPaid: boolean; paymentHtml?: string; amountYuan?: string }>(
    `/api/projects/${encodeURIComponent(id)}/checkout`, "POST", { action }),
  reconcile: (id: string) => request<OwnedProject>(`/api/projects/${encodeURIComponent(id)}/reconcile`, "POST"),
  publish: (id: string) => request<PublishedShare>(`/api/projects/${encodeURIComponent(id)}/publish`, "POST"),
  shares: (id: string) => request<Array<{ token: string; expires_at: number }>>(`/api/projects/${encodeURIComponent(id)}/shares`),
  revoke: (id: string, token: string) => request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}/shares/${encodeURIComponent(token)}`, "DELETE"),
  export: (id: string) => request<{ url: string; expiresAt: number }>(`/api/projects/${encodeURIComponent(id)}/export`, "POST"),
  readShare: (token: string) => request<{ config: DesignConfig; expiresAt: number }>(`/api/shares/${encodeURIComponent(token)}`)
};

/** Submit only the official SDK generated form, never arbitrary script from an API response. */
export function submitAlipayForm(html: string, mode: "sandbox" | "production"): void {
  const template = document.createElement("template");
  template.innerHTML = html;
  const form = template.content.querySelector("form");
  if (!form) throw new Error("支付宝支付表单缺失。");
  const action = new URL(form.action);
  const host = mode === "sandbox" ? "openapi-sandbox.dl.alipaydev.com" : "openapi.alipay.com";
  if (form.method.toLowerCase() !== "post" || action.protocol !== "https:" || action.hostname !== host) {
    throw new Error("支付宝收银台地址无效。");
  }
  document.body.append(form);
  form.submit();
}
