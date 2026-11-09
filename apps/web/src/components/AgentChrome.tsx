"use client";

import type { ReactNode } from "react";
import { WorkflowProgress } from "./BuilderChrome";
import type { WorkflowPhase } from "./BuilderChrome";

// Agent 流程页（上传 / 编辑器）共用的品牌外壳：横幅、logo 导航、五步进度与页脚，
// 视觉上与 BuilderChrome 的 .proof-page 令牌体系保持同一套语言。
export function AgentChrome({ phase, backHref, backLabel, children }: {
  phase: WorkflowPhase;
  backHref: string;
  backLabel: string;
  children: ReactNode;
}) {
  return <div className="proof-page">
    <div className="proof-banner">✦ 让你的经历被看见，让你的能力被体验。</div>
    <header className="proof-nav">
      <a className="proof-brand" href="/" aria-label="返回 BuildURProfile 首页">
        <img src="/logo.png" alt="BuildURProfile" width={104} height={54} />
      </a>
      <nav aria-label="流程导航">
        <a href={backHref}>{backLabel}</a>
      </nav>
      <span aria-hidden="true" />
    </header>
    <WorkflowProgress phase={phase} />
    <main className="proof-main">{children}</main>
    <footer className="proof-footer">
      <a href="/" aria-label="返回 BuildURProfile 首页">
        <img src="/logo.png" alt="BuildURProfile" width={88} height={46} />
      </a>
      <span>让简历成为能力证明。</span>
      <span>隐私政策 · 服务条款 · 联系我们</span>
    </footer>
  </div>;
}
