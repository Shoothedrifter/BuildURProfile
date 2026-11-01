const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 350 * 1024;

export async function preparePortrait(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > MAX_FILE_BYTES) {
    throw new Error("请选择 10 MiB 以内的 PNG、JPEG 或 WebP 单人照片。");
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("照片读取失败，请重新选择 PNG、JPEG 或 WebP 图片。"); }
  try {
    if (Math.min(bitmap.width, bitmap.height) < 256 || Math.max(bitmap.width, bitmap.height) > 8000) {
      throw new Error("请选择宽高均为 256–8000 像素的照片。");
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理照片，请更换浏览器重试。");
    for (const [edge, quality] of [[1024, 0.8], [768, 0.7], [512, 0.6]]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
      if (Math.min(width, height) < 256) break;
      canvas.width = width; canvas.height = height;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (!dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("照片压缩失败，请更换浏览器重试。");
      if (dataUrl.length <= Math.ceil(MAX_OUTPUT_BYTES * 4 / 3) + 23) return dataUrl;
    }
    throw new Error("照片压缩后仍过大，请选择更清晰、背景更简单的照片。");
  } finally {
    bitmap.close();
  }
}
