"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { githubPagesApi, paymentApi, submitAlipayForm } from "../lib/paymentApi";
import type { GitHubDeployment, Offer, OwnedProject } from "../lib/paymentApi";
import { ProofButton } from "./BuilderChrome";

const statusText: Record<GitHubDeployment["stage"], string> = {
  authorizing: "等待 GitHub 授权",
  uploading: "正在创建仓库并提交作品",
  building: "GitHub Pages 正在发布",
  waiting: "仍在等待 GitHub Pages",
  failed: "部署未完成",
  published: "作品集已发布"
};

function savedRepo(projectId: string | null, repo?: string) {
  if (!projectId) return "";
  const key = `github-pages-repo:${projectId}`;
  try {
    if (repo !== undefined) window.sessionStorage.setItem(key, repo);
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function GitHubPagesDialog({ projectId, paid, offer, paymentReturn, initialDeployment, pixel,
  saveProject, onPaid, onClose }: {
  projectId: string | null;
  paid: boolean;
  offer: Offer | null;
  paymentReturn: boolean;
  initialDeployment: GitHubDeployment | null;
  pixel: boolean;
  saveProject: () => Promise<OwnedProject>;
  onPaid: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [repo, setRepo] = useState(() => paymentReturn ? savedRepo(projectId) : "");
  const [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState(initialDeployment);
  const [history, setHistory] = useState<GitHubDeployment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [updatedQuote, setUpdatedQuote] = useState<string | null>(null);
  const price = updatedQuote ?? offer?.priceYuan;

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
    return () => { if (node.open && typeof node.close === "function") node.close(); };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void githubPagesApi.list(projectId).then(deployments => {
      if (active) setHistory(deployments);
    }).catch(() => {});
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (!selected || !["building", "uploading", "waiting"].includes(selected.stage)) return;
    const { id } = selected;
    let active = true;
    let timer: number;
    async function check() {
      try {
        const deployment = await githubPagesApi.status(id);
        if (active) setSelected(current => current?.id === id ? deployment : current);
      } catch {
        // The server keeps the build status. Retry after connectivity returns.
      }
      if (active) timer = window.setTimeout(() => void check(), 10_000);
    }
    timer = window.setTimeout(() => void check(), 5_000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [selected?.id, selected?.stage]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const name = (selected?.repo ?? repo).trim();
      if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(name) || /(?:\.github\.io|\.git)$/i.test(name)) {
        throw new Error("请输入有效的项目仓库名。");
      }
      const project = await saveProject();
      if (selected && selected.revision !== project.revision) {
        throw new Error("当前作品版本已变化，请为当前版本使用新仓库。");
      }
      if (!project.paid && !(await paymentApi.reconcile(project.id)).paid) {
        const checkout = await paymentApi.checkout(project.id, "github-pages");
        if (!checkout.alreadyPaid) {
          if (checkout.amountYuan !== price) {
            setUpdatedQuote(checkout.amountYuan ?? null);
            throw new Error("请确认更新后的订单金额，再继续支付。");
          }
          if (!checkout.paymentHtml || !offer?.mode) throw new Error("支付宝收银台暂不可用。");
          savedRepo(project.id, name);
          submitAlipayForm(checkout.paymentHtml, offer.mode);
          return;
        }
      }
      onPaid();
      const result = await githubPagesApi.start(project.id, {
        revision: project.revision, repo: name, confirmed: selected ? true : confirmed, deploymentId: selected?.id
      });
      setSelected(result.deployment);
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法提交部署，请重试。");
    } finally {
      setBusy(false);
    }
  }

  const canRetry = selected && ["failed", "waiting", "authorizing"].includes(selected.stage);
  return <dialog className="proof-github-dialog" ref={dialog} aria-labelledby={title}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id={title}>部署到 GitHub Pages</h2>
    {selected ? <div className="proof-github-state">
      <p role="status"><strong>{statusText[selected.stage]}</strong> · {selected.repo}</p>
      {selected.error && <p className="proof-note">{selected.error}</p>}
      {selected.stage === "building" && <p>GitHub 发布可能需要约十分钟。关闭窗口后可从这里继续查看。</p>}
      {selected.siteUrl && <label className="proof-field"><span>公开网址</span><input readOnly value={selected.siteUrl}
        onFocus={event => event.currentTarget.select()} /></label>}
      <div className="proof-share-actions">
        {selected.siteUrl && <a href={selected.siteUrl} target="_blank" rel="noopener noreferrer">打开网站</a>}
        {selected.repoUrl && <a href={selected.repoUrl} target="_blank" rel="noopener noreferrer">查看 GitHub 仓库</a>}
      </div>
    </div> : <>
      <p>我们会在你授权的 GitHub 个人账户下创建公开仓库。网站、仓库内容和作品中已选的联系方式均可公开访问。请在 GitHub 管理或下线该站点。</p>
      <p>GitHub 要求授予 <code>repo</code> 权限，可涵盖你有权访问的其他仓库。BuildURProfile 只向本次部署创建的仓库写入作品文件。</p>
      {pixel && <p>发布的作品使用像素模板默认角色。</p>}
      {paymentReturn && paid && <p role="status">已解锁发布资格，确认仓库信息后即可授权。</p>}
    </>}
    <form onSubmit={submit} className="proof-github-state">
      {!selected && <>
        <label className="proof-field"><span>新仓库名称</span><input required maxLength={100}
          pattern={"[A-Za-z0-9][A-Za-z0-9._\\-]{0,99}"} value={repo} placeholder="my-portfolio"
          disabled={busy} onChange={event => setRepo(event.target.value)} /></label>
        <label className="proof-github-consent"><input type="checkbox" required checked={confirmed} disabled={busy}
          onChange={event => setConfirmed(event.target.checked)} />我已核对作品内容，同意发布到公开仓库和网站</label>
        {!paid && <p className="proof-note">部署使用本项目的付费分享资格。{price ? `当前解锁价格 ¥${price}。` : "付款金额以上一笔订单或当前报价为准。"}</p>}
      </>}
      {error && <p className="proof-inline-error" role="alert">{error}</p>}
      <div className="proof-unlock-actions">
        {(!selected || canRetry) && <ProofButton type="submit" variant="primary" disabled={busy}>
          {busy ? "正在准备…" : selected ? "重新授权并继续" : paid ? "前往 GitHub 授权" : "解锁发布资格"}
        </ProofButton>}
        {selected && <ProofButton disabled={busy} onClick={() => {
          setHistory(current => [selected, ...current.filter(item => item.id !== selected.id)]);
          setSelected(null);
          setRepo("");
          setConfirmed(false);
          setError("");
        }}>部署到新仓库</ProofButton>}
        <ProofButton disabled={busy} onClick={onClose}>关闭</ProofButton>
      </div>
    </form>
    {history.some(item => item.id !== selected?.id) && <details>
      <summary>部署记录</summary>
      <ul className="proof-github-history">{history.filter(item => item.id !== selected?.id).map(item => <li key={item.id}>
        <ProofButton disabled={busy} onClick={() => { setSelected(item); setError(""); }}>
          {item.repo} · {statusText[item.stage]}
        </ProofButton>
      </li>)}</ul>
    </details>}
  </dialog>;
}
