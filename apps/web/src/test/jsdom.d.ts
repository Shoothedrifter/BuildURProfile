declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: {
      runScripts?: "dangerously" | "outside-only";
      pretendToBeVisual?: boolean;
      url?: string;
      beforeParse?: (window: JSDOM["window"]) => void;
    });
    window: Window & typeof globalThis & { close(): void };
  }
}
