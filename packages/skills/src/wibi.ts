import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AVATAR_STYLES } from "./avatar-catalog.ts";
export { listAvatarStyles } from "./avatar-catalog.ts";

function resolveRepoRoot(): string {
  const cwd = process.cwd();
  return existsSync(/*turbopackIgnore: true*/ join(cwd, "packages/contracts/package.json")) ? cwd : resolve(cwd, "../..");
}

const defaultInstallationRoot = join(resolveRepoRoot(), "data/wibi-style-pinned");
const sourceCommit = "17880b82ea35c1fe1ec4b8f907a053d314df464f";
const license = "MIT AND LicenseRef-Wibi-Personal-NonCommercial-1.0";

type StyleEntry = Readonly<{
  id: string;
  localSummary: string;
  promptOverride?: string;
  manifestHash: string;
  promptHash: string;
  references: readonly (readonly [string, string])[];
}>;

/** Reviewed style resources only. A downloaded SKILL.md is never executed. */
const styles: readonly StyleEntry[] = [
  { id: "retro-flat-anime-head",
    localSummary: "90 年代电视动画特写，头占画面 75%–90%。保留本人脸型、头向、发型、表情和照片中实际存在的配饰。粗细变化的黑色轮廓线、尖锐发梢、黑豆形眼睛、珊瑚红唇；蜜桃色平涂皮肤配 2–4 块锐利硬边阴影。背景是一整块高饱和纯色。绝无渐变、写实纹理、3D 或娃娃脸。",
    manifestHash: "5aeb9a1bb54cb6e06a88634711a0b5acac900414ce0c3e4277b49160d4be23a3",
    promptHash: "43e43853445f77f2ff8e67fec31308088008c8ad84e15d242c6c0412ab9effb1", references: [] },
  { id: "lofi-print-anime",
    localSummary: "将本人单人肖像转译为 1:1 低清印刷感动漫极近景头像。保留脸型、头向、视线、表情、发型和真实配饰；粉绿双色霓虹发束、浅粉肤色、蓝黑动漫眼睛，叠加全画面 CMYK 网点、纸感、轻微套印错位和低清扫描颗粒。几乎不留背景，不新增人物、道具、文字或 logo。",
    manifestHash: "c92a64630a455682feb3fbf1f10a7c72b2936a7442096dbd619e3ad685f684d2",
    promptHash: "435f858d3dc6a04f2c5de12f00918745ba8c5e78a6a990f3f6a2394cde8a77c1", references: [] }
];

function checked(path: string, expectedHash: string): Buffer {
  const bytes = readFileSync(/*turbopackIgnore: true*/ path);
  const directHash = createHash("sha256").update(bytes).digest("hex");
  if (directHash === expectedHash) return bytes;
  const normalizedLf = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  if (createHash("sha256").update(normalizedLf).digest("hex") === expectedHash) return normalizedLf;
  throw new Error("Wibi 风格资源校验失败，请重新安装固定版本。");
}

export function loadStyleRecipe(id: string, installationRoot = defaultInstallationRoot) {
  const style = styles.find((entry) => entry.id === id);
  if (!style) throw new Error("未知肖像风格。");
  const base = resolve(installationRoot, "skills", style.id);
  const manifest = JSON.parse(checked(join(base, "manifest.json"), style.manifestHash).toString("utf8"));
  if (manifest.slug !== style.id || manifest.license !== license || manifest.prompt?.file !== "references/style-prompt.md" ||
      manifest.references?.length !== style.references.length || manifest.input?.type !== "single-photo-restyle") {
    throw new Error("Wibi 风格清单与已审核配方不一致。");
  }
  const sourceInstructions = checked(join(base, "references/style-prompt.md"), style.promptHash).toString("utf8");
  const instructions = style.promptOverride ?? sourceInstructions;
  const referencePaths = style.references.map(([name, hash], index) => {
    if (manifest.references[index]?.file !== `assets/references/${name}` || manifest.references[index]?.source_sha256 !== hash) {
      throw new Error("Wibi 参考资源清单与已审核配方不一致。");
    }
    const path = join(base, "assets/references", name);
    checked(path, hash);
    return path;
  });
  const label = AVATAR_STYLES.find((entry) => entry.id === id)?.label;
  const version = style.promptOverride ? `${sourceCommit}+${createHash("sha256").update(instructions).digest("hex").slice(0, 12)}` : sourceCommit;
  return { id, version, sourceCommit, manifestVersion: manifest.version as string,
    license, attribution: manifest.attribution?.text as string,
    instructions, referencePaths, localSummary: style.localSummary, label };
}
