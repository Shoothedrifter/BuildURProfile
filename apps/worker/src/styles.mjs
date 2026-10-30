import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../data/wibi-style-pinned", import.meta.url));
const version = "17880b82ea35c1fe1ec4b8f907a053d314df464f";
const styles = [
  { id: "retro-flat-anime-head", label: "复古扁平动画头", description: "90 年代动画特写 · 鲜明纯色背景", promptHash: "43e43853445f77f2ff8e67fec31308088008c8ad84e15d242c6c0412ab9effb1", references: [] },
  { id: "crayon-flat-naive", label: "蜡笔极简扁平画", description: "手绘蜡笔肌理 · 白纸背景", promptHash: "4298ec0b9d015f1a9d6f6379e4a2a8f44fb67fa8989507019ee94622fb29e6ba", references: [
    ["reference-01.jpg", "86fb784b328c1cddc2828998c0b1ef94941c4ec06008f66a7c6fe3e0197178c2"],
    ["reference-02.jpg", "1b6d80402e5e0dcec3bf8af5ce5e3b1f830781fd116235c6575c49b4c79ad62c"]
  ] },
  { id: "textile-toy-portrait", label: "颗粒绒感玩偶", description: "针织玩偶肖像 · 白底棚拍", promptHash: "b0a86082b2a89d0abb352859995bd9bab075868481ec451c0fd55b086e189b69", references: [
    ["reference-01.jpeg", "9701bb8cb57b87a4bc6195f5e03eef45bdf00e947d67c5d73975cd5f20c2adf6"]
  ] }
];

function checked(path, hash) {
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("Wibi 风格资源校验失败，请重新安装固定版本。");
  return bytes;
}

export function listAvatarStyles() {
  return styles.map(({ id, label, description }) => ({ id, label, description }));
}

export function loadStyleRecipe(id, installationRoot = root) {
  const style = styles.find((entry) => entry.id === id);
  if (!style) throw new Error("未知肖像风格。");
  const base = resolve(installationRoot, "skills", style.id);
  const instructions = checked(join(base, "references/style-prompt.md"), style.promptHash).toString("utf8");
  const referencePaths = style.references.map(([name, hash]) => {
    const path = join(base, "assets/references", name);
    checked(path, hash);
    return path;
  });
  return { id, version, instructions, referencePaths, label: style.label };
}
