import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { listAvatarStyles, loadStyleRecipe } from "./styles.mjs";
import { createOpenAIImageProvider } from "./provider.mjs";
const installed = existsSync(new URL("../../../data/wibi-style-pinned/skills/retro-flat-anime-head/references/style-prompt.md", import.meta.url));

test("only the three selected portrait styles are registered", () => {
  assert.deepEqual(listAvatarStyles().map((style) => style.id), [
    "retro-flat-anime-head", "crayon-flat-naive", "textile-toy-portrait"
  ]);
  assert.throws(() => loadStyleRecipe("../other"), /未知肖像风格/);
});

test("pinned local recipe includes verified prompt and references", { skip: !installed }, () => {
  const recipe = loadStyleRecipe("textile-toy-portrait");
  assert.equal(recipe.id, "textile-toy-portrait");
  assert.equal(recipe.referencePaths.length, 1);
  assert.match(recipe.instructions, /玩偶|toy/);
  assert.match(recipe.version, /^[a-f0-9]{40}$/);
});

test("crayon style uses one close-up reference and keeps source portrait first", { skip: !installed }, async () => {
  let request;
  const client = { images: { edit: async (value) => { request = value; return { data: [{ b64_json: Buffer.from("result").toString("base64") }] }; } } };
  const provider = createOpenAIImageProvider({ client, model: "gpt-image-2.5-flare" });
  const portrait = { bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=", "base64"), mime: "image/png" };
  const result = await provider.edit({ portrait, recipe: loadStyleRecipe("crayon-flat-naive") });
  assert.equal(request.image.length, 2);
  assert.match(request.image[0].name, /portrait/);
  assert.match(request.image[1].name, /reference-01/);
  assert.equal(request.model, "gpt-image-2.5-flare");
  assert.equal(result.bytes.toString(), "result");
});
