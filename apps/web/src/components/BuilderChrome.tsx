"use client";

import { useEffect } from "react";
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

export function ProjectsDialog({ open, projects, onClose, onSelect }: {
  open: boolean;
  projects: readonly OwnedProject[];
  onClose: () => void;
  onSelect: (project: OwnedProject) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return <div className="proof-dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="proof-dialog" role="dialog" aria-modal="true" aria-labelledby="projects-dialog-title">
      <header>
        <div>
          <p>MY PROJECTS</p>
          <h2 id="projects-dialog-title">我的项目</h2>
        </div>
        <ProofButton variant="quiet" aria-label="关闭我的项目" onClick={onClose}>×</ProofButton>
      </header>
      {projects.length === 0 ? <p className="proof-dialog-empty">还没有保存的作品。完成生成后，项目会出现在这里。</p> : <ul className="proof-project-list">
        {projects.map((project) => {
          const name = project.config?.content?.profile?.name?.trim() || "未命名作品";
          return <li key={project.id}>
            <div>
              <strong>{name}</strong>
              <span>{project.paid ? "已解锁分享与导出" : "未付款 · 可继续编辑"}</span>
            </div>
            <ProofButton onClick={() => onSelect(project)}>继续编辑 →</ProofButton>
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
        <span aria-hidden="true">◈</span> BuildURProfile
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
      <button type="button" onClick={onHome}><span aria-hidden="true">◈</span> BuildURProfile</button>
      <span>让简历成为能力证明。</span>
      <span>隐私政策 · 服务条款 · 联系我们</span>
    </footer>
  </div>;
}
