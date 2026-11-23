import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { openDatabase as openSqlite } from "../../../packages/storage/src/legacy-sqlite.mjs";
import { openTestDatabase, testDatabaseUrl } from "./postgres-test-db.mjs";

const exec = promisify(execFile);
const config = "{}";

test("SQLite CLI preserves private data, leases, payment records and binary assets", async t => {
  const folder = mkdtempSync(join(tmpdir(), "buildurprofile-import-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const resumeRoot = join(folder, "pdf"), avatarRoot = join(folder, "avatar");
  mkdirSync(resumeRoot);
  mkdirSync(avatarRoot);
  const fileId = randomUUID(), avatarId = randomUUID(), now = Date.now();
  const pdf = Buffer.from("synthetic migration fixture");
  const binary = Buffer.from([0, 1, 254, 255]);
  writeFileSync(join(resumeRoot, fileId + ".pdf"), pdf);
  writeFileSync(join(avatarRoot, avatarId), binary);
  const snapshot = join(folder, "original.sqlite");
  const source = openSqlite(snapshot);
  source.prepare("INSERT INTO sessions VALUES(?,?,?)").run("owner", now, now + 1_000_000);
  source.prepare("INSERT INTO app_meta VALUES('payment_environment','sandbox')").run();
  source.prepare("INSERT INTO avatar_assets VALUES(?,?,?,?,?,?,?)").run(avatarId, "owner", "portrait", "image/png",
    join(avatarRoot, avatarId), now, now + 1_000_000);
  source.prepare("INSERT INTO resume_files(id,owner_session_id,file_name,size,page_count,uploaded_at,expires_at) VALUES(?,?,?,?,?,?,?)")
    .run(fileId, "owner", "fixture.pdf", pdf.length, 1, now, now + 1_000_000);
  source.prepare("INSERT INTO resumes(id,file_id,owner_session_id,status,created_at,updated_at) VALUES('resume',?,'owner','SUCCEEDED',?,?)")
    .run(fileId, now, now);
  source.prepare("INSERT INTO resume_blocks VALUES('resume','z-first','{}'),('resume','a-second','{}')").run();
  source.prepare("INSERT INTO resume_images(id,resume_id,content_type,data,created_at) VALUES('image','resume','image/png',?,?)").run(binary, now);
  source.prepare("INSERT INTO projects(id,owner_session_id,config_json,created_at,updated_at,resume_id) VALUES('project','owner',?,?,?,'resume')").run(config, now, now);
  source.prepare("INSERT INTO orders(out_trade_no,project_id,amount_fen,status,payment_env,created_at,updated_at) VALUES('order','project',199,'PAID','sandbox',?,?)").run(now, now);
  source.prepare("INSERT INTO payment_events(id,out_trade_no,trade_status,accepted_at) VALUES(17,'order','TRADE_SUCCESS',?)").run(now);
  source.prepare("INSERT INTO entitlements(project_id,status,granted_by_order,granted_at) VALUES('project','ACTIVE','order',?)").run(now);
  source.prepare("INSERT INTO shares(token,project_id,revision,config_json,created_at,expires_at) VALUES('share','project',1,?,?,?)").run(config, now, now + 1_000_000);
  source.prepare("INSERT INTO generations(id,owner_session_id,idempotency_key,workflow_version,status,next_attempt_at,created_at,updated_at) VALUES('task','owner','key','python-agent-v2','QUEUED',?,?,?)").run(now + 1000, now, now);
  source.close();

  const target = await openTestDatabase();
  t.after(() => target.close());
  const run = (command, ...options) => exec(process.execPath, [
    "scripts/postgresql.mjs", command, "--source", snapshot, "--resume-root", resumeRoot, "--avatar-root", avatarRoot, ...options
  ], { env: { ...process.env, DATABASE_URL: testDatabaseUrl(), DATABASE_SCHEMA: target.schema, PAYMENT_ENV: "sandbox" } });
  const preview = JSON.parse((await run("import", "--dry-run")).stdout);
  assert.equal(preview.status, "preflight-passed");
  assert.equal(preview.externalFiles, 2);
  assert.equal((await target.query("SELECT count(*) AS n FROM sessions")).rows[0].n, 0);

  await target.exec("ALTER TABLE orders ADD CONSTRAINT synthetic_rejection CHECK (amount_fen > 200)");
  await assert.rejects(run("import", "--apply"), error => JSON.parse(error.stderr.trim().split("\n").at(-1)).code === "23514");
  assert.equal((await target.query("SELECT count(*) AS n FROM sessions")).rows[0].n, 0);
  await target.exec("ALTER TABLE orders DROP CONSTRAINT synthetic_rejection");

  assert.equal(JSON.parse((await run("import", "--apply")).stdout).status, "imported");
  assert.equal(JSON.parse((await run("verify")).stdout).externalSha256, preview.externalSha256);
  await assert.rejects(run("import", "--apply"), error => JSON.parse(error.stderr.trim().split("\n").at(-1)).code === "TARGET_NOT_EMPTY");
  assert.deepEqual((await target.query("SELECT block_id FROM resume_blocks ORDER BY insertion_order")).rows.map(row => row.block_id),
    ["z-first", "a-second"]);
  assert.deepEqual((await target.query("SELECT data FROM resume_images")).rows[0].data, binary);
  assert.equal((await target.query("SELECT next_attempt_at FROM generations")).rows[0].next_attempt_at, now + 1000);
  assert.equal((await target.query("INSERT INTO payment_events(out_trade_no,trade_status,accepted_at) VALUES('order','TRADE_SUCCESS',$1) RETURNING id", [now])).rows[0].id, 18);
});
