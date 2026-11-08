import { mkdirSync, chmodSync, writeFileSync, renameSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export const PDF_MAX_BYTES = 10_000_000;
export function resumeError(status, errorCode) { return Object.assign(new Error(errorCode), {status,errorCode}); }
export async function validatePdf(bytes) {
 if(bytes.length>PDF_MAX_BYTES)throw resumeError(413,'FILE_TOO_LARGE');
 if(bytes.subarray(0,5).toString()!=='%PDF-')throw resumeError(400,'FILE_TYPE_INVALID');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 // Explicit import lets Next bundle the Node fake worker without a relative runtime URL.
 globalThis.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true,verbosity:0});
 let doc;
 try {
  doc=await task.promise;
  if(doc.numPages<1||doc.numPages>20)throw resumeError(400,'PDF_PAGE_LIMIT');
  // Encrypted PDFs remain disallowed even when an empty password opens them.
  if(await doc.getPermissions() !== null)throw resumeError(400,'PDF_ENCRYPTED');
  let hasText=false;
  for(let n=1;n<=doc.numPages;n++) {const page=await doc.getPage(n);const text=await page.getTextContent();if(text.items.some(item=>item.str?.trim()))hasText=true;page.cleanup();}
  if(!hasText)throw resumeError(400,'PDF_NO_TEXT');
  return doc.numPages;
 }catch(error){if(error.errorCode)throw error;throw resumeError(400,error.name==='PasswordException'?'PDF_ENCRYPTED':'FILE_TYPE_INVALID');}
 finally{await task.destroy();}
}
export function createResumeFileStore(root) {
 mkdirSync(root,{recursive:true,mode:0o700});chmodSync(root,0o700);
 const path=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid file ID');return join(root,`${id}.pdf`);};
 return {write(id,bytes){const target=path(id),temp=target+'.tmp';try{writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});renameSync(temp,target);}catch(error){rmSync(temp,{force:true});throw error;}},read:id=>readFileSync(path(id)),remove:id=>rmSync(path(id),{force:true})};
}
