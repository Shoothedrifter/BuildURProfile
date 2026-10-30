import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadStyleRecipe, listAvatarStyles } from "../apps/worker/src/styles.mjs";

const root = join(process.cwd(), "data/wibi-style-pinned");
const version = "17880b82ea35c1fe1ec4b8f907a053d314df464f";
function git(...args) {
  const result = spawnSync("git", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(join(root, ".git"))) {
  if (existsSync(root)) throw new Error("data/wibi-style-pinned exists but is not the expected Git checkout.");
  git("clone", "--filter=blob:none", "--sparse", "--depth", "1", "https://github.com/Vieeeeeee/wibi-style.git", root);
}
git("-C", root, "fetch", "--filter=blob:none", "--depth", "1", "origin", version);
git("-C", root, "sparse-checkout", "set", "--no-cone", "/LICENSE", "/NOTICE",
  "/skills/retro-flat-anime-head/**", "/skills/crayon-flat-naive/**", "/skills/textile-toy-portrait/**");
git("-C", root, "checkout", "--detach", version);
for (const style of listAvatarStyles()) loadStyleRecipe(style.id, root);
process.stdout.write(`Verified ${listAvatarStyles().length} Wibi Style recipes at ${version}.\n`);
