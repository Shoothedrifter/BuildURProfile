import { ShowcasePage } from '../ShowcasePage';
import { resumeV1View } from '../../../../packages/contracts/src/resume-v2.mjs';
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { DesignConfig } from "../../../../packages/contracts/src/config";
import rawConfig from "../demo/config.json";
import { EditorPanel } from "./EditorPanel";

const base = rawConfig as DesignConfig;

function Harness({ isTouch = false, initial = base, preview = false }: { isTouch?: boolean; initial?: DesignConfig; preview?: boolean }) {
  const [config, setConfig] = useState(initial);
  return <><EditorPanel config={config} onChange={setConfig} isTouch={isTouch} />{preview && <ShowcasePage config={config}/>}<output data-testid="edited-config">{JSON.stringify(config)}</output></>;
}

function edited(): DesignConfig {
  return JSON.parse(screen.getByTestId("edited-config").textContent ?? "") as DesignConfig;
}

describe("result editor", () => {
  it("edits confirmed award and other modules in the publishable config", () => {
    const resume = {
      version: "resume-v1" as const,
      basicInfo: [], jobIntent: [], selfEvaluation: [], education: [], workExperience: [], projects: [],
      awards: [{ title: "创新奖", details: "2023 创新奖", facts: [] }], campusExperience: [], skills: [],
      other: [{ title: "自媒体经历", details: "技术专栏", facts: [] }]
    };
    render(<Harness initial={{ ...base, content: { ...base.content, resume } }} />);
    fireEvent.change(screen.getByRole("textbox", { name: "荣誉奖项 1 内容" }), { target: { value: "2024 创新奖" } });
    fireEvent.change(screen.getByRole("textbox", { name: "其他内容 1 内容" }), { target: { value: "技术专栏与播客" } });
    expect(resumeV1View(edited().content.resume)?.awards[0].details).toBe("2024 创新奖");
    expect(resumeV1View(edited().content.resume)?.other[0].details).toBe("技术专栏与播客");
  });

  it("keeps the structured identity aligned with the edited hero name", () => {
    const resume = { version: "resume-v1" as const,
      basicInfo: [{ key: "name", label: "姓名", value: "旧姓名" }], jobIntent: [], selfEvaluation: [],
      education: [], workExperience: [], projects: [], awards: [], campusExperience: [], skills: [], other: [] };
    render(<Harness initial={{ ...base, content: { ...base.content, resume } }} />);
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "新姓名" } });
    expect(resumeV1View(edited().content.resume)?.basicInfo[0].value).toBe("新姓名");
  });
  it("edits profile, expertise, and project copy in the live config", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "New Name" } });
    fireEvent.change(screen.getByRole("textbox", { name: "技能 1" }), { target: { value: "Interface systems" } });
    fireEvent.change(screen.getByRole("textbox", { name: "项目 1 描述" }), { target: { value: "An edited project description." } });
    expect(edited().content.profile.name).toBe("New Name");
    expect(edited().content.expertise.skills[0]).toBe("Interface systems");
    expect(edited().content.projects[0].description).toBe("An edited project description.");
  });

  it("removes PDF source citations for manually changed text", () => {
    const cited: DesignConfig = {
      ...base,
      content: {
        ...base.content,
        sourceRefs: {
          "profile.name": { page: 1, excerpt: "Original Name" },
          "projects.0": { page: 1, excerpt: "Original project" },
          "profile.email": { page: 1, excerpt: "Original email" }
        }
      }
    };
    render(<Harness initial={cited} />);
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "Changed Name" } });
    fireEvent.change(screen.getByRole("textbox", { name: "项目 1 描述" }), { target: { value: "Changed description" } });
    expect(edited().content.sourceRefs?.["profile.name"]).toBeUndefined();
    expect(edited().content.sourceRefs?.["projects.0"]).toBeUndefined();
    expect(edited().content.sourceRefs?.["profile.email"]).toBeDefined();
  });

  it("makes the intensity slider change marquee speed and card depth immediately", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("slider", { name: "交互强度" }), { target: { value: "95" } });
    expect(edited().styleVector.K).toBe(0.95);
    expect(edited().styleVector.S).toBe(0.95);
    expect(edited().marquee.speed).toBeGreaterThan(base.marquee.speed);
    expect(edited().stackedCards.scaleStep).toBeGreaterThan(base.stackedCards.scaleStep);
  });

  it("keeps the slider value valid when React applies its updater after the event ends", () => {
    let pending: ((current: DesignConfig) => DesignConfig) | undefined;
    render(<EditorPanel config={base} isTouch={false} onChange={(update) => { pending = update; }} />);
    fireEvent.change(screen.getByRole("slider", { name: "交互强度" }), { target: { value: "88" } });
    expect(pending).toBeDefined();
    expect(pending?.(base).styleVector.K).toBe(0.88);
  });

  it("stores replacement images in the config for marquee tiles and project cards", async () => {
    render(<Harness />);
    const png = new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("跑马灯 1 图片"), { target: { files: [png] } });
    await waitFor(() => expect(typeof edited().marquee.items?.[0]).toBe("object"));
    fireEvent.change(screen.getByLabelText("项目 1 图片"), { target: { files: [png] } });
    await waitFor(() => expect(edited().content.projects[0].image).toMatch(/^data:image\/png;base64,/));
    expect(edited().marquee.items?.[0]).toMatchObject({ label: "Product design", image: expect.stringMatching(/^data:image\/png;base64,/) });
  });

  it("rejects unsupported image formats without changing the config", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("项目 1 图片"), { target: { files: [new File(["oops"], "bad.svg", { type: "image/svg+xml" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("PNG、JPEG 或 WebP");
    expect(edited().content.projects[0].image).toBeUndefined();
  });

  it("moves a legacy URL category into the editable link field", () => {
    const url = "https://github.com/example/repo";
    const initial: DesignConfig = { ...base, content: { ...base.content, projects: [{ ...base.content.projects[0], category: url }] } };
    render(<Harness initial={initial} />);
    expect(screen.getByRole("textbox", { name: "项目 1 分类" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /项目 1 链接/ })).toHaveValue(url);
    fireEvent.change(screen.getByRole("textbox", { name: /项目 1 链接/ }), { target: { value: "" } });
    expect(edited().content.projects[0].category).toBe("");
    expect(edited().content.projects[0].link).toBe("");
  });
});

it('edits v2 source items and keeps supplemental images and compatibility fields', async () => {
  const {default:resume}=await import('../../../../packages/contracts/fixtures/resume-enrichment.v2.json');
  const {resumeDisplayContent}=await import('../../../../packages/contracts/src/resume-v2.mjs');
  render(<Harness initial={{...base,content:resumeDisplayContent(resume)} as DesignConfig}/>);
  fireEvent.change(screen.getByRole('textbox',{name:'name'}),{target:{value:'修改姓名'}});
  expect(edited().content.profile.name).toBe('修改姓名');
  expect(JSON.stringify(edited().content.resume)).toContain('image_synthetic');
});

it('edits v3 items without losing module order or supplements', async () => {
  const {default:resume}=await import('../../../../packages/contracts/fixtures/resume-enrichment.v3.json');
  const {resumeDisplayContent}=await import('../../../../packages/contracts/src/resume-v2.mjs');
  render(<Harness initial={{...base,content:resumeDisplayContent(resume)} as DesignConfig}/>);
  fireEvent.change(screen.getByRole('textbox',{name:'内容'}),{target:{value:'新的工作内容'}});
  expect(edited().content.resume?.version).toBe('resume-v3');
  const updatedResume=edited().content.resume;
  if(updatedResume?.version!=='resume-v3') throw new Error('v3 required');
  expect(updatedResume.sections.map(section=>section.kind)).toEqual(['workExperience','basicInfo']);
  expect(updatedResume.sections[0].items[0].details).toBe('新的工作内容');
  expect(JSON.stringify(edited().content.resume)).toContain('image_synthetic');
});


it('updates derived marquee labels in the live preview and portable export after editing v2 skills', async () => {
  const {default:basic}=await import('../../../../packages/contracts/fixtures/resume-enrichment.v2.json');
  const {resumeDisplayContent}=await import('../../../../packages/contracts/src/resume-v2.mjs');
  const {buildStaticHtml}=await import('../server/export.mjs');
  const supplement={text:'',links:[],images:[]};
  const resume={version:'resume-v2',sections:[...basic.sections,{kind:'skills',items:[
    {itemId:'skill1',title:'旧标签：React',details:'完整的技能说明',facts:[],supplement},
    {itemId:'skill2',title:'保留标签：TypeScript',details:'另一项技能',facts:[],supplement}
  ]}]};
  render(<Harness preview initial={{...base,content:resumeDisplayContent(resume),marquee:{...base.marquee,items:['旧标签','保留标签']}} as DesignConfig}/>);
  fireEvent.change(screen.getAllByRole('textbox',{name:'标题'})[0],{target:{value:'新标签：React'}});
  expect(edited().marquee.items).toEqual(['新标签','保留标签']);
  expect(screen.queryByText('旧标签')).not.toBeInTheDocument();
  expect(screen.getAllByText('新标签').length).toBeGreaterThan(0);
  const html=buildStaticHtml(edited());
  expect(html).toContain('新标签');expect(html).not.toContain('旧标签');
});
