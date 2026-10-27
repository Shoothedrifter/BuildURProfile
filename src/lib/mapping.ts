import type { DesignConfig, JobRole, StackedCardsConfig, StyleVector } from "../../types/config";

const unit = (score: number): number => Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0.5;

type RoleDefaults = Readonly<{
  rows: number;
  speedBonus: number;
  tileBonus: number;
  scaleBonus: number;
  offsetBonus: number;
  radiusBonus: number;
  stickyTop: number;
  layout: StackedCardsConfig["layout"];
  direction: "left" | "right";
}>;

const roleDefaults: Record<JobRole, RoleDefaults> = {
  "ui-ux-designer": {
    rows: 1, speedBonus: 0, tileBonus: 0, scaleBonus: 0, offsetBonus: 0,
    radiusBonus: 0, stickyTop: 104, layout: "center", direction: "left"
  },
  "frontend-creative-developer": {
    rows: 2, speedBonus: 8, tileBonus: 8, scaleBonus: 0.01, offsetBonus: 3,
    radiusBonus: 2, stickyTop: 108, layout: "offset", direction: "left"
  },
  "brand-motion-copy": {
    rows: 2, speedBonus: 4, tileBonus: 20, scaleBonus: 0.015, offsetBonus: 5,
    radiusBonus: 6, stickyTop: 100, layout: "fan", direction: "right"
  }
};

/** Translate assessment preferences into renderer parameters without inventing resume content. */
export function styleToConfig(vector: StyleVector, jobRole: JobRole): DesignConfig {
  const normalized: StyleVector = {
    E: unit(vector.E),
    K: unit(vector.K),
    P: unit(vector.P),
    S: unit(vector.S),
    PChoice: vector.PChoice
  };
  const defaults = roleDefaults[jobRole];
  const { E, K, P, S, PChoice } = normalized;

  return {
    styleVector: normalized,
    // PChoice is categorical: it chooses a skin; P is only the strength of that visual preference.
    skin: PChoice === "cool" ? "dark-tech" : PChoice === "vivid" ? "high-saturation" : "light-minimal",
    marquee: {
      direction: defaults.direction,
      // K → travel speed. Larger kinetic preference makes the marquee move faster.
      speed: 32 + Math.round(K * 60) + defaults.speedBonus,
      // S → scroll binding and hover control. High S favors user-driven motion over a fixed loop.
      bindToScroll: S >= 0.65,
      // E → marquee density and tile scale: expressive users see a fuller, larger word field.
      rows: Math.min(4, defaults.rows + Math.round(E)),
      tileSize: 216 + Math.round(E * 64) + defaults.tileBonus,
      pauseOnHover: S >= 0.35
    },
    stackedCards: {
      // K → depth and vertical displacement: motion intensity changes the card transition geometry.
      scaleStep: Number((0.04 + K * 0.105 + defaults.scaleBonus).toFixed(3)),
      offsetStep: 14 + Math.round(K * 18) + defaults.offsetBonus,
      stickyTop: defaults.stickyTop,
      layout: defaults.layout,
      // P → shape strength within the chosen skin; hue never interpolates between PChoice categories.
      cardRadius: 12 + Math.round(P * 18) + defaults.radiusBonus,
      // S → pointer tilt and manual card navigation. Touch callers disable tilt and retain manual navigation.
      enableTilt: S >= 0.65,
      autoPlay: S < 0.65
    },
    // Every text slot remains empty until confirmed PDF fields are injected by the caller.
    content: {
      profile: { name: "", role: "", location: "", availability: "", intro: "", summary: "", email: "" },
      expertise: { eyebrow: "", headline: "", summary: "", skills: [], disciplines: [] },
      projects: []
    }
  };
}
