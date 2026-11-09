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
  vi.mocked(resumeApi.upload).mockResolvedValue({ fileId: "file-1", pageCount: 3 });
  vi.mocked(resumeApi.parse).mockResolvedValue({ resumeId: "resume-1", status: "QUEUED" });
  vi.mocked(resumeApi.status).mockResolvedValue({ resumeId: "resume-1", status: "RUNNING", stage: "classify_sections", progress: 45 });
  const view = render(<UploadPage />);
  expect(screen.getByText(/30 天/)).toBeInTheDocument();
  expect(screen.getByText(/OpenAI/)).toBeInTheDocument();
  expect(screen.getByText(/仅 PDF · 单次 1 个文件 · ≤10MB · 1–20 页/)).toBeInTheDocument();
  expect(screen.getByText(/不支持加密文件或扫描版 PDF/)).toBeInTheDocument();
  expect(screen.getAllByRole("img", { name: "BuildURProfile" })).toHaveLength(2);
  fireEvent.change(screen.getByLabelText(/选择或拖入 PDF 简历/), {
    target: { files: [new File(["%PDF-synthetic"], "synthetic.pdf", { type: "application/pdf" })] }
  });
  fireEvent.click(screen.getByRole("button", { name: "上传并解析简历" }));
  await waitFor(() => expect(resumeApi.parse).toHaveBeenCalledWith("file-1"));
  // 解析阶段映射为「整理模块」，同时展示百分比进度
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("整理模块"));
  expect(screen.getByRole("status")).toHaveTextContent("45%");
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

it("explains why an encrypted PDF is rejected", async () => {
  sessionStorage.setItem("burp-agent-resume-id", "resume-1");
  vi.mocked(resumeApi.status).mockResolvedValue({ resumeId: "resume-1", status: "FAILED",
    errorCode: "PDF_ENCRYPTED" });
  const view = render(<UploadPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/加密/);
  view.unmount();
});
