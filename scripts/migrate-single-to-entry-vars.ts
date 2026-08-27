/**
 * Rewrite legacy `{{ single.* }}` → `{{ entry.* }}` in YAML / schema text.
 *
 * Usage (from repo root):
 *   npx tsx scripts/migrate-single-to-entry-vars.ts --dry-run
 *   npx tsx scripts/migrate-single-to-entry-vars.ts
 *
 * Covers: site_* folders, fixtures/, shared/component-registry/
 * Does not rename single.{locale}.yml files or touch type_single APIs.
 */

import * as fs from "fs";
import * as path from "path";
import { rewriteSingleVarsToEntryInString } from "../shared/entryTemplateVars";

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");

const TEXT_EXT = new Set([".yml", ".yaml", ".ts", ".md", ".txt"]);

function shouldSkipDir(name: string): boolean {
  return (
    name === "node_modules" ||
    name === ".git" ||
    name === "dist" ||
    name === ".cache" ||
    name === "coverage" ||
    name === "attached_assets"
  );
}

function collectRoots(): string[] {
  const roots: string[] = [];
  for (const name of fs.readdirSync(ROOT)) {
    if (name.startsWith("site_") && fs.statSync(path.join(ROOT, name)).isDirectory()) {
      roots.push(path.join(ROOT, name));
    }
  }
  const fixtures = path.join(ROOT, "fixtures");
  if (fs.existsSync(fixtures)) roots.push(fixtures);
  const sharedReg = path.join(ROOT, "shared", "component-registry");
  if (fs.existsSync(sharedReg)) roots.push(sharedReg);
  return roots;
}

function walkFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") && ent.name !== ".env.example") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (shouldSkipDir(ent.name)) continue;
      walkFiles(full, out);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (TEXT_EXT.has(ext)) out.push(full);
    }
  }
}

function fileNeedsRewrite(raw: string): boolean {
  return /\{\{\s*single\./.test(raw);
}

function main(): void {
  const roots = collectRoots();
  console.log("roots", roots.map((r) => path.relative(ROOT, r)));
  console.log("dry_run", DRY);

  let scanned = 0;
  let changed = 0;
  let tokens = 0;
  const changedPaths: string[] = [];

  for (const root of roots) {
    const files: string[] = [];
    walkFiles(root, files);
    for (const file of files) {
      scanned++;
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      if (!fileNeedsRewrite(raw)) continue;
      const beforeCount = (raw.match(/\{\{\s*single\./g) || []).length;
      const next = rewriteSingleVarsToEntryInString(raw);
      if (next === raw) continue;
      tokens += beforeCount;
      changed++;
      changedPaths.push(path.relative(ROOT, file));
      if (!DRY) {
        fs.writeFileSync(file, next, "utf-8");
      }
    }
  }

  console.log("scanned", scanned);
  console.log("changed_files", changed);
  console.log("tokens_rewritten", tokens);
  for (const p of changedPaths.slice(0, 80)) {
    console.log("  ", p);
  }
  if (changedPaths.length > 80) {
    console.log(`  ... +${changedPaths.length - 80} more`);
  }
}

main();
