import { randomBytes, randomUUID } from "node:crypto";
import { transaction } from "./database.mjs";
import { fenToYuan } from "./config.mjs";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const DOWNLOAD_TTL = 15 * 60 * 1000;
const PAID = new Set(["TRADE_SUCCESS", "TRADE_FINISHED"]);

export class ServiceError extends Error {
  constructor(status, message) { super(message); this.name = "ServiceError"; this.status = status; }
}

function token() { return randomBytes(32).toString("base64url"); }
function notFound() { throw new ServiceError(404, "项目不存在或无权访问。"); }
function requirePaid(db, projectId) {
  const entitlement = db.prepare("SELECT status FROM entitlements WHERE project_id=?").get(projectId);
  if (entitlement?.status !== "ACTIVE") throw new ServiceError(402, "请先完成本项目的支付。");
}
function ownedProject(db, sessionId, projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id=? AND owner_session_id=?").get(projectId, sessionId);
  if (!project) notFound();
  return project;
}
function publicProject(project, db) {
  const entitlement = db.prepare("SELECT status FROM entitlements WHERE project_id=?").get(project.id);
  const pending = db.prepare("SELECT amount_fen FROM orders WHERE project_id=? AND status='PENDING'").get(project.id);
  return { id: project.id, config: JSON.parse(project.config_json), revision: project.revision,
    paid: entitlement?.status === "ACTIVE", pendingAction: project.pending_action,
    pendingAmountFen: pending?.amount_fen ?? null };
}
export function cleanConfig(config) {
  if (config?.heroArtwork) throw new ServiceError(403, "Wibi 肖像仅供本机预览，不能用于付费分享或导出。");
  if (!config || typeof config !== "object" || Array.isArray(config) ||
    !config.styleVector || !config.skin || !config.marquee || !config.stackedCards ||
    !config.content?.profile || !config.content?.expertise || !Array.isArray(config.content?.projects)) {
    throw new ServiceError(400, "Design Config 数据无效。");
  }
  const text = (value) => typeof value === "string" ? value : "";
  const imageText = (value) => typeof value === "string" ? value : "";
  const textList = (value) => {
    if (!Array.isArray(value)) return [];
    if (value.length > 100) throw new ServiceError(413, "项目字段数量超过限制，内容未被截断。");
    return value.map(text);
  };
  if (config.content.projects.length > 100 || (config.marquee.items?.length ?? 0) > 100) {
    throw new ServiceError(413, "项目条目数量超过限制，内容未被截断。");
  }
  const profile = config.content.profile, expertise = config.content.expertise;
  // Explicit allowlist: sourceRefs, PDF extraction data, and client-supplied ownership/payment flags are discarded.
  const clone = {
    styleVector: { E: Number(config.styleVector.E), K: Number(config.styleVector.K),
      P: Number(config.styleVector.P), S: Number(config.styleVector.S), PChoice: text(config.styleVector.PChoice) },
    skin: text(config.skin),
    marquee: { direction: text(config.marquee.direction), speed: Number(config.marquee.speed),
      bindToScroll: Boolean(config.marquee.bindToScroll), rows: Number(config.marquee.rows),
      tileSize: Number(config.marquee.tileSize), pauseOnHover: Boolean(config.marquee.pauseOnHover),
      items: Array.isArray(config.marquee.items) ? config.marquee.items.map((item) =>
        typeof item === "string" ? text(item) : ({ label: text(item?.label), image: imageText(item?.image) })) : [] },
    stackedCards: { scaleStep: Number(config.stackedCards.scaleStep), offsetStep: Number(config.stackedCards.offsetStep),
      stickyTop: Number(config.stackedCards.stickyTop), layout: text(config.stackedCards.layout),
      cardRadius: Number(config.stackedCards.cardRadius), enableTilt: Boolean(config.stackedCards.enableTilt),
      autoPlay: Boolean(config.stackedCards.autoPlay) },
    content: {
      profile: Object.fromEntries(["name", "role", "location", "availability", "intro", "summary", "email"]
        .map((key) => [key, text(profile[key])])),
      expertise: { eyebrow: text(expertise.eyebrow), headline: text(expertise.headline),
        summary: text(expertise.summary), skills: textList(expertise.skills), disciplines: textList(expertise.disciplines) },
      projects: config.content.projects.map((project) => ({
        id: text(project?.id), index: text(project?.index), title: text(project?.title),
        category: text(project?.category), year: text(project?.year), description: text(project?.description),
        tags: textList(project?.tags), visual: text(project?.visual),
        ...(project?.image ? { image: imageText(project.image) } : {}),
        ...(project?.link ? { link: text(project.link) } : {})
      })),
      workExperience: textList(config.content.workExperience),
      campusExperience: textList(config.content.campusExperience), education: textList(config.content.education)
    }
  };
  if (![clone.styleVector.E, clone.styleVector.K, clone.styleVector.P, clone.styleVector.S].every((score) =>
    Number.isFinite(score) && score >= 0 && score <= 1) ||
    !["dark-tech", "light-minimal", "high-saturation"].includes(clone.skin) ||
    !["left", "right"].includes(clone.marquee.direction) ||
    !["center", "offset", "fan"].includes(clone.stackedCards.layout) ||
    !Number.isFinite(clone.marquee.speed) || !Number.isFinite(clone.stackedCards.scaleStep)) {
    throw new ServiceError(400, "Design Config 参数无效。");
  }
  for (const project of clone.content.projects) {
    if (project?.image && !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(project.image)) {
      throw new ServiceError(400, "项目图片需要先在浏览器内嵌入。");
    }
  }
  for (const item of clone.marquee.items ?? []) {
    if (typeof item === "object" && item?.image && !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(item.image)) {
      throw new ServiceError(400, "跑马灯图片需要先在浏览器内嵌入。");
    }
  }
  const json = JSON.stringify(clone);
  if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw new ServiceError(413, "项目内容超过 8 MiB 限制。");
  return json;
}

export function createPaymentService(db, { gateway, paymentConfig, configurationError = null, now = () => Date.now() }) {
  function markDeliveryFailure(projectId, kind) {
    requirePaid(db, projectId);
    db.prepare(`INSERT INTO deliveries(project_id,kind,status,error) VALUES(?,?,'FAILED','DELIVERY_FAILED')
      ON CONFLICT(project_id,kind) DO UPDATE SET
        status=CASE WHEN deliveries.status='DELIVERED' THEN 'DELIVERED' ELSE 'FAILED' END,
        error=CASE WHEN deliveries.status='DELIVERED' THEN NULL ELSE 'DELIVERY_FAILED' END`)
      .run(projectId, kind);
  }
  function getProject(sessionId, projectId) { return publicProject(ownedProject(db, sessionId, projectId), db); }
  function createProject(sessionId, config) {
    const id = randomUUID(), time = now(), json = cleanConfig(config);
    db.prepare("INSERT INTO projects(id,owner_session_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run(id, sessionId, json, time, time);
    return getProject(sessionId, id);
  }
  function updateProject(sessionId, projectId, config) {
    const existing = ownedProject(db, sessionId, projectId);
    const json = cleanConfig(config);
    if (existing.config_json === json) return getProject(sessionId, projectId);
    db.prepare("UPDATE projects SET config_json=?,revision=revision+1,updated_at=? WHERE id=?")
      .run(json, now(), projectId);
    return getProject(sessionId, projectId);
  }
  function listProjects(sessionId) {
    return db.prepare("SELECT * FROM projects WHERE owner_session_id=? ORDER BY updated_at DESC").all(sessionId)
      .map((project) => publicProject(project, db));
  }
  async function checkout(sessionId, projectId, action) {
    if (action !== "share" && action !== "export") throw new ServiceError(400, "未知交付类型。");
    const project = ownedProject(db, sessionId, projectId);
    if (db.prepare("SELECT 1 FROM entitlements WHERE project_id=? AND status='ACTIVE'").get(projectId)) {
      db.prepare("UPDATE projects SET pending_action=? WHERE id=?").run(action, projectId);
      return { alreadyPaid: true, project: getProject(sessionId, projectId) };
    }
    if (!paymentConfig || !gateway) throw new ServiceError(503, configurationError ?? "支付配置不完整，请配置沙箱商户参数与价格。");
    const order = transaction(db, () => {
      db.prepare("UPDATE projects SET pending_action=? WHERE id=?").run(action, projectId);
      const pending = db.prepare("SELECT * FROM orders WHERE project_id=? AND status='PENDING'").get(projectId);
      if (pending) {
        if ((pending.payment_env && pending.payment_env !== paymentConfig.mode) ||
          (pending.app_id && pending.app_id !== paymentConfig.appId)) {
          throw new ServiceError(409, "待支付订单属于另一支付环境，请联系支持人员核对。");
        }
        return pending;
      }
      const outTradeNo = `BURP${randomBytes(14).toString("hex").toUpperCase()}`;
      db.prepare("INSERT INTO orders(out_trade_no,project_id,amount_fen,status,payment_env,app_id,seller_id,seller_email,created_at,updated_at) VALUES(?,?,?,'PENDING',?,?,?,?,?,?)")
        .run(outTradeNo, projectId, paymentConfig.priceFen, paymentConfig.mode ?? "sandbox", paymentConfig.appId,
          paymentConfig.sellerId, paymentConfig.sellerEmail, now(), now());
      return db.prepare("SELECT * FROM orders WHERE out_trade_no=?").get(outTradeNo);
    });
    try {
      const paymentHtml = await gateway.pagePay(order);
      return { alreadyPaid: false, outTradeNo: order.out_trade_no, paymentHtml,
        amountFen: order.amount_fen, amountYuan: fenToYuan(order.amount_fen) };
    } catch {
      // A form-generation error is not proof of payment; allow a fresh attempt.
      db.prepare("UPDATE orders SET status='ERROR',updated_at=? WHERE out_trade_no=? AND status='PENDING'")
        .run(now(), order.out_trade_no);
      throw new ServiceError(502, "支付宝收银台暂不可用，请稍后重试。");
    }
  }
  function grantOrder(order, tradeNo, tradeStatus) {
    return transaction(db, () => {
      const current = db.prepare("SELECT * FROM orders WHERE out_trade_no=?").get(order.out_trade_no);
      if (!current) throw new ServiceError(404, "订单不存在。");
      if (current.alipay_trade_no && tradeNo && current.alipay_trade_no !== tradeNo) {
        throw new ServiceError(400, "支付宝交易号不一致。");
      }
      db.prepare("UPDATE orders SET status='PAID',alipay_trade_no=COALESCE(alipay_trade_no,?),updated_at=? WHERE out_trade_no=?")
        .run(tradeNo || null, now(), order.out_trade_no);
      db.prepare("INSERT INTO entitlements(project_id,status,granted_by_order,granted_at) VALUES(?,'ACTIVE',?,?) ON CONFLICT(project_id) DO NOTHING")
        .run(order.project_id, order.out_trade_no, now());
      db.prepare("INSERT INTO payment_events(out_trade_no,alipay_trade_no,trade_status,accepted_at) VALUES(?,?,?,?)")
        .run(order.out_trade_no, tradeNo || null, tradeStatus, now());
      return { paid: true, projectId: order.project_id };
    });
  }
  function validatePaymentIdentity(order, payment, { notify = false } = {}) {
    if ((order.payment_env && order.payment_env !== paymentConfig.mode) ||
      (order.app_id && order.app_id !== paymentConfig.appId)) {
      throw new ServiceError(400, "订单与当前支付环境不一致。");
    }
    if (payment.out_trade_no !== order.out_trade_no || payment.total_amount !== fenToYuan(order.amount_fen)) {
      throw new ServiceError(400, "订单号或金额不一致。");
    }
    const sellerId = order.seller_id ?? paymentConfig.sellerId;
    const sellerEmail = order.seller_email ?? paymentConfig.sellerEmail;
    const sellerMatches = (sellerId && payment.seller_id === sellerId) ||
      (sellerEmail && payment.seller_email === sellerEmail);
    if (notify && (payment.app_id !== (order.app_id ?? paymentConfig.appId) || !sellerMatches)) {
      throw new ServiceError(400, "商户身份不一致。");
    }
    if (!notify && ((payment.app_id && payment.app_id !== (order.app_id ?? paymentConfig.appId)) ||
      ((payment.seller_id || payment.seller_email) && !sellerMatches))) {
      throw new ServiceError(400, "查单商户身份不一致。");
    }
  }
  async function notify(params) {
    if (!gateway || !paymentConfig || !gateway.verifyNotify(params)) throw new ServiceError(400, "支付宝通知验签失败。");
    const order = db.prepare("SELECT * FROM orders WHERE out_trade_no=?").get(params.out_trade_no);
    if (!order) throw new ServiceError(404, "订单不存在。");
    validatePaymentIdentity(order, params, { notify: true });
    // Refund and settlement events may carry a paid trade status; they never grant a fresh entitlement.
    if (PAID.has(params.trade_status) && !params.out_biz_no && !params.gmt_refund && !params.refund_fee) {
      return grantOrder(order, params.trade_no, params.trade_status);
    }
    // TRADE_CLOSED can mean timeout or full refund. Preserve an existing paid entitlement for review.
    transaction(db, () => {
      if (params.trade_status === "TRADE_CLOSED" && order.status !== "PAID") {
        db.prepare("UPDATE orders SET status='CLOSED',updated_at=? WHERE out_trade_no=? AND status='PENDING'")
          .run(now(), order.out_trade_no);
      }
      db.prepare("INSERT INTO payment_events(out_trade_no,alipay_trade_no,trade_status,accepted_at) VALUES(?,?,?,?)")
        .run(order.out_trade_no, params.trade_no || null, params.trade_status || "UNKNOWN", now());
    });
    return { paid: order.status === "PAID", projectId: order.project_id };
  }
  async function reconcile(sessionId, projectId) {
    ownedProject(db, sessionId, projectId);
    if (db.prepare("SELECT 1 FROM entitlements WHERE project_id=? AND status='ACTIVE'").get(projectId)) return getProject(sessionId, projectId);
    if (!gateway) return getProject(sessionId, projectId);
    // A newer unpaid checkout must not hide a late payment on an older closed order.
    const orders = db.prepare("SELECT * FROM orders WHERE project_id=? AND status IN ('PENDING','CLOSED') ORDER BY created_at DESC, rowid DESC")
      .all(projectId);
    for (const order of orders) {
      let result;
      try { result = await gateway.query(order.out_trade_no); }
      catch { continue; }
      const payment = result?.alipayTradeQueryResponse ?? result;
      if (!payment || payment.code !== "10000") continue;
      validatePaymentIdentity(order, payment);
      if (PAID.has(payment.trade_status)) {
        grantOrder(order, payment.trade_no, payment.trade_status);
        break;
      }
      if (payment.trade_status === "TRADE_CLOSED") {
        db.prepare("UPDATE orders SET status='CLOSED',updated_at=? WHERE out_trade_no=? AND status='PENDING'")
          .run(now(), order.out_trade_no);
      }
    }
    return getProject(sessionId, projectId);
  }
  function publish(sessionId, projectId) {
    const project = ownedProject(db, sessionId, projectId);
    requirePaid(db, projectId);
    try { return transaction(db, () => {
      const existing = db.prepare("SELECT * FROM shares WHERE project_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1")
        .get(projectId, now());
      if (existing?.revision === project.revision) return { token: existing.token, expiresAt: existing.expires_at };
      db.prepare("UPDATE shares SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL").run(now(), projectId);
      const value = token(), expiry = now() + WEEK;
      db.prepare("INSERT INTO shares(token,project_id,revision,config_json,created_at,expires_at) VALUES(?,?,?,?,?,?)")
        .run(value, projectId, project.revision, project.config_json, now(), expiry);
      db.prepare("INSERT INTO deliveries(project_id,kind,status,completed_at) VALUES(?,'share','DELIVERED',?) ON CONFLICT(project_id,kind) DO UPDATE SET status='DELIVERED',completed_at=excluded.completed_at,error=NULL")
        .run(projectId, now());
      return { token: value, expiresAt: expiry };
    }); }
    catch (error) {
      // Record a failed delivery after the publication transaction has rolled back.
      try { markDeliveryFailure(projectId, "share"); } catch { /* Keep the original failure. */ }
      throw error;
    }
  }
  function readShare(value) {
    const record = db.prepare("SELECT shares.*,entitlements.status AS entitlement_status FROM shares JOIN entitlements ON entitlements.project_id=shares.project_id WHERE token=?").get(value);
    if (!record || record.revoked_at || record.expires_at <= now() || record.entitlement_status !== "ACTIVE") {
      throw new ServiceError(404, "分享链接已失效。");
    }
    return { config: JSON.parse(record.config_json), expiresAt: record.expires_at };
  }
  function listShares(sessionId, projectId) {
    ownedProject(db, sessionId, projectId);
    return db.prepare("SELECT token,expires_at,revision FROM shares WHERE project_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC")
      .all(projectId, now());
  }
  function revokeShare(sessionId, projectId, value) {
    ownedProject(db, sessionId, projectId);
    db.prepare("UPDATE shares SET revoked_at=? WHERE token=? AND project_id=? AND revoked_at IS NULL").run(now(), value, projectId);
  }
  function issueDownload(sessionId, projectId) {
    const project = ownedProject(db, sessionId, projectId);
    requirePaid(db, projectId);
    const value = token(), expiry = now() + DOWNLOAD_TTL;
    db.prepare("INSERT INTO downloads(token,project_id,revision,expires_at) VALUES(?,?,?,?)")
      .run(value, projectId, project.revision, expiry);
    db.prepare(`INSERT INTO deliveries(project_id,kind,status) VALUES(?,'export','PENDING')
      ON CONFLICT(project_id,kind) DO UPDATE SET
        status=CASE WHEN deliveries.status='DELIVERED' THEN 'DELIVERED' ELSE 'PENDING' END,
        error=NULL`)
      .run(projectId);
    return { token: value, expiresAt: expiry };
  }
  function getDownload(sessionId, value) {
    const record = db.prepare("SELECT downloads.*,projects.config_json,projects.owner_session_id FROM downloads JOIN projects ON projects.id=downloads.project_id WHERE downloads.token=?").get(value);
    if (!record || record.owner_session_id !== sessionId || record.expires_at <= now()) notFound();
    requirePaid(db, record.project_id);
    return { projectId: record.project_id, config: JSON.parse(record.config_json) };
  }
  function markDownload(projectId, value) {
    db.prepare("UPDATE downloads SET used_at=? WHERE token=?").run(now(), value);
    db.prepare("INSERT INTO deliveries(project_id,kind,status,completed_at) VALUES(?,'export','DELIVERED',?) ON CONFLICT(project_id,kind) DO UPDATE SET status='DELIVERED',completed_at=excluded.completed_at,error=NULL")
      .run(projectId, now());
  }
  function orderHistory(sessionId, projectId) {
    ownedProject(db, sessionId, projectId);
    return db.prepare("SELECT out_trade_no,amount_fen,status,payment_env,app_id,seller_id,seller_email,alipay_trade_no,created_at FROM orders WHERE project_id=? ORDER BY created_at DESC").all(projectId);
  }
  return { createProject, updateProject, getProject, listProjects, checkout, notify, reconcile,
    publish, readShare, listShares, revokeShare, issueDownload, getDownload, markDownload,
    markDeliveryFailure, orderHistory };
}
