"use client";

import { ResumeUpload } from "../../components/ResumeUpload";
import { WorkflowChrome, WorkflowProgress } from "../../components/BuilderChrome";

// 上传是四步流程的第一步：独立步骤页承载 Agent 解析上传，
// 首页只负责引流（/upload 路由），不再内嵌上传区
export default function UploadPage() {
  return <WorkflowChrome
    action={<a className="proof-button" href="/">← 返回首页</a>}
    progress={<WorkflowProgress phase="upload" />}>
    <ResumeUpload />
  </WorkflowChrome>;
}
