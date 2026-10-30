import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("当前本地生图方案需要 Apple Silicon macOS。");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["scripts/install-wibi-demo.mjs"]);
const venv = join(process.cwd(), "data/avatar-venv");
if (!existsSync(join(venv, "bin/python"))) run("uv", ["venv", venv, "--python", "3.13"]);
run("uv", ["pip", "install", "--python", join(venv, "bin/python"), "mflux==0.23.0", "pillow==12.3.0"]);
process.stdout.write("本地 MFLUX 已安装。若模型尚未缓存，首次生图会从 Hugging Face 下载约 8.6 GB 的 FLUX.2 Klein 4B 预量化权重到 data/avatar-model-cache。\n");
