import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { DesignConfig } from "../../../../packages/contracts/src/config";
import { generationApi, type HeroArtwork } from "../lib/generationApi";
import { preparePortrait } from "../lib/portrait";
import { ProofButton } from "./BuilderChrome";

export function PixelAvatarEditor({ config, applied, onApply }: {
  config: DesignConfig;
  applied: HeroArtwork | null;
  onApply: (artwork: HeroArtwork | null) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<HeroArtwork | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const selection = useRef(0);

  useEffect(() => {
    let active = true;
    void generationApi.pixelAvatarEnabled().then(value => { if (active) setEnabled(value); }).catch(() => {});
    return () => { active = false; selection.current++; request.current?.abort(); };
  }, []);

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    event.currentTarget.value = "";
    const chosen = ++selection.current;
    request.current?.abort();
    setPhoto(null);
    setPending(false);
    setCandidate(null);
    setError("");
    try {
      const dataUrl = await preparePortrait(file);
      if (selection.current === chosen) setPhoto(dataUrl);
    } catch (cause) {
      if (selection.current === chosen) setError(cause instanceof Error ? cause.message : "无法读取这张照片。");
    }
  }

  async function recognizePhoto() {
    if (!photo || pending) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setCandidate(null);
    setPending(true);
    setError("");
    try {
      const artwork = await generationApi.generatePixelAvatar(photo, config, controller.signal);
      if (!controller.signal.aborted) setCandidate(artwork);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法识别照片特征，请重试。");
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  }

  function restoreDefault() {
    selection.current++;
    request.current?.abort();
    setPending(false);
    setCandidate(null);
    setError("");
    onApply(null);
  }

  if (!enabled) return null;
  return <section className="proof-pixel-avatar" aria-labelledby="pixel-avatar-heading">
    <h2 id="pixel-avatar-heading">个人像素头像</h2>
    <p>点击「识别照片特征」后，照片会发送给 Cloudflare Workers AI，用于识别发型、发色、镜框和可见的头颈配饰。当前可应用短发、齐肩发、长发、单马尾、双马尾、不同刘海造型、暖棕和粉色等发色，以及镜框。原照片在本机保留 1 天，候选头像保留 7 天。选用的头像仅用于当前编辑预览，分享和导出使用默认角色。</p>
    <label className="proof-avatar-upload"><strong>{photo ? "重新选择照片" : "选择照片"}</strong>
      <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择个人像素头像照片" onChange={choosePhoto} />
    </label>
    <div className="proof-pixel-avatar-actions">
      <ProofButton variant="primary" disabled={!photo || pending} onClick={recognizePhoto}>识别照片特征</ProofButton>
      {(applied || pending || candidate) && <ProofButton onClick={restoreDefault}>恢复默认角色</ProofButton>}
    </div>
    {pending && <p role="status">正在识别照片特征…</p>}
    {error && <p className="proof-inline-error" role="alert">{error}</p>}
    {candidate && <div className="proof-pixel-avatar-candidate">
      <img src={candidate.assetUrl} alt="生成的像素头像候选" width="112" height="112"
        onError={() => { setCandidate(null); setError("候选头像已不可用，请重新选择照片。"); }} />
      <ProofButton onClick={() => { onApply(candidate); setCandidate(null); }}>使用此头像</ProofButton>
    </div>}
  </section>;
}
