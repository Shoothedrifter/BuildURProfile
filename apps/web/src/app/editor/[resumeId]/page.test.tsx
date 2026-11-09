import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fixture from "../../../../../../packages/contracts/fixtures/resume-draft.v1.json";
import ResumeEditorPage from "./page";
import { resumeApi } from "../../../lib/resumeApi";

vi.mock("../../../lib/resumeApi", () => ({ resumeApi: {
  read: vi.fn(), save: vi.fn(), remove: vi.fn(), reparse: vi.fn(), blocks: vi.fn(),
  sourceUrl: (id: string) => `/api/resumes/${id}/source`
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
  expect(await screen.findByRole("alert")).toHaveTextContent("请在基本信息中勾选姓名，以及邮箱或电话");
  expect(vi.mocked(resumeApi.save)).not.toHaveBeenCalled();
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
