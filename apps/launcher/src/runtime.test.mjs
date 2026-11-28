import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDatabaseUrl, testSchema } from "./postgres-test-db.mjs";
import { handleNextRouteRequest, getAppRuntime } from "../../web/src/server/runtime.mjs";

test("development replaces a stale global runtime before validating macaron photo requests", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "burp-runtime-reload-"));
  const schema = testSchema();
  const settings = {
    NODE_ENV: "development", DATABASE_URL: testDatabaseUrl(), DATABASE_SCHEMA: schema,
    AGENT_SERVICE_TOKEN: "t".repeat(64), AVATAR_DEMO_ENABLED: "0",
    AVATAR_ASSET_ROOT: join(root, "avatars"), RESUME_FILE_ROOT: join(root, "resumes")
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  const savedRuntime = globalThis.__buildurprofile_next_runtime__;
  let oldClosed = false;
  const stale = Promise.resolve({
    handler(_req, res) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "简历生成请求无效。" }));
    },
    async close() { oldClosed = true; }
  });
  Object.assign(process.env, settings);
  globalThis.__buildurprofile_next_runtime__ = stale;
  t.after(async () => {
    const pending = globalThis.__buildurprofile_next_runtime__;
    if (pending && pending !== stale) {
      const runtime = await pending;
      await runtime.db.exec(`DROP SCHEMA "${schema}" CASCADE`);
      await runtime.close();
    }
    globalThis.__buildurprofile_next_runtime__ = savedRuntime;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  const session = await handleNextRouteRequest(new Request("http://127.0.0.1:5173/api/session"));
  assert.equal(session.status, 200);
  const cookie = session.headers.get("set-cookie").split(";")[0];
  const { csrfToken } = await session.json();
  const response = await handleNextRouteRequest(new Request("http://127.0.0.1:5173/api/generations", {
    method: "POST",
    headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
    body: JSON.stringify({ resumeId: "00000000-0000-4000-8000-000000000001", revision: 1,
      role: "ui-ux-designer", templateId: "warm-macaron-v1", portraitAssetId: null,
      photoAssetId: "00000000-0000-4000-8000-000000000002", idempotencyKey: "macaron-reload" })
  }));
  // 当前规则接受 photoAssetId，随后按所有权检查拒绝不存在的简历。
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "简历不存在或已过期。");
  assert.equal(oldClosed, true);
  const first = await getAppRuntime();
  assert.equal(await getAppRuntime(), first);

  const draft = JSON.parse(readFileSync(new URL("../../../packages/contracts/fixtures/resume-draft.v1.json", import.meta.url)));
  const { id: owner } = await first.db.prepare("SELECT id FROM sessions").get();
  const now = Date.now();
  await first.db.prepare("INSERT INTO resume_files(id,owner_session_id,file_name,size,page_count,uploaded_at,expires_at) VALUES(?,?,?,?,?,?,?)")
    .run(draft.fileId, owner, "synthetic.pdf", 100, 1, now, now + 30 * 86400000);
  await first.db.prepare("INSERT INTO resumes(id,file_id,owner_session_id,status,draft_json,created_at,updated_at) VALUES(?,?,?,'SUCCEEDED',?,?,?)")
    .run(draft.resumeId, draft.fileId, owner, JSON.stringify(draft), now, now);
  const headers = { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" };
  const photoDataUrl = "data:image/webp;base64," + readFileSync(new URL("../../web/public/pixel-world-default.webp", import.meta.url)).toString("base64");
  const portrait = await handleNextRouteRequest(new Request("http://127.0.0.1:5173/api/portraits", {
    method: "POST", headers,
    body: JSON.stringify({ dataUrl: photoDataUrl })
  }));
  assert.equal(portrait.status, 201);
  const photo = await portrait.json();
  const generated = await handleNextRouteRequest(new Request("http://127.0.0.1:5173/api/generations", {
    method: "POST", headers,
    body: JSON.stringify({ resumeId: draft.resumeId, revision: 1, role: "ui-ux-designer",
      templateId: "warm-macaron-v1", portraitAssetId: null, photoAssetId: photo.id,
      idempotencyKey: "macaron-valid-photo" })
  }));
  assert.equal(generated.status, 201);
  const task = await generated.json();
  assert.equal(task.status, "QUEUED");
  const row = await first.db.prepare("SELECT portrait_asset_id,resume_request_json FROM generations WHERE id=?").get(task.id);
  assert.equal(row.portrait_asset_id, null);
  assert.equal(JSON.parse(row.resume_request_json).photoAssetId, photo.id);
});
