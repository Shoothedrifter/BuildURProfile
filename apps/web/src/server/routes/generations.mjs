import { ServiceError } from "../service.mjs";
import { listAvatarStyles } from "../../../../../packages/skills/src/avatar-catalog.ts";

/** Session and CSRF checks are completed by the HTTP shell before this router runs. */
export async function handleGenerationRoutes({ req, res, url, parts, sessionId, service, portraitEnabled,
  bodyJson, sendJson }) {
  if (req.method === "GET" && url.pathname === "/api/avatar-styles") {
    sendJson(res, 200, { styles: portraitEnabled ? listAvatarStyles() : [] }); return true;
  }
  if (req.method === "POST" && url.pathname === "/api/portraits") {
    sendJson(res, 201, await service.savePortrait(sessionId, (await bodyJson(req, 14 * 1024 * 1024)).dataUrl)); return true;
  }
  // 暖调马卡龙直出照片的预览 URL：会话隔离、限时、仅本人可读。
  if (req.method === "GET" && parts[1] === "portraits" && parts.length === 3) {
    const asset = await service.readAsset(sessionId, parts[2], "portrait");
    res.writeHead(200, { "content-type": asset.mime, "content-length": asset.bytes.length,
      "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
    res.end(asset.bytes); return true;
  }
  if (req.method === "POST" && url.pathname === "/api/generations") {
    // Legacy portrait regeneration may contain already embedded editor images.
    // New briefs are independently capped at 256 KiB by cleanGenerationBrief.
    const input = await bodyJson(req, 9 * 1024 * 1024);
    if (!input?.resumeId && !input?.brief && !(input?.portraitAssetId && input?.config)) {
      throw new ServiceError(400, "请先确认简历内容并完成测评。未上传照片时不能提交旧版配置。");
    }
    if (input.portraitAssetId && !portraitEnabled) throw new ServiceError(403, "当前环境未启用肖像生成。");
    if (!input.resumeId && ["resume-v2","resume-v3"].includes(input.brief?.content?.resume?.version)) throw new ServiceError(400,"请使用已保存草稿生成作品。");
    sendJson(res, 201, input.resumeId ? await service.enqueueResume(sessionId, input) : await service.enqueue(sessionId, input)); return true;
  }
  if (req.method === "GET" && parts[1] === "generations" && parts.length === 3) {
    sendJson(res, 200, await service.getTask(sessionId, parts[2])); return true;
  }
  if (req.method === "POST" && parts[1] === "generations" && parts[3] === "cancel" && parts.length === 4) {
    sendJson(res, 200, await service.cancel(sessionId, parts[2])); return true;
  }
  if (req.method === "GET" && parts[1] === "showcase-media" && parts.length === 3) {
    const asset=await service.readShowcaseMedia(sessionId,parts[2]);
    res.writeHead(200,{"content-type":asset.mime,"content-length":asset.bytes.length,"cache-control":"no-store","x-content-type-options":"nosniff"}); res.end(asset.bytes); return true;
  }
  if (req.method === "GET" && parts[1] === "hero-assets" && parts.length === 3) {
    const asset = await service.readArtworkAsset(sessionId, parts[2]);
    res.writeHead(200, { "content-type": asset.mime, "content-length": asset.bytes.length,
      "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
    res.end(asset.bytes); return true;
  }
  return false;
}
