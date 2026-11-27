"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { TemplateId } from "../../../../packages/contracts/src/config";
import {
  createDemoShowcaseConfig, defaultDemoDraft, demoDraftKey, demoModules, demoTemplates, readDemoDraft
} from "../demo/showcaseDemo";
import type { DemoDraft } from "../demo/showcaseDemo";
import { createPreviewNonce, openShowcasePreview, previewUrl, readPreviewMessage, sendPreviewMessage } from "../lib/showcasePreview";
import type { PreviewSnapshot } from "../lib/showcasePreview";
import "./DemoWorkbench.css";

const tabs = [
  { id: "content", label: "内容" },
  { id: "style", label: "样式" },
  { id: "settings", label: "设置" }
] as const;
type Tab = (typeof tabs)[number]["id"];

function DemoCanvas({ config, zoom }: { config: PreviewSnapshot["config"]; zoom: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce, setNonce] = useState<string>();
  const [connection, setConnection] = useState(0);

  useEffect(() => {
    const token = createPreviewNonce();
    const receive = (event: MessageEvent) => {
      if (readPreviewMessage(event, frame.current?.contentWindow, token)?.action === "ready") {
        setConnection(previous => previous + 1);
      }
    };
    window.addEventListener("message", receive);
    setNonce(token);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    const peer = frame.current?.contentWindow;
    if (nonce && connection && peer) {
      sendPreviewMessage(peer, { nonce, action: "snapshot", snapshot: { config, sample: true } });
    }
  }, [nonce, connection, config]);

  return <div className="demo-canvas-view" style={{ "--demo-zoom": zoom / 100 } as CSSProperties}>
    {nonce && <iframe ref={frame} src={previewUrl(nonce, true)} title="实时样例预览" loading="lazy" />}
  </div>;
}

export function DemoWorkbench() {
  const [draft, setDraft] = useState<DemoDraft>(defaultDemoDraft);
  const [tab, setTab] = useState<Tab>("content");
  const [zoom, setZoom] = useState(100);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("");
  const [previewError, setPreviewError] = useState("");
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const config = useMemo(() => createDemoShowcaseConfig(draft.templateId, draft), [draft]);
  const pixel = draft.templateId === "pixel-world-v1";
  const displayedModules = pixel
    ? [...draft.modules.filter(module => module.kind === "projects"), ...draft.modules.filter(module => module.kind !== "projects")]
    : draft.modules;
  const firstMovableIndex = pixel ? 1 : 0;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(demoDraftKey);
      setDraft(readDemoDraft(raw));
      setSaved(Boolean(raw));
    } catch {
      setStatus("浏览器存储不可用，仍可在当前页面试玩。");
    }
  }, []);

  function update<T extends keyof DemoDraft>(key: T, value: DemoDraft[T]) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setSaved(false);
    setStatus("");
  }

  function save() {
    try {
      localStorage.setItem(demoDraftKey, JSON.stringify(draft));
      setSaved(true);
      setStatus("样例草稿已保存到当前浏览器。");
    } catch {
      setStatus("当前浏览器无法保存样例草稿。");
    }
  }

  function moveModule(at: number, direction: -1 | 1) {
    const next = at + direction;
    if (at < firstMovableIndex || next < firstMovableIndex || next >= displayedModules.length) return;
    const modules = [...draft.modules];
    const from = modules.findIndex(module => module.kind === displayedModules[at].kind);
    const to = modules.findIndex(module => module.kind === displayedModules[next].kind);
    [modules[from], modules[to]] = [modules[to], modules[from]];
    update("modules", modules);
  }

  function changeTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = {
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabButtons.current[next]?.focus();
  }

  const switchTemplate = (templateId: TemplateId) => update("templateId", templateId);

  const openPreview = () => {
    setPreviewError("");
    void openShowcasePreview(config, { sample: true }).catch(error => setPreviewError(error.message));
  };

  return <section id="editor" className="demo-workbench" aria-labelledby="demo-workbench-title">
    <header className="demo-workbench-heading">
      <div><h2 id="demo-workbench-title">作品集预览与编辑</h2>
        <p>用一份样例简历体验编辑，修改即刻显示在预览中。</p></div>
      <span className="demo-draft-state">{saved ? "草稿已保存到本机" : "样例试玩"}</span>
    </header>
    <div className="demo-workspace">
      <section className="demo-canvas" aria-label="作品集预览画布">
        <div className="demo-toolbar">
          <span>样例预览</span>
          <button type="button" aria-label="缩小预览" disabled={zoom === 50} onClick={() => setZoom(Math.max(50, zoom - 10))}>−</button>
          <button type="button" aria-label={`缩放 ${zoom}%，重置为 100%`} onClick={() => setZoom(100)}>{zoom}%</button>
          <button type="button" aria-label="放大预览" disabled={zoom === 140} onClick={() => setZoom(Math.min(140, zoom + 10))}>＋</button>
        </div>
        <DemoCanvas config={config} zoom={zoom} />
      </section>
      <aside className="demo-inspector" aria-label="样例调整面板">
        <h3>调整你的网站</h3>
        <div className="demo-tabs" role="tablist" aria-label="样例编辑分类">
          {tabs.map(({ id, label }, index) => <button key={id} ref={button => { tabButtons.current[index] = button; }}
            id={`demo-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="demo-tab-panel"
            tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => changeTabs(event, index)}>
            {label}
          </button>)}
        </div>
        <div className="demo-controls" id="demo-tab-panel" role="tabpanel" aria-labelledby={`demo-tab-${tab}`}>
          {tab === "content" && <>
            <label>姓名<input value={draft.name} maxLength={30} onChange={event => update("name", event.currentTarget.value)} /></label>
            <label>职业方向<input value={draft.role} maxLength={50} onChange={event => update("role", event.currentTarget.value)} /></label>
            <label>首屏主张<textarea value={draft.headline} rows={2} maxLength={80} onChange={event => update("headline", event.currentTarget.value)} /></label>
            <h4>页面模块</h4>
            {pixel && <p className="demo-hint">像素世界风的项目集中在作品档案。经历与能力模块可在对应章节内排序。</p>}
            <ul className="demo-module-list">
              {displayedModules.map(({ kind, visible }, index) => {
                const label = demoModules.find(module => module.kind === kind)?.label;
                return <li key={kind}>
                  <span>{label}</span>
                  <button type="button" aria-label={`上移${label}`} disabled={index <= firstMovableIndex} onClick={() => moveModule(index, -1)}>↑</button>
                  <button type="button" aria-label={`下移${label}`} disabled={index < firstMovableIndex || index >= displayedModules.length - 1} onClick={() => moveModule(index, 1)}>↓</button>
                  <label className="demo-switch"><input type="checkbox" aria-label={`显示${label}`} checked={visible}
                    onChange={event => update("modules", draft.modules.map(module => module.kind === kind ? { ...module, visible: event.currentTarget.checked } : module))} />
                    <span>{visible ? "显示" : "隐藏"}</span>
                  </label>
                </li>;
              })}
            </ul>
          </>}
          {tab === "style" && <div className="demo-template-tiles" aria-label="五套正式作品模板">
            {demoTemplates.map(({ id, name, foreground, background }) => <button key={id} type="button"
              aria-pressed={draft.templateId === id} onClick={() => switchTemplate(id)}>
              <span aria-hidden="true" style={{ color: foreground, background }}>Aa</span>
              {name}
            </button>)}
          </div>}
          {tab === "settings" && <>
            <label className="demo-inline-field"><input type="checkbox" checked={draft.showContact}
              onChange={event => update("showContact", event.currentTarget.checked)} />显示样例联系邮箱</label>
            <p className="demo-hint">样例草稿仅保存在当前浏览器。新标签页预览随标签页关闭而结束。</p>
          </>}
        </div>
        <div className="demo-actions">
          <button type="button" onClick={openPreview}>新标签页预览 ↗</button>
          <button type="button" onClick={save}>保存样例草稿</button>
          <a className="demo-start" href="/upload">制作我的作品集 →</a>
        </div>
        {previewError && <p className="demo-feedback" role="alert">{previewError}</p>}
        {status && <p className="demo-feedback" role="status">{status}</p>}
      </aside>
    </div>
  </section>;
}
