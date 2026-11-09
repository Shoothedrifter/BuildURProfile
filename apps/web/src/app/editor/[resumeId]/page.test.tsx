import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fixture from "../../../../../../packages/contracts/fixtures/resume-draft.v1.json";
import ResumeEditorPage from "./page";
import { resumeApi } from "../../../lib/resumeApi";

vi.mock("../../../lib/resumeApi", () => ({ resumeApi: {
  read: vi.fn(), save: vi.fn(), remove: vi.fn(), reparse: vi.fn(),
  sourceUrl: (id: string) => `/api/resumes/${id}/source`
} }));

beforeEach(() => {
  vi.mocked(resumeApi.read).mockReset();
  vi.mocked(resumeApi.save).mockReset();
  vi.mocked(resumeApi.reparse).mockReset();
});

it("offers a separate reparse while keeping the current draft", async () => {
  vi.mocked(resumeApi.read).mockResolvedValue({ draft: fixture as never, revision: 1,
    expiresAt: "2026-12-09T00:00:00Z" });
  vi.mocked(resumeApi.reparse).mockRejectedValue(new Error("暂时无法重新解析"));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<ResumeEditorPage params={Promise.resolve({ resumeId: "resume-1" })} />);
  const reparseButton = await screen.findByRole("button", { name: "重新解析为新草稿" });
  await waitFor(() => expect(reparseButton).toBeEnabled());
  fireEvent.click(reparseButton);
  await waitFor(() => expect(resumeApi.reparse).toHaveBeenCalledWith("resume-1"));
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法重新解析");
  expect(screen.getByRole("heading", { name: "实习 / 工作经历" })).toBeInTheDocument();
  vi.restoreAllMocks();
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
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(11);
  expect(screen.getByTitle("原 PDF 预览")).toHaveAttribute("src", "/api/resumes/resume-1/source");
  fireEvent.click(screen.getByRole("button", { name: "添加其他内容" }));
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(resumeApi.save).toHaveBeenCalled());
  const saved = vi.mocked(resumeApi.save).mock.calls[0][1];
  expect(saved.sections.find((section) => section.kind === "other")?.items.some((item) => item.origin === "user"))
    .toBe(true);
});
