import { openDatabase as openLegacyDatabase } from "../../../packages/storage/src/legacy-sqlite.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openTestDatabase as openDatabase } from "./postgres-test-db.mjs";
import { cleanGenerationBrief, createGenerationService } from "../../web/src/server/generations.mjs";
import { createAssetStore } from "../../../packages/storage/src/generation/assets.mjs";
import { createPaymentHttpServer } from "../../web/src/server/http.mjs";
import { cleanConfig } from "../../web/src/server/service.mjs";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=";
const brief = {
  role: "frontend-creative-developer",
  answers: { "e-presence": 2, "e-type": 2, "k-pace": 2, "k-cards": 2,
    "p-tone": 1, "p-strength": 2, "s-browse": 2, "s-control": 2 },
  content: {
    profile: { name: "张三", role: "开发者", location: "", availability: "", intro: "", summary: "", email: "" },
    expertise: { eyebrow: "", headline: "", summary: "", skills: ["React"], disciplines: [] },
    projects: []
  }
};

test("Pixel World contract requires confirmed content and preserves its template ID", () => {
  const config = JSON.parse(readFileSync(new URL("../../../packages/contracts/fixtures/agent-golden.v3.json", import.meta.url))).expected.config;
  const resume = JSON.parse(readFileSync(new URL("../../../packages/contracts/fixtures/resume-enrichment.v3.json", import.meta.url)));
  const content = { ...config.content, resume };
  const request = { role: brief.role, templateId: "pixel-world-v1", content };
  assert.equal(cleanGenerationBrief(request).templateId, "pixel-world-v1");
  const clean = JSON.parse(cleanConfig({ ...config, templateId: "pixel-world-v1", content, html: "<script>" }));
  assert.equal(clean.templateId, "pixel-world-v1");
  assert.equal(clean.html, undefined);
  const { resume: _resume, ...unconfirmedContent } = content;
  assert.throws(() => cleanConfig({ ...config, templateId: "pixel-world-v1", content: unconfirmedContent }), /新版简历/);
  assert.throws(() => cleanGenerationBrief({ ...request, answers: {} }), /字段无效/);
});

test("existing generation table upgrades through recorded schema migrations", () => {
  const root = mkdtempSync(join(tmpdir(), "burp-schema-migration-"));
  const path = join(root, "legacy.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE generations (
      id TEXT PRIMARY KEY, owner_session_id TEXT NOT NULL, portrait_asset_id TEXT, style_id TEXT,
      config_json TEXT, idempotency_key TEXT NOT NULL, status TEXT NOT NULL, output_asset_id TEXT,
      error TEXT, lease_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(owner_session_id,idempotency_key)
    )`);
    legacy.close();
    const upgraded = openLegacyDatabase(path);
    assert.deepEqual(upgraded.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.ok(upgraded.prepare("PRAGMA table_info(projects)").all().some((column) => column.name === "deleted_at"));
    for (const name of ["brief_json", "workflow_version", "lease_token", "attempt_count", "next_attempt_at", "cancel_requested_at", "cutout_asset_id"]) {
      assert.ok(upgraded.prepare("PRAGMA table_info(generations)").all().some((column) => column.name === name));
    }
    upgraded.close();
    const reopened = openLegacyDatabase(path);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 15);
    reopened.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("worker heartbeat reports agent readiness without exposing task contents", async () => {
  const db = await openDatabase();
  let time = Date.now();
  const root = mkdtempSync(join(tmpdir(), "burp-worker-health-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, now: () => time });
    assert.equal(await service.workerHealthy(), false);
    await service.touchWorker("worker_a");
    assert.equal(await service.workerHealthy(), true);
    time += 45_001;
    assert.equal(await service.workerHealthy(), false);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("generation keeps original and optional cutout as separate private assets", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99_999);
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("other", 1, Date.now() + 99_999);
  const root = mkdtempSync(join(tmpdir(), "burp-cutout-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const portrait = (await service.savePortrait("owner", png)).id;
    const config = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v1.json", "utf8")).expected.config;
    const task = await service.enqueue("owner", { portraitAssetId: portrait, styleId: "lofi-print-anime", config, idempotencyKey: "dual-artwork" });
    const leased = await service.leaseNext();
    const bytes = Buffer.from(png.split(",")[1], "base64");
    const originalId = await service.storeOutput(task.id, { bytes, mime: "image/png" }, leased.lease_token);
    const cutoutId = await service.storeCutout(task.id, { bytes, mime: "image/png" }, leased.lease_token);
    assert.notEqual(originalId, cutoutId);
    assert.equal(await service.complete(task.id, { leaseToken: leased.lease_token }), true);
    const artwork = (await service.getTask("owner", task.id)).heroArtwork;
    assert.equal(artwork.assetUrl, `/api/hero-assets/${originalId}`);
    assert.equal(artwork.cutoutAssetUrl, `/api/hero-assets/${cutoutId}`);
    assert.equal((await service.readArtworkAsset("owner", cutoutId)).mime, "image/png");
    await assert.rejects(async () => await service.readArtworkAsset("other", cutoutId), /无权访问/);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("generation accepts a minimal confirmed brief and rejects PDF provenance or extra answers", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-brief-"));
  try {
    const service = createGenerationService({ db, assetRoot: root });
    const task = await service.enqueue("owner", { brief, idempotencyKey: "brief" });
    assert.equal(task.status, "QUEUED");
    const row = await db.prepare("SELECT brief_json FROM generations WHERE id=?").get(task.id);
    assert.equal(JSON.parse(row.brief_json).content.profile.name, "张三");
    await assert.rejects(async () => await service.enqueue("owner", { brief: { ...brief,
      content: { ...brief.content, sourceRefs: { name: { page: 1, excerpt: "private" } } } }, idempotencyKey: "source" }), /原文|来源|字段/);
    await assert.rejects(async () => await service.enqueue("owner", { brief: { ...brief, answers: { ...brief.answers, pdfText: 0 } }, idempotencyKey: "extra" }), /答案|字段/);
    await assert.rejects(async () => await service.enqueue("owner", { brief: { ...brief, rawPdf: "private" }, idempotencyKey: "raw" }), /字段/);
    await assert.rejects(async () => await service.enqueue("owner", { brief: { ...brief, content: { ...brief.content, profile: {
      ...brief.content.profile, summary: "a".repeat(300000) } } }, idempotencyKey: "size" }), /过大|超过/);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});
test("a saved template config keeps the v5 workflow for later portrait regeneration", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-template-regenerate-"));
  try {
    const service = createGenerationService({ db, assetRoot: root });
    const config = readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8");
    const saved = JSON.parse(config).expected.config;
    const task = await service.enqueue("owner", { config: { ...saved, templateId: "cyber-creator-v1" }, idempotencyKey: "template-regeneration" });
    assert.equal((await db.prepare("SELECT workflow_version FROM generations WHERE id=?").get(task.id)).workflow_version, "python-agent-v6");
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("generation brief keeps project sourceText with the same shape as cleanConfig", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-brief-source-text-"));
  try {
    const service = createGenerationService({ db, assetRoot: root });
    const card = { id: "project_source", index: "01", title: "合成项目", category: "", year: "2024",
      description: "合成描述", tags: [], visual: "mint", sourceText: "一段合成原文" };
    const task = await service.enqueue("owner", { brief: { ...brief, content: { ...brief.content,
      projects: [card, { ...card, id: "project_blank", sourceText: "   " }] } }, idempotencyKey: "source-text" });
    const stored = JSON.parse((await db.prepare("SELECT brief_json FROM generations WHERE id=?").get(task.id)).brief_json);
    // 非空原文保留；空白串丢弃（与 cleanConfig 的条件展开一致，保证 complete 的内容一致性校验可过）
    assert.equal(stored.content.projects[0].sourceText, "一段合成原文");
    assert.equal("sourceText" in stored.content.projects[1], false);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("structured resume survives queue and publication without accepting PDF evidence", async () => {
  const resume = {
    version: "resume-v1",
    basicInfo: [{ key: "name", label: "姓名", value: "张三" }], jobIntent: [], selfEvaluation: [],
    education: [], workExperience: [], projects: [],
    awards: [{ title: "创新奖", details: "2023 创新奖", facts: [] }],
    campusExperience: [], skills: [], other: []
  };
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-resume-contract-"));
  try {
    const service = createGenerationService({ db, assetRoot: root });
    const task = await service.enqueue("owner", { brief: { ...brief, content: { ...brief.content, resume } }, idempotencyKey: "structured" });
    const row = await db.prepare("SELECT brief_json FROM generations WHERE id=?").get(task.id);
    assert.deepEqual(JSON.parse(row.brief_json).content.resume.awards, resume.awards);
    await assert.rejects(async () => await service.enqueue("owner", { brief: { ...brief, content: { ...brief.content,
      resume: { ...resume, awards: [{ ...resume.awards[0], source: "PDF text" }] } } }, idempotencyKey: "bad-source" }), /字段|来源|原文/);
    const config = JSON.parse(readFileSync("apps/web/src/demo/config.json", "utf8"));
    assert.deepEqual(JSON.parse(cleanConfig({ ...config, content: { ...config.content, resume } })).content.resume.awards, resume.awards);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("production policy requires confirmed brief and denies portrait generation", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-generation-policy-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1,
      allowPortraits: false, requireBrief: true });
    await assert.rejects(async () => await service.savePortrait("owner", png), /未启用肖像/);
    await assert.rejects(async () => await service.enqueue("owner", { idempotencyKey: "missing" }), /确认简历/);
    await assert.rejects(async () => await service.enqueue("owner", { brief, portraitAssetId: "avatar", styleId: "lofi-print-anime",
      idempotencyKey: "portrait" }), /未启用肖像/);
    assert.equal((await service.enqueue("owner", { brief, idempotencyKey: "text" })).status, "QUEUED");
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("lease heartbeat and completion are fenced by token", async () => {
  const db = await openDatabase();
  let time = Date.now();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, time + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-lease-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, now: () => time, leaseMs: 1000 });
    const task = await service.enqueue("owner", { brief, idempotencyKey: "lease" });
    const first = await service.leaseNext();
    assert.equal(first.id, task.id);
    assert.equal(first.attempt_count, 1);
    assert.equal(await service.heartbeat(task.id, "wrong"), false);
    time += 500;
    assert.equal(await service.heartbeat(task.id, first.lease_token), true);
    time += 1501;
    const second = await service.leaseNext();
    assert.equal(second.id, task.id);
    assert.notEqual(second.lease_token, first.lease_token);
    assert.equal(second.attempt_count, 2);
    assert.equal(await service.complete(task.id, { leaseToken: first.lease_token }), false);
    assert.equal(await service.fail(task.id, "late", { leaseToken: first.lease_token }), false);
    assert.equal(await service.complete(task.id, { leaseToken: second.lease_token }), true);
    assert.equal((await service.getTask("owner", task.id)).status, "SUCCEEDED");
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("stale worker cannot publish an avatar asset after a replacement lease", async () => {
  const db = await openDatabase();
  let time = Date.now();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, time + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-fenced-output-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time, leaseMs: 1000 });
    const portrait = await service.savePortrait("owner", png);
    const task = await service.enqueue("owner", { brief, portraitAssetId: portrait.id,
      styleId: "lofi-print-anime", idempotencyKey: "fence" });
    const first = await service.leaseNext();
    time += 1001;
    const second = await service.leaseNext();
    const image = { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" };
    await assert.rejects(async () => await service.storeOutput(task.id, image, first.lease_token), /lease/);
    assert.equal(readdirSync(root).length, 1); // Only the source portrait remains.
    const heroId = await service.storeOutput(task.id, image, second.lease_token);
    assert.equal(await service.outputExists(heroId), true);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("retryable errors back off and stop after the configured attempt limit", async () => {
  const db = await openDatabase();
  let time = Date.now();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, time + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-retry-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, now: () => time,
      maxAttempts: 2, retryBaseMs: 1000 });
    const task = await service.enqueue("owner", { brief, idempotencyKey: "retry" });
    const first = await service.leaseNext();
    assert.equal(await service.fail(task.id, "transient", { leaseToken: first.lease_token, retryable: true }), true);
    assert.equal((await service.getTask("owner", task.id)).status, "QUEUED");
    assert.equal(await service.leaseNext(), null);
    time += 1001;
    const second = await service.leaseNext();
    assert.equal(second.attempt_count, 2);
    assert.equal(await service.fail(task.id, "still failing", { leaseToken: second.lease_token, retryable: true }), true);
    assert.equal((await service.getTask("owner", task.id)).status, "FAILED");
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("owner cancellation removes queued work before any image API call", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("other", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-cancel-queued-"));
  try {
    const service = createGenerationService({ db, assetRoot: root });
    const task = await service.enqueue("owner", { brief, idempotencyKey: "cancel-queued" });
    await assert.rejects(async () => await service.cancel("other", task.id), /不存在|无权/);
    assert.equal((await service.cancel("owner", task.id)).status, "CANCELLED");
    assert.equal((await service.cancel("owner", task.id)).status, "CANCELLED");
    assert.equal(await service.leaseNext(), null);
    assert.equal((await service.getTask("owner", task.id)).status, "CANCELLED");
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("running cancellation is visible and fences output; worker acknowledgment finishes it", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-cancel-running-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const portrait = await service.savePortrait("owner", png);
    const task = await service.enqueue("owner", { brief, portraitAssetId: portrait.id,
      styleId: "lofi-print-anime", idempotencyKey: "cancel-running" });
    const lease = await service.leaseNext();
    assert.equal((await service.getLeasedTask(task.id, lease.lease_token))?.id, task.id);
    assert.equal(await service.getLeasedTask(task.id, "wrong"), null);
    assert.equal((await service.cancel("owner", task.id)).status, "CANCELLING");
    assert.equal(await service.isCancelRequested(task.id, lease.lease_token), true);
    assert.equal(await service.complete(task.id, { leaseToken: lease.lease_token }), false);
    await assert.rejects(async () => await service.storeOutput(task.id, { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" },
      lease.lease_token), /cancel/i);
    assert.equal(await service.acknowledgeCancel(task.id, lease.lease_token), true);
    assert.equal(await service.getLeasedTask(task.id, lease.lease_token), null);
    assert.equal((await service.getTask("owner", task.id)).status, "CANCELLED");
    assert.equal(await service.leaseNext(), null);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("an abandoned cancelling lease becomes terminal without replaying the image call", async () => {
  const db = await openDatabase();
  let time = Date.now();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, time + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-cancel-expired-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, now: () => time, leaseMs: 1000 });
    const task = await service.enqueue("owner", { brief, idempotencyKey: "cancel-expired" });
    const lease = await service.leaseNext();
    assert.equal((await service.cancel("owner", task.id)).status, "CANCELLING");
    time += 1001;
    assert.equal(await service.isCancelRequested(task.id, lease.lease_token), true);
    assert.equal(await service.getLeasedTask(task.id, lease.lease_token), null);
    assert.equal(await service.leaseNext(), null);
    assert.equal((await service.getTask("owner", task.id)).status, "CANCELLED");
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("portrait storage validates bytes and binds assets to a session", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, Date.now() + 99999);
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("b", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    await assert.rejects(async () => await service.savePortrait("a", "data:image/png;base64,AAAA"), /图片|照片/);
    const asset = await service.savePortrait("a", png);
    assert.match(asset.id, /^[a-f0-9-]{36}$/);
    assert.equal((await service.readAsset("a", asset.id, "portrait")).mime, "image/png");
    await assert.rejects(() => service.readAsset("b", asset.id, "portrait"), /不存在|无权/);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("private hero serves a compact sidecar and removes both files after expiry", async () => {
  const db = await openDatabase();
  const root = mkdtempSync(join(tmpdir(), "burp-hero-compact-"));
  let time = Date.now();
  try {
    await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", time, time + 8 * 24 * 60 * 60 * 1000);
    const assets = createAssetStore({ db, assetRoot: root, minPixels: 1, now: () => time, allowPortraits: true });
    const original = Buffer.from(png.split(",")[1], "base64");
    const compact = Buffer.from("synthetic compact image");
    const { id } = await assets.store("owner", "hero", original, "image/png");
    writeFileSync(join(root, `${id}.webp`), compact, { mode: 0o600 });
    assert.deepEqual(await assets.readAsset("owner", id), { bytes: compact, mime: "image/webp", kind: "hero" });
    await assert.rejects(() => assets.readAsset("other", id), /不存在|无权/);
    time += 7 * 24 * 60 * 60 * 1000 + 1;
    assert.equal(await assets.purgeExpired(), 1);
    assert.equal(existsSync(join(root, id)), false);
    assert.equal(existsSync(join(root, `${id}.webp`)), false);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("portrait storage accepts a 9 MiB photo but rejects one above 10 MiB", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-size-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const header = Buffer.from(png.split(",")[1], "base64");
    const accepted = Buffer.concat([header, Buffer.alloc(9 * 1024 * 1024 - header.length)]);
    const asset = await service.savePortrait("a", `data:image/png;base64,${accepted.toString("base64")}`);
    assert.equal((await service.readAsset("a", asset.id, "portrait")).bytes.length, accepted.length);
    const rejected = Buffer.concat([header, Buffer.alloc(10 * 1024 * 1024 + 1 - header.length)]);
    await assert.rejects(async () => await service.savePortrait("a", `data:image/png;base64,${rejected.toString("base64")}`), /最大 10 MiB/);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("failed asset metadata insert does not leave a private portrait file", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-orphan-photo-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    await db.exec("CREATE FUNCTION reject_avatar_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced'; END; $$; CREATE TRIGGER reject_avatar_asset BEFORE INSERT ON avatar_assets FOR EACH ROW EXECUTE FUNCTION reject_avatar_asset()");
    await assert.rejects(async () => await service.savePortrait("owner", png), /forced/);
    assert.deepEqual(readdirSync(root), []);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("new Pixel World photo tasks are local, session-owned and use the layered hair workflow", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "burp-pixel-photo-"));
  const db = await openDatabase();
  t.after(async () => { await db.close(); rmSync(root, { recursive: true, force: true }); });
  const now = Date.now();
  for (const owner of ["owner", "other"]) await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(owner, now, now + 100_000);
  const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
  const closed = createGenerationService({ db, assetRoot: root, minPixels: 1, allowPortraits: false });
  const { expected } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
  const config = { ...expected.config, templateId: "pixel-world-v1" };
  const { id: portraitAssetId } = await service.savePortrait("owner", png);
  const options = { config, portraitAssetId, idempotencyKey: "pixel-photo" };
  const task = await service.enqueue("owner", options);
  assert.equal((await service.enqueue("owner", options)).id, task.id);
  assert.equal((await db.prepare("SELECT style_id FROM generations WHERE id=?").get(task.id)).style_id, "pixel-halfbody-v1");
  const lease = await service.leaseNext({ supportsPixelWorld: true, supportsPixelLayeredHairAvatar: true });
  assert.equal(lease?.workflow_version, "python-agent-v10");
  await assert.rejects(() => closed.savePortrait("owner", png), { status: 403 });
  await assert.rejects(() => closed.enqueue("owner", options), { status: 403 });
  await assert.rejects(async () => await service.enqueue("other", options), { status: 404 });
  await assert.rejects(async () => await service.enqueue("owner", { ...options, styleId: "lofi-print-anime" }), { status: 400 });
  await assert.rejects(async () => await service.enqueue("owner", { brief, portraitAssetId, idempotencyKey: "legacy", styleId: "pixel-halfbody-v1" }), { status: 400 });
  await assert.rejects(async () => await service.enqueueResume("owner", { resumeId: "synthetic", revision: 1, role: brief.role,
    templateId: config.templateId, portraitAssetId, idempotencyKey: "pixel-with-brief" }), { status: 400 });
});

for (const workflowVersion of ["python-agent-v7", "python-agent-v8", "python-agent-v9"]) {
  test(`retrying an existing ${workflowVersion} Pixel World photo request preserves its original workflow`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "burp-pixel-replay-"));
    const db = await openDatabase();
    t.after(async () => { await db.close(); rmSync(root, { recursive: true, force: true }); });
    let now = Date.now();
    await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", now, now + 2 * 86400000);
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => now });
    const { expected } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
    const config = { ...expected.config, templateId: "pixel-world-v1" };
    const { id: portraitAssetId } = await service.savePortrait("owner", png);
    const request = { config, portraitAssetId, idempotencyKey: "pixel-before-deployment" };
    const task = await service.enqueue("owner", request);
    await db.prepare("UPDATE generations SET workflow_version=? WHERE id=?").run(workflowVersion, task.id);

    assert.equal((await service.enqueue("owner", request)).id, task.id);
    assert.equal((await service.leaseNext({ supportsPixelWorld: true, supportsPixelLayerAvatar: true, supportsPixelDetailedAvatar: true })).workflow_version, workflowVersion);
    now += 86400001;
    assert.equal((await service.enqueue("owner", request)).id, task.id);
    await assert.rejects(async () => await service.enqueue("owner", { ...request, idempotencyKey: "expired-new" }), { status: 404 });
    assert.equal((await db.prepare("SELECT count(*) n FROM generations").get()).n, 1);
  });
}

for (const workflowVersion of ["python-agent-v8", "python-agent-v9", "python-agent-v10"]) {
  test(`a stored ${workflowVersion} Pixel World candidate gets one completion lease after the retry cap`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "burp-pixel-completion-"));
    const db = await openDatabase();
    t.after(async () => { await db.close(); rmSync(root, { recursive: true, force: true }); });
    let now = Date.now();
    await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", now, now + 86400000);
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => now, leaseMs: 1000, maxAttempts: 1 });
    const { expected } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
    const photo = await service.savePortrait("owner", png);
    const task = await service.enqueue("owner", { config: { ...expected.config, templateId: "pixel-world-v1" },
      portraitAssetId: photo.id, idempotencyKey: "completion-after-last-attempt" });
    if (workflowVersion !== "python-agent-v10") {
      await db.prepare("UPDATE generations SET workflow_version=? WHERE id=?").run(workflowVersion, task.id);
    }
    const caps = { supportsPixelWorld: true, supportsPixelLayerAvatar: true, supportsPixelDetailedAvatar: true, supportsPixelLayeredHairAvatar: true };
    const initialLease = await service.leaseNext(caps);
    assert.equal(initialLease?.workflow_version, workflowVersion);
    const assetId = await service.storeOutput(task.id,
      { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" }, initialLease.lease_token);

    now += 1001;
    const completionLease = await service.leaseNext(caps);
    assert.equal(completionLease?.output_asset_id, assetId);
    assert.equal(completionLease?.attempt_count, 2);
    assert.notEqual(completionLease?.lease_token, initialLease.lease_token);
    now += 1001;
    assert.equal(await service.leaseNext(caps), null);
    assert.equal((await service.getTask("owner", task.id)).status, "FAILED");
  });
}

test("cyber template derives its fixed portrait style and rejects a mismatched choice", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-cyber-portrait-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const portrait = await service.savePortrait("owner", png);
    const saved = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8")).expected.config;
    const cyber = { ...saved, templateId: "cyber-creator-v1" };
    const task = await service.enqueue("owner", { config: cyber, portraitAssetId: portrait.id, idempotencyKey: "cyber-auto" });
    assert.equal((await db.prepare("SELECT style_id FROM generations WHERE id=?").get(task.id)).style_id, "lofi-print-anime");
    assert.equal((await service.enqueue("owner", { config: cyber, portraitAssetId: portrait.id, idempotencyKey: "cyber-auto" })).id, task.id);
    await assert.rejects(async () => await service.enqueue("owner", { config: cyber, portraitAssetId: portrait.id,
      styleId: "retro-flat-anime-head", idempotencyKey: "cyber-retro" }), /头像风格|模板/);
    await assert.rejects(async () => await service.enqueue("owner", { config: { ...saved, templateId: "warm-v1" },
      portraitAssetId: portrait.id, idempotencyKey: "warm-photo" }), /暂不支持/);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("generation enqueue is idempotent and owner-only", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, Date.now() + 99999);
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("b", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const asset = await service.savePortrait("a", png);
    const task = await service.enqueue("a", { portraitAssetId: asset.id, styleId: "lofi-print-anime", idempotencyKey: "first" });
    assert.equal((await service.enqueue("a", { portraitAssetId: asset.id, styleId: "lofi-print-anime", idempotencyKey: "first" })).id, task.id);
    assert.equal((await service.getTask("a", task.id)).status, "QUEUED");
    await assert.rejects(async () => await service.getTask("b", task.id), /不存在|无权/);
    await assert.rejects(async () => await service.enqueue("a", { portraitAssetId: asset.id, styleId: "retro-flat-anime-head", idempotencyKey: "retired" }), /未知肖像风格/);
    await assert.rejects(async () => await service.enqueue("a", { portraitAssetId: asset.id, styleId: "yellow-hair-doodle", idempotencyKey: "second" }), /未知肖像风格/);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("output storage is idempotent across worker restarts", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const portrait = await service.savePortrait("a", png);
    const task = await service.enqueue("a", { portraitAssetId: portrait.id, styleId: "lofi-print-anime", idempotencyKey: "once" });
    const bytes = Buffer.from(png.split(",")[1], "base64");
    const first = await service.storeOutput(task.id, { bytes, mime: "image/png" });
    assert.equal(await service.storeOutput(task.id, { bytes, mime: "image/png" }), first);
    assert.equal(await service.outputExists(first), true);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("HTTP generation endpoints require CSRF and do not expose another session's asset", async () => {
  const db = await openDatabase();
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  const generationService = createGenerationService({ db, assetRoot: root, minPixels: 1 });
  const server = createPaymentHttpServer({ db, service: {}, generationService, paymentConfig: null, priceFen: null });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const start = await fetch(`${base}/api/session`);
    const cookie = start.headers.get("set-cookie").split(";")[0];
    const { csrfToken } = await start.json();
    const denied = await fetch(`${base}/api/portraits`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ dataUrl: png }) });
    assert.equal(denied.status, 403);
    const upload = await fetch(`${base}/api/portraits`, { method: "POST", headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" }, body: JSON.stringify({ dataUrl: png }) });
    assert.equal(upload.status, 201);
    const { id } = await upload.json();
    assert.equal((await fetch(`${base}/api/hero-assets/${id}`, { headers: { cookie } })).status, 404);
    const queued = await fetch(`${base}/api/generations`, { method: "POST", headers: {
      cookie, "x-csrf-token": csrfToken, "content-type": "application/json"
    }, body: JSON.stringify({ brief, portraitAssetId: id, styleId: "lofi-print-anime", idempotencyKey: "http-hero" }) });
    assert.equal(queued.status, 201);
    const task = await queued.json();
    const heroId = await generationService.storeOutput(task.id, { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" });
    assert.equal((await fetch(`${base}/api/hero-assets/${heroId}`, { headers: { cookie } })).status, 200);
    const other = await fetch(`${base}/api/session`);
    const otherCookie = other.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${base}/api/hero-assets/${heroId}`, { headers: { cookie: otherCookie } })).status, 404);
    const cancelTarget = await generationService.enqueue(cookie.slice(13).split(".")[0], { brief, idempotencyKey: "http-cancel" });
    const cancelUrl = `${base}/api/generations/${cancelTarget.id}/cancel`;
    assert.equal((await fetch(cancelUrl, { method: "POST", headers: { cookie } })).status, 403);
    const otherCsrf = (await other.json()).csrfToken;
    assert.equal((await fetch(cancelUrl, { method: "POST", headers: { cookie: otherCookie, "x-csrf-token": otherCsrf } })).status, 404);
    const cancelled = await fetch(cancelUrl, { method: "POST", headers: { cookie, "x-csrf-token": csrfToken } });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).status, "CANCELLED");
  } finally { await new Promise((resolve) => server.close(resolve)); await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("project config refuses an unembedded private hero asset URL", () => {
  const config = JSON.parse(readFileSync(new URL("../../web/src/demo/config.json", import.meta.url)));
  assert.throws(() => cleanConfig({ ...config, heroArtwork: { assetUrl: "/api/hero-assets/x", styleId: "lofi-print-anime", alt: "avatar" } }), /肖像/);
});

test("local generation allows repeated portrait tests and removes expired photo files", async () => {
  const db = await openDatabase();
  let time = Date.now();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, time + 2 * 86400000);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time });
    const portrait = await service.savePortrait("a", png);
    for (let i = 0; i < 7; i++) {
      assert.equal((await service.enqueue("a", { portraitAssetId: portrait.id, styleId: "lofi-print-anime", idempotencyKey: `try-${i}` })).status, "QUEUED");
    }
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM generations WHERE owner_session_id='a' AND portrait_asset_id IS NOT NULL").get()).count, 7);
    const path = (await db.prepare("SELECT path FROM avatar_assets WHERE id=?").get(portrait.id)).path;
    time += 86400001;
    assert.equal(await service.purgeExpired(), 1);
    assert.equal(existsSync(path), false);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("expired hero is not returned as a successful preview", async () => {
  const db = await openDatabase();
  let time = Date.now();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, time + 9 * 86400000);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time });
    const photo = await service.savePortrait("a", png);
    const task = await service.enqueue("a", { portraitAssetId: photo.id, styleId: "lofi-print-anime", idempotencyKey: "expiry" });
    await service.storeOutput(task.id, { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" });
    await service.complete(task.id);
    time += 7 * 86400000 + 1;
    const expired = await service.getTask("a", task.id);
    assert.equal(expired.status, "EXPIRED");
    assert.equal(expired.heroArtwork, undefined);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("an attached Pixel World candidate with a missing file cannot be reused", async () => {
  const db = await openDatabase();
  const root = mkdtempSync(join(tmpdir(), "burp-pixel-missing-output-"));
  try {
    const time = Date.now();
    await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", time, time + 86400000);
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time });
    const config = JSON.parse(readFileSync(new URL("../../../packages/contracts/fixtures/agent-golden.v3.json", import.meta.url))).expected.config;
    const portrait = await service.savePortrait("a", png);
    const task = await service.enqueue("a", { portraitAssetId: portrait.id, idempotencyKey: "missing-result",
      config: { ...config, templateId: "pixel-world-v1" } });
    const lease = await service.leaseNext({ supportsPixelWorld: true, supportsPixelLayeredHairAvatar: true });
    const assetId = await service.storeOutput(task.id, { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" }, lease.lease_token);
    assert.equal(await service.outputExists(assetId), true);
    rmSync(join(root, assetId));
    assert.equal((await service.getLeasedTask(task.id, lease.lease_token)).output_asset_id, assetId);
    assert.equal(await service.outputExists(assetId), false);
    await assert.rejects(async () => await service.readArtworkAsset("a", assetId), { status: 404 });
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});
