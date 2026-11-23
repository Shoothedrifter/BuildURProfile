import { createResumeMediaStore } from './generation/resume-media.mjs';
import { normalizeResumeDraft, projectConfirmedResumeV3 } from '../../contracts/src/resume-draft.ts';
import { ServiceError } from '../../contracts/src/validation.mjs';
import { transaction } from './database.mjs';
import { createAssetStore } from "./generation/assets.mjs";
import { createGenerationQueue } from "./generation/queue.mjs";

export { cleanGenerationBrief } from "./generation/brief.mjs";

/** API/worker storage facade. Payment and graph modules depend on this port, not on each other. */
export function createGenerationService({ db, assetRoot = "data/avatar-assets", minPixels = 256, now = () => Date.now(),
  leaseMs = 90_000, maxAttempts = 3, retryBaseMs = 5_000, allowPortraits = true, requireBrief = false }) {
  const assets = createAssetStore({ db, assetRoot, minPixels, now, allowPortraits });
  const media = createResumeMediaStore({db,now});
  const queue = createGenerationQueue({ db, assets, minPixels, now, leaseMs, maxAttempts, retryBaseMs,
    allowPortraits, requireBrief });
  return {
    savePortrait: assets.savePortrait,
    readAsset: assets.readAsset,
    readArtworkAsset: assets.readArtworkAsset,
    readAssetForWorker: assets.readAssetForWorker,
    outputExists: assets.outputExists,
    purgeExpired: assets.purgeExpired,
    ...queue,
    readShowcaseMedia: media.read,
    cleanupResumeMedia: media.cleanup,
    async enqueueResume(owner, input) {
      const allowed=['resumeId','revision','role','answers','templateId','idempotencyKey','portraitAssetId','styleId'];
      if (!input || Object.keys(input).some(k=>!allowed.includes(k)) || typeof input.resumeId!=='string' || !Number.isInteger(input.revision) || typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(input.idempotencyKey)) throw new ServiceError(400,'简历生成请求无效。');
      if (input.templateId !== undefined && input.answers !== undefined) throw new ServiceError(400,'模板生成不需要测评答案。');
      if (input.templateId === 'pixel-world-v1' && (input.portraitAssetId || input.styleId)) {
        throw new ServiceError(400,'请先生成基础作品，再添加个人像素头像。');
      }
      const request=JSON.stringify({resumeId:input.resumeId,revision:input.revision,role:input.role,
        ...(input.templateId === undefined ? {answers:input.answers && Object.fromEntries(Object.entries(input.answers).sort(([a],[b])=>a.localeCompare(b)))} : {templateId:input.templateId}),
        portraitAssetId:input.portraitAssetId ?? null,styleId:input.styleId ?? null});
      return await transaction(db,async ()=>{
        await db.prepare('SELECT id FROM sessions WHERE id=? FOR UPDATE').get(owner);
        const existing=await db.prepare('SELECT * FROM generations WHERE owner_session_id=? AND idempotency_key=?').get(owner,input.idempotencyKey);
        if(existing){ if(existing.resume_request_json!==request) throw new ServiceError(409,'生成请求标识已用于其他内容。'); return await queue.getTask(owner,existing.id); }
        const row=await db.prepare('SELECT r.*,f.expires_at FROM resumes r JOIN resume_files f ON f.id=r.file_id WHERE r.id=? AND r.owner_session_id=? FOR SHARE OF r').get(input.resumeId,owner);
        if(!row || row.expires_at<=now()) throw new ServiceError(404,'简历不存在或已过期。');
        if(row.status!=='SUCCEEDED' || row.revision!==input.revision) throw new ServiceError(409,'草稿版本已更新，请重新核对并保存。');
        let content; try {content=projectConfirmedResumeV3(normalizeResumeDraft(JSON.parse(row.draft_json)));} catch(error){throw new ServiceError(400,error.message);}
        const task=await queue.enqueue(owner,{idempotencyKey:input.idempotencyKey,portraitAssetId:input.portraitAssetId,styleId:input.styleId,
          brief:{role:input.role,...(input.templateId === undefined ? {answers:input.answers} : {templateId:input.templateId}),content}});
        await media.materialize(owner,row.id,task.id,{content});
        await db.prepare('UPDATE generations SET resume_request_json=? WHERE id=?').run(request,task.id);
        return task;
      });
    }
  };
}
