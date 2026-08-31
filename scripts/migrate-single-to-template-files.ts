/**
 * Rename shared-layout shell files:
 *   single.{locale}.yml           → template.{locale}.yml
 *   single.{variant}.{locale}.yml → template.{variant}.{locale}.yml
 *   _common.single.yml            → _common.template.yml
 *
 * Prefer existing template.*; delete sibling single.* after copy.
 * Rewrites .sync-state.json keys for each site_* content root.
 *
 * Usage (from repo root):
 *   npx tsx scripts/migrate-single-to-template-files.ts --dry-run
 *   npx tsx scripts/migrate-single-to-template-files.ts
 */

import * as fs from "fs";
import * as path from "path";
import { migrateShellBasename } from "../shared/sharedLayoutPaths";
import { loadSyncState, saveSyncState, type SyncState } from "../server/sync-state";

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");

type Op = {
  contentRoot: string;
  fromRel: string;
  toRel: string;
  action: "rename" | "delete-legacy-keep-template";
};

function shouldSkipDir(name: string): boolean {
  return (
    name === "node_modules" ||
    name === ".git" ||
    name === "dist" ||
    name === ".cache" ||
    name === "coverage" ||
    name === "attached_assets" ||
    name === "images"
  );
}

/** Type-root dirs only: contentRoot/{folder}/shell.yml — not entry folders. */
function collectTypeRootDirs(contentRootAbs: string): string[] {
  if (!fs.existsSync(contentRootAbs)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(contentRootAbs, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".") || shouldSkipDir(ent.name)) continue;
    // Skip known non-type folders
    if (ent.name === "db" || ent.name === "menus" || ent.name === "component-registry") continue;
    out.push(path.join(contentRootAbs, ent.name));
  }
  return out;
}

function collectContentRoots(): Array<{ label: string; abs: string; isSite: boolean }> {
  const roots: Array<{ label: string; abs: string; isSite: boolean }> = [];
  for (const name of fs.readdirSync(ROOT)) {
    if (!name.startsWith("site_")) continue;
    const abs = path.join(ROOT, name);
    if (fs.statSync(abs).isDirectory()) {
      roots.push({ label: name, abs, isSite: true });
    }
  }
  const fixtures = path.join(ROOT, "fixtures");
  if (fs.existsSync(fixtures)) {
    roots.push({ label: "fixtures", abs: fixtures, isSite: false });
    // Also walk fixtures/* subdirs that look like mini content roots
    for (const ent of fs.readdirSync(fixtures, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const abs = path.join(fixtures, ent.name);
      roots.push({ label: `fixtures/${ent.name}`, abs, isSite: false });
    }
  }
  const ci = path.join(ROOT, "ci");
  if (fs.existsSync(ci)) {
    roots.push({ label: "ci", abs: ci, isSite: false });
  }
  return roots;
}

function planOpsForTypeDir(contentRootAbs: string, typeDir: string): Op[] {
  const ops: Op[] = [];
  if (!fs.existsSync(typeDir)) return ops;
  let names: string[];
  try {
    names = fs.readdirSync(typeDir);
  } catch {
    return ops;
  }
  for (const name of names) {
    const migrated = migrateShellBasename(name);
    if (!migrated) continue;
    const fromAbs = path.join(typeDir, name);
    if (!fs.statSync(fromAbs).isFile()) continue;
    const toAbs = path.join(typeDir, migrated);
    const fromRel = path.relative(ROOT, fromAbs).replace(/\\/g, "/");
    const toRel = path.relative(ROOT, toAbs).replace(/\\/g, "/");
    const contentRoot = path.relative(ROOT, contentRootAbs).replace(/\\/g, "/");
    if (fs.existsSync(toAbs)) {
      ops.push({ contentRoot, fromRel, toRel, action: "delete-legacy-keep-template" });
    } else {
      ops.push({ contentRoot, fromRel, toRel, action: "rename" });
    }
  }
  return ops;
}

function rewriteSyncState(
  contentRoot: string,
  renames: Array<{ fromRel: string; toRel: string }>,
  deletes: string[],
): { rewritten: number; deleted: number } {
  const state = loadSyncState(contentRoot) as SyncState;
  let rewritten = 0;
  let deleted = 0;
  const nextFiles: typeof state.files = { ...state.files };

  for (const { fromRel, toRel } of renames) {
    if (nextFiles[fromRel]) {
      nextFiles[toRel] = nextFiles[fromRel];
      delete nextFiles[fromRel];
      rewritten++;
    }
  }
  for (const fromRel of deletes) {
    if (nextFiles[fromRel]) {
      delete nextFiles[fromRel];
      deleted++;
    }
  }

  if (rewritten || deleted) {
    state.files = nextFiles;
    if (!DRY) saveSyncState(state, contentRoot);
  }
  return { rewritten, deleted };
}

function main(): void {
  const roots = collectContentRoots();
  console.log("roots", roots.map((r) => r.label));
  console.log("dry_run", DRY);

  const allOps: Op[] = [];
  for (const root of roots) {
    for (const typeDir of collectTypeRootDirs(root.abs)) {
      allOps.push(...planOpsForTypeDir(root.abs, typeDir));
    }
  }

  console.log("ops", allOps.length);
  for (const op of allOps) {
    console.log(op.action, op.fromRel, "→", op.toRel);
  }

  if (DRY) {
    console.log("dry-run complete; no writes");
    return;
  }

  const byRoot = new Map<string, Op[]>();
  for (const op of allOps) {
    const list = byRoot.get(op.contentRoot) ?? [];
    list.push(op);
    byRoot.set(op.contentRoot, list);
  }

  let renamed = 0;
  let deletedLegacy = 0;

  for (const [contentRoot, ops] of byRoot) {
    const renames: Array<{ fromRel: string; toRel: string }> = [];
    const deletes: string[] = [];

    for (const op of ops) {
      const fromAbs = path.join(ROOT, op.fromRel);
      const toAbs = path.join(ROOT, op.toRel);
      if (op.action === "rename") {
        fs.renameSync(fromAbs, toAbs);
        renames.push({ fromRel: op.fromRel, toRel: op.toRel });
        renamed++;
      } else {
        fs.unlinkSync(fromAbs);
        deletes.push(op.fromRel);
        deletedLegacy++;
      }
    }

    if (contentRoot.startsWith("site_")) {
      const sync = rewriteSyncState(contentRoot, renames, deletes);
      console.log("sync_state", contentRoot, sync);
    }
  }

  console.log("renamed", renamed);
  console.log("deleted_legacy", deletedLegacy);
  console.log("done");
}

main();
