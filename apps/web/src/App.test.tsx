import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignConfig } from "../../../packages/contracts/src/config";
import App from "./App";
import { ShowcasePage } from "./ShowcasePage";
import rawConfig from "./demo/config.json";
import { extractPdfText } from "./lib/pdf";
import { paymentApi } from "./lib/paymentApi";

vi.mock("./lib/pdf", () => ({ extractPdfText: vi.fn() }));
vi.mock("./lib/paymentApi", () => ({
  paymentApi: {
    offer: vi.fn().mockResolvedValue({ configured: true, mode: "sandbox", priceFen: 199, priceYuan: "1.99", service: "正式托管分享与静态网站导出", shareDays: 7 }),
    projects: vi.fn().mockResolvedValue([]),
    readShare: vi.fn(),
    createProject: vi.fn().mockResolvedValue({ id: "project-1", config: null, revision: 1, paid: false, pendingAction: null }),
    project: vi.fn().mockResolvedValue({ id: "project-1", config: null, revision: 1, paid: false, pendingAction: null }),
    updateProject: vi.fn().mockResolvedValue({ id: "project-1", config: null, revision: 2, paid: false, pendingAction: null }),
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

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.mocked(extractPdfText).mockResolvedValue({ pages, text: pages.join("\n\n") });
  vi.mocked(paymentApi.createProject).mockClear();
  vi.mocked(paymentApi.publish).mockClear();
  vi.mocked(paymentApi.export).mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("showcase builder", () => {
  it("opens the static preview without requesting server data or following a share hash", () => {
    const originalHash = window.location.hash;
    vi.stubEnv("MODE", "pages");
    vi.mocked(paymentApi.offer).mockClear();
    vi.mocked(paymentApi.projects).mockClear();
    vi.mocked(paymentApi.readShare).mockClear();
    try {
      window.history.replaceState(null, "", `#share=${"a".repeat(43)}`);
      render(<App />);
      expect(screen.getByRole("heading", { name: /让简历成为/ })).toBeInTheDocument();
      expect(paymentApi.offer).not.toHaveBeenCalled();
      expect(paymentApi.projects).not.toHaveBeenCalled();
      expect(paymentApi.readShare).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", originalHash || window.location.pathname);
    }
  });

  it("keeps PDF preview available in static mode without showing server delivery actions", async () => {
    vi.stubEnv("MODE", "pages");
    render(<App />);
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    await screen.findByRole("heading", { name: /确认并修正/ });
    fireEvent.click(screen.getByRole("button", { name: /确认内容，进入测评/ }));
    document.querySelectorAll(".quiz-question").forEach((question) =>
      fireEvent.click(within(question as HTMLElement).getAllByRole("radio")[0]));
    fireEvent.click(screen.getByRole("button", { name: /生成 Design Config/ }));
    expect(screen.getByTestId("design-config-json")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "网页预览" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /发布并分享/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导出静态网站 ZIP/ })).not.toBeInTheDocument();
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
  it("does not describe a text PDF as unselectable when its sections are unrecognized", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce({ pages: ["RESUME\n一些无法自动分类的正文"], text: "RESUME\n一些无法自动分类的正文" });
    render(<App />);
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("PDF 文本已提取，但未能自动识别简历章节");
  });

  it("labels campus entries as campus experience in the confirmation form", async () => {
    const sectionPage = `RESUME\n黄禹哲\n哈尔滨理工大学·计算机科学与技术22级\n教育背景\nGPA：4.04 / 5\n项目实践\n基于物联网及大模型的无土栽培系统（竞赛项目·队长）\n• 简介：实现生长环境监测。\n专业技能\n• 熟悉 STM32 及相关单片机开发\n校园经历\n• 哈尔滨理工大学嵌入式创新实验室 成员`;
    vi.mocked(extractPdfText).mockResolvedValueOnce({ pages: [sectionPage], text: sectionPage });
    render(<App />);
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    await screen.findByRole("heading", { name: /确认并修正/ });
    expect(screen.getByRole("textbox", { name: "校园经历 1" })).toHaveValue("哈尔滨理工大学嵌入式创新实验室 成员");
  });

  it("keeps the PDF confirmation mandatory, allows correction, and changes config when answers change", async () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: /生成 Design Config/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    await screen.findByRole("heading", { name: /确认并修正/ });
    expect(screen.getByRole("textbox", { name: "工作经历 1" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "项目 1" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "技能 1" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "教育 1" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "黄 琬斐" } });
    fireEvent.click(screen.getByRole("button", { name: /确认内容，进入测评/ }));
    const questions = document.querySelectorAll(".quiz-question");
    expect(questions).toHaveLength(8);
    questions.forEach((question) => fireEvent.click(within(question as HTMLElement).getAllByRole("radio")[0]));
    fireEvent.click(screen.getByRole("button", { name: /生成 Design Config/ }));
    const first = JSON.parse(screen.getByTestId("design-config-json").textContent ?? "") as DesignConfig;
    expect(first.content.profile.name).toBe("黄 琬斐");
    expect(first.content.projects).toHaveLength(2);
    expect(first.content.sourceRefs?.["projects.0"].excerpt).toContain("嵌入式固件日志");

    fireEvent.click(screen.getByRole("button", { name: /重新作答/ }));
    document.querySelectorAll(".quiz-question").forEach((question) => {
      const options = within(question as HTMLElement).getAllByRole("radio");
      fireEvent.click(options[options.length - 1]);
    });
    fireEvent.click(screen.getByRole("button", { name: /生成 Design Config/ }));
    const second = JSON.parse(screen.getByTestId("design-config-json").textContent ?? "") as DesignConfig;
    expect(second.skin).not.toBe(first.skin);
    expect(second.marquee.speed).not.toBe(first.marquee.speed);
    expect(second.stackedCards.scaleStep).not.toBe(first.stackedCards.scaleStep);
    expect(second.content.projects).toEqual(first.content.projects);
  });

  it("updates the visible showcase and JSON from the result editor", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    await screen.findByRole("heading", { name: /确认并修正/ });
    fireEvent.click(screen.getByRole("button", { name: /确认内容，进入测评/ }));
    document.querySelectorAll(".quiz-question").forEach((question) => {
      fireEvent.click(within(question as HTMLElement).getAllByRole("radio")[0]);
    });
    fireEvent.click(screen.getByRole("button", { name: /生成 Design Config/ }));
    const before = JSON.parse(screen.getByTestId("design-config-json").textContent ?? "") as DesignConfig;
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "Edited Person" } });
    expect(screen.getByRole("heading", { name: "Edited Person" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "交互强度" }), { target: { value: "92" } });
    const after = JSON.parse(screen.getByTestId("design-config-json").textContent ?? "") as DesignConfig;
    expect(after.content.profile.name).toBe("Edited Person");
    expect(after.marquee.speed).toBeGreaterThan(before.marquee.speed);
    expect(after.stackedCards.scaleStep).toBeGreaterThan(before.stackedCards.scaleStep);
    expect(screen.getByRole("tab", { name: "网页预览" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: /导出静态网站 ZIP/ }));
    await waitFor(() => expect(paymentApi.createProject).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({ profile: expect.objectContaining({ name: "Edited Person" }) }),
      marquee: expect.objectContaining({ speed: after.marquee.speed }),
      stackedCards: expect.objectContaining({ scaleStep: after.stackedCards.scaleStep })
    })));
    expect(screen.getByRole("region", { name: "确认购买" })).toHaveTextContent("¥1.99");
    expect(screen.getByRole("region", { name: "确认购买" })).toHaveTextContent("普通支付宝无法支付沙箱订单");
    expect(paymentApi.export).not.toHaveBeenCalled();
  });

  it("uses one paid project for both publishing and ZIP delivery without another checkout", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const paid = { id: "paid-project", config: rawConfig as DesignConfig, revision: 1,
      paid: true, pendingAction: null, pendingAmountFen: null };
    vi.mocked(paymentApi.createProject).mockResolvedValueOnce(paid);
    vi.mocked(paymentApi.project).mockResolvedValue(paid);
    vi.mocked(paymentApi.updateProject).mockResolvedValue(paid);
    render(<App />);
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    await screen.findByRole("heading", { name: /确认并修正/ });
    fireEvent.click(screen.getByRole("button", { name: /确认内容，进入测评/ }));
    document.querySelectorAll(".quiz-question").forEach((question) => {
      fireEvent.click(within(question as HTMLElement).getAllByRole("radio")[0]);
    });
    fireEvent.click(screen.getByRole("button", { name: /生成 Design Config/ }));
    fireEvent.click(screen.getByRole("button", { name: /发布并分享/ }));
    await waitFor(() => expect(paymentApi.publish).toHaveBeenCalledWith("paid-project"));
    fireEvent.click(screen.getByRole("button", { name: /导出静态网站 ZIP/ }));
    await waitFor(() => expect(paymentApi.export).toHaveBeenCalledWith("paid-project"));
    expect(paymentApi.checkout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /重新作答/ }));
    document.querySelectorAll(".quiz-question").forEach((question) => {
      fireEvent.click(within(question as HTMLElement).getAllByRole("radio").at(-1)!);
    });
    fireEvent.click(screen.getByRole("button", { name: /生成 Design Config/ }));
    fireEvent.click(screen.getByRole("button", { name: /发布并分享/ }));
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
      expect(screen.getByRole("heading", { name: /已生成/ })).toBeInTheDocument();
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
      expect(await screen.findByRole("heading", { name: /已生成/ })).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    await screen.findByRole("heading", { name: /确认并修正/ });
    fireEvent.click(screen.getByRole("button", { name: /确认内容，进入测评/ }));
    document.querySelectorAll(".quiz-question").forEach((question) => {
      fireEvent.click(within(question as HTMLElement).getAllByRole("radio")[0]);
    });
    fireEvent.click(screen.getByRole("button", { name: /生成 Design Config/ }));
    fireEvent.click(screen.getByRole("button", { name: /发布并分享/ }));
    await screen.findByRole("region", { name: "确认购买" });
    fireEvent.change(screen.getByRole("textbox", { name: "展示姓名" }), { target: { value: "支付前改名" } });
    fireEvent.click(screen.getByRole("button", { name: /前往支付宝沙箱收银台/ }));
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
  });

  it("shows campus activities under their own heading in the showcase", () => {
    const config = {
      ...rawConfig,
      content: { ...rawConfig.content, workExperience: [], campusExperience: ["哈尔滨理工大学嵌入式创新实验室 成员"], education: ["哈尔滨理工大学"] }
    } as DesignConfig;
    render(<ShowcasePage config={config} />);
    expect(screen.getByRole("heading", { name: "Campus experience" })).toBeInTheDocument();
    expect(screen.getByText("哈尔滨理工大学嵌入式创新实验室 成员")).toBeInTheDocument();
  });

  it("keeps card controls manual on touch input and explains the downgrade", async () => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
    try {
      render(<App />);
      fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
        target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
      });
      await screen.findByRole("heading", { name: /确认并修正/ });
      fireEvent.click(screen.getByRole("button", { name: /确认内容，进入测评/ }));
      expect(screen.getAllByText(/检测到触屏/).length).toBeGreaterThan(0);
      document.querySelectorAll(".quiz-question").forEach((question) => {
        const options = within(question as HTMLElement).getAllByRole("radio");
        fireEvent.click(options[options.length - 1]);
      });
      fireEvent.click(screen.getByRole("button", { name: /生成 Design Config/ }));
      const config = JSON.parse(screen.getByTestId("design-config-json").textContent ?? "") as DesignConfig;
      expect(config.styleVector.S).toBe(1);
      expect(config.marquee.bindToScroll).toBe(false);
      expect(config.stackedCards.enableTilt).toBe(false);
      expect(config.stackedCards.autoPlay).toBe(false);
      expect(screen.getAllByText(/检测到触屏/).length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
    }
  });

  it("downgrades an already generated configuration after an actual touch event", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("选择 PDF 简历"), {
      target: { files: [new File(["pdf"], "resume.pdf", { type: "application/pdf" })] }
    });
    await screen.findByRole("heading", { name: /确认并修正/ });
    fireEvent.click(screen.getByRole("button", { name: /确认内容，进入测评/ }));
    document.querySelectorAll(".quiz-question").forEach((question) => {
      const options = within(question as HTMLElement).getAllByRole("radio");
      fireEvent.click(options[options.length - 1]);
    });
    fireEvent.click(screen.getByRole("button", { name: /生成 Design Config/ }));
    const output = () => JSON.parse(screen.getByTestId("design-config-json").textContent ?? "") as DesignConfig;
    expect(output().marquee.bindToScroll).toBe(true);
    fireEvent.touchStart(window);
    await waitFor(() => expect(output().marquee.bindToScroll).toBe(false));
    expect(output().stackedCards.autoPlay).toBe(false);
    expect(screen.getAllByText(/检测到触屏/).length).toBeGreaterThan(0);
  });
});
