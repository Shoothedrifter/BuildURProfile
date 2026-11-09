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

it("can retry a failed Agent parse after refreshing the upload page", async () => {
  sessionStorage.setItem("burp-agent-resume-id", "resume-1");
  sessionStorage.setItem("burp-agent-file-id", "file-1");
  vi.mocked(resumeApi.status).mockResolvedValue({ resumeId: "resume-1", status: "FAILED",
    errorCode: "PARSE_FAILED" });
  vi.mocked(resumeApi.parse).mockResolvedValue({ resumeId: "resume-1", status: "QUEUED" });
  const view = render(<UploadPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("PARSE_FAILED");
  fireEvent.click(screen.getByRole("button", { name: "重试 Agent 解析" }));
  await waitFor(() => expect(resumeApi.parse).toHaveBeenCalledWith("file-1"));
  view.unmount();
});

it("recovers a previous upload's file ID from the owned status response", async () => {
  sessionStorage.setItem("burp-agent-resume-id", "resume-1");
  vi.mocked(resumeApi.status).mockResolvedValue({ resumeId: "resume-1", fileId: "file-1",
    status: "FAILED", errorCode: "PARSE_FAILED" });
  vi.mocked(resumeApi.parse).mockResolvedValue({ resumeId: "resume-1", status: "QUEUED" });
  const view = render(<UploadPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("PARSE_FAILED");
  expect(sessionStorage.getItem("burp-agent-file-id")).toBe("file-1");
  fireEvent.click(screen.getByRole("button", { name: "重试 Agent 解析" }));
  await waitFor(() => expect(resumeApi.parse).toHaveBeenCalledWith("file-1"));
  view.unmount();
});
