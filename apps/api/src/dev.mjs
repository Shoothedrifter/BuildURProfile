import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

if (existsSync(".env")) process.loadEnvFile(".env");
const token = process.env.AGENT_SERVICE_TOKEN || randomBytes(32).toString("hex");
const apiEnv = { ...process.env, AGENT_SERVICE_TOKEN: token, AVATAR_DEMO_ENABLED: "1" };
delete apiEnv.OPENAI_API_KEY;
delete apiEnv.OPENAI_IMAGE_MODEL;
const agentEnv = { ...process.env, AGENT_SERVICE_TOKEN: token,
  AGENT_API_URL: `http://127.0.0.1:${process.env.SERVER_PORT || "8787"}` };
for (const key of Object.keys(agentEnv)) if (key.startsWith("ALIPAY_") || key.startsWith("PAYMENT_")) delete agentEnv[key];
if (existsSync(".env.agent")) {
  const file = parseEnv(readFileSync(".env.agent", "utf8"));
  for (const key of ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL", "IMAGE_PROVIDER", "AGENT_CHECKPOINT_PATH"]) {
    if (file[key] !== undefined) agentEnv[key] = file[key];
  }
}
const python = process.env.PYTHON || (existsSync("apps/agent/.venv/bin/python") ? "apps/agent/.venv/bin/python" : "python");

const children = [
  spawn(process.execPath, ["apps/api/src/index.mjs"], { stdio: "inherit", env: apiEnv }),
  spawn(python, ["-m", "buildurprofile_agent.server"], { stdio: "inherit", env: agentEnv }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", process.env.VITE_PORT || "5173", "--strictPort"], { stdio: "inherit" })
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) {
  child.on("exit", (code) => stop(code ?? 1));
  child.on("error", () => stop(1));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
