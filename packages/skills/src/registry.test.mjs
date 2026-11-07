import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultSkillRegistry, createSkillRegistry } from "./registry.ts";
import { listAvatarStyles, loadStyleRecipe } from "./wibi.ts";

const answers = { "e-presence": 2, "e-type": 2, "k-pace": 2, "k-cards": 2,
  "p-tone": 1, "p-strength": 2, "s-browse": 2, "s-control": 2 };
const content = { profile: { name: "张三", role: "", location: "", availability: "", intro: "", summary: "", email: "" },
  expertise: { eyebrow: "技能", headline: "技能与专长", summary: "", skills: ["编程语言：TypeScript"], disciplines: [] }, projects: [] };

test("default registry runs scoring, mapping and confirmed content as versioned skills", async () => {
  const registry = createDefaultSkillRegistry();
  assert.deepEqual(registry.list().map((skill) => skill.id), ["resume.extract.v1", "resume.parse.v1", "resume.confirm.v1",
    "assessment.score.v1", "design.map.v1", "resume.compose.v1", "avatar.wibi.v1", "artifact.qa.v1"]);
  const { vector } = await registry.run("assessment.score.v1", { answers }, { runtime: "worker" });
  const { config } = await registry.run("design.map.v1", { vector, role: "frontend-creative-developer" }, { runtime: "worker" });
  const composed = await registry.run("resume.compose.v1", { config, content: { ...content, sourceRefs: { secret: { page: 1, excerpt: "PDF 原文" } } } }, { runtime: "worker" });
  assert.equal(composed.config.content.profile.name, "张三");
  assert.deepEqual(composed.config.marquee.items, ["编程语言"]);
  assert.equal("sourceRefs" in composed.config.content, false);
  assert.deepEqual(await registry.run("artifact.qa.v1", { config: composed.config },
    { runtime: "worker", capabilities: { outputExists: () => false } }), { ok: true });
});

test("browser Skills extract, parse, and confirm without exposing PDF evidence in output", async () => {
  const registry = createDefaultSkillRegistry();
  const file = { name: "resume.pdf" };
  const extraction = await registry.run("resume.extract.v1", { file },
    { runtime: "browser", capabilities: { extractPdfText: async () => ({ text: "简历", pages: ["简历"] }) } });
  const parsed = registry.runSync("resume.parse.v1", { pages: extraction.pages },
    { runtime: "browser", capabilities: { parseResumePages: () => ({ name: { value: "张三" } }) } });
  const confirmed = registry.runSync("resume.confirm.v1", { draft: parsed.draft },
    { runtime: "browser", capabilities: { validateResumeDraft: () => [],
      toResumeContent: () => ({ ...content, sourceRefs: { name: { page: 1, excerpt: "原文" } } }) } });
  assert.deepEqual(confirmed.problems, []);
  assert.equal(confirmed.content.profile.name, "张三");
  assert.equal("sourceRefs" in confirmed.content, false);
  const invalid = registry.runSync("resume.confirm.v1", { draft: parsed.draft },
    { runtime: "browser", capabilities: { validateResumeDraft: () => ["请确认姓名"], toResumeContent: () => { throw new Error("must not compose"); } } });
  assert.deepEqual(invalid, { problems: ["请确认姓名"] });
  await assert.rejects(registry.run("resume.extract.v1", { file }, { runtime: "worker", capabilities: {} }), /不能在 worker/);
});

test("registry aborts a timed-out Skill and reports timeout", async () => {
  const registry = createSkillRegistry();
  let sawAbort = false;
  registry.register({ id: "slow.v1", version: "1", runtime: ["worker"], capabilities: [], timeoutMs: 10,
    license: { id: "internal", commercialAllowed: true }, validateInput: () => true, validateOutput: () => true,
    execute: (_input, _tools, { signal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { sawAbort = true; resolve({}); }, { once: true });
    }) });
  await assert.rejects(registry.run("slow.v1", {}, { runtime: "worker" }), /超时/);
  assert.equal(sawAbort, true);
});

test("registry rejects unapproved capabilities, duplicate ids, and commercial Wibi use", async () => {
  const registry = createSkillRegistry();
  registry.register({ id: "test.v1", version: "1", runtime: ["worker"], capabilities: ["outputExists"], timeoutMs: 1000,
    license: { id: "internal", commercialAllowed: true }, validateInput: () => true, validateOutput: () => true,
    execute: (_input, tools) => ({ ok: tools.outputExists("x") }) });
  assert.throws(() => registry.register({ id: "test.v1", version: "1", runtime: ["worker"], capabilities: [], timeoutMs: 1000,
    license: { id: "internal", commercialAllowed: true }, validateInput: () => true, validateOutput: () => true, execute: () => ({}) }), /已注册/);
  await assert.rejects(registry.run("test.v1", {}, { runtime: "worker", capabilities: { outputExists: () => true, paymentGateway: {} } }), /未批准的能力/);
  await assert.rejects(createDefaultSkillRegistry().run("avatar.wibi.v1", { taskId: "t", portraitAssetId: "p", styleId: "retro-flat-anime-head" },
    { runtime: "worker", usage: "commercial", capabilities: {} }), /非商业|授权/);
});

test("compose rejects malformed project content before a Skill reads it", async () => {
  const registry = createDefaultSkillRegistry();
  const { config } = await registry.run("design.map.v1", { vector: { E: 0.5, K: 0.5, P: 0.5, S: 0.5, PChoice: "neutral" },
    role: "ui-ux-designer" }, { runtime: "worker" });
  await assert.rejects(registry.run("resume.compose.v1", { config, content: { ...content, projects: [null] } },
    { runtime: "worker" }), /输入无效/);
});

test("avatar Skill fences output write with lease token and reuses an existing artifact", async () => {
  const calls = [];
  let existing = null;
  const capabilities = {
    readPortrait: () => ({ bytes: Buffer.from("photo"), mime: "image/png" }),
    storeOutput: (taskId, image, leaseToken) => { calls.push([taskId, image.mime, leaseToken]); existing = "asset-1"; return existing; },
    outputExists: (id) => id === existing,
    existingOutput: () => existing,
    imageProvider: { edit: async () => ({ bytes: Buffer.from("image"), mime: "image/png" }) },
    loadStyleRecipe: (id) => ({ id, version: "pinned", instructions: "style", referencePaths: [] })
  };
  const registry = createDefaultSkillRegistry();
  const input = { taskId: "task-1", portraitAssetId: "photo-1", styleId: "retro-flat-anime-head", leaseToken: "lease-1" };
  assert.deepEqual(await registry.run("avatar.wibi.v1", input, { runtime: "worker", capabilities }),
    { outputAssetId: "asset-1", recipeVersion: "pinned" });
  assert.deepEqual(calls, [["task-1", "image/png", "lease-1"]]);
  assert.deepEqual(await registry.run("avatar.wibi.v1", input, { runtime: "worker", capabilities }),
    { outputAssetId: "asset-1", recipeVersion: "pinned" });
  assert.equal(calls.length, 1);
});

test("Wibi adapter verifies pinned manifest and resources and exposes license", () => {
  assert.deepEqual(listAvatarStyles().map(({ id }) => id), ["retro-flat-anime-head", "yellow-hair-doodle", "lofi-print-anime"]);
  const recipe = loadStyleRecipe("yellow-hair-doodle");
  assert.equal(recipe.license, "MIT AND LicenseRef-Wibi-Personal-NonCommercial-1.0");
  assert.equal(recipe.sourceCommit, "17880b82ea35c1fe1ec4b8f907a053d314df464f");
  assert.equal(recipe.referencePaths.length, 0);
  assert.match(recipe.instructions, /#FFCB05/);
  assert.match(recipe.instructions, /双马尾.*扎点/s);
  assert.match(recipe.instructions, /不能把扎起的双马尾画成披发/);
  assert.match(recipe.instructions, /低双马尾.*耳后.*颈侧/s);
  assert.match(recipe.instructions, /不能抬成高双马尾/);
  assert.match(recipe.instructions, /扎点高低/);
  assert.match(recipe.instructions, /不新增眼镜/);
  assert.doesNotMatch(recipe.instructions, /顶部抬成一到两道高低不同的柔软发浪/);
  assert.notEqual(recipe.version, recipe.sourceCommit);
  assert.equal(loadStyleRecipe("lofi-print-anime").referencePaths.length, 0);
  assert.throws(() => loadStyleRecipe("crayon-flat-naive"), /未知肖像风格/);
  assert.throws(() => loadStyleRecipe("textile-toy-portrait"), /未知肖像风格/);
  assert.throws(() => loadStyleRecipe("../other"), /未知肖像风格/);
});
