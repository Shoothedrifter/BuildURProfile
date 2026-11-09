import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import UploadPage from "./page";
import { resumeApi } from "../../lib/resumeApi";

vi.mock("../../lib/resumeApi", () => ({ resumeApi: {
  upload: vi.fn(), parse: vi.fn(), status: vi.fn(), cancel: vi.fn()
} }));

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(resumeApi.upload).mockReset();
  vi.mocked(resumeApi.parse).mockReset();
  vi.mocked(resumeApi.status).mockReset();
});

it("discloses retention and OpenAI before uploading, then queues Agent parse", async () => {
  vi.mocked(resumeApi.upload).mockResolvedValue({ fileId: "file-1", pageCount: 1 });
  vi.mocked(resumeApi.parse).mockResolvedValue({ resumeId: "resume-1", status: "QUEUED" });
  vi.mocked(resumeApi.status).mockResolvedValue({ resumeId: "resume-1", status: "RUNNING", stage: "classify_sections", progress: 45 });
  const view = render(<UploadPage />);
  expect(screen.getByText(/30 天/)).toBeInTheDocument();
  expect(screen.getByText(/OpenAI/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/选择或拖入 PDF 简历/), {
    target: { files: [new File(["%PDF-synthetic"], "synthetic.pdf", { type: "application/pdf" })] }
  });
  fireEvent.click(screen.getByRole("button", { name: "上传并解析简历" }));
  await waitFor(() => expect(resumeApi.parse).toHaveBeenCalledWith("file-1"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("classify_sections"));
  expect(sessionStorage.getItem("burp-agent-resume-id")).toBe("resume-1");
  view.unmount();
});
