import { createHash, randomBytes, randomUUID } from "node:crypto";
import { assertDeliverableConfig, ServiceError } from "../../../../packages/contracts/src/validation.mjs";
import { transaction } from "./database.mjs";

const CALLBACK = "/api/github-pages/callback";
const AUTH_WINDOW = 10 * 60_000;
const BUILD_WINDOW = 15 * 60_000;
const CHECK_INTERVAL = 30_000;
const WRITE_WINDOW = 3 * 60_000;
const MAX_HTML = 25 * 1024 * 1024;
const API = "https://api.github.com";
const sha256 = (value) => createHash("sha256").update(value);
const gitBlobSha = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const encode = encodeURIComponent;

export function githubPagesConfig(env = process.env) {
  const clientId = env.GITHUB_PAGES_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_PAGES_CLIENT_SECRET?.trim();
  const rawOrigin = env.GITHUB_PAGES_ORIGIN?.trim();
  if (!clientId || !clientSecret || !rawOrigin) return null;
  try {
    const origin = new URL(rawOrigin);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
    if (origin.href !== `${origin.origin}/` || origin.username || origin.password ||
      (origin.protocol !== "https:" && !(loopback && origin.protocol === "http:" && env.PAYMENT_ENV !== "production"))) return null;
    return { clientId, clientSecret, origin: origin.origin };
  } catch {
    return null;
  }
}

class DeployError extends ServiceError {
  constructor(status, message, retryAt = 0) {
    super(status, message);
    this.retryAt = retryAt;
  }
}

function safeSiteUrl(value, record) {
  try {
    const url = new URL(value);
    const expectedPath = `/${record.repo.toLowerCase()}`;
    if (!["https:", "http:"].includes(url.protocol) || url.host !== `${record.github_login.toLowerCase()}.github.io` ||
      url.username || url.password || url.search || url.hash ||
      ![expectedPath, `${expectedPath}/`].includes(url.pathname.toLowerCase())) return null;
    url.protocol = "https:";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.href;
  } catch { /* GitHub may not have assigned a URL yet. */ }
  return null;
}

export function createGitHubPagesService({ db, service, config, renderHtml, fetcher = fetch, now = Date.now }) {
  if (!config) return null;
  const redirectUri = config.origin + CALLBACK;
  const read = db.prepare("SELECT * FROM github_deployments WHERE id=?");
  let rateLimitedUntil = 0;

  function projectForWrite(sessionId, projectId, revision) {
    const project = service.getProject(sessionId, projectId);
    if (!project.paid) throw new DeployError(402, "请先解锁当前项目的发布资格。");
    if (project.revision !== revision) throw new DeployError(409, "作品版本已变化，请确认当前版本后重新发起部署。");
    assertDeliverableConfig(project.config);
    return project;
  }

  function present(record) {
    const { id, project_id: projectId, repo, revision, github_login: login } = record;
    let { stage, error } = record;
    if (stage === "authorizing" && record.oauth_expires_at <= now()) {
      stage = "failed";
      error = "GitHub 授权已超时，请重新授权。";
    }
    if (stage === "uploading" && record.write_until <= now()) {
      stage = "failed";
      error = "上次提交中断，可以重新授权后继续。";
    }
    if (stage === "building" && record.build_started_at + BUILD_WINDOW <= now()) {
      stage = "waiting";
      error = "GitHub 尚未发布此版本。可以继续查询，或重新授权请求构建。";
    }
    return { id, projectId, repo, revision, stage, error,
      siteUrl: stage === "published" ? record.site_url : null,
      repoUrl: record.github_repo_id ? `https://github.com/${encode(login)}/${encode(repo)}` : null };
  }

  function start(sessionId, projectId, input) {
    const { repo: requested, revision, confirmed, deploymentId } = input ?? {};
    const repo = typeof requested === "string" ? requested.trim() : "";
    if (confirmed !== true || !Number.isSafeInteger(revision) || revision < 1 ||
      !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(repo) || /(?:\.github\.io|\.git)$/i.test(repo)) {
      throw new DeployError(400, "请输入有效的项目仓库名，并确认公开部署。");
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    return transaction(db, () => {
      projectForWrite(sessionId, projectId, revision);
      const existing = db.prepare("SELECT * FROM github_deployments WHERE project_id=? AND revision=? AND repo=?").get(projectId, revision, repo);
      if (deploymentId && existing?.id !== deploymentId) throw new DeployError(404, "部署记录不存在。");
      const id = existing?.id ?? randomUUID();
      if (existing && ["published", "building", "uploading"].includes(present(existing).stage)) {
        return { deployment: present(existing), authorizationUrl: null };
      }
      if (existing?.stage === "failed" && existing.next_check_at > now()) {
        throw new DeployError(429, "GitHub 请求受限，请稍后重试。");
      }
      if (existing) {
        db.prepare(`UPDATE github_deployments SET oauth_state_hash=?,oauth_verifier=?,oauth_expires_at=?,
          stage='authorizing',error=NULL,updated_at=? WHERE id=?`)
          .run(sha256(state).digest("hex"), verifier, now() + AUTH_WINDOW, now(), id);
      } else {
        db.prepare(`INSERT INTO github_deployments(id,project_id,revision,repo,stage,oauth_state_hash,oauth_verifier,oauth_expires_at,updated_at)
          VALUES(?,?,?,?,'authorizing',?,?,?,?)`)
          .run(id, projectId, revision, repo, sha256(state).digest("hex"), verifier, now() + AUTH_WINDOW, now());
      }
      const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
      authorizationUrl.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, scope: "repo",
        state, code_challenge: sha256(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
      return { deployment: present(read.get(id)), authorizationUrl: authorizationUrl.href };
    });
  }

  function recordFailure(id, error) {
    db.prepare("UPDATE github_deployments SET stage='failed',error=?,updated_at=?,write_until=0,next_check_at=? WHERE id=?")
      .run(error instanceof DeployError || (error instanceof ServiceError && error.status < 500)
        ? error.message : "部署未能完成，可以重新授权后继续。", now(), error.retryAt ?? 0, id);
  }

  async function request(url, options) {
    try {
      return await fetcher(url, { ...options, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new DeployError(502, "暂时无法连接 GitHub，可以重试。");
    }
  }

  async function github(path, { token, method = "GET", body, allowMissing = false } = {}) {
    const response = await request(API + path, { method, headers: {
      accept: "application/vnd.github+json", "x-github-api-version": "2026-03-10",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 404 && allowMissing) return null;
    if (response.status === 429 || (response.status === 403 &&
      (response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0"))) {
      const retryAfter = Number(response.headers.get("retry-after")) * 1000;
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      throw new DeployError(429, "GitHub 请求受限，请稍后重试。", Math.max(now() + 60_000, now() + retryAfter, reset));
    }
    if (!response.ok) {
      const message = {
        401: "GitHub 授权已失效，请重新授权。",
        403: "GitHub 拒绝了操作，请核对账号权限和 Pages 设置。",
        409: "GitHub 仓库内容已变化，请检查仓库后重试。",
        422: "GitHub 拒绝了请求，请检查仓库名、账号权限或 Pages 设置。"
      }[response.status];
      throw new DeployError(response.status, message ?? "GitHub 暂时无法完成请求，请稍后重试。");
    }
    return response.status === 204 ? null : await response.json();
  }

  async function exchange(code, verifier) {
    const response = await request("https://github.com/login/oauth/access_token", { method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
        code, redirect_uri: redirectUri, code_verifier: verifier }) });
    const data = await response.json();
    if (!response.ok || typeof data.access_token !== "string" || typeof data.scope !== "string" ||
      !data.scope.split(",").map(scope => scope.trim()).includes("repo")) {
      throw new DeployError(403, "GitHub 未授予部署所需的 repo 权限，请重新授权。");
    }
    return data.access_token;
  }

  async function deploy(record, sessionId, token) {
    const project = projectForWrite(sessionId, record.project_id, record.revision);
    const account = await github("/user", { token });
    if (!Number.isSafeInteger(account.id) || !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(account.login)) {
      throw new DeployError(403, "无法确认 GitHub 个人账户。");
    }
    if (record.github_user_id && record.github_user_id !== account.id) {
      throw new DeployError(409, "请使用上次授权的 GitHub 账号继续部署。");
    }

    const html = await renderHtml(sessionId, project.config);
    if (html.length > MAX_HTML) throw new DeployError(413, "作品 HTML 超过 25 MiB，请减少图片体积后再部署。");
    const hash = sha256(html).digest("hex");
    if (record.html_hash && record.html_hash !== hash) throw new DeployError(409, "本次打包内容已变化，请使用新仓库部署当前版本。");
    projectForWrite(sessionId, record.project_id, record.revision);
    db.prepare("UPDATE github_deployments SET github_user_id=?,github_login=?,html_hash=? WHERE id=?")
      .run(account.id, account.login, hash, record.id);

    const path = `/repos/${encode(account.login)}/${encode(record.repo)}`;
    const description = `BuildURProfile Showcase (${record.id})`;
    let repo = await github(path, { token, allowMissing: true });
    if (!repo && !record.github_repo_id) {
      repo = await github("/user/repos", { token, method: "POST",
        body: { name: record.repo, private: false, auto_init: true, description } });
    }
    if (!repo || repo.owner?.id !== account.id || repo.private !== false ||
      repo.name?.toLowerCase() !== record.repo.toLowerCase() ||
      (record.github_repo_id ? repo.id !== record.github_repo_id : repo.description !== description)) {
      throw new DeployError(409, "此仓库名已被占用或仓库已变更，请选择新仓库名。");
    }
    if (record.branch && record.branch !== repo.default_branch) throw new DeployError(409, "仓库默认分支已变化，请到 GitHub 检查仓库。");
    const branch = repo.default_branch;
    if (!Number.isSafeInteger(repo.id) || !branch) throw new DeployError(502, "GitHub 尚未准备好仓库默认分支，请重试。");
    db.prepare("UPDATE github_deployments SET github_repo_id=?,branch=? WHERE id=?").run(repo.id, branch, record.id);

    const files = [[".nojekyll", Buffer.from("\n")], ["index.html", html]];
    let htmlCommit = record.commit_sha;
    for (const [file, bytes] of files) {
      const endpoint = `${path}/contents/${file}`;
      const seen = await github(`${endpoint}?ref=${encode(branch)}`, { token, allowMissing: true });
      if (seen) {
        if (seen.type !== "file" || seen.sha !== gitBlobSha(bytes)) {
          throw new DeployError(409, "仓库中已有不同的页面文件，请到 GitHub 检查仓库。");
        }
      } else {
        if (record.commit_sha) throw new DeployError(409, "已提交的页面文件发生变化，请到 GitHub 检查仓库。");
        if (file === "index.html") projectForWrite(sessionId, record.project_id, record.revision);
        const written = await github(endpoint, { token, method: "PUT",
          body: { branch, message: `Publish Showcase: ${file}`, content: bytes.toString("base64") } });
        if (file === "index.html") htmlCommit = written.commit.sha;
      }
    }
    if (!htmlCommit || record.commit_sha) {
      const head = await github(`${path}/git/ref/heads/${encode(branch)}`, { token });
      if (record.commit_sha && head.object.sha !== record.commit_sha) {
        throw new DeployError(409, "仓库已有新的提交，请到 GitHub 检查发布分支。");
      }
      htmlCommit ??= head.object.sha;
    }
    db.prepare("UPDATE github_deployments SET commit_sha=? WHERE id=?").run(htmlCommit, record.id);
    const pages = await github(`${path}/pages`, { token, allowMissing: true });
    if (!pages) {
      await github(`${path}/pages`, { token, method: "POST", body: { build_type: "legacy", source: { branch, path: "/" } } });
    } else {
      if ((pages.build_type && pages.build_type !== "legacy") || pages.source?.branch !== branch || pages.source?.path !== "/") {
        throw new DeployError(409, "仓库的 Pages 发布源已经变化，请到 GitHub 检查设置。");
      }
      const build = await github(`${path}/pages/builds/latest`, { token, allowMissing: true });
      const timedOut = record.build_started_at && record.build_started_at + BUILD_WINDOW <= now();
      if (!build || build.commit !== htmlCommit || !["built", "building", "queued"].includes(build.status) ||
        (timedOut && build.status === "built")) {
        await github(`${path}/pages/builds`, { token, method: "POST" });
      }
    }
    const time = now();
    db.prepare(`UPDATE github_deployments SET stage='building',build_started_at=?,next_check_at=?,updated_at=?,write_until=0 WHERE id=?`)
      .run(time, time, time, record.id);
  }

  async function callback(sessionId, params) {
    const state = params.get("state");
    if (!state || !/^[a-zA-Z0-9_-]{43}$/.test(state)) throw new DeployError(400, "GitHub 授权请求无效，请重新发起部署。");
    const record = transaction(db, () => {
      const result = db.prepare(`SELECT d.* FROM github_deployments d JOIN projects p ON p.id=d.project_id
        WHERE d.oauth_state_hash=? AND p.owner_session_id=?`).get(sha256(state).digest("hex"), sessionId);
      if (!result) throw new DeployError(400, "GitHub 授权请求无效或已使用，请返回作品页查看部署状态。");
      db.prepare(`UPDATE github_deployments SET oauth_state_hash=NULL,oauth_verifier=NULL,oauth_expires_at=NULL,
        stage='uploading',write_until=?,updated_at=? WHERE id=?`).run(now() + WRITE_WINDOW, now(), result.id);
      return result;
    });
    try {
      if (record.oauth_expires_at <= now()) throw new DeployError(400, "GitHub 授权请求已过期，请重新授权。");
      const code = params.get("code");
      if (!code || params.has("error")) throw new DeployError(403, "GitHub 授权未完成，可以重新授权。");
      projectForWrite(sessionId, record.project_id, record.revision);
      await deploy(record, sessionId, await exchange(code, record.oauth_verifier));
    } catch (error) {
      recordFailure(record.id, error);
    }
    return `/?github_deployment=${encode(record.id)}#work`;
  }

  function list(sessionId, projectId) {
    service.getProject(sessionId, projectId);
    return db.prepare("SELECT * FROM github_deployments WHERE project_id=? ORDER BY updated_at DESC, rowid DESC")
      .all(projectId).map(present);
  }

  async function status(sessionId, id) {
    const record = read.get(id);
    if (!record) throw new DeployError(404, "部署记录不存在。");
    service.getProject(sessionId, record.project_id);
    const time = now();
    if (record.stage !== "building" || rateLimitedUntil > time || !db.prepare(`UPDATE github_deployments SET next_check_at=?
      WHERE id=? AND next_check_at<=? AND stage='building'`).run(time + CHECK_INTERVAL, id, time).changes) return present(record);
    const path = `/repos/${encode(record.github_login)}/${encode(record.repo)}`;
    try {
      const build = await github(`${path}/pages/builds/latest`, { allowMissing: true });
      if (build?.commit === record.commit_sha && ["errored", "failed"].includes(build.status)) {
        throw new DeployError(422, "GitHub Pages 构建失败，请查看仓库的 Actions 运行记录。");
      }
      if (build?.commit === record.commit_sha && build.status === "built") {
        const pages = await github(`${path}/pages`, { allowMissing: true });
        const site = safeSiteUrl(pages?.html_url, record);
        if (pages?.html_url && !site) throw new DeployError(422, "GitHub 已构建。此站点使用非默认 Pages 地址，请在仓库中核实发布结果。");
        if (site) {
          const response = await request(site, {});
          if (response.ok) {
            // Stream and cap the check in case the public URL no longer serves our file.
            const digest = sha256("");
            let length = 0;
            if (response.body) {
              for await (const chunk of response.body) {
                length += chunk.length;
                if (length > MAX_HTML) break;
                digest.update(chunk);
              }
            }
            if (length <= MAX_HTML && digest.digest("hex") === record.html_hash) {
              db.prepare(`UPDATE github_deployments SET stage='published',site_url=?,error=NULL,updated_at=?
                WHERE id=? AND stage='building' AND build_started_at=?`).run(site, now(), id, record.build_started_at);
            }
          } else {
            await response.body?.cancel();
          }
        }
      }
    } catch (error) {
      if (error instanceof DeployError && error.status === 429) {
        rateLimitedUntil = error.retryAt;
        db.prepare(`UPDATE github_deployments SET next_check_at=?
          WHERE id=? AND stage='building' AND build_started_at=?`).run(rateLimitedUntil, id, record.build_started_at);
      } else if (error instanceof DeployError && error.status === 422) {
        db.prepare(`UPDATE github_deployments SET stage='failed',error=?,updated_at=?,next_check_at=0
          WHERE id=? AND stage='building' AND build_started_at=?`).run(error.message, now(), id, record.build_started_at);
      }
    }
    return present(read.get(id));
  }

  function cleanup() {
    db.prepare(`UPDATE github_deployments SET oauth_state_hash=NULL,oauth_verifier=NULL,stage='failed',
      error='GitHub 授权已超时，请重新授权。' WHERE stage='authorizing' AND oauth_expires_at<=?`).run(now());
  }

  return { start, callback, status, list, cleanup };
}
