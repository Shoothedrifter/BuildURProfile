import { testDatabaseUrl, testSchema } from "./postgres-test-db.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as healthzGet } from "../../web/src/app/healthz/route.ts";
import { GET as readyzGet } from "../../web/src/app/readyz/route.ts";
import { GET as apiGet, POST as apiPost, PATCH as apiPatch } from "../../web/src/app/api/[[...slug]]/route.ts";

const config = JSON.parse(readFileSync(new URL("../../web/src/demo/config.json", import.meta.url)));

test("Next.js App Router route handlers and expired private artwork cleanup", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "burp-next-routes-"));
  const prevDb = process.env.DATABASE_URL;
  const prevSchema = process.env.DATABASE_SCHEMA;
  const schema = testSchema();
  const prevToken = process.env.AGENT_SERVICE_TOKEN;
  const prevAvatarRoot = process.env.AVATAR_ASSET_ROOT;
  const prevResumeRoot = process.env.RESUME_FILE_ROOT;
  const prevAvatarEnabled = process.env.AVATAR_DEMO_ENABLED;
  const prevRuntime = globalThis.__buildurprofile_next_runtime__;
  delete globalThis.__buildurprofile_next_runtime__;
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.DATABASE_SCHEMA = schema;
  process.env.AGENT_SERVICE_TOKEN = "t".repeat(64);
  process.env.AVATAR_ASSET_ROOT = join(dir, "avatars");
  process.env.RESUME_FILE_ROOT = join(dir, "resumes");
  process.env.AVATAR_DEMO_ENABLED = "0";
  let clean;
  t.mock.method(globalThis, "setInterval", callback => {
    clean = callback;
    return { unref() {} };
  });
  try {
    const healthRes = await healthzGet(new Request("http://127.0.0.1:5173/healthz"));
    assert.equal(healthRes.status, 200);
    assert.equal((await healthRes.json()).ok, true);

    const readyBefore = await readyzGet(new Request("http://127.0.0.1:5173/readyz"));
    assert.equal(readyBefore.status, 503);

    const hbRes = await apiPost(new Request("http://127.0.0.1:5173/api/_internal/agent/heartbeat", {
      method: "POST",
      headers: { authorization: `Bearer ${"t".repeat(64)}`, "content-type": "application/json" },
      body: JSON.stringify({ workerId: "next-worker-1" })
    }));
    assert.equal(hbRes.status, 200);

    const readyAfter = await readyzGet(new Request("http://127.0.0.1:5173/readyz"));
    assert.equal(readyAfter.status, 200);

    const sessionRes = await apiGet(new Request("http://127.0.0.1:5173/api/session"));
    assert.equal(sessionRes.status, 200);
    const cookie = sessionRes.headers.get("set-cookie").split(";")[0];
    const { csrfToken } = await sessionRes.json();
    const deniedPortrait = await apiPost(new Request("http://127.0.0.1:5173/api/generations", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify({ config: { ...config, templateId: "pixel-world-v1" }, portraitAssetId: "synthetic", idempotencyKey: "denied" })
    }));
    assert.equal(deniedPortrait.status, 403);

    const missingResume = await apiPatch(new Request("http://127.0.0.1:5173/api/resumes/missing", {
      method: "PATCH",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, draft: {} })
    }));
    assert.equal(missingResume.status, 404);

    const createRes = await apiPost(new Request("http://127.0.0.1:5173/api/projects", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify({ config })
    }));
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.config.content.profile.name, config.content.profile.name);
    const runtime = await globalThis.__buildurprofile_next_runtime__;
    const owner = (await runtime.db.prepare("SELECT owner_session_id FROM projects WHERE id=?").get(created.id)).owner_session_id;
    const insert = runtime.db.prepare("INSERT INTO avatar_assets VALUES(?,?,?,?,?,?,?)");
    for (const [id, kind, expires] of [["expired", "portrait", 0], ["current", "hero", Date.now() + 600_000]]) {
      const path = join(dir, "avatars", id);
      writeFileSync(path, "synthetic bytes");
      await insert.run(id, owner, kind, "image/png", path, 0, expires);
    }
    await clean();
    assert.equal(existsSync(join(dir, "avatars", "expired")), false);
    assert.equal(existsSync(join(dir, "avatars", "current")), true);
  } finally {
    const runtime = await globalThis.__buildurprofile_next_runtime__;
    if (runtime) {
      await runtime.db.exec(`DROP SCHEMA "${schema}" CASCADE`);
      await runtime.close();
    }
    globalThis.__buildurprofile_next_runtime__ = prevRuntime;
    if (prevDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevDb;
    if (prevSchema === undefined) delete process.env.DATABASE_SCHEMA; else process.env.DATABASE_SCHEMA = prevSchema;
    if (prevToken === undefined) delete process.env.AGENT_SERVICE_TOKEN; else process.env.AGENT_SERVICE_TOKEN = prevToken;
    if (prevAvatarRoot === undefined) delete process.env.AVATAR_ASSET_ROOT; else process.env.AVATAR_ASSET_ROOT = prevAvatarRoot;
    if (prevResumeRoot === undefined) delete process.env.RESUME_FILE_ROOT; else process.env.RESUME_FILE_ROOT = prevResumeRoot;
    if (prevAvatarEnabled === undefined) delete process.env.AVATAR_DEMO_ENABLED; else process.env.AVATAR_DEMO_ENABLED = prevAvatarEnabled;
    rmSync(dir, { recursive: true, force: true });
  }
});
