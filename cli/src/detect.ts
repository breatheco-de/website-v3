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

/** Directories named `site_*` under the project root (sorted). */
export function listSiteFolders(root: string): string[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((n) => {
      if (!n.startsWith("site_")) return false;
      try {
        return fs.statSync(path.join(root, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
}

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

  const siteFolders = listSiteFolders(root);
  if (siteFolders.length > 0) {
    return { kind: "needs_sites_yml", root, siteFolders };
  }

  const meaningful = entries.filter((n) => !KNOWN_ONLY.has(n));
  if (meaningful.length === 0) {
    return { kind: "empty", root };
  }

  return {
    kind: "dirty",
    root,
    issues: [
      `Folder is not empty and has no sites.yml or site_* content (found: ${meaningful.slice(0, 5).join(", ")}${meaningful.length > 5 ? "…" : ""}).`,
      "Use an empty folder to create a site, add a site_* folder, or cd into an existing Caxton project.",
    ],
  };
}
