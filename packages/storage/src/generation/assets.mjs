import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imageSize } from "image-size";
import { ServiceError } from "../../../contracts/src/validation.mjs";

const DAY = 24 * 60 * 60 * 1000;
const MAX_IMAGE = 10 * 1024 * 1024;
const MIMES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function validateImage(bytes, declaredMime, minPixels) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 40 || bytes.length > MAX_IMAGE) throw new ServiceError(400, "照片大小或内容无效（最大 10 MiB）。");
  let info;
  try { info = imageSize(bytes); } catch { throw new ServiceError(400, "图片格式无效。"); }
  const mime = MIMES[info.type];
  if (!mime || mime !== declaredMime || info.width < minPixels || info.height < minPixels || info.width > 8000 || info.height > 8000) {
    throw new ServiceError(400, `请上传 ${minPixels}–8000 像素的 PNG、JPEG 或 WebP 单人照片。`);
  }
  return mime;
}

export function createAssetStore({ db, assetRoot, minPixels, now, allowPortraits }) {
  mkdirSync(assetRoot, { recursive: true, mode: 0o700 });
  chmodSync(assetRoot, 0o700);
  function deleteFile(id) {
    try { unlinkSync(join(assetRoot, id)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  function store(sessionId, kind, bytes, mime) {
    const id = randomUUID(), path = join(assetRoot, id);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    try {
      db.prepare("INSERT INTO avatar_assets VALUES(?,?,?,?,?,?,?)").run(id, sessionId, kind, mime, path, now(), now() + (kind === "portrait" ? DAY : 7 * DAY));
    } catch (error) {
      deleteFile(id);
      throw error;
    }
    return { id, mime };
  }
  function savePortrait(sessionId, dataUrl) {
    if (!allowPortraits) throw new ServiceError(403, "当前环境未启用肖像生成。");
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl ?? "");
    if (!match || match[2].length > MAX_IMAGE * 4 / 3 + 8) throw new ServiceError(400, "请选择 PNG、JPEG 或 WebP 照片（最大 10 MiB）。");
    const bytes = Buffer.from(match[2], "base64");
    const mime = validateImage(bytes, match[1], minPixels);
    return store(sessionId, "portrait", bytes, mime);
  }
  function readAsset(sessionId, id, kind = "hero") {
    const row = db.prepare("SELECT * FROM avatar_assets WHERE id=? AND owner_session_id=? AND kind=? AND expires_at>?").get(id, sessionId, kind, now());
    if (!row) throw new ServiceError(404, "图片不存在或无权访问。");
    return { bytes: readFileSync(/*turbopackIgnore: true*/ row.path), mime: row.mime, kind: row.kind };
  }
  function readAssetForWorker(id) {
    const row = db.prepare("SELECT * FROM avatar_assets WHERE id=? AND kind='portrait' AND expires_at>?").get(id, now());
    if (!row) throw new ServiceError(404, "源照片已过期或不存在。");
    return { bytes: readFileSync(/*turbopackIgnore: true*/ row.path), mime: row.mime };
  }
  function outputExists(id) {
    return Boolean(db.prepare("SELECT 1 FROM avatar_assets WHERE id=? AND kind='hero' AND expires_at>?").get(id, now()));
  }
  function purgeExpired() {
    const rows = db.prepare("SELECT id,path FROM avatar_assets WHERE expires_at<=? AND path<>''").all(now());
    for (const row of rows) {
      deleteFile(row.id);
      db.prepare("UPDATE avatar_assets SET path='' WHERE id=?").run(row.id);
    }
    return rows.length;
  }
  return { store, savePortrait, readAsset, readAssetForWorker, outputExists, purgeExpired, deleteFile };
}
