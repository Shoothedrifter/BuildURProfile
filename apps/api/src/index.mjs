import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bindPaymentEnvironment, openDatabase } from "./database.mjs";
import { loadSandboxPaymentEnv, paymentConfig, priceFenFromEnv } from "./config.mjs";
import { createAlipayGateway } from "./gateway.mjs";
import { createPaymentService } from "./service.mjs";
import { createPaymentHttpServer } from "./http.mjs";

const localEnvFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
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
const server = createPaymentHttpServer({ db, service, paymentConfig: config, priceFen, configurationError });
const port = Number(process.env.SERVER_PORT ?? 8787);
const host = process.env.SERVER_HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  process.stdout.write(`BuildURProfile server listening on ${host}:${port}\n`);
  if (!config) process.stdout.write(`Payment checkout unavailable: ${configurationError}\n`);
});
