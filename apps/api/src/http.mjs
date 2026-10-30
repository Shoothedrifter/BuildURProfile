import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ServiceError } from "./service.mjs";
import { buildStaticZip } from "./export.mjs";
import { listAvatarStyles } from "../../worker/src/styles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const COOKIE = "burp_session";
const SESSION_TTL = 365 * 24 * 60 * 60 * 1000;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

export function loadSessionSecret(path = join(root, "data/session-secret")) {
  mkdirSync(join(root, "data"), { recursive: true, mode: 0o700 });
  chmodSync(join(root, "data"), 0o700);
  if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  return readFileSync(path);
}

function signature(secret, text) { return createHmac("sha256", secret).update(text).digest("base64url"); }
function safeEqual(left, right) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(data));
}
async function readBody(req, limit = 9 * 1024 * 1024) {
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new ServiceError(413, "请求内容过大。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function bodyJson(req, limit) {
  const raw = await readBody(req, limit);
  try { return JSON.parse(raw); } catch { throw new ServiceError(400, "请求 JSON 无效。"); }
}
function sessionFromCookie(req, db, secret) {
  const raw = req.headers.cookie?.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const [id, sig] = raw?.split(".") ?? [];
  if (!id || !sig || !safeEqual(signature(secret, id), sig)) return null;
  const row = db.prepare("SELECT id FROM sessions WHERE id=? AND expires_at>?").get(id, Date.now());
  return row?.id ?? null;
}
function requireSession(req, db, secret) {
  const id = sessionFromCookie(req, db, secret);
  if (!id) throw new ServiceError(401, "请先建立匿名会话。");
  return id;
}
function requireCsrf(req, secret, sessionId) {
  if (!safeEqual(req.headers["x-csrf-token"] ?? "", signature(secret, `csrf:${sessionId}`))) {
    throw new ServiceError(403, "请求验证失败，请刷新页面。");
  }
}
function parseRoute(path) { return path.split("/").filter(Boolean); }

export function createPaymentHttpServer({ db, service, generationService = null, paymentConfig, priceFen, configurationError = null,
  secret = loadSessionSecret(), staticDir = join(root, "apps/web/dist"), zipBuilder = buildStaticZip }) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost"), parts = parseRoute(url.pathname);
      if (req.method === "POST" && url.pathname === "/api/payment/notify") {
        const raw = await readBody(req, 64 * 1024), params = Object.fromEntries(new URLSearchParams(raw));
        await service.notify(params);
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end("success");
        return;
      }
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "shares" && parts.length === 3) {
        sendJson(res, 200, service.readShare(parts[2])); return;
      }
      if (req.method === "GET" && url.pathname === "/api/session") {
        let id = sessionFromCookie(req, db, secret);
        if (!id) {
          id = randomBytes(32).toString("base64url");
          db.prepare("INSERT INTO sessions(id,created_at,expires_at) VALUES(?,?,?)").run(id, Date.now(), Date.now() + SESSION_TTL);
          const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
          res.setHeader("set-cookie", `${COOKIE}=${id}.${signature(secret, id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure ? "; Secure" : ""}`);
        }
        sendJson(res, 200, { csrfToken: signature(secret, `csrf:${id}`) }); return;
      }
      if (req.method === "GET" && url.pathname === "/api/offer") {
        sendJson(res, 200, { configured: Boolean(paymentConfig), mode: paymentConfig?.mode ?? null,
          configurationError, priceFen: priceFen ?? null,
          priceYuan: priceFen ? (priceFen / 100).toFixed(2) : null,
          service: "作品正式托管分享与静态网站导出，一次解锁同一项目两项能力",
          shareDays: 7 }); return;
      }
      if (parts[0] === "api") {
        const sessionId = requireSession(req, db, secret);
        if (!["GET", "HEAD"].includes(req.method)) requireCsrf(req, secret, sessionId);
        if (generationService && req.method === "GET" && url.pathname === "/api/avatar-styles") {
          sendJson(res, 200, { styles: listAvatarStyles() }); return;
        }
        if (generationService && req.method === "POST" && url.pathname === "/api/portraits") {
          sendJson(res, 201, generationService.savePortrait(sessionId, (await bodyJson(req, 14 * 1024 * 1024)).dataUrl)); return;
        }
        if (generationService && req.method === "POST" && url.pathname === "/api/generations") {
          sendJson(res, 201, generationService.enqueue(sessionId, await bodyJson(req))); return;
        }
        if (generationService && req.method === "GET" && parts[1] === "generations" && parts.length === 3) {
          sendJson(res, 200, generationService.getTask(sessionId, parts[2])); return;
        }
        if (generationService && req.method === "GET" && parts[1] === "hero-assets" && parts.length === 3) {
          const asset = generationService.readAsset(sessionId, parts[2]);
          res.writeHead(200, { "content-type": asset.mime, "content-length": asset.bytes.length,
            "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
          res.end(asset.bytes); return;
        }
        if (req.method === "GET" && url.pathname === "/api/projects") { sendJson(res, 200, service.listProjects(sessionId)); return; }
        if (req.method === "POST" && url.pathname === "/api/projects") {
          sendJson(res, 201, service.createProject(sessionId, (await bodyJson(req)).config)); return;
        }
        if (parts[1] === "projects" && parts[2]) {
          const id = parts[2];
          if (parts.length === 3 && req.method === "GET") { sendJson(res, 200, service.getProject(sessionId, id)); return; }
          if (parts.length === 3 && req.method === "PUT") {
            sendJson(res, 200, service.updateProject(sessionId, id, (await bodyJson(req)).config)); return;
          }
          if (parts[3] === "checkout" && req.method === "POST") {
            sendJson(res, 200, await service.checkout(sessionId, id, (await bodyJson(req)).action)); return;
          }
          if (parts[3] === "reconcile" && req.method === "POST") {
            sendJson(res, 200, await service.reconcile(sessionId, id)); return;
          }
          if (parts[3] === "publish" && req.method === "POST") {
            const share = service.publish(sessionId, id);
            sendJson(res, 200, { ...share, url: `${paymentConfig?.publicBaseUrl ?? ""}/#share=${share.token}` }); return;
          }
          if (parts[3] === "shares" && parts.length === 4 && req.method === "GET") {
            sendJson(res, 200, service.listShares(sessionId, id)); return;
          }
          if (parts[3] === "shares" && parts[4] && req.method === "DELETE") {
            service.revokeShare(sessionId, id, parts[4]); sendJson(res, 200, { ok: true }); return;
          }
          if (parts[3] === "export" && req.method === "POST") {
            const download = service.issueDownload(sessionId, id);
            sendJson(res, 200, { ...download, url: `/api/downloads/${download.token}` }); return;
          }
          if (parts[3] === "orders" && req.method === "GET") {
            sendJson(res, 200, service.orderHistory(sessionId, id)); return;
          }
        }
        if (parts[1] === "downloads" && parts[2] && req.method === "GET") {
          const download = service.getDownload(sessionId, parts[2]);
          let zip;
          try { zip = zipBuilder(download.config); }
          catch (error) {
            try { service.markDeliveryFailure(download.projectId, "export"); } catch { /* Keep packaging error. */ }
            throw error;
          }
          res.writeHead(200, { "content-type": "application/zip", "content-disposition": "attachment; filename=buildurprofile-site.zip",
            "content-length": zip.length, "cache-control": "no-store", "x-content-type-options": "nosniff" });
          res.end(zip, () => {
            try { service.markDownload(download.projectId, parts[2]); }
            catch { /* The paid owner can retry if delivery status could not be saved. */ }
          }); return;
        }
        throw new ServiceError(404, "接口不存在。");
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw new ServiceError(404, "页面不存在。");
      const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
      const candidate = join(staticDir, relative);
      const file = candidate.startsWith(staticDir + "/") && existsSync(candidate) && extname(candidate)
        ? candidate : join(staticDir, "index.html");
      if (!existsSync(file)) throw new ServiceError(404, "页面未构建。请先运行 npm run build。");
      res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      if (req.method === "HEAD") res.end(); else res.end(readFileSync(file));
    } catch (error) {
      const isNotify = req.url?.startsWith("/api/payment/notify");
      if (isNotify) { res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }); res.end("fail"); return; }
      const status = error instanceof ServiceError ? error.status : 500;
      sendJson(res, status, { error: status === 500 ? "服务暂时不可用。" : error.message });
    }
  });
}
