"use client";

type LaunchPageProps = {
  projectCount: number;
  onProjects: () => void;
  onSample: () => void;
  onLegacyParse: () => void;
};

const valueCards = [
  { icon: "✦", title: "AI 智能解析", description: "自动识别教育、经历、项目与技能，省去手动整理。" },
  { icon: "+", title: "模块化补充", description: "每个模块都能补充说明、作品链接与图片。" },
  { icon: "◒", title: "挑选网站风格", description: "按个人偏好选择统一的视觉呈现。" },
  { icon: "↗", title: "一键发布", description: "生成专属链接，让他人查看你的作品。" }
] as const;

const examples = [
  { title: "体验设计作品集", role: "UI / UX 设计师", tone: "peach", label: "查看体验设计作品集样例" },
  { title: "创意开发实验室", role: "前端开发者", tone: "sage", label: "查看创意开发实验室样例" },
  { title: "我的项目与故事", role: "跨领域探索者", tone: "stone", label: "查看我的项目与故事样例" }
] as const;

function preferredScrollBehavior(): ScrollBehavior {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

function scrollToExamples(): void {
  const target = document.getElementById("launch-examples");
  if (target && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  }
}

function scrollToTop(): void {
  if (typeof window.scrollTo === "function") window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
}

export function LaunchPage({ projectCount, onProjects, onSample, onLegacyParse }: LaunchPageProps) {
  return <div className="launch-page">
    <header className="launch-header">
      <button type="button" className="launch-logo" onClick={scrollToTop} aria-label="返回 BuildURProfile 首页顶部">
        <img src="/logo.png" width={150} height={78} alt="BuildURProfile" />
      </button>
      <nav className="launch-nav" aria-label="首页导航">
        <button type="button" onClick={scrollToExamples}>查看样例</button>
      </nav>
      <div className="launch-header-actions">
        <button type="button" className="launch-projects" onClick={onProjects} aria-label={`我的项目，共 ${projectCount} 个`}>我的项目</button>
        <a className="launch-button launch-button--primary" href="/upload">开始生成</a>
      </div>
    </header>

    <main className="launch-main">
      <section className="launch-hero" aria-labelledby="launch-hero-title">
        <div className="launch-hero-copy">
          <h1 id="launch-hero-title">把一份 PDF 简历，<br />变成你的个人网站</h1>
          <p>AI 自动解析简历模块，补充作品链接与图片，<br />几分钟生成可分享的个人主页。</p>
          <div className="launch-hero-actions">
            <a className="launch-button launch-button--primary" href="/upload">上传简历，免费开始</a>
            <button type="button" className="launch-button launch-button--secondary" onClick={scrollToExamples}>查看样例 ↓</button>
          </div>
          <button type="button" className="launch-compatibility" onClick={onLegacyParse}>使用浏览器解析（兼容）</button>
        </div>

        <div className="launch-preview" aria-label="个人网站效果预览">
          <span>LIN / DESIGN PORTFOLIO</span>
          <strong>用设计，让复杂变简单。</strong>
          <p>精选作品 / 个人经历 / 联系方式</p>
          <div className="launch-preview-projects">
            <article><b>01 交互设计</b><span>项目过程 → 作品展示</span></article>
            <article><b>02 创意实验</b><span>项目过程 → 作品展示</span></article>
          </div>
        </div>
      </section>

      <section className="launch-section" id="about" aria-labelledby="launch-value-title">
        <h2 id="launch-value-title">从简历到网站，每一步都有帮助</h2>
        <div className="launch-value-grid">
          {valueCards.map((card) => <article className="launch-value-card" key={card.title}>
            <h3><span aria-hidden="true">{card.icon}</span>{card.title}</h3>
            <p>{card.description}</p>
          </article>)}
        </div>
      </section>

      <section className="launch-section launch-examples" id="launch-examples" aria-labelledby="launch-examples-title">
        <h2 id="launch-examples-title">看看你的经历，可以变成什么</h2>
        <div className="launch-example-grid">
          {examples.map((example) => <article className="launch-example-card" key={example.title}>
            <div className={`launch-example-art launch-example-art--${example.tone}`}>
              <h3>{example.title}</h3>
              <p>SELECTED WORK<br />01 — 发现问题<br />02 — 设计与实现</p>
            </div>
            <strong>{example.role}</strong>
            <button type="button" className="launch-button launch-button--secondary" aria-label={example.label} onClick={onSample}>查看样例 ↗</button>
          </article>)}
        </div>
        <button type="button" className="launch-button launch-button--secondary launch-more" aria-label="查看更多作品集样例" onClick={onSample}>查看更多样例 →</button>
      </section>

      <section className="launch-section launch-steps" id="process" aria-labelledby="launch-steps-title">
        <h2 id="launch-steps-title">三步，开启你的个人展示</h2>
        <ol>
          <li>1 上传 PDF →</li>
          <li>2 确认内容 →</li>
          <li>3 生成网站</li>
        </ol>
      </section>
    </main>

    <footer className="launch-footer">
      <span>BuildURProfile</span>
      <div className="launch-footer-meta" aria-label="站点信息">
        <span>隐私政策</span>
        <span>服务条款</span>
        <span>联系我们</span>
      </div>
      <button type="button" className="launch-compatibility" onClick={onLegacyParse}>使用浏览器解析（兼容）</button>
    </footer>
  </div>;
}

export type { LaunchPageProps };
