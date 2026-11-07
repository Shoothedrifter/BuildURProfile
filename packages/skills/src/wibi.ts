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
  { id: "yellow-hair-doodle",
    localSummary: "原图人物和发型结构优先：保留脸、刘海、发束数量及扎点高低。生成 1:1 明黄底 #FFCB05 的黑白剪贴发流头像，仅在原有发束内做柔和弯曲，留白处画少量朱红 #BC2926 小涂鸦。",
    promptOverride: [
      "输入照片是唯一的人物依据。首要任务是保留本人脸型、五官比例、年龄感、表情、头部角度、刘海、发际线、原有配饰，以及发束数量和扎点高低。不新增眼镜、耳饰、发绳或其他配件。",
      "先判断原图是披发、单马尾、双马尾、辫子、盘发还是短发，再保持原有发型。若原图是双马尾，左右各有一束独立马尾与原有扎点；不能把扎起的双马尾画成披发。若原图是低双马尾，扎点必须留在耳后下方或颈侧，两束从那里向下垂落，不能抬成高双马尾。原图看不到发绳时只画头发自然收紧的形状，不凭空画明显皮筋；不要把马尾编成辫子或增加第二个扎点。若原图不是双马尾，也不要凭空增加双马尾。",
      "做一张 1:1 明黄底 #FFCB05 的超现实发流头像海报。保留完整头部和两侧原有发束；只在现有发束的末段做轻柔弯曲，发际线、贴脸头发与扎点保持不动。脸和头发呈明亮细腻的黑白灰摄影剪贴与铅笔发丝质感；去掉原背景、肩膀和衣服，必要时保留少量颈侧头发以呈现低扎点。明黄留白处画少量极小朱红 #BC2926 音符与星星，不遮脸。无文字、签名、边框、投影或额外人物。"
    ].join("\n\n"),
    manifestHash: "ea9e099ffa5b0dbb0ab6c2b3ef67a0feaa6f2b773c9c39592b1b5aea9b90870d",
    promptHash: "0bfbead5e0290aeafcb566b05520d3b51385792353fd580912589c57320b3579", references: [] },
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
