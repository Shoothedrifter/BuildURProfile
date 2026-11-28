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
import { cleanConfig, createPaymentService } from "../../web/src/server/service.mjs";

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

test("production policy requires confirmed brief and denies portrait generation but allows photo upload", async () => {
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-generation-policy-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1,
      allowPortraits: false, requireBrief: true });
    // 门控拆分：allowPortraits 只约束「发送给图像供应商」，上传照片进入私有资产区在生产亦可用。
    const uploaded = await service.savePortrait("owner", png);
    assert.match(uploaded.id, /^[a-f0-9-]{36}$/);
    await assert.rejects(async () => await service.enqueue("owner", { idempotencyKey: "missing" }), /确认简历/);
    await assert.rejects(async () => await service.enqueue("owner", { brief, portraitAssetId: "avatar", styleId: "lofi-print-anime",
      idempotencyKey: "portrait" }), /未启用肖像/);
    await assert.rejects(async () => await service.enqueueResume("owner", { resumeId: "missing", revision: 1,
      role: brief.role, templateId: "cyber-creator-v1", portraitAssetId: uploaded.id, idempotencyKey: "vendor-photo" }), /不存在/);
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
  // 门控拆分：allowPortraits=false 只禁止「发送给图像供应商」，上传照片进私有资产区仍可用。
  const directPhoto = await closed.savePortrait("owner", png);
  assert.match(directPhoto.id, /^[a-f0-9-]{36}$/);
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

test("warm macaron delivers the uploaded photo directly without a vendor portrait task", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "burp-macaron-photo-"));
  const db = await openDatabase();
  t.after(async () => { await db.close(); rmSync(root, { recursive: true, force: true }); });
  let time = Date.now();
  for (const owner of ["owner", "other"]) await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(owner, time, time + 365 * 86400000);
  const draft = structuredClone(JSON.parse(readFileSync("packages/contracts/fixtures/resume-draft.v1.json", "utf8")));
  await db.prepare("INSERT INTO resume_files(id,owner_session_id,file_name,size,page_count,uploaded_at,expires_at) VALUES(?,?,?,?,?,?,?)")
    .run(draft.fileId, "owner", "synthetic.pdf", 100, 1, time, time + 30 * 86400000);
  await db.prepare("INSERT INTO resumes(id,file_id,owner_session_id,status,draft_json,created_at,updated_at) VALUES(?,?,'owner','SUCCEEDED',?,?,?)")
    .run(draft.resumeId, draft.fileId, JSON.stringify(draft), time, time);
  const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time });
  const photo = await service.savePortrait("owner", png);
  const input = { resumeId: draft.resumeId, revision: 1, role: brief.role, templateId: "warm-macaron-v1",
    photoAssetId: photo.id, idempotencyKey: "macaron-photo" };
  const task = await service.enqueueResume("owner", input);
  assert.equal(task.status, "QUEUED");
  const row = await db.prepare("SELECT workflow_version,portrait_asset_id,style_id,resume_request_json FROM generations WHERE id=?").get(task.id);
  assert.equal(row.workflow_version, "python-agent-v6");
  // 直出照片不进入肖像生成链：无 portrait_asset_id、无风格，不发送给图像供应商。
  assert.equal(row.portrait_asset_id, null);
  assert.equal(row.style_id, null);
  assert.equal(JSON.parse(row.resume_request_json).photoAssetId, photo.id);
  const lease = await service.leaseNext();
  assert.equal(lease.portrait_asset_id, null);
  const content = JSON.parse(lease.brief_json).content;
  const base = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8")).expected.config;
  assert.equal(await service.complete(task.id, { leaseToken: lease.lease_token,
    config: { ...base, templateId: "warm-macaron-v1", content } }), true);
  const published = await service.getTask("owner", task.id);
  assert.ok(published.projectId);
  // 任务侧以预览 URL 形态返回 heroPhoto；自动创建的项目配置保持裸配置，不写死短期资产链接。
  assert.equal(published.config.heroPhoto.assetUrl, `/api/portraits/${photo.id}`);
  assert.equal(published.config.heroPhoto.alt, `${content.profile.name}的个人照片`);
  assert.equal("heroPhoto" in JSON.parse((await db.prepare("SELECT config_json FROM projects WHERE id=?").get(published.projectId)).config_json), false);
  // 幂等重放与互斥参数
  assert.equal((await service.enqueueResume("owner", input)).id, task.id);
  const second = await service.savePortrait("owner", png);
  await assert.rejects(async () => await service.enqueueResume("owner", { ...input, photoAssetId: second.id }), { status: 409 });
  await assert.rejects(async () => await service.enqueueResume("owner", { resumeId: draft.resumeId, revision: 1, role: brief.role,
    templateId: "warm-macaron-v1", portraitAssetId: photo.id, idempotencyKey: "macaron-vendor" }), { status: 400 });
  await assert.rejects(async () => await service.enqueueResume("owner", { resumeId: draft.resumeId, revision: 1, role: brief.role,
    templateId: "warm-macaron-v1", portraitAssetId: photo.id, photoAssetId: second.id, idempotencyKey: "macaron-both" }), { status: 400 });
  await assert.rejects(async () => await service.enqueueResume("owner", { ...input, styleId: "lofi-print-anime", idempotencyKey: "macaron-style" }), { status: 400 });
  await assert.rejects(async () => await service.enqueueResume("owner", { resumeId: draft.resumeId, revision: 1, role: brief.role,
    templateId: "warm-v1", photoAssetId: photo.id, idempotencyKey: "warm-direct" }), { status: 400 });
  await assert.rejects(async () => await service.enqueueResume("owner", { resumeId: draft.resumeId, revision: 1, role: brief.role,
    answers: {}, photoAssetId: photo.id, idempotencyKey: "legacy-direct" }), { status: 400 });
  await assert.rejects(async () => await service.enqueueResume("owner", { ...input, photoAssetId: "0b7fe4b9-0000-4000-8000-000000000000",
    idempotencyKey: "macaron-missing" }), { status: 404 });
  const foreign = await service.savePortrait("other", png);
  await assert.rejects(async () => await service.enqueueResume("owner", { ...input, photoAssetId: foreign.id, idempotencyKey: "macaron-foreign" }), { status: 404 });
  // 门控拆分：allowPortraits=false 只拦「发送给图像供应商」，直出链路在生产同样可用。
  const closed = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time, allowPortraits: false });
  const closedPhoto = await closed.savePortrait("owner", png);
  assert.equal((await closed.enqueueResume("owner", { ...input, photoAssetId: closedPhoto.id,
    idempotencyKey: "macaron-closed" })).status, "QUEUED");
  // 保存时服务端把预览 URL 内嵌为 data URL，并匹配自动创建的项目而不是新建。
  const payment = createPaymentService(db, { paymentConfig: null, now: () => time,
    readHeroPhotoAsset: (sessionId, id) => service.readAsset(sessionId, id, "portrait") });
  const saved = await payment.createProject("owner", published.config, draft.resumeId);
  assert.equal(saved.id, published.projectId);
  assert.equal(saved.config.heroPhoto.assetUrl, `data:image/png;base64,${png.split(",")[1]}`);
  assert.equal(saved.config.heroPhoto.alt, `${content.profile.name}的个人照片`);
  assert.equal(saved.revision, 2);
  const repeat = await payment.createProject("owner", published.config, draft.resumeId);
  assert.equal(repeat.revision, saved.revision);
  // 未接线照片读取器的服务不得静默保存短期链接。
  await assert.rejects(async () => await createPaymentService(db, { paymentConfig: null, now: () => time })
    .createProject("owner", published.config, draft.resumeId), { status: 400 });
  // 照片资产过期后：任务预览退场，已保存项目的内嵌照片与列表不受影响。
  time += 86400001;
  assert.equal((await service.getTask("owner", task.id)).config.heroPhoto, undefined);
  assert.equal((await payment.getProject("owner", saved.id)).config.heroPhoto.assetUrl, `data:image/png;base64,${png.split(",")[1]}`);
  assert.equal((await payment.listProjects("owner")).length, 1);
});

test("publicTask keeps the hero photo alt meaningful when the profile name is blank", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "burp-macaron-alt-"));
  const db = await openDatabase();
  t.after(async () => { await db.close(); rmSync(root, { recursive: true, force: true }); });
  const time = Date.now();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", time, time + 365 * 86400000);
  const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time });
  const photo = await service.savePortrait("owner", png);
  const base = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8")).expected.config;
  // 直插一条已成功的直出照片任务：姓名为空白时 alt 不得出现「的个人照片」裸前缀（与前端 设计师 兜底同口径）。
  const blankName = JSON.stringify({ ...base, templateId: "warm-macaron-v1",
    content: { ...base.content, profile: { ...base.content.profile, name: "  " } } });
  await db.prepare(`INSERT INTO generations(id,owner_session_id,idempotency_key,workflow_version,status,config_json,resume_request_json,created_at,updated_at)
    VALUES('blank-name-task','owner','blank-name','python-agent-v6','SUCCEEDED',?,?,'0','0')`)
    .run(blankName, JSON.stringify({ resumeId: "blank-resume", revision: 1, role: "frontend-creative-developer",
      templateId: "warm-macaron-v1", portraitAssetId: null, styleId: null, photoAssetId: photo.id }));
  const task = await service.getTask("owner", "blank-name-task");
  assert.equal(task.config.heroPhoto.assetUrl, `/api/portraits/${photo.id}`);
  assert.equal(task.config.heroPhoto.alt, "设计师的个人照片");
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
    // 直出照片走会话隔离的 /api/portraits/{id}，不经由 hero-assets。
    const portrait = await fetch(`${base}/api/portraits/${id}`, { headers: { cookie } });
    assert.equal(portrait.status, 200);
    assert.equal(portrait.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await portrait.arrayBuffer()).toString("base64"), png.split(",")[1]);
    assert.equal((await fetch(`${base}/api/portraits/${id}`, { headers: { cookie: otherCookie } })).status, 404);
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

test("project config cleans heroPhoto to alt plus embedded image and rejects other shapes", () => {
  const config = JSON.parse(readFileSync(new URL("../../web/src/demo/config.json", import.meta.url)));
  const clean = JSON.parse(cleanConfig({ ...config, templateId: "warm-macaron-v1",
    heroPhoto: { assetUrl: "data:image/webp;base64,aGVsbG8=", alt: "合成用户的个人照片", forged: "strip me" } }));
  assert.deepEqual(clean.heroPhoto, { assetUrl: "data:image/webp;base64,aGVsbG8=", alt: "合成用户的个人照片" });
  assert.throws(() => cleanConfig({ ...config, heroPhoto: 123 }), /照片/);
  assert.throws(() => cleanConfig({ ...config, heroPhoto: { assetUrl: "/api/portraits/x", alt: "" } }), /照片/);
  assert.throws(() => cleanConfig({ ...config, heroPhoto: { assetUrl: "data:image/gif;base64,aGVsbG8=", alt: "" } }), /照片/);
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
