import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, statSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../packages/storage/src/database.mjs';
import { createRequestHandler, dispatchWebRequest } from '../../web/src/server/http.mjs';

import { pdf } from './test-fixtures/resume-pdf.mjs';
import { mergeEmptyDraft, overwriteDraft } from '../../../packages/storage/src/resumes/candidates.mjs';
async function setup(t) {
 const root=mkdtempSync(join(tmpdir(),'resume-test-')),db=openDatabase(':memory:');let time=Date.now();
 t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
 const {createResumeRepository}=await import('../../../packages/storage/src/resumes/repository.mjs');
 const repo=createResumeRepository({db,root,now:()=>time});
 const handler=createRequestHandler({db,service:{},resumeRepository:repo,secret:Buffer.alloc(32,7)});
 const session=await dispatchWebRequest(new Request('http://test/api/session'),handler);
 const cookie=session.headers.get('set-cookie').split(';')[0],csrf=(await session.json()).csrfToken;
 const request=(path,method='GET',body,extra={})=>dispatchWebRequest(new Request('http://test/api/resumes/'+path,{method,headers:{cookie,'x-csrf-token':csrf,'content-type':'application/pdf','x-file-name':'fixture.pdf',...extra},...(body?{body}: {})}),handler);
 return {root,db,repo,request,handler,advance:(ms=30*86400000)=>{time+=ms;}};
}
async function readyResume(t) {
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const parsed=await(await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'history'}))).json();
 const task=s.repo.queue.lease('worker');
 const metadata=s.db.prepare('SELECT * FROM resume_files WHERE id=?').get(file.fileId);
 const source=JSON.parse(readFileSync('packages/contracts/fixtures/resume-source.v1.json','utf8'));
 Object.assign(source,{fileId:file.fileId,uploadedAt:new Date(metadata.uploaded_at).toISOString().replace('.000Z','Z'),expiresAt:new Date(metadata.expires_at).toISOString().replace('.000Z','Z')});
 const draft=JSON.parse(readFileSync('packages/contracts/fixtures/resume-draft.v1.json','utf8'));
 Object.assign(draft,{fileId:file.fileId,resumeId:parsed.resumeId,revision:1});
 for(const section of draft.sections)for(const item of section.items)item.included=false;
 s.repo.queue.complete(task.id,task.leaseToken,source,draft);
 return {...s,resumeId:parsed.resumeId};
}

test('resume history is bounded, owner-only and restoring creates a new revision',async t=>{
 const s=await readyResume(t),first=await(await s.request(s.resumeId)).json();
 assert.match(first.cacheScope,/^[0-9a-f-]{36}$/);
 assert.equal((await(await s.request(s.resumeId)).json()).cacheScope,first.cacheScope);
 let draft=first.draft;
 for(let index=0;index<12;index++){
  draft.sections[0].items[0].title=`编辑 ${index}`;
  draft=(await(await s.request(s.resumeId,'PATCH',JSON.stringify({revision:draft.revision,draft}))).json()).draft;
 }
 const versions=await(await s.request(s.resumeId+'/versions')).json();
 assert.equal(versions.versions.length,11);
 assert.deepEqual(versions.versions.map(v=>v.revision),[13,12,11,10,9,8,7,6,5,4,3]);
 assert.equal((await s.request(s.resumeId+'/versions/2')).status,404);
 const snapshot=await(await s.request(s.resumeId+'/versions/3')).json();
 assert.equal(snapshot.draft.sections[0].items[0].title,'编辑 1');
 const restored=await s.request(s.resumeId+'/restore','POST',JSON.stringify({expectedRevision:13,targetRevision:3}),{'content-type':'application/json'});
 assert.equal(restored.status,200);
 const body=await restored.json();assert.equal(body.revision,14);assert.equal(body.draft.sections[0].items[0].title,'编辑 1');
 assert.equal((await s.request(s.resumeId+'/restore','POST',JSON.stringify({expectedRevision:13,targetRevision:3}),{'content-type':'application/json'})).status,409);
 const other=await dispatchWebRequest(new Request('http://test/api/session'),s.handler);
 const foreign={cookie:other.headers.get('set-cookie').split(';')[0],'x-csrf-token':(await other.json()).csrfToken};
 assert.equal((await s.request(s.resumeId+'/versions','GET',null,foreign)).status,404);
 assert.equal((await s.request(s.resumeId+'/restore','POST',JSON.stringify({expectedRevision:14,targetRevision:3}),{'content-type':'application/json',...foreign})).status,404);
 await s.request(s.resumeId,'DELETE');
 assert.equal(s.db.prepare('SELECT count(*) n FROM resume_versions').get().n,0);
});

test('history keeps referenced images until old revisions are trimmed',async t=>{
 const s=await readyResume(t),upload=await s.request(s.resumeId+'/images','POST',png1x1,{'content-type':'image/png'});
 const {imageId}=await upload.json();let draft=(await(await s.request(s.resumeId)).json()).draft;
 draft.sections[0].items[0].supplements={text:'',links:[],images:[{imageId,caption:'历史图片'}]};
 draft=(await(await s.request(s.resumeId,'PATCH',JSON.stringify({revision:1,draft}))).json()).draft;
 draft.sections[0].items[0].supplements.images=[];
 draft=(await(await s.request(s.resumeId,'PATCH',JSON.stringify({revision:2,draft}))).json()).draft;
 assert.equal((await s.request(s.resumeId+'/images/'+imageId)).status,200);
 assert.equal((await s.request(s.resumeId+'/images/'+imageId,'DELETE')).status,409);
 assert.equal((await(await s.request(s.resumeId+'/images')).json()).images.some(image=>image.imageId===imageId),false);
 for(let index=0;index<10;index++){
  draft.sections[0].items[0].title=`裁剪 ${index}`;
  draft=(await(await s.request(s.resumeId,'PATCH',JSON.stringify({revision:draft.revision,draft}))).json()).draft;
 }
 assert.equal((await s.request(s.resumeId+'/images/'+imageId)).status,404);
});

test('reparse candidate keeps current draft live and applies only after revision review',async t=>{
 const s=await readyResume(t),before=await(await s.request(s.resumeId)).json();
 const start=()=>s.request(s.resumeId+'/reparse-candidates','POST',JSON.stringify({expectedRevision:1,mode:'overwrite',idempotencyKey:'candidate-one'}),{'content-type':'application/json'});
 const created=await start();assert.equal(created.status,202);const candidate=await created.json();
 assert.equal((await(await start()).json()).taskId,candidate.taskId);
 assert.equal((await(await s.request(s.resumeId+'/status')).json()).status,'SUCCEEDED');
 const task=s.repo.queue.lease('candidate-worker');assert.equal(task.id,candidate.taskId);
 const source=JSON.parse(readFileSync('packages/contracts/fixtures/resume-source.v1.json','utf8'));
 const metadata=s.db.prepare('SELECT * FROM resume_files WHERE id=?').get(before.draft.fileId);
 Object.assign(source,{fileId:before.draft.fileId,uploadedAt:new Date(metadata.uploaded_at).toISOString().replace('.000Z','Z'),expiresAt:new Date(metadata.expires_at).toISOString().replace('.000Z','Z')});
 const draft=JSON.parse(readFileSync('packages/contracts/fixtures/resume-draft.v1.json','utf8'));
 Object.assign(draft,{fileId:before.draft.fileId,resumeId:s.resumeId,revision:1});
 for(const section of draft.sections)for(const item of section.items)item.included=false;
 draft.sections[0].items[0].title='新解析标题';
 s.repo.queue.complete(task.id,task.leaseToken,source,draft);
 assert.equal((await(await s.request(s.resumeId)).json()).draft.sections[0].items[0].title,before.draft.sections[0].items[0].title);
 const status=await(await s.request(s.resumeId+'/reparse-candidates/'+candidate.taskId)).json();
 assert.equal(status.status,'SUCCEEDED');assert.equal(status.mode,'overwrite');
 const applied=await s.request(s.resumeId+'/reparse-candidates/'+candidate.taskId+'/apply','POST',JSON.stringify({expectedRevision:1}),{'content-type':'application/json'});
 assert.equal(applied.status,200);assert.equal((await applied.json()).revision,2);
 assert.equal((await(await s.request(s.resumeId)).json()).draft.sections[0].items[0].title,'新解析标题');
 assert.equal((await(await s.request(s.resumeId+'/reparse-candidates/'+candidate.taskId+'/apply','POST',JSON.stringify({expectedRevision:1}),{'content-type':'application/json'})).json()).revision,2);
 assert.equal((await(await s.request(s.resumeId+'/versions')).json()).versions.length,2);
});

test('reparse candidate conflicts after concurrent edit and failed task leaves current draft intact',async t=>{
 const s=await readyResume(t),base=(await(await s.request(s.resumeId)).json()).draft;
 const created=await(await s.request(s.resumeId+'/reparse-candidates','POST',JSON.stringify({expectedRevision:1,mode:'fillEmpty',idempotencyKey:'candidate-two'}),{'content-type':'application/json'})).json();
 base.sections[0].items[0].title='并发编辑';
 await s.request(s.resumeId,'PATCH',JSON.stringify({revision:1,draft:base}));
 const task=s.repo.queue.lease('worker');s.repo.queue.fail(task.id,task.leaseToken,'PARSE_FAILED',false);
 assert.equal((await(await s.request(s.resumeId+'/status')).json()).status,'SUCCEEDED');
 assert.equal((await(await s.request(s.resumeId+'/reparse-candidates/'+created.taskId)).json()).status,'FAILED');
 assert.equal((await s.request(s.resumeId+'/reparse-candidates/'+created.taskId+'/apply','POST',JSON.stringify({expectedRevision:1}),{'content-type':'application/json'})).status,409);
 assert.equal((await(await s.request(s.resumeId)).json()).draft.sections[0].items[0].title,'并发编辑');
});

test('fill-empty protects edited fields and deleted source entries while preserving order and assets',()=>{
 const current=JSON.parse(readFileSync('packages/contracts/fixtures/resume-draft.v1.json','utf8'));
 current.version='resume-draft-v2';
 for(const section of current.sections)for(const item of section.items)item.editedFields=[];
 current.sections[0].items[0].title='用户标题';
 current.sections[0].items[0].details='';
 current.sections[0].items[0].editedFields=['title','fact:phone'];
 current.sections[0].items[0].facts[2].value='';
 current.sections[0].items[0].supplements={text:'手写补充',links:[],images:[{imageId:'image_saved',caption:''}]};
 current.sections[0].order=9;current.sections[9].order=0;
 const candidate=structuredClone(current);
 candidate.sections[0].items[0].title='模型标题';candidate.sections[0].items[0].details='模型正文';
 candidate.sections[0].items[0].facts[2].value='模型电话';
 candidate.sections[0].items[0].supplements={text:'',links:[],images:[]};
 candidate.sections[0].order=0;candidate.sections[9].order=9;
 candidate.sections[5].items=[{...candidate.sections[0].items[0],itemId:'new_project',order:0,
   sourceBlockIds:['block_2'],title:'新项目',details:'新正文',facts:[],editedFields:[]}];
 const filled=mergeEmptyDraft(current,candidate,new Set());
 assert.equal(filled.sections[0].order,9);
 assert.equal(filled.sections[0].items[0].itemId,'item_basic');
 assert.equal(filled.sections[0].items[0].title,'用户标题');
 assert.equal(filled.sections[0].items[0].details,'模型正文');
 assert.equal(filled.sections[0].items[0].facts[2].value,'');
 assert.equal(filled.sections[0].items[0].supplements.text,'手写补充');
 assert.equal(filled.sections[5].items[0].needsReview,true);
 assert.equal(filled.sections[5].items[0].included,false);
 assert.equal(mergeEmptyDraft(current,candidate,new Set(['block_2'])).sections[5].items.length,0);
 const replaced=overwriteDraft(current,candidate);
 assert.equal(replaced.sections[0].items[0].itemId,'item_basic');
 assert.equal(replaced.sections[0].items[0].title,'模型标题');
 assert.equal(replaced.sections[0].order,0);
});

test('fill-empty candidate matches stable source, adds reviewed item and never changes edited text',async t=>{
 const s=await readyResume(t),current=(await(await s.request(s.resumeId)).json()).draft;
 current.sections[0].items[0].title='人工标题';
 current.sections[0].items[0].editedFields=['title'];
 current.sections[0].items[0].details='';
 const saved=await(await s.request(s.resumeId,'PATCH',JSON.stringify({revision:1,draft:current}))).json();
 const created=await(await s.request(s.resumeId+'/reparse-candidates','POST',JSON.stringify({expectedRevision:2,mode:'fillEmpty',idempotencyKey:'candidate-fill'}),{'content-type':'application/json'})).json();
 const task=s.repo.queue.lease('worker');
 const source=JSON.parse(readFileSync('packages/contracts/fixtures/resume-source.v1.json','utf8'));
 const metadata=s.db.prepare('SELECT * FROM resume_files WHERE id=?').get(current.fileId);
 Object.assign(source,{fileId:current.fileId,uploadedAt:new Date(metadata.uploaded_at).toISOString().replace('.000Z','Z'),expiresAt:new Date(metadata.expires_at).toISOString().replace('.000Z','Z')});
 source.blocks.push({...source.blocks[0],blockId:'block_2',readingOrder:1,text:'new project'});
 const draft=JSON.parse(readFileSync('packages/contracts/fixtures/resume-draft.v1.json','utf8'));
 Object.assign(draft,{fileId:current.fileId,resumeId:s.resumeId,revision:1});
 for(const section of draft.sections)for(const item of section.items)item.included=false;
 draft.sections[0].items[0].title='模型标题';draft.sections[0].items[0].details='模型正文';
 draft.sections[5].items=[{...structuredClone(draft.sections[0].items[0]),itemId:'candidate_project',order:0,
   sourceBlockIds:['block_2'],title:'新项目',details:'新内容',facts:[],needsReview:false}];
 s.repo.queue.complete(task.id,task.leaseToken,source,draft);
 const applied=await s.request(s.resumeId+'/reparse-candidates/'+created.taskId+'/apply','POST',JSON.stringify({expectedRevision:2}),{'content-type':'application/json'});
 assert.equal(applied.status,200);
 const merged=(await applied.json()).draft;
 assert.equal(merged.revision,3);
 assert.equal(merged.sections[0].items[0].itemId,saved.draft.sections[0].items[0].itemId);
 assert.equal(merged.sections[0].items[0].title,'人工标题');
 assert.equal(merged.sections[0].items[0].details,'模型正文');
 assert.equal(merged.sections[5].items[0].needsReview,true);
 assert.equal(merged.sections[5].items[0].included,false);
 assert.equal((await(await s.request(s.resumeId+'/status')).json()).status,'SUCCEEDED');
});

test('candidate completion after an edit is discarded without touching the current resume',async t=>{
 const s=await readyResume(t),base=(await(await s.request(s.resumeId)).json()).draft;
 const created=await(await s.request(s.resumeId+'/reparse-candidates','POST',JSON.stringify({expectedRevision:1,mode:'overwrite',idempotencyKey:'stale-complete'}),{'content-type':'application/json'})).json();
 const task=s.repo.queue.lease('worker');
 base.sections[0].items[0].title='新的人工作业';
 await s.request(s.resumeId,'PATCH',JSON.stringify({revision:1,draft:base}));
 const source=JSON.parse(readFileSync('packages/contracts/fixtures/resume-source.v1.json','utf8'));
 const metadata=s.db.prepare('SELECT * FROM resume_files WHERE id=?').get(base.fileId);
 Object.assign(source,{fileId:base.fileId,uploadedAt:new Date(metadata.uploaded_at).toISOString().replace('.000Z','Z'),expiresAt:new Date(metadata.expires_at).toISOString().replace('.000Z','Z')});
 const draft=JSON.parse(readFileSync('packages/contracts/fixtures/resume-draft.v1.json','utf8'));
 Object.assign(draft,{fileId:base.fileId,resumeId:s.resumeId,revision:1});
 for(const section of draft.sections)for(const item of section.items)item.included=false;
 s.repo.queue.complete(task.id,task.leaseToken,source,draft);
 const candidate=await(await s.request(s.resumeId+'/reparse-candidates/'+created.taskId)).json();
 assert.equal(candidate.status,'FAILED');assert.equal(candidate.errorCode,'REVISION_CONFLICT');
 assert.equal((await(await s.request(s.resumeId)).json()).draft.sections[0].items[0].title,'新的人工作业');
});
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

test('parse queue is idempotent, session scoped, cancellable and retry keeps resume identity',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const parse=(key,id=file.fileId,extra={})=>s.request('parse','POST',JSON.stringify({fileId:id,idempotencyKey:key}),{'content-type':'application/json',...extra});
 assert.equal((await parse('key1',file.fileId,{'x-csrf-token':'bad'})).status,403);
 const first=await parse('key1');assert.equal(first.status,202);const a=await first.json();assert.equal(a.status,'QUEUED');
 assert.deepEqual(await(await parse('key1')).json(),a);
 assert.equal((await parse('key1','missing')).status,409);
 const restored=await s.request(a.resumeId+'/status');assert.equal(restored.status,200);assert.equal((await restored.json()).fileId,file.fileId);
 assert.equal((await s.request(a.resumeId)).status,409);
 assert.equal((await s.request(a.resumeId+'/cancel','POST','{}')).status,200);
 assert.equal((await(await s.request(a.resumeId+'/status')).json()).status,'CANCELLED');
 assert.equal((await(await parse('key2')).json()).resumeId,a.resumeId);
 const other=await dispatchWebRequest(new Request('http://test/api/session'),s.handler),otherCsrf=(await other.json()).csrfToken;
 const headers={cookie:other.headers.get('set-cookie').split(';')[0],'x-csrf-token':otherCsrf};
 assert.equal((await s.request(a.resumeId+'/status','GET',null,headers)).status,404);
 assert.equal((await parse('other',file.fileId,headers)).status,404);
});

test('private resume lease authenticates, reclaims, fences cancelled workers and never leaks PDF in task',async t=>{
 const s=await setup(t),token='r'.repeat(64);
 const handler=createRequestHandler({db:s.db,service:{},resumeRepository:s.repo,agentToken:token,secret:Buffer.alloc(32,7)});
 const internal=async(path,method='POST',body={},lease,auth=token)=>dispatchWebRequest(new Request('http://test/_internal/agent/resume-tasks/'+path,{method,headers:{authorization:'Bearer '+auth,'content-type':'application/json',...(lease?{'x-agent-lease':lease}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})}),handler);
 const file=await(await s.request('upload','POST',pdf())).json(),r=await(await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'lease'}))).json();
 assert.equal((await internal('lease','POST',{workerId:'worker'},null,'bad')).status,403);
 const response=await internal('lease','POST',{workerId:'worker'});assert.equal(response.status,200);const task=await response.json();assert.equal(task.workflowVersion,'resume-parse-v2');assert.equal(task.fileId,file.fileId);assert.equal(task.resumeId,r.resumeId);assert.equal('blocks' in task,false);
 assert.deepEqual(Buffer.from(await(await internal(task.id+'/source','GET',{},task.leaseToken)).arrayBuffer()),pdf());
 s.advance(20_000);assert.equal((await internal(task.id+'/heartbeat','POST',{leaseToken:task.leaseToken,stage:'extract_layout',progress:20})).status,200);
 s.advance(20_000);assert.equal((await internal(task.id+'/source','GET',{},task.leaseToken)).status,200);
 assert.equal((await(await s.request(r.resumeId+'/status')).json()).progress,20);
 assert.equal((await internal(task.id+'/heartbeat','POST',{leaseToken:task.leaseToken,stage:'format_items',progress:75})).status,200);
 assert.equal((await s.request(r.resumeId+'/cancel','POST','{}')).status,200);
 assert.equal((await internal(task.id+'/source','GET',{},task.leaseToken)).status,409);
 assert.equal((await internal(task.id+'/complete','POST',{leaseToken:task.leaseToken,source:{},draft:{}})).status,409);
 assert.equal((await(await internal(task.id+'/heartbeat','POST',{leaseToken:task.leaseToken})).json()).cancelRequested,true);
 assert.equal((await internal(task.id+'/ack-cancel','POST',{leaseToken:task.leaseToken})).status,200);
 await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'retry'}));
 const next=await(await internal('lease','POST',{workerId:'worker'})).json();assert.notEqual(next.id,task.id);
 assert.equal((await internal(task.id+'/fail','POST',{leaseToken:task.leaseToken,errorCode:'PARSE_FAILED'})).status,409);
 s.db.prepare('UPDATE resume_parse_tasks SET lease_until=0 WHERE id=?').run(next.id);
 const status=await(await s.request(r.resumeId+'/status')).json();assert.equal(status.status,'QUEUED');assert.equal(status.errorCode,'PARSE_TIMEOUT');assert.equal(status.stage,'queued');assert.equal(status.progress,0);
 s.db.prepare('UPDATE resume_parse_tasks SET next_attempt_at=0 WHERE id=?').run(next.id);
 const reclaimed=await(await internal('lease','POST',{workerId:'worker2'})).json();assert.equal(reclaimed.id,next.id);assert.notEqual(reclaimed.leaseToken,next.leaseToken);
 assert.equal((await internal(next.id+'/source','GET',{},next.leaseToken)).status,409);
 assert.equal((await internal(next.id+'/heartbeat','POST',{leaseToken:next.leaseToken})).status,409);
});


test('complete persists validated source and draft atomically; edits use revision and source evidence',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const parsed=await(await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'complete'}))).json();
 const task=s.repo.queue.lease('worker');
 const metadata=s.db.prepare('SELECT * FROM resume_files WHERE id=?').get(file.fileId);
 const source=JSON.parse(readFileSync('packages/contracts/fixtures/resume-source.v1.json','utf8'));
 Object.assign(source,{fileId:file.fileId,uploadedAt:new Date(metadata.uploaded_at).toISOString().replace('.000Z','Z'),expiresAt:new Date(metadata.expires_at).toISOString().replace('.000Z','Z')});
 const draft=JSON.parse(readFileSync('packages/contracts/fixtures/resume-draft.v1.json','utf8'));
 Object.assign(draft,{fileId:file.fileId,resumeId:parsed.resumeId,revision:1});for(const section of draft.sections)for(const item of section.items)item.included=false;
 const bad=structuredClone(draft);bad.sections[0].items[0].sourceBlockIds=['invented'];
 assert.throws(()=>s.repo.queue.complete(task.id,task.leaseToken,source,bad),e=>e.status===400);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM resume_blocks').get().n,0);
 const omitted=structuredClone(draft);for(const section of omitted.sections)section.items=[];
 assert.throws(()=>s.repo.queue.complete(task.id,task.leaseToken,source,omitted),e=>e.status===400);
 const wrongSource=structuredClone(source);wrongSource.uploadedAt='2020-01-01T00:00:00Z';
 assert.throws(()=>s.repo.queue.complete(task.id,task.leaseToken,wrongSource,draft),e=>e.status===400);
 s.db.exec("CREATE TRIGGER reject_resume_complete BEFORE UPDATE OF draft_json ON resumes BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.throws(()=>s.repo.queue.complete(task.id,task.leaseToken,source,draft));assert.equal(s.db.prepare('SELECT COUNT(*) n FROM resume_blocks').get().n,0);
 s.db.exec('DROP TRIGGER reject_resume_complete');s.repo.queue.complete(task.id,task.leaseToken,source,draft);
 assert.equal((await(await s.request(parsed.resumeId+'/status')).json()).status,'SUCCEEDED');
 const saved=await(await s.request(parsed.resumeId)).json();assert.equal(saved.draft.version,'resume-draft-v2');assert.deepEqual(saved.draft.sections[0].items[0].editedFields,[]);assert.equal(saved.draft.sections[0].items[0].title,draft.sections[0].items[0].title);assert.equal(saved.expiresAt,source.expiresAt);
 assert.equal((await(await s.request(parsed.resumeId+'/status')).json()).expiresAt,source.expiresAt);
 draft.sections[0].items[0].title='User edit';
 const update=await s.request(parsed.resumeId,'PATCH',JSON.stringify({revision:1,draft}));assert.equal(update.status,200);assert.equal((await update.json()).revision,2);
 assert.equal((await s.request(parsed.resumeId,'PATCH',JSON.stringify({revision:1,draft}))).status,409);
 assert.throws(()=>s.repo.queue.complete(task.id,task.leaseToken,source,draft),e=>e.status===409);
 await s.request(parsed.resumeId,'DELETE');assert.equal(s.db.prepare('SELECT COUNT(*) n FROM resume_parse_tasks').get().n,0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM resume_parse_requests').get().n,0);
});

test('owner can read trimmed source blocks for original-text cross-check after completion',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const parsed=await(await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'blocks'}))).json();
 assert.equal((await s.request(parsed.resumeId+'/blocks')).status,409);
 const task=s.repo.queue.lease('worker');
 const metadata=s.db.prepare('SELECT * FROM resume_files WHERE id=?').get(file.fileId);
 const source=JSON.parse(readFileSync('packages/contracts/fixtures/resume-source.v1.json','utf8'));
 Object.assign(source,{fileId:file.fileId,uploadedAt:new Date(metadata.uploaded_at).toISOString().replace('.000Z','Z'),expiresAt:new Date(metadata.expires_at).toISOString().replace('.000Z','Z')});
 const draft=JSON.parse(readFileSync('packages/contracts/fixtures/resume-draft.v1.json','utf8'));
 Object.assign(draft,{fileId:file.fileId,resumeId:parsed.resumeId,revision:1});for(const section of draft.sections)for(const item of section.items)item.included=false;
 s.repo.queue.complete(task.id,task.leaseToken,source,draft);
 const response=await s.request(parsed.resumeId+'/blocks');assert.equal(response.status,200);
 const body=await response.json();
 // 只暴露对照所需的四个字段，bbox/字号等私有布局细节不下发
 assert.deepEqual(body.blocks.map(b=>Object.keys(b).sort()),[['blockId','page','readingOrder','text']]);
 assert.deepEqual(body.blocks,[{blockId:'block_1',page:1,readingOrder:0,text:'source text'}]);
 const other=await dispatchWebRequest(new Request('http://test/api/session'),s.handler);
 assert.equal((await s.request(parsed.resumeId+'/blocks','GET',null,{cookie:other.headers.get('set-cookie').split(';')[0]})).status,404);
});

const png1x1=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082','hex');
test('owner can attach supplement images to a completed resume draft',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const parsed=await(await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'images'}))).json();
 const task=s.repo.queue.lease('worker');
 const metadata=s.db.prepare('SELECT * FROM resume_files WHERE id=?').get(file.fileId);
 const source=JSON.parse(readFileSync('packages/contracts/fixtures/resume-source.v1.json','utf8'));
 Object.assign(source,{fileId:file.fileId,uploadedAt:new Date(metadata.uploaded_at).toISOString().replace('.000Z','Z'),expiresAt:new Date(metadata.expires_at).toISOString().replace('.000Z','Z')});
 const draft=JSON.parse(readFileSync('packages/contracts/fixtures/resume-draft.v1.json','utf8'));
 Object.assign(draft,{fileId:file.fileId,resumeId:parsed.resumeId,revision:1});for(const section of draft.sections)for(const item of section.items)item.included=false;
 s.repo.queue.complete(task.id,task.leaseToken,source,draft);
 // 上传补充图片：属主 + 受限类型 + 5MB 上限
 const up=await s.request(parsed.resumeId+'/images','POST',png1x1,{'content-type':'image/png'});
 assert.equal(up.status,201);const {imageId}=await up.json();assert.match(imageId,/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
 const img=await s.request(parsed.resumeId+'/images/'+imageId);
 assert.equal(img.status,200);assert.equal(img.headers.get('content-type'),'image/png');
 assert.equal(img.headers.get('x-content-type-options'),'nosniff');
 assert.deepEqual(Buffer.from(await img.arrayBuffer()),png1x1);
 const other=await dispatchWebRequest(new Request('http://test/api/session'),s.handler);
 const stranger={cookie:other.headers.get('set-cookie').split(';')[0]};
 assert.equal((await s.request(parsed.resumeId+'/images/'+imageId,'GET',null,stranger)).status,404);
 assert.equal((await(await s.request(parsed.resumeId+'/images','POST',png1x1,{'content-type':'text/plain'})).json()).errorCode,'IMAGE_TYPE_INVALID');
 assert.equal((await s.request(parsed.resumeId+'/images','POST',Buffer.alloc(5*1024*1024+1),{'content-type':'image/png'})).status,413);
 // 草稿可引用已上传图片；悬空引用被整体拒绝
 draft.sections[0].items[0].supplements={text:'补充',links:[{url:'https://example.com/work'}],images:[{imageId,caption:'作品截图'}]};
 const update=await s.request(parsed.resumeId,'PATCH',JSON.stringify({revision:1,draft}));
 assert.equal(update.status,200);assert.equal((await update.json()).revision,2);
 draft.sections[0].items[0].supplements.images=[{imageId:'ghost_image',caption:''}];draft.revision=2;
 assert.equal((await s.request(parsed.resumeId,'PATCH',JSON.stringify({revision:2,draft}))).status,400);
 // 简历删除后图片字节随级联清理
 await s.request(parsed.resumeId,'DELETE');
 assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM resume_images').get().n,0);
});

test('parse session rate limit and bounded retries do not affect other queues',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();let id;
 for(let i=0;i<10;i++){const r=await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'rate'+i}));assert.equal(r.status,202);id=(await r.json()).resumeId;}
 const limited=await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'limited'}));assert.equal(limited.status,429);assert.equal((await limited.json()).errorCode,'RATE_LIMITED');
 for(let i=0;i<3;i++){const task=s.repo.queue.lease('worker');assert.ok(task);s.repo.queue.fail(task.id,task.leaseToken,'PARSE_FAILED',true);s.db.prepare('UPDATE resume_parse_tasks SET next_attempt_at=0').run();}
 assert.equal(s.repo.queue.status(s.db.prepare('SELECT owner_session_id FROM resume_files').get().owner_session_id,id).status,'FAILED');assert.equal(s.repo.queue.lease('worker'),null);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM generations').get().n,0);
});

test('a queued v1 parse task adopts the anchored v2 workflow when leased',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const parsed=await(await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'upgrade'}))).json();
 s.db.prepare("UPDATE resume_parse_tasks SET workflow_version='resume-parse-v1' WHERE resume_id=?").run(parsed.resumeId);
 const task=s.repo.queue.lease('worker');
 assert.equal(task.workflowVersion,'resume-parse-v2');
 assert.equal(s.db.prepare('SELECT workflow_version FROM resume_parse_tasks WHERE id=?').get(task.id).workflow_version,'resume-parse-v2');
});

test('reparse creates a separate private draft and preserves the original resume',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const original=await(await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'original'}))).json();
 const response=await s.request(original.resumeId+'/reparse','POST',JSON.stringify({idempotencyKey:'reparse'}));
 assert.equal(response.status,202);
 const next=await response.json();
 assert.notEqual(next.resumeId,original.resumeId);
 assert.notEqual(next.fileId,file.fileId);
 assert.equal((await s.request(original.resumeId+'/status')).status,200);
 assert.equal((await s.request(original.resumeId+'/source')).status,200);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM resume_files').get().n,2);
 const other=await dispatchWebRequest(new Request('http://test/api/session'),s.handler);
 const cookie=other.headers.get('set-cookie').split(';')[0],csrf=(await other.json()).csrfToken;
 assert.equal((await s.request(original.resumeId+'/reparse','POST',JSON.stringify({idempotencyKey:'stolen'}),
   {cookie,'x-csrf-token':csrf})).status,404);
});


test('UI wait timeout does not terminate queued work and malformed parse input is rejected',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 for(const input of ['null','[]','{}','{"fileId":"x","idempotencyKey":3}'])assert.equal((await s.request('parse','POST',input)).status,400);
 const parsed=await(await s.request('parse','POST',JSON.stringify({fileId:file.fileId,idempotencyKey:'wait'}))).json();
 s.advance(60_001);const status=await(await s.request(parsed.resumeId+'/status')).json();assert.equal(status.status,'QUEUED');assert.equal(status.errorCode,null);
 assert.equal((await s.request(parsed.resumeId+'/source')).status,200);
});

test('expiry while submitting queue work returns expired rather than nesting transactions',async t=>{
 const s=await setup(t),file=await(await s.request('upload','POST',pdf())).json();
 const owner=s.db.prepare('SELECT owner_session_id FROM resume_files').get().owner_session_id;
 s.advance();assert.throws(()=>s.repo.queue.parse(owner,{fileId:file.fileId,idempotencyKey:'expired'}),e=>e.status===410&&e.errorCode==='RESUME_EXPIRED');
});

test('status recovery cannot overwrite a lease recovered through a second SQLite connection',async t=>{
 const root=mkdtempSync(join(tmpdir(),'resume-status-race-')),dbA=openDatabase(join(root,'queue.sqlite')),dbB=openDatabase(join(root,'queue.sqlite'));
 t.after(()=>{dbB.close();dbA.close();rmSync(root,{recursive:true,force:true});});
 dbB.exec('PRAGMA busy_timeout=0');let time=Date.now();
 dbA.prepare('INSERT INTO sessions VALUES(?,?,?)').run('owner',time,time+86400000);
 const {createResumeRepository}=await import('../../../packages/storage/src/resumes/repository.mjs');
 const {createResumeParseQueue}=await import('../../../packages/storage/src/resumes/queue.mjs');
 const repoA=createResumeRepository({db:dbA,root:join(root,'files'),now:()=>time});
 const repoB=createResumeRepository({db:dbB,root:join(root,'files'),now:()=>time});
 const file=await repoA.upload('owner',pdf(),'synthetic.pdf','application/pdf');
 const parsed=repoA.queue.parse('owner',{fileId:file.fileId,idempotencyKey:'status-race'});
 const expired=repoA.queue.lease('worker-a');time+=31_000;
 let interleaved=false,blocked=false,reclaimed=null;
 // Pause A after its expiry SELECT returns a snapshot, before any recovery writes.
 // B then attempts the complete recovery/re-lease sequence on its real connection.
 const dbProxy=new Proxy(dbA,{get(target,key){
  if(key==='prepare')return sql=>{
   const statement=target.prepare(sql);
   if(!sql.startsWith('SELECT * FROM resume_parse_tasks WHERE status IN'))return statement;
   return new Proxy(statement,{get(stmt,method){
    if(method==='all')return (...args)=>{
     const rows=stmt.all(...args);
     if(!interleaved&&rows.length){
      interleaved=true;
      try{repoB.queue.status('owner',parsed.resumeId);}
      catch(error){assert.match(error.message,/locked/);blocked=true;}
      if(!blocked){time+=2000;reclaimed=repoB.queue.lease('worker-b');assert.ok(reclaimed);}
     }
     return rows;
    };
    const value=Reflect.get(stmt,method,stmt);return typeof value==='function'?value.bind(stmt):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const queueA=createResumeParseQueue({db:dbProxy,repository:repoA,now:()=>time});
 const observed=queueA.status('owner',parsed.resumeId);assert.equal(interleaved,true);
 if(reclaimed){
  assert.equal(observed.status,'RUNNING');
  assert.equal(dbB.prepare('SELECT lease_token FROM resume_parse_tasks WHERE id=?').get(expired.id).lease_token,reclaimed.leaseToken);
 }else{
  assert.equal(blocked,true);assert.equal(observed.status,'QUEUED');
  time+=2000;reclaimed=repoB.queue.lease('worker-b');assert.ok(reclaimed);
  assert.equal(queueA.status('owner',parsed.resumeId).status,'RUNNING');
 }
 assert.equal(dbA.prepare('SELECT status FROM resumes WHERE id=?').get(parsed.resumeId).status,'RUNNING');
 assert.equal(repoB.queue.heartbeat(reclaimed.id,reclaimed.leaseToken).ok,true);
});
