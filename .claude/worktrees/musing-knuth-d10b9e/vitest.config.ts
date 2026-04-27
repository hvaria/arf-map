import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    projects: [
      {
        // Backend integration tests — real Node environment, real SQLite
        test: {
          name: "server",
          include: ["server/__tests__/**/*.test.ts"],
          environment: "node",
          pool: "forks",
          alias: {
            "@shared": path.resolve(__dirname, "shared"),
          },
        },
      },
      {
        // Frontend component tests — jsdom browser environment.
        // OXC (Vitest 4's default transformer) handles JSX automatically via
        // the `oxc.transform` option; no @vitejs/plugin-react needed here.
        oxc: {
          transform: {
            react: { runtime: "automatic" },
          },
        },
        test: {
          name: "client",
          include: ["client/src/__tests__/**/*.test.tsx", "client/src/__tests__/**/*.test.ts"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./client/src/__tests__/setup.ts"],
          alias: {
            "@": path.resolve(__dirname, "client/src"),
            "@shared": path.resolve(__dirname, "shared"),
          },
        },
      },
    ],
  },
});
