import { afterEach, describe, expect, it, vi } from "vitest";
import rawConfig from "../demo/config.json";
import type { DesignConfig } from "../../../../packages/contracts/src/config";
import { inlineConfigImages } from "./export";
import { JSDOM } from "jsdom";
import { normalizeResumeDraft, projectConfirmedResumeV3 } from "../../../../packages/contracts/src/resume-draft";
import draftFixture from "../../../../packages/contracts/fixtures/resume-draft.v1.json";

afterEach(() => vi.unstubAllGlobals());

it("embeds the shared macaron stylesheet so offline layout matches live preview", async () => {
  const { buildStaticHtml } = await import("../server/export.mjs");
  const { createDemoShowcaseConfig } = await import("../demo/showcaseDemo");
  const html = buildStaticHtml(createDemoShowcaseConfig("warm-macaron-v1"));
  const page = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
  try {
    await new Promise(resolve => setTimeout(resolve, 150));
    const doc = page.window.document;
    expect(page.window.getComputedStyle(doc.querySelector(".warm-macaron")!).backgroundAttachment).toBe("fixed");
    expect(page.window.getComputedStyle(doc.querySelector(".macaron-hero-inner")!).display).toBe("grid");
    expect(page.window.getComputedStyle(doc.querySelector(".macaron-photo-frame img")!).objectFit).toBe("cover");
    expect(doc.querySelector('link[rel="stylesheet"]')).toBeNull();
  } finally {
    page.window.close();
  }
});

describe("publication asset preparation", () => {
  it("embeds project and marquee images before confirmed content is sent to the server", async () => {
    const config = rawConfig as DesignConfig;
    const withImages: DesignConfig = {
      ...config,
      heroArtwork: { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012",
        cutoutAssetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789013", styleId: "own", alt: "portrait" },
      marquee: { ...config.marquee, items: [{ label: "Logo", image: "https://example.test/logo.png" }] },
      content: { ...config.content, projects: [{ ...config.content.projects[0], image: "blob:project-art" }] }
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    })));
    const embedded = await inlineConfigImages(withImages);
    expect(embedded.heroArtwork?.assetUrl).toBe("data:image/png;base64,AQID");
    expect(embedded.heroArtwork?.cutoutAssetUrl).toBe("data:image/png;base64,AQID");
    expect(embedded.content.projects[0].image).toBe("data:image/png;base64,AQID");
    expect(embedded.marquee.items?.[0]).toEqual({ label: "Logo", image: "data:image/png;base64,AQID" });
    expect(withImages.content.projects[0].image).toBe("blob:project-art");
  });

  it("rejects remote assets that cannot be embedded", async () => {
    const config = rawConfig as DesignConfig;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(inlineConfigImages({ ...config, content: { ...config.content,
      projects: [{ ...config.content.projects[0], image: "https://example.test/missing.png" }] } }))
      .rejects.toThrow(/embed.*image/i);
  });
});

it('exports v2 content in separate modules with a usable project deck and package-relative images', async () => {
  const {buildStaticHtml}=await import('../server/export.mjs');
  const {resumeDisplayContent}=await import('../../../../packages/contracts/src/resume-v2.mjs');
  const supplement={text:'补充正文',links:[{label:'作品链接',url:'https://example.test'}],images:[{imageId:'image_synthetic',caption:'图片说明'}]};
  const resume={version:'resume-v2',sections:[{kind:'workExperience',items:[{itemId:'work',title:'工作条目',details:'工作正文',facts:[],supplement:{text:'',links:[],images:[]}}]}, {kind:'projects',items:[{itemId:'project1',title:'项目一',details:'第一段\n第二段',facts:[],supplement},{itemId:'project2',title:'项目二',details:'第二个项目',facts:[],supplement:{text:'',links:[],images:[]}}]}, {kind:'campusExperience',items:[{itemId:'campus',title:'校园条目',details:'校园正文',facts:[],supplement:{text:'',links:[],images:[]}}]}]};
  const config={...rawConfig,content:resumeDisplayContent(resume)};
  const html=buildStaticHtml(config,undefined,undefined,()=>({mime:'image/png',bytes:Buffer.from([1,2,3])}));
  const page=new JSDOM(html,{url:'https://example.test',runScripts:'dangerously',pretendToBeVisual:true});
  await new Promise(resolve=>setTimeout(resolve,150));
  const doc=page.window.document;
  expect(doc.querySelectorAll('.project-card')).toHaveLength(1);
  expect(doc.querySelector('.showcase-touch-note')).toBeNull();
  expect(doc.body).toHaveTextContent('项目一');
  expect(doc.querySelector('img[alt="图片说明"]')?.getAttribute('src')).toBe('data:image/png;base64,AQID');
  expect(doc.querySelector('a[href="https://example.test"]')?.textContent).toBe('作品链接');
  expect(doc.body).toHaveTextContent('补充正文');
  (doc.querySelector('[aria-label="Next project"]') as HTMLButtonElement).click();
  await new Promise(resolve=>setTimeout(resolve,30));
  expect(doc.body).toHaveTextContent('项目二');
  expect(doc.querySelector('[aria-label="实习/工作经历"]')).not.toBeNull();
  expect(doc.querySelector('[aria-label="校园经历"]')).not.toBeNull();
  page.window.close();
});

it('exports v3 modules in the confirmed order around the project deck', async () => {
  const {buildStaticHtml}=await import('../server/export.mjs');
  const {resumeDisplayContent}=await import('../../../../packages/contracts/src/resume-v2.mjs');
  const item=(id:string)=>({itemId:id,order:0,title:id,details:id,facts:[],supplement:{text:'',links:[],images:[]}});
  const resume={version:'resume-v3',sections:[
    {kind:'campusExperience',order:0,items:[item('campus')]},
    {kind:'projects',order:1,items:[item('project')]},
    {kind:'workExperience',order:2,items:[item('work')]}
  ]};
  const config={...rawConfig,content:resumeDisplayContent(resume)};
  const page=new JSDOM(buildStaticHtml(config),{runScripts:'dangerously',pretendToBeVisual:true});
  await new Promise(resolve=>setTimeout(resolve,150));
  const doc=page.window.document;
  expect([...doc.querySelectorAll('.resume-section')].map(element=>element.getAttribute('aria-label')))
    .toEqual(['校园经历','实习/工作经历']);
  expect([...doc.querySelectorAll('main > section')].map(element=>element.getAttribute('aria-label')))
    .toEqual([null,'校园经历',null,'实习/工作经历']);
  expect(doc.querySelector('[aria-label="Selected work cards"]')).not.toBeNull();
  page.window.close();
});

it('exports project sourceText verbatim into the standalone HTML', async () => {
  const {buildStaticHtml}=await import('../server/export.mjs');
  const config={...rawConfig,content:{...rawConfig.content,projects:[{...rawConfig.content.projects[0],sourceText:'导出原文样例'}]}};
  const html=buildStaticHtml(config);
  expect(html).toContain('导出原文样例');
});

it('stacks two compact text projects in desktop HTML while preserving their full details', async () => {
  const {buildStaticHtml}=await import('../server/export.mjs');
  const fixture=await import('../../../../packages/contracts/fixtures/agent-golden.v3.json');
  const base=fixture.default.expected.config;
  const projects=['甲','乙'].map((suffix,order)=>({
    itemId:`project_${order}`, order, title:`项目${suffix}`, details:'项目摘要', sourceText:`项目${suffix}的完整内容`,
    facts:[], supplement:{text:'',links:[],images:[]}
  }));
  const config={...base,templateId:'cyber-creator-v1',content:{...base.content,
    resume:{...base.content.resume,sections:[...base.content.resume.sections,{kind:'projects',order:2,items:projects}]}
  }};
  const html=buildStaticHtml(config,undefined,undefined,()=>({mime:'image/png',bytes:Buffer.from([1,2,3])}));
  const page=new JSDOM(html,{
    runScripts:'dangerously',pretendToBeVisual:true,
    beforeParse(window){
      Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get:()=>960});
      Object.defineProperty(window.HTMLElement.prototype,'offsetHeight',{get:()=>300});
    }
  });
  try {
    await new Promise(resolve=>setTimeout(resolve,150));
    const stack=page.window.document.querySelector('.cyber-project-stack');
    expect(stack).toHaveAttribute('data-stacked');
    const details=stack!.querySelector('details')!;
    details.open=true;
    await new Promise(resolve=>setTimeout(resolve,50));
    expect(stack).not.toHaveAttribute('data-stacked');
    expect(details).toHaveTextContent('项目甲的完整内容');
  } finally {
    page.window.close();
  }
});

it("exports visible campus evidence and excludes hidden awards", async () => {
  const { buildStaticHtml } = await import("../server/export.mjs");
  const draft = normalizeResumeDraft(structuredClone(draftFixture));
  const initial = draft.sections.flatMap(section => section.items)[0];
  draft.sections = draft.sections.filter(section => section.kind !== "campusExperience" && section.kind !== "awards");
  draft.sections.push(
    { id: "awards", kind: "awards", visible: false, order: 6, mappedDesignModule: "award-badges",
      items: [{ ...initial, itemId: "hidden-award", title: "私有奖项样例", details: "", sourceText: "", facts: [] }] },
    { id: "campusExperience", kind: "campusExperience", visible: true, order: 7, mappedDesignModule: "campus-timeline",
      items: [{ ...initial, itemId: "campus-evidence", title: "", details: "", sourceText: "公开的实践说明", facts: [],
        supplements: { text: "", links: [], images: [{ imageId: "image_synthetic", caption: "活动留档" }] } }] }
  );
  const config = { ...rawConfig, templateId: "cyber-creator-v1", content: projectConfirmedResumeV3(draft) };
  const html = buildStaticHtml(config, undefined, undefined, () => ({ mime: "image/png", bytes: Buffer.from([1, 2, 3]) }));
  expect(html).not.toContain("私有奖项样例");
  const page = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
  try {
    await new Promise(resolve => setTimeout(resolve, 150));
    const doc = page.window.document;
    expect(doc.querySelector("#awards, a[href='#awards']")).toBeNull();
    const campus = doc.querySelector("#campusExperience");
    expect(campus?.querySelector("details:not(.cyber-optional-evidence)")?.textContent).toContain("公开的实践说明");
    expect(campus?.querySelector("img[alt='活动留档']")?.getAttribute("src")).toBe("data:image/png;base64,AQID");
  } finally {
    page.window.close();
  }
});

it("renders equivalent legacy award counts offline and respects an explicit empty highlight list", async () => {
  const { buildStaticHtml } = await import("../server/export.mjs");
  const { default: golden } = await import("../../../../packages/contracts/fixtures/agent-golden.v3.json");
  const base = golden.expected.config;
  const expected = ["60项", "18项", "33项", "9项"];
  const inputs = [
    { details: "共获学科竞赛奖项60项，其中国家级18项，省级33项，国际级9项", expected },
    { details: "共获学科竞赛 60 项\n国家级竞赛 18 项，省级竞赛 33 项，国际级竞赛 9 项", expected },
    { details: "共获学科竞赛奖项60项，其中国家级18项，省级33项，国际级9项",
      expected: [], presentationHighlights: [] },
    { details: "竞赛成绩见原文", expected: ["60项"],
      presentationHighlights: [{ id: "total", type: "award-total", label: "学科竞赛奖项", value: "60", unit: "项" }] }
  ];
  for (const input of inputs) {
    const config = { ...base, templateId: "cyber-creator-v1", content: { ...base.content,
      resume: { ...base.content.resume, sections: [...base.content.resume.sections,
        { kind: "awards", order: 9, items: [{
          itemId: "award-one", order: 0, title: "获奖情况", details: input.details,
          sourceText: "已确认可公开的奖项原文", facts: [], supplement: { text: "", links: [], images: [] },
          ...(input.presentationHighlights === undefined ? {} : { presentationHighlights: input.presentationHighlights })
        }] }]
      }
    }};
    const html = buildStaticHtml(config, undefined, undefined, () => ({ mime: "image/png", bytes: Buffer.from([1, 2, 3]) }));
    const page = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      const award = page.window.document.querySelector("#awards");
      expect([...award!.querySelectorAll(".cyber-optional-highlights dd")].map(element => element.textContent))
        .toEqual(input.expected);
      expect(award?.querySelector("details")?.textContent).toContain("已确认可公开的奖项原文");
      expect(award).toHaveTextContent(input.details.replace(/\s+/g, " "));
    } finally {
      page.window.close();
    }
  }
});

it('embeds the cyber creator default portrait into offline HTML', async () => {
  const {buildStaticHtml}=await import('../server/export.mjs');
  const fixture=await import('../../../../packages/contracts/fixtures/agent-golden.v3.json');
  const config={...fixture.default.expected.config,templateId:'cyber-creator-v1'};
  const html=buildStaticHtml(config,undefined,undefined,()=>({mime:'image/png',bytes:Buffer.from([1,2,3])}));
  const page=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true});
  await new Promise(resolve=>setTimeout(resolve,150));
  const image=page.window.document.querySelector('img[alt="赛博科技默认中性动漫形象"]');
  expect(image?.getAttribute('src')).toMatch(/^data:image\/webp;base64,/);
  expect(page.window.document.querySelector('[data-testid="cyber-creator-page"]')?.getAttribute('data-static')).toBe('true');
  expect(html).not.toContain('src="/cyber-neutral-print-anime.webp"');
  expect(html).not.toContain('CREATOR PORTFOLIO');
  page.window.close();
});

it('exports cyber project mosaic with confirmed captions and full text', async () => {
  const {buildStaticHtml}=await import('../server/export.mjs');
  const {resumeDisplayContent}=await import('../../../../packages/contracts/src/resume-v2.mjs');
  const resume={version:'resume-v3',sections:[{kind:'projects',order:0,items:[{
    itemId:'project_1',order:0,title:'项目甲',details:'完整正文\n第二段',sourceText:'项目完整原文专属',facts:[],
    supplement:{text:'用户补充说明',links:[{label:'项目链接',url:'https://example.test/project'}],
      images:['a','b','c','d'].map(imageId=>({imageId,caption:`图片${imageId}`}))}
  }]}]};
  const config={...rawConfig,templateId:'cyber-creator-v1',content:resumeDisplayContent(resume)};
  const html=buildStaticHtml(config,undefined,undefined,()=>({mime:'image/png',bytes:Buffer.from([1,2,3])}));
  const page=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true});
  await new Promise(resolve=>setTimeout(resolve,150));
  const doc=page.window.document;
  expect(doc.querySelectorAll('.cyber-project-mosaic img')).toHaveLength(3);
  expect(doc.querySelector('img[alt="图片d"]')?.getAttribute('src')).toBe('data:image/png;base64,AQID');
  expect(doc.body).toHaveTextContent('完整正文');
  expect(doc.body).toHaveTextContent('第二段');
  expect(doc.body).toHaveTextContent('用户补充说明');
  expect(doc.querySelector('.cyber-project-detail summary')).toHaveTextContent('查看项目详情');
  expect(doc.querySelector('.cyber-project-detail')).toHaveTextContent('项目完整原文专属');
  expect(doc.querySelector('a[href="https://example.test/project"]')).not.toBeNull();
  page.window.close();
});


it("runs pixel eye tracking from embedded assets even with static export decorations", async () => {
  const {buildStaticHtml}=await import("../server/export.mjs");
  const fixture=await import("../../../../packages/contracts/fixtures/agent-golden.v3.json");
  const {eyePatchBounds,pixelEyeProfiles}=await import("./pixelGaze");
  const source={width:1254,height:1254,data:new Uint8ClampedArray(1254*1254*4)};
  const b=eyePatchBounds;
  for(let y=0;y<b.height;y++) source.data.set(pixelEyeProfiles[0].original.subarray(y*b.width*4,(y+1)*b.width*4),((b.y+y)*1254+b.x)*4);
  const html=buildStaticHtml({...fixture.default.expected.config,templateId:"pixel-world-v1"},undefined,undefined,
    ()=>({mime:"image/png",bytes:Buffer.from([1,2,3])}));
  const page=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,beforeParse(window) {
    window.matchMedia=(query: string)=>({matches:!query.includes("reduced-motion"),addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList);
    window.HTMLCanvasElement.prototype.getContext=(()=>({drawImage(){},getImageData:()=>source,
      createImageData:(w:number,h:number)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){}})) as never;
  }});
  try {
    await new Promise(resolve=>setTimeout(resolve,150));
    const image=page.window.document.querySelector(".pixel-portrait")!;
    expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
    Object.defineProperties(image,{naturalWidth:{value:1254},naturalHeight:{value:1254}});
    image.dispatchEvent(new page.window.Event("load"));
    expect(page.window.document.querySelector("canvas")?.getAttribute("data-gaze")).toBe("ready");
    expect(page.window.document.querySelectorAll('script[src]')).toHaveLength(0);
  } finally { page.window.close(); }
});
