import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyAgentEnvFile, readAgentEnvFile } from "./agent-env.mjs";
import { sanitizeWebEnv } from "./web-env.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const token = process.env.AGENT_SERVICE_TOKEN || randomBytes(32).toString("hex");
const webPort = process.env.VITE_PORT || process.env.PORT || "5173";
const host = process.env.SERVER_HOST || "127.0.0.1";

// web 子进程 env：剔除 Agent 专用的供应商密钥/模型变量，规则集中在 web-env.mjs
const webEnv = sanitizeWebEnv({
  ...process.env,
  AGENT_SERVICE_TOKEN: token,
  AVATAR_DEMO_ENABLED: "1",
  SERVER_HOST: host,
  SERVER_PORT: webPort
});

const agentEnv = {
  ...process.env,
  AGENT_SERVICE_TOKEN: token,
  AGENT_API_URL: `http://${host}:${webPort}`
};
// .env.agent 透传给 Agent 进程（剔除 Web 专用配置），与 scripts/run-python-agent.mjs 共用同一逻辑；
// 新增供应商变量无需再改启动脚本。
const agentFile = readAgentEnvFile();
applyAgentEnvFile(agentEnv, agentFile);
if (agentFile.RESUME_TEXT_PROVIDER !== undefined) webEnv.RESUME_TEXT_PROVIDER = agentFile.RESUME_TEXT_PROVIDER;

const defaultVenv = existsSync("apps/agent/.venv/bin/python")
  ? "apps/agent/.venv/bin/python"
  : existsSync("apps/agent/.venv/Scripts/python.exe")
    ? "apps/agent/.venv/Scripts/python.exe"
    : "python";
const python = process.env.PYTHON || defaultVenv;
const nextBin = fileURLToPath(new URL("../../../node_modules/next/dist/bin/next", import.meta.url));

const children = [
  // Next 16.4.5 Turbopack can repeatedly restart an unchanged client chunk; Webpack keeps Fast Refresh active.
  spawn(process.execPath, [nextBin, "dev", "apps/web", "-H", host, "-p", webPort, "--webpack"], { stdio: "inherit", env: webEnv }),
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
