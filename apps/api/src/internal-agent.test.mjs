import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../packages/storage/src/database.mjs";
import { createGenerationService } from "../../../packages/storage/src/generations.mjs";
import { styleToConfig } from "../../../packages/skills/src/mapping.ts";
import { createPaymentHttpServer } from "./http.mjs";

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

test("internal Agent bridge requires token and leases only the versioned public brief", async () => {
  const root = mkdtempSync(join(tmpdir(), "burp-agent-bridge-"));
  const db = openDatabase(join(root, "app.sqlite"));
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 100_000);
  const generationService = createGenerationService({ db, assetRoot: join(root, "assets"), allowPortraits: false });
  const task = generationService.enqueue("owner", { brief, idempotencyKey: "bridge-no-photo" });
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
    assert.equal(leased.workflowVersion, "python-agent-v1");
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
    assert.equal(generationService.getTask("owner", task.id).status, "SUCCEEDED");
    assert.equal((await post(base, "/_internal/agent/lease", { workerId: "python-1" })).status, 204);
    const cancelling = generationService.enqueue("owner", { brief, idempotencyKey: "bridge-cancel" });
    const secondLease = await (await post(base, "/_internal/agent/lease", { workerId: "python-1" })).json();
    assert.equal(secondLease.id, cancelling.id);
    generationService.cancel("owner", cancelling.id);
    const cancellationHeartbeat = await post(base, `/_internal/agent/tasks/${cancelling.id}/heartbeat`,
      { leaseToken: secondLease.leaseToken });
    assert.equal((await cancellationHeartbeat.json()).cancelRequested, true);
    assert.equal((await post(base, `/_internal/agent/tasks/${cancelling.id}/ack-cancel`,
      { leaseToken: secondLease.leaseToken })).status, 200);
    assert.equal(generationService.getTask("owner", cancelling.id).status, "CANCELLED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close(); rmSync(root, { recursive: true, force: true });
  }
});

test("internal Agent bridge streams only leased portrait and fences output and recipe", async () => {
  const root = mkdtempSync(join(tmpdir(), "burp-agent-bridge-photo-"));
  const reference = join(root, "reference.png");
  writeFileSync(reference, png);
  const db = openDatabase(join(root, "app.sqlite"));
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", 1, Date.now() + 100_000);
  const generationService = createGenerationService({ db, assetRoot: join(root, "assets"), minPixels: 1 });
  const photo = generationService.savePortrait("owner", `data:image/png;base64,${png.toString("base64")}`);
  const task = generationService.enqueue("owner", { brief, idempotencyKey: "bridge-photo",
    portraitAssetId: photo.id, styleId: "retro-flat-anime-head" });
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
    assert.equal(generationService.existingOutput(task.id), assetId);
    const outputStatus = await (await fetch(`${base}${path}/output`, { headers })).json();
    assert.deepEqual(outputStatus, { assetId, exists: true });
    assert.equal((await post(base, `${path}/complete`, { leaseToken: leased.leaseToken, config: config() })).status, 200);
    assert.equal((await fetch(`${base}${path}/portrait`, { headers })).status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close(); rmSync(root, { recursive: true, force: true });
  }
});
