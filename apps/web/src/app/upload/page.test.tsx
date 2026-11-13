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
  // jsdom 未实现导航；用 spy 捕获跳转调用
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, assign }, writable: true
  });
  vi.stubGlobal("locationAssignSpy", assign);
});

it("从编辑器返回上传页时不因已完成的旧任务被强制跳回编辑器", async () => {
  sessionStorage.setItem("burp-agent-resume-id", "resume-done");
  vi.mocked(resumeApi.status).mockResolvedValue({ resumeId: "resume-done", status: "SUCCEEDED" });
  const view = render(<UploadPage />);
  // 已完成的旧任务只提供手动入口，不再自动导航
  expect(await screen.findByRole("link", { name: /打开编辑器/ })).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect((globalThis as Record<string, unknown>).locationAssignSpy).not.toHaveBeenCalled();
  view.unmount();
});

it("本次会话上传的简历解析成功后仍自动进入编辑器", async () => {
  vi.mocked(resumeApi.upload).mockResolvedValue({ fileId: "file-1", pageCount: 2 });
  vi.mocked(resumeApi.parse).mockResolvedValue({ resumeId: "resume-1", status: "QUEUED" });
  vi.mocked(resumeApi.status).mockResolvedValue({ resumeId: "resume-1", status: "SUCCEEDED" });
  const view = render(<UploadPage />);
  fireEvent.change(screen.getByLabelText(/选择或拖入 PDF 简历/), {
    target: { files: [new File(["%PDF-synthetic"], "synthetic.pdf", { type: "application/pdf" })] }
  });
  fireEvent.click(screen.getByRole("button", { name: "上传并解析简历" }));
  await waitFor(() => expect((globalThis as Record<string, unknown>).locationAssignSpy)
    .toHaveBeenCalledWith("/editor/resume-1"));
  view.unmount();
});

it("discloses retention and OpenAI before uploading, then queues Agent parse", async () => {
  vi.mocked(resumeApi.upload).mockResolvedValue({ fileId: "file-1", pageCount: 3 });
  vi.mocked(resumeApi.parse).mockResolvedValue({ resumeId: "resume-1", status: "QUEUED" });
  vi.mocked(resumeApi.status).mockResolvedValue({ resumeId: "resume-1", status: "RUNNING", stage: "classify_sections", progress: 45 });
  const view = render(<UploadPage />);
  // 精简版披露仍须覆盖期限与供应商两个要点
  expect(screen.getByText(/30 天/)).toBeInTheDocument();
  expect(screen.getByText(/模型供应商/)).toBeInTheDocument();
  expect(screen.queryByText(/本机 OCR 只在你主动选择后处理无文字页/)).not.toBeInTheDocument();
  expect(screen.getByText(/仅 PDF · 单次 1 个文件 · ≤10MB · 1–20 页/)).toBeInTheDocument();
  expect(screen.getByText(/扫描版 PDF 可在普通解析失败后主动尝试本机 OCR/)).toBeInTheDocument();
  expect(screen.getAllByRole("img", { name: "BuildURProfile" })).toHaveLength(2);
  fireEvent.change(screen.getByLabelText(/选择或拖入 PDF 简历/), {
    target: { files: [new File(["%PDF-synthetic"], "synthetic.pdf", { type: "application/pdf" })] }
  });
  fireEvent.click(screen.getByRole("button", { name: "上传并解析简历" }));
  await waitFor(() => expect(resumeApi.parse).toHaveBeenCalledWith("file-1", false));
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
  await waitFor(() => expect(resumeApi.parse).toHaveBeenCalledWith("file-1", false));
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
  await waitFor(() => expect(resumeApi.parse).toHaveBeenCalledWith("file-1", false));
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

it("offers local OCR only after a scanned PDF failed normal parsing", async () => {
  sessionStorage.setItem("burp-agent-resume-id", "resume-1");
  sessionStorage.setItem("burp-agent-file-id", "file-1");
  vi.mocked(resumeApi.status).mockResolvedValue({ resumeId: "resume-1", status: "FAILED",
    fileId: "file-1", errorCode: "PDF_NO_TEXT", ocrAvailable: true });
  vi.mocked(resumeApi.parse).mockResolvedValue({ resumeId: "resume-1", status: "QUEUED" });
  const view = render(<UploadPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/本机 OCR/);
  fireEvent.click(screen.getByRole("button", { name: "尝试本机 OCR" }));
  await waitFor(() => expect(resumeApi.parse).toHaveBeenCalledWith("file-1", true));
  view.unmount();
});
