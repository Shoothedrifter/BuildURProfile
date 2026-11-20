// 像素字体标签层共享模块：组件（TS）与导出/接口（服务端 .mjs）共用一份字符集与文案。
// 字形子集交给 /api/pixel-font 按需生成，导出时内嵌 data URI，见 server/pixel-font.mjs。

export const PIXEL_FONT_FAMILY = "FusionPixel";

// 固定 UI 文案层：章节导航、按钮、档案计数、详情栏、展开项、兜底标题与 P1 装饰文案。
// 新增固定文案时同步补进这里，页面测试会校验章节与按钮字形覆盖。
const PIXEL_FONT_FIXED_TEXT = [
  "起点关于作品经历联系",
  "查看作品查看经历了解更多联系我回到起点进入项目",
  "章节个项目项目详情关闭项目详情",
  "展开内容查看条目原文查看项目原文",
  "未命名项目像素世界作品档案经历与能力关于我取得联系",
  "你好！向下滚动存档",
  "0123456789",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  " ↘↗↑×★·-—▼▶",
].join("");

export const PIXEL_FONT_LABEL_TEXT = Array.from(new Set(PIXEL_FONT_FIXED_TEXT)).join("");

// 请求字符数上限：标签层约 130 个去重字形，加上常见姓名仍有富余；服务端按同一上限校验。
const GLYPH_LIMIT = 192;

export function pixelFontGlyphs(name = "") {
  const merged = new Set(Array.from(PIXEL_FONT_LABEL_TEXT));
  for (const char of Array.from(name.trim()).slice(0, GLYPH_LIMIT)) merged.add(char);
  return Array.from(merged).slice(0, GLYPH_LIMIT).join("");
}

export function pixelFontFaceCss(src) {
  return `@font-face{font-family:"${PIXEL_FONT_FAMILY}";src:url(${src}) format("woff2");font-display:swap;}`;
}

export function pixelFontRequestHref(name) {
  return `/api/pixel-font?text=${encodeURIComponent(pixelFontGlyphs(name))}`;
}

export function pixelFontChapterLabels() {
  return { top: "起点", about: "关于", works: "作品", experience: "经历", contact: "联系" };
}
