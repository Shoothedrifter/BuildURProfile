import { matchingResumeProject } from "../../../../packages/storage/src/project-matching.mjs";
import { createResumeMediaStore } from '../../../../packages/storage/src/generation/resume-media.mjs';
import { randomBytes, randomUUID } from "node:crypto";
import { transaction } from "./database.mjs";
import { fenToYuan } from "./config.mjs";
import { assertDeliverableConfig, ServiceError, cleanConfig } from "../../../../packages/contracts/src/validation.mjs";
export { ServiceError, cleanConfig } from "../../../../packages/contracts/src/validation.mjs";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const DOWNLOAD_TTL = 15 * 60 * 1000;
const PAID = new Set(["TRADE_SUCCESS", "TRADE_FINISHED"]);

function token() { return randomBytes(32).toString("base64url"); }
function notFound() { throw new ServiceError(404, "项目不存在或无权访问。"); }
async function requirePaid(db, projectId) {
  const entitlement = await db.prepare("SELECT status FROM entitlements WHERE project_id=?").get(projectId);
  if (entitlement?.status !== "ACTIVE") throw new ServiceError(402, "请先完成本项目的支付。");
}
async function ownedProject(db, sessionId, projectId, lock = false) {
  const project = await db.prepare(`SELECT * FROM projects WHERE id=? AND owner_session_id=? AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`).get(projectId, sessionId);
  if (!project) notFound();
  return project;
}
async function editableResume(db, owner, resumeId, time) {
  return (await db.prepare(`SELECT r.id FROM resumes r JOIN resume_files f ON f.id=r.file_id
    WHERE r.id=? AND r.owner_session_id=? AND f.owner_session_id=? AND r.status='SUCCEEDED' AND f.expires_at>?`)
    .get(resumeId, owner, owner, time))?.id;
}
async function publicProject(project, db, time) {
  const entitlement = await db.prepare("SELECT status FROM entitlements WHERE project_id=?").get(project.id);
  const pending = await db.prepare("SELECT amount_fen FROM orders WHERE project_id=? AND status='PENDING'").get(project.id);
  const resumeId = project.resume_id && await editableResume(db, project.owner_session_id, project.resume_id, time);
  return { id: project.id, config: JSON.parse(project.config_json), revision: project.revision,
    ...(resumeId ? { resumeId } : {}),
    paid: entitlement?.status === "ACTIVE", pendingAction: project.pending_action,
    pendingAmountFen: pending?.amount_fen ?? null };
}
export function createPaymentService(db, { gateway, paymentConfig, configurationError = null, now = () => Date.now(),
  readHeroPhotoAsset = null }) {
  const media=createResumeMediaStore({db,now});
  // 保存时把暖调马卡龙的直出照片从会话内预览 URL 内嵌为 data URL（服务端权威，镜像 heroArtwork 的内嵌约束）。
  async function embedHeroPhoto(sessionId, config) {
    if (!config?.heroPhoto) return config;
    const source = typeof config.heroPhoto.assetUrl === "string" ? config.heroPhoto.assetUrl : "";
    const match = /^\/api\/portraits\/([A-Za-z0-9-]+)$/.exec(source);
    if (!match) return config; // 已是 data URL 等形态，交给 cleanConfig 校验
    if (!readHeroPhotoAsset) throw new ServiceError(400, "个人照片暂不可用，请重新上传后再保存。");
    const asset = await readHeroPhotoAsset(sessionId, match[1]);
    const alt = typeof config.heroPhoto.alt === "string" && config.heroPhoto.alt.trim()
      ? config.heroPhoto.alt.trim() : `${config.content?.profile?.name ?? ""}的个人照片`;
    return { ...config, heroPhoto: { assetUrl: `data:${asset.mime};base64,${asset.bytes.toString("base64")}`, alt } };
  }
  async function markDeliveryFailure(projectId, kind) {
    if (kind === "share") await requirePaid(db, projectId);
    await db.prepare(`INSERT INTO deliveries(project_id,kind,status,error) VALUES(?,?,'FAILED','DELIVERY_FAILED')
      ON CONFLICT(project_id,kind) DO UPDATE SET
        status=CASE WHEN deliveries.status='DELIVERED' THEN 'DELIVERED' ELSE 'FAILED' END,
        error=CASE WHEN deliveries.status='DELIVERED' THEN NULL ELSE 'DELIVERY_FAILED' END`)
      .run(projectId, kind);
  }
  async function getProject(sessionId, projectId) { return await publicProject(await ownedProject(db, sessionId, projectId), db, now()); }
  async function createProject(sessionId, config, resumeId) {
    return await transaction(db,async ()=>{
    const id = randomUUID(), time = now(), json = cleanConfig(await embedHeroPhoto(sessionId, config));
    if (resumeId !== undefined && (typeof resumeId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(resumeId))) {
      throw new ServiceError(400, "简历标识无效。");
    }
    const source = resumeId ? await editableResume(db, sessionId, resumeId, time) : undefined;
    if (source) {
      await db.prepare("SELECT id FROM sessions WHERE id=? FOR NO KEY UPDATE").get(sessionId);
      const existing = await matchingResumeProject(db, sessionId, source, json);
      if (existing) {
        // A plain repeat must not remove previously saved artwork or photo.
        if ((JSON.parse(json).heroArtwork || JSON.parse(json).heroPhoto) && json !== existing.config_json) {
          await db.prepare("UPDATE projects SET config_json=?,revision=revision+1,updated_at=? WHERE id=?")
            .run(json, time, existing.id);
        }
        return getProject(sessionId, existing.id);
      }
    }
    await db.prepare("INSERT INTO projects(id,owner_session_id,config_json,created_at,updated_at,resume_id) VALUES(?,?,?,?,?,?)")
      .run(id, sessionId, json, time, time, source ?? null);
    await media.attachProject(sessionId,id,JSON.parse(json));
    return await getProject(sessionId, id);
    });
  }
  async function updateProject(sessionId, projectId, config) {
    return await transaction(db,async ()=>{
    const existing = await ownedProject(db, sessionId, projectId, true);
    const json = cleanConfig(await embedHeroPhoto(sessionId, config));
    if (existing.config_json === json) return await getProject(sessionId, projectId);
    await db.prepare("UPDATE projects SET config_json=?,revision=revision+1,updated_at=? WHERE id=?")
      .run(json, now(), projectId);
    await media.attachProject(sessionId,projectId,JSON.parse(json));
    await media.pruneProject(projectId);
    return await getProject(sessionId, projectId);
    });
  }
  async function listProjects(sessionId) {
    const time = now();
    const projects = await db.prepare(`SELECT p.* FROM projects p WHERE p.owner_session_id=? AND p.deleted_at IS NULL
      AND NOT (
        p.resume_id IS NOT NULL AND p.config_json::jsonb->'heroArtwork' IS NULL AND p.config_json::jsonb->'heroPhoto' IS NULL
        AND EXISTS (SELECT 1 FROM generations g WHERE g.project_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.project_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.project_id=p.id)
        AND EXISTS (SELECT 1 FROM projects other WHERE other.owner_session_id=p.owner_session_id
          AND other.resume_id=p.resume_id AND other.id<>p.id AND other.deleted_at IS NULL
          AND (other.config_json::jsonb->'heroArtwork' IS NOT NULL OR other.config_json::jsonb->'heroPhoto' IS NOT NULL)
          AND (other.config_json::jsonb - 'heroArtwork' - 'heroPhoto')=(p.config_json::jsonb - 'heroArtwork' - 'heroPhoto'))
      ) ORDER BY p.updated_at DESC`).all(sessionId);
    return Promise.all(projects.map(project => publicProject(project, db, time)));
  }
  async function deleteProject(sessionId, projectId) {
    return await transaction(db, async () => {
      await ownedProject(db, sessionId, projectId, true);
      const unsettled = await db.prepare("SELECT 1 FROM orders WHERE project_id=? AND status IN ('PENDING','CLOSED') LIMIT 1").get(projectId);
      if (unsettled) throw new ServiceError(409, "项目仍有待核实的支付订单，请完成订单核实后再删除。");
      const time = now();
      await db.prepare("UPDATE shares SET revoked_at=COALESCE(revoked_at,?),config_json='{}' WHERE project_id=?")
        .run(time, projectId);
      await db.prepare("UPDATE downloads SET expires_at=LEAST(expires_at,?) WHERE project_id=?")
        .run(time, projectId);
      await db.prepare("UPDATE projects SET deleted_at=?,config_json='{}',pending_action=NULL,updated_at=? WHERE id=?")
        .run(time, time, projectId);
      await media.pruneProject(projectId);
      return { ok: true };
    });
  }
  async function checkout(sessionId, projectId, action) {
    if (action !== "share" && action !== "github-pages") throw new ServiceError(400, "仅发布需要结账，导出免费。");
    const order = await transaction(db, async () => {
      const project = await ownedProject(db, sessionId, projectId, true);
      assertDeliverableConfig(JSON.parse(project.config_json));
      if (await db.prepare("SELECT 1 FROM entitlements WHERE project_id=? AND status='ACTIVE'").get(projectId)) {
        await db.prepare("UPDATE projects SET pending_action=? WHERE id=?").run(action, projectId);
        return null;
      }
      if (!paymentConfig || !gateway) throw new ServiceError(503, configurationError ?? "支付配置不完整，请配置沙箱商户参数与价格。");
      await db.prepare("UPDATE projects SET pending_action=? WHERE id=?").run(action, projectId);
      const pending = await db.prepare("SELECT * FROM orders WHERE project_id=? AND status='PENDING'").get(projectId);
      if (pending) {
        if ((pending.payment_env && pending.payment_env !== paymentConfig.mode) ||
          (pending.app_id && pending.app_id !== paymentConfig.appId)) {
          throw new ServiceError(409, "待支付订单属于另一支付环境，请联系支持人员核对。");
        }
        return pending;
      }
      const outTradeNo = `BURP${randomBytes(14).toString("hex").toUpperCase()}`;
      await db.prepare("INSERT INTO orders(out_trade_no,project_id,amount_fen,status,payment_env,app_id,seller_id,seller_email,created_at,updated_at) VALUES(?,?,?,'PENDING',?,?,?,?,?,?)")
        .run(outTradeNo, projectId, paymentConfig.priceFen, paymentConfig.mode ?? "sandbox", paymentConfig.appId,
          paymentConfig.sellerId, paymentConfig.sellerEmail, now(), now());
      return await db.prepare("SELECT * FROM orders WHERE out_trade_no=?").get(outTradeNo);
    });
    if (!order) return { alreadyPaid: true, project: await getProject(sessionId, projectId) };
    try {
      const paymentHtml = await gateway.pagePay(order);
      return { alreadyPaid: false, outTradeNo: order.out_trade_no, paymentHtml,
        amountFen: order.amount_fen, amountYuan: fenToYuan(order.amount_fen) };
    } catch {
      // A form-generation error is not proof of payment; allow a fresh attempt.
      await db.prepare("UPDATE orders SET status='ERROR',updated_at=? WHERE out_trade_no=? AND status='PENDING'")
        .run(now(), order.out_trade_no);
      throw new ServiceError(502, "支付宝收银台暂不可用，请稍后重试。");
    }
  }
  async function grantOrder(order, tradeNo, tradeStatus) {
    return await transaction(db, async () => {
      await db.prepare("SELECT id FROM projects WHERE id=? FOR UPDATE").get(order.project_id);
      const current = await db.prepare("SELECT * FROM orders WHERE out_trade_no=? FOR UPDATE").get(order.out_trade_no);
      if (!current) throw new ServiceError(404, "订单不存在。");
      if (current.alipay_trade_no && tradeNo && current.alipay_trade_no !== tradeNo) {
        throw new ServiceError(400, "支付宝交易号不一致。");
      }
      await db.prepare("UPDATE orders SET status='PAID',alipay_trade_no=COALESCE(alipay_trade_no,?),updated_at=? WHERE out_trade_no=?")
        .run(tradeNo || null, now(), order.out_trade_no);
      await db.prepare("INSERT INTO entitlements(project_id,status,granted_by_order,granted_at) VALUES(?,'ACTIVE',?,?) ON CONFLICT(project_id) DO NOTHING")
        .run(order.project_id, order.out_trade_no, now());
      await db.prepare("INSERT INTO payment_events(out_trade_no,alipay_trade_no,trade_status,accepted_at) VALUES(?,?,?,?)")
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
    const order = await db.prepare("SELECT * FROM orders WHERE out_trade_no=?").get(params.out_trade_no);
    if (!order) throw new ServiceError(404, "订单不存在。");
    validatePaymentIdentity(order, params, { notify: true });
    // Refund and settlement events may carry a paid trade status; they never grant a fresh entitlement.
    if (PAID.has(params.trade_status) && !params.out_biz_no && !params.gmt_refund && !params.refund_fee) {
      return await grantOrder(order, params.trade_no, params.trade_status);
    }
    // TRADE_CLOSED can mean timeout or full refund. Preserve an existing paid entitlement for review.
    await transaction(db, async () => {
      if (params.trade_status === "TRADE_CLOSED" && order.status !== "PAID") {
        await db.prepare("UPDATE orders SET status='CLOSED',updated_at=? WHERE out_trade_no=? AND status='PENDING'")
          .run(now(), order.out_trade_no);
      }
      await db.prepare("INSERT INTO payment_events(out_trade_no,alipay_trade_no,trade_status,accepted_at) VALUES(?,?,?,?)")
        .run(order.out_trade_no, params.trade_no || null, params.trade_status || "UNKNOWN", now());
    });
    return { paid: order.status === "PAID", projectId: order.project_id };
  }
  async function reconcile(sessionId, projectId) {
    await ownedProject(db, sessionId, projectId);
    if (await db.prepare("SELECT 1 FROM entitlements WHERE project_id=? AND status='ACTIVE'").get(projectId)) return await getProject(sessionId, projectId);
    if (!gateway) return await getProject(sessionId, projectId);
    // A newer unpaid checkout must not hide a late payment on an older closed order.
    const orders = await db.prepare("SELECT * FROM orders WHERE project_id=? AND status IN ('PENDING','CLOSED') ORDER BY created_at DESC, insertion_order DESC")
      .all(projectId);
    for (const order of orders) {
      let result;
      try { result = await gateway.query(order.out_trade_no); }
      catch { continue; }
      const payment = result?.alipayTradeQueryResponse ?? result;
      if (!payment || payment.code !== "10000") continue;
      validatePaymentIdentity(order, payment);
      if (PAID.has(payment.trade_status)) {
        await grantOrder(order, payment.trade_no, payment.trade_status);
        break;
      }
      if (payment.trade_status === "TRADE_CLOSED") {
        await db.prepare("UPDATE orders SET status='CLOSED',updated_at=? WHERE out_trade_no=? AND status='PENDING'")
          .run(now(), order.out_trade_no);
      }
    }
    return await getProject(sessionId, projectId);
  }
  async function publish(sessionId, projectId) {
    try { return await transaction(db, async () => {
      const project = await ownedProject(db, sessionId, projectId, true);
      assertDeliverableConfig(JSON.parse(project.config_json));
      await requirePaid(db, projectId);
      const existing = await db.prepare("SELECT * FROM shares WHERE project_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1")
        .get(projectId, now());
      if (existing?.revision === project.revision) return { token: existing.token, expiresAt: existing.expires_at };
      await db.prepare("UPDATE shares SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL").run(now(), projectId);
      const value = token(), expiry = now() + WEEK;
      await db.prepare("INSERT INTO shares(token,project_id,revision,config_json,created_at,expires_at) VALUES(?,?,?,?,?,?)")
        .run(value, projectId, project.revision, project.config_json, now(), expiry);
      await db.prepare("INSERT INTO deliveries(project_id,kind,status,completed_at) VALUES(?,'share','DELIVERED',?) ON CONFLICT(project_id,kind) DO UPDATE SET status='DELIVERED',completed_at=excluded.completed_at,error=NULL")
        .run(projectId, now());
      await media.pruneProject(projectId);
      return { token: value, expiresAt: expiry };
    }); }
    catch (error) {
      // Record a failed delivery after the publication transaction has rolled back.
      try { await markDeliveryFailure(projectId, "share"); } catch { /* Keep the original failure. */ }
      throw error;
    }
  }
  async function readShare(value) {
    const record = await db.prepare("SELECT shares.*,entitlements.status AS entitlement_status,projects.deleted_at FROM shares JOIN entitlements ON entitlements.project_id=shares.project_id JOIN projects ON projects.id=shares.project_id WHERE token=?").get(value);
    if (!record || record.deleted_at != null || record.revoked_at || record.expires_at <= now() || record.entitlement_status !== "ACTIVE") {
      throw new ServiceError(404, "分享链接已失效。");
    }
    const config = JSON.parse(record.config_json);
    assertDeliverableConfig(config);
    return { config, expiresAt: record.expires_at };
  }
  async function listShares(sessionId, projectId) {
    await ownedProject(db, sessionId, projectId);
    return await db.prepare("SELECT token,expires_at,revision FROM shares WHERE project_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC")
      .all(projectId, now());
  }
  async function revokeShare(sessionId, projectId, value) {
    return transaction(db, async () => {
      await ownedProject(db, sessionId, projectId, true);
      await db.prepare("UPDATE shares SET revoked_at=? WHERE token=? AND project_id=? AND revoked_at IS NULL").run(now(), value, projectId);
      await media.pruneProject(projectId);
    });
  }
  async function issueDownload(sessionId, projectId) {
    const project = await ownedProject(db, sessionId, projectId);
    assertDeliverableConfig(JSON.parse(project.config_json));
    const value = token(), expiry = now() + DOWNLOAD_TTL;
    await db.prepare("INSERT INTO downloads(token,project_id,revision,expires_at) VALUES(?,?,?,?)")
      .run(value, projectId, project.revision, expiry);
    await db.prepare(`INSERT INTO deliveries(project_id,kind,status) VALUES(?,'export','PENDING')
      ON CONFLICT(project_id,kind) DO UPDATE SET
        status=CASE WHEN deliveries.status='DELIVERED' THEN 'DELIVERED' ELSE 'PENDING' END,
        error=NULL`)
      .run(projectId);
    return { token: value, expiresAt: expiry };
  }
  async function getDownload(sessionId, value) {
    const record = await db.prepare("SELECT downloads.*,projects.config_json,projects.owner_session_id,projects.deleted_at FROM downloads JOIN projects ON projects.id=downloads.project_id WHERE downloads.token=?").get(value);
    if (!record || record.owner_session_id !== sessionId || record.deleted_at != null || record.expires_at <= now()) notFound();
    const config = JSON.parse(record.config_json);
    assertDeliverableConfig(config);
    return { projectId: record.project_id, config };
  }
  async function markDownload(projectId, value) {
    await db.prepare("UPDATE downloads SET used_at=? WHERE token=?").run(now(), value);
    await db.prepare("INSERT INTO deliveries(project_id,kind,status,completed_at) VALUES(?,'export','DELIVERED',?) ON CONFLICT(project_id,kind) DO UPDATE SET status='DELIVERED',completed_at=excluded.completed_at,error=NULL")
      .run(projectId, now());
  }
  async function orderHistory(sessionId, projectId) {
    await ownedProject(db, sessionId, projectId);
    return await db.prepare("SELECT out_trade_no,amount_fen,status,payment_env,app_id,seller_id,seller_email,alipay_trade_no,created_at FROM orders WHERE project_id=? ORDER BY created_at DESC").all(projectId);
  }
  return { readShareMedia: media.readShare, readProjectMedia: media.read, createProject, updateProject, deleteProject, getProject, listProjects, checkout, notify, reconcile,
    publish, readShare, listShares, revokeShare, issueDownload, getDownload, markDownload,
    markDeliveryFailure, orderHistory };
}
