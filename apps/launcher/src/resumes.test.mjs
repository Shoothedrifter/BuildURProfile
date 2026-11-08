import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, statSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../packages/storage/src/database.mjs';
import { createRequestHandler, dispatchWebRequest } from '../../web/src/server/http.mjs';

// Synthetic, deterministic PDF; no personal information.
export function pdf(pages = 1, text = true) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`];
  for(let i=0;i<pages;i++) { const stream = text ? 'BT /F1 12 Tf 20 100 Td (Synthetic fixture) Tj ET' : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 ${3+pages*2} 0 R >> >> /Contents ${4+i*2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let body='%PDF-1.7\n', offsets=[0]; for(const [i,o] of objects.entries()){offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${o}\nendobj\n`;}
  const start=Buffer.byteLength(body);body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(x=>`${String(x).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(body);
}
async function setup(t) {
 const root=mkdtempSync(join(tmpdir(),'resume-test-')),db=openDatabase(':memory:');let time=Date.now();
 t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
 const {createResumeRepository}=await import('../../../packages/storage/src/resumes/repository.mjs');
 const repo=createResumeRepository({db,root,now:()=>time});
 const handler=createRequestHandler({db,service:{},resumeRepository:repo,secret:Buffer.alloc(32,7)});
 const session=await dispatchWebRequest(new Request('http://test/api/session'),handler);
 const cookie=session.headers.get('set-cookie').split(';')[0],csrf=(await session.json()).csrfToken;
 const request=(path,method='GET',body,extra={})=>dispatchWebRequest(new Request('http://test/api/resumes/'+path,{method,headers:{cookie,'x-csrf-token':csrf,'content-type':'application/pdf','x-file-name':'fixture.pdf',...extra},...(body?{body}: {})}),handler);
 return {root,db,repo,request,handler,advance:()=>{time+=30*86400000;}};
}
test('upload retains one private PDF, source remains after parse, ownership and deletion enforced',async t=>{
 const s=await setup(t),r=await s.request('upload','POST',pdf());assert.equal(r.status,201);const file=await r.json();
 assert.equal(file.pageCount,1);assert.equal(readdirSync(s.root).length,1);assert.equal(statSync(s.root).mode&0o777,0o700);assert.equal(statSync(join(s.root,readdirSync(s.root)[0])).mode&0o777,0o600);
 const owner=s.db.prepare('SELECT owner_session_id FROM resume_files WHERE id=?').get(file.fileId).owner_session_id;
 s.db.prepare("INSERT INTO resumes(id,file_id,owner_session_id,status,draft_json,created_at,updated_at) VALUES('resume1',?,?,'SUCCEEDED','{}',0,0)").run(file.fileId,owner);
 assert.equal((await s.request('files/'+file.fileId,'DELETE')).status,409);
 const source=await s.request('resume1/source');assert.equal(source.status,200);assert.equal(source.headers.get('cache-control'),'no-store');assert.equal(source.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await source.arrayBuffer()),pdf());
 const other=await dispatchWebRequest(new Request('http://test/api/session'),s.handler);const stolen=await s.request('resume1/source','GET',null,{cookie:other.headers.get('set-cookie').split(';')[0]});assert.equal(stolen.status,404);
 const otherCsrf=(await other.json()).csrfToken;assert.equal((await s.request('resume1','DELETE',null,{cookie:other.headers.get('set-cookie').split(';')[0],'x-csrf-token':otherCsrf})).status,404);
 s.db.prepare("INSERT INTO resume_blocks(resume_id,block_id,block_json) VALUES('resume1','b1','{}')").run();
 assert.equal((await s.request('resume1','DELETE')).status,200);assert.equal((await s.request('resume1','DELETE')).status,200);assert.equal((await s.request('resume1/source')).status,404);assert.equal(readdirSync(s.root).length,0);assert.equal(s.db.prepare('SELECT count(*) AS count FROM resume_blocks').get().count,0);assert.equal(s.db.prepare('SELECT draft_json FROM resumes WHERE id=?').get('resume1'),undefined);
});
test('upload rejects invalid type, malformed, oversized, empty text and page limit without orphan files',async t=>{
 const s=await setup(t);
 for(const [data,headers,code] of [[pdf(),{'x-file-name':'x.txt'},'FILE_TYPE_INVALID'],[pdf(),{'content-type':'text/plain'},'FILE_TYPE_INVALID'],[Buffer.from('bad'),{},'FILE_TYPE_INVALID'],[Buffer.from('%PDF-invalid'),{},'FILE_TYPE_INVALID'],[Buffer.alloc(10000001),{},'FILE_TOO_LARGE'],[pdf(21),{},'PDF_PAGE_LIMIT'],[pdf(1,false),{},'PDF_NO_TEXT']]) {
  const r=await s.request('upload','POST',data,headers);assert.equal((await r.json()).errorCode,code);assert.equal(readdirSync(s.root).length,0);
 }
 for(const pages of [1,20])assert.equal((await s.request('upload','POST',pdf(pages))).status,201);
});
test('retention expires from upload and removes source and private drafts',async t=>{
 const s=await setup(t);const file=await(await s.request('upload','POST',pdf())).json();const row=s.db.prepare('SELECT * FROM resume_files WHERE id=?').get(file.fileId);assert.equal(row.expires_at-row.uploaded_at,30*86400000);
 s.db.prepare("INSERT INTO resumes(id,file_id,owner_session_id,status,draft_json,created_at,updated_at) VALUES('expired',?,?,'SUCCEEDED','{}',0,0)").run(file.fileId,row.owner_session_id);s.advance();assert.equal((await s.request('expired/source')).status,410);assert.equal(readdirSync(s.root).length,0);assert.equal(s.db.prepare('SELECT * FROM resumes').all().length,0);
});
test('Next bridge rejects declared oversized upload before reading body',async()=>{
 let read=false;const request={url:'http://test/api/resumes/upload',method:'POST',headers:new Headers({'content-length':'10000001'}),arrayBuffer(){read=true;throw Error('must not read');}};
 const response=await dispatchWebRequest(request,()=>{throw Error('must not dispatch');});assert.equal(response.status,413);assert.equal(read,false);
});

const encryptedPdf=Buffer.from("JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGFiNjNkODIxMTE+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMjAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8MGU1MjI5MjVhM2U0ZTg3NGMzY2ZhY2JlZjUxMWE3M2FjNGVjMmJkODY1ZGNkM2Q0NjI3NjE0OTE3YWJmZDdlND4KL1UgPDk1N2M0M2M2NTcyYmU3ZjM2ZTE2YWVmMzJiYTBlZGI4MjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDM1Mzk2MzMyMzA2MjYyNjE2NTYzMzgzMjY1MzE2MjM1NjMzNjMzNjM2MTYyNjU2NjM1NjE2NjYxNjU2NjMxMzE+IDwzNTM5NjMzMjMwNjI2MjYxNjU2MzM4MzI2NTMxNjIzNTYzMzYzMzYzNjE2MjY1NjYzNTYxNjY2MTY1NjYzMTMxPiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK","base64");
test('encrypted PDF rejected, exact byte limit accepted, database failure leaves no orphan',async t=>{
 const s=await setup(t);
 assert.equal((await(await s.request('upload','POST',encryptedPdf)).json()).errorCode,'PDF_ENCRYPTED');
 const padded=Buffer.concat([pdf(),Buffer.alloc(10000000-pdf().length,32)]);
 assert.equal((await s.request('upload','POST',padded)).status,201);
 s.db.exec("CREATE TRIGGER fail_resume_insert BEFORE INSERT ON resume_files BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 const before=readdirSync(s.root);assert.equal((await(await s.request('upload','POST',pdf())).json()).errorCode,'UPLOAD_FAILED');assert.deepEqual(readdirSync(s.root),before);
});
test('Next upload bridge counts a trailing-slash streamed body without Content-Length',async t=>{
 const s=await setup(t);const session=await dispatchWebRequest(new Request('http://test/api/session'),s.handler);const csrf=(await session.json()).csrfToken;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(6000000));c.enqueue(new Uint8Array(4000001));c.close();}});
 const request=new Request('http://test/api/resumes/upload/',{method:'POST',body:stream,duplex:'half',headers:{cookie:session.headers.get('set-cookie').split(';')[0],'x-csrf-token':csrf,'content-type':'application/pdf','x-file-name':'fixture.pdf'}});
 request.arrayBuffer=()=>{throw Error('unbounded read');};const response=await dispatchWebRequest(request,s.handler);assert.equal(response.status,413);assert.equal((await response.json()).errorCode,'FILE_TOO_LARGE');assert.equal(readdirSync(s.root).length,0);
});

test("empty-password encryption is still rejected as encrypted",async t=>{const s=await setup(t);const r=await s.request("upload","POST",Buffer.from("JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDBkN2NmNWYxMmU+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMjAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8MzY0NTFiZDM5ZDc1M2I3YzFkMTA5MjJjMjhlNjY2NWFhNGYzMzUzZmIwMzQ4YjUzNjg5M2UzYjFkYjVjNTc5Yj4KL1UgPGJkNTAwMjVlMzJjNWMwNTRhMmQ5YzgwMDM5ODA2NGI3MjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDM1Mzk2MzMyMzA2MjYyNjE2NTYzMzgzMjY1MzE2MjM1NjMzNjMzNjM2MTYyNjU2NjM1NjE2NjYxNjU2NjMxMzE+IDwzNTM5NjMzMjMwNjI2MjYxNjU2MzM4MzI2NTMxNjIzNTYzMzYzMzYzNjE2MjY1NjYzNTYxNjY2MTY1NjYzMTMxPiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK","base64"));assert.equal((await r.json()).errorCode,"PDF_ENCRYPTED");});

test('trailing slash uploads reject oversize before generic buffering',async()=>{
 let read=false;const request={url:'http://test/api/resumes/upload/',method:'POST',headers:new Headers({'content-length':'10000001'}),arrayBuffer(){read=true;throw Error('unbounded upload buffering');}};
 const response=await dispatchWebRequest(request,()=>{throw Error('must not dispatch');});assert.equal(response.status,413);assert.equal(read,false);
});
test('bounded cleanup reconciles stale crash PDF and temp orphans, preserving current and referenced files',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const orphan='11111111-1111-1111-1111-111111111111.pdf',temp='22222222-2222-2222-2222-222222222222.pdf.tmp',recent='33333333-3333-3333-3333-333333333333.pdf';
 for(const name of [orphan,temp,recent])writeFileSync(join(s.root,name),pdf());
 const stale=new Date(Date.now()-2*3600000);for(const name of [orphan,temp,file.fileId+'.pdf'])utimesSync(join(s.root,name),stale,stale);
 const before=readdirSync(s.root).length;s.repo.cleanup(1);assert.ok(before-readdirSync(s.root).length<=1);
 for(let i=0;i<12;i++)s.repo.cleanup(1);
 assert.deepEqual(readdirSync(s.root).sort(),[file.fileId+'.pdf',recent].sort());assert.equal(s.repo.readFile(s.db.prepare('SELECT owner_session_id FROM resume_files WHERE id=?').get(file.fileId).owner_session_id,file.fileId).length,pdf().length);
});
test('owner can cancel an upload before parse, with CSRF and ownership enforced',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const other=await dispatchWebRequest(new Request('http://test/api/session'),s.handler),csrf=(await other.json()).csrfToken;
 assert.equal((await s.request('files/'+file.fileId,'DELETE',null,{cookie:other.headers.get('set-cookie').split(';')[0],'x-csrf-token':csrf})).status,404);
 assert.equal((await s.request('files/'+file.fileId,'DELETE',null,{'x-csrf-token':'invalid'})).status,403);
 assert.equal((await s.request('files/'+file.fileId,'DELETE')).status,200);assert.equal((await s.request('files/'+file.fileId,'DELETE')).status,200);
 assert.equal(s.db.prepare('SELECT * FROM resume_files WHERE id=?').get(file.fileId),undefined);assert.equal(readdirSync(s.root).length,0);
});
