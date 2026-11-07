import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const defaultVenv = existsSync("apps/agent/.venv/bin/python")
  ? "apps/agent/.venv/bin/python"
  : existsSync("apps/agent/.venv/Scripts/python.exe")
    ? "apps/agent/.venv/Scripts/python.exe"
    : "python";
const python = process.env.PYTHON || defaultVenv;
const result = spawnSync(python, ["-m", "pytest", "-q", "apps/agent/tests"], {
  stdio: "inherit",
  env: { ...process.env, PYTHONUTF8: "1" }
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
