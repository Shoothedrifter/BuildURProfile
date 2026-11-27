import { useRef, useState, type ReactNode } from "react";
import { PixelGazePortrait } from "./PixelGazePortrait";
import type { DesignConfigV4 } from "../../../../packages/contracts/src/config";

export function PixelHero({ name, role, intro, artwork, defaultPortraitUrl, children, gazeDisabled = false }: {
  name: string; role: string; intro: string; artwork?: DesignConfigV4["heroArtwork"];
  defaultPortraitUrl: string; children?: ReactNode; gazeDisabled?: boolean;
}) {
  const interactionRef = useRef<HTMLElement>(null);
  const [failedPortrait, setFailedPortrait] = useState<string | null>(null);
  const portrait = artwork?.assetUrl;
  const showPortrait = portrait && /^\/api\/hero-assets\/[a-f0-9-]{36}$/i.test(portrait) && failedPortrait !== portrait;
  return <section ref={interactionRef} id="top" data-pixel-chapter="top" className="pixel-hero pixel-width">
    <div className="pixel-hero-copy">
      {role && <p className="pixel-role">{role}</p>}
      <h1 tabIndex={-1}>{name}</h1>
    </div>
    {children}
    <div className="pixel-stage">
      <div className="pixel-stage-grid" aria-hidden="true" />
      <div className="pixel-speech pixel-label" aria-hidden="true">你好！<i /></div>
      <PixelGazePortrait interactionRef={interactionRef} disabled={gazeDisabled} src={showPortrait ? portrait : defaultPortraitUrl}
        alt={showPortrait ? artwork?.alt || "个人像素头像" : "像素世界风默认角色"}
        onError={showPortrait ? () => setFailedPortrait(portrait) : undefined} />
    </div>
    {intro && <p className="pixel-hero-intro pixel-copy">{intro}</p>}
    <p className="pixel-press pixel-label" aria-hidden="true">▼ 向下滚动</p>
  </section>;
}

/** The template picker shares the real hero, with no uploaded photo or project body. */
export function PixelTemplatePreview({ name, role, intro }: { name: string; role: string; intro: string }) {
  const displayName = name.trim() || "你的名字";
  return <div className="pixel-world pixel-template-preview" data-testid="pixel-template-preview">
    <div className="pixel-header"><div className="pixel-header-inner pixel-width">
      <span className="pixel-brand pixel-label"><span aria-hidden="true" />{displayName}</span>
      <span className="pixel-label">PIXEL WORLD</span>
    </div></div>
    <PixelHero name={displayName} role={role.trim()} intro={intro.trim() || "用你的经历，讲述自己的故事。"}
      defaultPortraitUrl="/pixel-world-base.svg" />
  </div>;
}
