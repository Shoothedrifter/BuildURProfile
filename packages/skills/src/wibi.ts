import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AVATAR_STYLES } from "./avatar-catalog.ts";

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
  { id: "crayon-flat-naive",
    localSummary: "把照片重新画成儿童画般的极简扁平蜡笔插画，保留本人姿态、穿搭和 2–5 个识别锚点。白或微暖白纸面、鲜亮大色块、松散轻抖的铅笔蜡笔轮廓、少量颗粒漏白、密集短黑笔触头发、小黑点眼睛。无真实光影、渐变、照片滤镜、3D 或复杂背景。",
    manifestHash: "437db63a3e479b2f775cf6f25732c7bed416273c0f58b54b8b38fbd4ca900e03",
    promptHash: "4298ec0b9d015f1a9d6f6379e4a2a8f44fb67fa8989507019ee94622fb29e6ba", references: [
      ["reference-01.jpg", "86fb784b328c1cddc2828998c0b1ef94941c4ec06008f66a7c6fe3e0197178c2"],
      ["reference-02.jpg", "1b6d80402e5e0dcec3bf8af5ce5e3b1f830781fd116235c6575c49b4c79ad62c"]
    ] },
  { id: "textile-toy-portrait",
    localSummary: "将照片人物重构成 3D 纺织艺术玩偶胸像，保留本人发型、表情、姿态、服装和真实配饰。横向圆角巨头占画宽 75%–90%，极小集中五官、脸部留白、细颗粒绒脸、粗针织或钩织头发与服装；3–5 色，微暖白无缝棚拍背景和短轻阴影。不要塑料、软陶、写实皮肤或新增道具。",
    manifestHash: "d3b51785b461f4e39881f8400a9e8a6abd94f10606bfe2fd9b23dab3904b3bf7",
    promptHash: "b0a86082b2a89d0abb352859995bd9bab075868481ec451c0fd55b086e189b69", references: [
      ["reference-01.jpeg", "9701bb8cb57b87a4bc6195f5e03eef45bdf00e947d67c5d73975cd5f20c2adf6"]
    ] }
];

function checked(path: string, expectedHash: string): Buffer {
  const bytes = readFileSync(/*turbopackIgnore: true*/ path);
  const directHash = createHash("sha256").update(bytes).digest("hex");
  if (directHash === expectedHash) return bytes;
  const normalizedLf = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  if (createHash("sha256").update(normalizedLf).digest("hex") === expectedHash) return normalizedLf;
  throw new Error("Wibi 风格资源校验失败，请重新安装固定版本。");
}

export function listAvatarStyles(): Array<{ id: string; label: string; description: string }> {
  return AVATAR_STYLES.map(({ id, label, description }) => ({ id, label, description }));
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
  const instructions = checked(join(base, "references/style-prompt.md"), style.promptHash).toString("utf8");
  const referencePaths = style.references.map(([name, hash], index) => {
    if (manifest.references[index]?.file !== `assets/references/${name}` || manifest.references[index]?.source_sha256 !== hash) {
      throw new Error("Wibi 参考资源清单与已审核配方不一致。");
    }
    const path = join(base, "assets/references", name);
    checked(path, hash);
    return path;
  });
  const label = AVATAR_STYLES.find((entry) => entry.id === id)?.label;
  return { id, version: sourceCommit, sourceCommit, manifestVersion: manifest.version as string,
    license, attribution: manifest.attribution?.text as string,
    instructions, referencePaths, localSummary: style.localSummary, label };
}
