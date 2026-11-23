import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDatabase as openDatabase } from "./postgres-test-db.mjs";
import { createGenerationService } from "../../../packages/storage/src/generations.mjs";
import { styleToConfig } from "../../../packages/skills/src/mapping.ts";
import { createPaymentHttpServer, createRequestHandler, dispatchWebRequest } from "../../web/src/server/http.mjs";

const token = "a".repeat(64);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=", "base64");
const brief = { role: "frontend-creative-developer", answers: { "e-presence": 2, "e-type": 2,
  "k-pace": 2, "k-cards": 2, "p-tone": 0, "p-strength": 2, "s-browse": 2, "s-control": 2 },
content: { profile: { name: "测试用户", role: "", location: "", availability: "", intro: "", summary: "", email: "" },
  expertise: { eyebrow: "", headline: "", summary: "", skills: [], disciplines: [] }, projects: [] } };
const vector = { E: 0.5, K: 0.5, P: 0.5, S: 0.5, PChoice: "cool" };
function config() {
  const mapped = styleToConfig(vector, "frontend-creative-developer");
  return { ...mapped, content: brief.content };
}
function jsonHeaders(extra = {}) { return { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra }; }
async function post(base, path, body, headers = {}) {
  return fetch(`${base}${path}`, { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify(body) });
}
function agentRequests(db, generationService) {
  const handler = createRequestHandler({ db, service: {}, generationService, portraitEnabled: true,
    agentToken: token, secret: Buffer.alloc(32, 7) });
  return (path, body, headers = {}) => dispatchWebRequest(new Request(`http://test/_internal/agent/${path}`, {
    method: body === undefined ? "GET" : "POST", headers: jsonHeaders(headers),
    body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  }), handler);
}

test("internal Agent bridge requires token and leases only the versioned public brief", async () => {
  const root = mkdtempSync(join(tmpdir(), "burp-agent-bridge-"));
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 100_000);
  const generationService = createGenerationService({ db, assetRoot: join(root, "assets"), allowPortraits: false });
  const task = await generationService.enqueue("owner", { brief, idempotencyKey: "bridge-no-photo" });
  const server = createPaymentHttpServer({ db, service: {}, generationService, portraitEnabled: false,
    agentToken: token, secret: Buffer.alloc(32, 7) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const denied = await fetch(`${base}/_internal/agent/lease`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: "python-1" }) });
    assert.equal(denied.status, 403);
    assert.equal((await post(base, "/_internal/agent/heartbeat", { workerId: "python-1" })).status, 200);
    assert.equal((await fetch(`${base}/readyz`)).status, 200);
    const leaseResponse = await post(base, "/_internal/agent/lease", { workerId: "python-1" });
    assert.equal(leaseResponse.status, 200);
    const leased = await leaseResponse.json();
    assert.equal(leased.id, task.id);
    assert.equal(leased.workflowVersion, "python-agent-v2");
    assert.equal(leased.brief.content.profile.name, "测试用户");
    assert.equal(leased.config, null);
    assert.ok(!JSON.stringify(leased).includes("owner_session_id"));
    assert.ok(!JSON.stringify(leased).includes("payment"));
    assert.equal((await post(base, `/_internal/agent/tasks/${task.id}/complete`, {
      leaseToken: "0".repeat(36), config: config() })).status, 409);
    const renewed = await post(base, `/_internal/agent/tasks/${task.id}/heartbeat`, { leaseToken: leased.leaseToken });
    assert.deepEqual(await renewed.json(), { ok: true, cancelRequested: false });
    const completed = await post(base, `/_internal/agent/tasks/${task.id}/complete`, {
      leaseToken: leased.leaseToken, config: config() });
    assert.equal(completed.status, 200);
    assert.equal((await generationService.getTask("owner", task.id)).status, "SUCCEEDED");
    assert.equal((await post(base, "/_internal/agent/lease", { workerId: "python-1" })).status, 204);
    const cancelling = await generationService.enqueue("owner", { brief, idempotencyKey: "bridge-cancel" });
    const secondLease = await (await post(base, "/_internal/agent/lease", { workerId: "python-1" })).json();
    assert.equal(secondLease.id, cancelling.id);
    await generationService.cancel("owner", cancelling.id);
    const cancellationHeartbeat = await post(base, `/_internal/agent/tasks/${cancelling.id}/heartbeat`,
      { leaseToken: secondLease.leaseToken });
    assert.equal((await cancellationHeartbeat.json()).cancelRequested, true);
    assert.equal((await post(base, `/_internal/agent/tasks/${cancelling.id}/ack-cancel`,
      { leaseToken: secondLease.leaseToken })).status, 200);
    assert.equal((await generationService.getTask("owner", cancelling.id)).status, "CANCELLED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close(); rmSync(root, { recursive: true, force: true });
  }
});

test("internal Agent bridge leases a queued v5 template generation", async () => {
  const root = mkdtempSync(join(tmpdir(), "burp-v5-bridge-"));
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 100_000);
  const generationService = createGenerationService({ db, assetRoot: join(root, "assets"), allowPortraits: false });
  const fixture = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
  const task = await generationService.enqueue("owner", { config: { ...fixture.expected.config, templateId: "cyber-creator-v1" }, idempotencyKey: "v5-lease" });
  const server = createPaymentHttpServer({ db, service: {}, generationService, portraitEnabled: false,
    agentToken: token, secret: Buffer.alloc(32, 7) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await post(`http://127.0.0.1:${server.address().port}`, "/_internal/agent/lease", { workerId: "python-v5" });
    assert.equal(response.status, 200);
    const leased = await response.json();
    assert.equal(leased.id, task.id);
    assert.equal(leased.workflowVersion, "python-agent-v6");
    assert.equal((await generationService.getTask("owner", task.id)).status, "RUNNING");
  } finally {
    await new Promise(resolve => server.close(resolve));
    await db.close(); rmSync(root, { recursive: true, force: true });
  }
});

test("Pixel World lease skips workers without support", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "burp-pixel-bridge-"));
  const db = await openDatabase();
  const time = Date.now();
  let now = time;
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, time + 100_000);
  const generationService = createGenerationService({ db, assetRoot: root, now: () => now, leaseMs: 500 });
  const { input } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
  for (const section of input.content.resume.sections) for (const item of section.items) item.supplement.images = [];
  const pixel = await generationService.enqueue("owner", {
    brief: { role: input.role, content: input.content, templateId: "pixel-world-v1" }, idempotencyKey: "pixel"
  });
  now++;
  const cyber = await generationService.enqueue("owner", {
    brief: { role: input.role, content: input.content, templateId: "cyber-creator-v1" }, idempotencyKey: "cyber"
  });
  const server = createPaymentHttpServer({ db, service: {}, generationService, portraitEnabled: false,
    agentToken: token, secret: Buffer.alloc(32, 7) });
  t.after(async () => { await db.close(); rmSync(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const legacy = { workerId: "old", supportsPresentationHighlights: true };
    assert.equal((await (await post(base, "/_internal/agent/lease", legacy)).json()).id, cyber.id);
    assert.equal((await post(base, "/_internal/agent/lease", legacy)).status, 204);
    assert.equal((await db.prepare("SELECT attempt_count FROM generations WHERE id=?").get(pixel.id)).attempt_count, 0);
    const lease = await (await post(base, "/_internal/agent/lease", { ...legacy, supportsPixelWorld: true })).json();
    assert.equal(lease.id, pixel.id);
    assert.equal(lease.workflowVersion, "python-agent-v7");
    now += 501;
    assert.equal((await post(base, `/_internal/agent/tasks/${pixel.id}/complete`, { leaseToken: lease.leaseToken })).status, 409);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("Pixel World workers lease only their advertised avatar versions", async t => {
  const root = mkdtempSync(join(tmpdir(), "burp-pixel-layer-bridge-"));
  const db = await openDatabase();
  t.after(async () => { await db.close(); rmSync(root, { recursive: true, force: true }); });
  let now = Date.now();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", now, now + 100_000);
  const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => now });
  const { input, expected } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
  const config = { ...expected.config, templateId: "pixel-world-v1" };
  for (const section of config.content.resume.sections) for (const item of section.items) item.supplement.images = [];
  const photo = await service.savePortrait("owner", `data:image/png;base64,${png.toString("base64")}`);
  const currentAvatar = await service.enqueue("owner", { config, portraitAssetId: photo.id, idempotencyKey: "current" });
  now++;
  const detailedAvatar = await service.enqueue("owner", { config, portraitAssetId: photo.id, idempotencyKey: "detailed" });
  await db.prepare("UPDATE generations SET workflow_version='python-agent-v9' WHERE id=?").run(detailedAvatar.id);
  now++;
  const layeredAvatar = await service.enqueue("owner", { config, portraitAssetId: photo.id, idempotencyKey: "layered" });
  await db.prepare("UPDATE generations SET workflow_version='python-agent-v8' WHERE id=?").run(layeredAvatar.id);
  now++;
  const baseWork = await service.enqueue("owner", { brief: { role: input.role, content: config.content, templateId: config.templateId }, idempotencyKey: "base" });
  const request = agentRequests(db, service);
  const worker = { workerId: "pixel", supportsPixelWorld: true, supportsPresentationHighlights: true };
  const baseLease = await (await request("lease", worker)).json();
  assert.equal(baseLease.id, baseWork.id);
  assert.equal(baseLease.workflowVersion, "python-agent-v7");
  assert.equal((await request("lease", worker)).status, 204);
  assert.equal((await db.prepare("SELECT attempt_count FROM generations WHERE id=?").get(detailedAvatar.id)).attempt_count, 0);
  assert.equal((await db.prepare("SELECT attempt_count FROM generations WHERE id=?").get(layeredAvatar.id)).attempt_count, 0);
  assert.equal((await request(`tasks/${baseWork.id}/complete`, { leaseToken: baseLease.leaseToken, config })).status, 200);
  assert.ok((await service.getTask("owner", baseWork.id)).projectId);

  const layeredLease = await (await request("lease", { ...worker, supportsPixelLayerAvatar: true })).json();
  assert.equal(layeredLease.id, layeredAvatar.id);
  assert.equal(layeredLease.workflowVersion, "python-agent-v8");
  assert.equal((await request("lease", { ...worker, supportsPixelLayerAvatar: true })).status, 204);
  assert.equal((await request("lease", { ...worker, supportsPixelDetailedAvatar: "true" })).status, 204);
  assert.equal((await db.prepare("SELECT attempt_count FROM generations WHERE id=?").get(detailedAvatar.id)).attempt_count, 0);
  const detailedLease = await (await request("lease", { ...worker, supportsPixelDetailedAvatar: true })).json();
  assert.equal(detailedLease.id, detailedAvatar.id);
  assert.equal(detailedLease.workflowVersion, "python-agent-v9");
  const olderWorker = { ...worker, supportsPixelLayerAvatar: true, supportsPixelDetailedAvatar: true };
  assert.equal((await request("lease", olderWorker)).status, 204);
  assert.equal((await request("lease", { ...olderWorker, supportsPixelLayeredHairAvatar: "true" })).status, 204);
  assert.equal((await request("lease", { workerId: worker.workerId, supportsPixelLayeredHairAvatar: true })).status, 204);
  assert.equal((await db.prepare("SELECT attempt_count FROM generations WHERE id=?").get(currentAvatar.id)).attempt_count, 0);
  const currentResponse = await request("lease", { ...worker, supportsPixelLayeredHairAvatar: true });
  assert.equal(currentResponse.status, 200);
  const currentLease = await currentResponse.json();
  assert.equal(currentLease.id, currentAvatar.id);
  assert.equal(currentLease.workflowVersion, "python-agent-v10");

  const avatarLeases = [layeredLease, detailedLease, currentLease];
  for (const avatarLease of avatarLeases) {
    assert.equal(avatarLease.brief, null);
    const { id, leaseToken } = avatarLease;
    const path = `tasks/${id}`;
    const complete = `${path}/complete`;
    assert.equal((await request(complete, { leaseToken, config })).status, 409);
    const headers = { "x-agent-lease": leaseToken };
    assert.equal((await request(`${path}/recipe`, undefined, headers)).status, 409);
    const output = await request(`${path}/output`, png, { ...headers, "content-type": "image/png" });
    assert.equal(output.status, 200);
    const { assetId } = await output.json();
    assert.equal((await request(complete, { leaseToken, config: { ...config, templateId: "minimal-v1" } })).status, 400);
    assert.equal((await request(complete, { leaseToken, config: { ...config, marquee: { ...config.marquee, speed: config.marquee.speed + 1 } } })).status, 400);
    assert.equal((await request(complete, { leaseToken, config })).status, 200);
    const result = await service.getTask("owner", id);
    assert.deepEqual(result.config, avatarLease.config);
    assert.deepEqual(result.heroArtwork, { assetUrl: `/api/hero-assets/${assetId}`, styleId: "pixel-halfbody-v1", alt: "个人像素头像" });
    assert.equal(result.projectId, undefined);
  }
  assert.equal((await db.prepare("SELECT count(*) n FROM projects").get()).n, 1);
  now += 7 * 24 * 60 * 60 * 1000;
  for (const { id } of avatarLeases) {
    const expired = await service.getTask("owner", id);
    assert.equal(expired.status, "EXPIRED");
    assert.equal(expired.heroArtwork, undefined);
    assert.match(expired.error, /候选头像已过期.*重新选择照片/);
  }
});

test("the current Pixel World avatar publishes actionable failures without rescheduling", async t => {
  const root = mkdtempSync(join(tmpdir(), "burp-pixel-layer-errors-"));
  const db = await openDatabase();
  t.after(async () => { await db.close(); rmSync(root, { recursive: true, force: true }); });
  let now = Date.now();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", now, now + 100_000);
  const service = createGenerationService({ db, assetRoot: root, minPixels: 1, now: () => now });
  const { expected } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
  const config = { ...expected.config, templateId: "pixel-world-v1" };
  const photo = await service.savePortrait("owner", `data:image/png;base64,${png.toString("base64")}`);
  const request = agentRequests(db, service);
  const cases = {
    PIXEL_PHOTO_INVALID: /照片格式或内容无效/,
    PIXEL_PHOTO_UNCLEAR: /清晰单人照/,
    PIXEL_TRAITS_INVALID: /特征识别结果无效/,
    PIXEL_NO_SUPPORTED_TRAITS: /默认角色/,
    SKILL_VERSION_MISMATCH: /生成规则已更新/,
    PIXEL_CANDIDATE_EXPIRED: /候选头像已过期.*重新选择照片/,
    PIXEL_PHOTO_EXPIRED: /源照片已过期.*重新选择照片/
  };
  for (const [errorCode, message] of Object.entries(cases)) {
    const task = await service.enqueue("owner", { config, portraitAssetId: photo.id, idempotencyKey: errorCode });
    if (errorCode === "PIXEL_PHOTO_EXPIRED") now += 24 * 60 * 60 * 1000;
    const lease = await (await request("lease", { workerId: "pixel", supportsPixelWorld: true, supportsPixelLayeredHairAvatar: true })).json();
    assert.equal(lease.id, task.id);
    if (errorCode === "PIXEL_PHOTO_EXPIRED") {
      const headers = { "x-agent-lease": lease.leaseToken };
      assert.equal((await request(`tasks/${task.id}/portrait`, undefined, headers)).status, 404);
    }
    assert.equal((await request(`tasks/${task.id}/fail`, { leaseToken: lease.leaseToken, errorCode, retryable: true })).status, 200);
    const result = await service.getTask("owner", task.id);
    assert.equal(result.status, "FAILED");
    assert.match(result.error, message);
  }
});

test("generation leases leave explicit highlight states for capable workers", async () => {
  const root = mkdtempSync(join(tmpdir(), "burp-highlights-bridge-"));
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 100_000);
  const generationService = createGenerationService({ db, assetRoot: join(root, "assets"), allowPortraits: false });
  const { input, expected } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
  const content = input.content;
  for (const section of content.resume.sections) for (const item of section.items) item.supplement.images = [];
  const award = { kind: "awards", order: 9, items: [{ itemId: "award", order: 0, title: "竞赛",
    details: "共获竞赛奖项4项", facts: [], supplement: { text: "", links: [], images: [] }, presentationHighlights: [] }] };
  content.resume.sections.push(award);
  const newer = await generationService.enqueue("owner", {
    brief: { role: input.role, content, templateId: "cyber-creator-v1" }, idempotencyKey: "highlights"
  });
  const older = await generationService.enqueue("owner", { brief, idempotencyKey: "legacy-brief" });
  const server = createPaymentHttpServer({ db, service: {}, generationService, portraitEnabled: false,
    agentToken: token, secret: Buffer.alloc(32, 7) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const legacyLease = await post(base, "/_internal/agent/lease", { workerId: "legacy" });
    assert.equal((await legacyLease.json()).id, older.id);
    assert.equal((await post(base, "/_internal/agent/lease", { workerId: "legacy" })).status, 204);
    assert.equal((await db.prepare("SELECT attempt_count FROM generations WHERE id=?").get(newer.id)).attempt_count, 0);
    const lease = await (await post(base, "/_internal/agent/lease", {
      workerId: "new", supportsPresentationHighlights: true
    })).json();
    assert.equal(lease.id, newer.id);
    assert.deepEqual(lease.brief.content.resume.sections.at(-1).items[0].presentationHighlights, []);
    const completed = await post(base, `/_internal/agent/tasks/${newer.id}/complete`, {
      leaseToken: lease.leaseToken, config: { ...expected.config, templateId: "cyber-creator-v1", content: lease.brief.content }
    });
    assert.equal(completed.status, 200);
    assert.deepEqual((await generationService.getTask("owner", newer.id)).config.content.resume.sections.at(-1).items[0].presentationHighlights, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await db.close(); rmSync(root, { recursive: true, force: true });
  }
});

test("queued v7 Pixel World photo tasks retain the leased recipe and asset endpoints", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "burp-pixel-assets-"));
  const db = await openDatabase();
  const now = Date.now();
  for (const owner of ["owner", "other"]) await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(owner, now, now + 100_000);
  const service = createGenerationService({ db, assetRoot: root, minPixels: 1 });
  const { expected } = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v3.json", "utf8"));
  const config = { ...expected.config, templateId: "pixel-world-v1" };
  const photo = await service.savePortrait("owner", `data:image/png;base64,${png.toString("base64")}`);
  const task = await service.enqueue("owner", { config, portraitAssetId: photo.id, idempotencyKey: "pixel-photo" });
  await db.prepare("UPDATE generations SET workflow_version='python-agent-v7' WHERE id=?").run(task.id);
  t.after(async () => { await db.close(); rmSync(root, { recursive: true, force: true }); });
  const request = agentRequests(db, service);
  const lease = await (await request("lease", { workerId: "pixel", supportsPixelWorld: true })).json();
  assert.equal(lease.workflowVersion, "python-agent-v7");
  const path = `tasks/${task.id}`;
  const headers = { "x-agent-lease": lease.leaseToken };
  assert.equal((await request(`${path}/recipe`)).status, 409);
  const recipe = await (await request(`${path}/recipe`, undefined, headers)).json();
  assert.equal(recipe.id, "pixel-halfbody-v1");
  assert.equal(recipe.version, "1.1.0");
  assert.equal(recipe.referenceImages.length, 1);
  assert.match(recipe.referenceImages[0].dataBase64, /^iVBOR/);
  const output = await request(`${path}/output`, png, { ...headers, "content-type": "image/png" });
  assert.equal(output.status, 200);
  const { assetId } = await output.json();
  assert.equal((await request(`${path}/complete`, { leaseToken: lease.leaseToken, config })).status, 200);
  assert.equal((await service.getTask("owner", task.id)).heroArtwork.assetUrl, `/api/hero-assets/${assetId}`);
  assert.deepEqual((await service.readArtworkAsset("owner", assetId)).bytes, png);
  await assert.rejects(async () => await service.readArtworkAsset("other", assetId), { status: 404 });
  assert.equal((await db.prepare("SELECT count(*) n FROM projects").get()).n, 0);
});

test("internal Agent bridge streams only leased portrait and fences output and recipe", async () => {
  const root = mkdtempSync(join(tmpdir(), "burp-agent-bridge-photo-"));
  const reference = join(root, "reference.png");
  writeFileSync(reference, png);
  const db = await openDatabase();
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 100_000);
  const generationService = createGenerationService({ db, assetRoot: join(root, "assets"), minPixels: 1 });
  const photo = await generationService.savePortrait("owner", `data:image/png;base64,${png.toString("base64")}`);
  const task = await generationService.enqueue("owner", { brief, idempotencyKey: "bridge-photo",
    portraitAssetId: photo.id, styleId: "lofi-print-anime" });
  const server = createPaymentHttpServer({ db, service: {}, generationService, portraitEnabled: true,
    agentToken: token, secret: Buffer.alloc(32, 8), agentStyleLoader: (id) => ({ id, version: "test-v1",
      license: "test-noncommercial", sourceCommit: "test", manifestVersion: "1", attribution: "test",
      instructions: "test instructions", localSummary: "test summary", referencePaths: [reference] }) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const leased = await (await post(base, "/_internal/agent/lease", { workerId: "python-2" })).json();
    const path = `/_internal/agent/tasks/${task.id}`;
    const headers = { authorization: `Bearer ${token}`, "x-agent-lease": leased.leaseToken };
    const portraitResponse = await fetch(`${base}${path}/portrait`, { headers });
    assert.equal(portraitResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await portraitResponse.arrayBuffer()), png);
    const recipe = await (await fetch(`${base}${path}/recipe`, { headers })).json();
    assert.equal(recipe.version, "test-v1");
    assert.equal(recipe.referenceImages[0].dataBase64, png.toString("base64"));
    assert.equal((await fetch(`${base}${path}/output`, { method: "POST", headers: {
      authorization: `Bearer ${token}`, "x-agent-lease": "0".repeat(36), "content-type": "image/png"
    }, body: png })).status, 409);
    const output = await fetch(`${base}${path}/output`, { method: "POST", headers: {
      ...headers, "content-type": "image/png" }, body: png });
    assert.equal(output.status, 200);
    const { assetId } = await output.json();
    assert.equal(await generationService.existingOutput(task.id), assetId);
    const outputStatus = await (await fetch(`${base}${path}/output`, { headers })).json();
    assert.deepEqual(outputStatus, { assetId, exists: true });
    assert.equal((await fetch(`${base}${path}/cutout`, { method: "POST", headers: {
      authorization: `Bearer ${token}`, "x-agent-lease": "0".repeat(36), "content-type": "image/png"
    }, body: png })).status, 409);
    const cutout = await fetch(`${base}${path}/cutout`, { method: "POST", headers: {
      ...headers, "content-type": "image/png" }, body: png });
    assert.equal(cutout.status, 200);
    const { assetId: cutoutId } = await cutout.json();
    assert.equal((await generationService.readArtworkAsset("owner", cutoutId)).mime, "image/png");
    assert.equal((await post(base, `${path}/complete`, { leaseToken: leased.leaseToken, config: config() })).status, 200);
    assert.equal((await generationService.getTask("owner", task.id)).heroArtwork.cutoutAssetUrl, `/api/hero-assets/${cutoutId}`);
    assert.equal((await fetch(`${base}${path}/portrait`, { headers })).status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close(); rmSync(root, { recursive: true, force: true });
  }
});
