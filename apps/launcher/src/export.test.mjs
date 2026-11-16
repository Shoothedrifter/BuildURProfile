import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildStaticHtml } from "../../web/src/server/export.mjs";
import { cleanConfig } from "../../../packages/contracts/src/validation.mjs";

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
    assert.equal(dom.window.document.querySelector(".hero-artwork img")?.getAttribute("src"), cleaned.heroArtwork.assetUrl);
    assert.equal(dom.window.document.querySelector("#hero-title")?.getAttribute("aria-label"), cleaned.content.profile.name);
    const next = dom.window.document.querySelector('[aria-label="Next project"]');
    assert.ok(next);
    next.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(dom.window.document.body.textContent.includes(cleaned.content.projects[1].title));
  } finally { dom.window.close(); }
});
