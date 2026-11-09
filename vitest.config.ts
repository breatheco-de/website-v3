import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Many tests call process.chdir(), which worker threads do not support.
    pool: "forks",
    // A file's first test pays for cold server imports; under the full parallel run that can pass 5s.
    testTimeout: 20_000,
    include: [
      "server/**/*.test.ts",
      "scripts/**/*.test.ts",
      "mcp-server/**/*.test.ts",
      "shared/**/*.test.ts",
      "cli/**/*.test.ts",
      "client/src/**/*.test.tsx",
      "client/src/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@": path.resolve(import.meta.dirname, "client", "src"),
    },
  },
});
