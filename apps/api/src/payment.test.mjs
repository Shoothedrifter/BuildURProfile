import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { bindPaymentEnvironment, openDatabase } from "./database.mjs";
import { createPaymentService } from "./service.mjs";
import { createPaymentHttpServer } from "./http.mjs";
import { zipSingleHtml } from "./export.mjs";
import { createAlipayGateway } from "./gateway.mjs";
import { loadSandboxPaymentEnv, paymentConfig } from "./config.mjs";

const config = JSON.parse(readFileSync(new URL("../../web/src/demo/config.json", import.meta.url)));
let db, gateway, service, time;
const merchant = { mode: "sandbox", priceFen: 199, appId: "sandbox-app", sellerId: "seller-1", sellerEmail: null, publicBaseUrl: "http://127.0.0.1:5173" };
const paidNotice = (order, overrides = {}) => ({ out_trade_no: order.outTradeNo, total_amount: "1.99", app_id: "sandbox-app",
  seller_id: "seller-1", trade_status: "TRADE_SUCCESS", trade_no: "2026sandbox1", ...overrides });
const setupProject = () => service.createProject("owner", config).id;

beforeEach(() => {
  time = 100_000;
  db = openDatabase(":memory:");
  db.prepare("INSERT INTO sessions(id,created_at,expires_at) VALUES('owner',0,9999999999999),('other',0,9999999999999)").run();
  gateway = { verifyNotify: () => true, pagePay: async () => "<form>official SDK form</form>", query: async () => null };
  service = createPaymentService(db, { gateway, paymentConfig: merchant, now: () => time });
});
afterEach(() => db.close());

test("concurrent checkout reuses one pending order and a server price snapshot", async () => {
  const id = setupProject();
  const [a, b] = await Promise.all([service.checkout("owner", id, "share"), service.checkout("owner", id, "export")]);
  assert.equal(a.outTradeNo, b.outTradeNo);
  assert.equal(a.amountYuan, "1.99");
  assert.equal(db.prepare("SELECT count(*) AS count FROM orders").get().count, 1);
  assert.equal(db.prepare("SELECT amount_fen FROM orders").get().amount_fen, 199);
});

test("a pending order from another payment environment cannot be reused", async () => {
  const id = setupProject();
  const order = await service.checkout("owner", id, "share");
  db.prepare("UPDATE orders SET payment_env='production' WHERE out_trade_no=?").run(order.outTradeNo);
  await assert.rejects(service.checkout("owner", id, "export"), /另一支付环境/);
});

test("bad signature, wrong amount, wrong merchant, and unknown order cannot grant access", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "share");
  gateway.verifyNotify = () => false;
  await assert.rejects(service.notify(paidNotice(order)), /验签失败/);
  gateway.verifyNotify = () => true;
  await assert.rejects(service.notify(paidNotice(order, { total_amount: "0.01" })), /金额不一致/);
  await assert.rejects(service.notify(paidNotice(order, { app_id: "other" })), /商户身份不一致/);
  await assert.rejects(service.notify(paidNotice(order, { out_trade_no: "missing" })), /订单不存在/);
  assert.throws(() => service.publish("owner", id), /请先完成/);
  assert.throws(() => service.issueDownload("owner", id), /请先完成/);
});

test("verified success is idempotent and one project unlocks both deliveries", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "share");
  await service.notify(paidNotice(order));
  await service.notify(paidNotice(order));
  assert.equal(db.prepare("SELECT count(*) AS count FROM entitlements").get().count, 1);
  const second = await service.checkout("owner", id, "export");
  assert.equal(second.alreadyPaid, true);
  assert.ok(service.publish("owner", id).token);
  assert.ok(service.issueDownload("owner", id).token);
});

test("verified notification accepts either configured seller identifier, never a mismatched one", async () => {
  const settings = { ...merchant, sellerEmail: "seller@example.test" };
  service = createPaymentService(db, { gateway, paymentConfig: settings, now: () => time });
  const id = setupProject(), order = await service.checkout("owner", id, "share");
  await assert.rejects(service.notify(paidNotice(order, { seller_id: "wrong", seller_email: "wrong@example.test" })),
    /商户身份不一致/);
  await service.notify(paidNotice(order, { seller_email: undefined }));
  assert.equal(service.getProject("owner", id).paid, true);
});

test("refund-related notifications cannot grant a new payment entitlement", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "share");
  for (const field of ["out_biz_no", "gmt_refund", "refund_fee"]) {
    await service.notify(paidNotice(order, { [field]: "refund-event" }));
    assert.equal(service.getProject("owner", id).paid, false);
  }
  await service.notify(paidNotice(order));
  assert.equal(service.getProject("owner", id).paid, true);
});

test("query recovery grants only signed paid status, never a return redirect or unknown status", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "export");
  gateway.query = async () => ({ code: "10000", out_trade_no: order.outTradeNo, total_amount: "1.99", trade_status: "WAIT_BUYER_PAY" });
  assert.equal((await service.reconcile("owner", id)).paid, false);
  gateway.query = async () => ({ code: "10000", out_trade_no: order.outTradeNo, total_amount: "1.99", trade_status: "TRADE_SUCCESS", trade_no: "query-1" });
  assert.equal((await service.reconcile("owner", id)).paid, true);
  assert.equal((await service.reconcile("owner", id)).paid, true);
  assert.equal(db.prepare("SELECT count(*) AS count FROM entitlements").get().count, 1);
});

test("query with wrong amount does not grant access", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "share");
  gateway.query = async () => ({ code: "10000", out_trade_no: order.outTradeNo, total_amount: "0.01", trade_status: "TRADE_SUCCESS" });
  await assert.rejects(service.reconcile("owner", id), /金额不一致/);
  assert.equal(service.getProject("owner", id).paid, false);
});

test("paid TRADE_CLOSED does not revoke an entitlement without refund verification", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "share");
  await service.notify(paidNotice(order));
  await service.notify(paidNotice(order, { trade_status: "TRADE_CLOSED" }));
  assert.equal(service.getProject("owner", id).paid, true);
});

test("an out-of-order closed notice remains queryable for later verified payment recovery", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "share");
  await service.notify(paidNotice(order, { trade_status: "TRADE_CLOSED" }));
  gateway.query = async () => ({ code: "10000", out_trade_no: order.outTradeNo, total_amount: "1.99",
    trade_status: "TRADE_SUCCESS", trade_no: "late-paid" });
  assert.equal((await service.reconcile("owner", id)).paid, true);
});

test("query recovery checks an older closed order even after a newer pending checkout", async () => {
  const id = setupProject(), older = await service.checkout("owner", id, "share");
  await service.notify(paidNotice(older, { trade_status: "TRADE_CLOSED" }));
  time += 1;
  const newer = await service.checkout("owner", id, "export");
  assert.notEqual(newer.outTradeNo, older.outTradeNo);
  gateway.query = async (outTradeNo) => ({ code: "10000", out_trade_no: outTradeNo, total_amount: "1.99",
    trade_status: outTradeNo === older.outTradeNo ? "TRADE_SUCCESS" : "WAIT_BUYER_PAY",
    ...(outTradeNo === older.outTradeNo ? { trade_no: "older-paid" } : {}) });
  assert.equal((await service.reconcile("owner", id)).paid, true);
  assert.equal(db.prepare("SELECT granted_by_order FROM entitlements WHERE project_id=?").get(id).granted_by_order,
    older.outTradeNo);
});

test("shares expire, can be revoked, and republishing replaces old links without another charge", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "share");
  await service.notify(paidNotice(order));
  const first = service.publish("owner", id);
  assert.equal(service.publish("owner", id).token, first.token);
  time += 7 * 24 * 60 * 60 * 1000;
  assert.throws(() => service.readShare(first.token), /已失效/);
  const second = service.publish("owner", id);
  assert.notEqual(second.token, first.token);
  service.revokeShare("owner", id, second.token);
  assert.throws(() => service.readShare(second.token), /已失效/);
});

test("owner and download session are enforced; another project is separately charged", async () => {
  const id = setupProject(), otherId = setupProject(), order = await service.checkout("owner", id, "share");
  await service.notify(paidNotice(order));
  assert.throws(() => service.publish("other", id), /无权访问/);
  const download = service.issueDownload("owner", id);
  assert.throws(() => service.getDownload("other", download.token), /无权访问/);
  assert.equal(service.getDownload("owner", download.token).projectId, id);
  assert.throws(() => service.publish("owner", otherId), /请先完成/);
});

test("server stores only publication fields, excluding raw PDF and client payment claims", () => {
  const id = service.createProject("owner", {
    ...config, isPaid: true, originalPdf: "private binary", content: { ...config.content,
      sourceRefs: { name: { page: 1, excerpt: "PRIVATE PDF EXCERPT" } } }
  }).id;
  const stored = db.prepare("SELECT config_json FROM projects WHERE id=?").get(id).config_json;
  assert.ok(!stored.includes("PRIVATE PDF EXCERPT"));
  assert.ok(!stored.includes("originalPdf"));
  assert.ok(!stored.includes("isPaid"));
  assert.equal(service.getProject("owner", id).paid, false);
});

test("long confirmed project text is preserved in the stored publication", () => {
  const description = "项目职责与成果。".repeat(15_000);
  const id = service.createProject("owner", { ...config, content: { ...config.content,
    projects: [{ ...config.content.projects[0], description }] } }).id;
  assert.equal(service.getProject("owner", id).config.content.projects[0].description, description);
});

test("free endpoints reject direct delivery; notification response is plain fail on invalid signature", async () => {
  const id = setupProject();
  const server = createPaymentHttpServer({ db, service, paymentConfig: merchant, priceFen: 199, secret: Buffer.alloc(32, 1) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const bypass = await fetch(`${base}/api/projects/${id}/publish`, { method: "POST" });
    assert.equal(bypass.status, 401);
    gateway.verifyNotify = () => false;
    const notify = await fetch(`${base}/api/payment/notify`, { method: "POST", body: new URLSearchParams({ out_trade_no: "x" }) });
    assert.equal(await notify.text(), "fail");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("production HTTP serves the relocated web build and offer endpoint", async () => {
  const server = createPaymentHttpServer({ db, service, paymentConfig: merchant, priceFen: 199, secret: Buffer.alloc(32, 5) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /\/assets\/index-/);
    const offer = await fetch(`${base}/api/offer`);
    assert.equal(offer.status, 200);
    assert.equal((await offer.json()).priceFen, 199);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("offline ZIP stores a real index.html", () => {
  const zip = zipSingleHtml("<html>offline</html>");
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.includes(Buffer.from("<html>offline</html>")));
});

test("official SDK generates sandbox page-pay POST form with frozen amount and product code", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const settings = paymentConfig({ PAYMENT_ENV: "sandbox", PAYMENT_PRICE_FEN: "199", PUBLIC_BASE_URL: "http://127.0.0.1:5173",
    ALIPAY_APP_ID: "sandbox-app", ALIPAY_PRIVATE_KEY: privateKey, ALIPAY_PRIVATE_KEY_TYPE: "PKCS8",
    ALIPAY_PUBLIC_KEY: publicKey, ALIPAY_SELLER_ID: "seller-1" });
  const form = createAlipayGateway(settings).pagePay({ out_trade_no: "BURPTEST123", project_id: "project-1", amount_fen: 199 });
  assert.match(form, /openapi-sandbox\.dl\.alipaydev\.com/);
  assert.match(form, /method="post"/i);
  assert.match(form, /FAST_INSTANT_TRADE_PAY/);
  assert.match(form, /1\.99/);
  assert.match(form, /BURPTEST123/);
  assert.doesNotMatch(form, /BEGIN PRIVATE KEY/);
});

test("production checkout rejects missing price, HTTP origin, or an incorrect notification path", () => {
  const base = { PAYMENT_ENV: "production", PAYMENT_PRICE_FEN: "199", PUBLIC_BASE_URL: "https://portfolio.example",
    ALIPAY_APP_ID: "app", ALIPAY_PRIVATE_KEY: "key", ALIPAY_PUBLIC_KEY: "key", ALIPAY_SELLER_ID: "seller" };
  assert.throws(() => paymentConfig({ ...base, PAYMENT_PRICE_FEN: "" }), /PAYMENT_PRICE_FEN/);
  assert.throws(() => paymentConfig({ ...base, PUBLIC_BASE_URL: "http://portfolio.example",
    ALIPAY_NOTIFY_URL: "https://portfolio.example/api/payment/notify" }), /HTTPS/);
  assert.throws(() => paymentConfig({ ...base, ALIPAY_NOTIFY_URL: "https://portfolio.example/wrong" }), /\/api\/payment\/notify/);
});

test("sandbox loader maps one protected app record without exposing credentials to the client", () => {
  const directory = mkdtempSync(join(tmpdir(), "burp-sandbox-"));
  const path = join(directory, ".alipay-sandbox.json");
  const sandbox = { appIds: [{ appId: "sandbox-app", appPrivatePkcsKey: "private-test-value",
    alipayPublicKey: "public-test-value", pid: "seller-2088" }],
  sandboxAccounts: { partner: { userId: "seller-2088", email: "seller@example.test" } } };
  try {
    writeFileSync(path, JSON.stringify(sandbox), { mode: 0o600 });
    const mapped = loadSandboxPaymentEnv({ PAYMENT_ENV: "sandbox", PAYMENT_PRICE_FEN: "199",
      PUBLIC_BASE_URL: "http://127.0.0.1:5173" }, path);
    assert.equal(mapped.ALIPAY_APP_ID, "sandbox-app");
    assert.equal(mapped.ALIPAY_SELLER_ID, "seller-2088");
    assert.equal(mapped.ALIPAY_PRIVATE_KEY_TYPE, "PKCS1");
    assert.equal(paymentConfig(mapped).privateKeyType, "PKCS1");
    assert.equal(loadSandboxPaymentEnv({ PAYMENT_ENV: "production" }, path).ALIPAY_APP_ID, undefined);
    chmodSync(path, 0o644);
    assert.throws(() => loadSandboxPaymentEnv({ PAYMENT_ENV: "sandbox" }, path), /0600/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("official SDK signs a sandbox page form with the Skill's PKCS#1 key format", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const settings = paymentConfig({ PAYMENT_ENV: "sandbox", PAYMENT_PRICE_FEN: "199",
    PUBLIC_BASE_URL: "http://127.0.0.1:5173", ALIPAY_APP_ID: "sandbox-app",
    ALIPAY_PRIVATE_KEY: privateKey, ALIPAY_PRIVATE_KEY_TYPE: "PKCS1",
    ALIPAY_PUBLIC_KEY: publicKey, ALIPAY_SELLER_ID: "seller-1" });
  const form = createAlipayGateway(settings).pagePay({ out_trade_no: "BURPPKCS1", project_id: "p", amount_fen: 199 });
  assert.match(form, /BURPPKCS1/);
  assert.match(form, /openapi-sandbox\.dl\.alipaydev\.com/);
  assert.doesNotMatch(form, /BEGIN RSA PRIVATE KEY/);
});

test("a paid entitlement survives database close and reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "burp-payment-"));
  const path = join(directory, "payment.sqlite");
  try {
    const firstDb = openDatabase(path);
    firstDb.prepare("INSERT INTO sessions(id,created_at,expires_at) VALUES('owner',0,9999999999999)").run();
    const firstService = createPaymentService(firstDb, { gateway, paymentConfig: merchant, now: () => time });
    const id = firstService.createProject("owner", config).id;
    const order = await firstService.checkout("owner", id, "share");
    await firstService.notify(paidNotice(order));
    firstDb.close();
    const reopened = openDatabase(path);
    try {
      const restored = createPaymentService(reopened, { gateway, paymentConfig: merchant, now: () => time });
      assert.equal(restored.getProject("owner", id).paid, true);
      assert.equal((await restored.checkout("owner", id, "export")).alreadyPaid, true);
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a database with sandbox payment history cannot be reopened for production payments", async () => {
  const directory = mkdtempSync(join(tmpdir(), "burp-environment-"));
  const path = join(directory, "shared.sqlite");
  try {
    const first = openDatabase(path);
    bindPaymentEnvironment(first, "sandbox");
    first.close();
    const second = openDatabase(path);
    try { assert.throws(() => bindPaymentEnvironment(second, "production"), /sandbox.*production/); }
    finally { second.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("HTTP flow protects publication and download, then delivers both after verified notification", async () => {
  const server = createPaymentHttpServer({ db, service, paymentConfig: merchant, priceFen: 199, secret: Buffer.alloc(32, 2) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const sessionResponse = await fetch(`${base}/api/session`);
    const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
    const { csrfToken } = await sessionResponse.json();
    const ownerHeaders = { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" };
    const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: ownerHeaders, body: JSON.stringify(body ?? {}) });
    const forged = await fetch(`${base}/api/projects`, { method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ config }) });
    assert.equal(forged.status, 403);
    const projectResponse = await post("/api/projects", { config });
    assert.equal(projectResponse.status, 201);
    const project = await projectResponse.json();
    assert.equal((await post(`/api/projects/${project.id}/publish`)).status, 402);
    assert.equal((await post(`/api/projects/${project.id}/export`)).status, 402);
    const checkout = await (await post(`/api/projects/${project.id}/checkout`, { action: "share" })).json();
    assert.equal(checkout.amountYuan, "1.99");
    const notification = await fetch(`${base}/api/payment/notify`, { method: "POST",
      body: new URLSearchParams(paidNotice(checkout)) });
    assert.equal(await notification.text(), "success");
    const share = await (await post(`/api/projects/${project.id}/publish`)).json();
    const publicRead = await fetch(`${base}/api/shares/${share.token}`);
    assert.equal(publicRead.status, 200);
    assert.equal((await publicRead.json()).config.content.profile.name, config.content.profile.name);
    const download = await (await post(`/api/projects/${project.id}/export`)).json();
    assert.equal((await fetch(`${base}${download.url}`)).status, 401);
    const zipResponse = await fetch(`${base}${download.url}`, { headers: { cookie } });
    assert.equal(zipResponse.status, 200);
    assert.equal(zipResponse.headers.get("content-type"), "application/zip");
    const bytes = Buffer.from(await zipResponse.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.ok(bytes.includes(Buffer.from("BuildURProfile Showcase")));
    assert.equal(db.prepare("SELECT count(*) AS count FROM deliveries WHERE project_id=? AND status='DELIVERED'").get(project.id).count, 2);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("a packaging failure leaves the paid entitlement and a retry can deliver", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "export");
  await service.notify(paidNotice(order));
  const download = service.issueDownload("owner", id);
  assert.equal(db.prepare("SELECT status FROM deliveries WHERE project_id=? AND kind='export'").get(id).status, "PENDING");
  let fail = true;
  const server = createPaymentHttpServer({ db, service, paymentConfig: merchant, priceFen: 199,
    secret: Buffer.alloc(32, 3), zipBuilder: () => { if (fail) throw new Error("packaging failure"); return zipSingleHtml("<html>retry</html>"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/api/session`);
    const cookie = session.headers.get("set-cookie").split(";")[0];
    // This HTTP session is not the project owner; create one tied to its signed cookie for this route check.
    const signedId = cookie.split("=")[1].split(".")[0];
    db.prepare("UPDATE projects SET owner_session_id=? WHERE id=?").run(signedId, id);
    const first = await fetch(`${base}/api/downloads/${download.token}`, { headers: { cookie } });
    assert.equal(first.status, 500);
    assert.equal(service.getProject(signedId, id).paid, true);
    assert.equal(db.prepare("SELECT status FROM deliveries WHERE project_id=? AND kind='export'").get(id).status, "FAILED");
    fail = false;
    const second = await fetch(`${base}/api/downloads/${download.token}`, { headers: { cookie } });
    assert.equal(second.status, 200);
    await second.arrayBuffer();
    assert.equal(db.prepare("SELECT status FROM deliveries WHERE project_id=? AND kind='export'").get(id).status, "DELIVERED");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("a publication failure records failed delivery without losing payment or leaking a share", async () => {
  const id = setupProject(), order = await service.checkout("owner", id, "share");
  await service.notify(paidNotice(order));
  db.exec("CREATE TRIGGER reject_share BEFORE INSERT ON shares BEGIN SELECT RAISE(FAIL, 'share storage unavailable'); END");
  assert.throws(() => service.publish("owner", id), /share storage unavailable/);
  assert.equal(service.getProject("owner", id).paid, true);
  assert.equal(db.prepare("SELECT count(*) AS count FROM shares WHERE project_id=?").get(id).count, 0);
  assert.equal(db.prepare("SELECT status FROM deliveries WHERE project_id=? AND kind='share'").get(id).status, "FAILED");
  db.exec("DROP TRIGGER reject_share");
  assert.ok(service.publish("owner", id).token);
  assert.equal(db.prepare("SELECT status FROM deliveries WHERE project_id=? AND kind='share'").get(id).status, "DELIVERED");
});
