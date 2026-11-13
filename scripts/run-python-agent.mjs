import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { applyAgentEnvFile, readAgentEnvFile } from "../apps/launcher/src/agent-env.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const env = { ...process.env, PYTHONUTF8: "1" };
for (const key of Object.keys(env)) if (key.startsWith("ALIPAY_") || key.startsWith("PAYMENT_")) delete env[key];
// .env.agent 全量透传（剔除支付前缀），与 apps/launcher/src/dev.mjs 共用同一逻辑；
// 新增供应商变量无需再改启动脚本。
applyAgentEnvFile(env, readAgentEnvFile());
const defaultVenv = existsSync("apps/agent/.venv/bin/python")
  ? "apps/agent/.venv/bin/python"
  : existsSync("apps/agent/.venv/Scripts/python.exe")
    ? "apps/agent/.venv/Scripts/python.exe"
    : "python";
const python = process.env.PYTHON || defaultVenv;
const child = spawn(python, ["-m", "buildurprofile_agent.server"], { stdio: "inherit", env });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
