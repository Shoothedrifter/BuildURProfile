import { createResumeRepository } from "../../../../packages/storage/src/resumes/repository.mjs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { bindPaymentEnvironment, openDatabase } from "./database.mjs";
import { loadSandboxPaymentEnv, paymentConfig, priceFenFromEnv } from "./config.mjs";
import { createAlipayGateway } from "./gateway.mjs";
import { createPaymentService } from "./service.mjs";
import { createRequestHandler, dispatchWebRequest } from "./http.mjs";
import { createGenerationService } from "./generations.mjs";

const GLOBAL_RUNTIME_KEY = "__buildurprofile_next_runtime__";

function resolveRepoRoot() {
  const cwd = process.cwd();
  return existsSync(/*turbopackIgnore: true*/ join(cwd, "packages/contracts/package.json")) ? cwd : resolve(cwd, "../..");
}

export function getAppRuntime() {
  if (globalThis[GLOBAL_RUNTIME_KEY]) return globalThis[GLOBAL_RUNTIME_KEY];

  const repoRoot = resolveRepoRoot();
  const localEnvFile = join(repoRoot, ".env");
  if (existsSync(/*turbopackIgnore: true*/ localEnvFile)) {
    try { process.loadEnvFile(localEnvFile); } catch { /* Ignore if already loaded */ }
  }
  if (process.env.NODE_ENV === "production" && !process.env.AGENT_SERVICE_TOKEN) {
    throw new Error("AGENT_SERVICE_TOKEN is required in production.");
  }
  let config = null, priceFen = null, configurationError = null;
  try { priceFen = priceFenFromEnv(); } catch { /* Preview remains available until a price is configured. */ }
  try { config = paymentConfig(loadSandboxPaymentEnv()); } catch (error) { configurationError = error.message; }
  const databasePath = process.env.DATABASE_PATH?.trim() || join(repoRoot, process.env.PAYMENT_ENV === "production"
    ? "data/buildurprofile-production.sqlite" : "data/buildurprofile.sqlite");
  const db = openDatabase(databasePath);
  if (process.env.PAYMENT_ENV === "sandbox" || process.env.PAYMENT_ENV === "production") {
    bindPaymentEnvironment(db, process.env.PAYMENT_ENV);
  }
  const gateway = config ? createAlipayGateway(config) : null;
  const service = createPaymentService(db, { gateway, paymentConfig: config, configurationError });
  const host = process.env.SERVER_HOST ?? "127.0.0.1";
  const avatarDemoEnabled = process.env.AVATAR_DEMO_ENABLED === "1" &&
    ["127.0.0.1", "localhost", "::1"].includes(host) && process.env.PAYMENT_ENV !== "production";
  const assetRoot = process.env.AVATAR_ASSET_ROOT || join(repoRoot, "data/avatar-assets");
  const generationService = createGenerationService({ db, assetRoot, allowPortraits: avatarDemoEnabled });
  const resumeRepository = createResumeRepository({db, root: process.env.RESUME_FILE_ROOT || join(repoRoot, "data/resume-files")});
  const cleanupTimer = setInterval(() => { try { resumeRepository.cleanup(); } catch { /* Retry on the next bounded sweep. */ } }, 60_000);
  cleanupTimer.unref();
  const handler = createRequestHandler({
    db, service, generationService, resumeRepository, portraitEnabled: avatarDemoEnabled,
    agentToken: process.env.AGENT_SERVICE_TOKEN, paymentConfig: config, priceFen, configurationError
  });

  const runtime = { db, service, generationService, handler, paymentConfig: config, priceFen, configurationError };
  globalThis[GLOBAL_RUNTIME_KEY] = runtime;
  return runtime;
}

export async function handleNextRouteRequest(request) {
  const { handler } = getAppRuntime();
  return dispatchWebRequest(request, handler);
}
