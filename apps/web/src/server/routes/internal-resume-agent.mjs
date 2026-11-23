import { leaseWaitMs } from "../queue-notifications.mjs";
import { createHash, timingSafeEqual } from 'node:crypto';
import { resumeError } from '../../../../../packages/storage/src/resumes/files.mjs';
import { planFromPdf, planFromPages } from '../resume-plan.mjs';
export async function handleInternalResumeAgentRoutes({
  req,
  res,
  parts,
  repository,
  agentToken,
  queueNotifications,
  bodyJson,
  sendJson
}) {
  if (parts[2] !== 'resume-tasks') return false;
  const supplied = req.headers.authorization;
  const hash = value => createHash('sha256').update(value).digest();
  if (typeof supplied !== 'string' || !timingSafeEqual(hash(supplied), hash('Bearer ' + agentToken))) throw resumeError(403, 'AGENT_AUTH_FAILED');
  const queue = repository.queue;
  if (parts.length === 4 && parts[3] === 'lease' && req.method === 'POST') {
    const input = await bodyJson(req, 4096);
    const take = () => queue.lease(input?.workerId, { supportsPresentationHighlights: input?.supportsPresentationHighlights === true });
    const task = queueNotifications
      ? await queueNotifications.claim("resume_parse_tasks", leaseWaitMs(input?.waitMs), req.signal, take)
      : await take();
    if (!task) {
      res.writeHead(204, {
        'cache-control': 'no-store'
      });
      res.end();
    } else sendJson(res, 200, task);
    return true;
  }
  if (parts.length !== 5) return false;
  const id = parts[3],
    action = parts[4];
  if (req.method === 'GET' && action === 'source') {
    const bytes = await queue.source(id, req.headers['x-agent-lease']);
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': bytes.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end(bytes);
    return true;
  }
  if (req.method === 'GET' && action === 'plan') {
    const bytes = await queue.source(id, req.headers['x-agent-lease']);
    sendJson(res, 200, await planFromPdf(bytes));
    return true;
  }
  if (req.method === 'POST' && action === 'plan') {
    await queue.source(id, req.headers['x-agent-lease']);
    const input = await bodyJson(req, 250_000);
    if (!Array.isArray(input?.pages) || input.pages.length < 1 || input.pages.length > 20
        || input.pages.some(page => typeof page !== 'string' || page.length > 200_000)
        || input.pages.join('').length > 200_000) throw resumeError(400, 'PARSE_FAILED');
    sendJson(res, 200, planFromPages(input.pages));
    return true;
  }
  if (req.method !== 'POST' || !['heartbeat', 'complete', 'fail', 'ack-cancel'].includes(action)) return false;
  const input = await bodyJson(req, action === 'complete' ? 80 * 1024 * 1024 : 4096);
  let result;
  if (action === 'heartbeat') result = await queue.heartbeat(id, input?.leaseToken, input ?? {});
  if (action === 'complete') result = await queue.complete(id, input?.leaseToken, input?.source, input?.draft);
  if (action === 'fail') result = await queue.fail(id, input?.leaseToken, input?.errorCode, input?.retryable);
  if (action === 'ack-cancel') result = await queue.ackCancel(id, input?.leaseToken);
  sendJson(res, 200, result);
  return true;
}
