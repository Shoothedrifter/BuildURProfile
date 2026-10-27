import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function buildStaticHtml(config, javascript, css) {
  if (/<\/style/i.test(css)) throw new Error("Invalid export stylesheet.");
  const images = [
    ...config.content.projects.map((project) => project.image),
    ...(config.marquee.items ?? []).map((item) => typeof item === "string" ? undefined : item.image)
  ];
  if (images.some((image) => image && !image.startsWith("data:image/"))) throw new Error("Export images must be embedded.");
  const safeConfig = JSON.stringify(config).replace(/</g, "\\u003c");
  const safeJs = javascript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src data:; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>BuildURProfile Showcase</title><style>${css}</style></head><body><div id="root"></div>
<script type="application/json" id="buildurprofile-config">${safeConfig}</script><script>${safeJs}</script></body></html>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipSingleHtml(html) {
  const filename = Buffer.from("index.html"), body = Buffer.from(html);
  if (body.length > 0xffffffff) throw new Error("Static site is too large.");
  const localLength = 30 + filename.length + body.length, centralLength = 46 + filename.length;
  const bytes = Buffer.alloc(localLength + centralLength + 22);
  const u16 = (offset, value) => bytes.writeUInt16LE(value, offset);
  const u32 = (offset, value) => bytes.writeUInt32LE(value, offset);
  const checksum = crc32(body);
  u32(0, 0x04034b50); u16(4, 20); u16(6, 0x0800); u16(8, 0);
  u32(14, checksum); u32(18, body.length); u32(22, body.length); u16(26, filename.length);
  filename.copy(bytes, 30); body.copy(bytes, 30 + filename.length);
  const central = localLength;
  u32(central, 0x02014b50); u16(central + 4, 20); u16(central + 6, 20);
  u16(central + 8, 0x0800); u16(central + 10, 0);
  u32(central + 16, checksum); u32(central + 20, body.length); u32(central + 24, body.length);
  u16(central + 28, filename.length); filename.copy(bytes, central + 46);
  const end = central + centralLength;
  u32(end, 0x06054b50); u16(end + 8, 1); u16(end + 10, 1);
  u32(end + 12, centralLength); u32(end + 16, central);
  return bytes;
}

export function buildStaticZip(config) {
  const javascript = readFileSync(join(root, "public/export/showcase.js"), "utf8");
  const css = readFileSync(join(root, "public/export/showcase.css"), "utf8");
  return zipSingleHtml(buildStaticHtml(config, javascript, css));
}
