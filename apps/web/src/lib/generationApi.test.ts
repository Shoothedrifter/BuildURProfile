import { beforeEach, expect, it, vi } from "vitest";
import type { DesignConfig } from "../../../../packages/contracts/src/config";
import rawConfig from "../demo/config.json";
import { generationApi } from "./generationApi";

beforeEach(() => {
  sessionStorage.clear();
  generationApi.clearSavedGeneration();
  vi.unstubAllGlobals();
});

it("does not enqueue or retain a task after the user removes a pending portrait", async () => {
  let finishUpload!: (response: Response) => void;
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn((path: string) => {
    calls.push(path);
    if (path === "/api/session") return Promise.resolve(new Response(JSON.stringify({ csrfToken: "csrf" }), { status: 200 }));
    if (path === "/api/portraits") return new Promise<Response>((resolve) => { finishUpload = resolve; });
    throw new Error(`Unexpected request: ${path}`);
  }));
  const pending = generationApi.generateAvatar("data:image/png;base64,aGVsbG8=", "retro-flat-anime-head", rawConfig as DesignConfig);
  await vi.waitFor(() => expect(calls).toContain("/api/portraits"));
  generationApi.clearSavedGeneration();
  finishUpload(new Response(JSON.stringify({ id: "portrait-id" }), { status: 201 }));
  await expect(pending).rejects.toThrow(/取消/);
  expect(calls).not.toContain("/api/generations");
  expect(sessionStorage.getItem("burp-avatar-task")).toBeNull();
});

it("queues a no-photo portfolio through the generation API and restores its config", async () => {
  const calls: string[] = [];
  let submitted: Record<string, unknown> | undefined;
  const config = rawConfig as DesignConfig;
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    calls.push(path);
    if (path === "/api/session") return new Response(JSON.stringify({ csrfToken: "csrf" }), { status: 200 });
    if (path === "/api/generations") {
      submitted = JSON.parse(options?.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "task-1", status: "QUEUED" }), { status: 201 });
    }
    if (path === "/api/generations/task-1") return new Response(JSON.stringify({ status: "SUCCEEDED", config }), { status: 200 });
    throw new Error(`Unexpected request: ${path}`);
  }));
  const result = await generationApi.generatePortfolio({ role: "ui-ux-designer", answers: { "e-presence": 0 },
    content: config.content });
  expect(result).toEqual({ config });
  expect(submitted).toMatchObject({ brief: { role: "ui-ux-designer", answers: { "e-presence": 0 } },
    portraitAssetId: null, styleId: null });
  expect(calls).not.toContain("/api/portraits");
  expect(sessionStorage.getItem("burp-avatar-task")).toBe("task-1");
  expect(await generationApi.resumeGeneration()).toEqual({ config });
});

it("cancels a saved queued generation through the owner API", async () => {
  const calls: string[] = [];
  sessionStorage.setItem("burp-avatar-task", "task-queued");
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    calls.push(path);
    if (path === "/api/session") return new Response(JSON.stringify({ csrfToken: "csrf" }), { status: 200 });
    if (path === "/api/generations/task-queued/cancel") {
      return new Response(JSON.stringify({ status: "CANCELLED" }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
  expect(await generationApi.cancelSavedGeneration()).toEqual({ status: "CANCELLED" });
  expect(calls).toContain("/api/generations/task-queued/cancel");
  expect(sessionStorage.getItem("burp-avatar-task")).toBeNull();
});

it("cancels a task queued after the user changed input during the POST", async () => {
  const calls: string[] = [];
  let finishEnqueue!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((path: string) => {
    calls.push(path);
    if (path === "/api/session") return Promise.resolve(new Response(JSON.stringify({ csrfToken: "csrf" }), { status: 200 }));
    if (path === "/api/generations") return new Promise<Response>((resolve) => { finishEnqueue = resolve; });
    if (path === "/api/generations/task-late/cancel") {
      return Promise.resolve(new Response(JSON.stringify({ status: "CANCELLED" }), { status: 200 }));
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
  const config = rawConfig as DesignConfig;
  const pending = generationApi.generatePortfolio({ role: "ui-ux-designer", answers: { "e-presence": 0 }, content: config.content });
  await vi.waitFor(() => expect(calls).toContain("/api/generations"));
  generationApi.clearSavedGeneration();
  finishEnqueue(new Response(JSON.stringify({ id: "task-late", status: "QUEUED" }), { status: 201 }));
  await expect(pending).rejects.toThrow(/取消/);
  expect(calls).toContain("/api/generations/task-late/cancel");
});

it('submits only saved draft identity and restores its server-created project', async () => {
  let submitted: Record<string,unknown> | undefined;
  vi.stubGlobal('fetch',vi.fn(async (path:string,options?:RequestInit)=>{
    if(path==='/api/session')return new Response(JSON.stringify({csrfToken:'csrf'}));
    if(path==='/api/generations'){submitted=JSON.parse(options?.body as string);return new Response(JSON.stringify({id:'v3-task'}));}
    if(path==='/api/generations/v3-task')return new Response(JSON.stringify({status:'SUCCEEDED',config:rawConfig,projectId:'server-project'}));
    if(path==='/api/projects/server-project')return new Response(JSON.stringify({id:'server-project',config:rawConfig,paid:false}));
    throw new Error('Unexpected route');
  }));
  const result=await generationApi.generatePortfolio({resumeId:'synthetic-resume',revision:4,role:'ui-ux-designer',answers:{'e-presence':1}});
  expect(submitted).toMatchObject({resumeId:'synthetic-resume',revision:4});
  expect(submitted).not.toHaveProperty('brief');expect(submitted).not.toHaveProperty('content');
  expect(result.projectId).toBe('server-project');
  expect(await generationApi.resumeGeneration()).toBeNull();
});

it('restores the current saved project and drops the obsolete successful-task pointer', async () => {
  sessionStorage.setItem('burp-avatar-task','saved-task');
  const edited={...rawConfig,content:{...rawConfig.content,profile:{...rawConfig.content.profile,name:'已保存的新姓名'}}};
  vi.stubGlobal('fetch',vi.fn(async (path:string)=>{
    if(path==='/api/session')return new Response(JSON.stringify({csrfToken:'csrf'}));
    if(path==='/api/generations/saved-task')return new Response(JSON.stringify({status:'SUCCEEDED',config:rawConfig,projectId:'saved-project'}));
    if(path==='/api/projects/saved-project')return new Response(JSON.stringify({id:'saved-project',config:edited,paid:true}));
    throw new Error('Unexpected route');
  }));
  const result=await generationApi.resumeGeneration();
  expect(result?.config.content.profile.name).toBe('已保存的新姓名');
  expect(result).toMatchObject({projectId:'saved-project',projectPaid:true});
  expect(sessionStorage.getItem('burp-avatar-task')).toBeNull();
});
