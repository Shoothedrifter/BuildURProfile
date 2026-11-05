import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON || (existsSync("apps/agent/.venv/bin/python") ? "apps/agent/.venv/bin/python" : "python");
const result = spawnSync(python, ["-m", "pytest", "-q", "apps/agent/tests"], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
