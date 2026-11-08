import { randomUUID } from 'node:crypto';
import { transaction } from '../database.mjs';
import { resumeError } from './files.mjs';
import { validateResumeSource } from '../../../contracts/src/resume-source.ts';
import { validateResumeDraft } from '../../../contracts/src/resume-draft.ts';
const STAGES = ['queued', 'validate_source', 'extract_layout', 'classify_sections', 'map_design_modules', 'split_items', 'verify_evidence', 'complete_draft'];
const ERRORS = new Set(['PARSE_TIMEOUT', 'PARSE_FAILED', 'FILE_TYPE_INVALID', 'PDF_PAGE_LIMIT', 'PDF_ENCRYPTED', 'PDF_NO_TEXT']);
const iso = value => new Date(value).toISOString().replace('.000Z', 'Z');

/** Private parse queue. No PDF bytes or source text are stored in task rows. */
export function createResumeParseQueue({
  db,
  repository,
  now = Date.now,
  leaseMs = 30_000,
  maxAttempts = 3,
  rateLimit = 10
}) {
  // Queue transactions must not invoke repository expiry cleanup (which owns its transaction).
  // The bounded repository sweep removes expired files; access is denied immediately here.
  function liveFile(owner, id) {
    const file = db.prepare('SELECT * FROM resume_files WHERE id=? AND owner_session_id=?').get(id, owner);
    if (!file) throw resumeError(404, 'RESUME_NOT_FOUND');
    if (file.expires_at <= now()) throw resumeError(410, 'RESUME_EXPIRED');
    return file;
  }
  function owned(owner, id) {
    const row = db.prepare('SELECT * FROM resumes WHERE id=? AND owner_session_id=?').get(id, owner);
    if (!row) {
      const tomb = db.prepare('SELECT reason FROM resume_tombstones WHERE resume_id=? AND owner_session_id=?').get(id, owner);
      throw resumeError(tomb?.reason === 'expired' ? 410 : 404, tomb?.reason === 'expired' ? 'RESUME_EXPIRED' : 'RESUME_NOT_FOUND');
    }
    liveFile(owner, row.file_id);
    return row;
  }
  const latest = id => db.prepare('SELECT * FROM resume_parse_tasks WHERE resume_id=? ORDER BY rowid DESC LIMIT 1').get(id);
  function sourceFor(row) {
    const file = liveFile(row.owner_session_id, row.file_id);
    return {
      version: 'resume-source-v1',
      fileId: file.id,
      extractionVersion: 'pdf-layout-v1',
      uploadedAt: iso(file.uploaded_at),
      expiresAt: iso(file.expires_at),
      pageCount: file.page_count,
      blocks: db.prepare('SELECT block_json FROM resume_blocks WHERE resume_id=? ORDER BY rowid').all(row.id).map(b => JSON.parse(b.block_json))
    };
  }
  function requireLease(id, token, allowCancel = false) {
    const row = db.prepare('SELECT * FROM resume_parse_tasks WHERE id=? AND lease_token=? AND lease_until>?').get(id, typeof token === 'string' ? token : '', now());
    if (!row || !(row.status === 'RUNNING' || allowCancel && row.status === 'CANCELLING')) throw resumeError(409, 'LEASE_LOST');
    liveFile(row.owner_session_id, row.file_id);
    return row;
  }
  function state(id, status) {
    db.prepare('UPDATE resumes SET status=?,updated_at=? WHERE id=?').run(status, now(), id);
  }
  function sweep() {
    for (const row of db.prepare("SELECT * FROM resume_parse_tasks WHERE status IN ('RUNNING','CANCELLING') AND lease_until<=?").all(now())) {
      const status = row.status === 'CANCELLING' ? 'CANCELLED' : row.attempt_count >= maxAttempts ? 'FAILED' : 'QUEUED';
      db.prepare('UPDATE resume_parse_tasks SET status=?,lease_token=NULL,lease_until=NULL,error_code=?,next_attempt_at=?,updated_at=? WHERE id=?').run(status, status === 'CANCELLED' ? null : 'PARSE_TIMEOUT', now() + 1000 * 2 ** Math.max(0, row.attempt_count - 1), now(), row.id);
      if (status === 'QUEUED') db.prepare("UPDATE resume_parse_tasks SET stage='queued',progress=0 WHERE id=?").run(row.id);
      state(row.resume_id, status);
    }
  }
  function publicStatus(row) {
    const task = latest(row.id);
    return {
      resumeId: row.id,
      expiresAt: iso(liveFile(row.owner_session_id, row.file_id).expires_at),
      status: task?.status ?? row.status,
      stage: task?.stage ?? null,
      progress: task?.progress ?? 0,
      errorCode: task?.error_code ?? null
    };
  }
  return {
    parse(owner, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw resumeError(400, 'PARSE_FAILED');
      const {
        fileId,
        idempotencyKey
      } = input;
      if (typeof fileId !== 'string' || typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey)) throw resumeError(400, 'PARSE_FAILED');
      return transaction(db, () => {
        const prior = db.prepare('SELECT * FROM resume_parse_requests WHERE owner_session_id=? AND idempotency_key=?').get(owner, idempotencyKey);
        if (prior) {
          if (prior.file_id !== fileId) throw resumeError(409, 'IDEMPOTENCY_CONFLICT');
          return publicStatus(owned(owner, prior.resume_id));
        }
        liveFile(owner, fileId);
        if (db.prepare('SELECT COUNT(*) AS n FROM resume_parse_requests WHERE owner_session_id=? AND created_at>?').get(owner, now() - 60_000).n >= rateLimit) throw resumeError(429, 'RATE_LIMITED');
        sweep();
        let row = db.prepare('SELECT * FROM resumes WHERE file_id=? AND owner_session_id=?').get(fileId, owner);
        if (!row) {
          const id = randomUUID();
          db.prepare("INSERT INTO resumes(id,file_id,owner_session_id,status,created_at,updated_at) VALUES(?,?,?,'QUEUED',?,?)").run(id, fileId, owner, now(), now());
          row = owned(owner, id);
        }
        let task = latest(row.id);
        if (!task || ['FAILED', 'CANCELLED'].includes(task.status)) {
          // Fence all historical leases before making a new task for this resume.
          db.prepare('UPDATE resume_parse_tasks SET lease_token=NULL,lease_until=NULL WHERE resume_id=?').run(row.id);
          const id = randomUUID();
          db.prepare("INSERT INTO resume_parse_tasks(id,resume_id,owner_session_id,file_id,idempotency_key,status,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED',?,?)").run(id, row.id, owner, fileId, idempotencyKey, now(), now());
          state(row.id, 'QUEUED');
          task = latest(row.id);
        }
        db.prepare('INSERT INTO resume_parse_requests(owner_session_id,idempotency_key,file_id,resume_id,task_id,created_at) VALUES(?,?,?,?,?,?)').run(owner, idempotencyKey, fileId, row.id, task.id, now());
        return publicStatus(row);
      });
    },
    status(owner, id) {
      // BEGIN IMMEDIATE fences other connections before selecting expired leases.
      // Recovery and the returned resume/task state must observe one transaction.
      return transaction(db, () => {
        const row = owned(owner, id);
        sweep();
        return publicStatus(row);
      });
    },
    draft(owner, id) {
      const row = owned(owner, id);
      if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
      return {
        draft: JSON.parse(row.draft_json),
        expiresAt: iso(liveFile(row.owner_session_id, row.file_id).expires_at),
        revision: row.revision
      };
    },
    patch(owner, id, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw resumeError(400, 'INVALID_DRAFT');
      const {
        revision,
        draft
      } = input;
      return transaction(db, () => {
        const row = owned(owner, id);
        if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
        if (revision !== row.revision || draft?.revision !== revision) throw resumeError(409, 'REVISION_CONFLICT');
        let clean;
        try {
          clean = validateResumeDraft(draft, sourceFor(row));
        } catch {
          throw resumeError(400, 'INVALID_DRAFT');
        }
        if (clean.resumeId !== id || clean.fileId !== row.file_id) throw resumeError(400, 'INVALID_DRAFT');
        clean.revision = revision + 1;
        db.prepare('UPDATE resumes SET draft_json=?,revision=?,updated_at=? WHERE id=?').run(JSON.stringify(clean), clean.revision, now(), id);
        return {
          draft: clean,
          revision: clean.revision
        };
      });
    },
    cancel(owner, id) {
      return transaction(db, () => {
        const row = owned(owner, id);
        sweep();
        const task = latest(id);
        if (task && ['QUEUED', 'RUNNING'].includes(task.status)) {
          const status = task.status === 'QUEUED' ? 'CANCELLED' : 'CANCELLING';
          db.prepare('UPDATE resume_parse_tasks SET status=?,updated_at=? WHERE id=?').run(status, now(), task.id);
          state(id, status);
        }
        return {
          status: publicStatus(row).status
        };
      });
    },
    lease(workerId) {
      if (typeof workerId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(workerId)) throw resumeError(400, 'INVALID_WORKER');
      repository.cleanup();
      return transaction(db, () => {
        sweep();
        const row = db.prepare("SELECT * FROM resume_parse_tasks WHERE status='QUEUED' AND next_attempt_at<=? ORDER BY created_at,rowid LIMIT 1").get(now());
        if (!row) return null;
        const token = randomUUID();
        db.prepare("UPDATE resume_parse_tasks SET status='RUNNING',stage='validate_source',error_code=NULL,lease_token=?,lease_until=?,worker_id=?,attempt_count=attempt_count+1,updated_at=? WHERE id=?").run(token, now() + leaseMs, workerId, now(), row.id);
        state(row.resume_id, 'RUNNING');
        const file = liveFile(row.owner_session_id, row.file_id);
        return {
          id: row.id,
          leaseToken: token,
          workflowVersion: 'resume-parse-v1',
          resumeId: row.resume_id,
          fileId: row.file_id,
          pageCount: file.page_count,
          uploadedAt: iso(file.uploaded_at),
          expiresAt: iso(file.expires_at)
        };
      });
    },
    source(id, token) {
      const row = requireLease(id, token);
      return repository.readFile(row.owner_session_id, row.file_id);
    },
    heartbeat(id, token, {
      stage,
      progress
    } = {}) {
      return transaction(db, () => {
        const row = requireLease(id, token, true);
        if (stage !== undefined && !STAGES.includes(stage) || progress !== undefined && (!Number.isInteger(progress) || progress < 0 || progress > 99)) throw resumeError(400, 'INVALID_PROGRESS');
        db.prepare('UPDATE resume_parse_tasks SET lease_until=?,stage=?,progress=?,updated_at=? WHERE id=?').run(now() + leaseMs, stage ?? row.stage, progress ?? row.progress, now(), id);
        return {
          ok: true,
          cancelRequested: row.status === 'CANCELLING'
        };
      });
    },
    complete(id, token, source, draft) {
      return transaction(db, () => {
        const task = requireLease(id, token),
          file = liveFile(task.owner_session_id, task.file_id);
        let cleanSource, cleanDraft;
        try {
          cleanSource = validateResumeSource(source);
          cleanDraft = validateResumeDraft(draft, cleanSource);
        } catch {
          throw resumeError(400, 'INVALID_DRAFT');
        }
        if (cleanSource.fileId !== file.id || cleanSource.pageCount !== file.page_count || cleanSource.uploadedAt !== iso(file.uploaded_at) || cleanSource.expiresAt !== iso(file.expires_at) || cleanDraft.resumeId !== task.resume_id || cleanDraft.revision !== 1) throw resumeError(400, 'INVALID_DRAFT');
        const covered = new Set(cleanDraft.sections.flatMap(s => s.items.flatMap(i => i.sourceBlockIds)));
        if (cleanSource.blocks.some(b => !covered.has(b.blockId))) throw resumeError(400, 'INVALID_DRAFT');
        const hidden = new Set(['phone', 'age', 'politicalStatus', 'politicalAffiliation', 'expectedSalary', 'salary']);
        if (cleanDraft.sections.some(s => s.items.some(i => i.included || i.facts.some(f => hidden.has(f.key) && f.included)))) throw resumeError(400, 'INVALID_DRAFT');
        db.prepare('DELETE FROM resume_blocks WHERE resume_id=?').run(task.resume_id);
        const insert = db.prepare('INSERT INTO resume_blocks(resume_id,block_id,block_json) VALUES(?,?,?)');
        for (const block of cleanSource.blocks) insert.run(task.resume_id, block.blockId, JSON.stringify(block));
        db.prepare("UPDATE resumes SET draft_json=?,revision=1,status='SUCCEEDED',updated_at=? WHERE id=?").run(JSON.stringify(cleanDraft), now(), task.resume_id);
        db.prepare("UPDATE resume_parse_tasks SET status='SUCCEEDED',stage='complete_draft',progress=100,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now(), id);
        return {
          ok: true
        };
      });
    },
    fail(id, token, code, retryable = false) {
      return transaction(db, () => {
        const row = requireLease(id, token);
        const error = ERRORS.has(code) ? code : 'PARSE_FAILED';
        const retry = retryable === true && ['PARSE_TIMEOUT', 'PARSE_FAILED'].includes(error) && row.attempt_count < maxAttempts;
        const status = retry ? 'QUEUED' : 'FAILED';
        db.prepare('UPDATE resume_parse_tasks SET status=?,error_code=?,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=?').run(status, error, now() + 1000 * 2 ** (row.attempt_count - 1), now(), id);
        if (retry) db.prepare("UPDATE resume_parse_tasks SET stage='queued',progress=0 WHERE id=?").run(id);
        state(row.resume_id, status);
        return {
          ok: true
        };
      });
    },
    ackCancel(id, token) {
      return transaction(db, () => {
        const row = requireLease(id, token, true);
        if (row.status !== 'CANCELLING') throw resumeError(409, 'LEASE_LOST');
        db.prepare("UPDATE resume_parse_tasks SET status='CANCELLED',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now(), id);
        state(row.resume_id, 'CANCELLED');
        return {
          ok: true
        };
      });
    }
  };
}
