import fs from "fs";
import path from "path";
import type { DetectResult } from "./types.js";

const KNOWN_ONLY = new Set([
  ".git",
  ".gitignore",
  ".DS_Store",
  ".env",
  ".env.local",
  "node_modules",
  ".local",
  ".cache",
  "data",
]);

export function detectProject(root: string): DetectResult {
  const sitesYml = path.join(root, "sites.yml");
  if (fs.existsSync(sitesYml)) {
    return { kind: "project", root };
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root).filter((n) => !n.startsWith(".git"));
  } catch {
    return { kind: "dirty", root, issues: ["Cannot read directory"] };
  }

  const meaningful = entries.filter((n) => !KNOWN_ONLY.has(n));
  if (meaningful.length === 0) {
    return { kind: "empty", root };
  }

  return {
    kind: "dirty",
    root,
    issues: [
      `Folder is not empty and has no sites.yml (found: ${meaningful.slice(0, 5).join(", ")}${meaningful.length > 5 ? "…" : ""}).`,
      "Use an empty folder to create a site, or cd into an existing Weblify project.",
    ],
  };
}
