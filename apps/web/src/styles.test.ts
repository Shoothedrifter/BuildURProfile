import { afterEach, expect, it } from "vitest";
import cssSource from "./styles.css?raw";
import "./styles.css";

afterEach(() => {
  document.body.replaceChildren();
});

// CSS Grid 规范：grid-template 里的命名区域必须构成单个矩形；
// 一旦某名字的格子被切断（例如 press 行插进 stage 跨度中间），整条声明无效，
// 浏览器直接丢弃——布局退化为自动放置，元素互相重叠。jsdom 不做真实布局，
// 因此这里对 styles.css 源文本做静态校验，防止再次引入非矩形区域。

function gridTemplateDeclarations(css: string): string[] {
  return Array.from(css.matchAll(/(?:^|[^-\w])grid-template\s*:\s*([^;]+);/g), match => match[1]);
}

function nonRectangularAreas(declaration: string): string[] {
  const rows = Array.from(declaration.matchAll(/"([^"]+)"/g), match => match[1].trim().split(/\s+/));
  const cells = new Map<string, Array<[number, number]>>();
  rows.forEach((row, r) => row.forEach((name, c) => {
    if (name === ".") return;
    const list = cells.get(name) ?? [];
    list.push([r, c]);
    cells.set(name, list);
  }));
  const broken: string[] = [];
  for (const [name, list] of cells) {
    const rowsUsed = list.map(([r]) => r), colsUsed = list.map(([, c]) => c);
    const box = (Math.max(...rowsUsed) - Math.min(...rowsUsed) + 1) * (Math.max(...colsUsed) - Math.min(...colsUsed) + 1);
    if (box !== list.length) broken.push(name);
  }
  return broken;
}

it("keeps every named grid-template area rectangular", () => {
  const broken = gridTemplateDeclarations(cssSource).flatMap(nonRectangularAreas);
  expect(broken).toEqual([]);
});

// 像素画必须整数倍缩放：头像源是 512x512（16x 的 32 网格），舞台主宽度
// 收敛到 32rem（=512px，1:1）才能让 image-rendering: pixelated 的颗粒均匀；
// 非整数倍（如 24rem=384px=0.75x）会出现像素列宽不一的糊感。
it("keeps the hero stage at an integer multiple of the 512px portrait source", () => {
  const stage = cssSource.match(/\.pixel-stage\s*\{[^}]*\}/)?.[0] ?? "";
  expect(stage).toMatch(/width:\s*min\(100%,\s*32rem\)/);
});

it("bounds the desktop hero stage track independently of the SVG's intrinsic size", () => {
  const hero = cssSource.match(/\.pixel-hero\s*\{[^}]*\}/)?.[0] ?? "";
  expect(hero).toMatch(/\/\s*minmax\(0,\s*1fr\)\s+min\(48%,\s*32rem\)/);
});

// 像素画布纪律（对标 jld2nd.dev）：纯实心黑画布 + 真实方块装饰。
// 任何 gradient（CRT 扫描线、repeating 线网格、mask 渐隐）都会把「方块像素」
// 退化成「纹理」，这是横线状背景的根因，禁止再次引入。
it("keeps the pixel canvas free of gradients", () => {
  const blocks = cssSource.match(/\.pixel-[\w-]+[^{}]*\{[^}]*\}/g) ?? [];
  const offenders = blocks.filter(block => block.includes("gradient("));
  expect(offenders).toEqual([]);
});

// 画布必须是中性黑（jld2nd 同款 #121212）；蓝黑底色会让暗部发蓝灰，
// 削弱「纯黑画布」的观感。面板与边框令牌同样走中性灰黑。
it("uses a neutral black canvas", () => {
  expect(cssSource).toMatch(/--pixel-page:\s*#121212/);
  expect(cssSource).toMatch(/--pixel-panel:\s*#1a1a1c/);
  expect(cssSource).toMatch(/--pixel-border:\s*#3d3d44/);
});

// UI accent 全套对齐 jld2nd 原站令牌：lime #CEFF00 强调、纯白正文、#9e9e9e 灰、
// 纯黑硬边投影。头像管线使用同一套固定色板，同框不冲突。
it("aligns UI tokens with the jld2nd palette", () => {
  expect(cssSource).toMatch(/--pixel-accent:\s*#ceff00/);
  expect(cssSource).toMatch(/--pixel-text:\s*#ffffff/);
  expect(cssSource).toMatch(/--pixel-muted:\s*#9e9e9e/);
  expect(cssSource).toMatch(/--pixel-shadow:\s*#000000/);
});

// 预设按钮底色接替：五个预设各有个性化底色；macaron 接替 warm 后，
// 旧 data-preset="warm" 规则是死规则（按钮不再渲染该值），不得残留。
it("styles the macaron preset button and drops the retired warm rule", () => {
  expect(cssSource).toMatch(/\.proof-style-options button\[data-preset="macaron"\]\s*\{[^}]*background/);
  expect(cssSource).not.toMatch(/data-preset="warm"/);
});

it("keeps the legacy entry selector spaced and limits right alignment to Agent tools", () => {
  document.body.innerHTML = `
    <div class="proof-entry-top" data-testid="legacy-entry">
      <label><input type="checkbox" />用于展示</label>
      <span>PDF · 第 1 页</span>
    </div>
    <div class="proof-entry-top proof-entry-top--tools" data-testid="agent-tools">
      <div class="proof-entry-tools">条目工具</div>
    </div>`;

  const legacy = document.querySelector<HTMLElement>("[data-testid='legacy-entry']")!;
  const legacyLabel = legacy.querySelector<HTMLLabelElement>("label")!;
  const agentTools = document.querySelector<HTMLElement>("[data-testid='agent-tools']")!;

  expect(getComputedStyle(legacy).justifyContent).toBe("space-between");
  expect(getComputedStyle(legacyLabel).display).toBe("inline-flex");
  expect(getComputedStyle(legacyLabel).fontWeight).toBe("700");
  expect(getComputedStyle(agentTools).justifyContent).toBe("flex-end");
});
