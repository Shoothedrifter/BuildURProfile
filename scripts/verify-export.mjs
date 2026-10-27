import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { buildStaticZip } from "../server/export.mjs";

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

for (const name of ["hwf", "hzy"]) {
  const config = JSON.parse(readFileSync(`src/__fixtures__/${name}.json`, "utf8"));
  const zip = buildStaticZip(config);
  const nameLength = zip.readUInt16LE(26), bodyLength = zip.readUInt32LE(18);
  if (zip.subarray(30, 30 + nameLength).toString() !== "index.html") throw new Error(`${name}: missing index.html`);
  const html = zip.subarray(30 + nameLength, 30 + nameLength + bodyLength).toString("utf8");
  const dom = new JSDOM(html, { url: `file:///tmp/${name}/index.html`, runScripts: "dangerously", pretendToBeVisual: true });
  const page = dom.window.document;
  try {
    await tick();
    if (page.querySelector(".hero h1")?.textContent !== config.content.profile.name) throw new Error(`${name}: hero did not render`);
    for (const [index, project] of config.content.projects.entries()) {
      if (page.querySelector(".project-card h3")?.textContent !== project.title) throw new Error(`${name}: project ${index + 1} title missing`);
      const detail = page.querySelector(".project-detail");
      detail?.querySelector("summary")?.click();
      if (!detail?.open || !detail.textContent.includes(project.description)) throw new Error(`${name}: project ${index + 1} full text unavailable`);
      if (index < config.content.projects.length - 1) {
        page.querySelector('button[aria-label="Next project"]')?.click();
        await tick();
      }
    }
    console.log(`${name}: offline renderer loaded ${config.content.projects.length} projects and full details`);
  } finally {
    dom.window.close();
  }
}
