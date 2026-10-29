import type { DesignConfig } from "../../../../packages/contracts/src/config";

const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
const kineticScale = (value: number) => Number((value * 0.105).toFixed(3));

export function interactionIntensity(config: DesignConfig): number {
  return Math.round((unit(config.styleVector.K) + unit(config.styleVector.S)) * 50);
}

export function withInteractionIntensity(config: DesignConfig, value: number, isTouch: boolean): DesignConfig {
  const intensity = unit(value);
  const oldK = unit(config.styleVector.K);
  const speedBase = config.marquee.speed - Math.round(oldK * 60);
  const scaleBase = config.stackedCards.scaleStep - kineticScale(oldK);
  const offsetBase = config.stackedCards.offsetStep - Math.round(oldK * 18);

  return {
    ...config,
    styleVector: { ...config.styleVector, K: intensity, S: intensity },
    marquee: {
      ...config.marquee,
      // K → loop speed; S → scroll binding and hover pause (disabled on touch).
      speed: Math.max(8, speedBase + Math.round(intensity * 60)),
      bindToScroll: !isTouch && intensity >= 0.65,
      pauseOnHover: !isTouch && intensity >= 0.35
    },
    stackedCards: {
      ...config.stackedCards,
      // K → card depth and offset; S → pointer control versus automatic playback.
      scaleStep: Number((scaleBase + kineticScale(intensity)).toFixed(3)),
      offsetStep: offsetBase + Math.round(intensity * 18),
      enableTilt: !isTouch && intensity >= 0.65,
      autoPlay: !isTouch && intensity < 0.65
    }
  };
}
