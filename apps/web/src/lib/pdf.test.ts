import { describe, expect, it } from "vitest";
import { normalizePdfTextItems } from "./pdf";

describe("normalizePdfTextItems", () => {
  it("preserves PDF.js line endings and removes repeated intra-line whitespace", () => {
    const text = normalizePdfTextItems([
      { str: "Senior ", hasEOL: false },
      { str: "  Engineer", hasEOL: true },
      { str: "React\t TypeScript\u00a0", hasEOL: true },
      { str: "项目", hasEOL: false },
      { str: "：搜索系统", hasEOL: false }
    ]);

    expect(text).toBe("Senior Engineer\nReact TypeScript\n项目：搜索系统");
  });

  it("ignores marked content and blank lines without dropping neighboring text", () => {
    const text = normalizePdfTextItems([
      { type: "beginMarkedContent" },
      { str: "  ", hasEOL: true },
      { str: "教育", hasEOL: true },
      { type: "endMarkedContent" },
      { str: "硕士", hasEOL: true }
    ]);

    expect(text).toBe("教育\n硕士");
  });

  it("uses page positions when PDF drawing order puts headings before their content", () => {
    const at = (str: string, x: number, y: number) => ({
      str,
      hasEOL: true,
      transform: [1, 0, 0, 1, x, y]
    });
    const text = normalizePdfTextItems([
      at("教育背景", 67, 673),
      at("项目实践", 67, 452),
      at("GPA：4.04 / 5", 45, 650),
      at("基于物联网的系统", 40, 421)
    ]);

    expect(text).toBe("教育背景\nGPA：4.04 / 5\n项目实践\n基于物联网的系统");
  });
});
