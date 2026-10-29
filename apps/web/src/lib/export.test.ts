import { afterEach, describe, expect, it, vi } from "vitest";
import rawConfig from "../demo/config.json";
import type { DesignConfig } from "../../../../packages/contracts/src/config";
import { inlineConfigImages } from "./export";

afterEach(() => vi.unstubAllGlobals());

describe("publication asset preparation", () => {
  it("embeds project and marquee images before confirmed content is sent to the server", async () => {
    const config = rawConfig as DesignConfig;
    const withImages: DesignConfig = {
      ...config,
      marquee: { ...config.marquee, items: [{ label: "Logo", image: "https://example.test/logo.png" }] },
      content: { ...config.content, projects: [{ ...config.content.projects[0], image: "blob:project-art" }] }
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    })));
    const embedded = await inlineConfigImages(withImages);
    expect(embedded.content.projects[0].image).toBe("data:image/png;base64,AQID");
    expect(embedded.marquee.items?.[0]).toEqual({ label: "Logo", image: "data:image/png;base64,AQID" });
    expect(withImages.content.projects[0].image).toBe("blob:project-art");
  });

  it("rejects remote assets that cannot be embedded", async () => {
    const config = rawConfig as DesignConfig;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(inlineConfigImages({ ...config, content: { ...config.content,
      projects: [{ ...config.content.projects[0], image: "https://example.test/missing.png" }] } }))
      .rejects.toThrow(/embed.*image/i);
  });
});
