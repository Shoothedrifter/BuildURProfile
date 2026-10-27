import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path = "data/buildurprofile.sqlite") {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (path.startsWith("data/")) chmodSync(dirname(path), 0o700);
  }
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
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
  `);
  const orderColumns = new Set(db.prepare("PRAGMA table_info(orders)").all().map((column) => column.name));
  for (const column of ["payment_env", "app_id", "seller_id", "seller_email"]) {
    if (!orderColumns.has(column)) db.exec(`ALTER TABLE orders ADD COLUMN ${column} TEXT`);
  }
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
