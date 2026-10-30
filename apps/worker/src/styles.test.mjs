import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { listAvatarStyles, loadStyleRecipe } from "./styles.mjs";
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
  assert.match(recipe.localSummary, /纺织艺术玩偶/);
  assert.match(recipe.version, /^[a-f0-9]{40}$/);
});
