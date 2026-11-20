import subsetFont from "subset-font";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Fusion Pixel 12px monospaced（OFL，见同目录 fusion-pixel-OFL.txt）。
// 只随请求子集化输出 woff2，完整字体不进入公开目录。
function defaultFontPath() {
  const cwd = process.cwd();
  const root = existsSync(join(cwd, "packages/contracts/package.json")) ? cwd : resolve(cwd, "../..");
  return join(root, "apps/web/assets/fonts/fusion-pixel-12px-monospaced-zh_hans.otf");
}

export function createPixelFontService({ fontPath = defaultFontPath(), maxCacheEntries = 64 } = {}) {
  let fontBuffer = null;
  const cache = new Map();
  return {
    // text：已通过路由校验的去重字形串；同字串命中内存缓存。
    async readSubset(text) {
      const cached = cache.get(text);
      if (cached) return cached;
      fontBuffer ??= readFileSync(fontPath);
      const woff2 = await subsetFont(fontBuffer, text, { targetFormat: "woff2" });
      if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
      cache.set(text, woff2);
      return woff2;
    }
  };
}
