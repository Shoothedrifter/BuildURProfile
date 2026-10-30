import OpenAI, { toFile } from "openai";
import { readFileSync } from "node:fs";
import { imageSize } from "image-size";

export function createOpenAIImageProvider({ apiKey = process.env.OPENAI_API_KEY, model = process.env.AVATAR_IMAGE_MODEL || "gpt-image-2.5-flare", client } = {}) {
  return {
    async edit({ portrait, recipe }) {
      if (!apiKey && !client) throw new Error("未配置 OPENAI_API_KEY，无法生成肖像。");
      const api = client ?? new OpenAI({ apiKey });
      const image = [await toFile(portrait.bytes, "portrait" + (portrait.mime === "image/png" ? ".png" : portrait.mime === "image/webp" ? ".webp" : ".jpg"), { type: portrait.mime })];
      let references = recipe.referencePaths;
      if (recipe.id === "crayon-flat-naive" && references.length === 2) {
        const size = imageSize(portrait.bytes);
        references = [references[size.width / size.height < 0.75 ? 1 : 0]];
      }
      for (const path of references) image.push(await toFile(readFileSync(path), path.split("/").at(-1)));
      const prompt = `第一张图片是用户本人照片，决定人物身份、人数、脸、姿态、衣物和配饰。其余图片只供视觉风格参考，不复制参考人物。请生成一张可用于个人作品集首屏的方形静态角色肖像。保留原风格背景，不加文字、水印或分屏。\n\n风格规则：\n${recipe.instructions}`;
      const result = await api.images.edit({ model, image, prompt, size: "1024x1024", quality: "medium" });
      const encoded = result.data?.[0]?.b64_json;
      if (!encoded) throw new Error("图像服务没有返回成图。");
      return { bytes: Buffer.from(encoded, "base64"), mime: "image/png" };
    }
  };
}
