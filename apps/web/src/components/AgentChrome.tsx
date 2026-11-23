"use client";

import type { ReactNode } from "react";
import { WorkflowChrome, WorkflowProgress } from "./BuilderChrome";
import type { WorkflowPhase, WorkflowStepTarget } from "./BuilderChrome";

export function AgentChrome({ phase, backHref, backLabel, steps, children }: {
  phase: WorkflowPhase;
  backHref: string;
  backLabel: string;
  steps?: Partial<Record<number, WorkflowStepTarget>>;
  children: ReactNode;
}) {
  return <WorkflowChrome
    action={<a className="proof-button" href={backHref}>{backLabel}</a>}
    progress={<WorkflowProgress phase={phase} targets={steps} />}>
    {children}
  </WorkflowChrome>;
}
