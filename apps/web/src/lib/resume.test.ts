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
  it("keeps A–D categories and source evidence available for confirmation", () => {
    const draft = parseResumePages([`林青
电话：13800138000
所在地：上海
求职意向
目标岗位：前端开发
期待薪资：20k
自我评价
重视可访问性与协作。
教育背景
2020.09 - 2024.06 示例大学
专业：计算机科学
荣誉奖项
2023.10 校级创新奖
自媒体经历
运营技术专栏，累计发表 20 篇文章。
专业技能
编程技能：TypeScript`]);
    expect(draft.version).toBe("resume-candidate-v2");
    expect(validateResumeDraft({ ...draft, version: "unsupported" as "resume-candidate-v2" })).toContain("简历解析合同版本无效");
    expect(draft.basicInfo.map((entry) => entry.value)).toContain("电话：13800138000");
    expect(draft.jobIntent).toHaveLength(2);
    expect(draft.jobIntent.find((entry) => entry.fieldKey === "expectedSalary")?.included).toBe(false);
    expect(draft.selfEvaluation).toHaveLength(1);
    expect(draft.education).toHaveLength(1);
    expect(draft.awards[0]).toMatchObject({ page: 1, value: "2023.10 校级创新奖" });
    expect(draft.other[0].value).toContain("运营技术专栏");
    expect(draft.skills).toHaveLength(1);
    expect(draft.basicInfo.find((entry) => entry.value.startsWith("电话"))?.included).toBe(false);
  });

  it("projects only selected A–D facts into a source-free confirmed contract", () => {
    const draft = parseResumePages([`林青
电话：13800138000
求职意向
目标岗位：前端开发
自我评价
重视协作。
荣誉奖项
校级创新奖
其他经历
运营技术专栏。`]);
    draft.basicInfo[0].included = true;
    const content = toResumeContent(draft);
    expect(content.resume?.basicInfo).toContainEqual({ key: "phone", label: "电话", value: "13800138000" });
    expect(content.resume?.jobIntent).toContainEqual({ key: "targetRole", label: "目标岗位", value: "前端开发" });
    expect(content.resume?.awards[0].details).toContain("校级创新奖");
    expect(content.resume?.other[0].details).toContain("技术专栏");
    expect(JSON.stringify(content.resume)).not.toContain("source");
    expect(JSON.stringify(content.resume)).not.toContain("page");
  });

  it("offers unlabeled phone and age from the PDF header without publishing them by default", () => {
    const draft = parseResumePages(["林青\nlin@example.com 13800138000 21岁\n教育背景\n2020.09 - 2024.06 示例大学"]);
    expect(draft.basicInfo).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "phone", value: "13800138000", included: false }),
      expect.objectContaining({ fieldKey: "age", value: "21岁", included: false })
    ]));
    expect(toResumeContent(draft).resume?.basicInfo.map((fact) => fact.key)).not.toContain("phone");
    draft.basicInfo.forEach((entry) => { entry.included = true; });
    expect(validateResumeDraft(draft)).toEqual([]);
  });

  it("reads a labeled basic-information section without treating its heading as a name", () => {
    const draft = parseResumePages(["基本信息\n姓名：林青\n邮箱：lin@example.com\n电话：13800138000\n教育背景\n2020.09 - 2024.06 示例大学"]);
    expect(draft.name.value).toBe("林青");
    expect(draft.email.value).toBe("lin@example.com");
    expect(draft.basicInfo).toEqual(expect.arrayContaining([expect.objectContaining({ fieldKey: "phone", included: false })]));
    expect(draft.education).toHaveLength(1);
  });

  it("keeps the correct page for basic details continuing onto another page", () => {
    const draft = parseResumePages(["基本信息\n姓名：林青", "电话：13800138000\n教育背景\n2020.09 - 2024.06 示例大学"]);
    expect(draft.basicInfo[0].page).toBe(2);
  });
  it("maps a reclassified labeled line to its destination field", () => {
    const draft = parseResumePages(["林青\n其他内容\n目标岗位：前端开发"]);
    draft.jobIntent.push({ ...draft.other[0], label: undefined, fieldKey: undefined });
    draft.other = [];
    expect(toResumeContent(draft).resume?.jobIntent).toContainEqual({ key: "targetRole", label: "目标岗位", value: "前端开发" });
  });
  it("cites the target role from job intent instead of the previous job", () => {
    const content = toResumeContent(parseResumePages(["林青\n求职意向\n目标岗位：前端开发\n工作经历\n2024.01 - 2024.06 示例公司\n后端工程师"]));
    expect(content.profile.role).toBe("前端开发");
    expect(content.sourceRefs?.["profile.role"].excerpt).toBe("目标岗位：前端开发");
  });
  it("recognizes PDF compatibility ideographs in section headings", () => {
    const draft = parseResumePages(["Demo Person\ndemo@example.com\n项⽬经历\n2025.01 - 2025.06 示例作品集\n项目描述：合成测试内容。\n专业技能\nReact"]);
    expect(draft.name.value).toBe("Demo Person");
    expect(draft.projects).toHaveLength(1);
  });
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
    expect(draft.workExperience).toHaveLength(0);
    expect(draft.campusExperience).toHaveLength(2);
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

  it("keeps campus roles out of projects and separates Chinese-date campus records", () => {
    const draft = parseResumePages([`林青
实习经历
示例公司 前端实习生
2023 年 01 月 - 2023 年 06 月
项目经历
个人网站项目（课程设计·负责人）
项目描述：制作个人网站。
工作人员（先进个人）
2023 年 09 月 - 2024 年 09 月
华中农业大学信息与计算科学2402班
学生班主任助理
2024 年 09 月 - 2026 年 06 月
校园工作
学生会宣传部 干事`]);
    expect(draft.workExperience).toHaveLength(1);
    expect(draft.campusExperience).toHaveLength(3);
    expect(draft.campusExperience[0].value).toContain("工作人员（先进个人）");
    expect(draft.campusExperience[1].value).toContain("学生班主任助理");
    expect(draft.projects).toHaveLength(1);
    expect(draft.projects[0].value).not.toContain("学生班主任助理");
    const content = toResumeContent(draft);
    expect(content.resume?.campusExperience).toHaveLength(3);
    expect(content.resume?.workExperience).toHaveLength(1);
  });

  it("keeps a student organization software project in the project module", () => {
    const draft = parseResumePages([`林青
项目经历
学生会活动管理系统（课程设计）
2024 年 03 月 - 2024 年 06 月
实现活动报名与审批流程。`]);
    expect(draft.projects).toHaveLength(1);
    expect(draft.projects[0].value).toContain("学生会活动管理系统");
    expect(draft.campusExperience).toHaveLength(0);
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
