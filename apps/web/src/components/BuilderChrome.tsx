"use client";

import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { OwnedProject } from "../lib/paymentApi";

export type WorkflowPhase = "landing" | "upload" | "confirm" | "quiz" | "result" | "delivery" | "mock";

const progressSteps = ["上传简历", "解析与补充", "头像与风格", "生成作品集", "分享与付费"] as const;
const phaseStep: Record<Exclude<WorkflowPhase, "landing" | "mock">, number> = {
  upload: 1,
  confirm: 2,
  quiz: 3,
  result: 4,
  delivery: 5
};

type ProofButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
};

export function ProofButton({ variant = "secondary", className = "", type = "button", ...props }: ProofButtonProps) {
  return <button type={type} className={`proof-button proof-button--${variant} ${className}`.trim()} {...props} />;
}

export function ProofCard({ children, className = "", as: Tag = "div", ...props }: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
} & HTMLAttributes<HTMLElement>) {
  return <Tag className={`proof-card ${className}`.trim()} {...props}>{children}</Tag>;
}

export function WorkflowProgress({ phase }: { phase: WorkflowPhase }) {
  const active = phase === "landing" || phase === "mock" ? 0 : phaseStep[phase];
  return <nav className="proof-progress" aria-label="生成进度">
    <ol>
      {progressSteps.map((label, index) => {
        const step = index + 1;
        return <li key={label} className={step === active ? "is-active" : step < active ? "is-done" : ""} aria-current={step === active ? "step" : undefined}>
          <span>{step}.</span> {label}
        </li>;
      })}
    </ol>
  </nav>;
}

export function StepHeader({ number, title, description }: { number: number; title: string; description: string }) {
  return <header className="proof-step-heading">
    <p>BUILD YOUR PROOF / {String(number).padStart(2, "0")}</p>
    <h1>{title}</h1>
    <span>{description}</span>
  </header>;
}

export function ProjectsDialog({ open, projects, onClose, onSelect, onDelete }: {
  open: boolean;
  projects: readonly OwnedProject[];
  onClose: () => void;
  onSelect: (project: OwnedProject) => void;
  onDelete: (project: OwnedProject) => Promise<void>;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const close = () => {
    if (deletingId) return;
    setConfirmingId(null);
    setDeleteError("");
    onClose();
  };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deletingId, onClose, open]);

  const deleteSelected = async (project: OwnedProject) => {
    setDeletingId(project.id);
    setDeleteError("");
    try {
      await onDelete(project);
      setConfirmingId(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "删除项目失败，请重试。");
    } finally {
      setDeletingId(null);
    }
  };

  if (!open) return null;
  return <div className="proof-dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) close();
  }}>
    <section className="proof-dialog" role="dialog" aria-modal="true" aria-labelledby="projects-dialog-title">
      <header>
        <div>
          <p>MY PROJECTS</p>
          <h2 id="projects-dialog-title">我的项目</h2>
        </div>
        <ProofButton variant="quiet" aria-label="关闭我的项目" onClick={close}>×</ProofButton>
      </header>
      {projects.length === 0 ? <p className="proof-dialog-empty">还没有保存的作品。完成生成后，项目会出现在这里。</p> : <ul className="proof-project-list">
        {projects.map((project) => {
          const name = project.config?.content?.profile?.name?.trim() || "未命名作品";
          return <li key={project.id}>
            <div>
              <strong>{name}</strong>
              <span>{project.paid ? "已解锁分享与导出" : "未付款 · 可继续编辑"}</span>
            </div>
            <div className="proof-project-actions">
              <ProofButton disabled={Boolean(deletingId)} onClick={() => { close(); onSelect(project); }}>继续编辑 →</ProofButton>
              <ProofButton variant="quiet" disabled={Boolean(deletingId)} aria-label={`删除项目 ${name}`}
                onClick={() => { setConfirmingId(project.id); setDeleteError(""); }}>删除项目</ProofButton>
            </div>
            {confirmingId === project.id && <div className="proof-project-delete-confirm">
              <p>删除后无法恢复；已支付项目也无法继续分享或导出。分享链接和未使用的下载链接会失效，支付记录仍会保留。</p>
              <div>
                <ProofButton variant="primary" disabled={Boolean(deletingId)} onClick={() => void deleteSelected(project)}>
                  {deletingId === project.id ? "正在删除…" : "确认删除"}
                </ProofButton>
                <ProofButton variant="quiet" disabled={Boolean(deletingId)} onClick={() => { setConfirmingId(null); setDeleteError(""); }}>取消删除</ProofButton>
              </div>
              {deleteError && <p role="alert">{deleteError}</p>}
            </div>}
          </li>;
        })}
      </ul>}
    </section>
  </div>;
}

export function BuilderChrome({ children, projectCount, onHome, onProjects, onSample, onSection }: {
  children: ReactNode;
  projectCount: number;
  onHome: () => void;
  onProjects: () => void;
  onSample: () => void;
  onSection: (section: "about" | "process") => void;
}) {
  return <div className="proof-page">
    <div className="proof-banner">✦ 让你的经历被看见，让你的能力被体验。</div>
    <header className="proof-nav">
      <button type="button" className="proof-brand" onClick={onHome} aria-label="返回 BuildURProfile 首页">
        <img src="/logo.png" alt="BuildURProfile" width={104} height={54} />
      </button>
      <nav aria-label="主导航">
        <button type="button" onClick={() => onSection("about")}>产品介绍</button>
        <button type="button" onClick={onSample}>作品集样例</button>
        <button type="button" onClick={() => onSection("process")}>制作流程</button>
      </nav>
      <ProofButton onClick={onProjects} aria-label={`我的项目，共 ${projectCount} 个`}>我的项目</ProofButton>
    </header>
    <main className="proof-main">{children}</main>
    <footer className="proof-footer">
      <button type="button" onClick={onHome} aria-label="返回 BuildURProfile 首页">
        <img src="/logo.png" alt="BuildURProfile" width={88} height={46} />
      </button>
      <span>让简历成为能力证明。</span>
      <span>隐私政策 · 服务条款 · 联系我们</span>
    </footer>
  </div>;
}
