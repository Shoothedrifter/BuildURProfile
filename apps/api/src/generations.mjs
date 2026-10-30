import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imageSize } from "image-size";
import { ServiceError, cleanConfig } from "./service.mjs";
import { listAvatarStyles } from "../../worker/src/styles.mjs";

const DAY = 24 * 60 * 60 * 1000;
const MAX_IMAGE = 5 * 1024 * 1024;
const MIMES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

function validateImage(bytes, declaredMime, minPixels) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 40 || bytes.length > MAX_IMAGE) throw new ServiceError(400, "照片大小或内容无效（最大 5 MiB）。");
  let info;
  try { info = imageSize(bytes); } catch { throw new ServiceError(400, "图片格式无效。"); }
  const mime = MIMES[info.type];
  if (!mime || mime !== declaredMime || info.width < minPixels || info.height < minPixels || info.width > 8000 || info.height > 8000) {
    throw new ServiceError(400, `请上传 ${minPixels}–8000 像素的 PNG、JPEG 或 WebP 单人照片。`);
  }
  return mime;
}

export function createGenerationService({ db, assetRoot = "data/avatar-assets", minPixels = 256, now = () => Date.now() }) {
  mkdirSync(assetRoot, { recursive: true, mode: 0o700 });
  chmodSync(assetRoot, 0o700);
  function store(sessionId, kind, bytes, mime) {
    const id = randomUUID(), path = join(assetRoot, id);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    try {
      db.prepare("INSERT INTO avatar_assets VALUES(?,?,?,?,?,?,?)").run(id, sessionId, kind, mime, path, now(), now() + (kind === "portrait" ? DAY : 7 * DAY));
    } catch (error) {
      unlinkSync(path);
      throw error;
    }
    return { id, mime };
  }
  function savePortrait(sessionId, dataUrl) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl ?? "");
    if (!match || match[2].length > MAX_IMAGE * 4 / 3 + 8) throw new ServiceError(400, "请选择 PNG、JPEG 或 WebP 照片（最大 5 MiB）。");
    const bytes = Buffer.from(match[2], "base64");
    const mime = validateImage(bytes, match[1], minPixels);
    return store(sessionId, "portrait", bytes, mime);
  }
  function readAsset(sessionId, id, kind = "hero") {
    const row = db.prepare("SELECT * FROM avatar_assets WHERE id=? AND owner_session_id=? AND kind=? AND expires_at>?").get(id, sessionId, kind, now());
    if (!row) throw new ServiceError(404, "图片不存在或无权访问。");
    return { bytes: readFileSync(row.path), mime: row.mime, kind: row.kind };
  }
  function readAssetForWorker(id) {
    const row = db.prepare("SELECT * FROM avatar_assets WHERE id=? AND kind='portrait' AND expires_at>?").get(id, now());
    if (!row) throw new ServiceError(404, "源照片已过期或不存在。");
    return { bytes: readFileSync(row.path), mime: row.mime };
  }
  function enqueue(sessionId, { portraitAssetId = null, styleId = null, idempotencyKey, config = null }) {
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey)) throw new ServiceError(400, "生成请求标识无效。");
    if (portraitAssetId) {
      if (!listAvatarStyles().some((style) => style.id === styleId)) throw new ServiceError(400, "未知肖像风格。");
      const asset = db.prepare("SELECT id FROM avatar_assets WHERE id=? AND owner_session_id=? AND kind='portrait' AND expires_at>?").get(portraitAssetId, sessionId, now());
      if (!asset) throw new ServiceError(404, "照片不存在或无权访问。");
    } else if (styleId) throw new ServiceError(400, "未上传照片时不能选择生图风格。");
    const safeConfig = config ? cleanConfig(config) : null;
    const existing = db.prepare("SELECT * FROM generations WHERE owner_session_id=? AND idempotency_key=?").get(sessionId, idempotencyKey);
    if (existing) {
      if (existing.portrait_asset_id !== portraitAssetId || existing.style_id !== styleId || existing.config_json !== safeConfig) throw new ServiceError(409, "生成请求标识已用于其他内容。");
      return publicTask(existing);
    }
    if (portraitAssetId) {
      const attempts = db.prepare("SELECT COUNT(*) AS count FROM generations WHERE owner_session_id=? AND portrait_asset_id IS NOT NULL AND created_at>?").get(sessionId, now() - DAY).count;
      if (attempts >= 5) throw new ServiceError(429, "本机肖像生成次数已达每日上限（5 次）。");
    }
    const id = randomUUID(), time = now();
    db.prepare("INSERT INTO generations(id,owner_session_id,portrait_asset_id,style_id,config_json,idempotency_key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'QUEUED',?,?)")
      .run(id, sessionId, portraitAssetId, styleId, safeConfig, idempotencyKey, time, time);
    return getTask(sessionId, id);
  }
  function publicTask(row) {
    const expired = row.status === "SUCCEEDED" && row.output_asset_id && !outputExists(row.output_asset_id);
    return { id: row.id, status: expired ? "EXPIRED" : row.status, styleId: row.style_id,
      error: expired ? "成图已过期，请重新上传照片生成。" : row.error,
      ...(row.status === "SUCCEEDED" && !expired && row.config_json ? { config: JSON.parse(row.config_json) } : {}),
      ...(row.output_asset_id && !expired ? { heroArtwork: { assetUrl: `/api/hero-assets/${row.output_asset_id}`, styleId: row.style_id,
        alt: "根据本人肖像生成的动画风格虚拟形象" } } : {}) };
  }
  function getTask(sessionId, id) {
    const row = db.prepare("SELECT * FROM generations WHERE id=? AND owner_session_id=?").get(id, sessionId);
    if (!row) throw new ServiceError(404, "生成任务不存在或无权访问。");
    return publicTask(row);
  }
  function leaseNext() {
    const row = db.prepare("SELECT * FROM generations WHERE status='QUEUED' OR (status='RUNNING' AND lease_until<?) ORDER BY created_at LIMIT 1").get(now());
    if (!row) return null;
    const result = db.prepare("UPDATE generations SET status='RUNNING',lease_until=?,updated_at=? WHERE id=? AND (status='QUEUED' OR lease_until<?)")
      .run(now() + 10 * 60 * 1000, now(), row.id, now());
    return result.changes ? row : null;
  }
  function storeOutput(id, image) {
    const row = db.prepare("SELECT * FROM generations WHERE id=?").get(id);
    if (!row) throw new Error("Generation missing");
    if (row.output_asset_id) return row.output_asset_id;
    if (!row.portrait_asset_id) throw new Error("No portrait on generation");
    const mime = validateImage(image.bytes, image.mime, minPixels);
    const output = store(row.owner_session_id, "hero", image.bytes, mime).id;
    db.prepare("UPDATE generations SET output_asset_id=?,updated_at=? WHERE id=? AND output_asset_id IS NULL").run(output, now(), id);
    return db.prepare("SELECT output_asset_id FROM generations WHERE id=?").get(id).output_asset_id;
  }
  function outputExists(id) {
    return Boolean(db.prepare("SELECT 1 FROM avatar_assets WHERE id=? AND kind='hero' AND expires_at>?").get(id, now()));
  }
  function existingOutput(taskId) {
    return db.prepare("SELECT output_asset_id FROM generations WHERE id=?").get(taskId)?.output_asset_id ?? null;
  }
  function complete(id) {
    db.prepare("UPDATE generations SET status='SUCCEEDED',error=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now(), id);
  }
  function fail(id, message) {
    db.prepare("UPDATE generations SET status='FAILED',error=?,lease_until=NULL,updated_at=? WHERE id=?")
      .run(String(message).slice(0, 300), now(), id);
  }
  function purgeExpired() {
    const rows = db.prepare("SELECT id,path FROM avatar_assets WHERE expires_at<=? AND path<>''").all(now());
    for (const row of rows) {
      try { unlinkSync(row.path); } catch (error) { if (error.code !== "ENOENT") throw error; }
      db.prepare("UPDATE avatar_assets SET path='' WHERE id=?").run(row.id);
    }
    return rows.length;
  }
  function recoverRunning() {
    db.prepare("UPDATE generations SET lease_until=0 WHERE status='RUNNING'").run();
  }
  return { savePortrait, readAsset, readAssetForWorker, enqueue, getTask, leaseNext, storeOutput, outputExists, existingOutput, complete, fail, purgeExpired, recoverRunning };
}
