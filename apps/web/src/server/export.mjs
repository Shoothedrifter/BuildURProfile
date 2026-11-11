import { cleanResumeV2, RESUME_KINDS, RESUME_LABELS, resumeImageIds, resumeDisplayContent } from '../../../../packages/contracts/src/resume-v2.mjs';
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

const V2_JS = `(() => {
  const cards = [...document.querySelectorAll('[data-export-project]')];
  if (!cards.length) return;
  let active = 0;
  const previous = document.getElementById('export-project-prev');
  const next = document.getElementById('export-project-next');
  function render() {
    cards.forEach((card, index) => { card.hidden = index !== active; });
    if (previous) previous.disabled = active === 0;
    if (next) next.disabled = active === cards.length - 1;
    const status = document.getElementById('export-project-status');
    if (status) status.textContent = (active + 1) + ' / ' + cards.length;
  }
  previous?.addEventListener('click', () => { active = Math.max(0, active - 1); render(); });
  next?.addEventListener('click', () => { active = Math.min(cards.length - 1, active + 1); render(); });
  render();
})();`;

function resumeHtml(resume, mediaPath, marquee) {
  const clean = cleanResumeV2(resume);
  const profile = resumeDisplayContent(clean).profile;
  const heading = kind => RESUME_LABELS[RESUME_KINDS.indexOf(kind)];
  const entryHtml = (item, kind) => {
    const facts = item.facts.filter(fact => fact.value.trim() &&
      !(kind === 'basicInfo' && ['name', 'email', 'location'].includes(fact.key)));
    const supplement = item.supplement;
    return `<article class="project-card" ${kind === 'projects' ? 'data-export-project' : ''}>
      ${item.title ? `<h3>${escapeHtml(item.title)}</h3>` : ''}
      ${item.details ? `<p class="resume-text">${escapeHtml(item.details)}</p>` : ''}
      ${facts.length ? `<dl>${facts.map(fact => `<dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd>`).join('')}</dl>` : ''}
      ${supplement.text ? `<p class="resume-text resume-supplement-text">${escapeHtml(supplement.text)}</p>` : ''}
      ${supplement.links.map(link => `<p><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || link.url)}</a></p>`).join('')}
      <div class="resume-image-grid">${supplement.images.map(image => `<figure><img src="${escapeHtml(mediaPath(image.imageId))}" alt="${escapeHtml(image.caption || '补充图片')}">${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ''}</figure>`).join('')}</div>
    </article>`;
  };
  const moduleHtml = section => `<section class="resume-section" aria-label="${heading(section.kind)}"><h2>${heading(section.kind)}</h2>
    ${section.kind === 'projects' ? '<div class="stacked-deck" aria-label="Selected work cards">' : ''}
    ${section.items.map(item => entryHtml(item, section.kind)).join('')}
    ${section.kind === 'projects' ? '</div>' : ''}
    ${section.kind === 'projects' && section.items.length > 1 ? '<div class="stacked-controls"><button id="export-project-prev" aria-label="Previous project">←</button><span id="export-project-status" aria-live="polite"></span><button id="export-project-next" aria-label="Next project">→</button></div>' : ''}
  </section>`;
  // The deck occupies the same fixed showcase position as the Web renderer.
  const projects = clean.sections.find(section => section.kind === 'projects');
  const modules = clean.sections.filter(section => section.kind !== 'projects');
  const labels=(marquee.items ?? []).map(item => typeof item === 'string' ? item : item.label).filter(Boolean);
  const ticker=labels.length >= 2 ? `<section class="ticker-section" aria-label="Skills highlights"><div class="marquee-track">${labels.map(label=>`<span>${escapeHtml(label)}</span>`).join('')}</div></section>` : '';
  return `<section class="hero"><h1>${escapeHtml(profile.name)}</h1>${[profile.role, profile.location, profile.availability].filter(Boolean).map(text => `<p>${escapeHtml(text)}</p>`).join('')}</section>
    ${ticker}${projects ? moduleHtml(projects) : ''}${modules.map(moduleHtml).join('')}
    ${profile.email ? `<section><h2>Contact</h2><a href="mailto:${escapeHtml(profile.email)}">${escapeHtml(profile.email)}</a></section>` : ''}`;
}
export function buildStaticHtml(config, javascript = DEFAULT_JS, css = DEFAULT_CSS, mediaPath = id => `assets/${id}`) {
  if (/<\/style/i.test(css)) throw new Error("Invalid export stylesheet.");
  const images = [
    ...config.content.projects.map((project) => project.image),
    ...(config.marquee.items ?? []).map((item) => typeof item === "string" ? undefined : item.image)
  ];
  if (images.some((image) => image && !image.startsWith("data:image/"))) throw new Error("Export images must be embedded.");
  const safeConfig = JSON.stringify(config).replace(/</g, "\\u003c");
  const enriched=config.content.resume?.version === "resume-v2";
  const safeJs = (enriched && javascript === DEFAULT_JS ? V2_JS : javascript).replace(/<\/script/gi, "<\\/script");
  const title = escapeHtml(config.content?.profile?.name ? `${config.content.profile.name} — BuildURProfile Showcase` : "BuildURProfile Showcase");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src data:; connect-src 'none'; media-src data:; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${title}</title><style>${css}
body:has([data-skin="light-minimal"]){--bg:#f7f4ed;--surface:#fff;--text:#20231f;--accent:#226f60;--line:#d5dbd6}
body:has([data-skin="high-saturation"]){--bg:#251951;--surface:#382775;--text:#fff6d9;--accent:#ffca43;--line:#7761b2}
.ticker-section{overflow:hidden;border-block:1px solid var(--line);padding:16px 0}.marquee-track{display:flex;width:max-content;gap:48px;animation:marquee 30s linear infinite}@keyframes marquee{to{transform:translateX(-25%)}}@media(prefers-reduced-motion:reduce){.marquee-track{animation:none}}
.stacked-deck{position:relative}.stacked-controls{display:flex;gap:16px;align-items:center}button{cursor:pointer;padding:10px 18px}button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.resume-image-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:16px}.resume-image-grid figure{margin:0}
.resume-text{white-space:pre-wrap;overflow-wrap:anywhere}figure img{max-width:100%;height:auto}a{color:var(--accent)}dd{margin-bottom:12px}</style></head><body><div id="root">${enriched ? `<main class="showcase-wrap" data-skin="${escapeHtml(config.skin)}">${resumeHtml(config.content.resume,mediaPath,config.marquee)}</main>` : ""}</div>
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

export function zipFiles(entries) {
  const local=[], central=[];let offset=0;
  for(const [name,data] of entries){
    const filename=Buffer.from(name),body=Buffer.from(data),checksum=crc32(body);
    if(!/^(index\.html|assets\/[A-Za-z0-9_-]+\.(png|jpg|webp))$/.test(name)) throw new Error('Unsafe export path');
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);
    header.writeUInt32LE(checksum,14);header.writeUInt32LE(body.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,body);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x0800,8);
    directory.writeUInt32LE(checksum,16);directory.writeUInt32LE(body.length,20);directory.writeUInt32LE(body.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);
    central.push(directory,filename);offset+=header.length+filename.length+body.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export function zipSingleHtml(html) { return zipFiles([['index.html',html]]); }
export function buildStaticZip(config, mediaReader) {
  const files=[],paths=new Map();
  for(const id of resumeImageIds(config)){
    if(!mediaReader) throw new Error('作品图片不可用，请重试导出。');
    const media=mediaReader(id),ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[media.mime];
    if(!ext) throw new Error('Unsupported export image');
    const path=`assets/${id}.${ext}`;paths.set(id,path);files.push([path,media.bytes]);
  }
  return zipFiles([['index.html',buildStaticHtml(config,DEFAULT_JS,DEFAULT_CSS,id=>paths.get(id))],...files]);
}
