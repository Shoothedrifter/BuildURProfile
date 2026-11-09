import { createResumeParseQueue } from './queue.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from '../database.mjs';
import { createResumeFileStore, validatePdf, resumeError } from './files.mjs';
export function createResumeRepository({db,root,now=Date.now}) {
 const store=createResumeFileStore(root);
 function purge(row,reason) {
  // Remove disk bytes before committing metadata deletion, so a failed unlink can retry.
  store.remove(row.id);
  transaction(db,()=>{
   db.prepare("INSERT OR REPLACE INTO resume_tombstones(resume_id,file_id,owner_session_id,reason) SELECT 'file:' || id,id,owner_session_id,? FROM resume_files WHERE id=?").run(reason,row.id);
   db.prepare('INSERT OR REPLACE INTO resume_tombstones(resume_id,file_id,owner_session_id,reason) SELECT id,file_id,owner_session_id,? FROM resumes WHERE file_id=?').run(reason,row.id);
   db.prepare('DELETE FROM resume_files WHERE id=?').run(row.id);
  });
 }
 function cleanup(limit=25){for(const row of db.prepare('SELECT id FROM resume_files WHERE expires_at<=? ORDER BY expires_at LIMIT ?').all(now(),limit))purge(row,'expired');store.reconcile(id=>Boolean(db.prepare('SELECT 1 FROM resume_files WHERE id=?').get(id)),now(),limit);}
 function getFile(owner,id){const row=db.prepare('SELECT * FROM resume_files WHERE id=? AND owner_session_id=?').get(id,owner);if(!row)throw resumeError(404,'RESUME_NOT_FOUND');if(row.expires_at<=now()){purge(row,'expired');throw resumeError(410,'RESUME_EXPIRED');}return row;}
 function getResume(owner,id){const row=db.prepare('SELECT file_id FROM resumes WHERE id=? AND owner_session_id=?').get(id,owner);if(!row){const tomb=db.prepare('SELECT reason FROM resume_tombstones WHERE resume_id=? AND owner_session_id=?').get(id,owner);throw resumeError(tomb?.reason==='expired'?410:404,tomb?.reason==='expired'?'RESUME_EXPIRED':'RESUME_NOT_FOUND');}return getFile(owner,row.file_id);}
 const repository = {cleanup,getFile,
 deleteFile(owner,id){
  if(db.prepare('SELECT 1 FROM resume_tombstones WHERE resume_id=? AND owner_session_id=?').get('file:'+id,owner))return {ok:true};
  const row=getFile(owner,id);
  if(db.prepare('SELECT 1 FROM resumes WHERE file_id=?').get(id))throw resumeError(409,'RESUME_ALREADY_PARSED');
  purge(row,'deleted');return {ok:true};
 },
 async upload(owner,bytes,fileName,mime){
  if(typeof fileName!=='string'||fileName.length>200||/[\x00-\x1f\x7f/\\]/.test(fileName)||!fileName.toLowerCase().endsWith('.pdf')||mime?.split(';')[0].trim().toLowerCase()!=='application/pdf')throw resumeError(400,'FILE_TYPE_INVALID');
  const pageCount=await validatePdf(bytes),id=randomUUID(),uploadedAt=Math.floor(now()/1000)*1000;
  try{store.write(id,bytes);db.prepare('INSERT INTO resume_files(id,owner_session_id,file_name,size,page_count,uploaded_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,fileName,bytes.length,pageCount,uploadedAt,uploadedAt+30*86400000);}catch{store.remove(id);throw resumeError(500,'UPLOAD_FAILED');}
  return {fileId:id,fileName,size:bytes.length,pageCount};
 },async cloneForReparse(owner,resumeId){
  const original=getResume(owner,resumeId);
  return repository.upload(owner,store.read(original.id),original.file_name,'application/pdf');
 },readFile(owner,id){getFile(owner,id);return store.read(id);},
 readSource(owner,id){const row=getResume(owner,id);return store.read(row.id);},
 delete(owner,id){const tomb=db.prepare('SELECT 1 FROM resume_tombstones WHERE resume_id=? AND owner_session_id=?').get(id,owner);if(tomb)return {ok:true};const row=getResume(owner,id);purge(row,'deleted');return {ok:true};}
 };
 repository.queue=createResumeParseQueue({db,repository,now});
 return repository;
}
