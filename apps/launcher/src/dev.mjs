import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

if (existsSync(".env")) process.loadEnvFile(".env");
const token = process.env.AGENT_SERVICE_TOKEN || randomBytes(32).toString("hex");
const webPort = process.env.VITE_PORT || process.env.PORT || "5173";
const host = process.env.SERVER_HOST || "127.0.0.1";

const webEnv = {
  ...process.env,
  AGENT_SERVICE_TOKEN: token,
  AVATAR_DEMO_ENABLED: "1",
  SERVER_HOST: host,
  SERVER_PORT: webPort
};
delete webEnv.OPENAI_API_KEY;
delete webEnv.OPENAI_IMAGE_MODEL;
delete webEnv.RESUME_TEXT_MODEL;
delete webEnv.CLOUDFLARE_API_TOKEN;
delete webEnv.CLOUDFLARE_ACCOUNT_ID;

const agentEnv = {
  ...process.env,
  AGENT_SERVICE_TOKEN: token,
  AGENT_API_URL: `http://${host}:${webPort}`
};
for (const key of Object.keys(agentEnv)) {
  if (key.startsWith("ALIPAY_") || key.startsWith("PAYMENT_")) delete agentEnv[key];
}
if (existsSync(".env.agent")) {
  const file = parseEnv(readFileSync(".env.agent", "utf8"));
  for (const key of ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL", "RESUME_TEXT_MODEL", "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN", "IMAGE_PROVIDER", "AGENT_CHECKPOINT_PATH", "AGENT_RESUME_WORKER_ID"]) {
    if (file[key] !== undefined) agentEnv[key] = file[key];
  }
}

const defaultVenv = existsSync("apps/agent/.venv/bin/python")
  ? "apps/agent/.venv/bin/python"
  : existsSync("apps/agent/.venv/Scripts/python.exe")
    ? "apps/agent/.venv/Scripts/python.exe"
    : "python";
const python = process.env.PYTHON || defaultVenv;
const nextBin = fileURLToPath(new URL("../../../node_modules/next/dist/bin/next", import.meta.url));

const children = [
  spawn(process.execPath, [nextBin, "dev", "apps/web", "-H", host, "-p", webPort], { stdio: "inherit", env: webEnv }),
  spawn(python, ["-m", "buildurprofile_agent.server"], { stdio: "inherit", env: agentEnv })
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
