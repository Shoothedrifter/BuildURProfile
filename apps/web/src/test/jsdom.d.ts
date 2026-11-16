declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: { runScripts?: "dangerously" | "outside-only"; pretendToBeVisual?: boolean });
    window: Window & typeof globalThis & { close(): void };
  }
}
