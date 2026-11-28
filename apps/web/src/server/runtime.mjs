import { createResumeRepository } from "../../../../packages/storage/src/resumes/repository.mjs";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
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
  const development = process.env.NODE_ENV === "development";
  const sourceVersion = development ? runtimeSourceVersion() : undefined;
  const cached = globalThis[GLOBAL_RUNTIME_KEY];
  if (!cached || (development && cached.sourceVersion !== sourceVersion)) {
    // Fast Refresh replaces modules, while globalThis still owns the old service closures.
    const pending = Promise.resolve(cached).catch(() => null).then(async previous => {
      await previous?.close();
      return createRuntime();
    }).catch(error => {
      if (globalThis[GLOBAL_RUNTIME_KEY] === pending) delete globalThis[GLOBAL_RUNTIME_KEY];
      const code = /^[A-Z0-9_]{1,24}$/.test(error.code ?? "") ? error.code : "INITIALIZATION_FAILED";
      console.warn(`web runtime unavailable code=${code}`);
      throw error;
    });
    pending.sourceVersion = sourceVersion;
    globalThis[GLOBAL_RUNTIME_KEY] = pending;
  }
  return globalThis[GLOBAL_RUNTIME_KEY];
}

function runtimeSourceVersion() {
  const root = resolveRepoRoot();
  const version = createHash("sha256");
  // Development only: inspect code metadata, never environment files or private assets.
  for (const directory of ["apps/web/src/server", "packages/storage/src", "packages/contracts/src", "packages/skills/src"]) {
    const base = join(root, directory);
    for (const file of readdirSync(base, { recursive: true }).sort()) {
      if (!/\.(?:mjs|ts|json)$/.test(file) || /\.test\./.test(file)) continue;
      const { mtimeMs, size } = statSync(join(base, file));
      version.update(`${directory}/${file}:${mtimeMs}:${size}\n`);
    }
  }
  return version.digest("hex");
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
  const host = process.env.SERVER_HOST ?? "127.0.0.1";
  const avatarDemoEnabled = process.env.AVATAR_DEMO_ENABLED === "1" &&
    ["127.0.0.1", "localhost", "::1"].includes(host) && process.env.PAYMENT_ENV !== "production";
  const assetRoot = process.env.AVATAR_ASSET_ROOT || join(repoRoot, "data/avatar-assets");
  const generationService = createGenerationService({ db, assetRoot, allowPortraits: avatarDemoEnabled });
  // 项目保存时把直出照片内嵌为 data URL，需要读到私有资产区里的本人照片。
  const service = createPaymentService(db, { gateway, paymentConfig: config, configurationError,
    readHeroPhotoAsset: (sessionId, id) => generationService.readAsset(sessionId, id, "portrait") });
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

  let activeRequests = 0, resolveIdle, closing;
  return { db, service, generationService, handler, paymentConfig: config, priceFen, configurationError,
    async dispatch(request) {
      activeRequests++;
      try { return await dispatchWebRequest(request, handler); }
      finally {
        activeRequests--;
        if (!activeRequests) resolveIdle?.();
      }
    },
    close() {
      return closing ??= (async () => {
        clearInterval(cleanupTimer);
        await queueNotifications.close();
        if (activeRequests) await new Promise(resolve => { resolveIdle = resolve; });
        await db.close();
      })();
    }
  };
}

export async function handleNextRouteRequest(request) {
  try {
    const runtime = await getAppRuntime();
    return await runtime.dispatch(request);
  } catch {
    return Response.json({ error: "服务暂时不可用。" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
