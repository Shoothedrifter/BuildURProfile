import test from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../api/src/database.mjs";
import { createGenerationService } from "../../api/src/generations.mjs";
import { buildGenerationGraph } from "./graph.mjs";
import { openPrivateCheckpointer, runNextGeneration } from "./runner.mjs";
import { createLocalImageProvider } from "./provider-local.mjs";

test("LangGraph invokes selected style and provider, then verifies hero output", async () => {
  const calls = [];
  const graph = buildGenerationGraph({
    checkpointer: new MemorySaver(),
    styleLoader: (id) => { calls.push(`style:${id}`); return { id, version: "pinned", instructions: "style", referencePaths: [] }; },
    provider: { edit: async () => { calls.push("edit"); return { bytes: Buffer.from("image"), mime: "image/png" }; } },
    assets: { readPortrait: () => ({ bytes: Buffer.from("photo"), mime: "image/png" }),
      storeOutput: () => { calls.push("store"); return "hero-1"; }, outputExists: () => true }
  });
  const result = await graph.invoke({ taskId: "g1", portraitAssetId: "photo-1", styleId: "retro-flat-anime-head", configJson: null }, { configurable: { thread_id: "g1" } });
  assert.equal(result.outputAssetId, "hero-1");
  assert.deepEqual(result.heroArtwork, { assetId: "hero-1", styleId: "retro-flat-anime-head", templateId: "marquee-stacked-v1" });
  assert.deepEqual(calls, ["style:retro-flat-anime-head", "style:retro-flat-anime-head", "edit", "store"]);
  assert.deepEqual(result.trace, ["validateInput", "validateConfig", "loadStyleRecipe", "generateAvatar", "verifyAvatar", "assembleHero", "validateHero", "verifyArtifact"]);
  const state = await graph.getState({ configurable: { thread_id: "g1" } });
  assert.equal(state.values.outputAssetId, "hero-1");
  assert.ok(!JSON.stringify(state.values).includes("image"));
});

test("LangGraph no-photo branch does not call image provider", async () => {
  const graph = buildGenerationGraph({ checkpointer: new MemorySaver(), styleLoader: () => { throw new Error("unwanted"); },
    provider: { edit: () => { throw new Error("unwanted"); } }, assets: {} });
  const result = await graph.invoke({ taskId: "g2", portraitAssetId: null, styleId: null, configJson: null }, { configurable: { thread_id: "g2" } });
  assert.equal(result.outputAssetId, undefined);
  assert.ok(!result.trace.includes("generateAvatar"));
});

test("worker publishes a session-bound hero reference after a successful edit", async () => {
  const root = mkdtempSync(join(tmpdir(), "burp-complete-avatar-"));
  const db = openDatabase(join(root, "tasks.sqlite"));
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const service = createGenerationService({ db, assetRoot: join(root, "assets"), minPixels: 1 });
  try {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=";
    const photo = service.savePortrait("owner", dataUrl);
    const task = service.enqueue("owner", { portraitAssetId: photo.id, styleId: "retro-flat-anime-head", idempotencyKey: "complete" });
    const graph = buildGenerationGraph({ checkpointer: openPrivateCheckpointer(join(root, "checkpoints.sqlite")),
      styleLoader: (id) => ({ id, version: "pinned", instructions: "style", referencePaths: [] }),
      provider: { edit: async () => ({ bytes: Buffer.from(dataUrl.split(",")[1], "base64"), mime: "image/png" }) },
      assets: { readPortrait: service.readAssetForWorker, storeOutput: service.storeOutput,
        outputExists: service.outputExists, existingOutput: service.existingOutput } });
    assert.equal(await runNextGeneration({ service, graph }), true);
    const result = service.getTask("owner", task.id);
    assert.equal(result.status, "SUCCEEDED");
    assert.match(result.heroArtwork.assetUrl, /^\/api\/hero-assets\/[0-9a-f-]{36}$/);
    assert.equal(service.readAsset("owner", result.heroArtwork.assetUrl.split("/").at(-1)).kind, "hero");
    const state = await graph.getState({ configurable: { thread_id: task.id } });
    assert.equal(state.values.heroArtwork.assetId, result.heroArtwork.assetUrl.split("/").at(-1));
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("expired running job resumes with SQLite checkpoint after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "burp-worker-"));
  const db = openDatabase(join(root, "tasks.sqlite"));
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const service = createGenerationService({ db, assetRoot: join(root, "assets") });
  try {
    const task = service.enqueue("owner", { idempotencyKey: "resume" });
    db.prepare("UPDATE generations SET status='RUNNING',lease_until=0 WHERE id=?").run(task.id);
    const saver = SqliteSaver.fromConnString(join(root, "checkpoints.sqlite"));
    const graph = buildGenerationGraph({ checkpointer: saver, styleLoader: () => { throw new Error("unwanted"); },
      provider: { edit: () => { throw new Error("unwanted"); } }, assets: {} });
    assert.equal(await runNextGeneration({ service, graph }), true);
    assert.equal(service.getTask("owner", task.id).status, "SUCCEEDED");
    assert.equal((await graph.getState({ configurable: { thread_id: task.id } })).values.taskId, task.id);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("missing local image runtime fails the task without checkpointing photo bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "burp-no-mflux-"));
  const db = openDatabase(join(root, "tasks.sqlite"));
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const service = createGenerationService({ db, assetRoot: join(root, "assets"), minPixels: 1 });
  try {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=";
    const photo = service.savePortrait("owner", dataUrl);
    const task = service.enqueue("owner", { portraitAssetId: photo.id, styleId: "retro-flat-anime-head", idempotencyKey: "no-mflux" });
    const graph = buildGenerationGraph({ checkpointer: SqliteSaver.fromConnString(join(root, "checkpoints.sqlite")),
      styleLoader: () => ({ id: "retro-flat-anime-head", version: "pinned", instructions: "rules", referencePaths: [] }),
      provider: createLocalImageProvider({ command: join(root, "missing-cli") }), assets: { readPortrait: service.readAssetForWorker,
        storeOutput: service.storeOutput, outputExists: service.outputExists, existingOutput: service.existingOutput } });
    await runNextGeneration({ service, graph });
    assert.equal(service.getTask("owner", task.id).status, "FAILED");
    assert.match(service.getTask("owner", task.id).error, /MFLUX/);
    const checkpoint = JSON.stringify((await graph.getState({ configurable: { thread_id: task.id } })).values);
    assert.ok(!checkpoint.includes(dataUrl.split(",")[1]));
    assert.ok(!checkpoint.includes("rules"));
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("checkpoint SQLite file is owner-readable only", () => {
  const root = mkdtempSync(join(tmpdir(), "burp-private-checkpoint-"));
  try {
    const path = join(root, "state.sqlite");
    openPrivateCheckpointer(path);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
