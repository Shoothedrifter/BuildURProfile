import { pdf } from '../../../launcher/src/test-fixtures/resume-pdf.mjs';
import { createResumeRepository } from '../../../../packages/storage/src/resumes/repository.mjs';
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { openDatabase } from "../../../../packages/storage/src/database.mjs";
import { createGenerationService } from "../../../../packages/storage/src/generations.mjs";
import { createPaymentHttpServer } from "../../../web/src/server/http.mjs";

const root = mkdtempSync(join(tmpdir(), "burp-python-bridge-"));
const db = openDatabase(join(root, "app.sqlite"));
const brief = JSON.parse(readFileSync("packages/contracts/fixtures/agent-golden.v1.json", "utf8")).input;
db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("test-owner", Date.now(), Date.now() + 100_000);
const generationService = createGenerationService({ db, assetRoot: join(root, "assets"), minPixels: 1 });
const queued = generationService.enqueue("test-owner", { brief, idempotencyKey: "python-bridge-integration" });
const portraitPath = process.env.AGENT_TEST_PORTRAIT_PATH;
const portraitBytes = portraitPath ? readFileSync(portraitPath) : Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=", "base64");
const portraitMime = portraitPath ? ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp" })[extname(portraitPath).toLowerCase()] : "image/png";
if (!portraitMime) throw new Error("Unsupported test portrait format");
const portrait = generationService.savePortrait("test-owner", `data:${portraitMime};base64,${portraitBytes.toString("base64")}`);
const queuedPortrait = generationService.enqueue("test-owner", { brief, idempotencyKey: "python-bridge-photo",
  portraitAssetId: portrait.id, styleId: "retro-flat-anime-head" });
const resumeRepository = createResumeRepository({db,root:join(root,'resumes')});
const ocrRequested=process.env.AGENT_TEST_OCR==='1';
const uploadedResume = await resumeRepository.upload('test-owner',pdf(1,!ocrRequested),'synthetic.pdf','application/pdf');
const parsedResume = resumeRepository.queue.parse('test-owner',{fileId:uploadedResume.fileId,idempotencyKey:'python-resume-bridge',ocrRequested});
const token = process.env.AGENT_SERVICE_TOKEN;
const server = createPaymentHttpServer({ db, service: {}, generationService, resumeRepository, portraitEnabled: true,
  agentToken: token, secret: Buffer.alloc(32, 7), agentStyleLoader: (id) => ({ id, version: "test-v1",
    license: "MIT AND LicenseRef-Wibi-Personal-NonCommercial-1.0", sourceCommit: "test", manifestVersion: "1",
    attribution: "test", instructions: "flat anime portrait with solid colored background",
    localSummary: "anime", referencePaths: [] }) });
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({ baseUrl: `http://127.0.0.1:${server.address().port}`,
    taskId: queued.id, portraitTaskId: queuedPortrait.id, resumeId:parsedResume.resumeId })}\n`);
});
process.on("SIGTERM", () => server.close(() => { db.close(); rmSync(root, { recursive: true, force: true }); }));
