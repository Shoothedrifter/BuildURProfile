import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imageSize } from "image-size";
import { ServiceError } from "../../../contracts/src/validation.mjs";

const DAY = 24 * 60 * 60 * 1000;
const MAX_IMAGE = 10 * 1024 * 1024;
const MIMES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

function readPrivateImage(path, unavailable) {
  try { return readFileSync(/*turbopackIgnore: true*/ path); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new ServiceError(404, unavailable);
  }
}

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
    for (const path of [join(assetRoot, id), join(assetRoot, `${id}.webp`)]) {
      try { unlinkSync(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  async function store(sessionId, kind, bytes, mime) {
    const id = randomUUID(), path = join(assetRoot, id);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    try {
      await db.prepare("INSERT INTO avatar_assets VALUES(?,?,?,?,?,?,?)").run(id, sessionId, kind, mime, path, now(), now() + (kind === "portrait" ? DAY : 7 * DAY));
    } catch (error) {
      deleteFile(id);
      throw error;
    }
    return { id, mime };
  }
  async function savePortrait(sessionId, dataUrl) {
    // 门控拆分：上传照片只进入私有资产区，生产同样可用；是否发送给图像生成供应商由队列的 allowPortraits 决定。
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl ?? "");
    if (!match || match[2].length > MAX_IMAGE * 4 / 3 + 8) throw new ServiceError(400, "请选择 PNG、JPEG 或 WebP 照片（最大 10 MiB）。");
    const bytes = Buffer.from(match[2], "base64");
    const mime = validateImage(bytes, match[1], minPixels);
    return await store(sessionId, "portrait", bytes, mime);
  }
  async function readAsset(sessionId, id, kind = "hero") {
    const row = await db.prepare("SELECT * FROM avatar_assets WHERE id=? AND owner_session_id=? AND kind=? AND expires_at>?").get(id, sessionId, kind, now());
    if (!row) throw new ServiceError(404, "图片不存在或无权访问。");
    const compactPath = join(assetRoot, `${id}.webp`);
    if (kind === "hero" && existsSync(compactPath)) {
      return { bytes: readPrivateImage(compactPath, "图片不存在或无权访问。"), mime: "image/webp", kind };
    }
    return { bytes: readPrivateImage(row.path, "图片不存在或无权访问。"), mime: row.mime, kind: row.kind };
  }
  async function readArtworkAsset(sessionId, id) {
    const row = await db.prepare("SELECT kind FROM avatar_assets WHERE id=? AND owner_session_id=? AND kind IN ('hero','hero_cutout') AND expires_at>?").get(id, sessionId, now());
    if (!row) throw new ServiceError(404, "图片不存在或无权访问。");
    return await readAsset(sessionId, id, row.kind);
  }
  async function readAssetForWorker(id) {
    const row = await db.prepare("SELECT * FROM avatar_assets WHERE id=? AND kind='portrait' AND expires_at>?").get(id, now());
    if (!row) throw new ServiceError(404, "源照片已过期或不存在。");
    return { bytes: readPrivateImage(row.path, "源照片已过期或不存在。"), mime: row.mime };
  }
  async function outputExists(id) {
    const row = await db.prepare("SELECT path FROM avatar_assets WHERE id=? AND kind='hero' AND expires_at>?").get(id, now());
    return Boolean(row && (existsSync(row.path) || existsSync(join(assetRoot, `${id}.webp`))));
  }
  async function cutoutExists(id) {
    return Boolean(await db.prepare("SELECT 1 FROM avatar_assets WHERE id=? AND kind='hero_cutout' AND expires_at>?").get(id, now()));
  }
  async function purgeExpired() {
    const rows = await db.prepare("SELECT id,path FROM avatar_assets WHERE expires_at<=? AND path<>''").all(now());
    for (const row of rows) {
      deleteFile(row.id);
      await db.prepare("UPDATE avatar_assets SET path='' WHERE id=?").run(row.id);
    }
    return rows.length;
  }
  return { store, savePortrait, readAsset, readArtworkAsset, readAssetForWorker, outputExists, cutoutExists, purgeExpired, deleteFile };
}
