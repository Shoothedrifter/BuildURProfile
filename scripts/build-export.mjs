import { build } from "vite";
import { mkdir, writeFile } from "node:fs/promises";

const result = await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": JSON.stringify("production") }, esbuild: { jsx: "automatic" }, build: {
  write: false, minify: true, lib: { entry: "apps/web/src/export-entry.tsx", formats: ["iife"], name: "BuildURProfileExport" }
} });
const bundle = (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === "chunk");
if (!bundle) throw new Error("Could not build export bundle");
await mkdir("apps/web/.export", { recursive: true });
await writeFile("apps/web/.export/showcase.js", bundle.code);
