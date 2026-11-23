"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { TemplateId } from "../../../../packages/contracts/src/config";
import { demoTemplates } from "../demo/showcaseDemo";
import { DemoWorkbench } from "./DemoWorkbench";
import { ResumeUpload } from "./ResumeUpload";
import "./LaunchPage.css";

type LaunchPageProps = {
  projectCount: number;
  onProjects: () => void;
  onSample: () => void;
  onLegacyParse: () => void;
};

const navigation = [
  { target: "write", label: "了解功能" },
  { target: "design", label: "作品集样例" },
  { target: "editor", label: "预览与编辑" }
] as const;

const fragments = ["产品体验设计师", "城市通勤服务", "用户研究", "交互原型", "让复杂变简单", "Figma / Design", "项目经历", "你的下一种可能"];
const original = "负责通勤产品的用户研究和页面设计。";
const suggestion = "通过站点访谈与换乘任务测试，梳理通勤信息层级，完成路线比较交互原型。";

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function IntroScene() {
  return <section className="journey-scene" id="intro" aria-labelledby="journey-title">
    <div className="journey-stage journey-intro">
      <div className="journey-fragments" aria-hidden="true">
        {fragments.map(fragment => <span key={fragment}>{fragment}</span>)}
      </div>
      <div className="journey-title">
        <h1 id="journey-title">你的经历，<br />值得<em>被看见。</em></h1>
        <p>让一份静态简历，成为可交互的能力证明。</p>
      </div>
      <div className="journey-assembled journey-paper" aria-label="由简历整理的作品集样张">
        <small>个人作品集</small>
        <h2>林予安</h2>
        <p className="journey-accent">产品体验设计师</p>
        <hr />
        <h3>用设计，让复杂变简单。</h3>
        <div className="journey-project-slip">
          <small>精选项目</small>
          <h3>城市通勤服务</h3>
          <p>从用户访谈到交互原型</p>
        </div>
        <h3>工作经历</h3>
        <p>出行服务团队 · 体验设计师</p>
        <hr />
        <p>Figma · 用户研究 · 交互设计</p>
      </div>
      <p className="journey-side-title journey-side-title--left" aria-hidden="true">从一份<br /><em>简历</em></p>
      <p className="journey-side-title journey-side-title--right" aria-hidden="true">到你的<br /><em>个人网站。</em></p>
      <div className="journey-intro-footer">
        <span>滚动探索，你的经历如何成为作品。</span>
        <a href="#write">继续向下 ↓</a>
      </div>
    </div>
  </section>;
}

type SuggestionDecision = "accept" | "keep" | "undo" | null;

function WritingScene() {
  const [decision, setDecision] = useState<SuggestionDecision>(null);
  const status = decision === "accept" ? "已接受建议" :
    decision === "keep" ? "已保留原文" : decision === "undo" ? "已撤销选择" : "";

  return <section className="journey-scene" id="write" aria-labelledby="journey-write-title">
    <div className="journey-stage journey-split">
      <div className="journey-copy">
        <small>功能介绍 · 解析与补充</small>
        <h2 id="journey-write-title">把经历，<br /><em>讲清楚。</em></h2>
        <p>补充你负责的工作、使用的方法和交付的成果。每项建议都可以接受、保留原文或撤销。</p>
        <p className="journey-flourish" aria-hidden="true">Aa <span>↗</span></p>
      </div>
      <article className="journey-writing journey-paper">
        <small>项目案例 · 城市通勤服务</small>
        <hr />
        <h3>把项目过程，变成能力证明</h3>
        <p>我的角色 · 体验设计 / 用户研究</p>
        <div className="journey-rewrite" data-decision={decision ?? "pending"}>
          {decision !== "accept" && <p className="journey-original">{original}</p>}
          {decision !== "keep" && <p className="journey-suggestion">{suggestion}</p>}
        </div>
        <div className="journey-note">
          <h4>项目补充建议</h4>
          <p>试着给这段示例经历补上设计方法和交付物。</p>
          <div className="journey-note-actions">
            <button type="button" className="journey-button journey-button--primary" aria-pressed={decision === "accept"}
              onClick={() => setDecision("accept")}>接受建议</button>
            <button type="button" className="journey-button" aria-pressed={decision === "keep"}
              onClick={() => setDecision("keep")}>保留原文</button>
            {(decision === "accept" || decision === "keep") && <button type="button" className="journey-button"
              onClick={() => setDecision("undo")}>撤销</button>}
          </div>
          <small role="status">{status}</small>
        </div>
      </article>
    </div>
  </section>;
}

function PortfolioSheet({ template }: { template?: (typeof demoTemplates)[number] }) {
  const colors = template
    ? { backgroundColor: template.background, color: template.foreground }
    : undefined;
  const portrait = template?.id === "cyber-creator-v1" ? "/cyber-neutral-print-anime.webp" :
    template?.id === "pixel-world-v1" ? "/pixel-world-base.svg" : null;

  return <div aria-hidden="true" className="journey-sheet" data-template={template?.id} style={colors}>
    <div className="journey-browser"><i /><i /><i /><span>林予安 / 作品集</span></div>
    <div className="journey-sheet-content">
      <div className="journey-web-hero">
        <div>
          <small>产品体验设计师</small>
          <strong>林予安</strong>
          <p>用设计，让复杂变简单。</p>
        </div>
        {portrait && <img width={64} height={86} src={portrait} alt="" />}
      </div>
      <div className="journey-sample-project">
        <div className="journey-route-card">
          <span>城市通勤</span>
          <strong>A → B</strong>
          <small>路线比较 · 交互原型</small>
        </div>
        <div>
          <small>精选项目</small>
          <h3>城市通勤服务</h3>
          <p>从站点访谈到换乘原型</p>
          <p><b>我的角色</b><br />研究 / 信息架构</p>
          <p><b>交付成果</b><br />用户旅程、交互原型</p>
        </div>
      </div>
      <div className="journey-web-footer">关于我 · 更多作品 · 联系方式</div>
    </div>
  </div>;
}

function ComparisonScene({ onSample }: { onSample: () => void }) {
  const [templateId, setTemplateId] = useState<TemplateId>("warm-v1");
  const [reveal, setReveal] = useState(65);
  const template = demoTemplates.find(option => option.id === templateId);

  return <section className="journey-comparison" id="design" aria-labelledby="journey-design-title">
    <small>作品集样例 · 网站风格</small>
    <h2 id="journey-design-title">同一份经历，<em>你的表达。</em></h2>
    <p>拖动滑杆对比排版，切换模板时保留同一份示例内容。</p>
    <div className="journey-comparison-frame">
      <PortfolioSheet />
      <div className="journey-comparison-overlay" style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}>
        <PortfolioSheet template={template} />
      </div>
      <div className="journey-divider" style={{ left: `${reveal}%` }} aria-hidden="true"><span>↔</span></div>
    </div>
    <label className="journey-range">
      <span>拖动对比</span>
      <input type="range" aria-label="样式对比滑杆" min={0} max={100} value={reveal}
        onChange={event => setReveal(event.currentTarget.valueAsNumber)} />
    </label>
    <div className="journey-template-options" aria-label="样例模板">
      {demoTemplates.map(option => <button type="button" key={option.id} className="journey-button"
        aria-pressed={option.id === templateId} onClick={() => setTemplateId(option.id)}>{option.name}</button>)}
    </div>
    <div className="journey-comparison-actions">
      <a className="journey-link" href="#editor">试着编辑样例 ↓</a>
      <button type="button" className="journey-link" onClick={onSample}>查看完整作品集样例</button>
    </div>
  </section>;
}

function EvidenceContent() {
  return <div className="journey-evidence-content">
    <small>精选项目</small>
    <h3>城市通勤服务</h3>
    <p>从站点访谈到换乘原型，记录一次出行体验改版。</p>
    <hr />
    <h4>我的角色与过程</h4>
    <p>访谈 → 信息架构 → 原型验证</p>
    <p>负责研究计划、流程设计和可交互原型。</p>
    <hr />
    <h4>成果与作品链接</h4>
    <p>用户旅程、路线比较流程及 Figma 原型。</p>
  </div>;
}

function EvidenceScene() {
  const card = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLDivElement>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState(false);
  const placeLens = (x: number, y: number) => {
    if (!card.current || !lens.current) return;
    const { width, height } = card.current.getBoundingClientRect();
    const radius = lens.current.offsetWidth / 2;
    const next = { x: clamp(x, radius, width - radius), y: clamp(y, radius, height - radius) };
    point.current = next;
    card.current.style.setProperty("--lens-x", `${next.x}px`);
    card.current.style.setProperty("--lens-y", `${next.y}px`);
  };

  useEffect(() => {
    const onResize = () => {
      if (!card.current) return;
      const { width, height } = card.current.getBoundingClientRect();
      placeLens(width * .68, height * .43);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const track = (event: PointerEvent<HTMLDivElement>) => {
    if (pinned || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    placeLens(event.clientX - bounds.left, event.clientY - bounds.top);
  };
  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!point.current) return;
    const { x, y } = point.current;
    const delta = 24;
    switch (event.key) {
      case "ArrowUp": placeLens(x, y - delta); break;
      case "ArrowRight": placeLens(x + delta, y); break;
      case "ArrowDown": placeLens(x, y + delta); break;
      case "ArrowLeft": placeLens(x - delta, y); break;
      default: return;
    }
    event.preventDefault();
  };

  return <section className="journey-evidence journey-split" id="check" aria-labelledby="journey-evidence-title">
    <div className="journey-copy">
      <small>作品详情 · 过程与成果</small>
      <h2 id="journey-evidence-title">让能力，<br /><em>有据可查。</em></h2>
      <p>用图片、文字和作品链接，说明你如何解决问题。</p>
      <p className="journey-evidence-path">项目背景 → 我的角色 → 设计过程 → 作品成果</p>
      <p className="journey-lens-help" id="journey-lens-help">移动鼠标或用方向键查看细节，点击按钮固定放大镜。</p>
    </div>
    <div className="journey-inspect journey-paper" ref={card} onPointerMove={track}>
      <EvidenceContent />
      <div className="journey-lens" aria-hidden="true" ref={lens}><EvidenceContent /></div>
      <button className="journey-button journey-lens-toggle" type="button" aria-pressed={pinned}
        aria-describedby="journey-lens-help" onKeyDown={moveWithKeyboard} onClick={() => setPinned(value => !value)}>
        固定放大镜
      </button>
    </div>
    <details className="journey-evidence-details journey-paper">
      <summary>查看项目细节</summary>
      <EvidenceContent />
    </details>
  </section>;
}

export function LaunchPage({ projectCount, onProjects, onSample, onLegacyParse }: LaunchPageProps) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState("");

  useEffect(() => {
    const home = root.current;
    if (!home) return;
    const scenes = Array.from(home.querySelectorAll<HTMLElement>(".journey-scene"));
    const sections = Array.from(home.querySelectorAll<HTMLElement>("#write, #design, #check, #upload, #editor"));
    let frame = 0;
    const paint = () => {
      frame = 0;
      const height = window.innerHeight;
      for (const scene of scenes) {
        const { top, height: sectionHeight } = scene.getBoundingClientRect();
        const progress = clamp(-top / Math.max(1, sectionHeight - height));
        scene.style.setProperty("--journey-progress", String(progress));
      }
      const visible = sections.filter(section => section.getBoundingClientRect().top < height * .5).at(-1)?.id;
      setActive(visible === "check" ? "design" : visible ?? "");
    };
    const requestPaint = () => { if (!frame) frame = window.requestAnimationFrame(paint); };
    window.addEventListener("scroll", requestPaint, { passive: true });
    window.addEventListener("resize", requestPaint);
    requestPaint();
    return () => {
      window.removeEventListener("scroll", requestPaint);
      window.removeEventListener("resize", requestPaint);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="journey-home" ref={root}>
    <header className="journey-header">
      <a className="journey-brand" href="#intro" aria-label="返回 BuildURProfile 首页顶部">
        <img src="/logo.png" width={94} height={49} alt="BuildURProfile" />
      </a>
      <nav aria-label="首页导航">
        {navigation.map(({ target, label }) => <a key={target} href={`#${target}`}
          aria-current={active === target ? "location" : undefined}>{label}</a>)}
      </nav>
      <div className="journey-header-actions">
        <button type="button" className="journey-button" onClick={onProjects}
          aria-label={`我的项目，共 ${projectCount} 个`}>我的项目</button>
        <a className="journey-button journey-button--primary" href="#upload">开始制作 →</a>
      </div>
    </header>

    <main>
      <IntroScene />
      <WritingScene />
      <ComparisonScene onSample={onSample} />
      <EvidenceScene />
      <div className="journey-upload">
        <ResumeUpload />
        <button type="button" className="journey-link" onClick={onLegacyParse}>使用浏览器解析（兼容）</button>
      </div>
      <DemoWorkbench />
      <section className="journey-process" id="process" aria-labelledby="journey-process-title">
        <h2 id="journey-process-title">从简历到作品集</h2>
        <ol>
          {["上传 PDF", "确认内容", "选择风格", "预览与发布"].map(step => <li key={step}>{step}</li>)}
        </ol>
        <a className="journey-button journey-button--primary" href="#upload">上传简历，免费开始</a>
      </section>
    </main>

    <footer className="journey-footer">
      <a href="#intro">BuildURProfile</a>
      <span>让你的经历被看见。</span>
    </footer>
  </div>;
}

export type { LaunchPageProps };
