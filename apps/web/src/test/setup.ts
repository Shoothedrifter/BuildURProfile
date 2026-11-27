import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// Node 25 起在无有效 --localstorage-file 时，全局 localStorage 是缺少 setItem/clear 的空壳，
// 且 vitest 的 jsdom 环境不会用自己的 Storage 遮蔽它；统一替换为内存实现，保持浏览器语义
if (typeof globalThis.localStorage?.setItem !== "function") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() { return store.size; },
    key(index: number) { return [...store.keys()][index] ?? null; },
    getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
    setItem(key: string, value: string) { store.set(String(key), String(value)); },
    removeItem(key: string) { store.delete(String(key)); },
    clear() { store.clear(); }
  };
  for (const target of [globalThis, window]) {
    Object.defineProperty(target, "localStorage", { value: storage, configurable: true, writable: true });
  }
}
