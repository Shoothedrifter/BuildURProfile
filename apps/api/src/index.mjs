import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bindPaymentEnvironment, openDatabase } from "./database.mjs";
import { loadSandboxPaymentEnv, paymentConfig, priceFenFromEnv } from "./config.mjs";
import { createAlipayGateway } from "./gateway.mjs";
import { createPaymentService } from "./service.mjs";
import { createPaymentHttpServer } from "./http.mjs";
import { createGenerationService } from "./generations.mjs";

const localEnvFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
if (process.env.NODE_ENV === "production" && !process.env.AGENT_SERVICE_TOKEN) {
  throw new Error("AGENT_SERVICE_TOKEN is required in production.");
}
let config = null, priceFen = null, configurationError = null;
try { priceFen = priceFenFromEnv(); } catch { /* Preview remains available until a price is configured. */ }
try { config = paymentConfig(loadSandboxPaymentEnv()); } catch (error) { configurationError = error.message; }
const databasePath = process.env.DATABASE_PATH?.trim() || fileURLToPath(new URL(process.env.PAYMENT_ENV === "production"
  ? "../../../data/buildurprofile-production.sqlite" : "../../../data/buildurprofile.sqlite", import.meta.url));
const db = openDatabase(databasePath);
if (process.env.PAYMENT_ENV === "sandbox" || process.env.PAYMENT_ENV === "production") {
  bindPaymentEnvironment(db, process.env.PAYMENT_ENV);
}
const gateway = config ? createAlipayGateway(config) : null;
const service = createPaymentService(db, { gateway, paymentConfig: config, configurationError });
const host = process.env.SERVER_HOST ?? "127.0.0.1";
const avatarDemoEnabled = process.env.AVATAR_DEMO_ENABLED === "1" &&
  ["127.0.0.1", "localhost", "::1"].includes(host) && process.env.PAYMENT_ENV !== "production";
// Every full-stack preview uses the graph. Wibi portraits remain a local-only
// capability until a commercial licence and production image provider exist.
const generationService = createGenerationService({ db, assetRoot: process.env.AVATAR_ASSET_ROOT || "data/avatar-assets",
  allowPortraits: avatarDemoEnabled });
const server = createPaymentHttpServer({ db, service, generationService, portraitEnabled: avatarDemoEnabled,
  agentToken: process.env.AGENT_SERVICE_TOKEN, paymentConfig: config, priceFen, configurationError });
const port = Number(process.env.SERVER_PORT ?? 8787);
server.listen(port, host, () => {
  process.stdout.write(`BuildURProfile server listening on ${host}:${port}\n`);
  if (!config) process.stdout.write(`Payment checkout unavailable: ${configurationError}\n`);
});
