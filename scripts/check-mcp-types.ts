#!/usr/bin/env tsx
/**
 * Scoped typecheck for mcp-server/** only.
 *
 * Compiling mcp-server pulls in server/** modules that still carry the
 * repo-wide tsc baseline. Those leaked diagnostics are expected and ignored
 * until a repo-wide ratchet exists — exit non-zero only when a diagnostic
 * path starts with "mcp-server/".
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = spawnSync(
  "npx",
  ["tsc", "-p", "tsconfig.mcp.json", "--noEmit", "--incremental", "false"],
  {
    cwd: root,
    encoding: "utf-8",
    shell: process.platform === "win32",
  },
);

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
const combined = `${stdout}${stderr}`;

if (combined.trim()) {
  process.stdout.write(combined);
}

const mcpErrorLines = combined
  .split("\n")
  .filter((line) => /^mcp-server\//.test(line) && line.includes("error TS"));

if (mcpErrorLines.length > 0) {
  console.error(
    `\n[check:mcp] ${mcpErrorLines.length} error(s) under mcp-server/ — failing.`,
  );
  process.exit(1);
}

if (result.error) {
  console.error("[check:mcp] Failed to run tsc:", result.error.message);
  process.exit(1);
}

console.log("[check:mcp] OK — no mcp-server/ TypeScript errors.");
process.exit(0);
