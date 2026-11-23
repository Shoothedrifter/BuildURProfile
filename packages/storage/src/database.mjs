import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import initialSchema from "./migrations/001-initial.mjs";

const migrations = [
  [1, initialSchema],
  [2, `DROP INDEX generation_project;
    CREATE INDEX generation_project ON generations(project_id) WHERE project_id IS NOT NULL;`]
];

export function databaseOptions(connectionString, schema = "public") {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid PostgreSQL schema name.");
  return { connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 };
}

const types = {
  getTypeParser(oid, format) {
    if (oid !== 20 || format === "binary") return pg.types.getTypeParser(oid, format);
    return value => {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new RangeError("PostgreSQL integer exceeds the JavaScript safe range.");
      return number;
    };
  }
};

export function openDatabase(connectionString = process.env.DATABASE_URL, { schema = process.env.DATABASE_SCHEMA || "public" } = {}) {
  const pool = new pg.Pool({ ...databaseOptions(connectionString, schema), types, max: 10 });
  pool.on("error", () => console.warn("postgres idle connection disconnected"));
  const scope = new AsyncLocalStorage();
  const query = (sql, values) => (scope.getStore() ?? pool).query(sql, values);
  return {
    schema,
    query,
    async exec(sql) { await query(sql); },
    prepare(sql) {
      // Repository statements use positional parameters, including generated IN lists.
      let position = 0;
      const statement = sql.replace(/\?/g, () => `$${++position}`);
      return {
        async get(...values) { return (await query(statement, values)).rows[0]; },
        async all(...values) { return (await query(statement, values)).rows; },
        async run(...values) { return { changes: (await query(statement, values)).rowCount }; }
      };
    },
    async transaction(work) {
      if (scope.getStore()) throw new Error("Nested database transaction.");
      const client = await pool.connect();
      let discard;
      try {
        await client.query("BEGIN");
        const result = await scope.run(client, work);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); }
        catch { discard = error; }
        throw error;
      } finally {
        client.release(discard);
      }
    },
    close: () => pool.end()
  };
}

export function transaction(db, work) {
  return db.transaction(work);
}

export async function migrateDatabase(db) {
  return transaction(db, async () => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1), 1)", [db.schema]);
    if (db.schema !== "public") await db.exec(`CREATE SCHEMA IF NOT EXISTS "${db.schema}"`);
    await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)");
    const applied = new Set((await db.prepare("SELECT version FROM schema_migrations").all()).map(row => row.version));
    if ([...applied].some(version => !migrations.some(([known]) => known === version))) {
      throw new Error("Database schema is newer than this application.");
    }
    for (const [version, sql] of migrations) {
      if (applied.has(version)) continue;
      await db.exec(sql);
      await db.query("INSERT INTO schema_migrations(version,applied_at) VALUES($1,$2)", [version, Date.now()]);
    }
  });
}

export async function bindPaymentEnvironment(db, environment) {
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("Payment environment must be sandbox or production.");
  }
  await transaction(db, async () => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1), 2)", [db.schema]);
    const existing = await db.prepare("SELECT value FROM app_meta WHERE key='payment_environment'").get();
    if (existing) {
      if (existing.value !== environment) {
        throw new Error(`Database belongs to ${existing.value}; refusing ${environment} payment mode.`);
      }
      return;
    }
    const other = await db.prepare("SELECT 1 FROM orders WHERE payment_env IS NULL OR payment_env<>$1 LIMIT 1").get(environment);
    if (other) throw new Error(`Database has payment history outside ${environment} mode.`);
    await db.prepare("INSERT INTO app_meta(key,value) VALUES('payment_environment',$1)").run(environment);
  });
}
