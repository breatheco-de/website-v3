import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
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
