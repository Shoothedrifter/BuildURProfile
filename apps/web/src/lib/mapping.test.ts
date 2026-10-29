import { describe, expect, it } from "vitest";
import type { JobRole, StyleVector } from "../../../../packages/contracts/src/config";
import { styleToConfig } from "./mapping";

const uiRole: JobRole = "ui-ux-designer";

describe("styleToConfig", () => {
  it("clamps continuous scores and returns empty, source-safe content slots", () => {
    const config = styleToConfig(
      { E: -0.4, K: 1.8, P: Number.NaN, S: 0.7, PChoice: "vivid" },
      uiRole
    );

    expect(config.styleVector).toEqual({ E: 0, K: 1, P: 0.5, S: 0.7, PChoice: "vivid" });
    expect(config.skin).toBe("high-saturation");
    expect(config.content).toEqual({
      profile: {
        name: "", role: "", location: "", availability: "", intro: "", summary: "", email: ""
      },
      expertise: { eyebrow: "", headline: "", summary: "", skills: [], disciplines: [] },
      projects: []
    });
  });

  it("changes skin and multiple interaction parameters for different assessments of the same resume", () => {
    const restrained = styleToConfig(
      { E: 0.1, K: 0.1, P: 0.1, S: 0.1, PChoice: "neutral" },
      uiRole
    );
    const expressive = styleToConfig(
      { E: 0.9, K: 0.9, P: 0.9, S: 0.9, PChoice: "vivid" },
      uiRole
    );

    expect(restrained.skin).toBe("light-minimal");
    expect(expressive.skin).toBe("high-saturation");
    expect(expressive.marquee.speed).toBeGreaterThan(restrained.marquee.speed);
    expect(expressive.marquee.rows).toBeGreaterThan(restrained.marquee.rows);
    expect(expressive.stackedCards.scaleStep).toBeGreaterThan(restrained.stackedCards.scaleStep);
    expect(expressive.stackedCards.cardRadius).toBeGreaterThan(restrained.stackedCards.cardRadius);
    expect(restrained.marquee.bindToScroll).toBe(false);
    expect(expressive.marquee.bindToScroll).toBe(true);
    expect(restrained.stackedCards.autoPlay).toBe(true);
    expect(expressive.stackedCards.autoPlay).toBe(false);
  });

  it("keeps visual tone categorical while its continuous strength changes geometry", () => {
    const vector: StyleVector = { E: 0.5, K: 0.5, P: 0, S: 0.5, PChoice: "cool" };
    const subtle = styleToConfig(vector, uiRole);
    const strong = styleToConfig({ ...vector, P: 1 }, uiRole);

    expect(subtle.skin).toBe("dark-tech");
    expect(strong.skin).toBe("dark-tech");
    expect(strong.stackedCards.cardRadius).toBeGreaterThan(subtle.stackedCards.cardRadius);
  });

  it("uses each job role to choose different baseline composition", () => {
    const vector: StyleVector = { E: 0.3, K: 0.3, P: 0.3, S: 0.3, PChoice: "warm" };
    const ui = styleToConfig(vector, "ui-ux-designer");
    const frontend = styleToConfig(vector, "frontend-creative-developer");
    const brand = styleToConfig(vector, "brand-motion-copy");

    expect(ui.stackedCards.layout).toBe("center");
    expect(frontend.stackedCards.layout).toBe("offset");
    expect(brand.stackedCards.layout).toBe("fan");
    expect(frontend.marquee.speed).toBeGreaterThan(ui.marquee.speed);
    expect(brand.marquee.tileSize).toBeGreaterThan(ui.marquee.tileSize);
  });

  it("does not mutate inputs and produces the same JSON for identical inputs", () => {
    const vector = Object.freeze({ E: 0.72, K: 0.44, P: 0.28, S: 0.81, PChoice: "cool" as const });
    const first = styleToConfig(vector, uiRole);
    const second = styleToConfig(vector, uiRole);

    expect(vector).toEqual({ E: 0.72, K: 0.44, P: 0.28, S: 0.81, PChoice: "cool" });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).not.toBe(second);
    expect(first.content).not.toBe(second.content);
  });
});
