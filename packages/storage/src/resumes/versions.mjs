import { normalizeResumeDraft, validateResumeDraftV2 } from '../../../contracts/src/resume-draft.ts';
import { resumeError } from './files.mjs';

export const MAX_PREVIOUS_VERSIONS = 10;

export function draftImageIds(draft) {
  return new Set((draft?.sections ?? []).flatMap(section => section.items.flatMap(item =>
    (item.supplements?.images ?? []).map(image => image.imageId))));
}

export function historyImageIds(db, resumeId) {
  const ids = new Set();
  for (const row of db.prepare('SELECT draft_json FROM resume_versions WHERE resume_id=?').all(resumeId)) {
    for (const id of draftImageIds(JSON.parse(row.draft_json))) ids.add(id);
  }
  return ids;
}

export function snapshotPrevious(db, row, now) {
  db.prepare('INSERT INTO resume_versions(resume_id,revision,draft_json,created_at) VALUES(?,?,?,?)')
    .run(row.id,row.revision,row.draft_json,now());
  const obsolete = db.prepare('SELECT revision,draft_json FROM resume_versions WHERE resume_id=? ORDER BY revision DESC LIMIT -1 OFFSET ?')
    .all(row.id,MAX_PREVIOUS_VERSIONS);
  for(const version of obsolete) db.prepare('DELETE FROM resume_versions WHERE resume_id=? AND revision=?').run(row.id,version.revision);
  return new Set(obsolete.flatMap(version=>[...draftImageIds(JSON.parse(version.draft_json))]));
}

export function reclaimImages(db, resumeId, candidateIds) {
  if(!candidateIds.size) return;
  const current = db.prepare('SELECT draft_json FROM resumes WHERE id=?').get(resumeId);
  const retained = new Set([...draftImageIds(JSON.parse(current?.draft_json ?? '{}')),...historyImageIds(db,resumeId)]);
  for(const imageId of candidateIds) if(!retained.has(imageId))
    db.prepare('DELETE FROM resume_images WHERE resume_id=? AND id=?').run(resumeId,imageId);
}

export function listVersions(db, row) {
  return {versions:[{revision:row.revision,createdAt:row.updated_at},
    ...db.prepare('SELECT revision,created_at createdAt FROM resume_versions WHERE resume_id=? ORDER BY revision DESC')
      .all(row.id)]};
}

export function readVersion(db, row, revision) {
  if(!Number.isInteger(revision) || revision < 1) throw resumeError(400,'INVALID_REVISION');
  const stored = revision === row.revision ? row.draft_json
    : db.prepare('SELECT draft_json FROM resume_versions WHERE resume_id=? AND revision=?').get(row.id,revision)?.draft_json;
  if(!stored) throw resumeError(404,'VERSION_NOT_FOUND');
  return {draft:normalizeResumeDraft(JSON.parse(stored)),revision};
}

export function restoreVersion(db, row, input, source, now) {
  if(!input || !Number.isInteger(input.expectedRevision) || !Number.isInteger(input.targetRevision))
    throw resumeError(400,'INVALID_REVISION');
  if(input.expectedRevision !== row.revision) throw resumeError(409,'REVISION_CONFLICT');
  const selected = readVersion(db,row,input.targetRevision);
  if(selected.revision === row.revision) throw resumeError(400,'INVALID_REVISION');
  const draft = selected.draft;
  draft.revision = row.revision + 1;
  try { validateResumeDraftV2(draft,source); } catch { throw resumeError(400,'INVALID_DRAFT'); }
  const ids=[...draftImageIds(draft)];
  if(ids.length){
    const placeholders=ids.map(()=>'?').join(',');
    const found=db.prepare(`SELECT COUNT(*) n FROM resume_images WHERE resume_id=? AND id IN (${placeholders})`).get(row.id,...ids).n;
    if(found!==ids.length) throw resumeError(409,'HISTORY_IMAGE_MISSING');
  }
  const removed=snapshotPrevious(db,row,now);
  db.prepare('UPDATE resumes SET draft_json=?,revision=?,updated_at=? WHERE id=?')
    .run(JSON.stringify(draft),draft.revision,now(),row.id);
  reclaimImages(db,row.id,removed);
  return {draft,revision:draft.revision};
}
