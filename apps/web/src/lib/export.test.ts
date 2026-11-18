import { afterEach, describe, expect, it, vi } from "vitest";
import rawConfig from "../demo/config.json";
import type { DesignConfig } from "../../../../packages/contracts/src/config";
import { inlineConfigImages } from "./export";
import { JSDOM } from "jsdom";

afterEach(() => vi.unstubAllGlobals());

describe("publication asset preparation", () => {
  it("embeds project and marquee images before confirmed content is sent to the server", async () => {
    const config = rawConfig as DesignConfig;
    const withImages: DesignConfig = {
      ...config,
      heroArtwork: { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012", styleId: "own", alt: "portrait" },
      marquee: { ...config.marquee, items: [{ label: "Logo", image: "https://example.test/logo.png" }] },
      content: { ...config.content, projects: [{ ...config.content.projects[0], image: "blob:project-art" }] }
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    })));
    const embedded = await inlineConfigImages(withImages);
    expect(embedded.heroArtwork?.assetUrl).toBe("data:image/png;base64,AQID");
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

it('embeds the cyber creator default portrait into offline HTML', async () => {
  const {buildStaticHtml}=await import('../server/export.mjs');
  const fixture=await import('../../../../packages/contracts/fixtures/agent-golden.v3.json');
  const config={...fixture.default.expected.config,templateId:'cyber-creator-v1'};
  const html=buildStaticHtml(config,undefined,undefined,()=>({mime:'image/png',bytes:Buffer.from([1,2,3])}));
  const page=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true});
  await new Promise(resolve=>setTimeout(resolve,150));
  const image=page.window.document.querySelector('img[alt="赛博科技默认立体人物"]');
  expect(image?.getAttribute('src')).toMatch(/^data:image\/webp;base64,/);
  expect(page.window.document.querySelector('[data-testid="cyber-creator-page"]')?.getAttribute('data-static')).toBe('true');
  expect(html).not.toContain('src="/cyber-creator-bust.webp"');
  page.window.close();
});

it('exports cyber project mosaic with confirmed captions and full text', async () => {
  const {buildStaticHtml}=await import('../server/export.mjs');
  const {resumeDisplayContent}=await import('../../../../packages/contracts/src/resume-v2.mjs');
  const resume={version:'resume-v3',sections:[{kind:'projects',order:0,items:[{
    itemId:'project_1',order:0,title:'项目甲',details:'完整正文\n第二段',facts:[],
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
  expect(doc.querySelector('a[href="https://example.test/project"]')).not.toBeNull();
  page.window.close();
});
