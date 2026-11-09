"use client";

import { useEffect, useRef, useState } from "react";
import { resumeApi } from "../../lib/resumeApi";

const savedResumeKey = "burp-agent-resume-id";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const sequence = useRef(0);

  useEffect(() => {
    const id = sessionStorage.getItem(savedResumeKey);
    if (id) setResumeId(id);
  }, []);

  useEffect(() => {
    if (!resumeId) return;
    const current = ++sequence.current;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 60_000;
    const poll = async () => {
      try {
        const next = await resumeApi.status(resumeId);
        if (current !== sequence.current) return;
        if (next.status === "SUCCEEDED") {
          window.location.assign(`/editor/${encodeURIComponent(resumeId)}`);
          return;
        }
        if (["FAILED", "CANCELLED", "EXPIRED"].includes(next.status)) {
          setBusy(false);
          setError(next.errorCode === "PDF_NO_TEXT" ? "这份 PDF 无法提取文字，请上传文本型 PDF。"
            : `Agent 解析未完成（${next.errorCode ?? next.status}），可重试。`);
          return;
        }
        setStatus(`Agent 正在解析：${next.stage ?? next.status} ${next.progress ?? 0}%`);
        if (Date.now() >= deadline) {
          setBusy(false);
          setError("解析仍在进行。刷新页面可继续查看，也可取消后重试。");
          return;
        }
        timer = setTimeout(poll, 1500);
      } catch (cause) {
        if (current === sequence.current) {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : "查询解析进度失败。");
        }
      }
    };
    void poll();
    return () => { sequence.current++; clearTimeout(timer); };
  }, [resumeId]);

  const choose = (next: File | undefined) => {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".pdf") || next.type && next.type !== "application/pdf") {
      setError("请选择 PDF 文件。"); return;
    }
    if (next.size > 10_000_000) { setError("PDF 不能超过 10 MB。"); return; }
    if (resumeId) void resumeApi.cancel(resumeId).catch(() => {});
    sequence.current++;
    sessionStorage.removeItem(savedResumeKey);
    setFile(next); setFileId(null); setResumeId(null); setStatus(""); setError("");
  };

  const start = async () => {
    if (!file && !fileId) return;
    if (resumeId) setResumeId(null);
    setBusy(true); setError("");
    try {
      let id = fileId;
      if (!id) {
        setStatus("正在上传 PDF：0%");
        const uploaded = await resumeApi.upload(file!, (percent) => setStatus(`正在上传 PDF：${percent}%`));
        id = uploaded.fileId;
        setFileId(id);
      }
      setStatus("已上传，等待 Agent 领取解析任务…");
      const task = await resumeApi.parse(id);
      sessionStorage.setItem(savedResumeKey, task.resumeId);
      setResumeId(task.resumeId);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "上传或解析失败，请重试。");
    }
  };

  const cancel = async () => {
    if (!resumeId) return;
    await resumeApi.cancel(resumeId).catch(() => {});
    sequence.current++;
    setResumeId(null); setBusy(false); setStatus("解析已取消，可重试。");
    sessionStorage.removeItem(savedResumeKey);
  };

  return <main className="resume-flow">
    <a href="/">← 返回首页</a>
    <h1>上传简历，交给 Agent 解析</h1>
    <p>选择文本型 PDF。上传后，原件和可编辑草稿在私有服务器保留 30 天；Agent 会将必要的文字块发送给当前配置的文本模型供应商（OpenAI 或智谱 GLM），用于分类和拆分经历。你可以随时提前删除。</p>
    <label className="resume-upload-box" onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files[0]); }}>选择或拖入 PDF 简历
      <input type="file" accept=".pdf,application/pdf" onChange={(event) => choose(event.currentTarget.files?.[0])} />
    </label>
    {file && <p>已选择：{file.name}</p>}
    <div className="resume-actions">
      <button type="button" disabled={busy || (!file && !fileId)} onClick={() => void start()}>{fileId ? "重试 Agent 解析" : "上传并解析简历"}</button>
      {resumeId && <button type="button" onClick={() => void cancel()}>取消解析</button>}
    </div>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
