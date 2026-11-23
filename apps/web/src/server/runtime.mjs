import { createResumeRepository } from "../../../../packages/storage/src/resumes/repository.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { sanitizeWebEnv } from "../../../launcher/src/web-env.mjs";
import { bindPaymentEnvironment, migrateDatabase, openDatabase } from "./database.mjs";
import { loadSandboxPaymentEnv, paymentConfig, priceFenFromEnv } from "./config.mjs";
import { createAlipayGateway } from "./gateway.mjs";
import { createPaymentService } from "./service.mjs";
import { createRequestHandler, dispatchWebRequest } from "./http.mjs";
import { createGenerationService } from "./generations.mjs";
import { githubPagesConfig } from "./github-pages.mjs";
import { createQueueNotifications } from "./queue-notifications.mjs";

const GLOBAL_RUNTIME_KEY = "__buildurprofile_next_runtime__";

function resolveRepoRoot() {
  const cwd = process.cwd();
  return existsSync(/*turbopackIgnore: true*/ join(cwd, "packages/contracts/package.json")) ? cwd : resolve(cwd, "../..");
}

export function getAppRuntime() {
  globalThis[GLOBAL_RUNTIME_KEY] ??= createRuntime().catch(error => {
    delete globalThis[GLOBAL_RUNTIME_KEY];
    const code = /^[A-Z0-9_]{1,24}$/.test(error.code ?? "") ? error.code : "INITIALIZATION_FAILED";
    console.warn(`web runtime unavailable code=${code}`);
    throw error;
  });
  return globalThis[GLOBAL_RUNTIME_KEY];
}

async function createRuntime() {
  const repoRoot = resolveRepoRoot();
  const localEnvFile = join(repoRoot, ".env");
  if (existsSync(/*turbopackIgnore: true*/ localEnvFile)) {
    const env = sanitizeWebEnv(parseEnv(readFileSync(/*turbopackIgnore: true*/ localEnvFile, "utf8")));
    for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
  }
  if (process.env.NODE_ENV === "production" && !process.env.AGENT_SERVICE_TOKEN) {
    throw new Error("AGENT_SERVICE_TOKEN is required in production.");
  }
  let config = null, priceFen = null, configurationError = null;
  try { priceFen = priceFenFromEnv(); } catch { /* Preview remains available until a price is configured. */ }
  try { config = paymentConfig(loadSandboxPaymentEnv()); } catch (error) { configurationError = error.message; }
  const connectionString = process.env.DATABASE_URL;
  const db = openDatabase(connectionString);
  try {
    await migrateDatabase(db);
    if (process.env.PAYMENT_ENV === "sandbox" || process.env.PAYMENT_ENV === "production") {
      await bindPaymentEnvironment(db, process.env.PAYMENT_ENV);
    }
  } catch (error) {
    await db.close();
    throw error;
  }
  const gateway = config ? createAlipayGateway(config) : null;
  const service = createPaymentService(db, { gateway, paymentConfig: config, configurationError });
  const host = process.env.SERVER_HOST ?? "127.0.0.1";
  const avatarDemoEnabled = process.env.AVATAR_DEMO_ENABLED === "1" &&
    ["127.0.0.1", "localhost", "::1"].includes(host) && process.env.PAYMENT_ENV !== "production";
  const assetRoot = process.env.AVATAR_ASSET_ROOT || join(repoRoot, "data/avatar-assets");
  const generationService = createGenerationService({ db, assetRoot, allowPortraits: avatarDemoEnabled });
  const resumeRepository = createResumeRepository({db, root: process.env.RESUME_FILE_ROOT || join(repoRoot, "data/resume-files")});
  const cleanups = [resumeRepository.cleanup, generationService.cleanupResumeMedia, generationService.purgeExpired];
  let sweeping = false;
  const cleanupTimer = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const cleanup of cleanups) {
        try { await cleanup(); } catch { /* Retry on the next sweep. */ }
      }
    } finally { sweeping = false; }
  }, 60_000);
  cleanupTimer.unref();
  const queueNotifications = createQueueNotifications(connectionString, db.schema);
  const handler = createRequestHandler({
    db, service, queueNotifications, generationService, resumeRepository, portraitEnabled: avatarDemoEnabled,
    agentToken: process.env.AGENT_SERVICE_TOKEN, paymentConfig: config, priceFen, configurationError,
    githubConfig: githubPagesConfig(), registerCleanup: (cleanup) => cleanups.push(cleanup)
  });

  return { db, service, generationService, handler, paymentConfig: config, priceFen, configurationError,
    async close() { clearInterval(cleanupTimer); await queueNotifications.close(); await db.close(); }
  };
}

export async function handleNextRouteRequest(request) {
  try {
    const { handler } = await getAppRuntime();
    return await dispatchWebRequest(request, handler);
  } catch {
    return Response.json({ error: "服务暂时不可用。" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
