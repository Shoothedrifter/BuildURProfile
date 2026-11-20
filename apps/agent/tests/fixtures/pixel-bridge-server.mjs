import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../../packages/storage/src/database.mjs";
import { createGenerationService } from "../../../../packages/storage/src/generations.mjs";
import { createPaymentHttpServer } from "../../../web/src/server/http.mjs";
import { createPaymentService } from "../../../web/src/server/service.mjs";

const root = mkdtempSync(join(tmpdir(), "burp-pixel-bridge-"));
const db = openDatabase(":memory:");
const generationService = createGenerationService({ db, assetRoot: join(root, "assets") });
const service = createPaymentService(db, { gateway: null, paymentConfig: null });
const server = createPaymentHttpServer({ db, service, generationService, portraitEnabled: true,
  agentToken: process.env.AGENT_SERVICE_TOKEN, secret: Buffer.alloc(32, 8) });

server.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({
  baseUrl: `http://127.0.0.1:${server.address().port}`
}) + "\n"));
process.on("SIGTERM", () => server.close(() => { db.close(); rmSync(root, { recursive: true, force: true }); }));
