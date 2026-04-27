/**
 * Vitest configuration for client (React/jsdom) tests.
 *
 * Uses @vitejs/plugin-react-swc (SWC-based) instead of the Babel-based React
 * plugin because Vitest 4 uses OXC internally and the Babel plugin cannot
 * hook in before vite:import-analysis.  SWC integrates cleanly.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const root = path.resolve(__dirname, "client");

export default defineConfig({
  plugins: [react()],
  root,
  test: {
    name: "client",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["./src/__tests__/**/*.test.tsx", "./src/__tests__/**/*.test.ts"],
    alias: {
      "@": path.resolve(root, "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
