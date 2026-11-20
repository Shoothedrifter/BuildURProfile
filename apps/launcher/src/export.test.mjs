import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildStaticHtml } from "../../web/src/server/export.mjs";
import { cleanConfig } from "../../../packages/contracts/src/validation.mjs";

test("cleanConfig keeps non-empty project sourceText and omits the key when absent", () => {
  const config = JSON.parse(readFileSync(new URL("../../web/src/fixtures/two-projects.json", import.meta.url)));
  config.content.projects[0].sourceText = "作品原文样例";
  const cleaned = JSON.parse(cleanConfig(config));
  assert.equal(cleaned.content.projects[0].sourceText, "作品原文样例");
  // 无该键的卡片输出不含该键（条件展开，与 image/link 同款）
  assert.equal("sourceText" in cleaned.content.projects[1], false);
});

test("offline export runs the shared showcase with embedded portrait and safe confirmed content", async () => {
  const config = JSON.parse(readFileSync(new URL("../../web/src/fixtures/two-projects.json", import.meta.url)));
  config.heroArtwork = { assetUrl: "data:image/png;base64,aGVsbG8=", styleId: "owned-style", alt: "Portrait" };
  config.content.sourceRefs = { secret: { page: 1, excerpt: "unconfirmed-private-text" } };
  config.content.profile.name = "测试 </script> 名字";
  const cleaned = JSON.parse(cleanConfig(config));
  const html = buildStaticHtml(cleaned);
  assert.ok(!html.includes("unconfirmed-private-text"));
  assert.ok(!html.includes("测试 </script> 名字"));
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(errors.length, 0, errors.map(String).join("\n"));
    assert.equal(dom.window.document.querySelector(".showcase-page")?.dataset.skin, cleaned.skin);
    assert.equal(dom.window.document.querySelector(".cyber-stage img")?.getAttribute("src"), cleaned.heroArtwork.assetUrl);
    assert.equal(dom.window.document.querySelector("#hero-title")?.getAttribute("aria-label"), cleaned.content.profile.name);
    const next = dom.window.document.querySelector('[aria-label="Next project"]');
    assert.ok(next);
    next.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(dom.window.document.body.textContent.includes(cleaned.content.projects[1].title));
  } finally { dom.window.close(); }
});

test("Pixel World offline export embeds its own default portrait and all project media", async () => {
  const { expected } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
  const config = { ...expected.config, templateId: "pixel-world-v1" };
  const sections = config.content.resume.sections;
  const basic = sections.find(section => section.kind === "basicInfo");
  const images = basic.items.flatMap(item => item.supplement.images);
  for (const item of basic.items) item.supplement.images = [];
  sections.push({ kind: "projects", order: 8, items: [{ order: 0, itemId: "project-image", title: "合成项目",
    details: "合成项目说明", facts: [], supplement: { text: "", links: [], images } }] });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=", "base64");
  const html = buildStaticHtml(JSON.parse(cleanConfig(config)), undefined, undefined, () => ({ bytes: png, mime: "image/png" }));
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const page = dom.window.document.querySelector('[data-testid="pixel-world-page"]');
    assert.ok(page);
    const art = readFileSync("apps/web/public/pixel-world-default.webp").toString("base64");
    assert.equal(page.querySelector(".pixel-portrait").getAttribute("src"), `data:image/webp;base64,${art}`);
    const imageCount = config.content.resume.sections.flatMap(s => s.items).flatMap(i => i.supplement.images).length;
    assert.ok(imageCount > 0);
    assert.equal(page.querySelectorAll('img[src^="data:image/png;base64,"]').length, imageCount);
    assert.ok([...page.querySelectorAll("img")].every(img => img.getAttribute("src").startsWith("data:")));
    assert.match(page.querySelector(".pixel-button").getAttribute("href"), /^#projects$/);
  } finally { dom.window.close(); }
});
