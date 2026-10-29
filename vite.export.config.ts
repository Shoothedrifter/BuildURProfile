import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "apps/web",
  plugins: [react(), tailwindcss()],
  publicDir: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    outDir: "public/export",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: "src/export/standalone.tsx",
      name: "BuildURProfileStandalone",
      formats: ["iife"],
      fileName: () => "showcase.js",
      cssFileName: "showcase"
    }
  }
});
