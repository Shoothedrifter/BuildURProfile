import type { DesignConfig } from "../../../../packages/contracts/src/config";

export const PREVIEW_TIMEOUT = 12_000;
const previewMessageType = "buildurprofile:showcase-preview";
const noncePattern = /^[a-f0-9]{32}$/;

export type PreviewSnapshot = {
  config: DesignConfig;
  sample?: boolean;
};

type PreviewMessage =
  | { type: typeof previewMessageType; nonce: string; action: "ready" | "received" }
  | { type: typeof previewMessageType; nonce: string; action: "snapshot"; snapshot: PreviewSnapshot };

export function createPreviewNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function previewUrl(nonce: string, embedded = false): string {
  return `/preview${embedded ? "?embedded=1" : ""}#preview=${nonce}`;
}

export function previewRequest(): { nonce: string; embedded: boolean } | null {
  const params = new URLSearchParams(window.location.search);
  const nonce = new URLSearchParams(window.location.hash.slice(1)).get("preview");
  return nonce && noncePattern.test(nonce) ? { nonce, embedded: params.get("embedded") === "1" } : null;
}

export function sendPreviewMessage(peer: Window, message: Omit<Extract<PreviewMessage, { action: "snapshot" }>, "type"> |
  Omit<Exclude<PreviewMessage, { action: "snapshot" }>, "type">): void {
  peer.postMessage({ ...message, type: previewMessageType }, window.location.origin);
}

export function readPreviewMessage(event: MessageEvent, peer: Window | null | undefined, nonce: string): PreviewMessage | null {
  if (!peer || event.source !== peer || event.origin !== window.location.origin) return null;
  const data = event.data as PreviewMessage | null;
  if (data?.type !== previewMessageType || data.nonce !== nonce) return null;
  return data;
}

/** Send an in-memory snapshot to a tab opened by the same user gesture. */
export function openShowcasePreview(config: DesignConfig, options: { sample?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const nonce = createPreviewNonce();
    const tab = window.open(previewUrl(nonce), "_blank");
    if (!tab) {
      reject(new Error("浏览器阻止了新标签页。请允许弹出窗口后重试。"));
      return;
    }

    let sent = false;
    const dispose = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
    const receive = (event: MessageEvent) => {
      const message = readPreviewMessage(event, tab, nonce);
      if (message?.action === "ready" && !sent) {
        sent = true;
        sendPreviewMessage(tab, { nonce, action: "snapshot", snapshot: { config, sample: options.sample } });
      } else if (message?.action === "received" && sent) {
        dispose();
        resolve();
      }
    };
    const timeout = window.setTimeout(() => {
      dispose();
      reject(new Error("新标签页未收到预览。请重试。"));
    }, PREVIEW_TIMEOUT);
    window.addEventListener("message", receive);
  });
}
