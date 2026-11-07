import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as healthzGet } from "../../web/src/app/healthz/route.ts";
import { GET as readyzGet } from "../../web/src/app/readyz/route.ts";
import { GET as apiGet, POST as apiPost } from "../../web/src/app/api/[[...slug]]/route.ts";

const config = JSON.parse(readFileSync(new URL("../../web/src/demo/config.json", import.meta.url)));

test("Next.js App Router route handlers dispatch session, project, healthz, readyz and internal agent requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "burp-next-routes-"));
  const prevDb = process.env.DATABASE_PATH;
  const prevToken = process.env.AGENT_SERVICE_TOKEN;
  const prevRuntime = globalThis.__buildurprofile_next_runtime__;
  delete globalThis.__buildurprofile_next_runtime__;
  process.env.DATABASE_PATH = join(dir, "next.sqlite");
  process.env.AGENT_SERVICE_TOKEN = "t".repeat(64);
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

    const createRes = await apiPost(new Request("http://127.0.0.1:5173/api/projects", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify({ config })
    }));
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.config.content.profile.name, config.content.profile.name);
  } finally {
    globalThis.__buildurprofile_next_runtime__?.db?.close?.();
    globalThis.__buildurprofile_next_runtime__ = prevRuntime;
    if (prevDb === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = prevDb;
    if (prevToken === undefined) delete process.env.AGENT_SERVICE_TOKEN; else process.env.AGENT_SERVICE_TOKEN = prevToken;
    rmSync(dir, { recursive: true, force: true });
  }
});
