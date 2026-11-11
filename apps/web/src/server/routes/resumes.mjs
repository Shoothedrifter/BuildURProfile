import { PDF_MAX_BYTES, resumeError } from '../../../../../packages/storage/src/resumes/files.mjs';
export async function handleResumeRoutes({req,res,parts,sessionId,repository,sendJson,bodyJson}) {
 if(parts[1]!=='resumes')return false;
 repository.cleanup();
 const queue=repository.queue;
 if(parts.length===3&&parts[2]==='parse'&&req.method==='POST'){sendJson(res,202,queue.parse(sessionId,await bodyJson(req,4096)));return true;}
 if(parts.length===4&&parts[3]==='reparse'&&req.method==='POST'){
  const input=await bodyJson(req,4096);
  const clone=await repository.cloneForReparse(sessionId,parts[2]);
  let queued;
  try{queued=queue.parse(sessionId,{fileId:clone.fileId,idempotencyKey:input?.idempotencyKey});}
  catch(error){repository.deleteFile(sessionId,clone.fileId);throw error;}
  sendJson(res,202,queued);
  return true;
 }
 if(parts.length===4&&parts[3]==='status'&&req.method==='GET'){sendJson(res,200,queue.status(sessionId,parts[2]));return true;}
 if(parts.length===4&&parts[3]==='blocks'&&req.method==='GET'){sendJson(res,200,queue.blocks(sessionId,parts[2]));return true;}
 if(parts.length===4&&parts[3]==='cancel'&&req.method==='POST'){sendJson(res,200,queue.cancel(sessionId,parts[2]));return true;}
 if(parts.length===3&&req.method==='GET'){sendJson(res,200,queue.draft(sessionId,parts[2]));return true;}
 if(parts.length===3&&req.method==='PATCH'){sendJson(res,200,queue.patch(sessionId,parts[2],await bodyJson(req,16*1024*1024)));return true;}

 if(parts.length===3&&parts[2]==='upload'&&req.method==='POST'){
  if(req.headers['content-length']&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>PDF_MAX_BYTES))throw resumeError(413,'FILE_TOO_LARGE');
  const chunks=[];let total=0;
  for await(const chunk of req){total+=chunk.length;if(total>PDF_MAX_BYTES)throw resumeError(413,'FILE_TOO_LARGE');chunks.push(chunk);}
  let name;try{name=decodeURIComponent(req.headers['x-file-name']??'');}catch{throw resumeError(400,'FILE_TYPE_INVALID');}
  sendJson(res,201,await repository.upload(sessionId,Buffer.concat(chunks,total),name,req.headers['content-type']));return true;
 }
 if(parts.length===4&&parts[2]==='files'&&req.method==='DELETE'){sendJson(res,200,repository.deleteFile(sessionId,parts[3]));return true;}
 if(parts.length===4&&parts[3]==='source'&&req.method==='GET'){
  const bytes=repository.readSource(sessionId,parts[2]);res.writeHead(200,{'content-type':'application/pdf','content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(bytes);return true;
 }
 // 条目补充图片：上传走流式读取并预检体积，读取响应头与 /source 对齐
 if(parts.length===4&&parts[3]==='images'&&req.method==='GET'){sendJson(res,200,queue.pendingImages(sessionId,parts[2]));return true;}
 if(parts.length===4&&parts[3]==='images'&&req.method==='POST'){
  if(req.headers['content-length']&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>5*1024*1024))throw resumeError(413,'IMAGE_TOO_LARGE');
  const chunks=[];let total=0;
  for await(const chunk of req){total+=chunk.length;if(total>5*1024*1024)throw resumeError(413,'IMAGE_TOO_LARGE');chunks.push(chunk);}
  sendJson(res,201,queue.saveImage(sessionId,parts[2],req.headers['content-type'],Buffer.concat(chunks,total),req.headers['x-resume-item'] ?? null));return true;
 }
 if(parts.length===5&&parts[3]==='images'&&req.method==='DELETE'){sendJson(res,200,queue.deleteImage(sessionId,parts[2],parts[4]));return true;}
 if(parts.length===5&&parts[3]==='images'&&req.method==='GET'){
  const image=queue.readImage(sessionId,parts[2],parts[4]);
  res.writeHead(200,{'content-type':image.contentType,'content-length':image.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(image.bytes);return true;
 }
 if(parts.length===3&&req.method==='DELETE'){sendJson(res,200,repository.delete(sessionId,parts[2]));return true;}
 return false;
}
