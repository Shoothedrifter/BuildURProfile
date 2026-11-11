import { afterEach, describe, expect, it, vi } from "vitest";
import rawConfig from "../demo/config.json";
import type { DesignConfig } from "../../../../packages/contracts/src/config";
import { inlineConfigImages } from "./export";

afterEach(() => vi.unstubAllGlobals());

describe("publication asset preparation", () => {
  it("embeds project and marquee images before confirmed content is sent to the server", async () => {
    const config = rawConfig as DesignConfig;
    const withImages: DesignConfig = {
      ...config,
      marquee: { ...config.marquee, items: [{ label: "Logo", image: "https://example.test/logo.png" }] },
      content: { ...config.content, projects: [{ ...config.content.projects[0], image: "blob:project-art" }] }
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    })));
    const embedded = await inlineConfigImages(withImages);
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
  const doc=new DOMParser().parseFromString(buildStaticHtml(config,undefined,undefined,(id:string)=>`assets/${id}.png`),'text/html');
  expect(doc.querySelectorAll('[data-export-project]')).toHaveLength(2);
  expect(doc.querySelector('[aria-label="实习/工作经历"]')).not.toBeNull();
  expect(doc.querySelector('[aria-label="校园经历"]')).not.toBeNull();
  expect(doc.querySelector('figure img')?.getAttribute('src')).toBe('assets/image_synthetic.png');
  expect(doc.querySelector('a')?.textContent).toBe('作品链接');
  expect(doc.querySelectorAll('.resume-supplement-text')).toHaveLength(1);
});
