import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { createQueueNotifications } from "../../web/src/server/queue-notifications.mjs";
import { transaction } from "../../../packages/storage/src/database.mjs";
import { openTestDatabase, testDatabaseUrl } from "./postgres-test-db.mjs";

test("PostgreSQL commit wakes long-lived lease waits and abort cleans up", async t => {
  const db = await openTestDatabase();
  const listener = createQueueNotifications(testDatabaseUrl(), db.schema);
  t.after(async () => { await listener.close(); await db.close(); });
  await db.query("INSERT INTO sessions VALUES('owner',0,9999999999999)");
  const take = () => db.prepare("SELECT id FROM generations WHERE status='QUEUED'").get();
  const wait = listener.claim("generations", 2500, undefined, take);
  let replied = false;
  void wait.then(() => { replied = true; });
  await transaction(db, async () => {
    await db.query("INSERT INTO generations(id,owner_session_id,idempotency_key,status,created_at,updated_at) VALUES('task','owner','key','QUEUED',0,0)");
    await sleep(80);
    assert.equal(replied, false);
  });
  assert.deepEqual(await wait, { id: "task" });

  const controller = new AbortController();
  const cancelled = listener.claim("resume_parse_tasks", 2500, controller.signal, async () => null);
  controller.abort();
  assert.equal(await cancelled, null);
  assert.equal(await listener.claim("resume_parse_tasks", 25, undefined, async () => null), null);
});

test("a second generation worker skips a locked task and can lease the next one", async t => {
  const a = await openTestDatabase();
  const b = await openTestDatabase({ schema: a.schema, cleanup: false });
  t.after(async () => { await b.close(); await a.close(); });
  await a.query("INSERT INTO sessions VALUES('owner',0,9999999999999)");
  await a.query(`INSERT INTO generations(id,owner_session_id,idempotency_key,workflow_version,status,created_at,updated_at)
    VALUES ('first','owner','first','python-agent-v2','QUEUED',1,1),
           ('second','owner','second','python-agent-v2','QUEUED',2,2)`);
  const { createGenerationQueue } = await import("../../../packages/storage/src/generation/queue.mjs");
  const createQueue = db => createGenerationQueue({ db, assets: {}, now: Date.now, leaseMs: 90_000, maxAttempts: 3 });
  await transaction(a, async () => {
    await a.query("SELECT id FROM generations WHERE id='first' FOR UPDATE");
    const task = await createQueue(b).leaseNext();
    assert.equal(task.id, "second");
  });
  const claim = await createQueue(a).leaseNext();
  assert.equal(claim.id, "first");
  assert.equal(await createQueue(b).leaseNext(), null);
});
