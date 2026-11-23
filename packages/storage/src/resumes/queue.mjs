import { validateImage } from '../generation/assets.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from '../database.mjs';
import { resumeError } from './files.mjs';
import { validateResumeSource } from '../../../contracts/src/resume-source.ts';
import { normalizeResumeDraft, validateResumeDraft, validateResumeDraftV2 } from '../../../contracts/src/resume-draft.ts';
import { highlightIsValid, supportsHighlights as eligibleHighlightModule } from '../../../contracts/src/presentation-highlights.mjs';
import { draftImageIds, historyImageIds, listVersions, readVersion, reclaimImages, restoreVersion, snapshotPrevious } from './versions.mjs';
import { mergeEmptyDraft, overwriteDraft, reconcileCandidateSource, recordDeletedItems } from './candidates.mjs';
const STAGES = ['queued', 'validate_source', 'extract_layout', 'ocr_pages', 'classify_sections', 'map_design_modules', 'split_items', 'format_items', 'verify_evidence', 'complete_draft'];
const ERRORS = new Set(['PARSE_TIMEOUT', 'PARSE_FAILED', 'FILE_TYPE_INVALID', 'PDF_PAGE_LIMIT', 'PDF_ENCRYPTED', 'PDF_NO_TEXT',
  'OCR_UNAVAILABLE','OCR_LANGUAGE_MISSING','OCR_TIMEOUT','OCR_NO_TEXT','OCR_FAILED','REVISION_CONFLICT']);
const iso = value => new Date(value).toISOString().replace('.000Z', 'Z');
const usesOcr = version => version === 'resume-parse-v3' || version === 'resume-parse-v5';
const supportsHighlights = version => version === 'resume-parse-v4' || version === 'resume-parse-v5';
const newWorkflow = ocrRequested => ocrRequested ? 'resume-parse-v5' : 'resume-parse-v4';

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
  async function liveFile(owner, id, lock = false) {
    const file = await db.prepare(`SELECT * FROM resume_files WHERE id=? AND owner_session_id=?${lock ? " FOR UPDATE" : ""}`).get(id, owner);
    if (!file) throw resumeError(404, 'RESUME_NOT_FOUND');
    if (file.expires_at <= now()) throw resumeError(410, 'RESUME_EXPIRED');
    return file;
  }
  async function owned(owner, id, lock = false) {
    const row = await db.prepare(`SELECT * FROM resumes WHERE id=? AND owner_session_id=?${lock ? " FOR UPDATE" : ""}`).get(id, owner);
    if (!row) {
      const tomb = await db.prepare('SELECT reason FROM resume_tombstones WHERE resume_id=? AND owner_session_id=?').get(id, owner);
      throw resumeError(tomb?.reason === 'expired' ? 410 : 404, tomb?.reason === 'expired' ? 'RESUME_EXPIRED' : 'RESUME_NOT_FOUND');
    }
    await liveFile(owner, row.file_id);
    return row;
  }
  const latest = async (id) => await db.prepare('SELECT * FROM resume_parse_tasks WHERE resume_id=? AND candidate_id IS NULL ORDER BY insertion_order DESC LIMIT 1').get(id);
  async function sourceFor(row) {
    const file = await liveFile(row.owner_session_id, row.file_id);
    const blocks=(await db.prepare('SELECT block_json FROM resume_blocks WHERE resume_id=? ORDER BY insertion_order').all(row.id)).map(b=>JSON.parse(b.block_json));
    const isV2=blocks.some(block=>block.sourceType);
    return {
      version: isV2?'resume-source-v2':'resume-source-v1',
      fileId: file.id,
      extractionVersion: isV2?'pdf-layout-v2':'pdf-layout-v1',
      uploadedAt: iso(file.uploaded_at),
      expiresAt: iso(file.expires_at),
      pageCount: file.page_count,
      blocks: isV2?blocks.map(block=>block.sourceType?block:{...block,sourceType:'pdf',ocrConfidence:null}):blocks
    };
  }
  async function requireLease(id, token, allowCancel = false, lock = false) {
    if (lock) await db.prepare("SELECT r.id FROM resume_parse_tasks t JOIN resumes r ON r.id=t.resume_id WHERE t.id=? FOR UPDATE OF r").get(id);
    const row = await db.prepare(`SELECT * FROM resume_parse_tasks WHERE id=? AND lease_token=? AND lease_until>?${lock ? " FOR UPDATE" : ""}`).get(id, typeof token === 'string' ? token : '', now());
    if (!row || !(row.status === 'RUNNING' || allowCancel && row.status === 'CANCELLING')) throw resumeError(409, 'LEASE_LOST');
    await liveFile(row.owner_session_id, row.file_id);
    return row;
  }
  async function state(id, status) {
    await db.prepare('UPDATE resumes SET status=?,updated_at=? WHERE id=?').run(status, now(), id);
  }
  async function sweep(resumeId = null) {
    const time = now();
    const parents = resumeId ? [{id: resumeId}] : await db.prepare(`SELECT r.id FROM resumes r
      WHERE EXISTS (SELECT 1 FROM resume_parse_tasks t WHERE t.resume_id=r.id
        AND t.status IN ('RUNNING','CANCELLING') AND t.lease_until<=?)
      ORDER BY r.id LIMIT 25 FOR UPDATE OF r SKIP LOCKED`).all(time);
    for (const parent of parents) {
      for (const row of await db.prepare("SELECT * FROM resume_parse_tasks WHERE resume_id=? AND status IN ('RUNNING','CANCELLING') AND lease_until<=? FOR UPDATE").all(parent.id, time)) {
        const status = row.status === 'CANCELLING' ? 'CANCELLED' : row.attempt_count >= maxAttempts ? 'FAILED' : 'QUEUED';
        await db.prepare('UPDATE resume_parse_tasks SET status=?,lease_token=NULL,lease_until=NULL,error_code=?,next_attempt_at=?,updated_at=? WHERE id=?').run(status, status === 'CANCELLED' ? null : 'PARSE_TIMEOUT', now() + 1000 * 2 ** Math.max(0, row.attempt_count - 1), now(), row.id);
        if (status === 'QUEUED') await db.prepare("UPDATE resume_parse_tasks SET stage='queued',progress=0 WHERE id=?").run(row.id);
        if(!row.candidate_id)await state(row.resume_id, status);
      }
    }
  }
  async function publicStatus(row) {
    const task = await latest(row.id);
    return {
      resumeId: row.id,
      fileId: row.file_id,
      expiresAt: iso((await liveFile(row.owner_session_id, row.file_id)).expires_at),
      status: task?.status ?? row.status,
      stage: task?.stage ?? null,
      progress: task?.progress ?? 0,
      errorCode: task?.error_code ?? null,
      ocrAvailable: JSON.parse((await liveFile(row.owner_session_id,row.file_id)).empty_pages_json??'null')?.length>0
    };
  }
  return {
    async parse(owner, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw resumeError(400, 'PARSE_FAILED');
      const {
        fileId,
        idempotencyKey,ocrRequested=false
      } = input;
      if (typeof fileId !== 'string' || typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey)
          ||typeof ocrRequested!=='boolean') throw resumeError(400, 'PARSE_FAILED');
      return await transaction(db, async () => {
        await db.prepare("SELECT id FROM sessions WHERE id=? FOR UPDATE").get(owner);
        const prior = await db.prepare('SELECT * FROM resume_parse_requests WHERE owner_session_id=? AND idempotency_key=?').get(owner, idempotencyKey);
        if (prior) {
          if (prior.file_id !== fileId) throw resumeError(409, 'IDEMPOTENCY_CONFLICT');
          const previousTask=await db.prepare('SELECT workflow_version FROM resume_parse_tasks WHERE id=?').get(prior.task_id);
          if(usesOcr(previousTask?.workflow_version)!==ocrRequested)throw resumeError(409,'IDEMPOTENCY_CONFLICT');
          return await publicStatus(await owned(owner, prior.resume_id));
        }
        const file=await liveFile(owner, fileId, true);
        if(ocrRequested&&file.empty_pages_json==='[]')throw resumeError(400,'OCR_NOT_NEEDED');
        if ((await db.prepare('SELECT COUNT(*) AS n FROM resume_parse_requests WHERE owner_session_id=? AND created_at>?').get(owner, now() - 60_000)).n >= rateLimit) throw resumeError(429, 'RATE_LIMITED');
        let row = await db.prepare('SELECT * FROM resumes WHERE file_id=? AND owner_session_id=? FOR UPDATE').get(fileId, owner);
        if(ocrRequested&&row?.status==='SUCCEEDED')throw resumeError(409,'DRAFT_ALREADY_READY');
        if (!row) {
          const id = randomUUID();
          await db.prepare("INSERT INTO resumes(id,file_id,owner_session_id,status,created_at,updated_at) VALUES(?,?,?,'QUEUED',?,?)").run(id, fileId, owner, now(), now());
          row = await owned(owner, id);
        }
        await sweep(row.id);
        let task = await latest(row.id);
        if (task && ['QUEUED','RUNNING','CANCELLING'].includes(task.status)
            && usesOcr(task.workflow_version)!==ocrRequested)
          throw resumeError(409,'PARSE_IN_PROGRESS');
        if (!task || ['FAILED', 'CANCELLED'].includes(task.status)) {
          // Fence all historical leases before making a new task for this resume.
          await db.prepare('UPDATE resume_parse_tasks SET lease_token=NULL,lease_until=NULL WHERE resume_id=?').run(row.id);
          const id = randomUUID();
          await db.prepare("INSERT INTO resume_parse_tasks(id,resume_id,owner_session_id,file_id,workflow_version,idempotency_key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'QUEUED',?,?)").run(id, row.id, owner, fileId, newWorkflow(ocrRequested), idempotencyKey, now(), now());
          await state(row.id, 'QUEUED');
          task = await latest(row.id);
        }
        await db.prepare('INSERT INTO resume_parse_requests(owner_session_id,idempotency_key,file_id,resume_id,task_id,created_at) VALUES(?,?,?,?,?,?)').run(owner, idempotencyKey, fileId, row.id, task.id, now());
        return await publicStatus(row);
      });
    },
    async createCandidate(owner,id,input) {
      if(!input||!['overwrite','fillEmpty'].includes(input.mode)||!Number.isInteger(input.expectedRevision)
          ||(input.ocrRequested!==undefined&&typeof input.ocrRequested!=='boolean')
          ||typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.idempotencyKey))
        throw resumeError(400,'INVALID_DRAFT');
      return await transaction(db,async ()=>{
        await db.prepare("SELECT id FROM sessions WHERE id=? FOR UPDATE").get(owner);
        const row=await owned(owner,id,true);
        if(row.status!=='SUCCEEDED'||!row.draft_json)throw resumeError(409,'DRAFT_NOT_READY');
        const previous=await db.prepare('SELECT * FROM resume_reparse_candidates WHERE resume_id=? AND idempotency_key=?').get(id,input.idempotencyKey);
        if(previous){
          if(previous.mode!==input.mode||previous.base_revision!==input.expectedRevision
              ||Boolean(previous.ocr_requested)!==Boolean(input.ocrRequested))throw resumeError(409,'IDEMPOTENCY_CONFLICT');
          return {taskId:previous.task_id,resumeId:id,...await this.candidate(owner,id,previous.task_id)};
        }
        if(row.revision!==input.expectedRevision)throw resumeError(409,'REVISION_CONFLICT');
        const file=await liveFile(owner,row.file_id);
        if(input.ocrRequested&&file.empty_pages_json==='[]')throw resumeError(400,'OCR_NOT_NEEDED');
        if((await db.prepare('SELECT COUNT(*) n FROM resume_reparse_candidates WHERE owner_session_id=? AND created_at>?').get(owner,now()-60_000)).n>=rateLimit)
          throw resumeError(429,'RATE_LIMITED');
        const taskId=randomUUID();
        await db.prepare("INSERT INTO resume_parse_tasks(id,resume_id,owner_session_id,file_id,workflow_version,idempotency_key,status,created_at,updated_at,candidate_id) VALUES(?,?,?,?,?,?,'QUEUED',?,?,?)")
          .run(taskId,id,owner,row.file_id,newWorkflow(input.ocrRequested),input.idempotencyKey,now(),now(),taskId);
        await db.prepare('INSERT INTO resume_reparse_candidates(task_id,resume_id,owner_session_id,base_revision,mode,idempotency_key,created_at,updated_at,ocr_requested) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(taskId,id,owner,row.revision,input.mode,input.idempotencyKey,now(),now(),input.ocrRequested?1:0);
        return {taskId,resumeId:id,status:'QUEUED',mode:input.mode,baseRevision:row.revision};
      });
    },
    async candidate(owner,id,taskId) {
      await owned(owner,id);
      const record=await db.prepare('SELECT c.*,t.status,t.stage,t.progress,t.error_code FROM resume_reparse_candidates c JOIN resume_parse_tasks t ON t.id=c.task_id WHERE c.resume_id=? AND c.task_id=? AND c.owner_session_id=?').get(id,taskId,owner);
      if(!record)throw resumeError(404,'CANDIDATE_NOT_FOUND');
      const preview=record.draft_json?JSON.parse(record.draft_json).sections.map(section=>({kind:section.kind,
        items:section.items.map(item=>({itemId:item.itemId,title:item.title,details:item.details,facts:item.facts}))})):null;
      return {taskId,resumeId:id,status:record.status,stage:record.stage,progress:record.progress,
        errorCode:record.error_code,mode:record.mode,baseRevision:record.base_revision,ocrRequested:Boolean(record.ocr_requested),
        appliedRevision:record.applied_revision,preview};
    },
    async applyCandidate(owner,id,taskId,input) {
      return await transaction(db,async ()=>{
        const row=await owned(owner,id,true);
        const candidate=await db.prepare('SELECT c.*,t.status FROM resume_reparse_candidates c JOIN resume_parse_tasks t ON t.id=c.task_id WHERE c.resume_id=? AND c.task_id=? AND c.owner_session_id=?').get(id,taskId,owner);
        if(!candidate)throw resumeError(404,'CANDIDATE_NOT_FOUND');
        if(!input||!Number.isInteger(input.expectedRevision))throw resumeError(400,'INVALID_REVISION');
        if(candidate.applied_revision!==null)return {revision:candidate.applied_revision,alreadyApplied:true};
        if(candidate.status!=='SUCCEEDED'||!candidate.draft_json||!candidate.source_json)throw resumeError(409,'CANDIDATE_NOT_READY');
        if(row.revision!==candidate.base_revision||row.revision!==input.expectedRevision)throw resumeError(409,'REVISION_CONFLICT');
        const current=normalizeResumeDraft(JSON.parse(row.draft_json));
        const oldSource=await sourceFor(row);
        const reconciled=reconcileCandidateSource(oldSource,JSON.parse(candidate.source_json),
          normalizeResumeDraft(JSON.parse(candidate.draft_json)),taskId);
        const deleted=new Set((await db.prepare('SELECT source_ids_json FROM resume_deleted_items WHERE resume_id=?').all(id))
          .flatMap(entry=>JSON.parse(entry.source_ids_json)));
        const result=candidate.mode==='overwrite'?overwriteDraft(current,reconciled.draft)
          :mergeEmptyDraft(current,reconciled.draft,deleted,Boolean(candidate.ocr_requested));
        result.revision=row.revision+1;
        let clean;
        try{clean=validateResumeDraftV2(result,reconciled.source);}catch{throw resumeError(400,'INVALID_DRAFT');}
        const ids=[...draftImageIds(clean)];
        if(ids.length){
          const count=(await db.prepare(`SELECT COUNT(*) n FROM resume_images WHERE resume_id=? AND id IN (${ids.map(()=>'?').join(',')})`).get(id,...ids)).n;
          if(count!==ids.length)throw resumeError(409,'HISTORY_IMAGE_MISSING');
        }
        const prior=await snapshotPrevious(db,row,now);
        const insert=db.prepare('INSERT INTO resume_blocks(resume_id,block_id,block_json) VALUES(?,?,?)');
        for(const block of reconciled.newBlocks)await insert.run(id,block.blockId,JSON.stringify(block));
        await recordDeletedItems(db,id,current,clean);
        await db.prepare('UPDATE resumes SET draft_json=?,revision=?,updated_at=? WHERE id=?').run(JSON.stringify(clean),clean.revision,now(),id);
        await db.prepare('UPDATE resume_reparse_candidates SET applied_revision=?,updated_at=? WHERE task_id=?').run(clean.revision,now(),taskId);
        await reclaimImages(db,id,new Set([...prior,...draftImageIds(current)]));
        return {draft:clean,revision:clean.revision};
      });
    },
    async cancelCandidate(owner,id,taskId) {
      return await transaction(db,async ()=>{
        await owned(owner,id,true);
        const task=await db.prepare('SELECT * FROM resume_parse_tasks WHERE id=? AND resume_id=? AND owner_session_id=? AND candidate_id=?').get(taskId,id,owner,taskId);
        if(!task)throw resumeError(404,'CANDIDATE_NOT_FOUND');
        if(['QUEUED','RUNNING'].includes(task.status))await db.prepare('UPDATE resume_parse_tasks SET status=?,updated_at=? WHERE id=?')
          .run(task.status==='QUEUED'?'CANCELLED':'CANCELLING',now(),taskId);
        return {status:(await db.prepare('SELECT status FROM resume_parse_tasks WHERE id=?').get(taskId)).status};
      });
    },
    async status(owner, id) {
      return await transaction(db, async () => {
        const row = await owned(owner, id, true);
        await sweep(id);
        return await publicStatus(row);
      });
    },
    async draft(owner, id) {
      const row = await owned(owner, id);
      if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
      let session=await db.prepare('SELECT cache_scope FROM session_cache_scopes WHERE session_id=?').get(owner);
      if(!session){
        await db.prepare('INSERT INTO session_cache_scopes(session_id,cache_scope) VALUES(?,?) ON CONFLICT DO NOTHING').run(owner,randomUUID());
        session=await db.prepare('SELECT cache_scope FROM session_cache_scopes WHERE session_id=?').get(owner);
      }
      return {
        draft: normalizeResumeDraft(JSON.parse(row.draft_json)),
        expiresAt: iso((await liveFile(row.owner_session_id, row.file_id)).expires_at),
        revision: row.revision,
        cacheScope: session.cache_scope,
        ocrAvailable: JSON.parse((await liveFile(owner,row.file_id)).empty_pages_json??'null')?.length>0
      };
    },
    async versions(owner,id) {
      const row=await owned(owner,id);
      if(row.status!=='SUCCEEDED'||!row.draft_json) throw resumeError(409,'DRAFT_NOT_READY');
      return await listVersions(db,row);
    },
    async version(owner,id,revision) {
      const row=await owned(owner,id);
      if(row.status!=='SUCCEEDED'||!row.draft_json) throw resumeError(409,'DRAFT_NOT_READY');
      return {...await readVersion(db,row,revision),expiresAt:iso((await liveFile(owner,row.file_id)).expires_at)};
    },
    async restore(owner,id,input) {
      return await transaction(db,async ()=>{
        const row=await owned(owner,id,true);
        if(row.status!=='SUCCEEDED'||!row.draft_json) throw resumeError(409,'DRAFT_NOT_READY');
        const result=await restoreVersion(db,row,input,await sourceFor(row),now);
        await recordDeletedItems(db,id,normalizeResumeDraft(JSON.parse(row.draft_json)),result.draft);
        return result;
      });
    },
    // 原文对照摘录：仅暴露条目核对所需字段，bbox/字号等私有布局细节不下发
    async blocks(owner, id) {
      const row = await owned(owner, id);
      if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
      return {
        blocks: (await db.prepare('SELECT block_json FROM resume_blocks WHERE resume_id=? ORDER BY insertion_order').all(row.id))
          .map(b => JSON.parse(b.block_json))
          .map(({ blockId, page, readingOrder, text }) => ({ blockId, page, readingOrder, text }))
      };
    },
    // 条目补充图片：仅限属主在草稿就绪后上传，类型与大小在入库前收紧
    async saveImage(owner, id, contentType, bytes, itemId = null) {
      return await transaction(db, async () => {
      const row = await owned(owner, id, true);
      if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
      const type = String(contentType ?? '').split(';')[0].trim();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw resumeError(400, 'IMAGE_TYPE_INVALID');
      if (bytes.length > 5 * 1024 * 1024) throw resumeError(413, 'IMAGE_TOO_LARGE');
      try { validateImage(Buffer.from(bytes), type, 1); } catch { throw resumeError(400, 'IMAGE_TYPE_INVALID'); }
      if (itemId !== null && (typeof itemId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(itemId))) throw resumeError(400, 'INVALID_DRAFT');
      const totals=await db.prepare('SELECT count(*) n,COALESCE(sum(length(data)),0) size FROM resume_images WHERE resume_id=?').get(id);
      if(totals.n>=24 || totals.size+bytes.length>50*1024*1024) throw resumeError(413,'IMAGE_TOTAL_LIMIT');
      if(itemId && (await db.prepare('SELECT count(*) n FROM resume_images WHERE resume_id=? AND item_id=?').get(id,itemId)).n>=6) throw resumeError(413,'IMAGE_ITEM_LIMIT');
      const imageId = randomUUID();
      await db.prepare('INSERT INTO resume_images(id,resume_id,content_type,data,created_at,item_id) VALUES(?,?,?,?,?,?)').run(imageId, row.id, type, bytes, now(),itemId);
      return { imageId };
      });
    },
    async pendingImages(owner, id) {
      const row = await owned(owner, id);
      if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
      const draft = JSON.parse(row.draft_json);
      const referenced = new Set([...draftImageIds(draft),...await historyImageIds(db,id)]);
      return { images: (await db.prepare('SELECT id,item_id,content_type,length(data) size FROM resume_images WHERE resume_id=? ORDER BY created_at,insertion_order').all(id))
        .filter(image => !referenced.has(image.id))
        .map(image => ({ imageId: image.id, itemId: image.item_id, contentType: image.content_type, size: image.size })) };
    },
    async deleteImage(owner, id, imageId) {
      return await transaction(db,async ()=>{
        const row=await owned(owner,id,true),draft=JSON.parse(row.draft_json ?? '{}');
        if(draftImageIds(draft).has(imageId)||(await historyImageIds(db,id)).has(imageId)) throw resumeError(409,'IMAGE_STILL_REFERENCED');
        await db.prepare('DELETE FROM resume_images WHERE id=? AND resume_id=?').run(imageId,id);
        return {ok:true};
      });
    },
    async readImage(owner, id, imageId) {
      const row = await owned(owner, id);
      const image = await db.prepare('SELECT content_type,data FROM resume_images WHERE id=? AND resume_id=?').get(imageId, row.id);
      if (!image) throw resumeError(404, 'IMAGE_NOT_FOUND');
      return { contentType: image.content_type, bytes: image.data };
    },
    async patch(owner, id, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw resumeError(400, 'INVALID_DRAFT');
      const {
        revision,
        draft
      } = input;
      return await transaction(db, async () => {
        const row = await owned(owner, id, true);
        if (row.status !== 'SUCCEEDED' || !row.draft_json) throw resumeError(409, 'DRAFT_NOT_READY');
        if (revision !== row.revision || draft?.revision !== revision) throw resumeError(409, 'REVISION_CONFLICT');
        let clean;
        try {
          clean = draft?.version === 'resume-draft-v2'
            ? validateResumeDraftV2(draft, await sourceFor(row))
            : normalizeResumeDraft(validateResumeDraft(draft, await sourceFor(row)));
        } catch {
          throw resumeError(400, 'INVALID_DRAFT');
        }
        if (clean.resumeId !== id || clean.fileId !== row.file_id) throw resumeError(400, 'INVALID_DRAFT');
        // 补充图片必须真实存在且属于本简历，拒绝悬空引用
        const imageIds = [...new Set(clean.sections.flatMap(s => s.items.flatMap(i => i.supplements?.images.map(g => g.imageId) ?? [])))];
        if (imageIds.length) {
          const placeholders = imageIds.map(() => '?').join(',');
          const found = (await db.prepare(`SELECT COUNT(*) AS n FROM resume_images WHERE resume_id=? AND id IN (${placeholders})`).get(id, ...imageIds)).n;
          if (found !== imageIds.length) throw resumeError(400, 'INVALID_DRAFT');
        }
        const previous=JSON.parse(row.draft_json);
        const removed=new Set([...draftImageIds(previous)].filter(imageId=>!imageIds.includes(imageId)));
        const pruned=await snapshotPrevious(db,row,now);
        await recordDeletedItems(db,id,normalizeResumeDraft(previous),clean);
        clean.revision = revision + 1;
        await db.prepare('UPDATE resumes SET draft_json=?,revision=?,updated_at=? WHERE id=?').run(JSON.stringify(clean), clean.revision, now(), id);
        await reclaimImages(db,id,new Set([...removed,...pruned]));
        return {
          draft: clean,
          revision: clean.revision
        };
      });
    },
    async cancel(owner, id) {
      return await transaction(db, async () => {
        const row = await owned(owner, id, true);
        await sweep(id);
        const task = await latest(id);
        if (task && ['QUEUED', 'RUNNING'].includes(task.status)) {
          const status = task.status === 'QUEUED' ? 'CANCELLED' : 'CANCELLING';
          await db.prepare('UPDATE resume_parse_tasks SET status=?,updated_at=? WHERE id=?').run(status, now(), task.id);
          await state(id, status);
        }
        return {
          status: (await publicStatus(row)).status
        };
      });
    },
    async lease(workerId, { supportsPresentationHighlights = true } = {}) {
      if (typeof workerId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(workerId)) throw resumeError(400, 'INVALID_WORKER');
      return await transaction(db, async () => {
        await sweep();
        const row = await db.prepare(`SELECT t.* FROM resume_parse_tasks t JOIN resumes r ON r.id=t.resume_id JOIN resume_files f ON f.id=r.file_id
          WHERE t.status='QUEUED' AND t.next_attempt_at<=? AND f.expires_at>?
            AND (workflow_version IN ('resume-parse-v1','resume-parse-v2','resume-parse-v3')
              OR (? AND workflow_version IN ('resume-parse-v4','resume-parse-v5')))
          ORDER BY t.created_at,t.insertion_order LIMIT 1 FOR UPDATE OF r SKIP LOCKED`).get(now(), now(), supportsPresentationHighlights);
        if (!row) return null;
        const token = randomUUID();
        const workflowVersion = row.workflow_version === 'resume-parse-v1' ? 'resume-parse-v2' : row.workflow_version;
        const claimed = await db.prepare("UPDATE resume_parse_tasks SET status='RUNNING',workflow_version=?,stage='validate_source',error_code=NULL,lease_token=?,lease_until=?,worker_id=?,attempt_count=attempt_count+1,updated_at=? WHERE id=? AND status='QUEUED' AND next_attempt_at<=?").run(workflowVersion, token, now() + leaseMs, workerId, now(), row.id, now());
        if (!claimed.changes) return null;
        if(!row.candidate_id)await state(row.resume_id, 'RUNNING');
        const file = await liveFile(row.owner_session_id, row.file_id);
        return {
          id: row.id,
          leaseToken: token,
          workflowVersion,
          resumeId: row.resume_id,
          fileId: row.file_id,
          pageCount: file.page_count,
          uploadedAt: iso(file.uploaded_at),
          expiresAt: iso(file.expires_at),
          ocrPages: usesOcr(workflowVersion) ? JSON.parse(file.empty_pages_json ?? 'null') : []
        };
      });
    },
    async source(id, token) {
      const row = await requireLease(id, token);
      return await repository.readFile(row.owner_session_id, row.file_id);
    },
    async heartbeat(id, token, {
      stage,
      progress
    } = {}) {
      return await transaction(db, async () => {
        const row = await requireLease(id, token, true, true);
        if (stage !== undefined && !STAGES.includes(stage) || progress !== undefined && (!Number.isInteger(progress) || progress < 0 || progress > 99)) throw resumeError(400, 'INVALID_PROGRESS');
        await db.prepare('UPDATE resume_parse_tasks SET lease_until=?,stage=?,progress=?,updated_at=? WHERE id=?').run(now() + leaseMs, stage ?? row.stage, progress ?? row.progress, now(), id);
        return {
          ok: true,
          cancelRequested: row.status === 'CANCELLING'
        };
      });
    },
    async complete(id, token, source, draft) {
      return await transaction(db, async () => {
        const task = await requireLease(id, token, false, true),
          file = await liveFile(task.owner_session_id, task.file_id);
        let cleanSource, cleanDraft;
        try {
          cleanSource = validateResumeSource(source);
          cleanDraft = validateResumeDraft(draft, cleanSource);
        } catch {
          throw resumeError(400, 'INVALID_DRAFT');
        }
        const ocr = usesOcr(task.workflow_version);
        const ocrPages = ocr ? JSON.parse(file.empty_pages_json ?? 'null') : null;
        const ocrBlocks = cleanSource.version === 'resume-source-v2'
          ? cleanSource.blocks.filter(block => block.sourceType === 'ocr') : [];
        if (cleanSource.fileId !== file.id || cleanSource.pageCount !== file.page_count || cleanSource.uploadedAt !== iso(file.uploaded_at) || cleanSource.expiresAt !== iso(file.expires_at) || cleanDraft.resumeId !== task.resume_id || cleanDraft.revision !== 1
          || (ocr ? cleanSource.version !== 'resume-source-v2' || !ocrBlocks.length : cleanSource.version !== 'resume-source-v1')
          || (task.workflow_version === 'resume-parse-v5' && ocrPages
            && ocrBlocks.some(block => !ocrPages.includes(block.page)))) throw resumeError(400, 'INVALID_DRAFT');
        const covered = new Set(cleanDraft.sections.flatMap(s => s.items.flatMap(i => i.sourceBlockIds)));
        if (cleanSource.blocks.some(b => !covered.has(b.blockId))) throw resumeError(400, 'INVALID_DRAFT');
        const hidden = new Set(['phone', 'age', 'politicalStatus', 'politicalAffiliation', 'expectedSalary', 'salary']);
        if (cleanDraft.sections.some(s => s.items.some(i => i.included
          || i.facts.some(f => hidden.has(f.key) && f.included)
          || (i.presentationHighlights !== undefined && (!supportsHighlights(task.workflow_version)
            || !eligibleHighlightModule(s.kind) || i.presentationHighlights.some(highlight => highlight.selected
              || highlight.origin !== 'source' || !highlightIsValid(s.kind, highlight, true))))))) {
          throw resumeError(400, 'INVALID_DRAFT');
        }
        if(task.candidate_id){
          const candidate=await db.prepare('SELECT * FROM resume_reparse_candidates WHERE task_id=? AND resume_id=?').get(id,task.resume_id);
          const current=await owned(task.owner_session_id,task.resume_id);
          if(!candidate||current.revision!==candidate.base_revision){
            await db.prepare("UPDATE resume_parse_tasks SET status='FAILED',error_code='REVISION_CONFLICT',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now(),id);
            return {ok:true};
          }
          await db.prepare('UPDATE resume_reparse_candidates SET source_json=?,draft_json=?,updated_at=? WHERE task_id=?')
            .run(JSON.stringify(cleanSource),JSON.stringify(normalizeResumeDraft(cleanDraft)),now(),id);
          await db.prepare("UPDATE resume_parse_tasks SET status='SUCCEEDED',stage='complete_draft',progress=100,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now(),id);
          return {ok:true};
        }
        await db.prepare('DELETE FROM resume_blocks WHERE resume_id=?').run(task.resume_id);
        const insert = db.prepare('INSERT INTO resume_blocks(resume_id,block_id,block_json) VALUES(?,?,?)');
        for (const block of cleanSource.blocks) await insert.run(task.resume_id, block.blockId, JSON.stringify(block));
        await db.prepare("UPDATE resumes SET draft_json=?,revision=1,status='SUCCEEDED',updated_at=? WHERE id=?").run(JSON.stringify(normalizeResumeDraft(cleanDraft)), now(), task.resume_id);
        await db.prepare("UPDATE resume_parse_tasks SET status='SUCCEEDED',stage='complete_draft',progress=100,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now(), id);
        return {
          ok: true
        };
      });
    },
    async fail(id, token, code, retryable = false) {
      return await transaction(db, async () => {
        const row = await requireLease(id, token, false, true);
        const error = ERRORS.has(code) ? code : 'PARSE_FAILED';
        const retry = retryable === true && ['PARSE_TIMEOUT', 'PARSE_FAILED','OCR_TIMEOUT'].includes(error) && row.attempt_count < maxAttempts;
        const status = retry ? 'QUEUED' : 'FAILED';
        await db.prepare('UPDATE resume_parse_tasks SET status=?,error_code=?,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=?').run(status, error, now() + 1000 * 2 ** (row.attempt_count - 1), now(), id);
        if (retry) await db.prepare("UPDATE resume_parse_tasks SET stage='queued',progress=0 WHERE id=?").run(id);
        if(!row.candidate_id)await state(row.resume_id, status);
        return {
          ok: true
        };
      });
    },
    async ackCancel(id, token) {
      return await transaction(db, async () => {
        const row = await requireLease(id, token, true, true);
        if (row.status !== 'CANCELLING') throw resumeError(409, 'LEASE_LOST');
        await db.prepare("UPDATE resume_parse_tasks SET status='CANCELLED',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now(), id);
        if(!row.candidate_id)await state(row.resume_id, 'CANCELLED');
        return {
          ok: true
        };
      });
    }
  };
}
