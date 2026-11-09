import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../packages/storage/src/database.mjs';
import { createResumeRepository } from '../../../packages/storage/src/resumes/repository.mjs';
import { createRequestHandler, dispatchWebRequest } from '../../web/src/server/http.mjs';
import { planFromPages } from '../../web/src/server/resume-plan.mjs';
import { pdf } from './test-fixtures/resume-pdf.mjs';

test('legacy browser entries become fixed anchors with basic facts merged', () => {
  const plan = planFromPages([
    '林青\nlin@example.com\n基本信息\n电话：13800138000\n工作经历\n2024.01 - 2024.06 示例公司\n后端工程师\n负责服务开发。\n项目经历\n2025.01 - 2025.06 示例项目\n项目描述：完成测试。'
  ]);
  assert.equal(plan.version, 'resume-parse-plan-v1');
  assert.deepEqual(plan.anchors.map(({ kind }) => kind), ['basicInfo', 'workExperience', 'projects']);
  assert.deepEqual(plan.anchors.map(({ anchorId }) => anchorId), ['a0', 'a1', 'a2']);
  assert.match(plan.anchors[0].text, /lin@example.com/);
  assert.match(plan.anchors[1].text, /负责服务开发/);
  assert.ok(plan.anchors.every(anchor => !('sourceRefs' in anchor)));
});

test('private plan starts basic anchor with a name merged with a URL in PDF text', () => {
  const plan = planFromPages(['林青https://github.com/example\n基本信息\n邮箱：lin@example.com']);
  assert.equal(plan.anchors[0].kind, 'basicInfo');
  assert.equal(plan.anchors[0].text.split('\n')[0], '林青');
});

test('private plan endpoint requires service token and active lease', async t => {
  const root = mkdtempSync(join(tmpdir(), 'resume-plan-test-'));
  const db = openDatabase(':memory:');
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const repository = createResumeRepository({ db, root });
  const token = 'p'.repeat(64);
  const handler = createRequestHandler({ db, service: {}, resumeRepository: repository,
    agentToken: token, secret: Buffer.alloc(32, 9) });
  const session = await dispatchWebRequest(new Request('http://test/api/session'), handler);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const csrf = (await session.json()).csrfToken;
  const uploaded = await dispatchWebRequest(new Request('http://test/api/resumes/upload', {
    method: 'POST', body: pdf(), headers: { cookie, 'x-csrf-token': csrf,
      'content-type': 'application/pdf', 'x-file-name': 'synthetic.pdf' }
  }), handler);
  assert.equal(uploaded.status, 201);
  const { fileId } = await uploaded.json();
  const queued = await dispatchWebRequest(new Request('http://test/api/resumes/parse', {
    method: 'POST', body: JSON.stringify({ fileId, idempotencyKey: 'plan-test' }),
    headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }
  }), handler);
  assert.equal(queued.status, 202);
  const task = repository.queue.lease('worker');
  const endpoint = `http://test/_internal/agent/resume-tasks/${task.id}/plan`;
  const request = (auth, lease) => dispatchWebRequest(new Request(endpoint, {
    headers: { authorization: `Bearer ${auth}`, 'x-agent-lease': lease }
  }), handler);
  assert.equal((await request('wrong', task.leaseToken)).status, 403);
  assert.equal((await request(token, 'wrong')).status, 409);
  const response = await request(token, task.leaseToken);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const plan = await response.json();
  assert.equal(plan.version, 'resume-parse-plan-v1');
  assert.deepEqual(plan.anchors.map(({ kind, text }) => [kind, text]), [['basicInfo', 'Synthetic fixture']]);
  repository.queue.cancel(db.prepare('SELECT owner_session_id FROM resume_files WHERE id=?').get(fileId).owner_session_id,
    task.resumeId);
  assert.equal((await request(token, task.leaseToken)).status, 409);
});
