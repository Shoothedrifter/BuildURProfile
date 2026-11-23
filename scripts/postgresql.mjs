import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { migrateDatabase, openDatabase, transaction } from "../packages/storage/src/database.mjs";
import { openDatabase as upgradeLegacyDatabase } from "../packages/storage/src/legacy-sqlite.mjs";

// Foreign-key order. These identifiers and those read from the current SQLite schema
// are checked against the target schema before any INSERT is attempted.
const tables = [
  "sessions", "payment_events", "app_meta", "avatar_assets", "worker_heartbeats",
  "resume_files", "resumes", "projects", "orders", "entitlements", "shares",
  "downloads", "deliveries", "generations", "resume_blocks", "resume_tombstones",
  "resume_parse_tasks", "resume_parse_requests", "resume_images", "showcase_media",
  "generation_media", "project_media", "session_cache_scopes", "resume_versions",
  "resume_reparse_candidates", "resume_deleted_items", "github_deployments"
];
const ordered = new Set(["orders", "resume_blocks", "resume_parse_tasks", "resume_images", "github_deployments"]);
const latestLegacyVersion = 15;
const quote = name => '"' + name.replaceAll('"', '""') + '"';

function fail(code, scope = "") {
  throw Object.assign(new Error(code), { reportCode: code, reportScope: scope });
}
function checkIntegrity(db) {
  if (db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") fail("SQLITE_INTEGRITY_FAILED");
  if (db.prepare("PRAGMA foreign_key_check").get()) fail("SQLITE_FOREIGN_KEY_FAILED");
}

async function withSnapshot(path, work) {
  if (!path || !existsSync(path)) fail("SOURCE_SNAPSHOT_REQUIRED");
  const source = new DatabaseSync(path, { readOnly: true });
  let scratch, upgraded;
  try {
    checkIntegrity(source);
    const versions = source.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
    const version = versions.at(-1)?.version;
    if (!version || version > latestLegacyVersion || versions.some((row, i) => row.version !== i + 1)) {
      fail("UNSUPPORTED_SQLITE_SCHEMA");
    }
    if (version < latestLegacyVersion) {
      scratch = mkdtempSync(join(tmpdir(), "buildurprofile-sqlite-import-"));
      const destination = join(scratch, "snapshot.sqlite");
      await backup(source, destination);
      upgradeLegacyDatabase(destination).close();
      upgraded = new DatabaseSync(destination, { readOnly: true });
      checkIntegrity(upgraded);
    }
    return await work(upgraded ?? source);
  } finally {
    upgraded?.close();
    source.close();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function inspectSqlite(db, { paymentEnv, resumeRoot, avatarRoot, now = Date.now() }) {
  if (!["sandbox", "production"].includes(paymentEnv)) fail("PAYMENT_ENV_REQUIRED");
  const binding = db.prepare("SELECT value FROM app_meta WHERE key='payment_environment'").get()?.value;
  const mismatched = db.prepare("SELECT 1 FROM orders WHERE payment_env IS NULL OR payment_env<>? LIMIT 1").get(paymentEnv);
  if ((binding && binding !== paymentEnv) || mismatched) fail("PAYMENT_ENV_MISMATCH");
  for (const table of ["generations", "resume_parse_tasks"]) {
    if (db.prepare(`SELECT 1 FROM "${table}" WHERE status IN ('RUNNING','CANCELLING') LIMIT 1`).get()) fail("DRAIN_ACTIVE_TASKS", table);
  }
  if (db.prepare("SELECT 1 FROM github_deployments WHERE stage='uploading' AND write_until>? LIMIT 1").get(now)) {
    fail("DRAIN_ACTIVE_GITHUB_UPLOADS");
  }
  const counts = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n]));
  const external = createHash("sha256");
  let fileCount = 0;
  async function addFile(kind, id, expectedSize, paths) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) fail("INVALID_ASSET_ID", kind);
    const path = paths.find(candidate => candidate && existsSync(candidate));
    if (!path) fail("MISSING_PRIVATE_FILE", kind);
    try {
      const stat = statSync(path);
      if (!stat.isFile() || (expectedSize !== null && stat.size !== expectedSize)) fail("INVALID_PRIVATE_FILE", kind);
      external.update(`${kind}:${id}:${await fileDigest(path)}\n`);
      fileCount++;
    } catch (error) {
      if (error.reportCode) throw error;
      fail("UNREADABLE_PRIVATE_FILE", kind);
    }
  }
  for (const { id, size } of db.prepare("SELECT id,size FROM resume_files WHERE expires_at>? ORDER BY id").iterate(now)) {
    await addFile("resume_files", id, size, [join(resumeRoot, `${id}.pdf`)]);
  }
  for (const { id, kind, path } of db.prepare("SELECT id,kind,path FROM avatar_assets WHERE expires_at>? AND path<>'' ORDER BY id").iterate(now)) {
    const candidates = [...(kind === "hero" ? [join(avatarRoot, `${id}.webp`)] : []), path];
    await addFile("avatar_assets", id, null, candidates);
  }
  return { tables: counts, externalFiles: fileCount, externalSha256: external.digest("hex") };
}

function columnsOf(source, table) {
  return source.prepare(`PRAGMA table_info(${quote(table)})`).all();
}

function rowsOf(source, table) {
  return source.prepare(`SELECT ${ordered.has(table) ? "rowid AS insertion_order," : ""}* FROM ${quote(table)}`).iterate();
}

function comparable(value) {
  return ArrayBuffer.isView(value)
    ? "sha256:" + createHash("sha256").update(value).digest("hex")
    : value;
}

async function transferSqlite(source, target, report, apply) {
  for (const table of tables) {
    const relation = quote(table);
    const sourceColumns = columnsOf(source, table);
    const columns = [...(ordered.has(table) ? ["insertion_order"] : []), ...sourceColumns.map(column => column.name)];
    const key = sourceColumns.filter(column => column.pk).sort((a,b) => a.pk - b.pk).map(column => column.name);
    const targetColumns = (await target.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
      [target.schema, table])).rows.map(column => column.column_name);
    if (!key.length || columns.length !== targetColumns.length || columns.some(column => !targetColumns.includes(column))) {
      fail("TARGET_SCHEMA_MISMATCH", table);
    }
    if (apply) {
      const insert = `INSERT INTO ${relation}(${columns.map(quote).join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")})`;
      let batch = [];
      // Pipeline a bounded number of INSERTs on this transaction's connection.
      for (const row of rowsOf(source, table)) {
        const values = columns.map(column => ArrayBuffer.isView(row[column]) ? Buffer.from(row[column]) : row[column]);
        batch.push(target.query(insert, values));
        if (batch.length >= 16) { await Promise.all(batch); batch = []; }
      }
      await Promise.all(batch);
      const identity = ordered.has(table) ? "insertion_order" : table === "payment_events" ? "id" : null;
      if (identity) {
        // ALTER SEQUENCE is transactional. RESTART also avoids persisting a
        // sequence change if verification fails after loading the rows.
        const [[sequence], [{ next }]] = await Promise.all([
          target.query("SELECT pg_get_serial_sequence($1,$2) AS name", [`${target.schema}.${table}`, identity]).then(x => x.rows),
          target.query(`SELECT COALESCE(max(${quote(identity)}),0)+1 AS next FROM ${relation}`).then(x => x.rows)
        ]);
        if (!sequence?.name) fail("TARGET_IDENTITY_MISSING", table);
        await target.exec(`ALTER SEQUENCE ${sequence.name} RESTART WITH ${next}`);
      }
    }
    const [{ n }] = (await target.query(`SELECT count(*) n FROM ${relation}`)).rows;
    // Runtime-only heartbeats and payment binding can be added at startup.
    const currentRows = table === "worker_heartbeats" || table === "app_meta";
    if (n !== report.tables[table] && (apply || !currentRows || n < report.tables[table])) fail("ROW_COUNT_MISMATCH", table);
    const where = key.map((column, i) => `${quote(column)}=$${i + 1}`).join(" AND ");
    for (const row of rowsOf(source, table)) {
      const [copied] = (await target.query(`SELECT * FROM ${relation} WHERE ${where}`, key.map(column => row[column]))).rows;
      if (!copied || columns.some(column => comparable(row[column]) !== comparable(copied[column]))) fail("ROW_CONTENT_MISMATCH", table);
    }
  }
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const [command, ...args] = process.argv.slice(2);
  const { values } = parseArgs({ args, options: {
    source: { type: "string" }, "dry-run": { type: "boolean" }, apply: { type: "boolean" },
    "resume-root": { type: "string" }, "avatar-root": { type: "string" }
  } });
  if (command === "migrate") {
    const target = openDatabase();
    try {
      await migrateDatabase(target);
      console.log(JSON.stringify({ status: "migrated" }));
    } finally { await target.close(); }
    return;
  }
  if (command !== "import" && command !== "verify") fail("INVALID_COMMAND");
  if (command === "import" && Boolean(values["dry-run"]) === Boolean(values.apply)) fail("SELECT_DRY_RUN_OR_APPLY");
  if (command === "verify" && (values.apply || values["dry-run"])) fail("VERIFY_IS_READ_ONLY");
  const roots = { resumeRoot: values["resume-root"] ?? process.env.RESUME_FILE_ROOT ?? "data/resume-files",
    avatarRoot: values["avatar-root"] ?? process.env.AVATAR_ASSET_ROOT ?? "data/avatar-assets" };
  return withSnapshot(values.source, async source => {
    const report = await inspectSqlite(source, { ...roots, paymentEnv: process.env.PAYMENT_ENV });
    if (values["dry-run"]) {
      console.log(JSON.stringify({ status: "preflight-passed", ...report }));
      return;
    }
    const target = openDatabase();
    try {
      await transaction(target, async () => {
        if (values.apply) {
          await target.exec(`LOCK TABLE ${tables.map(quote).join(",")} IN ACCESS EXCLUSIVE MODE`);
          for (const table of tables) {
            if ((await target.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`)).rowCount) fail("TARGET_NOT_EMPTY", table);
          }
        } else {
          await target.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        }
        await transferSqlite(source, target, report, Boolean(values.apply));
      });
      console.log(JSON.stringify({ status: values.apply ? "imported" : "verified", ...report }));
    } finally { await target.close(); }
  });
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try { await main(); }
  catch (error) {
    console.error(JSON.stringify({ code: error.reportCode ?? error.code ?? "MIGRATION_FAILED", scope: error.reportScope || error.table || undefined }));
    process.exitCode = 1;
  }
}
