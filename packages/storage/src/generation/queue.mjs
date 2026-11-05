import { randomUUID } from "node:crypto";
import { ServiceError, cleanConfig } from "../../../contracts/src/validation.mjs";
import { transaction } from "../database.mjs";
import { listAvatarStyles } from "../../../skills/src/wibi.ts";
import { cleanGenerationBrief } from "./brief.mjs";
import { validateImage } from "./assets.mjs";

const DAY = 24 * 60 * 60 * 1000;
export const WORKFLOW_VERSION = "python-agent-v1";

export function createGenerationQueue({ db, assets, minPixels, now, leaseMs, maxAttempts, retryBaseMs,
  allowPortraits, requireBrief }) {
  function publicTask(row) {
    const expired = row.status === "SUCCEEDED" && row.output_asset_id && !assets.outputExists(row.output_asset_id);
    const cancelling = row.status === "RUNNING" && row.cancel_requested_at != null;
    return { id: row.id, status: expired ? "EXPIRED" : cancelling ? "CANCELLING" : row.status, styleId: row.style_id,
      error: expired ? "成图已过期，请重新上传照片生成。" : row.error,
      ...(row.status === "SUCCEEDED" && !expired && row.config_json ? { config: JSON.parse(row.config_json) } : {}),
      ...(row.status === "SUCCEEDED" && row.output_asset_id && !expired ? { heroArtwork: { assetUrl: `/api/hero-assets/${row.output_asset_id}`, styleId: row.style_id,
        alt: "根据本人肖像生成的动画风格虚拟形象" } } : {}) };
  }
  function getTask(sessionId, id) {
    const row = db.prepare("SELECT * FROM generations WHERE id=? AND owner_session_id=?").get(id, sessionId);
    if (!row) throw new ServiceError(404, "生成任务不存在或无权访问。");
    return publicTask(row);
  }
  function cancel(sessionId, id) {
    return transaction(db, () => {
      const row = db.prepare("SELECT * FROM generations WHERE id=? AND owner_session_id=?").get(id, sessionId);
      if (!row) throw new ServiceError(404, "生成任务不存在或无权访问。");
      const time = now();
      if (row.status === "QUEUED") {
        db.prepare("UPDATE generations SET status='CANCELLED',cancel_requested_at=?,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='QUEUED'")
          .run(time, time, id);
      } else if (row.status === "RUNNING" && row.cancel_requested_at == null) {
        db.prepare("UPDATE generations SET cancel_requested_at=?,updated_at=? WHERE id=? AND status='RUNNING'")
          .run(time, time, id);
      }
      return publicTask(db.prepare("SELECT * FROM generations WHERE id=?").get(id));
    });
  }
  function enqueue(sessionId, { portraitAssetId = null, styleId = null, idempotencyKey, config = null, brief = null }) {
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey)) throw new ServiceError(400, "生成请求标识无效。");
    if (portraitAssetId && !allowPortraits) throw new ServiceError(403, "当前环境未启用肖像生成。");
    if (requireBrief && !brief) throw new ServiceError(400, "请先确认简历内容并完成测评。");
    if (portraitAssetId) {
      if (!listAvatarStyles().some((style) => style.id === styleId)) throw new ServiceError(400, "未知肖像风格。");
      const asset = db.prepare("SELECT id FROM avatar_assets WHERE id=? AND owner_session_id=? AND kind='portrait' AND expires_at>?").get(portraitAssetId, sessionId, now());
      if (!asset) throw new ServiceError(404, "照片不存在或无权访问。");
    } else if (styleId) throw new ServiceError(400, "未上传照片时不能选择生图风格。");
    if (brief && config) throw new ServiceError(400, "生成请求不能同时包含已生成配置和确认内容。");
    const safeConfig = config ? cleanConfig(config) : null;
    const safeBrief = brief ? JSON.stringify(cleanGenerationBrief(brief)) : null;
    const existing = db.prepare("SELECT * FROM generations WHERE owner_session_id=? AND idempotency_key=?").get(sessionId, idempotencyKey);
    if (existing) {
      if (existing.portrait_asset_id !== portraitAssetId || existing.style_id !== styleId ||
        existing.config_json !== safeConfig || existing.brief_json !== safeBrief) throw new ServiceError(409, "生成请求标识已用于其他内容。");
      return publicTask(existing);
    }
    if (portraitAssetId) {
      const attempts = db.prepare("SELECT COUNT(*) AS count FROM generations WHERE owner_session_id=? AND portrait_asset_id IS NOT NULL AND created_at>?").get(sessionId, now() - DAY).count;
      if (attempts >= 5) throw new ServiceError(429, "本机肖像生成次数已达每日上限（5 次）。");
    }
    const id = randomUUID(), time = now();
    db.prepare("INSERT INTO generations(id,owner_session_id,portrait_asset_id,style_id,config_json,brief_json,idempotency_key,workflow_version,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'QUEUED',?,?)")
      .run(id, sessionId, portraitAssetId, styleId, safeConfig, safeBrief, idempotencyKey, WORKFLOW_VERSION, time, time);
    return getTask(sessionId, id);
  }
  function leaseNext() {
    for (let scanned = 0; scanned < 20; scanned++) {
      const time = now();
      db.prepare("UPDATE generations SET status='CANCELLED',error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE status='RUNNING' AND cancel_requested_at IS NOT NULL AND lease_until<=?")
        .run(time, time);
      const row = db.prepare("SELECT * FROM generations WHERE (status='QUEUED' AND next_attempt_at<=?) OR (status='RUNNING' AND cancel_requested_at IS NULL AND lease_until<=?) ORDER BY created_at LIMIT 1")
        .get(time, time);
      if (!row) return null;
      if (row.attempt_count >= maxAttempts) {
        db.prepare("UPDATE generations SET status='FAILED',error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND ((status='QUEUED' AND next_attempt_at<=?) OR (status='RUNNING' AND cancel_requested_at IS NULL AND lease_until<=?))")
          .run("生成任务重试次数已达上限。", time, row.id, time, time);
        continue;
      }
      const leaseToken = randomUUID();
      const result = db.prepare("UPDATE generations SET status='RUNNING',lease_token=?,lease_until=?,attempt_count=attempt_count+1,error=NULL,updated_at=? WHERE id=? AND ((status='QUEUED' AND next_attempt_at<=?) OR (status='RUNNING' AND cancel_requested_at IS NULL AND lease_until<=?))")
        .run(leaseToken, time + leaseMs, time, row.id, time, time);
      if (result.changes) return { ...row, status: "RUNNING", lease_token: leaseToken, lease_until: time + leaseMs,
        attempt_count: row.attempt_count + 1 };
    }
    return null;
  }
  function heartbeat(id, leaseToken) {
    const time = now();
    return db.prepare("UPDATE generations SET lease_until=?,updated_at=? WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>?")
      .run(time + leaseMs, time, id, leaseToken, time).changes === 1;
  }
  function isCancelRequested(id, leaseToken) {
    const row = db.prepare("SELECT status,lease_token,lease_until,cancel_requested_at FROM generations WHERE id=?").get(id);
    return !row || row.status !== "RUNNING" || row.lease_token !== leaseToken || row.lease_until <= now() ||
      row.cancel_requested_at != null;
  }
  function getLeasedTask(id, leaseToken) {
    if (!leaseToken) return null;
    return db.prepare("SELECT * FROM generations WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>?")
      .get(id, leaseToken, now()) ?? null;
  }
  function acknowledgeCancel(id, leaseToken) {
    return db.prepare("UPDATE generations SET status='CANCELLED',error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND lease_token=? AND cancel_requested_at IS NOT NULL")
      .run(now(), id, leaseToken).changes === 1;
  }
  function storeOutput(id, image, leaseToken = null) {
    let created = null;
    try {
      return transaction(db, () => {
        const row = db.prepare("SELECT * FROM generations WHERE id=?").get(id);
        if (!row) throw new Error("Generation missing");
        if (row.cancel_requested_at != null) throw new Error("Generation cancelled");
        if (row.output_asset_id) return row.output_asset_id;
        if (!row.portrait_asset_id) throw new Error("No portrait on generation");
        if (row.status === "RUNNING" && (!leaseToken || row.lease_token !== leaseToken || row.lease_until <= now())) {
          throw new Error("Generation lease is no longer active");
        }
        if (row.status !== "RUNNING" && row.status !== "QUEUED") throw new Error("Generation is no longer writable");
        const mime = validateImage(image.bytes, image.mime, minPixels);
        created = assets.store(row.owner_session_id, "hero", image.bytes, mime).id;
        const result = db.prepare("UPDATE generations SET output_asset_id=?,updated_at=? WHERE id=? AND output_asset_id IS NULL")
          .run(created, now(), id);
        if (!result.changes) throw new Error("Generation output was already stored");
        return created;
      });
    } catch (error) {
      if (created) assets.deleteFile(created);
      throw error;
    }
  }
  function existingOutput(taskId) {
    return db.prepare("SELECT output_asset_id FROM generations WHERE id=?").get(taskId)?.output_asset_id ?? null;
  }
  function complete(id, { config = null, leaseToken = null } = {}) {
    const time = now();
    const safeConfig = config ? cleanConfig(config) : null;
    if (leaseToken) {
      return db.prepare("UPDATE generations SET status='SUCCEEDED',config_json=COALESCE(?,config_json),error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND cancel_requested_at IS NULL AND lease_token=? AND lease_until>?")
        .run(safeConfig, time, id, leaseToken, time).changes === 1;
    }
    // Compatibility for pre-worker tests and manually queued legacy tasks only.
    return db.prepare("UPDATE generations SET status='SUCCEEDED',config_json=COALESCE(?,config_json),error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='QUEUED' AND cancel_requested_at IS NULL")
      .run(safeConfig, time, id).changes === 1;
  }
  function fail(id, message, { leaseToken = null, retryable = false } = {}) {
    const time = now();
    const row = db.prepare("SELECT attempt_count,cancel_requested_at FROM generations WHERE id=?").get(id);
    if (!row) return false;
    const shouldRetry = row.cancel_requested_at == null && retryable && row.attempt_count < maxAttempts;
    const status = row.cancel_requested_at != null ? "CANCELLED" : shouldRetry ? "QUEUED" : "FAILED";
    const next = shouldRetry ? time + Math.min(60_000, retryBaseMs * 2 ** Math.max(0, row.attempt_count - 1)) : 0;
    const condition = leaseToken ? "status='RUNNING' AND lease_token=? AND lease_until>?" : "status='QUEUED'";
    const params = leaseToken ? [leaseToken, time] : [];
    return db.prepare(`UPDATE generations SET status=?,error=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND ${condition}`)
      .run(status, String(message).slice(0, 300), next, time, id, ...params).changes === 1;
  }
  function recoverRunning() {
    // Leases belong to workers, not processes. A new process must wait for expiry.
  }
  function touchWorker(workerId) {
    if (typeof workerId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(workerId)) throw new Error("Invalid worker ID");
    db.prepare("INSERT INTO worker_heartbeats(worker_id,touched_at) VALUES(?,?) ON CONFLICT(worker_id) DO UPDATE SET touched_at=excluded.touched_at")
      .run(workerId, now());
  }
  function workerHealthy(maxAgeMs = 45_000) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error("Invalid worker heartbeat age");
    return Boolean(db.prepare("SELECT 1 FROM worker_heartbeats WHERE touched_at>=? LIMIT 1").get(now() - maxAgeMs));
  }
  return { enqueue, getTask, cancel, leaseNext, heartbeat, isCancelRequested, getLeasedTask, acknowledgeCancel,
    storeOutput, existingOutput, complete, fail, recoverRunning,
    touchWorker, workerHealthy };
}
