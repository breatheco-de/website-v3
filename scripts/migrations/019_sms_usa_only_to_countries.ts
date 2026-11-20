#!/usr/bin/env tsx
/**
 * @migration 019_sms_usa_only_to_countries
 * @description Replaces the old SMS “US-only” checkbox flag with country lists: when a form or
 *   conversion event still has sms_usa_only: true and no sms_countries list, it becomes
 *   sms_countries: [US] with sms_countries_mode: include, and the old flag is removed. Lines with
 *   sms_usa_only: false are dropped (legacy no longer needed). Live US-only SMS behavior stays the
 *   same. Changed YAML is pushed to the content repo.
 * @scope site
 * @dry-run
 * @production-only
 *
 * Idempotent: a second run finds nothing to rewrite.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/019_sms_usa_only_to_countries.ts [--dry-run]
 */

import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const siteFilter = process.env.MIGRATION_SITE?.trim() || undefined;

/** Line-oriented rewrite so we do not reformat whole YAML files. */
export function rewriteSmsUsaOnlyText(text: string): { text: string; changed: boolean } {
  if (!text.includes("sms_usa_only")) return { text, changed: false };
  const lines = text.split("\n");
  const out: string[] = [];
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trueMatch = /^( *)sms_usa_only:\s*true\s*(#.*)?$/.exec(line);
    if (trueMatch) {
      const indent = trueMatch[1] ?? "";
      // Skip if the next sibling already has sms_countries
      const window = lines.slice(i, Math.min(i + 12, lines.length)).join("\n");
      if (!/\bsms_countries\s*:/.test(window)) {
        out.push(`${indent}sms_countries:`);
        out.push(`${indent}  - US`);
        out.push(`${indent}sms_countries_mode: include`);
      }
      changed = true;
      continue;
    }
    if (/^( *)sms_usa_only:\s*false\s*(#.*)?$/.test(line)) {
      changed = true;
      continue;
    }
    out.push(line);
  }
  return { text: out.join("\n"), changed };
}

function listYamlFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name === "node_modules" || name === ".git" || name === ".cache") continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith(".yml") || name.endsWith(".yaml")) out.push(full);
    }
  };
  walk(root);
  return out;
}

async function main() {
  const { getSitesConfig } = await import("../../server/sites");
  const { markFileAsModified, detectPendingChanges, updateFileAfterCommit } = await import(
    "../../server/sync-state"
  );
  const { getConflictInfo, commitAndPush } = await import("../../server/github");

  console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");

  const sites = getSitesConfig().filter((s) => !siteFilter || s.content_folder === siteFilter);
  let failed = false;

  for (const site of sites) {
    const contentRoot = site.content_folder;
    const absRoot = path.resolve(contentRoot);
    if (!fs.existsSync(absRoot)) {
      console.log("skip missing", contentRoot);
      continue;
    }

    const touched: string[] = [];
    for (const abs of listYamlFiles(absRoot)) {
      const before = fs.readFileSync(abs, "utf8");
      const { text, changed } = rewriteSmsUsaOnlyText(before);
      if (!changed) continue;
      const rel = path.relative(process.cwd(), abs).split(path.sep).join("/");
      touched.push(rel);
      if (!dryRun) {
        fs.writeFileSync(abs, text, "utf8");
        markFileAsModified(rel, "agent", undefined, contentRoot);
      }
    }

    console.log(contentRoot, dryRun ? "would_change" : "changed", touched.length, touched.slice(0, 15));

    if (dryRun || touched.length === 0) continue;

    const conflicts = await getConflictInfo({ contentRoot });
    const remoteTouched: string[] = (conflicts as { changedFiles?: string[] })?.changedFiles ?? [];
    const overlap = touched.filter((f) => remoteTouched.includes(f));
    if (overlap.length) {
      console.error("Resolve overlap before push:", overlap.join(", "));
      failed = true;
      continue;
    }

    const result = await commitAndPush("Consent: replace sms_usa_only with sms_countries include US", {
      files: touched,
      contentRoot,
    });
    const sha = (result as { commitHash?: string }).commitHash;
    if (!sha) {
      console.error("Content push failed", contentRoot, (result as { error?: string }).error);
      failed = true;
      continue;
    }
    console.log("commitSha", sha);
    for (const f of touched) updateFileAfterCommit(f, sha, contentRoot);
    const still = detectPendingChanges(contentRoot).filter((c) => touched.includes(c.file));
    if (still.length) console.warn("still pending", still);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
