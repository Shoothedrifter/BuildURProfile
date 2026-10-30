import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../../api/src/database.mjs";
import { createGenerationService } from "../../api/src/generations.mjs";
import { buildGenerationGraph } from "./graph.mjs";
import { loadStyleRecipe } from "./styles.mjs";
import { createLocalImageProvider } from "./provider-local.mjs";
import { openPrivateCheckpointer, runNextGeneration } from "./runner.mjs";

const localEnvFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
if (process.env.AVATAR_DEMO_ENABLED !== "1" || process.env.PAYMENT_ENV === "production") {
  process.stderr.write("Avatar worker is available only in the private local demo.\n");
  process.exit(1);
}
const databasePath = process.env.DATABASE_PATH?.trim() || fileURLToPath(new URL(process.env.PAYMENT_ENV === "production"
  ? "../../../data/buildurprofile-production.sqlite" : "../../../data/buildurprofile.sqlite", import.meta.url));
const db = openDatabase(databasePath);
const service = createGenerationService({ db, assetRoot: process.env.AVATAR_ASSET_ROOT || "data/avatar-assets" });
service.recoverRunning();
service.purgeExpired();
const checkpointer = openPrivateCheckpointer(process.env.AVATAR_CHECKPOINT_PATH || fileURLToPath(new URL("../../../data/avatar-checkpoints.sqlite", import.meta.url)));
const graph = buildGenerationGraph({ styleLoader: loadStyleRecipe, provider: createLocalImageProvider(), checkpointer,
  assets: { readPortrait: (id) => service.readAssetForWorker(id), storeOutput: service.storeOutput,
    outputExists: service.outputExists, existingOutput: service.existingOutput } });
let active = false;
async function tick() {
  if (active) return;
  active = true;
  try { while (await runNextGeneration({ service, graph })) { /* drain queue */ } }
  finally { active = false; }
}
const timer = setInterval(() => void tick(), 800);
const cleanup = setInterval(() => service.purgeExpired(), 60 * 60 * 1000);
void tick();
process.on("SIGTERM", () => { clearInterval(timer); clearInterval(cleanup); db.close(); });
