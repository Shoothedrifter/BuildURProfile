function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DEFAULT_CSS = `:root{color-scheme:dark light;--bg:#080d18;--surface:#111b2c;--text:#f1f6ff;--muted:#a7b6ca;--accent:#4de0d2;--line:#2b4354}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6}
.showcase-wrap{max-width:1120px;margin:0 auto;padding:48px 24px}.hero h1{font-size:clamp(36px,6vw,72px);margin:0 0 12px}.project-card{border:1px solid var(--line);background:var(--surface);padding:24px;border-radius:12px;margin:16px 0}
.project-detail{margin-top:12px}.project-detail summary{cursor:pointer;color:var(--accent)}`;

const DEFAULT_JS = `(() => {
  const root = document.getElementById("root");
  const raw = document.getElementById("buildurprofile-config")?.textContent;
  if (!root || !raw) return;
  const config = JSON.parse(raw);
  const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let active = 0;
  const projects = Array.isArray(config?.content?.projects) ? config.content.projects : [];
  function render() {
    const p = projects[active];
    root.innerHTML = \`<main class="showcase-wrap" data-skin="\${esc(config.skin)}">
      <section class="hero"><h1>\${esc(config?.content?.profile?.name)}</h1><p>\${esc(config?.content?.profile?.role)}</p><p>\${esc(config?.content?.profile?.intro)}</p></section>
      \${p ? \`<article class="project-card"><h3>\${esc(p.title)}</h3><p>\${esc(p.category)} · \${esc(p.year)}</p><details class="project-detail"><summary>完整项目说明</summary><div>\${esc(p.description)}</div></details></article>\` : ""}
      \${projects.length > 1 ? \`<div><button type="button" aria-label="Previous project" id="prev-btn">←</button><button type="button" aria-label="Next project" id="next-btn">→</button></div>\` : ""}
    </main>\`;
    document.getElementById("prev-btn")?.addEventListener("click", () => { active = (active - 1 + projects.length) % projects.length; render(); });
    document.getElementById("next-btn")?.addEventListener("click", () => { active = (active + 1) % projects.length; render(); });
  }
  render();
})();`;

export function buildStaticHtml(config, javascript = DEFAULT_JS, css = DEFAULT_CSS) {
  if (/<\/style/i.test(css)) throw new Error("Invalid export stylesheet.");
  const images = [
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
  return zipSingleHtml(buildStaticHtml(config));
}
