import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  test: {
    exclude: ["../launcher/**", "../api/**", "node_modules/**", ".next/**", "dist/**"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    testTimeout: 15000
  }
});
