import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignConfig, DesignConfigV4 } from "../../../packages/contracts/src/config";
import { normalizeResumeDraft, projectConfirmedResumeV3 } from "../../../packages/contracts/src/resume-draft";
import App from "./App";
import { ShowcasePage } from "./ShowcasePage";
import rawConfig from "./demo/config.json";
import resumeDraftFixture from "../../../packages/contracts/fixtures/resume-draft.v1.json";
import { extractPdfText } from "./lib/pdf";
import { githubPagesApi, paymentApi } from "./lib/paymentApi";
import { generationApi } from "./lib/generationApi";
import { resumeApi } from "./lib/resumeApi";
import { preparePortrait } from "./lib/portrait";
import { scoreAnswers } from "./lib/assessment";
import { styleToConfig } from "./lib/mapping";
import { skillShortLabels } from "./lib/resume";

vi.mock("./lib/pdf", () => ({ extractPdfText: vi.fn() }));
vi.mock("./lib/generationApi", () => ({ generationApi: { generatePortfolio: vi.fn(), generateAvatar: vi.fn(),
  generatePixelAvatar: vi.fn(), pixelAvatarEnabled: vi.fn().mockResolvedValue(false),
  resumeGeneration: vi.fn().mockResolvedValue(null), clearSavedGeneration: vi.fn(),
  cancelSavedGeneration: vi.fn().mockResolvedValue(null) } }));
vi.mock("./lib/resumeApi", () => ({ resumeApi: { read: vi.fn() } }));
vi.mock("./lib/portrait", () => ({ preparePortrait: vi.fn().mockResolvedValue("data:image/jpeg;base64,cG9ydHJhaXQ=") }));
vi.mock("./lib/paymentApi", () => ({
  githubPagesApi: { list: vi.fn().mockResolvedValue([]), status: vi.fn(), start: vi.fn() },
  paymentApi: {
    offer: vi.fn().mockResolvedValue({ configured: true, mode: "sandbox", priceFen: 199, priceYuan: "1.99", service: "正式托管分享与静态网站导出", shareDays: 7 }),
    projects: vi.fn().mockResolvedValue([]),
    readShare: vi.fn(),
    createProject: vi.fn().mockResolvedValue({ id: "project-1", config: null, revision: 1, paid: false, pendingAction: null }),
    project: vi.fn().mockResolvedValue({ id: "project-1", config: null, revision: 1, paid: false, pendingAction: null }),
    updateProject: vi.fn().mockResolvedValue({ id: "project-1", config: null, revision: 2, paid: false, pendingAction: null }),
    deleteProject: vi.fn().mockResolvedValue({ ok: true }),
    checkout: vi.fn().mockResolvedValue({ alreadyPaid: false, paymentHtml: "<form></form>" }),
    shares: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ token: "a".repeat(43), url: `http://localhost:3000/#share=${"a".repeat(43)}`, expiresAt: Date.now() + 1000 }),
    export: vi.fn().mockResolvedValue({ url: "/api/downloads/test", expiresAt: Date.now() + 1000 }),
    revoke: vi.fn().mockResolvedValue({ ok: true }),
    reconcile: vi.fn()
  },
  submitAlipayForm: vi.fn()
}));

const pages = [
  `黄琬斐\nhuangwanfei_05@163.com\n2026.09 - 2027.12 香港大学\nMaster of Science in Computer Science | 全日制硕士\n2022.09 - 2026.06 华中农业大学\n计算机科学与技术 | 本科\n编程与数据：使用NumPy、pandas完成数据清洗。\n模型训练与NLP：基于PyTorch搭建训练流程。\n智能体开发：基于LangGraph与ReAct开发多Agent工作流。\n模型推理与部署：具有vLLM部署实践。\n工程化开发：FastAPI、MySQL构建后端服务。\nHalliday 北京霍达视界科技有限公司 2026.04 - 2026.08\nAIAgent开发实习生\n负责MeetingFlow决策卡。`,
  `嵌入式固件日志 bug 诊断Agent 2026.06 - 2026.08\n项目描述：支持百MB级日志的关键行定位。\n学习工厂—— 多智能体学习计划制定系统 2026.02 - 2026.03\n项目描述：基于OpenAI兼容SDK自研AgentLoop。`
];

function openUpload() {
  fireEvent.click(screen.getAllByRole("button", { name: /浏览器解析（兼容）/ })[0]);
}

async function chooseAndParse(name = "resume.pdf") {
  const input = screen.getByLabelText("选择 PDF 简历");
  fireEvent.change(input, { target: { files: [new File(["pdf"], name, { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: /解析简历/ }));
  await screen.findByRole("heading", { name: "让每一段经历，都有证据可循" });
}

async function reachStyle() {
  openUpload();
  await chooseAndParse();
  fireEvent.click(screen.getByRole("button", { name: /确认资料，选择风格/ }));
  await screen.findByRole("heading", { name: "挑选风格与头像" });
}

function answerAll(optionIndex = 0) {
  fireEvent.click(screen.getByRole("button", { name: optionIndex === 4 ? /大胆实验/ : /理性简约/ }));
}

async function reachResult(optionIndex = 0) {
  await reachStyle();
  answerAll(optionIndex);
  fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
  await screen.findByRole("heading", { name: "04 网站预览与轻量编辑" });
}

async function reachPixelAvatar() {
  window.history.replaceState(null, "", "/style/resume_synthetic");
  const draft = { ...normalizeResumeDraft(resumeDraftFixture), revision: 1 };
  vi.mocked(resumeApi.read).mockResolvedValueOnce({ draft, revision: 1, expiresAt: "2026-12-09T00:00:00Z" });
  const config = { ...rawConfig, templateId: "pixel-world-v1", content: projectConfirmedResumeV3(draft) } as DesignConfigV4;
  vi.mocked(generationApi.generatePortfolio).mockResolvedValueOnce({ config });
  vi.mocked(generationApi.pixelAvatarEnabled).mockResolvedValue(true);
  render(<App initialPhase="quiz" styleResumeId="resume_synthetic" />);
  fireEvent.click(await screen.findByRole("button", { name: /像素世界风/ }));
  fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
  fireEvent.click(await screen.findByRole("tab", { name: "设置" }));
  return {
    preview: within(await screen.findByTestId("pixel-world-page")),
    input: await screen.findByLabelText("选择个人像素头像照片")
  };
}

const pixelArtwork = { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012", styleId: "pixel-halfbody-v1", alt: "个人像素头像" };

async function choosePixelPhoto(input: HTMLElement, name = "synthetic.png") {
  fireEvent.change(input, { target: { files: [new File(["photo"], name, { type: "image/png" })] } });
  const recognize = screen.getByRole("button", { name: "识别照片特征" });
  await waitFor(() => expect(recognize).toBeEnabled());
  return recognize;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  vi.stubGlobal("scrollTo", vi.fn());
  vi.mocked(extractPdfText).mockClear();
  vi.mocked(extractPdfText).mockResolvedValue({ pages, text: pages.join("\n\n") });
  vi.mocked(generationApi.generatePortfolio).mockReset().mockImplementation(async (brief) => {
    if (!("content" in brief)) throw new Error("Server draft request must use dedicated fixture");
    const mapped = styleToConfig(scoreAnswers(brief.answers), brief.role);
    return { config: { ...mapped, marquee: { ...mapped.marquee, items: skillShortLabels(brief.content.expertise.skills) },
      content: brief.content } };
  });
  vi.mocked(generationApi.generateAvatar).mockReset();
  vi.mocked(generationApi.generatePixelAvatar).mockReset();
  vi.mocked(generationApi.pixelAvatarEnabled).mockReset().mockResolvedValue(false);
  vi.mocked(generationApi.resumeGeneration).mockReset().mockResolvedValue(null);
  vi.mocked(resumeApi.read).mockReset();
  vi.mocked(generationApi.clearSavedGeneration).mockClear();
  vi.mocked(generationApi.cancelSavedGeneration).mockClear();
  vi.mocked(preparePortrait).mockReset().mockResolvedValue("data:image/jpeg;base64,cG9ydHJhaXQ=");
  const project = { id: "project-1", config: rawConfig as DesignConfig, revision: 1, paid: false, pendingAction: null, pendingAmountFen: null };
  vi.mocked(paymentApi.createProject).mockReset().mockResolvedValue(project);
  vi.mocked(paymentApi.project).mockReset().mockResolvedValue(project);
  vi.mocked(paymentApi.updateProject).mockReset().mockResolvedValue({ ...project, revision: 2 });
  vi.mocked(paymentApi.checkout).mockClear();
  vi.mocked(paymentApi.projects).mockReset().mockResolvedValue([]);
  vi.mocked(paymentApi.deleteProject).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(paymentApi.publish).mockClear();
  vi.mocked(paymentApi.export).mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("showcase builder", () => {
  it("restores the owning project and shows the public address after GitHub returns", async () => {
    const siteUrl = "https://test-owner.github.io/portfolio/";
    const id = "deployment-1";
    window.history.replaceState(null, "", `/?github_deployment=${id}#work`);
    vi.mocked(githubPagesApi.status).mockResolvedValueOnce({ id, projectId: "project-1", repo: "portfolio", revision: 1,
      stage: "published", error: null, repoUrl: "https://github.com/test-owner/portfolio", siteUrl });
    vi.mocked(paymentApi.project).mockResolvedValueOnce({ id: "project-1", config: rawConfig as DesignConfig,
      revision: 1, paid: true, pendingAction: null, pendingAmountFen: null });
    try {
      render(<App />);
      const dialog = within(await screen.findByRole("dialog", { name: "部署到 GitHub Pages" }));
      expect(dialog.getByLabelText("公开网址")).toHaveValue(siteUrl);
      expect(dialog.getByRole("link", { name: "打开网站" })).toHaveAttribute("href", siteUrl);
      expect(generationApi.resumeGeneration).not.toHaveBeenCalled();
      fireEvent.click(dialog.getByRole("button", { name: "关闭" }));
      expect(window.location.search).toBe("");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("continues GitHub deployment after payment without publishing a hosted share", async () => {
    window.history.replaceState(null, "", "/payment/return?project_id=project-1");
    sessionStorage.setItem("github-pages-repo:project-1", "my-portfolio");
    vi.mocked(paymentApi.reconcile).mockResolvedValueOnce({ id: "project-1", config: rawConfig as DesignConfig,
      revision: 1, paid: true, pendingAction: "github-pages", pendingAmountFen: null });
    try {
      render(<App />);
      const dialog = within(await screen.findByRole("dialog", { name: "部署到 GitHub Pages" }));
      expect(dialog.getByLabelText("新仓库名称")).toHaveValue("my-portfolio");
      expect(dialog.getByRole("checkbox")).not.toBeChecked();
      expect(dialog.getByText(/已解锁发布资格/)).toBeVisible();
      expect(paymentApi.publish).not.toHaveBeenCalled();
      expect(githubPagesApi.start).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("discloses photo processing before recognition and applies the private candidate only after selection", async () => {
    vi.mocked(generationApi.generatePixelAvatar).mockResolvedValueOnce(pixelArtwork);
    try {
      const { preview, input } = await reachPixelAvatar();
      const disclosure = screen.getByText(/Cloudflare Workers AI/);
      expect(disclosure).toHaveTextContent(/用于识别发型、发色、镜框和可见的头颈配饰/);
      expect(disclosure).toHaveTextContent(/短发.*齐肩发.*长发/);
      expect(disclosure).toHaveTextContent(/单马尾.*双马尾.*刘海/);
      expect(disclosure).toHaveTextContent(/暖棕.*粉色.*镜框/);
      expect(disclosure).toHaveTextContent(/原照片.*1 天.*候选头像.*7 天/);
      expect(disclosure).toHaveTextContent(/仅用于当前编辑预览.*分享和导出使用默认角色/);
      const recognize = await choosePixelPhoto(input);
      expect(generationApi.generatePixelAvatar).not.toHaveBeenCalled();
      fireEvent.click(recognize);
      expect(await screen.findByRole("img", { name: "生成的像素头像候选" })).toBeInTheDocument();
      expect(preview.getByRole("img", { name: "像素世界风默认角色" })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "使用此头像" }));
      expect(preview.getByRole("img", { name: pixelArtwork.alt })).toHaveAttribute("src", pixelArtwork.assetUrl);
      expect(screen.getByText(/分享和导出将使用默认角色/)).toBeInTheDocument();
      expect(JSON.parse(screen.getByTestId("design-config-json").textContent || "{}")).not.toHaveProperty("heroArtwork");

      vi.mocked(generationApi.generatePixelAvatar).mockRejectedValueOnce(new Error("这张照片没有可应用的造型特征。你可以保留当前头像、使用默认角色，或换一张照片。"));
      fireEvent.click(await choosePixelPhoto(input, "unsupported.png"));
      expect(await screen.findByRole("alert")).toHaveTextContent(/没有可应用的造型特征.*默认角色/);
      expect(preview.getByRole("img", { name: pixelArtwork.alt })).toHaveAttribute("src", pixelArtwork.assetUrl);
      expect(screen.queryByRole("button", { name: "使用此头像" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "恢复默认角色" }));
      expect(preview.getByRole("img", { name: "像素世界风默认角色" })).toBeVisible();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it.each(["switch photo", "restore default", "leave the result"] as const)("ignores a late avatar candidate when the user chooses to %s", async action => {
    let finish!: (artwork: typeof pixelArtwork) => void;
    vi.mocked(generationApi.generatePixelAvatar).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    try {
      const { preview, input } = await reachPixelAvatar();
      fireEvent.click(await choosePixelPhoto(input));
      expect(screen.getByText("正在识别照片特征…")).toBeVisible();
      const [, , signal] = vi.mocked(generationApi.generatePixelAvatar).mock.calls[0];
      if (action === "switch photo") await choosePixelPhoto(input, "new-photo.png");
      if (action === "restore default") fireEvent.click(screen.getByRole("button", { name: "恢复默认角色" }));
      if (action === "leave the result") {
        fireEvent.click(within(screen.getByRole("navigation", { name: "生成进度" })).getByRole("button", { name: /挑选风格/ }));
      }
      expect(signal.aborted).toBe(true);
      await act(async () => finish(pixelArtwork));
      expect(screen.queryByRole("button", { name: "使用此头像" })).toBeNull();
      if (action === "leave the result") {
        expect(screen.queryByLabelText("选择个人像素头像照片")).toBeNull();
      } else {
        expect(preview.getByRole("img", { name: "像素世界风默认角色" })).toBeVisible();
      }
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("selecting Pixel World generates the confirmed resume without a portrait", async () => {
    window.history.replaceState(null, "", "/style/resume_synthetic");
    const draft = { ...normalizeResumeDraft(resumeDraftFixture), revision: 1 };
    vi.mocked(resumeApi.read).mockResolvedValueOnce({ draft, revision: 1, expiresAt: "2026-12-09T00:00:00Z" });
    let finish!: (result: Awaited<ReturnType<typeof generationApi.generatePortfolio>>) => void;
    vi.mocked(generationApi.generatePortfolio).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    try {
      render(<App initialPhase="quiz" styleResumeId="resume_synthetic" />);
      fireEvent.click(await screen.findByRole("button", { name: /像素世界风/ }));
      fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
      expect(screen.getByRole("button", { name: /赛博科技/ })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: "展示方向" })).toBeDisabled();
      finish({ config: { ...rawConfig, templateId: "pixel-world-v1", content: projectConfirmedResumeV3(draft) } as DesignConfigV4 });
      expect(await screen.findByTestId("pixel-world-page")).toBeInTheDocument();
      expect(screen.queryByLabelText("选择个人像素头像照片")).toBeNull();
      expect(vi.mocked(generationApi.generatePortfolio).mock.calls[0].slice(0, 2)).toEqual([{
        resumeId: "resume_synthetic", revision: 1, role: "frontend-creative-developer", templateId: "pixel-world-v1"
      }, undefined]);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("keeps Pixel World out of the legacy browser-only choices", async () => {
    render(<App />);
    await reachStyle();
    expect(screen.queryByRole("button", { name: /像素世界风/ })).toBeNull();
  });

  it("submits an explicit cyber template from a confirmed Agent resume without preference answers", async () => {
    window.history.replaceState(null, "", "/style/resume_synthetic");
    const nextDraft = { ...normalizeResumeDraft(resumeDraftFixture), revision: 1 };
    vi.mocked(resumeApi.read).mockResolvedValueOnce({ draft: nextDraft,
      revision: 1, expiresAt: "2026-12-09T00:00:00Z" });
    const confirmed = projectConfirmedResumeV3(nextDraft);
    vi.mocked(generationApi.generatePortfolio).mockResolvedValueOnce({ config: {
      ...rawConfig, templateId: "cyber-creator-v1", content: confirmed
    } as DesignConfigV4 });
    try {
      render(<App initialPhase="quiz" styleResumeId="resume_synthetic" />);
      await screen.findByRole("heading", { name: "挑选风格与头像" });
      expect(screen.getByText("合成用户 / 个人作品集")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /赛博科技/ }));
      expect(within(screen.getByLabelText("首屏实时预览")).getByRole("img", { name: "赛博科技默认中性动漫形象" }))
        .toHaveAttribute("src", "/cyber-neutral-print-anime.webp");
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
      expect(await screen.findByTestId("cyber-creator-page")).toBeInTheDocument();
      expect(vi.mocked(generationApi.generatePortfolio).mock.calls[0][0]).toEqual({
        resumeId: "resume_synthetic", revision: 1,
        role: "frontend-creative-developer", templateId: "cyber-creator-v1"
      });
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("keeps a supplemented project image attached through cyber editing and publication", async () => {
    window.history.replaceState(null, "", "/style/resume_synthetic");
    const nextDraft = normalizeResumeDraft(resumeDraftFixture);
    const projectSection = nextDraft.sections.find(section => section.kind === "projects");
    if (!projectSection) throw new Error("Synthetic project section missing");
    const project = { itemId: "item_project", order: 0, title: "项目甲", details: "完整项目说明", facts: [],
      sourceBlockIds: [], confidence: 1, segmentationConfidence: 1, needsReview: false, included: true,
      origin: "user" as const, editedFields: [],
      supplements: { text: "项目补充", links: [], images: [{ imageId: "image_synthetic", caption: "原图片说明" }] } };
    projectSection.items.push(project);
    vi.mocked(resumeApi.read).mockResolvedValueOnce({ draft: nextDraft,
      revision: nextDraft.revision, expiresAt: "2026-12-09T00:00:00Z" });
    const content = projectConfirmedResumeV3(nextDraft);
    vi.mocked(generationApi.generatePortfolio).mockResolvedValueOnce({ config: {
      ...rawConfig, templateId: "cyber-creator-v1", content
    } as DesignConfigV4 });
    try {
      render(<App initialPhase="quiz" styleResumeId="resume_synthetic" />);
      await screen.findByRole("heading", { name: "挑选风格与头像" });
      fireEvent.click(screen.getByRole("button", { name: /赛博科技/ }));
      fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
      const showcase = await screen.findByTestId("cyber-creator-page");
      expect(within(showcase).getByRole("img", { name: "原图片说明" })).toHaveAttribute("src", "/api/showcase-media/image_synthetic");
      fireEvent.change(screen.getByRole("textbox", { name: "图片说明 1" }), { target: { value: "修改后的图片说明" } });
      expect(within(showcase).getByRole("img", { name: "修改后的图片说明" })).toHaveAttribute("src", "/api/showcase-media/image_synthetic");
      fireEvent.click(screen.getByRole("button", { name: /发布并获取链接/ }));
      fireEvent.click(screen.getByRole("button", { name: "确认并发布" }));
      await waitFor(() => expect(paymentApi.createProject).toHaveBeenCalledWith(expect.objectContaining({
        templateId: "cyber-creator-v1",
        content: expect.objectContaining({ resume: expect.objectContaining({
          sections: expect.arrayContaining([expect.objectContaining({ kind: "projects",
            items: expect.arrayContaining([expect.objectContaining({ itemId: project.itemId,
              supplement: expect.objectContaining({ images: [{ imageId: "image_synthetic", caption: "修改后的图片说明" }] }) })]) })])
        }) })
      }), nextDraft.resumeId));
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("shows the style loading state immediately on the style route", async () => {
    window.history.replaceState(null, "", "/style/resume_synthetic");
    vi.mocked(resumeApi.read).mockResolvedValueOnce({ draft: resumeDraftFixture as never,
      revision: 1, expiresAt: "2026-12-09T00:00:00Z" });
    try {
      const serverHtml = renderToString(<App initialPhase="quiz" styleResumeId="resume_synthetic" />);
      expect(serverHtml).toContain("正在读取已确认的简历草稿");
      expect(serverHtml).not.toContain("launch-hero-title");
      render(<App initialPhase="quiz" styleResumeId="resume_synthetic" />);
      expect(screen.queryByRole("heading", { name: /你的经历.*值得被看见/ })).not.toBeInTheDocument();
      expect(screen.getByText("正在读取已确认的简历草稿…")).toBeInTheDocument();
      await act(async () => {});
      expect(await screen.findByRole("heading", { name: "挑选风格与头像" })).toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("lets users revisit completed steps from the progress bar", async () => {
    render(<App />);
    await reachStyle();
    fireEvent.click(within(screen.getByRole("navigation", { name: "生成进度" })).getByRole("button", { name: /解析与补充/ }));
    expect(screen.getByRole("heading", { name: "让每一段经历，都有证据可循" })).toBeInTheDocument();
  });

  it("uses template selection without showing preference questions", async () => {
    render(<App />);
    await reachStyle();
    expect(screen.queryByText("你的偏好画像")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    const generate = screen.getByRole("button", { name: /生成我的 Showcase/ });
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /温暖创意/ }));
    expect(generate).toBeEnabled();
  });

  it("opens a confirmed Agent resume in style instead of restoring an older showcase", async () => {
    window.history.replaceState(null, "", "/style/resume_synthetic");
    vi.mocked(resumeApi.read).mockResolvedValueOnce({ draft: resumeDraftFixture as never,
      revision: 1, expiresAt: "2026-12-09T00:00:00Z" });
    vi.mocked(generationApi.resumeGeneration).mockResolvedValueOnce({ config: rawConfig as DesignConfig });
    try {
      render(<App />);
      expect(await screen.findByRole("heading", { name: "挑选风格与头像" })).toBeInTheDocument();
      expect(generationApi.resumeGeneration).not.toHaveBeenCalled();
      expect(screen.queryByTestId("design-config-json")).not.toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("confirms deletion in My Projects and clears an open deleted project", async () => {
    const saved = { id: "saved-project", config: rawConfig as DesignConfig, revision: 1,
      paid: false, pendingAction: null, pendingAmountFen: null };
    vi.mocked(paymentApi.projects).mockResolvedValueOnce([saved]).mockResolvedValue([]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "我的项目，共 1 个" }));
    fireEvent.click(screen.getByRole("button", { name: /继续编辑/ }));
    expect(screen.getByRole("heading", { name: "04 网站预览与轻量编辑" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "我的项目，共 1 个" }));
    fireEvent.click(screen.getByRole("button", { name: /删除项目/ }));
    expect(screen.getByText(/分享链接.*失效/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消删除" }));
    expect(paymentApi.deleteProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /删除项目/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(paymentApi.deleteProject).toHaveBeenCalledWith("saved-project"));
    expect(await screen.findByText(/还没有保存的作品/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /你的经历.*值得被看见/ })).toBeInTheDocument();
  });

  it("returns to the restored project's resume instead of the resume in the current style URL", async () => {
    window.history.replaceState(null, "", "/style/another-resume");
    vi.mocked(resumeApi.read).mockResolvedValueOnce({ draft: resumeDraftFixture as never,
      revision: 1, expiresAt: "2026-12-09T00:00:00Z" });
    vi.mocked(paymentApi.projects).mockResolvedValueOnce([{ id: "saved-project", resumeId: "saved-resume",
      config: rawConfig as DesignConfig, revision: 1, paid: false, pendingAction: null, pendingAmountFen: null }]);
    try {
      render(<App initialPhase="quiz" styleResumeId="another-resume" />);
      fireEvent.click(await screen.findByRole("button", { name: "我的项目，共 1 个" }));
      fireEvent.click(screen.getByRole("button", { name: /继续编辑/ }));
      expect(screen.getByRole("link", { name: "返回编辑详细内容" })).toHaveAttribute("href", "/editor/saved-resume");
      expect(screen.getByRole("heading", { name: "04 网站预览与轻量编辑" })).toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("keeps a restored project without a resume on the editable preview", async () => {
    vi.mocked(paymentApi.projects).mockResolvedValueOnce([{ id: "legacy-project", config: rawConfig as DesignConfig,
      revision: 1, paid: false, pendingAction: null, pendingAmountFen: null }]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "我的项目，共 1 个" }));
    fireEvent.click(screen.getByRole("button", { name: /继续编辑/ }));
    expect(screen.queryByText("返回编辑详细内容")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "样式" }));
    expect(screen.getByText(/简历草稿不可用/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "04 网站预览与轻量编辑" })).toBeInTheDocument();
  });

  it("keeps a project visible when the server refuses deletion", async () => {
    const saved = { id: "pending-project", config: rawConfig as DesignConfig, revision: 1,
      paid: false, pendingAction: "share" as const, pendingAmountFen: 199 };
    vi.mocked(paymentApi.projects).mockResolvedValueOnce([saved]);
    vi.mocked(paymentApi.deleteProject).mockRejectedValueOnce(new Error("项目仍有待核实的支付订单"));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "我的项目，共 1 个" }));
    fireEvent.click(screen.getByRole("button", { name: /删除项目/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("待核实的支付订单");
    expect(screen.getByRole("button", { name: /继续编辑/ })).toBeInTheDocument();
  });
  it("lets an education-only resume reach confirmation", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce({ pages: ["林青\n教育背景\n2020.09 - 2024.06 示例大学\n专业：计算机科学"], text: "林青\n教育背景\n示例大学" });
    render(<App />);
    openUpload();
    await chooseAndParse();
    expect(screen.getByRole("button", { name: /教育经历/ })).toBeInTheDocument();
  });

  it("lets a basic-only resume reach confirmation with the other modules empty", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce({ pages: ["基本信息\n姓名：林青\n邮箱：lin@example.com"], text: "基本信息\n姓名：林青\n邮箱：lin@example.com" });
    render(<App />);
    openUpload();
    await chooseAndParse();
    expect(screen.getByRole("textbox", { name: "姓名" })).toHaveValue("林青");
  });

  it("shows awards and other candidates for review before generation", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce({ pages: ["林青\n荣誉奖项\n校级创新奖\n自媒体经历\n运营技术专栏"], text: "林青\n荣誉奖项\n校级创新奖\n自媒体经历\n运营技术专栏" });
    render(<App />);
    openUpload();
    await chooseAndParse();
    fireEvent.click(screen.getByRole("button", { name: /荣誉奖项/ }));
    expect(screen.getByRole("textbox", { name: /荣誉奖项 1/ })).toHaveValue("校级创新奖");
    fireEvent.click(screen.getByRole("button", { name: /其他内容/ }));
    expect(screen.getByRole("textbox", { name: /其他内容 1/ })).toHaveValue("运营技术专栏");
    fireEvent.change(screen.getByRole("combobox", { name: /条目分类 1/ }), { target: { value: "awards" } });
    fireEvent.click(screen.getByRole("button", { name: /荣誉奖项/ }));
    expect(screen.getByRole("textbox", { name: /荣誉奖项 2/ })).toHaveValue("运营技术专栏");
  });
  it("starts on the scrolling launch page and keeps real samples and projects available", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /你的经历.*值得被看见/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /开始制作/ })).toHaveAttribute("href", "/upload");
    fireEvent.click(screen.getByRole("button", { name: /查看完整作品集样例/ }));
    expect(await screen.findByRole("heading", { name: /Alex Morgan/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /返回生成器/ }));
    fireEvent.click(screen.getByRole("button", { name: "我的项目，共 0 个" }));
    expect(screen.getByRole("dialog", { name: "我的项目" })).toBeInTheDocument();
  });

  it.each([
    ["#editor", "作品集预览与编辑"]
  ])("keeps the direct %s target available despite a previously started generation", (hash, section) => {
    window.history.replaceState(null, "", "/" + hash);
    try {
      render(<App />);
      expect(screen.getByRole("region", { name: section })).toBeInTheDocument();
      expect(generationApi.resumeGeneration).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("returns from legacy parsing to a clean launch page", () => {
    render(<App />);
    openUpload();
    expect(screen.getByRole("heading", { name: "从你的简历开始" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← 返回首页" }));
    expect(screen.getByRole("heading", { name: /你的经历.*值得被看见/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "生成进度" })).not.toBeInTheDocument();
  });

  it("keeps legacy product and process navigation anchored to the new launch sections", async () => {
    const visitedIds: string[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(function (this: Element) { visitedIds.push((this as HTMLElement).id); })
    });
    try {
      render(<App />);
      openUpload();
      fireEvent.click(screen.getByRole("button", { name: "制作流程" }));
      await waitFor(() => expect(visitedIds).toEqual(["process"]));

      openUpload();
      fireEvent.click(screen.getByRole("button", { name: "产品介绍" }));
      await waitFor(() => expect(visitedIds).toEqual(["process", "write"]));
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("accepts a dragged PDF and waits for the explicit parse action", async () => {
    render(<App />);
    openUpload();
    const dropZone = screen.getByText("将简历 PDF 拖到这里").closest("label");
    expect(dropZone).not.toBeNull();
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [new File(["pdf"], "dragged.pdf", { type: "application/pdf" })] }
    });
    expect(screen.getByText("已选择：dragged.pdf")).toBeInTheDocument();
    expect(extractPdfText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /解析简历/ }));
    expect(await screen.findByRole("heading", { name: "让每一段经历，都有证据可循" })).toBeInTheDocument();
  });

  it("fills the generation contract from the selected template without manual questions", async () => {
    render(<App />);
    await reachStyle();
    fireEvent.click(screen.getByRole("button", { name: /温暖创意/ }));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /温暖创意/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /理性简约/ }));
    expect(screen.getByRole("button", { name: /温暖创意/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    await screen.findByRole("heading", { name: "04 网站预览与轻量编辑" });
    const firstBrief = vi.mocked(generationApi.generatePortfolio).mock.calls[0][0];
    expect("answers" in firstBrief && Object.keys(firstBrief.answers)).toHaveLength(8);
  });

  it("keeps the style step visible when generation returns an incomplete config", async () => {
    vi.mocked(generationApi.generatePortfolio).mockResolvedValueOnce({ config: null as unknown as DesignConfig });
    render(<App />);
    await reachStyle();
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("作品配置不完整");
    expect(screen.getByRole("heading", { name: "挑选风格与头像" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "作品配置暂时不可用" })).not.toBeInTheDocument();
  });

  it("opens the advanced configuration without losing the live preview", async () => {
    render(<App />);
    await reachResult();
    expect(screen.getByRole("button", { name: /发布并获取链接/ })).toBeInTheDocument();
    fireEvent.click(screen.getByText("高级参数 / 调试信息 →"));
    expect(screen.getByTestId("design-config-json")).toBeVisible();
    expect(screen.getByRole("heading", { name: "04 网站预览与轻量编辑" })).toBeInTheDocument();
  });

  it("keeps the latest PDF when an older extraction finishes afterwards", async () => {
    let finishFirst!: (value: { pages: string[]; text: string }) => void;
    vi.mocked(extractPdfText).mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }));
    const latestPages = [pages[0].replace("黄琬斐", "李四"), pages[1]];
    vi.mocked(extractPdfText).mockResolvedValueOnce({ pages: latestPages, text: latestPages.join("\n\n") });
    render(<App />);
    openUpload();
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["old"], "old.pdf", { type: "application/pdf" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: /解析简历/ }));
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["new"], "new.pdf", { type: "application/pdf" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: /解析简历/ }));
    await screen.findByRole("heading", { name: "让每一段经历，都有证据可循" });
    expect(screen.getByLabelText("姓名")).toHaveValue("李四");
    await act(async () => { finishFirst({ pages, text: pages.join("\n\n") }); });
    expect(screen.getByLabelText("姓名")).toHaveValue("李四");
  });

  it("does not let a restored old task replace a newly uploaded PDF", async () => {
    let finish!: (value: { config: DesignConfig; heroArtwork: NonNullable<DesignConfig["heroArtwork"]> }) => void;
    vi.mocked(generationApi.resumeGeneration).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    openUpload();
    await chooseAndParse("new.pdf");
    finish({ config: rawConfig as DesignConfig,
      heroArtwork: { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012", styleId: "retro-flat-anime-head", alt: "旧肖像" } });
    await waitFor(() => expect(screen.queryByAltText("旧肖像")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "让每一段经历，都有证据可循" })).toBeInTheDocument();
  });

  it("does not restore an avatar after its pending generation was removed", async () => {
    let finish!: (value: { config: DesignConfig; heroArtwork: NonNullable<DesignConfig["heroArtwork"]> }) => void;
    vi.mocked(generationApi.generatePortfolio).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await reachStyle();
    fireEvent.change(screen.getByLabelText("选择个人肖像照片"), { target: { files: [new File(["portrait"], "me.png", { type: "image/png" })] } });
    await screen.findByText("me.png");
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /赛博科技/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    fireEvent.click(screen.getByRole("button", { name: "移除照片" }));
    await act(async () => finish({ config: rawConfig as DesignConfig, heroArtwork: { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012", styleId: "retro-flat-anime-head", alt: "已移除肖像" } }));
    await waitFor(() => expect(screen.queryByAltText("已移除肖像")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    expect(await screen.findByRole("heading", { name: "04 网站预览与轻量编辑" })).toBeInTheDocument();
  });

  it("can regenerate a restored avatar while keeping edits to the current config", async () => {
    const oldArtwork = { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012", styleId: "retro-flat-anime-head", alt: "旧肖像" };
    vi.mocked(generationApi.resumeGeneration).mockResolvedValueOnce({ config: rawConfig as DesignConfig, heroArtwork: oldArtwork });
    vi.mocked(generationApi.generateAvatar).mockResolvedValueOnce({ assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789013", styleId: "lofi-print-anime", alt: "新肖像" });
    render(<App />);
    await screen.findByAltText("旧肖像");
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "Edited Person" } });
    fireEvent.click(screen.getByRole("tab", { name: "设置" }));
    fireEvent.click(screen.getByText("更换照片 →"));
    fireEvent.change(screen.getByLabelText("选择个人肖像照片"), { target: { files: [new File(["portrait"], "new.png", { type: "image/png" })] } });
    await screen.findByText("new.png");
    fireEvent.click(screen.getByRole("button", { name: /应用新照片/ }));
    expect(await screen.findByAltText("新肖像")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edited Person" })).toBeInTheDocument();
    expect(vi.mocked(generationApi.generateAvatar).mock.calls[0][1].content.profile.name).toBe("Edited Person");
    expect(vi.mocked(generationApi.generateAvatar).mock.calls[0][1].heroArtwork).toBeUndefined();
  });

  it("restores a completed local avatar task after refresh", async () => {
    vi.mocked(generationApi.resumeGeneration).mockResolvedValueOnce({ config: rawConfig as DesignConfig,
      heroArtwork: { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012", styleId: "retro-flat-anime-head", alt: "恢复的动画肖像" } });
    render(<App />);
    expect(await screen.findByAltText("恢复的动画肖像")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "04 网站预览与轻量编辑" })).toBeInTheDocument();
  });
  it("restores a completed no-photo Agent task after refresh", async () => {
    vi.mocked(generationApi.resumeGeneration).mockResolvedValueOnce({ config: rawConfig as DesignConfig });
    render(<App />);
    const json = await screen.findByTestId("design-config-json");
    expect((JSON.parse(json.textContent ?? "") as DesignConfig).content.profile.name).toBe("Alex Morgan");
    expect(screen.getByRole("heading", { name: "04 网站预览与轻量编辑" })).toBeInTheDocument();
  });
  it("offers photo upload without portrait style choices", async () => {
    render(<App />);
    await reachStyle();
    const appearancePanel = screen.getByRole("region", { name: "头像与网站模板" });
    expect(within(appearancePanel).getByRole("heading", { name: "网站模板" })).toBeInTheDocument();
    expect(within(appearancePanel).getByRole("button", { name: /生成我的 Showcase/ })).toBeInTheDocument();
    expect(within(appearancePanel).queryByText(/点击生成前只保留|当前模板将自动使用|图像供应商/)).not.toBeInTheDocument();
    expect(screen.getByText(/实时预览/)).toBeInTheDocument();
    expect(screen.getByText(/黄琬斐 \/ 个人作品集/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /复古扁平动画头|低清晰印刷感动漫/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /明黄发丝涂鸦/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /蜡笔极简扁平画/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /颗粒绒感玩偶/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("选择个人肖像照片"), { target: { files: [new File(["portrait"], "me.png", { type: "image/png" })] } });
    expect(await screen.findByText("me.png")).toBeInTheDocument();
    expect(within(screen.getByLabelText("首屏实时预览")).queryByRole("img")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "个人头像" })).queryByRole("img")).not.toBeInTheDocument();
    expect(generationApi.generateAvatar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /赛博科技/ }));
    expect(within(screen.getByLabelText("首屏实时预览")).getByRole("img", { name: "赛博科技默认中性动漫形象" }))
      .toHaveAttribute("src", "/cyber-neutral-print-anime.webp");
    fireEvent.click(screen.getByRole("button", { name: "移除照片" }));
    expect(screen.queryByText("me.png")).not.toBeInTheDocument();
  });

  it("offers the cyber technology template and carries it into the generated showcase", async () => {
    render(<App />);
    await reachStyle();
    fireEvent.click(screen.getByRole("button", { name: /赛博科技/ }));
    expect(screen.getByRole("button", { name: /赛博科技/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "实时预览 / 赛博科技" })).toBeInTheDocument();
    const sample = screen.getByLabelText("首屏实时预览");
    expect(within(sample).getByRole("img", { name: "赛博科技默认中性动漫形象" }))
      .toHaveAttribute("src", "/cyber-neutral-print-anime.webp");
    expect(within(sample).getByText(/精选项目/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    const page = await screen.findByTestId("showcase-page");
    expect(page).toHaveAttribute("data-skin", "dark-tech");
    expect(within(page).getByLabelText("赛博科技立体视觉")).toBeInTheDocument();
  });

  it("saves the live draft without opening the payment flow", async () => {
    render(<App />);
    await reachResult();
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "Saved Person" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByText("草稿已保存")).toBeInTheDocument();
    expect(paymentApi.createProject).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({ profile: expect.objectContaining({ name: "Saved Person" }) })
    }));
    expect(paymentApi.checkout).not.toHaveBeenCalled();
    expect(paymentApi.publish).not.toHaveBeenCalled();
  });

  it("asks for public-share confirmation before creating or publishing a project", async () => {
    render(<App />);
    await reachResult();
    fireEvent.click(screen.getByRole("button", { name: /发布并获取链接/ }));
    expect(within(screen.getByRole("complementary", { name: "分享与付费" })).getByRole("heading", { name: "准备好公开分享了吗？" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "作品预览画布" })).toContainElement(screen.getByTestId("showcase-page"));
    expect(paymentApi.createProject).not.toHaveBeenCalled();
    expect(paymentApi.publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "暂不分享，返回预览" }));
    expect(screen.getByRole("heading", { name: "04 网站预览与轻量编辑" })).toBeInTheDocument();
    expect(paymentApi.createProject).not.toHaveBeenCalled();
  });

  it("adds generated portrait to hero and offers delivery", async () => {
    vi.mocked(generationApi.generatePortfolio).mockImplementationOnce(async (brief) => ({
      config: { ...styleToConfig(scoreAnswers("answers" in brief ? brief.answers : {}), brief.role), content: "content" in brief ? brief.content : ({} as DesignConfig["content"]) },
      heroArtwork: { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012", styleId: "retro-flat-anime-head", alt: "动画肖像" }
    }));
    render(<App />);
    await reachStyle();
    fireEvent.change(screen.getByLabelText("选择个人肖像照片"), { target: { files: [new File(["portrait"], "me.png", { type: "image/png" })] } });
    await screen.findByText("me.png");
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /赛博科技/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    expect(await screen.findByAltText("动画肖像")).toHaveAttribute("src", "/api/hero-assets/12345678-1234-1234-1234-123456789012");
    expect(screen.getByRole("button", { name: /导出文件/ })).toBeInTheDocument();
  });

  it("shows the editor when a cyber portrait is still using the original poster", async () => {
    vi.mocked(generationApi.generatePortfolio).mockImplementationOnce(async (brief) => ({
      config: { ...rawConfig, templateId: "cyber-creator-v1",
        content: "content" in brief ? brief.content : ({} as DesignConfig["content"]) } as DesignConfigV4,
      heroArtwork: { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012",
        styleId: "lofi-print-anime", alt: "动画肖像" }
    }));
    render(<App />);
    await reachStyle();
    fireEvent.change(screen.getByLabelText("选择个人肖像照片"), {
      target: { files: [new File(["portrait"], "me.png", { type: "image/png" })] }
    });
    await screen.findByText("me.png");
    fireEvent.click(screen.getByRole("button", { name: /赛博科技/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    expect(await screen.findByText(/透明去背景未完成/)).toBeInTheDocument();
  });

  it("lets a failed avatar request fall back to a text-only preview", async () => {
    vi.mocked(generationApi.generatePortfolio).mockRejectedValueOnce(new Error("图像服务暂不可用"));
    render(<App />);
    await reachStyle();
    fireEvent.change(screen.getByLabelText("选择个人肖像照片"), { target: { files: [new File(["portrait"], "me.png", { type: "image/png" })] } });
    await screen.findByText("me.png");
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /赛博科技/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    await screen.findByText("图像服务暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "移除照片" }));
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    expect(await screen.findByRole("heading", { name: "04 网站预览与轻量编辑" })).toBeInTheDocument();
  });
  it("shows the local avatar controls in a tunnel production build", async () => {
    vi.stubEnv("MODE", "tunnel");
    vi.stubEnv("DEV", false);
    render(<App />);
    await reachStyle();
    expect(screen.getByLabelText("选择个人肖像照片")).toBeInTheDocument();
  });

  it("loads published shares from the server when the hash changes", async () => {
    const originalHash = window.location.hash;
    const first = "a".repeat(43), second = "b".repeat(43);
    vi.mocked(paymentApi.readShare).mockImplementation(async (token) => ({ config: token === first ? rawConfig as DesignConfig : {
      ...rawConfig, content: { ...rawConfig.content, profile: { ...rawConfig.content.profile, name: "Second Person" } }
    } as DesignConfig, expiresAt: Date.now() + 1000 }));
    try {
      window.history.replaceState(null, "", `#share=${first}`);
      render(<App />);
      expect(await screen.findByRole("heading", { name: /Alex Morgan/i })).toBeInTheDocument();
      window.history.replaceState(null, "", `#share=${second}`);
      fireEvent(window, new Event("hashchange"));
      expect(await screen.findByRole("heading", { name: "Second Person" })).toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "", originalHash || window.location.pathname);
    }
  });
  it("hydrates a shared link without a server/client mismatch", async () => {
    const originalHash = window.location.hash;
    const container = document.createElement("div");
    const errors: unknown[] = [];
    vi.mocked(paymentApi.readShare).mockResolvedValueOnce({ config: rawConfig as DesignConfig, expiresAt: Date.now() + 1000 });
    try {
      window.history.replaceState(null, "", window.location.pathname);
      container.innerHTML = renderToString(<App />);
      document.body.appendChild(container);
      window.history.replaceState(null, "", `#share=${"a".repeat(43)}`);
      let root: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <App />, { onRecoverableError: (error) => errors.push(error) });
      });
      expect(errors).toEqual([]);
      expect(await within(container).findByRole("heading", { name: /Alex Morgan/i })).toBeInTheDocument();
      await act(async () => root!.unmount());
    } finally {
      container.remove();
      window.history.replaceState(null, "", originalHash || window.location.pathname);
    }
  });
  it("does not describe a text PDF as unselectable when its sections are unrecognized", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce({ pages: ["RESUME\n一些无法自动分类的正文"], text: "RESUME\n一些无法自动分类的正文" });
    render(<App />);
    openUpload();
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: /解析简历/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PDF 文本已提取，但未能识别姓名");
  });

  it("labels campus entries as campus experience in the confirmation form", async () => {
    const sectionPage = `RESUME\n黄禹哲\n哈尔滨理工大学·计算机科学与技术22级\n教育背景\nGPA：4.04 / 5\n项目实践\n基于物联网及大模型的无土栽培系统（竞赛项目·队长）\n• 简介：实现生长环境监测。\n专业技能\n• 熟悉 STM32 及相关单片机开发\n校园经历\n• 哈尔滨理工大学嵌入式创新实验室 成员`;
    vi.mocked(extractPdfText).mockResolvedValueOnce({ pages: [sectionPage], text: sectionPage });
    render(<App />);
    openUpload();
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: /解析简历/ }));
    await screen.findByRole("heading", { name: "让每一段经历，都有证据可循" });
    expect(screen.getByRole("button", { name: /实习\/工作经历/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /校园经历/ }));
    expect(screen.getByRole("textbox", { name: "校园经历 1" })).toHaveValue("哈尔滨理工大学嵌入式创新实验室 成员");
    fireEvent.click(screen.getByRole("button", { name: /项目经历/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "条目分类 1" }), { target: { value: "campusExperience" } });
    fireEvent.click(screen.getByRole("button", { name: /校园经历/ }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "校园经历 2" }).value).toContain("无土栽培系统");
  });

  it("keeps the PDF confirmation mandatory, allows correction, and changes config when templates change", async () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: /生成我的 Showcase/ })).not.toBeInTheDocument();
    openUpload();
    await chooseAndParse();
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "黄 琬斐" } });
    fireEvent.click(screen.getByRole("button", { name: /实习\/工作经历/ }));
    expect(screen.getByRole("textbox", { name: /工作.*经历 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /项目经历/ }));
    expect(screen.getByRole("textbox", { name: "项目经历 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /技能与链接/ }));
    expect(screen.getByRole("textbox", { name: "技能与链接 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /教育经历/ }));
    expect(screen.getByRole("textbox", { name: "教育经历 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /确认资料，选择风格/ }));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    const first = JSON.parse((await screen.findByTestId("design-config-json")).textContent ?? "") as DesignConfig;
    expect(first.content.profile.name).toBe("黄 琬斐");
    expect(first.content.projects).toHaveLength(2);
    expect(first.content.sourceRefs).toBeUndefined();
    expect(generationApi.generatePortfolio).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.not.objectContaining({ sourceRefs: expect.anything() })
    }), undefined, expect.any(Function));

    fireEvent.click(screen.getByRole("tab", { name: "样式" }));
    fireEvent.click(screen.getByRole("button", { name: /更换模板/ }));
    answerAll(4);
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    const second = JSON.parse((await screen.findByTestId("design-config-json")).textContent ?? "") as DesignConfig;
    expect(second.skin).not.toBe(first.skin);
    expect(second.marquee.speed).not.toBe(first.marquee.speed);
    expect(second.stackedCards.scaleStep).not.toBe(first.stackedCards.scaleStep);
    expect(second.content.projects).toEqual(first.content.projects);
  });

  it("updates the visible showcase and JSON from the result editor", async () => {
    render(<App />);
    await reachResult();
    const before = JSON.parse((await screen.findByTestId("design-config-json")).textContent ?? "") as DesignConfig;
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "Edited Person" } });
    expect(screen.getByRole("heading", { name: "Edited Person" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "设置" }));
    fireEvent.change(screen.getByRole("slider", { name: "交互强度" }), { target: { value: "92" } });
    const after = JSON.parse(screen.getByTestId("design-config-json").textContent ?? "") as DesignConfig;
    expect(after.content.profile.name).toBe("Edited Person");
    expect(after.marquee.speed).toBeGreaterThan(before.marquee.speed);
    expect(after.stackedCards.scaleStep).toBeGreaterThan(before.stackedCards.scaleStep);
    fireEvent.click(screen.getByRole("button", { name: /发布并获取链接/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认并发布" }));
    await waitFor(() => expect(paymentApi.createProject).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({ profile: expect.objectContaining({ name: "Edited Person" }) }),
      marquee: expect.objectContaining({ speed: after.marquee.speed }),
      stackedCards: expect.objectContaining({ scaleStep: after.stackedCards.scaleStep })
    })));
    expect(screen.getByRole("heading", { name: "解锁当前项目" })).toBeInTheDocument();
    expect(screen.getByText("¥1.99")).toBeInTheDocument();
    expect(screen.getByText(/普通支付宝无法支付沙箱订单/)).toBeInTheDocument();
    expect(paymentApi.export).not.toHaveBeenCalled();
  });

  it("exports an unpaid project without starting checkout", async () => {
    let filename = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: async () => new Blob(["<html></html>"]) } as Response);
    const createUrl = URL.createObjectURL;
    const revokeUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:export");
    URL.revokeObjectURL = vi.fn();
    try {
      render(<App />);
      await reachResult();
      fireEvent.click(screen.getByRole("button", { name: /导出文件/ }));
      await waitFor(() => expect(filename).toBe("buildurprofile-site.html"));
      expect(fetchMock).toHaveBeenCalledWith("/api/downloads/test", { credentials: "same-origin" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(paymentApi.checkout).not.toHaveBeenCalled();
    } finally {
      click.mockRestore(); fetchMock.mockRestore();
      URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
    }
  });

  it("shows the GitHub Pages action only after the project is unlocked and published", async () => {
    vi.mocked(paymentApi.offer).mockResolvedValueOnce({
      configured: true, mode: "sandbox", priceFen: 199, priceYuan: "1.99",
      service: "正式托管分享", shareDays: 7, githubPagesEnabled: true
    });
    vi.mocked(paymentApi.createProject).mockResolvedValueOnce({
      id: "paid-project", config: rawConfig as DesignConfig, revision: 1,
      paid: true, pendingAction: null, pendingAmountFen: null
    });
    let finishPublish!: (share: Awaited<ReturnType<typeof paymentApi.publish>>) => void;
    vi.mocked(paymentApi.publish).mockImplementationOnce(() => new Promise(resolve => { finishPublish = resolve; }));

    const deploymentButton = () => screen.queryByRole("button", { name: "部署到 GitHub Pages" });
    render(<App />);
    await reachResult();
    expect(deploymentButton()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /发布并获取链接/ }));
    expect(deploymentButton()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认并发布" }));
    await waitFor(() => expect(paymentApi.publish).toHaveBeenCalledWith("paid-project"));
    expect(deploymentButton()).not.toBeInTheDocument();

    await act(async () => finishPublish({
      token: "a".repeat(43), url: "/#share=" + "a".repeat(43), expiresAt: Date.now() + 60_000
    }));
    expect(deploymentButton()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "返回预览，继续编辑" }));
    expect(deploymentButton()).not.toBeInTheDocument();
  });

  it("uses one paid project for publishing and free HTML delivery without another checkout", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const paid = { id: "paid-project", config: rawConfig as DesignConfig, revision: 1,
      paid: true, pendingAction: null, pendingAmountFen: null };
    vi.mocked(paymentApi.createProject).mockResolvedValueOnce(paid);
    vi.mocked(paymentApi.project).mockResolvedValue(paid);
    vi.mocked(paymentApi.updateProject).mockResolvedValue(paid);
    render(<App />);
    await reachResult();
    fireEvent.click(await screen.findByRole("button", { name: /发布并获取链接/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认并发布" }));
    await waitFor(() => expect(paymentApi.publish).toHaveBeenCalledWith("paid-project"));
    fireEvent.click(screen.getByRole("button", { name: /导出文件/ }));
    await waitFor(() => expect(paymentApi.export).toHaveBeenCalledWith("paid-project"));
    expect(paymentApi.checkout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /返回预览，继续编辑/ }));
    fireEvent.click(screen.getByRole("tab", { name: "样式" }));
    fireEvent.click(screen.getByRole("button", { name: /更换模板/ }));
    answerAll(4);
    fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
    fireEvent.click(await screen.findByRole("button", { name: /发布并获取链接/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认并发布" }));
    await waitFor(() => expect(paymentApi.publish).toHaveBeenCalledTimes(2));
    expect(paymentApi.createProject).toHaveBeenCalledTimes(1);
    expect(paymentApi.updateProject).toHaveBeenCalledWith("paid-project", expect.any(Object));
    expect(paymentApi.checkout).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("reconciles a returning project and resumes the stored original action", async () => {
    const original = window.location.href;
    vi.mocked(paymentApi.reconcile).mockResolvedValueOnce({ id: "return-project", config: rawConfig as DesignConfig,
      revision: 1, paid: true, pendingAction: "share", pendingAmountFen: null });
    try {
      window.history.replaceState(null, "", "/payment/return?project_id=return-project&trade_status=success");
      render(<App />);
      await waitFor(() => expect(paymentApi.publish).toHaveBeenCalledWith("return-project"));
      expect(screen.getByRole("heading", { name: "04 分享确认与发布" })).toBeInTheDocument();
    } finally { window.history.replaceState(null, "", original); }
  });

  it("restores the saved draft and shows a retryable error when return reconciliation fails", async () => {
    const original = window.location.href;
    vi.mocked(paymentApi.reconcile).mockRejectedValueOnce(new Error("查单暂不可用"));
    vi.mocked(paymentApi.project).mockResolvedValueOnce({ id: "return-project", config: rawConfig as DesignConfig,
      revision: 1, paid: false, pendingAction: "share", pendingAmountFen: 199 });
    try {
      window.history.replaceState(null, "", "/payment/return?project_id=return-project");
      render(<App />);
      expect(await screen.findByRole("heading", { name: "04 分享确认与发布" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("查单暂不可用");
      expect(paymentApi.publish).not.toHaveBeenCalled();
    } finally { window.history.replaceState(null, "", original); }
  });

  it("continues a paid return delivery even when refreshing the project list fails", async () => {
    const original = window.location.href;
    vi.mocked(paymentApi.reconcile).mockResolvedValueOnce({ id: "return-project", config: rawConfig as DesignConfig,
      revision: 1, paid: true, pendingAction: "share", pendingAmountFen: null });
    vi.mocked(paymentApi.projects).mockRejectedValueOnce(new Error("列表暂不可用"));
    try {
      window.history.replaceState(null, "", "/payment/return?project_id=return-project");
      render(<App />);
      await waitFor(() => expect(paymentApi.publish).toHaveBeenCalledWith("return-project"));
    } finally { window.history.replaceState(null, "", original); }
  });

  it("saves edits made after opening the payment panel before starting checkout", async () => {
    render(<App />);
    await reachResult();
    fireEvent.click(await screen.findByRole("button", { name: /发布并获取链接/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认并发布" }));
    await screen.findByRole("heading", { name: "解锁当前项目" });
    fireEvent.click(screen.getByRole("button", { name: /返回预览，继续编辑/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "支付前改名" } });
    fireEvent.click(screen.getByRole("button", { name: /发布并获取链接/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认并发布" }));
    await screen.findByRole("heading", { name: "解锁当前项目" });
    const checkout = screen.getByRole("button", { name: /前往支付宝沙箱收银台/ });
    await waitFor(() => expect(checkout).toBeEnabled());
    fireEvent.click(checkout);
    await waitFor(() => expect(paymentApi.updateProject).toHaveBeenCalledWith("project-1",
      expect.objectContaining({ content: expect.objectContaining({
        profile: expect.objectContaining({ name: "支付前改名" })
      }) })));
  });

  it("switches CSS-variable skins in the mock showcase", async () => {
    render(<ShowcasePage config={rawConfig as DesignConfig} allowSkinSwitch />);
    const page = screen.getByTestId("showcase-page");
    expect(page).toHaveAttribute("data-skin", "dark-tech");
    expect(screen.getByRole("heading", { name: /Alex Morgan/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /light minimal/i }));
    await waitFor(() => expect(page).toHaveAttribute("data-skin", "light-minimal"));
    fireEvent.click(screen.getByRole("button", { name: /high saturation/i }));
    expect(page).toHaveAttribute("data-skin", "high-saturation");
    fireEvent.click(screen.getByRole("button", { name: "赛博科技" }));
    expect(page).toHaveAttribute("data-skin", "dark-tech");
  });

  it("shows campus activities under their own heading in the showcase", () => {
    const config = {
      ...rawConfig,
      content: { ...rawConfig.content, workExperience: [], campusExperience: ["哈尔滨理工大学嵌入式创新实验室 成员"], education: ["哈尔滨理工大学"] }
    } as DesignConfig;
    render(<ShowcasePage config={config} />);
    expect(screen.getByRole("heading", { name: "校园经历" })).toBeInTheDocument();
    expect(screen.getByText("哈尔滨理工大学嵌入式创新实验室 成员")).toBeInTheDocument();
  });

  it("keeps card controls manual on touch input and explains the downgrade", async () => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
    try {
      render(<App />);
      await reachStyle();
      expect(screen.getAllByText(/检测到触屏/).length).toBeGreaterThan(0);
      answerAll();
      fireEvent.click(screen.getByRole("button", { name: /生成我的 Showcase/ }));
      const config = JSON.parse((await screen.findByTestId("design-config-json")).textContent ?? "") as DesignConfig;
      expect(config.styleVector.S).toBe(0.75);
      expect(config.marquee.bindToScroll).toBe(true);
      expect(config.stackedCards.enableTilt).toBe(true);
      expect(config.stackedCards.autoPlay).toBe(false);
      expect(screen.getByTestId("marquee-track-0")).toHaveStyle({ animationName: "marquee-travel" });
      expect(screen.getAllByText(/检测到触屏/).length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
    }
  });

  it("downgrades an already generated configuration after an actual touch event", async () => {
    render(<App />);
    await reachResult();
    await screen.findByTestId("design-config-json");
    const output = () => JSON.parse(screen.getByTestId("design-config-json").textContent ?? "") as DesignConfig;
    expect(output().marquee.bindToScroll).toBe(true);
    expect(screen.getByTestId("marquee-track-0")).toHaveStyle({ animationName: "none" });
    fireEvent.touchStart(window);
    await waitFor(() => expect(screen.getByTestId("marquee-track-0")).toHaveStyle({ animationName: "marquee-travel" }));
    expect(output().marquee.bindToScroll).toBe(true);
    expect(output().stackedCards.autoPlay).toBe(false);
    expect(screen.getAllByText(/检测到触屏/).length).toBeGreaterThan(0);
  });
});
