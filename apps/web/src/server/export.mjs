import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportAssets() {
  const root = existsSync(join(process.cwd(), "packages/contracts/package.json")) ? process.cwd() : resolve(process.cwd(), "../..");
  return {
    javascript: readFileSync(join(root, "apps/web/.export/showcase.js"), "utf8"),
    css: readFileSync(join(root, "apps/web/src/styles.css"), "utf8").replace(/^@import "tailwindcss";\s*/m, "")
  };
}

export function buildStaticHtml(config, javascript, css) {
  if (javascript === undefined || css === undefined) {
    const assets = exportAssets();
    javascript ??= assets.javascript; css ??= assets.css;
  }
  if (/<\/style/i.test(css)) throw new Error("Invalid export stylesheet.");
  const images = [
    config.heroArtwork?.assetUrl,
    ...config.content.projects.map((project) => project.image),
    ...(config.marquee.items ?? []).map((item) => typeof item === "string" ? undefined : item.image)
  ];
  if (images.some((image) => image && !image.startsWith("data:image/"))) throw new Error("Export images must be embedded.");
  const safeConfig = JSON.stringify(config).replace(/</g, "\\u003c");
  const safeJs = javascript.replace(/<\/script/gi, "<\\/script");
  const title = escapeHtml(config.content?.profile?.name ? `${config.content.profile.name} — BuildURProfile Showcase` : "BuildURProfile Showcase");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src data:; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${title}</title><style>${css}</style></head><body><div id="root"></div>
<script type="application/json" id="buildurprofile-config">${safeConfig}</script><script>${safeJs}</script></body></html>`;
}
