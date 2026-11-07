import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const localEnvFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
if (process.env.NODE_ENV === "production" && !process.env.AGENT_SERVICE_TOKEN) {
  throw new Error("AGENT_SERVICE_TOKEN is required in production.");
}

const host = process.env.SERVER_HOST ?? "127.0.0.1";
const port = String(process.env.SERVER_PORT ?? 8787);
const nextBin = fileURLToPath(new URL("../../../node_modules/next/dist/bin/next", import.meta.url));

const child = spawn(process.execPath, [nextBin, "start", "apps/web", "-H", host, "-p", port], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "production", SERVER_HOST: host, SERVER_PORT: port }
});

child.on("exit", (code) => { process.exitCode = code ?? 0; });
child.on("error", () => { process.exitCode = 1; });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
