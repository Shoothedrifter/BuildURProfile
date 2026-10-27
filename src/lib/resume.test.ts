import { describe, expect, it } from "vitest";
import { parseResumePages, reflowVisualLines, skillShortLabels, toResumeContent, validateResumeDraft } from "./resume";

const pages = [
  `黄琬斐
huangwanfei_05@163.com 18296246182 21岁
2026.09 - 2027.12 香港大学
Master of Science in Computer Science | 全日制硕士
• 主修：Large Language Models、Natural Language Processing
2022.09 - 2026.06 华中农业大学 211 双一流
计算机科学与技术 | 本科
• 成绩：GPA：3.81/4.0
编程与数据：使用NumPy、pandas完成数据清洗。
模型训练与NLP：基于PyTorch搭建训练流程。
智能体开发：基于LangGraph与ReAct开发多Agent工作流。
模型推理与部署：具有vLLM部署实践。
工程化开发：FastAPI、MySQL构建后端服务。
Halliday 北京霍达视界科技有限公司 2026.04 - 2026.08
AIAgent开发实习生（SoftwareEngineerIntern,Algorithm）
会议Agent业务开发：负责MeetingFlow决策卡。
大模型部署与推理优化：将单流解码速度从35提升至101tok/s。`,
  `嵌入式固件日志 bug 诊断Agent 2026.06 - 2026.08
Halliday 提效开发工具
项目描述：支持百MB级日志的关键行定位。
学习工厂—— 多智能体学习计划制定系统 2026.02 - 2026.03
项目描述：基于OpenAI兼容SDK自研AgentLoop。
基于ByT5的阿卡德语–英语神经机器翻译 2026.01 - 2026.03
项目描述：采用chrF交叉验证。
基于Unsloth的中医诊断推理微调 2025.05 - 2025.06
项目描述与职责：完成医学语料微调。`
];

// A compact excerpt in the visual order of the supplied one-page PDF.
const onePageSections = `RESUME
中共党员 江西九江
黄禹哲
哈尔滨理工大学·计算机科学与技术22级
15797986719 2204010707
@stu.hrbust.edu.cn
教育背景
GPA：4.04 / 5 成绩排名：8 / 285（前3%）
主修课程：数据结构(98)、操作系统(95)
ARM 体系结构及编程、嵌入式 Linux 系统设计
获奖经历
• 2023 年中国智能机器人格斗及竞技大赛国家级三等奖
项目实践
基于AI Studio计算机视觉的运动自行车环境感知系统（省级大创优秀结题项目·技术负责人）
• 简介：基于百度飞桨PaddlePaddle大模型，开发多模态运动自行车环境感知系统。
体，开发的多模态运动自行车环境感知大模型。
• 分工：负责计算机图像识别模型。
• 成果：IEEE会议论文一篇（一作）。
基于物联网及大模型的无土栽培系统（竞赛项目·队长）
• 简介：基于物联网的无土栽培系统实现监测和调控。
系统中的执行设备。
• 分工：负责相关硬件电路搭建。
专业技能
• 熟悉 C/C++、Java、Python 等编程语言
• 熟悉 STM32 及相关单片机开发
• 熟悉 Linux 操作系统
• 熟悉 FPGA Verilog语言
校园经历
• 哈尔滨理工大学嵌入式创新实验室 成员
• 哈尔滨理工大学百度飞桨领航团 社团长`;

describe("resume parser", () => {
  it("recognizes a decorated header and an email wrapped after its local part", () => {
    const draft = parseResumePages([onePageSections]);
    expect(draft.name.value).toBe("黄禹哲");
    expect(draft.email.value).toBe("2204010707@stu.hrbust.edu.cn");
    expect(draft.email.source).toContain("15797986719 2204010707\n@stu.hrbust.edu.cn");
  });

  it("rejects identity edits that cannot be traced to the PDF", () => {
    const draft = parseResumePages([onePageSections]);
    const changed = {
      ...draft,
      name: { ...draft.name, value: "李禹哲" },
      email: { ...draft.email, value: "2204010707@example.com" }
    };
    expect(validateResumeDraft(changed)).toContain("姓名含 PDF 原文没有的表述");
    expect(validateResumeDraft(changed)).toContain("邮箱含 PDF 原文没有的表述");
  });

  it("segments undated projects and bullet skills under visual section headings", () => {
    const draft = parseResumePages([onePageSections]);
    expect(draft.education).toHaveLength(1);
    expect(draft.education[0].value).toContain("哈尔滨理工大学·计算机科学与技术22级");
    expect(draft.projects).toHaveLength(2);
    expect(draft.projects[1].value).toContain("无土栽培系统");
    expect(draft.projects[0].value).not.toContain("无土栽培系统");
    expect(draft.skills).toHaveLength(4);
    expect(draft.workExperience).toHaveLength(2);
    expect(validateResumeDraft(draft)).toEqual([]);
  });

  it("keeps a project's first introduction sentence in its description", () => {
    const content = toResumeContent(parseResumePages([onePageSections]));
    expect(content.projects[0].category).toBe("");
    expect(content.projects[0].description).toContain("简介：基于百度飞桨PaddlePaddle大模型");
  });

  it("exports campus activities separately from paid work", () => {
    const content = toResumeContent(parseResumePages([onePageSections]));
    expect(content.workExperience).toEqual([]);
    expect(content.campusExperience).toHaveLength(2);
    expect(content.sourceRefs?.["campusExperience.0"].excerpt).toContain("嵌入式创新实验室");
  });

  it("recognizes skill rows with the bullet glyph and spacing emitted by PDF.js", () => {
    const pdfJsPage = `黄琬斐
huangwanfei_05@163.com 18296246182 21岁
2026.09 - 2027.12 香港大学
Master of Science in Computer Science | 全日制硕士
2022.09 - 2026.06 华中农业大学 211 双一流
计算机科学与技术 | 本科
 编程与数据： 使用 NumPy、pandas 完成数据清洗
 模型训练与 NLP：基于 PyTorch 搭建模型训练流程
 智能体开发：基于 LangGraph 开发多 Agent 工作流
 模型推理与部署：具有 vLLM 部署实践
 工程化开发：FastAPI、MySQL 构建后端服务
Halliday 北京霍达视界科技有限公司 2026.04 - 2026.08
AI Agent 开发实习生（Software Engineer Intern, Algorithm）`;

    const draft = parseResumePages([pdfJsPage, pages[1]]);
    expect(draft.education).toHaveLength(2);
    expect(draft.education[1].value).not.toContain("编程与数据");
    expect(draft.skills).toHaveLength(5);
    expect(toResumeContent(draft).expertise.skills[0]).toContain("使用 NumPy、pandas 完成数据清洗");
    expect(skillShortLabels(toResumeContent(draft).expertise.skills)).toEqual([
      "编程与数据", "模型训练与 NLP", "智能体开发", "模型推理与部署", "工程化开发"
    ]);
    expect(draft.workExperience).toHaveLength(1);
    expect(draft.projects).toHaveLength(4);
  });

  it("segments the supplied resume layout even when section headings are absent", () => {
    const draft = parseResumePages(pages);
    expect(draft.name.value).toBe("黄琬斐");
    expect(draft.education).toHaveLength(2);
    expect(draft.skills).toHaveLength(5);
    expect(draft.workExperience).toHaveLength(1);
    expect(draft.projects).toHaveLength(4);
    expect(draft.projects[0].value).toContain("嵌入式固件日志 bug 诊断Agent");
    expect(draft.projects[0].page).toBe(2);
  });

  it("keeps exact PDF evidence and blocks a newly introduced numeric claim", () => {
    const draft = parseResumePages(pages);
    const changed = {
      ...draft,
      workExperience: [{ ...draft.workExperience[0], value: draft.workExperience[0].value.replace("101tok/s", "999tok/s") }]
    };
    expect(validateResumeDraft(changed)).toContain("工作经历 1 含原文没有的数字：999");
    expect(draft.workExperience[0].source).toContain("101tok/s");
  });

  it("rejects a fabricated project while preserving its source dates", () => {
    const draft = parseResumePages(pages);
    const altered = {
      ...draft,
      projects: [{
        ...draft.projects[0],
        value: draft.projects[0].value.replace("嵌入式固件日志 bug 诊断Agent", "全新获奖项目")
      }, ...draft.projects.slice(1)]
    };
    expect(validateResumeDraft(altered)).toContain("项目 1 的标题与 PDF 原文不符");
    const inventedDescription = {
      ...draft,
      projects: [{
        ...draft.projects[0],
        value: `${draft.projects[0].value}\n获得诺贝尔奖。`
      }, ...draft.projects.slice(1)]
    };
    expect(validateResumeDraft(inventedDescription)).toContain("项目 1 含 PDF 原文没有的表述");
  });

  it("blocks swapping two existing numbers into a new claim", () => {
    const draft = parseResumePages(pages);
    const changed = {
      ...draft,
      workExperience: [{
        ...draft.workExperience[0],
        value: draft.workExperience[0].value.replace("从35提升至101tok/s", "从101提升至35tok/s")
      }]
    };
    expect(validateResumeDraft(changed)).toContain("工作经历 1 的数字顺序或次数与原文不符");
  });

  it("builds showcase content from confirmed fields without adding projects", () => {
    const draft = parseResumePages(pages);
    const content = toResumeContent(draft);
    expect(content.profile.name).toBe("黄琬斐");
    expect(content.projects).toHaveLength(4);
    expect(content.projects[0].title).toBe("嵌入式固件日志 bug 诊断Agent");
    expect(content.projects[0].description).toContain("百MB级日志");
    expect(content.sourceRefs?.["projects.0"].excerpt).toContain("百MB级日志");
    expect(content.sourceRefs?.["profile.role"].excerpt).toContain("AIAgent开发实习生");
    expect(content.expertise.headline).toBe("技能与专长");
    expect(content.expertise.summary).toBe("");
    expect(content.expertise.skills[0]).toContain("编程与数据");
    expect(content.workExperience?.[0]).toContain("101tok/s");
    expect(content.workExperience?.[0].split("\n")[0]).toContain("Halliday");
    expect(content.workExperience?.[0]).toMatch(/\nAIAgent开发实习生/);
  });

  it("keeps prose, English identifiers and URL boundaries from confirmed PDF lines", () => {
    const project = "长项目标题（研发）\n简介：面向中文用户设计\n可访问的作品页。\n技术栈：React\nTypeScript\n仓库：https://example.com/my-\nproject";
    const draft = parseResumePages([`黄禹哲\n项目经历\n${project}\n专业技能\n能够设计复杂交互方案`]);
    const content = toResumeContent(draft);
    expect(content.projects[0].description).toContain("中文用户设计可访问的作品页。");
    expect(content.projects[0].description).toContain("React TypeScript");
    expect(content.projects[0].description).toContain("https://example.com/my-project");
    expect(content.expertise.skills).toContain("能够设计复杂交互方案");
    expect(skillShortLabels(content.expertise.skills)).toEqual([]);
  });

  it("does not swallow an adjacent English role into a URL", () => {
    expect(reflowVisualLines("产品介绍：https://example.com/featured\nAI Agent 开发实习生")).toBe("产品介绍：https://example.com/featured AI Agent 开发实习生");
    expect(reflowVisualLines("仓库：https://example.com/my-\nproject")).toBe("仓库：https://example.com/my-project");
  });
});
