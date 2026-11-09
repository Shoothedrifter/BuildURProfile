import { afterEach, expect, it, vi } from "vitest";
import { resumeApi } from "./resumeApi";

afterEach(() => vi.unstubAllGlobals());

it("uploads raw PDF with session CSRF and progress, then queues Agent parsing", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/session") return new Response(JSON.stringify({ csrfToken: "test-csrf" }));
    if (url === "/api/resumes/parse") return new Response(JSON.stringify({ resumeId: "resume-1", status: "QUEUED" }));
    throw new Error(`Unexpected request: ${url}`);
  }));
  class FakeXHR {
    static latest: FakeXHR;
    status = 201;
    responseText = JSON.stringify({ fileId: "file-1", pageCount: 1 });
    upload: { onprogress?: (event: ProgressEvent) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    headers: Record<string, string> = {};
    withCredentials = false;
    constructor() { FakeXHR.latest = this; }
    open(method: string, path: string) { expect([method, path]).toEqual(["POST", "/api/resumes/upload"]); }
    setRequestHeader(key: string, value: string) { this.headers[key] = value; }
    send(body: File) {
      expect(body.name).toBe("合成.pdf");
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
      this.onload?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const progress: number[] = [];
  const uploaded = await resumeApi.upload(new File(["%PDF-test"], "合成.pdf", { type: "application/pdf" }),
    (percent) => progress.push(percent));
  expect(uploaded.fileId).toBe("file-1");
  expect(progress).toEqual([50]);
  expect(FakeXHR.latest.headers["x-csrf-token"]).toBe("test-csrf");
  expect(FakeXHR.latest.headers["x-file-name"]).toBe(encodeURIComponent("合成.pdf"));
  expect(FakeXHR.latest.withCredentials).toBe(true);
  expect((await resumeApi.parse(uploaded.fileId)).status).toBe("QUEUED");
  expect(JSON.parse(String(calls.find((call) => call.url === "/api/resumes/parse")!.init!.body)).fileId)
    .toBe("file-1");
});

it("keeps PDF preview behind the session route", () => {
  expect(resumeApi.sourceUrl("resume-1")).toBe("/api/resumes/resume-1/source");
});

it("fetches trimmed source blocks for original-text cross-check", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method });
    if (url === "/api/session") return new Response(JSON.stringify({ csrfToken: "test-csrf" }));
    if (url === "/api/resumes/resume-1/blocks") {
      return new Response(JSON.stringify({ blocks: [
        { blockId: "block_1", page: 1, readingOrder: 0, text: "source text" }
      ] }));
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  const result = await resumeApi.blocks("resume-1");
  expect(result.blocks[0]).toEqual({ blockId: "block_1", page: 1, readingOrder: 0, text: "source text" });
  expect(calls.find((call) => call.url === "/api/resumes/resume-1/blocks")?.method).toBe("GET");
});

it("uploads a supplement image with its declared type and builds private image URLs", async () => {
  const calls: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, headers: init?.headers as Record<string, string> });
    if (url === "/api/session") return new Response(JSON.stringify({ csrfToken: "test-csrf" }));
    if (url === "/api/resumes/resume-1/images") {
      expect(init?.body).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ imageId: "img_1" }), { status: 201 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  const file = new File([new Uint8Array([1, 2, 3])], "work.png", { type: "image/png" });
  const result = await resumeApi.uploadImage("resume-1", file);
  expect(result.imageId).toBe("img_1");
  const upload = calls.find((call) => call.url === "/api/resumes/resume-1/images");
  expect(upload?.method).toBe("POST");
  expect(upload?.headers?.["content-type"]).toBe("image/png");
  expect(resumeApi.imageUrl("resume-1", "img_1")).toBe("/api/resumes/resume-1/images/img_1");
});

