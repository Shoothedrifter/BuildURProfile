import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sandboxFile = fileURLToPath(new URL("../.alipay-sandbox.json", import.meta.url));

const SANDBOX_GATEWAY = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";
const PRODUCTION_GATEWAY = "https://openapi.alipay.com/gateway.do";

export class ConfigError extends Error {
  constructor(message) { super(message); this.name = "ConfigError"; }
}

export function loadSandboxPaymentEnv(env = process.env, path = sandboxFile) {
  if (env.PAYMENT_ENV !== "sandbox") return env;
  const file = lstatSync(path, { throwIfNoEntry: false });
  if (!file) return env;
  if (!file.isFile() || (file.mode & 0o777) !== 0o600) {
    throw new ConfigError("Sandbox credential file must be a regular file with 0600 permissions.");
  }
  let record;
  try { record = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new ConfigError("Sandbox credential file is not valid JSON."); }
  const app = record?.appIds?.[0];
  const seller = record?.sandboxAccounts?.partner;
  if (![app?.appId, app?.appPrivatePkcsKey, app?.alipayPublicKey, app?.pid, seller?.userId]
    .every((value) => typeof value === "string" && value.trim()) || app.pid !== seller.userId) {
    throw new ConfigError("Sandbox credential file has missing or inconsistent payment fields.");
  }
  // Use the Skill's original PKCS#1 field in memory; never copy credentials to .env or client code.
  return { ...env, ALIPAY_APP_ID: app.appId, ALIPAY_PRIVATE_KEY: app.appPrivatePkcsKey,
    ALIPAY_PRIVATE_KEY_TYPE: "PKCS1", ALIPAY_PUBLIC_KEY: app.alipayPublicKey,
    ALIPAY_SELLER_ID: app.pid, ALIPAY_SELLER_EMAIL: seller.email ?? "" };
}

export function priceFenFromEnv(env = process.env) {
  const value = env.PAYMENT_PRICE_FEN;
  if (!/^[1-9]\d*$/.test(value ?? "") || !Number.isSafeInteger(Number(value))) {
    throw new ConfigError("PAYMENT_PRICE_FEN must be a positive integer number of cents.");
  }
  return Number(value);
}

export function paymentConfig(env = process.env) {
  const mode = env.PAYMENT_ENV;
  if (mode !== "sandbox" && mode !== "production") throw new ConfigError("PAYMENT_ENV must be sandbox or production.");
  const priceFen = priceFenFromEnv(env);
  for (const key of ["PUBLIC_BASE_URL", "ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY"]) {
    if (!env[key]?.trim()) throw new ConfigError(`${key} is required for checkout.`);
  }
  if (!env.ALIPAY_SELLER_ID?.trim() && !env.ALIPAY_SELLER_EMAIL?.trim()) {
    throw new ConfigError("ALIPAY_SELLER_ID or ALIPAY_SELLER_EMAIL is required.");
  }
  const privateKeyType = env.ALIPAY_PRIVATE_KEY_TYPE?.trim() || "PKCS1";
  if (!["PKCS1", "PKCS8"].includes(privateKeyType)) {
    throw new ConfigError("ALIPAY_PRIVATE_KEY_TYPE must be PKCS1 or PKCS8.");
  }
  let base;
  try { base = new URL(env.PUBLIC_BASE_URL); } catch { throw new ConfigError("PUBLIC_BASE_URL is invalid."); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new ConfigError("PUBLIC_BASE_URL must be an HTTP(S) origin without path, credentials, query, or hash.");
  }
  if (mode === "production" && base.protocol !== "https:") throw new ConfigError("Production PUBLIC_BASE_URL must use HTTPS.");
  let notifyUrl;
  if (env.ALIPAY_NOTIFY_URL?.trim()) {
    try { notifyUrl = new URL(env.ALIPAY_NOTIFY_URL); } catch { throw new ConfigError("ALIPAY_NOTIFY_URL is invalid."); }
    if (notifyUrl.protocol !== "https:" || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(notifyUrl.hostname) ||
      notifyUrl.pathname !== "/api/payment/notify" || notifyUrl.search || notifyUrl.hash) {
      throw new ConfigError("ALIPAY_NOTIFY_URL must be a public HTTPS /api/payment/notify URL without query or hash.");
    }
  } else if (mode === "production") {
    throw new ConfigError("Production requires a public ALIPAY_NOTIFY_URL.");
  }
  return {
    mode, priceFen, appId: env.ALIPAY_APP_ID.trim(), privateKey: env.ALIPAY_PRIVATE_KEY.replace(/\\n/g, "\n"),
    privateKeyType,
    alipayPublicKey: env.ALIPAY_PUBLIC_KEY.replace(/\\n/g, "\n"), sellerId: env.ALIPAY_SELLER_ID?.trim() || null,
    sellerEmail: env.ALIPAY_SELLER_EMAIL?.trim() || null, publicBaseUrl: base.href.replace(/\/$/, ""),
    notifyUrl: notifyUrl?.href, gateway: mode === "sandbox" ? SANDBOX_GATEWAY : PRODUCTION_GATEWAY
  };
}

export function fenToYuan(fen) { return (fen / 100).toFixed(2); }
