import { describe, expect, it } from "vitest";
import type { DesignConfig } from "../../types/config";
import rawConfig from "../data/config.json";
import { interactionIntensity, withInteractionIntensity } from "./interaction";

const base = rawConfig as DesignConfig;

describe("live interaction intensity", () => {
  it("updates K and S and changes marquee speed and card scale from the same config", () => {
    const next = withInteractionIntensity(base, 0.9, false);
    expect(next.styleVector.K).toBe(0.9);
    expect(next.styleVector.S).toBe(0.9);
    expect(next.marquee.speed).toBeGreaterThan(base.marquee.speed);
    expect(next.stackedCards.scaleStep).toBeGreaterThan(base.stackedCards.scaleStep);
    expect(next.stackedCards.offsetStep).toBeGreaterThan(base.stackedCards.offsetStep);
    expect(next.content).toBe(base.content);
  });

  it("uses the original mapping baseline across repeated slider changes", () => {
    const direct = withInteractionIntensity(base, 0.2, false);
    const afterDrag = withInteractionIntensity(withInteractionIntensity(base, 0.9, false), 0.2, false);
    expect(afterDrag.marquee.speed).toBe(direct.marquee.speed);
    expect(afterDrag.stackedCards.scaleStep).toBe(direct.stackedCards.scaleStep);
    expect(afterDrag.stackedCards.offsetStep).toBe(direct.stackedCards.offsetStep);
    expect(interactionIntensity(afterDrag)).toBe(20);
  });

  it("keeps card navigation manual on touch and marquee motion constant", () => {
    const next = withInteractionIntensity(base, 1, true);
    expect(next.styleVector.S).toBe(1);
    expect(next.marquee.bindToScroll).toBe(false);
    expect(next.marquee.pauseOnHover).toBe(false);
    expect(next.stackedCards.enableTilt).toBe(false);
    expect(next.stackedCards.autoPlay).toBe(false);
  });
});
