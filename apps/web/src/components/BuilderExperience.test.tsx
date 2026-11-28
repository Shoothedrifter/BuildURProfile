import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesignConfig, DesignConfigV4, JobRole, TemplateId } from "../../../../packages/contracts/src/config";
import type { ResumeDraft } from "../lib/resume";
import type { OwnedProject } from "../lib/paymentApi";
import { createDemoShowcaseConfig } from "../demo/showcaseDemo";
import { BuilderExperience } from "./BuilderExperience";

const emptyField = (value = "") => ({ value, source: value, page: 1, included: true });
/** 浏览器解析草稿的最小形态：仅触发 quiz 渲染与预设答案应用路径。 */
const browserDraft = {
  version: "resume-candidate-v2",
  name: emptyField("林予安"),
  email: emptyField("lin@example.test"),
  basicInfo: [], jobIntent: [], selfEvaluation: [], education: [], workExperience: [],
  campusExperience: [], projects: [], awards: [], skills: [], other: []
} as ResumeDraft;

const macaronAnswers = {
  "e-presence": 3,
  "e-type": 2,
  "k-pace": 2,
  "k-cards": 2,
  "p-tone": 2,
  "p-strength": 2,
  "s-browse": 2,
  "s-control": 2
};

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

describe("BuilderExperience preset handover", () => {
  it("lists five presets with macaron replacing the retired warm entry", () => {
    renderStyleStep();
    const presets = Array.from(document.querySelectorAll("[data-preset]"));
    expect(presets).toHaveLength(5);
    expect(screen.getByRole("button", { name: /暖调马卡龙/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /温暖创意/ })).not.toBeInTheDocument();
  });

  it("selects the macaron template and applies the warm answer combination", () => {
    const { props } = renderStyleStep({ hasConfirmedResume: false, draft: browserDraft });
    fireEvent.click(screen.getByRole("button", { name: /暖调马卡龙/ }));
    expect(props.onSelectTemplate).toHaveBeenCalledWith("warm-macaron-v1");
    expect(props.onApplyAnswers).toHaveBeenCalledWith(macaronAnswers);
  });

  it("renders the real macaron hero preview with the default portrait", () => {
    renderStyleStep({ selectedTemplate: "warm-macaron-v1" });
    expect(document.querySelector(".macaron-template-preview")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "你的名字的默认形象" }))
      .toHaveAttribute("src", "/warm-macaron-default.svg");
    expect(screen.getByText(/马卡龙样张展示真实模板首屏/)).toBeInTheDocument();
  });

  it("shows the uploaded photo directly in the macaron hero preview", () => {
    renderStyleStep({ selectedTemplate: "warm-macaron-v1", photoDataUrl: "data:image/png;base64,aGVsbG8=" });
    expect(screen.getByRole("img", { name: "你的名字的个人照片" }))
      .toHaveAttribute("src", "data:image/png;base64,aGVsbG8=");
  });
});

describe("BuilderExperience result photo settings", () => {
  function renderMacaronResult(overrides: Partial<Parameters<typeof BuilderExperience>[0]> = {},
    heroPhoto?: { assetUrl: string; alt: string }) {
    const base = createDemoShowcaseConfig("warm-macaron-v1") as DesignConfig;
    const generated = heroPhoto ? { ...base, heroPhoto } as DesignConfig : base;
    return { generated, ...renderStyleStep({ phase: "result", generated, ...overrides }) };
  }

  function openPhotoSettings() {
    fireEvent.click(screen.getByRole("tab", { name: "设置" }));
    fireEvent.click(screen.getByText("更换照片 →"));
  }

  it("swaps the embedded photo through the picker without a vendor task", () => {
    const { props, generated } = renderMacaronResult({
      photoDataUrl: "data:image/png;base64,bmV3cGhvdG8=", photoName: "new.png"
    });
    openPhotoSettings();
    expect(screen.getByText(/不发送给图像生成供应商/)).toBeInTheDocument();
    expect(props.onRunAvatarGeneration).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /应用新照片/ }));
    expect(props.onEditGenerated).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    const update = vi.mocked(props.onEditGenerated).mock.calls[0][0];
    expect((update(generated) as DesignConfigV4).heroPhoto).toEqual({
      assetUrl: "data:image/png;base64,bmV3cGhvdG8=",
      alt: "林予安的个人照片"
    });
  });

  it("offers removal when the work embeds a photo but no local copy is held", () => {
    const { props } = renderMacaronResult({ photoDataUrl: null, photoName: "" },
      { assetUrl: "/api/portraits/expired", alt: "林予安的个人照片" });
    openPhotoSettings();
    expect(screen.queryByLabelText("选择个人肖像照片")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /移除作品中的照片/ }));
    expect(props.onClearPhoto).toHaveBeenCalledOnce();
  });
});
