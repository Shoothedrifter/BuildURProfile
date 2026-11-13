import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fixture from "../../../../../../packages/contracts/fixtures/resume-draft.v1.json";
import { normalizeResumeDraft } from "../../../../../../packages/contracts/src/resume-draft";
import ResumeEditorPage from "./page";
import { resumeApi } from "../../../lib/resumeApi";

vi.mock("../../../lib/resumeApi", () => ({ resumeApi: {
  read: vi.fn(), save: vi.fn(), remove: vi.fn(), reparse: vi.fn(), blocks: vi.fn(),
  pendingImages: vi.fn().mockResolvedValue({images:[]}),
  uploadImage: vi.fn(), deleteImage: vi.fn().mockResolvedValue({ok:true}),
  sourceUrl: (id: string) => `/api/resumes/${id}/source`,
  imageUrl: (id: string, imageId: string) => `/api/resumes/${id}/images/${imageId}`
} }));

// 在 fixture 基础上注入若干项目条目，便于验证模块折叠、待确认与条目操作
function draftWithProjects(itemCount: number, needsReview = false) {
  const draft = structuredClone(fixture);
  const projects = draft.sections.find((section) => section.kind === "projects")!;
  projects.items = Array.from({ length: itemCount }, (_, index) => ({
    itemId: `proj-${index + 1}`, order: index, title: `项目 ${index + 1}`, details: "描述",
    facts: [], sourceBlockIds: [], confidence: needsReview && index === 0 ? 0.42 : 1,
    segmentationConfidence: 1, needsReview: needsReview && index === 0, included: true, origin: "agent"
  }));
  return draft;
}

beforeEach(() => {
  vi.mocked(resumeApi.read).mockReset();
  vi.mocked(resumeApi.save).mockReset();
  vi.mocked(resumeApi.reparse).mockReset();
  // 原文摘录是辅助信息，默认给空列表；需要对照的测试自行覆盖
  vi.mocked(resumeApi.blocks).mockReset();
  vi.mocked(resumeApi.blocks).mockResolvedValue({ blocks: [] });
  vi.mocked(resumeApi.uploadImage).mockReset();
  vi.mocked(resumeApi.deleteImage).mockClear();
  vi.mocked(resumeApi.pendingImages).mockReset().mockResolvedValue({images:[]});
});

it('reorders modules and lets the user split a project at a paragraph boundary', async () => {
  const draft = normalizeResumeDraft(fixture);
  const project = {...draft.sections[0].items[0],itemId:'project-one',order:0,
    title:'项目',details:'设计系统\n\n交互实现',included:true};
  draft.sections.find(section => section.kind === 'projects')!.items = [project];
  vi.mocked(resumeApi.read).mockResolvedValue({draft,revision:1,expiresAt:'2026-12-09T00:00:00Z'});
  vi.mocked(resumeApi.save).mockImplementation(async (_id,next) => ({draft:next,revision:2,expiresAt:'2026-12-09T00:00:00Z'}));
  render(<ResumeEditorPage params={Promise.resolve({resumeId:'resume-1'})}/>);
  const projectHeading = await screen.findByRole('heading',{name:'项目经历'});
  const projectSection = projectHeading.closest('section')!;
  fireEvent.click(within(projectSection).getByRole('button',{name:'模块上移'}));
  fireEvent.click(screen.getByRole('button',{name:/项目经历/}));
  fireEvent.click(within(projectSection).getByRole('button',{name:'拆分此条'}));
  const dialog = screen.getByRole('dialog',{name:'拆分条目'});
  expect(dialog).toHaveTextContent('设计系统');
  fireEvent.click(within(dialog).getByRole('button',{name:'确认拆分'}));
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  await waitFor(() => expect(resumeApi.save).toHaveBeenCalled());
  const saved = vi.mocked(resumeApi.save).mock.calls.at(-1)![1];
  expect(saved.sections.find(section=>section.kind==='projects')!.order).toBe(4);
  expect(saved.sections.find(section=>section.kind==='projects')!.items).toHaveLength(2);
});

it('marks user-edited text for later reparse merge', async () => {
  const draft = normalizeResumeDraft(fixture);
  vi.mocked(resumeApi.read).mockResolvedValue({draft,revision:1,expiresAt:'2026-12-09T00:00:00Z'});
  vi.mocked(resumeApi.save).mockImplementation(async (_id,next) => ({draft:next,revision:2,expiresAt:'2026-12-09T00:00:00Z'}));
  render(<ResumeEditorPage params={Promise.resolve({resumeId:'resume-1'})}/>);
  const basic = (await screen.findByRole('heading',{name:'基本信息'})).closest('section')!;
  fireEvent.change(within(basic).getByLabelText('标题'),{target:{value:'用户修改'}});
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  await waitFor(()=>expect(resumeApi.save).toHaveBeenCalled());
  expect(vi.mocked(resumeApi.save).mock.calls[0][1].sections[0].items[0].editedFields).toContain('title');
});

it("asks before reparsing into a separate draft and reports failure", async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: fixture as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  vi.mocked(resumeApi.reparse).mockRejectedValue(new Error("暂时无法重新解析"));
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  const reparseButton = await screen.findByRole("button", { name: "重新解析为新草稿" });
  await waitFor(() => expect(reparseButton).toBeEnabled());
  fireEvent.click(reparseButton);
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent(/当前草稿会保留/);
  fireEvent.click(within(dialog).getByRole("button", { name: "继续" }));
  await waitFor(() => expect(resumeApi.reparse).toHaveBeenCalledWith("resume-1"));
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法重新解析");
  expect(screen.getByRole("heading", { name: "实习 / 工作经历" })).toBeInTheDocument();
});

it("explains missing contact selection beside the confirm action", async () => {
  const draft = structuredClone(fixture);
  const basic = draft.sections.find((section) => section.kind === "basicInfo")!;
  basic.visible = false;
  basic.items[0].included = false;
  basic.items[0].facts.forEach((fact) => { fact.included = false; });
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: draft as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  const confirm = await screen.findByRole("button", { name: "确认并选择风格 →" });
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(screen.getByText(/请在基本信息中勾选姓名，以及邮箱或电话/)).toBeInTheDocument();
  fireEvent.click(confirm);
  // 确认失败同样走挽留弹窗：文案就近展示且草稿不被提交
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("请在基本信息中勾选姓名，以及邮箱或电话");
  expect(vi.mocked(resumeApi.save)).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  const basicModule = screen.getByRole("heading", { name: "基本信息" }).closest("section")!;
  const factChecks = within(basicModule).getAllByRole("checkbox", { name: "展示" });
  fireEvent.click(factChecks[0]);
  fireEvent.click(factChecks[1]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/请在基本信息中勾选姓名，以及邮箱或电话，再继续。/)).not.toBeInTheDocument();
});

it("shows all ten modules, a private PDF preview, and saves manual additions", async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: fixture as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  vi.mocked(resumeApi.save).mockImplementation(async (_id, draft) => ({ draft: { ...draft, revision: 2 },
    revision: 2, expiresAt: "2026-12-09T00:00:00Z" }));
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  expect(await screen.findByRole("heading", { name: "实习 / 工作经历" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "校园经历" })).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(12);
  expect(screen.getByRole("heading", { name: /确认进度/ })).toBeInTheDocument();
  expect(screen.getAllByRole("img", { name: "BuildURProfile" })).toHaveLength(2);
  expect(screen.getByTitle("原 PDF 预览")).toHaveAttribute("src", "/api/resumes/resume-1/source");
  // 模块默认折叠，先通过左栏清单展开「其他内容」再添加
  fireEvent.click(screen.getByRole("button", { name: /其他内容/ }));
  fireEvent.click(screen.getByRole("button", { name: "添加其他内容" }));
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(resumeApi.save).toHaveBeenCalled());
  const saved = vi.mocked(resumeApi.save).mock.calls[0][1];
  expect(saved.sections.find((section) => section.kind === "other")?.items.some((item) => item.origin === "user"))
    .toBe(true);
});

it("tracks pending modules in the checklist and expands them on demand", async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: draftWithProjects(1, true) as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  expect(await screen.findByRole("heading", { name: "实习 / 工作经历" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /确认进度/ })).toHaveTextContent("9 / 10");
  expect(screen.getByText(/待确认 1 个模块/)).toBeInTheDocument();
  // 模块默认折叠，只展开基本信息
  expect(screen.queryByRole("button", { name: "添加项目经历" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /○ 项目经历/ }));
  expect(screen.getByRole("button", { name: "添加项目经历" })).toBeInTheDocument();
  expect(screen.getByText(/AI 识别置信度较低/)).toBeInTheDocument();
});

it("reorders and deletes entries behind a confirmation dialog", async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: draftWithProjects(2) as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  vi.mocked(resumeApi.save).mockImplementation(async (_id, draft) => ({ draft: { ...draft, revision: 2 },
    revision: 2, expiresAt: "2026-12-09T00:00:00Z" }));
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  expect(await screen.findByRole("heading", { name: "实习 / 工作经历" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /○ 项目经历|✓ 项目经历/ }));
  const projectsSection = screen.getByRole("heading", { name: "项目经历" }).closest("section")!;
  const articles = within(projectsSection).getAllByRole("article");
  expect(articles).toHaveLength(2);
  fireEvent.click(within(articles[0]).getByRole("button", { name: "↓ 下移" }));
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(resumeApi.save).toHaveBeenCalled());
  const projects = vi.mocked(resumeApi.save).mock.calls[0][1].sections
    .find((section) => section.kind === "projects")!;
  expect(projects.items.map((item) => item.itemId)).toEqual(["proj-2", "proj-1"]);
  // 删除条目需要二次确认，取消不生效，确认后才移除
  const projectArticles = () => within(projectsSection).getAllByRole("article");
  fireEvent.click(within(projectArticles()[1]).getByRole("button", { name: "删除条目" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent(/不可撤销/);
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(projectArticles()).toHaveLength(2);
  fireEvent.click(within(projectArticles()[1]).getByRole("button", { name: "删除条目" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认删除" }));
  expect(projectArticles()).toHaveLength(1);
});

it("keeps a hidden module's data with a notice", async () => {
  const draft = structuredClone(fixture);
  draft.sections.find((section) => section.kind === "awards")!.visible = false;
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: draft as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  expect(await screen.findByRole("heading", { name: "实习 / 工作经历" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /荣誉奖项/ }));
  expect(screen.getByText(/已隐藏，不进入生成网站/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "显示模块" }));
  expect(screen.queryByText(/已隐藏，不进入生成网站/)).not.toBeInTheDocument();
});

it("shows the original PDF text beside agent entries, not manual ones", async () => {
  const draft = structuredClone(fixture);
  const basicItem = draft.sections.find((section) => section.kind === "basicInfo")!.items[0];
  basicItem.sourceBlockIds = ["block_1", "block_1b"];
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: draft as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  vi.mocked(resumeApi.blocks).mockResolvedValue({ blocks: [
    { blockId: "block_1", page: 1, readingOrder: 0, text: "张三 前端工程师" },
    { blockId: "block_1b", page: 1, readingOrder: 1, text: "zhang@example.com" }
  ] });
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  const basicSection = (await screen.findByRole("heading", { name: "基本信息" })).closest("section")!;
  expect(vi.mocked(resumeApi.blocks)).toHaveBeenCalledWith("resume-1");
  expect(within(basicSection).getByText(/原文对照/)).toBeInTheDocument();
  expect(within(basicSection).getByText(/张三 前端工程师/)).toBeInTheDocument();
  expect(within(basicSection).getByText(/zhang@example.com/)).toBeInTheDocument();
  // 相邻摘录同处一页时页码只标一次，避免逐行重复的视觉噪音
  expect(within(basicSection).getAllByText(/第 1 页/)).toHaveLength(1);
  // 手动新增的条目没有 PDF 来源，不显示原文对照
  fireEvent.click(within(basicSection).getByRole("button", { name: "添加基本信息" }));
  const articles = within(basicSection).getAllByRole("article");
  expect(within(articles[articles.length - 1]).queryByText(/原文对照/)).not.toBeInTheDocument();
});

it("keeps editing usable when the source excerpt request fails", async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: fixture as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  vi.mocked(resumeApi.blocks).mockRejectedValue(new Error("网络异常"));
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  expect(await screen.findByRole("heading", { name: "基本信息" })).toBeInTheDocument();
  await waitFor(() => expect(vi.mocked(resumeApi.blocks)).toHaveBeenCalled());
  expect(screen.queryByText(/原文对照/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("edits supplement text, links and images on an entry", async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: fixture as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  vi.mocked(resumeApi.save).mockImplementation(async (_id, draft) => ({ draft: { ...draft, revision: 2 },
    revision: 2, expiresAt: "2026-12-09T00:00:00Z" }));
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  const basicSection = (await screen.findByRole("heading", { name: "基本信息" })).closest("section")!;
  // 补充文字显示字数计数
  const supplementText = within(basicSection).getByLabelText(/补充说明/);
  fireEvent.change(supplementText, { target: { value: "主导开源项目" } });
  expect(within(basicSection).getByText("6/500")).toBeInTheDocument();
  // 相关链接：添加后可移除
  fireEvent.click(within(basicSection).getByRole("button", { name: "添加链接" }));
  fireEvent.change(within(basicSection).getByPlaceholderText(/相关链接/), { target: { value: "https://github.com/me" } });
  fireEvent.click(within(basicSection).getByRole("button", { name: "移除链接" }));
  expect(within(basicSection).queryByDisplayValue("https://github.com/me")).not.toBeInTheDocument();
  // 上传图片后显示缩略图与说明输入
  vi.mocked(resumeApi.uploadImage).mockResolvedValue({ imageId: "img_1" });
  fireEvent.change(within(basicSection).getByLabelText("上传图片"),
    { target: { files: [new File([new Uint8Array([1])], "shot.png", { type: "image/png" })] } });
  const thumbnail = await within(basicSection).findByRole("img", { name: /补充图片/ });
  expect(thumbnail).toHaveAttribute("src", "/api/resumes/resume-1/images/img_1");
  // 保存时补充内容进入草稿
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(resumeApi.save).toHaveBeenCalled());
  const savedItem = vi.mocked(resumeApi.save).mock.calls[0][1].sections[0].items[0];
  expect(savedItem.supplements).toEqual({ text: "主导开源项目", links: [],
    images: [{ imageId: "img_1", caption: "" }] });
});

it("keeps the draft in place and offers retry when saving fails", async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: fixture as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  vi.mocked(resumeApi.save)
    .mockRejectedValueOnce(new Error("网络异常"))
    .mockImplementationOnce(async (_id, draft) => ({ draft: { ...draft, revision: 2 },
      revision: 2, expiresAt: "2026-12-09T00:00:00Z" }));
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  await screen.findByRole("heading", { name: "基本信息" });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent(/保存失败/);
  expect(dialog).toHaveTextContent(/改动会保留在页面上/);
  fireEvent.click(within(dialog).getByRole("button", { name: "重试保存" }));
  await waitFor(() => expect(vi.mocked(resumeApi.save)).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("status")).toHaveTextContent(/已保存/);
});

it('requires explicit review, preserves confidence and retains PDF', async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({draft:draftWithProjects(1,true) as never, revision:1,expiresAt:'2026-12-09T00:00:00Z'});
  vi.mocked(resumeApi.save).mockImplementation(async (_id,draft)=>({draft,revision:1,expiresAt:''}));
  render(<ResumeEditorPage params={Promise.resolve({resumeId:'resume-1'})}/>);
  await screen.findByRole('heading',{name:/确认进度/});
  fireEvent.click(screen.getByRole('button',{name:'确认并选择风格 →'}));
  expect(resumeApi.save).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button',{name:'已核对'}));
  expect(screen.getByRole('heading',{name:/确认进度/})).toHaveTextContent('10 / 10');
  expect(screen.getByText(/分类 42%/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  await waitFor(()=>expect(resumeApi.save).toHaveBeenCalled());
  expect(vi.mocked(resumeApi.save).mock.calls[0][1].sections[5].items[0]).toMatchObject({needsReview:false,confidence:0.42});
  expect(screen.getByTitle('原 PDF 预览')).toBeInTheDocument();
});
it('normalizes empty links but blocks a named link with no URL before PATCH', async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({draft:fixture as never, revision:1,expiresAt:''});
  vi.mocked(resumeApi.save).mockImplementation(async (_id,draft)=>({draft,revision:1,expiresAt:''}));
  render(<ResumeEditorPage params={Promise.resolve({resumeId:'resume-1'})}/>);
  fireEvent.click(await screen.findByRole('button',{name:'添加链接'}));
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  await waitFor(()=>expect(resumeApi.save).toHaveBeenCalledTimes(1));
  expect(vi.mocked(resumeApi.save).mock.calls[0][1].sections[0].items[0].supplements?.links).toEqual([]);
  fireEvent.click(screen.getByRole('button',{name:'添加链接'}));
  fireEvent.change(screen.getByLabelText('链接名称 1'),{target:{value:'作品'}});
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  expect(resumeApi.save).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('alert')).toHaveTextContent(/HTTP/);
});

it('asks before hiding an unreviewed module and persists the explicit decision', async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({draft:draftWithProjects(1,true) as never,revision:1,expiresAt:''});
  vi.mocked(resumeApi.save).mockImplementation(async (_id,draft)=>({draft,revision:1,expiresAt:''}));
  render(<ResumeEditorPage params={Promise.resolve({resumeId:'resume-1'})}/>);
  fireEvent.click(await screen.findByRole('checkbox',{name:'显示项目经历'}));
  const dialog=screen.getByRole('dialog',{name:'隐藏待核对模块'});
  expect(screen.getByRole('heading',{name:/确认进度/})).toHaveTextContent('9 / 10');
  fireEvent.click(within(dialog).getByRole('button',{name:'确认隐藏'}));
  expect(screen.getByRole('heading',{name:/确认进度/})).toHaveTextContent('10 / 10');
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  await waitFor(()=>expect(resumeApi.save).toHaveBeenCalled());
  expect(vi.mocked(resumeApi.save).mock.calls[0][1].sections[5]).toMatchObject({visible:false,items:[{needsReview:false,confidence:0.42}]});
});


it.each(['delete', 'move'])('handles a delayed upload after its entry is %s', async mode => {
  vi.mocked(resumeApi.read).mockResolvedValue({draft:draftWithProjects(1) as never,revision:1,expiresAt:''});
  let finishUpload!: (value:{imageId:string})=>void;
  vi.mocked(resumeApi.uploadImage).mockImplementation(()=>new Promise(resolve=>{finishUpload=resolve;}));
  render(<ResumeEditorPage params={Promise.resolve({resumeId:'resume-1'})}/>);
  fireEvent.click(await screen.findByRole('button',{name:/✓ 项目经历/}));
  fireEvent.change(screen.getByLabelText('上传图片'),{target:{files:[new File(['synthetic'],'test.png',{type:'image/png'})]}});
  await waitFor(()=>expect(resumeApi.uploadImage).toHaveBeenCalled());
  if(mode==='delete') {
    fireEvent.click(screen.getByRole('button',{name:'删除条目'}));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'确认删除'}));
  } else fireEvent.change(screen.getByRole('combobox',{name:'移动项目经历条目 1 到其他模块'}),{target:{value:'campusExperience'}});
  await act(async()=>{finishUpload({imageId:'late_image'});});
  if(mode==='delete') await waitFor(()=>expect(resumeApi.deleteImage).toHaveBeenCalledWith('resume-1','late_image'));
  else {
    fireEvent.click(screen.getByRole('button',{name:/校园经历/}));
    expect(await screen.findByRole('img',{name:'补充图片 1'})).toHaveAttribute('src','/api/resumes/resume-1/images/late_image');
    expect(resumeApi.deleteImage).not.toHaveBeenCalled();
  }
});


it('offers recovery and deletion of images uploaded before an unsaved reload', async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({draft:fixture as never,revision:1,expiresAt:''});
  vi.mocked(resumeApi.save).mockImplementation(async (_id,draft)=>({draft,revision:1,expiresAt:''}));
  vi.mocked(resumeApi.pendingImages).mockResolvedValue({images:[
    {imageId:'recover1',itemId:fixture.sections[0].items[0].itemId,size:100,contentType:'image/png'},
    {imageId:'recover2',itemId:null,size:100,contentType:'image/png'}
  ]});
  render(<ResumeEditorPage params={Promise.resolve({resumeId:'resume-1'})}/>);
  const recovery=await screen.findByRole('region',{name:'未保存图片'});
  fireEvent.click(within(recovery).getByRole('button',{name:'恢复图片 1'}));
  expect(await screen.findByRole('img',{name:'补充图片 1'})).toHaveAttribute('src','/api/resumes/resume-1/images/recover1');
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  await waitFor(()=>expect(resumeApi.save).toHaveBeenCalled());
  expect(vi.mocked(resumeApi.save).mock.calls[0][1].sections[0].items[0].supplements?.images[0].imageId).toBe('recover1');
  fireEvent.click(screen.getByRole('button',{name:'移除图片'}));
  await waitFor(()=>expect(resumeApi.deleteImage).toHaveBeenCalledWith('resume-1','recover1'));
  await waitFor(()=>expect(document.querySelector('img[src$="recover1"]')).toBeNull());
  fireEvent.click(within(recovery).getByRole('button',{name:'删除未保存图片 1'}));
  await waitFor(()=>expect(resumeApi.deleteImage).toHaveBeenCalledWith('resume-1','recover2'));
});
