import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../../packages/storage/src/database.mjs';
import { createGenerationService } from '../../../../packages/storage/src/generations.mjs';
import { createPaymentHttpServer } from '../../../web/src/server/http.mjs';

const root = mkdtempSync(join(tmpdir(), 'burp-v3-bridge-'));
const db = openDatabase(join(root, 'app.sqlite'));
const golden = JSON.parse(readFileSync('packages/contracts/fixtures/agent-golden.v2.json', 'utf8'));
db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('synthetic-owner', Date.now(), Date.now() + 100_000);
const generationService = createGenerationService({ db, assetRoot: join(root, 'assets') });
const queued = generationService.enqueue('synthetic-owner', { brief: golden.input, idempotencyKey: 'v3-bridge' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=', 'base64');
// Synthetic storage fixture only; production copies are created by enqueueResume.
db.prepare('INSERT INTO showcase_media VALUES(?,?,?,?,?)').run('image_synthetic', 'synthetic-owner', 'image/png', png, Date.now());
db.prepare('INSERT INTO generation_media VALUES(?,?)').run(queued.id, 'image_synthetic');
const complete = generationService.complete;
generationService.complete = (...args) => {
  const ok = complete(...args);
  if (ok) process.stdout.write(JSON.stringify({ ...generationService.getTask('synthetic-owner', queued.id),
    projects: db.prepare('SELECT count(*) n FROM projects').get().n,
    paid: db.prepare('SELECT count(*) n FROM entitlements').get().n }) + '\n');
  return ok;
};
const server = createPaymentHttpServer({ db, service: {}, generationService,
  agentToken: process.env.AGENT_SERVICE_TOKEN, secret: Buffer.alloc(32, 8) });
server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({
  baseUrl: `http://127.0.0.1:${server.address().port}`, taskId: queued.id }) + '\n'));
process.on('SIGTERM', () => server.close(() => { db.close(); rmSync(root, { recursive: true, force: true }); }));
