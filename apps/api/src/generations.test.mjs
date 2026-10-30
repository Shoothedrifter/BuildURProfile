import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.mjs";
import { createGenerationService } from "./generations.mjs";
import { createPaymentHttpServer } from "./http.mjs";
import { cleanConfig } from "./service.mjs";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=";

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
    }, body: JSON.stringify({ portraitAssetId: id, styleId: "retro-flat-anime-head", idempotencyKey: "http-hero" }) });
    assert.equal(queued.status, 201);
    const task = await queued.json();
    const heroId = generationService.storeOutput(task.id, { bytes: Buffer.from(png.split(",")[1], "base64"), mime: "image/png" });
    assert.equal((await fetch(`${base}/api/hero-assets/${heroId}`, { headers: { cookie } })).status, 200);
    const other = await fetch(`${base}/api/session`);
    assert.equal((await fetch(`${base}/api/hero-assets/${heroId}`, { headers: { cookie: other.headers.get("set-cookie").split(";")[0] } })).status, 404);
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
