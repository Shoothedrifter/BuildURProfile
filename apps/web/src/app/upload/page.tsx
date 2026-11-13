"use client";

import { useEffect, useRef, useState } from "react";
import { resumeApi } from "../../lib/resumeApi";
import { AgentChrome } from "../../components/AgentChrome";
import { ProofButton, ProofCard, StepHeader } from "../../components/BuilderChrome";

const savedResumeKey = "burp-agent-resume-id";
const savedFileKey = "burp-agent-file-id";

// 解析阶段 → 三段式步进展示（上传完成 → 解析文字 → 整理模块）
const STAGE_STEP: Record<string, 1 | 2 | 3> = {
  queued: 2, validate_source: 2, extract_layout: 2, ocr_pages: 2,
  classify_sections: 3, map_design_modules: 3, split_items: 3,
  format_items: 3, verify_evidence: 3, complete_draft: 3
};
const PARSE_STEPS = ["上传完成 ✓", "解析文字", "整理模块"] as const;

// 服务端错误码 → 用户可读文案（与后端 files.mjs 的上传校验一一对应）
const REJECT_COPY: Record<string, string> = {
  FILE_TOO_LARGE: "PDF 不能超过 10MB，请压缩后重试。",
  PDF_PAGE_LIMIT: "PDF 超过 20 页，请拆分后再上传。",
  PDF_ENCRYPTED: "不支持加密 PDF，请解除密码后重新上传。",
  PDF_NO_TEXT: "这份 PDF 没有可提取文字。可主动尝试本机 OCR。",
  OCR_UNAVAILABLE: "本机 OCR 服务未安装，请联系管理员。",
  OCR_LANGUAGE_MISSING: "本机 OCR 缺少中文或英文语言包，请联系管理员。",
  OCR_TIMEOUT: "本机 OCR 处理超时，可重试。",
  OCR_NO_TEXT: "OCR 未能识别出文字，请检查 PDF 清晰度。",
  OCR_FAILED: "OCR 处理失败，可重试或更换 PDF。",
  FILE_TYPE_INVALID: "请选择 PDF 文件。",
  RATE_LIMITED: "操作太频繁，请稍后再试。"
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState<string | undefined>();
  const [progress, setProgress] = useState<number | undefined>();
  const [error, setError] = useState("");
  const [ocrAvailable, setOcrAvailable] = useState(false);
  const [doneResumeId, setDoneResumeId] = useState<string | null>(null);
  const sequence = useRef(0);
  // 标记 resumeId 是否由本次页面会话的 start() 发起：
  // 会话内解析成功才自动进入编辑器；从编辑器返回（sessionStorage 恢复的已完成任务）只给手动入口，
  // 否则用户会被强制弹回编辑器、永远回不到上传页换新简历。
  const sessionStarted = useRef(false);

  useEffect(() => {
    const id = sessionStorage.getItem(savedResumeKey);
    const storedFileId = sessionStorage.getItem(savedFileKey);
    if (storedFileId) setFileId(storedFileId);
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
        if (next.fileId) {
          setFileId(next.fileId);
          sessionStorage.setItem(savedFileKey, next.fileId);
        }
        setOcrAvailable(Boolean(next.ocrAvailable));
        if (next.status === "SUCCEEDED") {
          if (sessionStarted.current) {
            window.location.assign(`/editor/${encodeURIComponent(resumeId)}`);
            return;
          }
          setBusy(false);
          setStage(undefined);
          setDoneResumeId(resumeId);
          return;
        }
        if (["FAILED", "CANCELLED", "EXPIRED"].includes(next.status)) {
          setBusy(false);
          setStage(undefined);
          setError(next.errorCode && REJECT_COPY[next.errorCode]
            ? REJECT_COPY[next.errorCode]
            : `Agent 解析未完成（${next.errorCode ?? next.status}），可重试。`);
          return;
        }
        setStatus("");
        setStage(next.stage ?? "queued");
        setProgress(next.progress ?? 0);
        if (Date.now() >= deadline) {
          setBusy(false);
          setStage(undefined);
          setError("解析仍在进行。刷新页面可继续查看，也可取消后重试。");
          return;
        }
        timer = setTimeout(poll, 1500);
      } catch (cause) {
        if (current === sequence.current) {
          setBusy(false);
          setStage(undefined);
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
      setError(REJECT_COPY.FILE_TYPE_INVALID); return;
    }
    if (next.size > 10_000_000) { setError(REJECT_COPY.FILE_TOO_LARGE); return; }
    if (resumeId) void resumeApi.cancel(resumeId).catch(() => {});
    sequence.current++;
    sessionStarted.current = false;
    sessionStorage.removeItem(savedResumeKey);
    sessionStorage.removeItem(savedFileKey);
    setFile(next); setFileId(null); setResumeId(null); setPages(null); setDoneResumeId(null);
    setStatus(""); setStage(undefined); setProgress(undefined); setError(""); setOcrAvailable(false);
  };

  const start = async (ocrRequested = false) => {
    if (!file && !fileId) return;
    if (resumeId) setResumeId(null);
    sessionStarted.current = true;
    setBusy(true); setError("");
    try {
      let id = fileId;
      if (!id) {
        setStatus("正在上传 PDF：0%");
        const uploaded = await resumeApi.upload(file!, (percent) => setStatus(`正在上传 PDF：${percent}%`));
        id = uploaded.fileId;
        setFileId(id);
        setPages(uploaded.pageCount);
        sessionStorage.setItem(savedFileKey, id);
      }
      setStatus("已上传，等待 Agent 领取解析任务…");
      const task = await resumeApi.parse(id, ocrRequested);
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
    setResumeId(null); setBusy(false); setStage(undefined); setProgress(undefined);
    setStatus("解析已取消，可重试。");
    sessionStorage.removeItem(savedResumeKey);
  };

  const parsing = Boolean(resumeId && stage);
  const activeStep = stage ? (STAGE_STEP[stage] ?? 2) : 2;

  return <AgentChrome phase="upload" backHref="/" backLabel="← 返回首页">
    <section className="proof-step-page">
      <StepHeader number={1} title="上传你的简历" description="支持 PDF，让 AI 帮你整理经历与项目。" />
      <ProofCard className="proof-upload-card" onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files[0]); }}>
        <span className="proof-upload-arrow" aria-hidden="true">↑</span>
        <p className="proof-upload-title">将 PDF 拖到这里，或点击选择文件</p>
        <label className="proof-upload-trigger">
          <input type="file" accept=".pdf,application/pdf" aria-label="选择或拖入 PDF 简历"
            onChange={(event) => choose(event.currentTarget.files?.[0])} />
          <span className="proof-upload-button" aria-hidden="true">选择 PDF 文件</span>
        </label>
        <p className="proof-microcopy">支持键盘 Enter 选择文件</p>
      </ProofCard>
      <p className="proof-note">仅 PDF · 单次 1 个文件 · ≤10MB · 1–20 页</p>
      <p className="proof-note">不支持加密文件；扫描版 PDF 可在普通解析失败后主动尝试本机 OCR。</p>
      {file && <div className="proof-file-ready">
        <div>
          <strong>{file.name}</strong>
          <span>{(file.size / 1_048_576).toFixed(1)}MB
            {pages ? ` · ${pages} 页 · 校验通过` : " · 待上传校验"}</span>
        </div>
        <ProofButton variant="quiet" onClick={() => { setFile(null); setPages(null); }}>重新选择</ProofButton>
      </div>}
      <div className="proof-actions">
        <ProofButton variant="primary" disabled={busy || (!file && !fileId)} onClick={() => void start()}>
          {fileId ? "重试 Agent 解析" : "上传并解析简历"}</ProofButton>
        {fileId && ocrAvailable && !busy && <ProofButton onClick={() => void start(true)}>
          尝试本机 OCR</ProofButton>}
        {resumeId && <ProofButton onClick={() => void cancel()}>取消解析</ProofButton>}
      </div>
      {parsing ? <div className="proof-parse-card" role="status">
        <p className="proof-parse-steps" aria-hidden="true">
          {PARSE_STEPS.map((label, index) => <span key={label}
            data-state={index + 1 < activeStep ? "done" : index + 1 === activeStep ? "active" : ""}>
            {label}{index < PARSE_STEPS.length - 1 ? " →" : ""}
          </span>)}
        </p>
        <p>AI 正在解析简历… 预计 10–30 秒 · {progress ?? 0}%</p>
        <div className="proof-progress-track" aria-hidden="true">
          <div className="proof-progress-fill" style={{ width: `${progress ?? 0}%` }} />
        </div>
      </div> : status ? <p role="status">{status}</p> : null}
      {doneResumeId && <div className="proof-file-ready" role="status">
        <div>
          <strong>上次解析已完成</strong>
          <span>可继续核对这份草稿，或选择新 PDF 重新上传</span>
        </div>
        <a className="proof-button proof-button--primary" href={`/editor/${encodeURIComponent(doneResumeId)}`}>打开编辑器 →</a>
      </div>}
      {error && <p className="proof-inline-error" role="alert">{error}</p>}
      <p className="proof-microcopy">原件与草稿保留 30 天，可随时提前删除；必要文字仅发送给模型供应商整理，简历仅用于生成网站。</p>
    </section>
  </AgentChrome>;
}
