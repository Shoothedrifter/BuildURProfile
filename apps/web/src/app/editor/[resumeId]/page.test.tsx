import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import fixture from "../../../../../../packages/contracts/fixtures/resume-draft.v1.json";
import ResumeEditorPage from "./page";
import { resumeApi } from "../../../lib/resumeApi";

vi.mock("../../../lib/resumeApi", () => ({ resumeApi: {
  read: vi.fn(), save: vi.fn(), remove: vi.fn(), sourceUrl: (id: string) => `/api/resumes/${id}/source`
} }));

beforeEach(() => {
  vi.mocked(resumeApi.read).mockReset();
  vi.mocked(resumeApi.save).mockReset();
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
