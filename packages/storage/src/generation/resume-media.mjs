import { transaction } from '../database.mjs';
import { validateImage } from './assets.mjs';
import { ServiceError } from '../../../contracts/src/validation.mjs';
import { resumeImageIds } from '../../../contracts/src/resume-v2.mjs';
const RETENTION = 30 * 86400000;
/** Methods participate in their caller's transaction. Images are immutable. */
export function createResumeMediaStore({ db, now = Date.now }) {
  let projectCursor = "";
  const missing = () => { throw new ServiceError(404, '作品图片不存在或无权访问。'); };
  function read(owner, id) {
    const row = db.prepare(`SELECT m.* FROM showcase_media m WHERE m.id=? AND m.owner_session_id=? AND (
      EXISTS(SELECT 1 FROM project_media r JOIN projects p ON p.id=r.project_id WHERE r.media_id=m.id AND p.deleted_at IS NULL)
      OR EXISTS(SELECT 1 FROM generation_media r JOIN generations g ON g.id=r.generation_id WHERE r.media_id=m.id AND g.project_id IS NULL AND (g.created_at>? OR g.status='RUNNING' AND g.lease_until>?)))`).get(id,owner,now()-RETENTION,now());
    if (!row) missing();
    return {bytes:Buffer.from(row.data),mime:row.content_type};
  }
  function materialize(owner, resumeId, generationId, config) {
    const ids=resumeImageIds(config); let total=0;
    for(const id of ids){
      const row=db.prepare('SELECT i.* FROM resume_images i JOIN resumes r ON r.id=i.resume_id WHERE i.id=? AND r.id=? AND r.owner_session_id=?').get(id,resumeId,owner);
      if(!row) missing();
      validateImage(Buffer.from(row.data),row.content_type,1);
      if(row.data.length>5*1024*1024) throw new ServiceError(413,"图片超过 5 MiB。");
      total+=row.data.length;
      if(total>50*1024*1024 || ids.length>24) throw new ServiceError(413,'图片总量超过 24 张或 50 MiB。');
      db.prepare('INSERT OR IGNORE INTO showcase_media(id,owner_session_id,content_type,data,created_at) VALUES(?,?,?,?,?)').run(id,owner,row.content_type,row.data,now());
      db.prepare('INSERT OR IGNORE INTO generation_media VALUES(?,?)').run(generationId,id);
    }
  }
  function attachProject(owner, projectId, config) {
    for(const id of resumeImageIds(config)){
      read(owner,id);
      db.prepare('INSERT OR IGNORE INTO project_media VALUES(?,?)').run(projectId,id);
    }
    // Keep earlier images for live share snapshots. GC may remove them after revocation/expiry.
  }
  function readShare(token,id) {
    const share=db.prepare(`SELECT s.config_json,p.owner_session_id FROM shares s JOIN projects p ON p.id=s.project_id JOIN entitlements e ON e.project_id=p.id
      WHERE s.token=? AND s.revoked_at IS NULL AND s.expires_at>? AND p.deleted_at IS NULL AND e.status='ACTIVE'`).get(token,now());
    if(!share || !resumeImageIds(JSON.parse(share.config_json)).includes(id)) missing();
    return read(share.owner_session_id,id);
  }
  function pruneProject(projectId) {
    const project=db.prepare('SELECT config_json,deleted_at FROM projects WHERE id=?').get(projectId);
    const keep=new Set(project && project.deleted_at==null ? resumeImageIds(JSON.parse(project.config_json)) : []);
    if(project?.deleted_at==null) for(const share of db.prepare('SELECT config_json FROM shares WHERE project_id=? AND revoked_at IS NULL AND expires_at>?').all(projectId,now())) for(const id of resumeImageIds(JSON.parse(share.config_json))) keep.add(id);
    for(const ref of db.prepare('SELECT media_id FROM project_media WHERE project_id=?').all(projectId)){
      if(keep.has(ref.media_id)) continue;
      db.prepare('DELETE FROM project_media WHERE project_id=? AND media_id=?').run(projectId,ref.media_id);
      db.prepare(`DELETE FROM showcase_media WHERE id=? AND NOT EXISTS(SELECT 1 FROM project_media WHERE media_id=showcase_media.id)
        AND NOT EXISTS(SELECT 1 FROM generation_media r JOIN generations g ON g.id=r.generation_id WHERE r.media_id=showcase_media.id AND (g.status IN ('QUEUED','RUNNING') OR g.project_id IS NULL AND g.created_at>?))`).run(ref.media_id,now()-RETENTION);
    }
  }
  function cleanup() {
    // An abandoned queue cannot pin an upload forever. A currently valid worker lease is fenced.
    db.prepare(`UPDATE generations SET status='FAILED',error='生成任务保留期已过，请重新生成。',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id IN (SELECT id FROM generations WHERE project_id IS NULL AND created_at<=? AND status IN ('QUEUED','RUNNING') AND (lease_until IS NULL OR lease_until<=?) LIMIT 100)`).run(now(),now()-RETENTION,now());
    // Rotate through project refs so expired snapshots release superseded images in bounded batches.
    const projects=db.prepare('SELECT DISTINCT project_id FROM project_media WHERE project_id>? ORDER BY project_id LIMIT 100').all(projectCursor);
    for(const project of projects) transaction(db,()=>pruneProject(project.project_id));
    projectCursor=projects.length ? projects.at(-1).project_id : '';
    // Bounded orphan collection; projects and valid active tasks protect independent copies.
    db.prepare(`DELETE FROM showcase_media WHERE id IN (SELECT m.id FROM showcase_media m WHERE m.created_at<=?
      AND NOT EXISTS(SELECT 1 FROM project_media r JOIN projects p ON p.id=r.project_id WHERE r.media_id=m.id AND p.deleted_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM generation_media r JOIN generations g ON g.id=r.generation_id WHERE r.media_id=m.id AND g.status IN ('QUEUED','RUNNING')) LIMIT 100)`).run(now()-RETENTION);
  }
  return {read,materialize,attachProject,readShare,cleanup,pruneProject};
}
