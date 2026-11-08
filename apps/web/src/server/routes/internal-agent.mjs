import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { ServiceError } from "../service.mjs";
import { loadStyleRecipe } from "../../../../../packages/skills/src/wibi.ts";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const RETRYABLE_CODES = new Set(["PROVIDER_RATE_LIMIT", "PROVIDER_UNAVAILABLE"]);
const ERROR_MESSAGES = {
  PROVIDER_RATE_LIMIT: "图像服务暂时繁忙，系统会在限定次数内重试。",
  PROVIDER_UNAVAILABLE: "图像服务暂时不可用，系统会在限定次数内重试。",
  PROVIDER_AUTH: "图像服务认证失败，请检查 Agent 的 Cloudflare Account ID 和 API Token。",
  PROVIDER_TIMEOUT: "图像生成超时。请检查任务状态后再尝试。",
  PROVIDER_REJECTED: "图像服务未能处理这张照片，请更换照片或风格。",
  STYLE_UNAVAILABLE: "所选风格资源暂不可用。",
  SKILL_VERSION_MISMATCH: "生成规则已更新，请重新提交作品。",
  INVALID_BRIEF: "已确认的展示内容无效，请重新提交作品。",
  CANCELLED: "生成任务已取消。",
  UNKNOWN: "作品生成失败，请重试。"
};

function fixedTimeEqual(left, right) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function requireAgentToken(req, token) {
  const header = req.headers.authorization;
  const supplied = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !fixedTimeEqual(supplied, token)) throw new ServiceError(403, "内部服务认证失败。");
}

function requireLease(service, id, leaseToken) {
  if (typeof leaseToken !== "string" || !/^[0-9a-f-]{36}$/i.test(leaseToken)) {
    throw new ServiceError(409, "任务租约无效。");
  }
  const row = service.getLeasedTask(id, leaseToken);
  if (!row) throw new ServiceError(409, "任务租约已过期或不存在。");
  return row;
}

async function readBinary(req, limit = MAX_IMAGE_BYTES) {
  if (req._webBinaryBuffer) {
    if (req._webBinaryBuffer.length > limit) throw new ServiceError(413, "图片内容过大。");
    return req._webBinaryBuffer;
  }
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new ServiceError(413, "图片内容过大。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendBytes(res, bytes, contentType) {
  res.writeHead(200, { "content-type": contentType, "content-length": bytes.length,
    "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  res.end(bytes);
}

export function validateAgentToken(token) {
  if (token == null || token === "") return null;
  if (typeof token !== "string" || token.length < 32 || token.length > 512 || /\s/.test(token)) {
    throw new Error("AGENT_SERVICE_TOKEN must be a private 32–512 character token without whitespace.");
  }
  return token;
}

/** The Node service remains the sole owner of task, session, asset and payment storage. */
export async function handleInternalAgentRoutes({ req, res, parts, service, agentToken, portraitEnabled,
  bodyJson, sendJson, styleLoader = loadStyleRecipe }) {
  requireAgentToken(req, agentToken);
  if (req.method === "POST" && parts.length === 3 && parts[2] === "lease") {
    const input = await bodyJson(req, 4096);
    if (typeof input?.workerId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(input.workerId)) {
      throw new ServiceError(400, "worker ID 无效。");
    }
    let task = service.leaseNext();
    for (let skipped = 0; task && task.workflow_version !== "python-agent-v2" && skipped < 20; skipped++) {
      service.fail(task.id, "生成规则已更新，请重新提交作品。", { leaseToken: task.lease_token, retryable: false });
      task = service.leaseNext();
    }
    if (task && task.workflow_version !== "python-agent-v2") {
      service.fail(task.id, "生成规则已更新，请重新提交作品。", { leaseToken: task.lease_token, retryable: false });
      task = null;
    }
    if (!task) { res.writeHead(204, { "cache-control": "no-store" }); res.end(); return true; }
    sendJson(res, 200, { id: task.id, leaseToken: task.lease_token,
      workflowVersion: task.workflow_version, brief: task.brief_json ? JSON.parse(task.brief_json) : null,
      config: task.config_json ? JSON.parse(task.config_json) : null,
      portraitAssetId: task.portrait_asset_id, styleId: task.style_id, outputAssetId: task.output_asset_id });
    return true;
  }
  if (req.method === "POST" && parts.length === 3 && parts[2] === "heartbeat") {
    const input = await bodyJson(req, 4096);
    if (typeof input?.workerId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(input.workerId)) {
      throw new ServiceError(400, "worker ID 无效。");
    }
    service.touchWorker(input.workerId);
    sendJson(res, 200, { ok: true }); return true;
  }
  if (parts[2] !== "tasks" || parts.length !== 5) return false;
  const id = parts[3], action = parts[4];
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ServiceError(404, "任务不存在。");
  if (req.method === "POST" && action === "heartbeat") {
    const input = await bodyJson(req, 4096);
    const row = requireLease(service, id, input?.leaseToken);
    const ok = service.heartbeat(id, input.leaseToken);
    sendJson(res, 200, { ok, cancelRequested: Boolean(row.cancel_requested_at) || service.isCancelRequested(id, input.leaseToken) });
    return true;
  }
  if (req.method === "POST" && action === "ack-cancel") {
    const input = await bodyJson(req, 4096);
    requireLease(service, id, input?.leaseToken);
    const ok = service.acknowledgeCancel(id, input.leaseToken);
    sendJson(res, ok ? 200 : 409, { ok }); return true;
  }
  if (req.method === "GET" && action === "portrait") {
    const row = requireLease(service, id, req.headers["x-agent-lease"]);
    if (!portraitEnabled || !row.portrait_asset_id || service.isCancelRequested(id, req.headers["x-agent-lease"])) {
      throw new ServiceError(409, "当前任务没有可读取的肖像。");
    }
    const asset = service.readAssetForWorker(row.portrait_asset_id);
    sendBytes(res, asset.bytes, asset.mime); return true;
  }
  if (req.method === "GET" && action === "recipe") {
    const row = requireLease(service, id, req.headers["x-agent-lease"]);
    if (!portraitEnabled || !row.style_id || service.isCancelRequested(id, req.headers["x-agent-lease"])) {
      throw new ServiceError(409, "当前任务没有可用的肖像风格。");
    }
    const recipe = styleLoader(row.style_id);
    const referenceImages = recipe.referencePaths.map((path) => ({ mime: IMAGE_MIME[extname(path).toLowerCase()],
      dataBase64: readFileSync(/*turbopackIgnore: true*/ path).toString("base64") }));
    if (referenceImages.some(({ mime }) => !mime)) throw new Error("Unsupported pinned style reference format");
    sendJson(res, 200, { id: recipe.id, version: recipe.version, license: recipe.license,
      sourceCommit: recipe.sourceCommit, manifestVersion: recipe.manifestVersion, attribution: recipe.attribution,
      instructions: recipe.instructions, localSummary: recipe.localSummary, referenceImages });
    return true;
  }
  if (req.method === "GET" && action === "output") {
    const leaseToken = req.headers["x-agent-lease"];
    const row = requireLease(service, id, leaseToken);
    if (service.isCancelRequested(id, leaseToken)) throw new ServiceError(409, "任务已取消。");
    sendJson(res, 200, { assetId: row.output_asset_id ?? null,
      exists: Boolean(row.output_asset_id && service.outputExists(row.output_asset_id)) });
    return true;
  }
  if (req.method === "POST" && action === "output") {
    const leaseToken = req.headers["x-agent-lease"];
    requireLease(service, id, leaseToken);
    if (!portraitEnabled || service.isCancelRequested(id, leaseToken)) throw new ServiceError(409, "任务已取消或肖像功能未启用。");
    const contentType = req.headers["content-type"];
    if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
      throw new ServiceError(415, "成图格式无效。");
    }
    const bytes = await readBinary(req);
    const assetId = service.storeOutput(id, { bytes, mime: contentType }, leaseToken);
    sendJson(res, 200, { assetId }); return true;
  }
  if (req.method === "POST" && action === "complete") {
    const input = await bodyJson(req, 9 * 1024 * 1024);
    const row = requireLease(service, id, input?.leaseToken);
    if (row.brief_json && !input.config) throw new ServiceError(400, "图未返回作品配置。");
    if (service.isCancelRequested(id, input.leaseToken)) throw new ServiceError(409, "任务已取消。");
    if (row.portrait_asset_id && (!row.output_asset_id || !service.outputExists(row.output_asset_id))) {
      throw new ServiceError(409, "肖像成图尚未通过资产校验。");
    }
    const ok = service.complete(id, { config: input.config, leaseToken: input.leaseToken });
    sendJson(res, ok ? 200 : 409, { ok }); return true;
  }
  if (req.method === "POST" && action === "fail") {
    const input = await bodyJson(req, 4096);
    requireLease(service, id, input?.leaseToken);
    const code = typeof input.errorCode === "string" && Object.hasOwn(ERROR_MESSAGES, input.errorCode)
      ? input.errorCode : "UNKNOWN";
    const retryable = input.retryable === true && RETRYABLE_CODES.has(code);
    const ok = service.fail(id, ERROR_MESSAGES[code], { leaseToken: input.leaseToken, retryable });
    sendJson(res, ok ? 200 : 409, { ok }); return true;
  }
  return false;
}
