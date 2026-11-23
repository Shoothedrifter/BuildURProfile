"use client";

import { useEffect, useState } from "react";
import { ShowcasePage } from "../../ShowcasePage";
import { PREVIEW_TIMEOUT, previewRequest, readPreviewMessage, sendPreviewMessage } from "../../lib/showcasePreview";
import type { PreviewSnapshot } from "../../lib/showcasePreview";

export default function PreviewPage() {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const template = snapshot?.config && "templateId" in snapshot.config ? snapshot.config.templateId : undefined;

  useEffect(() => {
    const requested = previewRequest();
    const peer = requested?.embedded ? window.parent : window.opener as Window | null;
    if (!requested || !peer || peer === window) {
      setUnavailable(true);
      return;
    }

    const { nonce, embedded } = requested;
    const timeout = window.setTimeout(() => {
      setUnavailable(true);
      if (!embedded) window.opener = null;
    }, PREVIEW_TIMEOUT);
    function receive(event: MessageEvent) {
      const message = readPreviewMessage(event, peer, nonce);
      if (message?.action !== "snapshot" || !message.snapshot?.config?.content?.profile) return;

      window.clearTimeout(timeout);
      setUnavailable(false);
      setSnapshot(message.snapshot);
      if (!embedded) {
        window.removeEventListener("message", receive);
        sendPreviewMessage(peer!, { nonce, action: "received" });
        window.opener = null;
        window.history.replaceState(window.history.state, "", "/preview");
      }
    }
    window.addEventListener("message", receive);
    sendPreviewMessage(peer, { nonce, action: "ready" });
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [template]);

  if (snapshot) {
    return <ShowcasePage config={snapshot.config} samplePreview={snapshot.sample} key={String(template)} />;
  }

  return <main style={{ display: "grid", placeItems: "center", minHeight: "80vh", padding: 20, textAlign: "center" }}>
    {unavailable ? <p role="alert">预览已结束，请从制作页面重新打开。</p> : <p role="status">正在打开作品预览…</p>}
  </main>;
}
