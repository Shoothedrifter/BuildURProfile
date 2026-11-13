import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function applyMigration(db, version, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(version);
    if (!applied) {
      work();
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(?,?)").run(version, Date.now());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(path = "data/buildurprofile.sqlite") {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (path.startsWith("data/")) chmodSync(dirname(path), 0o700);
  }
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  applyMigration(db, 1, () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, owner_session_id TEXT NOT NULL REFERENCES sessions(id), config_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, pending_action TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      out_trade_no TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      amount_fen INTEGER NOT NULL CHECK(amount_fen > 0), status TEXT NOT NULL,
      payment_env TEXT, app_id TEXT, seller_id TEXT, seller_email TEXT,
      alipay_trade_no TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_order_per_project ON orders(project_id) WHERE status='PENDING';
    CREATE TABLE IF NOT EXISTS entitlements (
      project_id TEXT PRIMARY KEY REFERENCES projects(id), status TEXT NOT NULL,
      granted_by_order TEXT NOT NULL REFERENCES orders(out_trade_no), granted_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS shares (
      token TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL,
      config_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS shares_by_project ON shares(project_id);
    CREATE TABLE IF NOT EXISTS downloads (
      token TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL, status TEXT NOT NULL,
      completed_at INTEGER, error TEXT, PRIMARY KEY(project_id, kind)
    );
    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, out_trade_no TEXT NOT NULL, alipay_trade_no TEXT,
      trade_status TEXT NOT NULL, accepted_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS avatar_assets (
      id TEXT PRIMARY KEY, owner_session_id TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL,
      mime TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY, owner_session_id TEXT NOT NULL REFERENCES sessions(id),
      portrait_asset_id TEXT REFERENCES avatar_assets(id), style_id TEXT, config_json TEXT,
      idempotency_key TEXT NOT NULL, status TEXT NOT NULL, output_asset_id TEXT REFERENCES avatar_assets(id),
      error TEXT, lease_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(owner_session_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS generation_queue ON generations(status, lease_until, created_at);
    `);
    const orderColumns = new Set(db.prepare("PRAGMA table_info(orders)").all().map((column) => column.name));
    for (const column of ["payment_env", "app_id", "seller_id", "seller_email"]) {
      if (!orderColumns.has(column)) db.exec(`ALTER TABLE orders ADD COLUMN ${column} TEXT`);
    }
  });
  applyMigration(db, 2, () => {
    const columns = new Set(db.prepare("PRAGMA table_info(generations)").all().map((column) => column.name));
    const additions = [
      ["brief_json", "TEXT"],
      ["workflow_version", "TEXT NOT NULL DEFAULT 'agent-v1'"],
      ["lease_token", "TEXT"],
      ["attempt_count", "INTEGER NOT NULL DEFAULT 0"],
      ["next_attempt_at", "INTEGER NOT NULL DEFAULT 0"]
    ];
    for (const [column, definition] of additions) {
      if (!columns.has(column)) db.exec(`ALTER TABLE generations ADD COLUMN ${column} ${definition}`);
    }
    db.exec("CREATE INDEX IF NOT EXISTS generation_queue_v2 ON generations(status, next_attempt_at, lease_until, created_at)");
  });
  applyMigration(db, 3, () => {
    db.exec(`CREATE TABLE IF NOT EXISTS worker_heartbeats (
      worker_id TEXT PRIMARY KEY, touched_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS worker_heartbeats_recent ON worker_heartbeats(touched_at);`);
  });
  applyMigration(db, 4, () => {
    const columns = new Set(db.prepare("PRAGMA table_info(generations)").all().map((column) => column.name));
    if (!columns.has("cancel_requested_at")) db.exec("ALTER TABLE generations ADD COLUMN cancel_requested_at INTEGER");
    db.exec("CREATE INDEX IF NOT EXISTS generation_cancel_requested ON generations(status, cancel_requested_at, lease_until)");
  });
  applyMigration(db, 5, () => {
    const columns = new Set(db.prepare("PRAGMA table_info(projects)").all().map((column) => column.name));
    if (!columns.has("deleted_at")) db.exec("ALTER TABLE projects ADD COLUMN deleted_at INTEGER");
    db.exec("CREATE INDEX IF NOT EXISTS active_projects_by_owner ON projects(owner_session_id, deleted_at, updated_at)");
  });
  applyMigration(db, 6, () => {
    db.exec(`CREATE TABLE resume_files (
      id TEXT PRIMARY KEY, owner_session_id TEXT NOT NULL REFERENCES sessions(id),
      file_name TEXT NOT NULL, size INTEGER NOT NULL, page_count INTEGER NOT NULL,
      uploaded_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX resume_files_expiry ON resume_files(expires_at);
    CREATE INDEX resume_files_owner ON resume_files(owner_session_id);
    CREATE TABLE resumes (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL UNIQUE REFERENCES resume_files(id) ON DELETE CASCADE,
      owner_session_id TEXT NOT NULL REFERENCES sessions(id), status TEXT NOT NULL,
      draft_json TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX resumes_owner ON resumes(owner_session_id);
    CREATE TABLE resume_blocks (
      resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL, block_json TEXT NOT NULL, PRIMARY KEY(resume_id,block_id)
    );
    CREATE TABLE resume_tombstones (
      resume_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, owner_session_id TEXT NOT NULL, reason TEXT NOT NULL
    );`);
  });
  applyMigration(db, 7, () => {
    db.exec(`CREATE TABLE resume_parse_tasks (
      id TEXT PRIMARY KEY, resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      owner_session_id TEXT NOT NULL REFERENCES sessions(id), file_id TEXT NOT NULL,
      workflow_version TEXT NOT NULL DEFAULT 'resume-parse-v1', idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'queued', progress INTEGER NOT NULL DEFAULT 0,
      error_code TEXT, lease_token TEXT, lease_until INTEGER, worker_id TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(owner_session_id,idempotency_key)
    );
    CREATE INDEX resume_parse_queue ON resume_parse_tasks(status,next_attempt_at,lease_until,created_at);
    CREATE TABLE resume_parse_requests (
      owner_session_id TEXT NOT NULL REFERENCES sessions(id), idempotency_key TEXT NOT NULL,
      file_id TEXT NOT NULL, resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES resume_parse_tasks(id) ON DELETE CASCADE, created_at INTEGER NOT NULL,
      PRIMARY KEY(owner_session_id,idempotency_key)
    );`);
  });
  applyMigration(db, 8, () => {
    // 条目补充图片：字节随库保存，resume 删除时级联清理，无孤儿文件
    db.exec(`CREATE TABLE resume_images (
      id TEXT PRIMARY KEY, resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      content_type TEXT NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL
    );`);
  });
  applyMigration(db, 9, () => {
    db.exec(`ALTER TABLE resume_images ADD COLUMN item_id TEXT;
      ALTER TABLE generations ADD COLUMN project_id TEXT REFERENCES projects(id);
      ALTER TABLE generations ADD COLUMN resume_request_json TEXT;
      CREATE TABLE showcase_media(id TEXT PRIMARY KEY,owner_session_id TEXT NOT NULL REFERENCES sessions(id),content_type TEXT NOT NULL,data BLOB NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE generation_media(generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,media_id TEXT NOT NULL REFERENCES showcase_media(id) ON DELETE CASCADE,PRIMARY KEY(generation_id,media_id));
      CREATE TABLE project_media(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,media_id TEXT NOT NULL REFERENCES showcase_media(id) ON DELETE CASCADE,PRIMARY KEY(project_id,media_id));
      CREATE INDEX resume_images_resume ON resume_images(resume_id,item_id);
      CREATE INDEX showcase_media_created ON showcase_media(created_at);
      CREATE UNIQUE INDEX generation_project ON generations(project_id) WHERE project_id IS NOT NULL;`);
  });
  applyMigration(db, 10, () => {
    db.exec(`CREATE TABLE session_cache_scopes (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        cache_scope TEXT NOT NULL
      );
      CREATE TABLE resume_versions (
        resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, draft_json TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(resume_id, revision)
      );
      CREATE INDEX resume_versions_latest ON resume_versions(resume_id, revision DESC);`);
  });
  return db;
}

export function bindPaymentEnvironment(db, environment) {
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("Payment environment must be sandbox or production.");
  }
  transaction(db, () => {
    const existing = db.prepare("SELECT value FROM app_meta WHERE key='payment_environment'").get();
    if (existing) {
      if (existing.value !== environment) {
        throw new Error(`Database belongs to ${existing.value}; refusing ${environment} payment mode.`);
      }
      return;
    }
    // Legacy databases are safe to bind only if every recorded order already belongs to this mode.
    const other = db.prepare("SELECT 1 FROM orders WHERE payment_env IS NULL OR payment_env<>? LIMIT 1").get(environment);
    if (other) throw new Error(`Database has payment history outside ${environment} mode.`);
    db.prepare("INSERT INTO app_meta(key,value) VALUES('payment_environment',?)").run(environment);
  });
}

export function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
