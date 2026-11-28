import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildStaticHtml } from "../../web/src/server/export.mjs";
import { createPixelFontService } from "../../web/src/server/pixel-font.mjs";
import { pixelFontGlyphs } from "../../web/src/lib/pixelFontLabels.mjs";
import { cleanConfig } from "../../../packages/contracts/src/validation.mjs";

test("cleanConfig keeps non-empty project sourceText and omits the key when absent", () => {
  const config = JSON.parse(readFileSync(new URL("../../web/src/fixtures/two-projects.json", import.meta.url)));
  config.content.projects[0].sourceText = "作品原文样例";
  const cleaned = JSON.parse(cleanConfig(config));
  assert.equal(cleaned.content.projects[0].sourceText, "作品原文样例");
  // 无该键的卡片输出不含该键（条件展开，与 image/link 同款）
  assert.equal("sourceText" in cleaned.content.projects[1], false);
});

test("offline export requires the macaron hero photo to be embedded like the artwork", () => {
  const config = JSON.parse(readFileSync(new URL("../../web/src/fixtures/two-projects.json", import.meta.url)));
  const clean = JSON.parse(cleanConfig({ ...config, templateId: "warm-macaron-v1",
    heroPhoto: { assetUrl: "data:image/jpeg;base64,aGVsbG8=", alt: "合成用户的个人照片" } }));
  assert.equal(buildStaticHtml(clean, "", "").includes("data:image/jpeg;base64,aGVsbG8="), true);
  const unembedded = { ...clean, heroPhoto: { assetUrl: "/api/portraits/x", alt: "合成用户的个人照片" } };
  assert.throws(() => buildStaticHtml(unembedded, "", ""), /embedded/);
});

test("offline export embeds the original macaron default portrait when no photo was uploaded", () => {
  const config = JSON.parse(readFileSync(new URL("../../web/src/fixtures/two-projects.json", import.meta.url)));
  const clean = JSON.parse(cleanConfig({ ...config, templateId: "warm-macaron-v1" }));
  const html = buildStaticHtml(clean, "", "");
  const art = readFileSync("apps/web/public/warm-macaron-default.svg").toString("base64");
  assert.ok(html.includes(`data:image/svg+xml;base64,${art}`));
  // 已上传照片的作品不再内嵌默认形象（导出 CSP 仅允许 data: 图片）。
  const withPhoto = JSON.parse(cleanConfig({ ...config, templateId: "warm-macaron-v1",
    heroPhoto: { assetUrl: "data:image/jpeg;base64,aGVsbG8=", alt: "合成用户的个人照片" } }));
  assert.equal(buildStaticHtml(withPhoto, "", "").includes(`data:image/svg+xml;base64,${art}`), false);
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

test("Pixel World offline export embeds the pixel label font subset for the owner name", async () => {
  const { expected } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
  const config = { ...expected.config, templateId: "pixel-world-v1" };
  const pixelFont = createPixelFontService();
  const name = config.content.profile?.name ?? "";
  const fontSubset = await pixelFont.readSubset(pixelFontGlyphs(name));
  const html = buildStaticHtml(JSON.parse(cleanConfig(config)), undefined, undefined, () => ({ bytes: Buffer.alloc(0), mime: "image/png" }), fontSubset);
  // 离线包内嵌 data URI 字体且遵守导出 CSP（font-src data:）
  assert.ok(html.includes('font-family:"FusionPixel"'));
  assert.ok(html.includes("data:font/woff2;base64,"));
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    // 组件在导出态不发起运行时字体请求，字形全部来自内嵌子集
    const injected = Array.from(dom.window.document.querySelectorAll("style"))
      .filter(node => (node.textContent ?? "").includes("/api/pixel-font"));
    assert.equal(injected.length, 0);
  } finally { dom.window.close(); }
});

test("Pixel World offline export opens project files in the continuous showcase with embedded media", async () => {
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
  const scrollTargets = [];
  function openExport(hash = "") {
    return new JSDOM(html, { url: `file:///tmp/showcase.html${hash}`, runScripts: "dangerously", pretendToBeVisual: true,
      beforeParse(window) {
        window.HTMLElement.prototype.scrollIntoView = function () { scrollTargets.push(this.id); };
      }
    });
  }
  async function waitForProjectDialog(document) {
    const deadline = Date.now() + 2_000;
    let detail = document.querySelector("dialog[open]");
    while (!detail && Date.now() < deadline) {
      await delay(20);
      detail = document.querySelector("dialog[open]");
    }
    assert.equal(detail?.querySelector("h2")?.textContent, "合成项目");
    return detail;
  }
  const dom = openExport();
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const page = dom.window.document.querySelector('[data-testid="pixel-world-page"]');
    assert.ok(page);
    const portrait = page.querySelector(".pixel-portrait").getAttribute("src");
    assert.match(portrait, /^data:image\/svg\+xml;base64,/);
    const art = readFileSync("apps/web/public/pixel-world-base.svg");
    assert.ok(Buffer.from(portrait.split(",")[1], "base64").equals(art), "the export embeds the original base SVG");
    const projectLink = page.querySelector('nav a[href="#works"]');
    assert.ok(projectLink);
    assert.equal(page.querySelector("h1").textContent, config.content.profile.name);
    assert.ok(page.querySelector("#works h2"));
    projectLink.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(dom.window.location.hash, "#works");
    assert.equal(page.querySelector("h1").textContent, config.content.profile.name);
    assert.equal(dom.window.document.activeElement?.textContent, "作品档案");
    const openProject = page.querySelector('a[href="#case=project-image"]');
    assert.ok(openProject);
    const scrollCount = scrollTargets.length;
    openProject.click();
    const detail = await waitForProjectDialog(page);
    assert.equal(scrollTargets.length, scrollCount, "opening a project leaves the archive at its current position");
    assert.equal(dom.window.location.hash, "#case=project-image");
    const imageCount = config.content.resume.sections.flatMap(s => s.items).flatMap(i => i.supplement.images).length;
    assert.ok(imageCount > 0);
    assert.equal(detail.querySelectorAll('img[src^="data:image/png;base64,"]').length, imageCount);
    assert.ok([...page.querySelectorAll("img")].every(img => img.getAttribute("src").startsWith("data:")));
    const direct = openExport("#case=project-image");
    try {
      const directDetail = await waitForProjectDialog(direct.window.document);
      directDetail.querySelector("button").click();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(direct.window.location.hash, "#works");
      assert.equal(direct.window.document.querySelector("dialog[open]"), null);
      assert.equal(direct.window.document.activeElement?.getAttribute("href"), "#case=project-image");
      assert.equal(scrollTargets.at(-1), "pixel-project-project-image", "closing a deep link lands at the project row");
    } finally { direct.window.close(); }
  } finally { dom.window.close(); }
});
