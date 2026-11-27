import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobRole, TemplateId } from "../../../../packages/contracts/src/config";
import type { OwnedProject } from "../lib/paymentApi";
import { BuilderExperience } from "./BuilderExperience";

function renderStyleStep(overrides: Partial<Parameters<typeof BuilderExperience>[0]> = {}) {
  const props = {
    phase: "quiz" as const,
    fileName: "",
    selectedFile: null,
    progress: "",
    error: "",
    draft: null,
    hasConfirmedResume: true,
    confirmedContent: null,
    styleResumeId: "resume_synthetic",
    resultResumeId: null,
    role: "ui-ux-designer" as JobRole,
    selectedTemplate: null as TemplateId | null,
    generated: null,
    projectId: null,
    projectPaid: false,
    isTouch: false,
    share: null,
    savedShares: [],
    projects: [] as OwnedProject[],
    offer: null,
    quotedAmountYuan: null,
    paymentIntent: null,
    restoredDelivery: false,
    draftSaved: false,
    shareSnapshot: "",
    resultError: "",
    exporting: false,
    photoDataUrl: null as string | null,
    photoName: "",
    generatingAvatar: false,
    avatarDemo: false,
    onPhaseChange: vi.fn(),
    onSelectFile: vi.fn(),
    onParseFile: vi.fn(),
    onPhoto: vi.fn(),
    onClearPhoto: vi.fn(),
    onUpdateSingle: vi.fn(),
    onUpdateGroup: vi.fn(),
    onReclassify: vi.fn(),
    onConfirm: vi.fn(),
    onRoleChange: vi.fn(),
    onApplyAnswers: vi.fn(),
    onSelectTemplate: vi.fn(),
    onGenerate: vi.fn(),
    onRunAvatarGeneration: vi.fn(),
    onEditGenerated: vi.fn(),
    onSaveDraft: vi.fn(),
    onRequestDelivery: vi.fn(),
    onConfirmPublish: vi.fn(),
    onStartPayment: vi.fn(),
    onCheckEntitlement: vi.fn(),
    onResumeProject: vi.fn(),
    onDeleteProject: vi.fn(async () => undefined),
    onCopyShare: vi.fn(),
    onRemoveShare: vi.fn(),
    onRemoveSavedShare: vi.fn(),
    onRestartQuiz: vi.fn(),
    ...overrides
  };
  render(<BuilderExperience {...props} />);
  const generate = () => screen.getByRole("button", { name: /生成我的 Showcase/ });
  return { props, generate };
}

describe("BuilderExperience photo gating", () => {
  it("opens the macaron direct photo picker without the vendor gate and keeps generate enabled", () => {
    const { generate } = renderStyleStep({ selectedTemplate: "warm-macaron-v1", avatarDemo: false,
      photoDataUrl: "data:image/png;base64,aGVsbG8=", photoName: "me.png" });
    expect(screen.getByLabelText("选择个人肖像照片")).toBeInTheDocument();
    expect(screen.getByText(/存储于私有资产区/)).toBeInTheDocument();
    expect(screen.getByText(/不发送给图像生成供应商/)).toBeInTheDocument();
    expect(screen.getByText("me.png")).toBeInTheDocument();
    expect(generate()).toBeEnabled();
  });

  it("keeps the macaron picker open when the vendor demo flag is also on", () => {
    renderStyleStep({ selectedTemplate: "warm-macaron-v1", avatarDemo: true,
      photoDataUrl: "data:image/png;base64,aGVsbG8=" });
    expect(screen.getByLabelText("选择个人肖像照片")).toBeInTheDocument();
    expect(screen.getByText(/不发送给图像生成供应商/)).toBeInTheDocument();
  });

  it("still blocks vendor photo generation for non-macaron templates", () => {
    const { generate } = renderStyleStep({ selectedTemplate: "warm-v1", avatarDemo: true,
      photoDataUrl: "data:image/png;base64,aGVsbG8=", photoName: "me.png" });
    expect(screen.queryByLabelText("选择个人肖像照片")).not.toBeInTheDocument();
    expect(screen.getByText(/当前模板暂不支持照片生成/)).toBeInTheDocument();
    expect(generate()).toBeDisabled();
  });

  it("falls back to the deployment notice without the vendor demo flag", () => {
    renderStyleStep({ selectedTemplate: "warm-v1", avatarDemo: false });
    expect(screen.queryByLabelText("选择个人肖像照片")).not.toBeInTheDocument();
    expect(screen.getByText(/当前部署未启用头像生成/)).toBeInTheDocument();
  });

  it("invokes the generate handler from the macaron step", () => {
    const { props } = renderStyleStep({ selectedTemplate: "warm-macaron-v1" });
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    expect(props.onGenerate).toHaveBeenCalled();
  });
});
