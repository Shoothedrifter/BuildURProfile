import { randomUUID } from "node:crypto";
import { transaction } from "../database.mjs";
import { createResumeParseQueue } from "./queue.mjs";
import { createResumeFileStore, validatePdf, resumeError } from "./files.mjs";

export function createResumeRepository({ db, root, now = Date.now }) {
  const store = createResumeFileStore(root);
  let cleanupInProgress;

  async function purge(id, reason, { owner, requireUnparsed = false } = {}) {
    await transaction(db, async () => {
      const file = await db.prepare("SELECT * FROM resume_files WHERE id=? FOR UPDATE").get(id);
      if (!file || (owner && file.owner_session_id !== owner)) return;
      if (reason === "expired" && file.expires_at > now()) return;
      if (requireUnparsed && await db.prepare("SELECT 1 FROM resumes WHERE file_id=?").get(id)) {
        throw resumeError(409, "RESUME_ALREADY_PARSED");
      }
      await db.prepare(`INSERT INTO resume_tombstones(resume_id,file_id,owner_session_id,reason)
        VALUES(?,?,?,?) ON CONFLICT(resume_id) DO UPDATE SET reason=excluded.reason`)
        .run("file:" + id, id, file.owner_session_id, reason);
      await db.prepare(`INSERT INTO resume_tombstones(resume_id,file_id,owner_session_id,reason)
        SELECT id,file_id,owner_session_id,? FROM resumes WHERE file_id=?
        ON CONFLICT(resume_id) DO UPDATE SET reason=excluded.reason`).run(reason, id);
      await db.prepare("DELETE FROM resume_files WHERE id=?").run(id);
      store.remove(id);
    });
  }

  function cleanup(limit = 25) {
    // The file store retains a single directory cursor for bounded reconciliation.
    cleanupInProgress ??= (async () => {
      const expired = await db.prepare("SELECT id FROM resume_files WHERE expires_at<=? ORDER BY expires_at LIMIT ?").all(now(), limit);
      for (const file of expired) await purge(file.id, "expired");
      await store.reconcile(async id => Boolean(await db.prepare("SELECT 1 FROM resume_files WHERE id=?").get(id)), now(), limit);
    })().finally(() => { cleanupInProgress = undefined; });
    return cleanupInProgress;
  }

  async function getFile(owner, id) {
    const row = await db.prepare("SELECT * FROM resume_files WHERE id=? AND owner_session_id=?").get(id, owner);
    if (!row) throw resumeError(404, "RESUME_NOT_FOUND");
    if (row.expires_at <= now()) {
      await purge(id, "expired", { owner });
      throw resumeError(410, "RESUME_EXPIRED");
    }
    return row;
  }

  async function getResume(owner, id) {
    const row = await db.prepare("SELECT file_id FROM resumes WHERE id=? AND owner_session_id=?").get(id, owner);
    if (row) return getFile(owner, row.file_id);
    const tomb = await db.prepare("SELECT reason FROM resume_tombstones WHERE resume_id=? AND owner_session_id=?").get(id, owner);
    throw resumeError(tomb?.reason === "expired" ? 410 : 404, tomb?.reason === "expired" ? "RESUME_EXPIRED" : "RESUME_NOT_FOUND");
  }

  const repository = {
    cleanup,
    getFile,
    async deleteFile(owner, id) {
      if (await db.prepare("SELECT 1 FROM resume_tombstones WHERE resume_id=? AND owner_session_id=?").get("file:" + id, owner)) {
        return { ok: true };
      }
      await getFile(owner, id);
      await purge(id, "deleted", { owner, requireUnparsed: true });
      return { ok: true };
    },
    async upload(owner, bytes, fileName, mime) {
      if (typeof fileName !== "string" || fileName.length > 200 || /[\x00-\x1f\x7f/\\]/.test(fileName)
        || !fileName.toLowerCase().endsWith(".pdf") || mime?.split(";")[0].trim().toLowerCase() !== "application/pdf") {
        throw resumeError(400, "FILE_TYPE_INVALID");
      }
      const { pageCount, emptyPages } = await validatePdf(bytes);
      const id = randomUUID(), uploadedAt = Math.floor(now() / 1000) * 1000;
      try {
        store.write(id, bytes);
        await db.prepare(`INSERT INTO resume_files(id,owner_session_id,file_name,size,page_count,uploaded_at,expires_at,empty_pages_json)
          VALUES(?,?,?,?,?,?,?,?)`).run(id, owner, fileName, bytes.length, pageCount, uploadedAt, uploadedAt + 30 * 86400000, JSON.stringify(emptyPages));
      } catch {
        store.remove(id);
        throw resumeError(500, "UPLOAD_FAILED");
      }
      return { fileId: id, fileName, size: bytes.length, pageCount, emptyPages };
    },
    async cloneForReparse(owner, resumeId) {
      const original = await getResume(owner, resumeId);
      return repository.upload(owner, store.read(original.id), original.file_name, "application/pdf");
    },
    async readFile(owner, id) {
      await getFile(owner, id);
      return store.read(id);
    },
    async readSource(owner, id) {
      const row = await getResume(owner, id);
      return store.read(row.id);
    },
    async delete(owner, id) {
      const tomb = await db.prepare("SELECT 1 FROM resume_tombstones WHERE resume_id=? AND owner_session_id=?").get(id, owner);
      if (tomb) return { ok: true };
      const row = await getResume(owner, id);
      await purge(row.id, "deleted", { owner });
      return { ok: true };
    }
  };
  repository.queue = createResumeParseQueue({ db, repository, now });
  return repository;
}
