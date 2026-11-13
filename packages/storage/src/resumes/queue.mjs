import { validateImage } from '../generation/assets.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from '../database.mjs';
import { resumeError } from './files.mjs';
import { validateResumeSource } from '../../../contracts/src/resume-source.ts';
import { normalizeResumeDraft, validateResumeDraft, validateResumeDraftV2 } from '../../../contracts/src/resume-draft.ts';
const STAGES = ['queued', 'validate_source', 'extract_layout', 'classify_sections', 'map_design_modules', 'split_items', 'format_items', 'verify_evidence', 'complete_draft'];
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
      fileId: row.file_id,
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
          db.prepare("INSERT INTO resume_parse_tasks(id,resume_id,owner_session_id,file_id,workflow_version,idempotency_key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'QUEUED',?,?)").run(id, row.id, owner, fileId, 'resume-parse-v2', idempotencyKey, now(), now());
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
        draft: normalizeResumeDraft(JSON.parse(row.draft_json)),
        expiresAt: iso(liveFile(row.owner_session_id, row.file_id).expires_at),
        revision: row.revision
      };
    },
    // 原文对照摘录：仅暴露条目核对所需字段，bbox/字号等私有布局细节不下发
    blocks(owner, id) {
      const row = owned(owner, id);
      if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
      return {
        blocks: db.prepare('SELECT block_json FROM resume_blocks WHERE resume_id=? ORDER BY rowid').all(row.id)
          .map(b => JSON.parse(b.block_json))
          .map(({ blockId, page, readingOrder, text }) => ({ blockId, page, readingOrder, text }))
      };
    },
    // 条目补充图片：仅限属主在草稿就绪后上传，类型与大小在入库前收紧
    saveImage(owner, id, contentType, bytes, itemId = null) {
      return transaction(db, () => {
      const row = owned(owner, id);
      if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
      const type = String(contentType ?? '').split(';')[0].trim();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw resumeError(400, 'IMAGE_TYPE_INVALID');
      if (bytes.length > 5 * 1024 * 1024) throw resumeError(413, 'IMAGE_TOO_LARGE');
      try { validateImage(Buffer.from(bytes), type, 1); } catch { throw resumeError(400, 'IMAGE_TYPE_INVALID'); }
      if (itemId !== null && (typeof itemId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(itemId))) throw resumeError(400, 'INVALID_DRAFT');
      const totals=db.prepare('SELECT count(*) n,COALESCE(sum(length(data)),0) size FROM resume_images WHERE resume_id=?').get(id);
      if(totals.n>=24 || totals.size+bytes.length>50*1024*1024) throw resumeError(413,'IMAGE_TOTAL_LIMIT');
      if(itemId && db.prepare('SELECT count(*) n FROM resume_images WHERE resume_id=? AND item_id=?').get(id,itemId).n>=6) throw resumeError(413,'IMAGE_ITEM_LIMIT');
      const imageId = randomUUID();
      db.prepare('INSERT INTO resume_images(id,resume_id,content_type,data,created_at,item_id) VALUES(?,?,?,?,?,?)').run(imageId, row.id, type, bytes, now(),itemId);
      return { imageId };
      });
    },
    pendingImages(owner, id) {
      const row = owned(owner, id);
      if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
      const draft = JSON.parse(row.draft_json);
      const referenced = new Set(draft.sections.flatMap(section => section.items.flatMap(item =>
        (item.supplements?.images ?? []).map(image => image.imageId))));
      return { images: db.prepare('SELECT id,item_id,content_type,length(data) size FROM resume_images WHERE resume_id=? ORDER BY created_at,rowid').all(id)
        .filter(image => !referenced.has(image.id))
        .map(image => ({ imageId: image.id, itemId: image.item_id, contentType: image.content_type, size: image.size })) };
    },
    deleteImage(owner, id, imageId) {
      return transaction(db,()=>{
        const row=owned(owner,id),draft=JSON.parse(row.draft_json ?? '{}');
        if(draft.sections?.some(s=>s.items.some(i=>i.supplements?.images.some(m=>m.imageId===imageId)))) throw resumeError(409,'IMAGE_STILL_REFERENCED');
        db.prepare('DELETE FROM resume_images WHERE id=? AND resume_id=?').run(imageId,id);
        return {ok:true};
      });
    },
    readImage(owner, id, imageId) {
      const row = owned(owner, id);
      const image = db.prepare('SELECT content_type,data FROM resume_images WHERE id=? AND resume_id=?').get(imageId, row.id);
      if (!image) throw resumeError(404, 'IMAGE_NOT_FOUND');
      return { contentType: image.content_type, bytes: image.data };
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
          clean = draft?.version === 'resume-draft-v2'
            ? validateResumeDraftV2(draft, sourceFor(row))
            : normalizeResumeDraft(validateResumeDraft(draft, sourceFor(row)));
        } catch {
          throw resumeError(400, 'INVALID_DRAFT');
        }
        if (clean.resumeId !== id || clean.fileId !== row.file_id) throw resumeError(400, 'INVALID_DRAFT');
        // 补充图片必须真实存在且属于本简历，拒绝悬空引用
        const imageIds = [...new Set(clean.sections.flatMap(s => s.items.flatMap(i => i.supplements?.images.map(g => g.imageId) ?? [])))];
        if (imageIds.length) {
          const placeholders = imageIds.map(() => '?').join(',');
          const found = db.prepare(`SELECT COUNT(*) AS n FROM resume_images WHERE resume_id=? AND id IN (${placeholders})`).get(id, ...imageIds).n;
          if (found !== imageIds.length) throw resumeError(400, 'INVALID_DRAFT');
        }
        const previous=JSON.parse(row.draft_json);
        const removed=previous.sections.flatMap(s=>s.items.flatMap(i=>i.supplements?.images ?? [])).filter(m=>!imageIds.includes(m.imageId));
        for(const image of removed) db.prepare('DELETE FROM resume_images WHERE id=? AND resume_id=?').run(image.imageId,id);
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
        const workflowVersion = row.workflow_version === 'resume-parse-v1' ? 'resume-parse-v2' : row.workflow_version;
        db.prepare("UPDATE resume_parse_tasks SET status='RUNNING',workflow_version=?,stage='validate_source',error_code=NULL,lease_token=?,lease_until=?,worker_id=?,attempt_count=attempt_count+1,updated_at=? WHERE id=?").run(workflowVersion, token, now() + leaseMs, workerId, now(), row.id);
        state(row.resume_id, 'RUNNING');
        const file = liveFile(row.owner_session_id, row.file_id);
        return {
          id: row.id,
          leaseToken: token,
          workflowVersion,
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
        db.prepare("UPDATE resumes SET draft_json=?,revision=1,status='SUCCEEDED',updated_at=? WHERE id=?").run(JSON.stringify(normalizeResumeDraft(cleanDraft)), now(), task.resume_id);
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
