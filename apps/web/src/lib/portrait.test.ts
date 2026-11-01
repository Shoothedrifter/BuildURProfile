import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePortrait } from "./portrait";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("preparePortrait", () => {
  it("turns a large phone photo into a small JPEG while keeping portrait detail", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 3024, height: 4032, close }));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(`data:image/jpeg;base64,${"A".repeat(100_000)}`);
    const file = new File([new Uint8Array(9_640_000)], "portrait.png", { type: "image/png" });

    const dataUrl = await preparePortrait(file);

    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(dataUrl.length).toBeLessThan(500_000);
    expect(drawImage).toHaveBeenCalled();
    const canvas = (HTMLCanvasElement.prototype.toDataURL as ReturnType<typeof vi.fn>).mock.contexts[0] as HTMLCanvasElement;
    expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(1024);
    expect(Math.min(canvas.width, canvas.height)).toBeGreaterThanOrEqual(256);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects photos too small for the server's minimum dimensions", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 200, height: 200, close }));
    const file = new File([new Uint8Array(100)], "small.png", { type: "image/png" });

    await expect(preparePortrait(file)).rejects.toThrow(/256/);
    expect(close).toHaveBeenCalledOnce();
  });
});
