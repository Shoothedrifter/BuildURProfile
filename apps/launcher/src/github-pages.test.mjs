import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { openDatabase } from "../../web/src/server/database.mjs";
import { createPaymentService } from "../../web/src/server/service.mjs";
import { createRequestHandler, dispatchWebRequest } from "../../web/src/server/http.mjs";
import { githubPagesConfig } from "../../web/src/server/github-pages.mjs";

const portfolio = JSON.parse(readFileSync(new URL("../../web/src/demo/config.json", import.meta.url)));
const origin = "https://app.example.test";
const githubConfig = { clientId: "synthetic-client", clientSecret: "synthetic-secret", origin };
const merchant = { mode: "sandbox", priceFen: 299, appId: "sandbox-app", sellerId: "seller", sellerEmail: null, publicBaseUrl: origin };
const repoPath = "/repos/test-owner/portfolio";
const siteUrl = "https://test-owner.github.io/portfolio/";
const commitSha = "2".repeat(40);
const digest = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const gitBlobSha = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

function fakeGitHub() {
  const files = new Map();
  const remote = { repo: null, pages: null, loseCreationResponse: false, loseHtmlResponse: false,
    refuseUntil: null, build: null, site: null, challenge: null, requests: [], files, account: { id: 42, login: "test-owner" } };
  remote.fetch = async (raw, { method = "GET", headers = {}, body, redirect }) => {
    const url = new URL(raw);
    const path = url.pathname;
    remote.requests.push({ method, path });
    assert.equal(redirect, "error");
    if (url.hostname === "github.com") {
      assert.equal(path, "/login/oauth/access_token");
      assert.equal(body.get("client_secret"), githubConfig.clientSecret);
      assert.equal(body.get("redirect_uri"), origin + "/api/github-pages/callback");
      assert.equal(digest(body.get("code_verifier")), remote.challenge);
      return Response.json({ scope: "repo", access_token: "synthetic-token" });
    }
    if (url.href === siteUrl) {
      assert.equal(headers.authorization, undefined);
      return new Response(remote.site, { status: remote.site ? 200 : 404 });
    }
    assert.equal(url.hostname, "api.github.com");
    const value = body ? JSON.parse(body) : null;
    const missing = () => Response.json({}, { status: 404 });
    if (path === "/user") return Response.json(remote.account);
    if (path === "/user/repos") {
      assert.equal(method, "POST");
      assert.equal(headers.authorization, "Bearer synthetic-token");
      assert.equal(value.private, false);
      assert.equal(value.auto_init, true);
      remote.repo = { id: 101, name: "portfolio", private: false, owner: remote.account,
        description: value.description, default_branch: "custom-default" };
      if (remote.loseCreationResponse) throw new Error("connection lost");
      return Response.json(remote.repo, { status: 201 });
    }
    if (path === repoPath) return remote.repo ? Response.json(remote.repo) : missing();
    if (path.startsWith(repoPath + "/contents/")) {
      const name = path.split("/").at(-1);
      if (method === "GET") {
        assert.equal(url.searchParams.get("ref"), "custom-default");
        return files.has(name) ? Response.json({ type: "file", sha: gitBlobSha(files.get(name)) }) : missing();
      }
      assert.equal(value.branch, "custom-default");
      assert.equal(files.has(name), false);
      files.set(name, Buffer.from(value.content, "base64"));
      if (name === "index.html" && remote.loseHtmlResponse) throw new Error("connection lost");
      return Response.json({ commit: { sha: commitSha } }, { status: 201 });
    }
    if (path === repoPath + "/git/ref/heads/custom-default") return Response.json({ object: { sha: commitSha } });
    if (path === repoPath + "/pages") {
      if (method === "POST") {
        assert.deepEqual(value, { build_type: "legacy", source: { branch: "custom-default", path: "/" } });
        assert.deepEqual([...files.keys()], [".nojekyll", "index.html"]);
        remote.pages = { source: value.source, html_url: siteUrl.replace(/^https:/, "http:").slice(0, -1) };
      }
      return remote.pages ? Response.json(remote.pages) : missing();
    }
    if (path === repoPath + "/pages/builds/latest") {
      if (remote.refuseUntil) return Response.json({}, { status: 429, headers: { "retry-after": remote.refuseUntil } });
      return remote.build ? Response.json(remote.build) : missing();
    }
    if (path === repoPath + "/pages/builds" && method === "POST") return Response.json({ status: "queued" });
    if (path === repoPath + "/deployments") {
      assert.equal(headers.authorization, undefined);
      assert.equal(url.searchParams.get("environment"), "github-pages");
      assert.equal(url.searchParams.get("per_page"), "1");
      return Response.json(remote.deployment ? [remote.deployment] : []);
    }
    if (path === repoPath + "/deployments/50/statuses") {
      assert.equal(headers.authorization, undefined);
      assert.equal(url.searchParams.get("per_page"), "1");
      return Response.json(remote.deploymentStatus ? [remote.deploymentStatus] : []);
    }
    assert.fail(`Unexpected GitHub request: ${method} ${path}`);
  };
  return remote;
}

async function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let time = 1_000_000;
  const remote = fakeGitHub();
  const gateway = { verifyNotify: () => true, pagePay: async () => "<form></form>" };
  const service = createPaymentService(db, { gateway, paymentConfig: merchant, now: () => time });
  const handler = createRequestHandler({ db, service, secret: Buffer.alloc(32, 5), githubConfig, githubFetch: remote.fetch,
    githubNow: () => time, paymentConfig: merchant, priceFen: merchant.priceFen });
  async function connect() {
    const session = await dispatchWebRequest(new Request(origin + "/api/session"), handler);
    const cookie = session.headers.get("set-cookie").split(";")[0];
    const { csrfToken } = await session.json();
    return (path, { method = "GET", body, csrf = true } = {}) => dispatchWebRequest(new Request(origin + path, {
      method, headers: { cookie, ...(csrf ? { "x-csrf-token": csrfToken } : {}), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), handler);
  }
  const owner = await connect();
  const outsider = await connect();
  const project = await (await owner("/api/projects", { method: "POST", body: { config: portfolio } })).json();
  const path = `/api/projects/${project.id}/github-pages`;
  function start(body = {}, send = owner) {
    return send(path, { method: "POST", body: { repo: "portfolio", revision: project.revision, confirmed: true, ...body } });
  }
  async function pay() {
    const response = await owner(`/api/projects/${project.id}/checkout`, { method: "POST", body: { action: "github-pages" } });
    assert.equal(response.status, 200);
    const order = await response.json();
    assert.equal(order.amountYuan, "2.99");
    await service.notify({ out_trade_no: order.outTradeNo, total_amount: "2.99", app_id: "sandbox-app",
      seller_id: "seller", trade_status: "TRADE_SUCCESS", trade_no: "synthetic-alipay" });
    return order;
  }
  async function prepare(deploymentId) {
    const response = await start(deploymentId ? { deploymentId } : {});
    assert.equal(response.status, 200);
    const { deployment, authorizationUrl } = await response.json();
    const url = new URL(authorizationUrl);
    assert.equal(url.hostname, "github.com");
    assert.equal(url.searchParams.get("scope"), "repo");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    remote.challenge = url.searchParams.get("code_challenge");
    return { id: deployment.id, callbackPath: `/api/github-pages/callback?state=${url.searchParams.get("state")}` };
  }
  return { db, remote, owner, outsider, project, path, start, prepare, pay,
    advance: ms => { time += ms; }, status: async id => (await owner(`/api/github-pages/${id}`)).json() };
}

test("GitHub Pages config requires credentials and an HTTPS production origin", () => {
  const env = { GITHUB_PAGES_CLIENT_ID: "test-id", GITHUB_PAGES_CLIENT_SECRET: "test-secret", GITHUB_PAGES_ORIGIN: "http://127.0.0.1:5173" };
  assert.equal(githubPagesConfig({ ...env, PAYMENT_ENV: "production" }), null);
  assert.equal(githubPagesConfig({ ...env, GITHUB_PAGES_ORIGIN: "https://app.example.test/path" }), null);
  assert.equal(githubPagesConfig(env).origin, "http://127.0.0.1:5173");
});

test("paid project publishes only after the expected GH build and HTML are public", async t => {
  const { db, remote, owner, outsider, project, path, start, prepare, pay, status, advance } = await fixture(t);
  assert.equal((await owner("/api/offer")).status, 200);
  assert.equal((await owner(path, { method: "POST", csrf: false, body: {} })).status, 403);
  assert.equal((await start({}, outsider)).status, 404);
  assert.equal((await start({ confirmed: false })).status, 400);
  assert.equal((await start()).status, 402);
  const order = await pay();
  assert.equal((await (await owner(`/api/projects/${project.id}`)).json()).pendingAction, "github-pages");
  const task = await prepare();
  const callback = task.callbackPath + "&code=synthetic-code";
  assert.equal((await outsider(callback)).status, 400);
  const response = await owner(callback);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `/?github_deployment=${task.id}#work`);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await owner(callback)).status, 400);
  assert.equal((await outsider(`/api/github-pages/${task.id}`)).status, 404);
  assert.equal((await outsider(path)).status, 404);
  assert.equal(db.prepare("SELECT oauth_state_hash,oauth_verifier FROM github_deployments").get().oauth_verifier, null);
  assert.match(remote.files.get("index.html").toString(), /<!doctype html>/);
  assert.doesNotMatch(remote.files.get("index.html").toString(), /synthetic-token|synthetic-secret/);
  remote.build = { commit: "wrong-commit", status: "built" };
  assert.equal((await status(task.id)).siteUrl, null);
  advance(30_000);
  remote.build = { commit: commitSha, status: "built" };
  remote.site = "stale HTML";
  assert.equal((await status(task.id)).stage, "building");
  advance(30_000);
  remote.site = remote.files.get("index.html");
  assert.equal((await status(task.id)).siteUrl, siteUrl);
  assert.equal((await (await start()).json()).authorizationUrl, null);
  assert.equal(db.prepare("SELECT count(*) AS count FROM shares").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM orders").get().count, 1);
  assert.equal(db.prepare("SELECT status FROM orders WHERE out_trade_no=?").get(order.outTradeNo).status, "PAID");
});

test("a waiting project recovers from a Pages build 404 using the current GitHub deployment", async t => {
  const { remote, owner, prepare, pay, status, advance } = await fixture(t);
  await pay();
  const task = await prepare();
  await owner(task.callbackPath + "&code=synthetic-code");
  advance(15 * 60_000);
  remote.deployment = { id: 50, sha: "wrong-commit", environment: "github-pages" };
  remote.deploymentStatus = { state: "success", environment_url: siteUrl };
  assert.equal((await status(task.id)).stage, "waiting");
  assert.ok(!remote.requests.some(call => call.path.endsWith("/statuses")));
  advance(30_000);
  remote.deployment.sha = commitSha;
  remote.deploymentStatus.state = "in_progress";
  assert.equal((await status(task.id)).stage, "waiting");
  advance(30_000);
  remote.deploymentStatus = { state: "success", environment_url: "https://test-owner.github.io/other/" };
  assert.equal((await status(task.id)).stage, "waiting");
  advance(30_000);
  remote.deploymentStatus.environment_url = siteUrl;
  const published = await status(task.id);
  assert.equal(published.stage, "published");
  assert.equal(published.siteUrl, siteUrl);
});

test("authorization stops on denial, expiry and edits without contacting GitHub", async t => {
  const { remote, owner, project, prepare, pay, status, advance } = await fixture(t);
  await pay();
  const denied = await prepare();
  assert.equal((await owner(denied.callbackPath + "&error=access_denied")).status, 303);
  assert.match((await status(denied.id)).error, /未完成/);
  const expired = await prepare();
  advance(10 * 60_000);
  assert.equal((await owner(expired.callbackPath + "&code=synthetic-code")).status, 303);
  assert.match((await status(expired.id)).error, /已过期/);
  const changed = await prepare();
  const config = { ...portfolio, content: { ...portfolio.content, profile: { ...portfolio.content.profile, name: "修改后的名称" } } };
  assert.equal((await owner(`/api/projects/${project.id}`, { method: "PUT", body: { config } })).status, 200);
  assert.equal((await owner(changed.callbackPath + "&code=synthetic-code")).status, 303);
  assert.match((await status(changed.id)).error, /版本已变化/);
  assert.deepEqual(remote.requests, []);
});

test("recovers ambiguous repo and file writes without a duplicate or overwrite", async t => {
  const { remote, owner, prepare, pay, status } = await fixture(t);
  await pay();
  remote.loseCreationResponse = true;
  const first = await prepare();
  await owner(first.callbackPath + "&code=synthetic-code");
  assert.equal((await status(first.id)).stage, "failed");
  remote.loseHtmlResponse = true;
  const second = await prepare(first.id);
  await owner(second.callbackPath + "&code=synthetic-code");
  assert.equal((await status(second.id)).stage, "failed");
  const third = await prepare(first.id);
  await owner(third.callbackPath + "&code=synthetic-code");
  assert.equal((await status(third.id)).stage, "building");
  assert.equal(remote.requests.filter(({ method, path }) => method === "POST" && path === "/user/repos").length, 1);
  assert.equal(remote.requests.filter(({ method }) => method === "PUT").length, 2);
});

test("a preexisting same-name repository is never written", async t => {
  const { remote, owner, prepare, pay, status } = await fixture(t);
  await pay();
  remote.repo = { id: 301, name: "portfolio", private: false, owner: remote.account, description: "Existing", default_branch: "main" };
  const task = await prepare();
  await owner(task.callbackPath + "&code=synthetic-code");
  assert.match((await status(task.id)).error, /占用/);
  assert.equal(remote.files.size, 0);
});

test("Pages rate limiting delays checks and a failed matching build can be requested again", async t => {
  const { remote, owner, prepare, pay, status, advance } = await fixture(t);
  await pay();
  const task = await prepare();
  await owner(task.callbackPath + "&code=synthetic-code");
  remote.refuseUntil = "90";
  await status(task.id);
  const count = remote.requests.length;
  advance(31_000);
  await status(task.id);
  assert.equal(remote.requests.length, count);
  advance(60_000);
  remote.refuseUntil = null;
  remote.build = { status: "errored", commit: commitSha };
  assert.equal((await status(task.id)).stage, "failed");
  const retry = await prepare(task.id);
  await owner(retry.callbackPath + "&code=synthetic-code");
  assert.ok(remote.requests.some(call => call.method === "POST" && call.path === repoPath + "/pages/builds"));
});
