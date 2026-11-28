import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resumeImageIds } from '../../../../packages/contracts/src/resume-v2.mjs';
import { assertDeliverableConfig } from '../../../../packages/contracts/src/validation.mjs';
import { pixelFontFaceCss } from '../lib/pixelFontLabels.mjs';

const defaultPortraitAssets = new Map([
  ["cyber-creator-v1", { file: "cyber-neutral-print-anime.webp", mime: "image/webp" }],
  ["pixel-world-v1", { file: "pixel-world-base.svg", mime: "image/svg+xml" }],
  ["warm-macaron-v1", { file: "warm-macaron-default.svg", mime: "image/svg+xml" }]
]);

function repoRoot() {
  return existsSync(join(process.cwd(), "packages/contracts/package.json")) ? process.cwd() : resolve(process.cwd(), "../..");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportAssets() {
  const root = repoRoot();
  return {
    javascript: readFileSync(join(root, "apps/web/.export/showcase.js"), "utf8"),
    css: readFileSync(join(root, "apps/web/src/styles.css"), "utf8").replace(/^@import "tailwindcss";\s*/m, "")
  };
}

export function buildStaticHtml(config, javascript, css, mediaReader, fontSubset = null) {
  assertDeliverableConfig(config);
  if (javascript === undefined || css === undefined) {
    const assets = exportAssets();
    javascript ??= assets.javascript;
    css ??= assets.css;
  }
  if (/<\/style/i.test(css)) throw new Error("Invalid export stylesheet.");
  // 像素世界导出内嵌标签层字体子集（data URI 满足导出 CSP 的 font-src data:）。
  const fontCss = fontSubset && config.templateId === "pixel-world-v1"
    ? pixelFontFaceCss(`data:font/woff2;base64,${Buffer.from(fontSubset).toString("base64")}`)
    : "";
  const images = [
    config.heroArtwork?.assetUrl,
    config.heroArtwork?.cutoutAssetUrl,
    config.heroPhoto?.assetUrl,
    ...config.content.projects.map((project) => project.image),
    ...(config.marquee.items ?? []).map((item) => typeof item === "string" ? undefined : item.image)
  ];
  if (images.some((image) => image && !image.startsWith("data:image/"))) throw new Error("Export images must be embedded.");
  const resumeImages = {};
  for (const id of resumeImageIds(config)) {
    if (!mediaReader) throw new Error("作品图片不可用，请重试导出。");
    const media = mediaReader(id);
    if (!["image/png", "image/jpeg", "image/webp"].includes(media.mime)) throw new Error("Unsupported export image");
    resumeImages[id] = `data:${media.mime};base64,${Buffer.from(media.bytes).toString("base64")}`;
  }
  const safeConfig = JSON.stringify(config).replace(/</g, "\\u003c");
  const safeImages = JSON.stringify(resumeImages).replace(/</g, "\\u003c");
  const defaultAsset = defaultPortraitAssets.get(config.templateId);
  const defaultPortrait = defaultAsset && !config.heroArtwork && !config.heroPhoto
    ? `data:${defaultAsset.mime};base64,${readFileSync(join(repoRoot(), "apps/web/public", defaultAsset.file)).toString("base64")}`
    : "";
  const safeJs = javascript.replace(/<\/script/gi, "<\\/script");
  const title = escapeHtml(config.content?.profile?.name ? `${config.content.profile.name} — BuildURProfile Showcase` : "BuildURProfile Showcase");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src data:; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${title}</title>${fontCss ? `<style>${fontCss}</style>` : ""}<style>${css}</style></head><body><div id="root"></div>
<script type="application/json" id="buildurprofile-config">${safeConfig}</script>
<script type="application/json" id="buildurprofile-images">${safeImages}</script>
<script type="application/json" id="buildurprofile-default-portrait">${defaultPortrait}</script><script>${safeJs}</script></body></html>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipFiles(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, data] of entries) {
    if (!/^(index\.html|assets\/[A-Za-z0-9_-]+\.(png|jpg|webp))$/.test(name)) throw new Error('Unsafe export path');
    const filename = Buffer.from(name), body = Buffer.from(data), checksum = crc32(body);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, body);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename); offset += header.length + filename.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function buildStaticZip(config, mediaReader) {
  const assets = resumeImageIds(config).map(id => {
    const media = mediaReader(id);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[media.mime];
    if (!ext) throw new Error('Unsupported export image');
    return [`assets/${id}.${ext}`, media.bytes];
  });
  return zipFiles([['index.html', buildStaticHtml(config, undefined, undefined, mediaReader)], ...assets]);
}
