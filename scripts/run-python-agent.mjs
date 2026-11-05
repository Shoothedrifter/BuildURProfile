import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { parseEnv } from "node:util";

if (existsSync(".env")) process.loadEnvFile(".env");
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("ALIPAY_") || key.startsWith("PAYMENT_")) delete env[key];
if (existsSync(".env.agent")) {
  const file = parseEnv(readFileSync(".env.agent", "utf8"));
  for (const key of ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL", "IMAGE_PROVIDER", "AGENT_CHECKPOINT_PATH"]) {
    if (file[key] !== undefined) env[key] = file[key];
  }
}
const python = process.env.PYTHON || (existsSync("apps/agent/.venv/bin/python") ? "apps/agent/.venv/bin/python" : "python");
const child = spawn(python, ["-m", "buildurprofile_agent.server"], { stdio: "inherit", env });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
