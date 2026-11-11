import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesignConfig } from "../../../packages/contracts/src/config";
import rawConfig from "./demo/config.json";
import { ShowcasePage } from "./ShowcasePage";

const defaultConfig = rawConfig as DesignConfig;

describe("ShowcasePage image content", () => {
  it("matches confirmed awards and other content while omitting an empty project module", () => {
    const config: DesignConfig = {
      ...defaultConfig,
      content: {
        ...defaultConfig.content,
        projects: [],
        resume: {
          version: "resume-v1",
          basicInfo: [{ key: "name", label: "姓名", value: "林青" }], jobIntent: [], selfEvaluation: [],
          education: [], workExperience: [], projects: [],
          awards: [{ title: "校级创新奖", details: "2023.10 校级创新奖", facts: [] }],
          campusExperience: [], skills: [],
          other: [{ title: "自媒体经历", details: "运营技术专栏", facts: [] }]
        }
      }
    };
    render(<ShowcasePage config={config} />);
    expect(screen.getByRole("heading", { name: "荣誉奖项" })).toBeVisible();
    expect(screen.getByText("2023.10 校级创新奖")).toBeVisible();
    expect(screen.getByRole("heading", { name: "其他内容" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Selected work/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Projects" })).not.toBeInTheDocument();
  });

  it("places self evaluation in its own module without empty skills or projects", () => {
    const config: DesignConfig = { ...defaultConfig, content: { ...defaultConfig.content,
      projects: [], profile: { ...defaultConfig.content.profile, summary: "重视用户体验" },
      expertise: { eyebrow: "相关技能", headline: "技能与专长", summary: "", skills: [], disciplines: [] },
      resume: { version: "resume-v1", basicInfo: [], jobIntent: [],
        selfEvaluation: [{ title: "自我评价", details: "重视用户体验", facts: [] }],
        education: [], workExperience: [], projects: [], awards: [], campusExperience: [], skills: [], other: [] }
    } };
    render(<ShowcasePage config={config} />);
    expect(screen.getByRole("heading", { name: "自我评价" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "技能与专长" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Skills" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Projects" })).not.toBeInTheDocument();
  });
  it("omits structured modules whose confirmed values were cleared", () => {
    const config: DesignConfig = { ...defaultConfig, content: { ...defaultConfig.content,
      resume: { version: "resume-v1", basicInfo: [{ key: "phone", label: "电话", value: "" }],
        jobIntent: [{ key: "targetRole", label: "目标岗位", value: "" }], selfEvaluation: [],
        education: [], workExperience: [], projects: [],
        awards: [{ title: "", details: "", facts: [] }], campusExperience: [], skills: [], other: [] }
    } };
    render(<ShowcasePage config={config} />);
    expect(screen.queryByRole("heading", { name: "求职意向" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "个人信息" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "荣誉奖项" })).not.toBeInTheDocument();
  });
  it("hides legacy project and experience sections after their entries are cleared", () => {
    const config: DesignConfig = { ...defaultConfig, content: { ...defaultConfig.content,
      projects: [{ ...defaultConfig.content.projects[0], title: "", description: "" }],
      workExperience: ["   "], campusExperience: [""], education: [""]
    } };
    render(<ShowcasePage config={config} />);
    expect(screen.queryByRole("link", { name: "Projects" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Experience" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Education" })).not.toBeInTheDocument();
  });
  it("renders work and campus experience as independent modules", () => {
    const config: DesignConfig = { ...defaultConfig, content: { ...defaultConfig.content,
      workExperience: ["示例公司 前端实习生"],
      campusExperience: ["学生班主任助理"],
      education: []
    } };
    const { rerender } = render(<ShowcasePage config={config} />);
    expect(screen.getByRole("region", { name: "实习/工作经历" })).toHaveTextContent("示例公司 前端实习生");
    expect(screen.getByRole("region", { name: "校园经历" })).toHaveTextContent("学生班主任助理");
    rerender(<ShowcasePage config={{ ...config, content: { ...config.content, workExperience: [] } }} />);
    expect(screen.queryByRole("region", { name: "实习/工作经历" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "校园经历" })).toHaveTextContent("学生班主任助理");
  });
  it("places preview artwork in the first hero section", () => {
    const config = { ...defaultConfig, heroArtwork: { assetUrl: "/api/hero-assets/12345678-1234-1234-1234-123456789012", styleId: "retro-flat-anime-head", alt: "动画肖像" } } as DesignConfig;
    const { container } = render(<ShowcasePage config={config} />);
    const hero = container.querySelector(".hero");
    expect(hero?.querySelector("img[alt='动画肖像']")).toHaveAttribute("src", config.heroArtwork?.assetUrl);
  });
  it("prefers marquee items from config and counts those items", () => {
    const config: DesignConfig = {
      ...defaultConfig,
      marquee: {
        ...defaultConfig.marquee,
        items: ["Custom skill", { label: "Design systems", image: "data:image/png;base64,AAAA" }]
      }
    };
    render(<ShowcasePage config={config} />);

    expect(screen.getAllByAltText("Design systems")).toHaveLength(4);
    expect(screen.getAllByText("Custom skill")).toHaveLength(4);
    expect(screen.getByRole("region", { name: "Scrolling expertise" })).not.toHaveTextContent("Product design");
    expect(screen.getByRole("list", { name: "完整技能" })).toHaveTextContent("Product design");
    expect(screen.getByText("01 / 02")).toBeInTheDocument();
  });

  it("uses expertise skills when marquee items are absent", () => {
    render(<ShowcasePage config={defaultConfig} />);

    expect(screen.getAllByText("Product design").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("01 / 06")).toBeInTheDocument();
  });

  it("keeps long confirmed skills in a static list without repeating the first sentence as a headline", () => {
    const skill = "熟悉 C/C++、Java、Python 等编程语言，能够利用QT实现简易交互界面";
    const config: DesignConfig = {
      ...defaultConfig,
      marquee: { ...defaultConfig.marquee, items: undefined },
      content: {
        ...defaultConfig.content,
        profile: { ...defaultConfig.content.profile, role: "", intro: "" },
        expertise: { eyebrow: "相关技能", headline: skill, summary: skill, skills: [skill, "熟悉 STM32 及相关单片机开发，能自主完成相关的综合实践项目"], disciplines: [skill] }
      }
    };
    render(<ShowcasePage config={config} />);
    expect(screen.getByRole("heading", { name: "技能与专长" })).toBeVisible();
    expect(screen.getAllByText(skill)).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Scrolling expertise" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "完整技能" })).toHaveTextContent("熟悉 STM32");
    expect(screen.queryByText("RESUME SHOWCASE")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看项目/ })).toHaveAttribute("href", "#work");
  });

  it("shows edited profile summary and availability in the live showcase", () => {
    const withProfile = (summary: string, availability: string): DesignConfig => ({
      ...defaultConfig,
      content: {
        ...defaultConfig.content,
        profile: { ...defaultConfig.content.profile, summary, availability }
      }
    });
    const { rerender } = render(<ShowcasePage config={withProfile("I build humane tools.", "Open for work in November")} />);

    expect(screen.getByText("I build humane tools.")).toBeVisible();
    expect(screen.getByText("Open for work in November")).toBeVisible();
    rerender(<ShowcasePage config={withProfile("I design clear systems.", "Booked until January")} />);
    expect(screen.getByText("I design clear systems.")).toBeVisible();
    expect(screen.getByText("Booked until January")).toBeVisible();
    expect(screen.queryByText("I build humane tools.")).not.toBeInTheDocument();
  });

  it("scrolls section links without replacing a share hash", () => {
    const originalHash = window.location.hash;
    window.location.hash = "#share=abc123";
    try {
      render(<ShowcasePage config={defaultConfig} preserveShareHash />);
      const links = [
        ["BuildURProfile home", "top"],
        ["Skills", "about"],
        ["Projects", "work"],
        ["Contact", "contact"],
        ["EXPLORE", "about"],
        ["BACK TO TOP", "top"]
      ] as const;
      for (const [name, id] of links) {
        const target = document.getElementById(id);
        expect(target).not.toBeNull();
        const scrollIntoView = vi.fn();
        Object.defineProperty(target, "scrollIntoView", { configurable: true, value: scrollIntoView });
        const link = screen.getAllByRole("link", { name: new RegExp(name, "i") }).find((entry) => entry.getAttribute("href") === `#${id}`);
        expect(link).toBeDefined();
        expect(fireEvent.click(link!)).toBe(false);
        expect(scrollIntoView).toHaveBeenCalledOnce();
        expect(window.location.hash).toBe("#share=abc123");
      }
    } finally {
      window.location.hash = originalHash;
    }
  });

  it("shows the touch downgrade note only when requested", () => {
    const { rerender } = render(<ShowcasePage config={defaultConfig} />);
    expect(screen.queryByText(/检测到触屏/)).not.toBeInTheDocument();

    rerender(<ShowcasePage config={defaultConfig} touchDowngraded />);
    expect(screen.getByText(/检测到触屏.*卡片手动切换.*跑马灯恒定滚动/)).toBeVisible();
  });

  it("downgrades scroll-bound marquee in the standalone renderer on touch", () => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
    try {
      const config: DesignConfig = { ...defaultConfig, marquee: { ...defaultConfig.marquee, bindToScroll: true, pauseOnHover: true } };
      render(<ShowcasePage config={config} />);
      expect(screen.getByText(/检测到触屏/)).toBeVisible();
      const track = screen.getByTestId("marquee-track-0");
      expect(track).toHaveStyle({ animationName: "marquee-travel", animationPlayState: "running" });
      expect(track.style.transform).toBe("");
    } finally {
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
    }
  });
});

it('renders v2 supplements once with context-specific images and separate work/campus', async () => {
  const {default:resume}=await import('../../../packages/contracts/fixtures/resume-enrichment.v2.json');
  const {resumeDisplayContent}=await import('../../../packages/contracts/src/resume-v2.mjs');
  const config={...defaultConfig,content:resumeDisplayContent(resume)} as DesignConfig;
  render(<ShowcasePage config={config} resolveResumeImage={id=>`/api/shares/synthetic/media/${id}`}/>);
  expect(screen.getAllByText('补充说明')).toHaveLength(1);
  expect(screen.getByRole('link',{name:'作品地址'})).toHaveAttribute('rel','noopener noreferrer');
  expect(screen.getByRole('img',{name:'合成截图'})).toHaveAttribute('src','/api/shares/synthetic/media/image_synthetic');
});

it('keeps a supplement-only project visible in the fixed card deck', async () => {
  const {resumeDisplayContent}=await import('../../../packages/contracts/src/resume-v2.mjs');
  const resume={version:'resume-v2',sections:[{kind:'projects',items:[{itemId:'project_supplement',title:'',details:'',facts:[],supplement:{text:'仅有的补充正文',links:[],images:[]}}]}]};
  render(<ShowcasePage config={{...defaultConfig,content:resumeDisplayContent(resume)} as DesignConfig}/>);
  expect(screen.getByTestId('stacked-deck')).toBeInTheDocument();
  expect(screen.getByText('仅有的补充正文')).toBeInTheDocument();
});
