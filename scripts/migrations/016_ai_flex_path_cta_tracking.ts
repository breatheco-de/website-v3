#!/usr/bin/env tsx
/**
 * @migration 016_ai_flex_path_cta_tracking
 * @description Sets missing CTA tracking on AI Flex Path buttons (payment links → add_to_cart,
 *   everything else → none) so the Ecommerce tab and enrollment-click goals can count them.
 *   Does not overwrite tracking that is already set. Pushes changed content files to the content repo,
 *   then notifies the live server (site_bulk_synced) so ContentIndex and HTML cache rebuild —
 *   without that, production keeps serving stale cached pages. Re-run when YAML is already done
 *   to refresh live pages only.
 * @scope site
 * @dry-run
 * @production-only
 * @timeout 600
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/016_ai_flex_path_cta_tracking.ts [--dry-run]
 */

import { config as loadDotenv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

loadDotenv({ quiet: true });

import {
  escapeTemplateVars,
  unescapeObjectVars,
  escapeObjectVars,
  unescapeYamlDump,
} from "../../shared/templateVars";
import { inferCtaTrackingFromUrl, isCtaTrackingValue } from "../../shared/component-behaviors";
import { resolveBoundCtaPaths } from "../../shared/validateCtaTracking";
import { loadAllFieldEditors } from "../../server/component-registry";
import { markFileAsModified, updateFileAfterCommit } from "../../server/sync-state";
import { commitAndPush, getConflictInfo } from "../../server/github";
import { emitSiteBulkSynced } from "../../server/content-events";

const dryRun = process.argv.includes("--dry-run");
const contentRoot = process.env.MIGRATION_SITE?.trim() || "site_4geeks-com";
const COMPONENT = "ai_flex_path";
const MIGRATION_AUTHOR = "migration:016_ai_flex_path_cta_tracking";

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
console.log("contentRoot", contentRoot);

function safeYamlLoad(raw: string): Record<string, unknown> | null {
  const { escaped, map } = escapeTemplateVars(raw);
  const loaded = yaml.load(escaped);
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return null;
  return unescapeObjectVars(loaded, map) as Record<string, unknown>;
}

function safeYamlDump(obj: unknown): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  return unescapeYamlDump(dumped, map);
}

function walkYaml(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "component-registry" || entry.name === "node_modules") continue;
      out.push(...walkYaml(full));
    } else if (/\.ya?ml$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function getByPath(obj: unknown, pathStr: string): unknown {
  const parts = pathStr.replace(/\[\]/g, ".$").split(".").filter(Boolean);
  const walk = (current: unknown, rem: string[]): unknown => {
    if (rem.length === 0) return current;
    const [head, ...rest] = rem;
    if (head === "$") {
      if (!Array.isArray(current)) return undefined;
      return current.map((item) => walk(item, rest));
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return walk((current as Record<string, unknown>)[head!], rest);
  };
  return walk(obj, parts);
}

function visitCtas(value: unknown, mutate: (cta: Record<string, unknown>) => boolean): boolean {
  let changed = false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (visitCtas(item, mutate)) changed = true;
    }
    return changed;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.url === "string" && typeof o.text === "string") {
      if (mutate(o)) changed = true;
      return changed;
    }
    for (const v of Object.values(o)) {
      if (visitCtas(v, mutate)) changed = true;
    }
  }
  return changed;
}

/** Migrations run in a child process — markFileAsModified listeners stay in that process.
 *  Emit into the shared event outbox so the live server refreshes ContentIndex + HTML cache. */
function notifyLiveServer(files: string[]): void {
  if (files.length === 0) return;
  emitSiteBulkSynced(contentRoot, files, {
    author: MIGRATION_AUTHOR,
    actor: { type: "system", source: "data-migration" },
  });
  console.log("emitted site_bulk_synced", files.length);
}

const root = path.join(process.cwd(), contentRoot);
if (!fs.existsSync(root)) {
  console.error("Missing content root", root);
  process.exit(1);
}

const fieldEditors = loadAllFieldEditors(contentRoot);
const editors = fieldEditors[COMPONENT] ?? {};
if (Object.keys(editors).length === 0) {
  console.warn("No field-editors for ai_flex_path — nothing to do");
  process.exit(0);
}

let filesChanged = 0;
let ctasUpdated = 0;
const changedRelPaths: string[] = [];
const aiFlexRelPaths: string[] = [];

for (const filePath of walkYaml(root)) {
  let parsed: Record<string, unknown>;
  try {
    const loaded = safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
    if (!loaded) continue;
    parsed = loaded;
  } catch {
    continue;
  }

  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  let fileChanged = false;
  let hasAiFlex = false;

  for (const section of sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    const sec = section as Record<string, unknown>;
    if (String(sec.type ?? "") !== COMPONENT) continue;
    hasAiFlex = true;
    const variant = typeof sec.variant === "string" ? sec.variant : undefined;
    const ctaPaths = resolveBoundCtaPaths(editors, variant);

    for (const ctaPath of ctaPaths) {
      const raw = getByPath(sec, ctaPath);
      if (raw === undefined) continue;
      const changed = visitCtas(raw, (cta) => {
        if (isCtaTrackingValue(cta.tracking)) return false;
        cta.tracking = inferCtaTrackingFromUrl(cta.url);
        ctasUpdated++;
        return true;
      });
      if (changed) fileChanged = true;
    }
  }

  if (!hasAiFlex) continue;

  const rel = path.relative(process.cwd(), filePath).split(path.sep).join("/");
  aiFlexRelPaths.push(rel);

  if (fileChanged) {
    filesChanged++;
    changedRelPaths.push(rel);
    console.log(`${dryRun ? "[dry-run] " : ""}updated ${rel}`);
    if (!dryRun) {
      fs.writeFileSync(filePath, safeYamlDump(parsed), "utf-8");
    }
  }
}

console.log(`Done. files=${filesChanged} ctas=${ctasUpdated} aiFlexFiles=${aiFlexRelPaths.length} dryRun=${dryRun}`);

if (dryRun) {
  process.exit(0);
}

if (changedRelPaths.length > 0) {
  for (const f of changedRelPaths) markFileAsModified(f, MIGRATION_AUTHOR, undefined, contentRoot);

  const conflicts = await getConflictInfo({ contentRoot });
  const remoteTouched: string[] = (conflicts as { changedFiles?: string[] })?.changedFiles ?? [];
  const overlap = changedRelPaths.filter((f) => remoteTouched.includes(f));
  if (overlap.length) {
    console.error("Resolve overlap before push:", overlap.join(", "));
    process.exit(1);
  }

  const result = await commitAndPush("Set AI Flex Path CTA tracking for Ecommerce inventory", {
    files: changedRelPaths,
    contentRoot,
  });
  const sha = result.commitHash;
  if (!sha) {
    console.error("Content push failed:", result.error);
    process.exit(1);
  }
  console.log("commitSha", sha);
  for (const f of changedRelPaths) updateFileAfterCommit(f, sha, contentRoot);
  notifyLiveServer(changedRelPaths);
  process.exit(0);
}

// Idempotent re-run: YAML already has tracking, but production may still be on a stale HTML cache.
notifyLiveServer(aiFlexRelPaths);
process.exit(0);
