import { randomUUID } from "node:crypto";
import { migrateDatabase, openDatabase } from "../../../packages/storage/src/database.mjs";

export function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL test database.");
  return url;
}

export function testSchema() {
  return `bup_test_${randomUUID().replaceAll("-", "")}`;
}

export async function openTestDatabase({ schema = testSchema(), cleanup = true } = {}) {
  const db = openDatabase(testDatabaseUrl(), { schema });
  const close = db.close;
  try { await migrateDatabase(db); }
  catch (error) { await close(); throw error; }
  if (cleanup) db.close = async () => {
    try { await db.exec(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await close(); }
  };
  return db;
}
