import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";

const execute = promisify(execFile);
const defaultCommand = fileURLToPath(new URL("../../../data/avatar-venv/bin/mflux-generate-flux2-edit", import.meta.url));
const defaultCache = fileURLToPath(new URL("../../../data/avatar-model-cache", import.meta.url));

function referenceImages(portrait, recipe) {
  if (recipe.id !== "crayon-flat-naive" || recipe.referencePaths.length !== 2) return recipe.referencePaths;
  const { width, height } = imageSize(portrait.bytes);
  return [recipe.referencePaths[width / height < 0.75 ? 1 : 0]];
}

function promptFor(recipe) {
  return `Image 1 is the user's portrait and the sole source for identity, face, pose, clothing, accessories, and number of people. Other images are visual style references only; do not copy their people or objects. Redraw the person into one square animated-style portfolio hero portrait. Keep the original Wibi style background; no text, watermark, collage, or split screen.\n\nWibi style essentials:\n${recipe.localSummary || recipe.instructions}\n\nFull Wibi style instructions:\n${recipe.instructions}`;
}

export function createLocalImageProvider({
  command = process.env.AVATAR_MFLUX_COMMAND || defaultCommand,
  cacheRoot = process.env.AVATAR_MODEL_CACHE_ROOT || defaultCache,
  run = execute
} = {}) {
  return {
    async edit({ portrait, recipe }) {
      if (!existsSync(command)) {
        const error = new Error("本地 MFLUX 尚未安装。请运行 npm run setup:avatar:local。");
        error.code = "MFLUX_NOT_INSTALLED";
        throw error;
      }
      mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
      chmodSync(cacheRoot, 0o700);
      const workdir = mkdtempSync(join(tmpdir(), "buildurprofile-avatar-"));
      chmodSync(workdir, 0o700);
      try {
        const extension = portrait.mime === "image/png" ? ".png" : portrait.mime === "image/webp" ? ".webp" : ".jpg";
        const portraitPath = join(workdir, `portrait${extension}`);
        const promptPath = join(workdir, "prompt.txt");
        const outputPath = join(workdir, "output.png");
        writeFileSync(portraitPath, portrait.bytes, { mode: 0o600 });
        writeFileSync(promptPath, promptFor(recipe), { mode: 0o600 });
        const seed = createHash("sha256").update(portrait.bytes).update(recipe.id).digest().readUInt32BE(0) % 1_000_000_000;
        const args = ["--model", "mlx-community/flux2-klein-4b-8bit", "--base-model", "flux2-klein-4b",
          "--image-paths", portraitPath, ...referenceImages(portrait, recipe),
          "--prompt-file", promptPath, "--steps", "4", "--width", "1024", "--height", "1024",
          "--seed", String(seed), "--compute-precision", "float16", "--low-ram",
          "--no-exif", "--output", outputPath];
        try {
          await run(command, args, { env: { ...process.env, HF_HOME: cacheRoot, HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET || "1",
            HF_HUB_DISABLE_TELEMETRY: "1" },
            timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
        } catch (cause) {
          const error = new Error("本地 MFLUX 生图失败。请检查模型下载、GPU 内存和 worker 日志。", { cause });
          error.code = "MFLUX_FAILED";
          throw error;
        }
        if (!existsSync(outputPath)) {
          const error = new Error("本地 MFLUX 未输出成图。");
          error.code = "MFLUX_OUTPUT_MISSING";
          throw error;
        }
        return { bytes: readFileSync(outputPath), mime: "image/png" };
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    }
  };
}
