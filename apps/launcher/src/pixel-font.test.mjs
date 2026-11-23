import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openTestDatabase as openDatabase } from "./postgres-test-db.mjs";
import { createPaymentService } from "../../web/src/server/service.mjs";
import { createPaymentHttpServer } from "../../web/src/server/http.mjs";

const config = JSON.parse(readFileSync(new URL("../../web/src/demo/config.json", import.meta.url)));
let db, service;
const merchant = { mode: "sandbox", priceFen: 199, appId: "sandbox-app", sellerId: "seller-1", sellerEmail: null, publicBaseUrl: "http://127.0.0.1:5173" };

beforeEach(async () => {
  db = await openDatabase();
  await db.prepare("INSERT INTO sessions(id,created_at,expires_at) VALUES('owner',0,9999999999999)").run();
  service = createPaymentService(db, { gateway: null, paymentConfig: merchant });
});
afterEach(async () => await db.close());

async function withServer(run) {
  const server = createPaymentHttpServer({ db, service, paymentConfig: merchant, priceFen: 199, secret: Buffer.alloc(32, 9) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("pixel font endpoint serves a cached public woff2 subset without a session", async () => {
  await withServer(async (base) => {
    const first = await fetch(`${base}/api/pixel-font?text=${encodeURIComponent("起点王")}`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("content-type"), "font/woff2");
    assert.match(first.headers.get("cache-control"), /immutable/);
    const bytes = Buffer.from(await first.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2");
    assert.ok(bytes.length > 496, "subset contains the requested glyphs");
    // 子集缓存：同样的请求命中内存缓存（第二次仍 200 且体积一致）
    const second = await fetch(`${base}/api/pixel-font?text=${encodeURIComponent("起点王")}`);
    assert.equal(Buffer.from(await second.arrayBuffer()).length, bytes.length);
  });
});

test("pixel font endpoint rejects missing or oversized text", async () => {
  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/pixel-font`);
    assert.equal(missing.status, 400);
    const oversized = await fetch(`${base}/api/pixel-font?text=${"龙".repeat(200)}`);
    assert.equal(oversized.status, 400);
  });
});
