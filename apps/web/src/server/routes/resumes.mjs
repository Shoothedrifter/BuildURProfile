import { PDF_MAX_BYTES, resumeError } from '../../../../../packages/storage/src/resumes/files.mjs';
export async function handleResumeRoutes({req,res,parts,sessionId,repository,sendJson}) {
 if(parts[1]!=='resumes')return false;
 repository.cleanup();
 if(parts.length===3&&parts[2]==='upload'&&req.method==='POST'){
  if(req.headers['content-length']&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>PDF_MAX_BYTES))throw resumeError(413,'FILE_TOO_LARGE');
  const chunks=[];let total=0;
  for await(const chunk of req){total+=chunk.length;if(total>PDF_MAX_BYTES)throw resumeError(413,'FILE_TOO_LARGE');chunks.push(chunk);}
  let name;try{name=decodeURIComponent(req.headers['x-file-name']??'');}catch{throw resumeError(400,'FILE_TYPE_INVALID');}
  sendJson(res,201,await repository.upload(sessionId,Buffer.concat(chunks,total),name,req.headers['content-type']));return true;
 }
 if(parts.length===4&&parts[3]==='source'&&req.method==='GET'){
  const bytes=repository.readSource(sessionId,parts[2]);res.writeHead(200,{'content-type':'application/pdf','content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(bytes);return true;
 }
 if(parts.length===3&&req.method==='DELETE'){sendJson(res,200,repository.delete(sessionId,parts[2]));return true;}
 return false;
}
