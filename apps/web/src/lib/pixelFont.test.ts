import { describe, expect, it } from "vitest";
import {
  PIXEL_FONT_FAMILY, PIXEL_FONT_LABEL_TEXT, pixelFontChapterLabels, pixelFontGlyphs,
  pixelFontFaceCss, pixelFontRequestHref,
} from "./pixelFontLabels.mjs";

describe("pixelFontGlyphs 汇总像素字体子集字符", () => {
  it("固定标签层文案的字形全部纳入（章节、按钮、计数、详情栏、展开项、兜底标题、P1 装饰文案）", () => {
    const fixed = ["起点", "关于", "作品", "经历", "联系", "查看作品", "查看经历", "了解更多", "联系我",
      "回到起点", "进入项目", "章节", "个项目", "项目详情", "关闭项目详情", "展开内容", "查看条目原文",
      "查看项目原文", "未命名项目", "像素世界", "作品档案", "经历与能力", "关于我", "取得联系",
      "你好", "向下滚动", "存档"];
    const glyphs = pixelFontGlyphs("");
    for (const text of fixed) {
      for (const char of text) expect(glyphs).toContain(char);
    }
    expect(glyphs).toContain("↘");
    expect(glyphs).toContain("↗");
    expect(glyphs).toContain("↑");
    expect(glyphs).toContain("×");
    expect(glyphs).toContain("▼");
    expect(glyphs).toContain("▶");
    expect(glyphs).toContain("0123456789");
  });

  it("合并用户姓名字形并去重（与标签重合的字形不重复请求）", () => {
    const glyphs = pixelFontGlyphs("王起点明");
    for (const char of "王起点明") expect(glyphs).toContain(char);
    expect(Array.from(glyphs).length).toBe(new Set(glyphs).size);
    expect(Array.from(glyphs).length).toBeLessThan(Array.from(PIXEL_FONT_LABEL_TEXT + "王起点明").length);
  });

  it("超长姓名截断到安全上限，保证请求字符数可控", () => {
    const long = "龙".repeat(200);
    expect(Array.from(pixelFontGlyphs(long)).length).toBeLessThanOrEqual(192);
  });
});

describe("pixelFontFaceCss 与请求地址", () => {
  it("生成 swap 策略的 woff2 @font-face", () => {
    const css = pixelFontFaceCss("/api/pixel-font?text=%E8%B5%B7%E7%82%B9");
    expect(css).toContain(`font-family:"${PIXEL_FONT_FAMILY}"`);
    expect(css).toContain("src:url(/api/pixel-font?text=%E8%B5%B7%E7%82%B9) format(\"woff2\")");
    expect(css).toContain("font-display:swap");
    expect(css).not.toContain("</style>");
  });

  it("请求地址编码姓名与标签字符", () => {
    const href = pixelFontRequestHref("王小明");
    expect(href.startsWith("/api/pixel-font?text=")).toBe(true);
    expect(decodeURIComponent(href.slice("/api/pixel-font?text=".length))).toContain("王");
    expect(decodeURIComponent(href.slice("/api/pixel-font?text=".length))).toContain("起点");
  });
});

describe("共享章节标签", () => {
  it("章节标签与页面导航使用同一份定义", () => {
    expect(pixelFontChapterLabels()).toEqual({ top: "起点", about: "关于", works: "作品", experience: "经历", contact: "联系" });
  });
});
