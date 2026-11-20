import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PIXEL_AVATAR_STYLE_ID } from "./avatar-catalog.ts";

const referenceHash = "b65ec7cb2dff73cf18032787714a1af1faf15906a13b6ad854a7381b7a4e5e13";

function resourceRoot(): string {
  const cwd = process.cwd();
  const root = existsSync(/*turbopackIgnore: true*/ join(cwd, "packages/contracts/package.json")) ? cwd : resolve(cwd, "../..");
  return join(root, "packages/skills/src/resources/pixel-world-v1");
}

export function loadPixelAvatarRecipe(id: string, root = resourceRoot()) {
  if (id !== PIXEL_AVATAR_STYLE_ID) throw new Error("未知像素肖像配方。");
  const path = join(root, "reference.png");
  const reference = readFileSync(/*turbopackIgnore: true*/ path);
  if (createHash("sha256").update(reference).digest("hex") !== referenceHash) {
    throw new Error("像素肖像参考图校验失败。");
  }
  return {
    id, version: "1.0.0", manifestVersion: "1",
    license: "LicenseRef-BuildURProfile-Original-Preview-1.0", attribution: "BuildURProfile 原创像素角色",
    localSummary: "限定色板、方形硬边像素网格，单人头肩及上胸，轮廓清晰。",
    instructions: "Draw the person in image 0 as one centered original pixel-art bust. Copy the skin tone, hairstyle, and visible accessories from image 0 only. For bare eyes in image 0, draw bare eyes and keep the nose bridge clear. Only draw glasses when glasses are visible in image 0. Do not add frames, headset, jewelry or other accessories to a bare face. Image 1 is only for the size of pixel clusters and hard-edged shading. Draw head, shoulders and upper chest with a clear silhouette and two or three flat shade levels. Use exact solid #F000A8 for the entire background, without gradients, noise, shadow, border, props or text. Keep the head fully inside the square and the person centered.",
    referencePaths: [path]
  };
}
