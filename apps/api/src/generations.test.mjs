import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./database.mjs";
import { createGenerationService } from "./generations.mjs";
import { createPaymentHttpServer } from "./http.mjs";
import { cleanConfig } from "./service.mjs";

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
    const upgraded = openDatabase(path);
    assert.deepEqual(upgraded.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version), [1, 2, 3, 4]);
    for (const name of ["brief_json", "workflow_version", "lease_token", "attempt_count", "next_attempt_at", "cancel_requested_at"]) {
      assert.ok(upgraded.prepare("PRAGMA table_info(generations)").all().some((column) => column.name === name));
    }
    upgraded.close();
    const reopened = openDatabase(path);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 4);
    reopened.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("worker heartbeat reports agent readiness without exposing task contents", () => {
  const db = openDatabase(":memory:");
  let time = Date.now();
  const root = mkdtempSync(join(tmpdir(), "burp-worker-health-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, now: () => time });
    assert.equal(service.workerHealthy(), false);
    service.touchWorker("worker_a");
    assert.equal(service.workerHealthy(), true);
    time += 45_001;
    assert.equal(service.workerHealthy(), false);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("generation accepts a minimal confirmed brief and rejects PDF provenance or extra answers", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-brief-"));
  try {
    const service = createGenerationService({ db, assetRoot: root });
    const task = service.enqueue("owner", { brief, idempotencyKey: "brief" });
    assert.equal(task.status, "QUEUED");
    const row = db.prepare("SELECT brief_json FROM generations WHERE id=?").get(task.id);
    assert.equal(JSON.parse(row.brief_json).content.profile.name, "张三");
    assert.throws(() => service.enqueue("owner", { brief: { ...brief,
      content: { ...brief.content, sourceRefs: { name: { page: 1, excerpt: "private" } } } }, idempotencyKey: "source" }), /原文|来源|字段/);
    assert.throws(() => service.enqueue("owner", { brief: { ...brief, answers: { ...brief.answers, pdfText: 0 } }, idempotencyKey: "extra" }), /答案|字段/);
    assert.throws(() => service.enqueue("owner", { brief: { ...brief, rawPdf: "private" }, idempotencyKey: "raw" }), /字段/);
    assert.throws(() => service.enqueue("owner", { brief: { ...brief, content: { ...brief.content, profile: {
      ...brief.content.profile, summary: "a".repeat(300000) } } }, idempotencyKey: "size" }), /过大|超过/);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("production policy requires confirmed brief and denies portrait generation", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-generation-policy-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1,
      allowPortraits: false, requireBrief: true });
    assert.throws(() => service.savePortrait("owner", png), /未启用肖像/);
    assert.throws(() => service.enqueue("owner", { idempotencyKey: "missing" }), /确认简历/);
    assert.throws(() => service.enqueue("owner", { brief, portraitAssetId: "avatar", styleId: "retro-flat-anime-head",
      idempotencyKey: "portrait" }), /未启用肖像/);
    assert.equal(service.enqueue("owner", { brief, idempotencyKey: "text" }).status, "QUEUED");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("lease heartbeat and completion are fenced by token", () => {
  const db = openDatabase(":memory:");
  let time = Date.now();
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, time + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-lease-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, now: () => time, leaseMs: 1000 });
    const task = service.enqueue("owner", { brief, idempotencyKey: "lease" });
    const first = service.leaseNext();
    assert.equal(first.id, task.id);
    assert.equal(first.attempt_count, 1);
    assert.equal(service.heartbeat(task.id, "wrong"), false);
    time += 500;
    assert.equal(service.heartbeat(task.id, first.lease_token), true);
    time += 1501;
    const second = service.leaseNext();
    assert.equal(second.id, task.id);
    assert.notEqual(second.lease_token, first.lease_token);
    assert.equal(second.attempt_count, 2);
    assert.equal(service.complete(task.id, { leaseToken: first.lease_token }), false);
    assert.equal(service.fail(task.id, "late", { leaseToken: first.lease_token }), false);
    assert.equal(service.complete(task.id, { leaseToken: second.lease_token }), true);
    assert.equal(service.getTask("owner", task.id).status, "SUCCEEDED");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("stale worker cannot publish an avatar asset after a replacement lease", () => {
  const db = openDatabase(":memory:");
  let time = Date.now();
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, time + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-fenced-output-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time, leaseMs: 1000 });
    const portrait = service.savePortrait("owner", png);
    const task = service.enqueue("owner", { brief, portraitAssetId: portrait.id,
      styleId: "retro-flat-anime-head", idempotencyKey: "fence" });
    const first = service.leaseNext();
    time += 1001;
    const second = service.leaseNext();
    const image = { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" };
    assert.throws(() => service.storeOutput(task.id, image, first.lease_token), /lease/);
    assert.equal(readdirSync(root).length, 1); // Only the source portrait remains.
    const heroId = service.storeOutput(task.id, image, second.lease_token);
    assert.equal(service.outputExists(heroId), true);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("retryable errors back off and stop after the configured attempt limit", () => {
  const db = openDatabase(":memory:");
  let time = Date.now();
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, time + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-retry-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, now: () => time,
      maxAttempts: 2, retryBaseMs: 1000 });
    const task = service.enqueue("owner", { brief, idempotencyKey: "retry" });
    const first = service.leaseNext();
    assert.equal(service.fail(task.id, "transient", { leaseToken: first.lease_token, retryable: true }), true);
    assert.equal(service.getTask("owner", task.id).status, "QUEUED");
    assert.equal(service.leaseNext(), null);
    time += 1001;
    const second = service.leaseNext();
    assert.equal(second.attempt_count, 2);
    assert.equal(service.fail(task.id, "still failing", { leaseToken: second.lease_token, retryable: true }), true);
    assert.equal(service.getTask("owner", task.id).status, "FAILED");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("owner cancellation removes queued work before any image API call", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("other", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-cancel-queued-"));
  try {
    const service = createGenerationService({ db, assetRoot: root });
    const task = service.enqueue("owner", { brief, idempotencyKey: "cancel-queued" });
    assert.throws(() => service.cancel("other", task.id), /不存在|无权/);
    assert.equal(service.cancel("owner", task.id).status, "CANCELLED");
    assert.equal(service.cancel("owner", task.id).status, "CANCELLED");
    assert.equal(service.leaseNext(), null);
    assert.equal(service.getTask("owner", task.id).status, "CANCELLED");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("running cancellation is visible and fences output; worker acknowledgment finishes it", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-cancel-running-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const portrait = service.savePortrait("owner", png);
    const task = service.enqueue("owner", { brief, portraitAssetId: portrait.id,
      styleId: "retro-flat-anime-head", idempotencyKey: "cancel-running" });
    const lease = service.leaseNext();
    assert.equal(service.getLeasedTask(task.id, lease.lease_token)?.id, task.id);
    assert.equal(service.getLeasedTask(task.id, "wrong"), null);
    assert.equal(service.cancel("owner", task.id).status, "CANCELLING");
    assert.equal(service.isCancelRequested(task.id, lease.lease_token), true);
    assert.equal(service.complete(task.id, { leaseToken: lease.lease_token }), false);
    assert.throws(() => service.storeOutput(task.id, { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" },
      lease.lease_token), /cancel/i);
    assert.equal(service.acknowledgeCancel(task.id, lease.lease_token), true);
    assert.equal(service.getLeasedTask(task.id, lease.lease_token), null);
    assert.equal(service.getTask("owner", task.id).status, "CANCELLED");
    assert.equal(service.leaseNext(), null);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("an abandoned cancelling lease becomes terminal without replaying the image call", () => {
  const db = openDatabase(":memory:");
  let time = Date.now();
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, time + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-cancel-expired-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, now: () => time, leaseMs: 1000 });
    const task = service.enqueue("owner", { brief, idempotencyKey: "cancel-expired" });
    const lease = service.leaseNext();
    assert.equal(service.cancel("owner", task.id).status, "CANCELLING");
    time += 1001;
    assert.equal(service.isCancelRequested(task.id, lease.lease_token), true);
    assert.equal(service.getLeasedTask(task.id, lease.lease_token), null);
    assert.equal(service.leaseNext(), null);
    assert.equal(service.getTask("owner", task.id).status, "CANCELLED");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("portrait storage validates bytes and binds assets to a session", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, Date.now() + 99999);
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("b", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    assert.throws(() => service.savePortrait("a", "data:image/png;base64,AAAA"), /图片|照片/);
    const asset = service.savePortrait("a", png);
    assert.match(asset.id, /^[a-f0-9-]{36}$/);
    assert.equal(service.readAsset("a", asset.id, "portrait").mime, "image/png");
    assert.throws(() => service.readAsset("b", asset.id, "portrait"), /不存在|无权/);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("portrait storage accepts a 9 MiB photo but rejects one above 10 MiB", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-size-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const header = Buffer.from(png.split(",")[1], "base64");
    const accepted = Buffer.concat([header, Buffer.alloc(9 * 1024 * 1024 - header.length)]);
    const asset = service.savePortrait("a", `data:image/png;base64,${accepted.toString("base64")}`);
    assert.equal(service.readAsset("a", asset.id, "portrait").bytes.length, accepted.length);
    const rejected = Buffer.concat([header, Buffer.alloc(10 * 1024 * 1024 + 1 - header.length)]);
    assert.throws(() => service.savePortrait("a", `data:image/png;base64,${rejected.toString("base64")}`), /最大 10 MiB/);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("failed asset metadata insert does not leave a private portrait file", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-orphan-photo-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    db.exec("CREATE TRIGGER reject_avatar_asset BEFORE INSERT ON avatar_assets BEGIN SELECT RAISE(ABORT, 'forced'); END;");
    assert.throws(() => service.savePortrait("owner", png), /forced/);
    assert.deepEqual(readdirSync(root), []);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("generation enqueue is idempotent and owner-only", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, Date.now() + 99999);
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("b", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const asset = service.savePortrait("a", png);
    const task = service.enqueue("a", { portraitAssetId: asset.id, styleId: "retro-flat-anime-head", idempotencyKey: "first" });
    assert.equal(service.enqueue("a", { portraitAssetId: asset.id, styleId: "retro-flat-anime-head", idempotencyKey: "first" }).id, task.id);
    assert.equal(service.getTask("a", task.id).status, "QUEUED");
    assert.throws(() => service.getTask("b", task.id), /不存在|无权/);
    assert.throws(() => service.enqueue("a", { portraitAssetId: asset.id, styleId: "other", idempotencyKey: "second" }), /未知肖像风格/);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("output storage is idempotent across worker restarts", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, Date.now() + 99999);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
    const portrait = service.savePortrait("a", png);
    const task = service.enqueue("a", { portraitAssetId: portrait.id, styleId: "retro-flat-anime-head", idempotencyKey: "once" });
    const bytes = Buffer.from(png.split(",")[1], "base64");
    const first = service.storeOutput(task.id, { bytes, mime: "image/png" });
    assert.equal(service.storeOutput(task.id, { bytes, mime: "image/png" }), first);
    assert.equal(service.outputExists(first), true);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("HTTP generation endpoints require CSRF and do not expose another session's asset", async () => {
  const db = openDatabase(":memory:");
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
    }, body: JSON.stringify({ brief, portraitAssetId: id, styleId: "retro-flat-anime-head", idempotencyKey: "http-hero" }) });
    assert.equal(queued.status, 201);
    const task = await queued.json();
    const heroId = generationService.storeOutput(task.id, { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" });
    assert.equal((await fetch(`${base}/api/hero-assets/${heroId}`, { headers: { cookie } })).status, 200);
    const other = await fetch(`${base}/api/session`);
    const otherCookie = other.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${base}/api/hero-assets/${heroId}`, { headers: { cookie: otherCookie } })).status, 404);
    const cancelTarget = generationService.enqueue(cookie.slice(13).split(".")[0], { brief, idempotencyKey: "http-cancel" });
    const cancelUrl = `${base}/api/generations/${cancelTarget.id}/cancel`;
    assert.equal((await fetch(cancelUrl, { method: "POST", headers: { cookie } })).status, 403);
    const otherCsrf = (await other.json()).csrfToken;
    assert.equal((await fetch(cancelUrl, { method: "POST", headers: { cookie: otherCookie, "x-csrf-token": otherCsrf } })).status, 404);
    const cancelled = await fetch(cancelUrl, { method: "POST", headers: { cookie, "x-csrf-token": csrfToken } });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).status, "CANCELLED");
  } finally { await new Promise((resolve) => server.close(resolve)); db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("paid project config refuses preview-only hero artwork", () => {
  const config = JSON.parse(readFileSync(new URL("../../web/src/demo/config.json", import.meta.url)));
  assert.throws(() => cleanConfig({ ...config, heroArtwork: { assetUrl: "/api/hero-assets/x", styleId: "retro-flat-anime-head", alt: "avatar" } }), /肖像|仅供预览/);
});

test("local generation limits model calls per session and removes expired photo files", () => {
  const db = openDatabase(":memory:");
  let time = Date.now();
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, time + 2 * 86400000);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time });
    const portrait = service.savePortrait("a", png);
    for (let i = 0; i < 5; i++) service.enqueue("a", { portraitAssetId: portrait.id, styleId: "retro-flat-anime-head", idempotencyKey: `try-${i}` });
    assert.throws(() => service.enqueue("a", { portraitAssetId: portrait.id, styleId: "retro-flat-anime-head", idempotencyKey: "try-6" }), /上限|次数/);
    const path = db.prepare("SELECT path FROM avatar_assets WHERE id=?").get(portrait.id).path;
    time += 86400001;
    assert.equal(service.purgeExpired(), 1);
    assert.equal(existsSync(path), false);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("expired hero is not returned as a successful preview", () => {
  const db = openDatabase(":memory:");
  let time = Date.now();
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("a", 1, time + 9 * 86400000);
  const root = mkdtempSync(join(tmpdir(), "burp-avatar-"));
  try {
    const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => time });
    const photo = service.savePortrait("a", png);
    const task = service.enqueue("a", { portraitAssetId: photo.id, styleId: "retro-flat-anime-head", idempotencyKey: "expiry" });
    service.storeOutput(task.id, { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" });
    service.complete(task.id);
    time += 7 * 86400000 + 1;
    const expired = service.getTask("a", task.id);
    assert.equal(expired.status, "EXPIRED");
    assert.equal(expired.heroArtwork, undefined);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
