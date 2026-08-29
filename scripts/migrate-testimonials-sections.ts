#!/usr/bin/env npx tsx
/**
 * One-shot migration: move testimonials sections onto the listing contract.
 *
 * For every `testimonials` / `testimonials_grid` / `testimonials_slide` section
 * in content YAML:
 *   - root `related_features` -> dynamic_entries.permanent_filters
 *   - root `limit`            -> dynamic_entries.limit (per-type default if absent)
 *   - carousel `items` / slide `testimonials` -> dynamic_entries.hardcoded_entries
 *   - locale-split `database: testimonials_en|es` -> `testimonials`
 *   - drop `item_styles` (superseded by featured vs default grid colors)
 *
 * Usage:
 *   npx tsx scripts/migrate-testimonials-sections.ts --dry-run
 *   npx tsx scripts/migrate-testimonials-sections.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  escapeTemplateVars,
  unescapeObjectVars,
  escapeObjectVars,
  unescapeYamlDump,
} from "../shared/templateVars";
import {
  normalizeTestimonialsListing,
  TESTIMONIALS_LIMIT_DEFAULTS,
} from "../shared/testimonials-listing";
import { markFileAsModified } from "../server/sync-state";
import { getSiteConfigs } from "../server/site-config";

const DRY = process.argv.includes("--dry-run");
const AUTHOR = "migrate-testimonials-sections";

const TESTIMONIAL_TYPES = new Set(Object.keys(TESTIMONIALS_LIMIT_DEFAULTS));

function safeYamlLoad(raw: string): unknown {
  const { escaped, map } = escapeTemplateVars(raw);
  const loaded = yaml.load(escaped);
  if (!loaded || typeof loaded !== "object") return null;
  return unescapeObjectVars(loaded, map);
}

function safeYamlDump(obj: unknown): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, { lineWidth: 120, noRefs: true, sortKeys: false });
  return unescapeYamlDump(dumped, map);
}

function walkYaml(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Registry schemas and the bank itself are not page content.
      if (entry.name === "component-registry" || entry.name === "node_modules") continue;
      if (entry.name === "db" || entry.name === "testimonials") continue;
      out.push(...walkYaml(full));
    } else if (/\.ya?ml$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Rewrite testimonials sections in place anywhere in the tree — sections live
 * under `sections`, shared layouts, and per-entry overlays.
 */
function migrateNode(node: unknown, stats: { sections: number }): unknown {
  if (Array.isArray(node)) {
    return node.map((child) => migrateNode(child, stats));
  }
  if (!node || typeof node !== "object") return node;

  const obj = node as Record<string, unknown>;
  let next: Record<string, unknown> = obj;

  if (typeof obj.type === "string" && TESTIMONIAL_TYPES.has(obj.type)) {
    const migrated = normalizeTestimonialsListing(obj);
    if (migrated) {
      next = migrated;
      stats.sections++;
    }
  }

  const out: Record<string, unknown> = {};
  let childChanged = false;
  for (const [key, value] of Object.entries(next)) {
    const migratedChild = migrateNode(value, stats);
    if (migratedChild !== value) childChanged = true;
    out[key] = migratedChild;
  }
  return childChanged || next !== obj ? out : obj;
}

function main(): void {
  const roots = getSiteConfigs().map((site) =>
    path.join(process.cwd(), site.contentFolder),
  );
  const stats = { files: 0, changed: 0, sections: 0 };
  const changedFiles: string[] = [];

  for (const root of roots) {
    for (const file of walkYaml(root)) {
      stats.files++;
      let parsed: unknown;
      try {
        const raw = fs.readFileSync(file, "utf-8");
        if (!raw.includes("type: testimonials")) continue;
        parsed = safeYamlLoad(raw);
      } catch (err) {
        console.warn("skip (unreadable)", file, String(err));
        continue;
      }
      if (!parsed) continue;

      const before = stats.sections;
      const migrated = migrateNode(parsed, stats);
      if (stats.sections === before) continue;

      stats.changed++;
      changedFiles.push(path.relative(process.cwd(), file));
      if (DRY) continue;

      fs.writeFileSync(file, safeYamlDump(migrated), "utf-8");
      markFileAsModified(path.relative(process.cwd(), file), AUTHOR, undefined, root);
    }
  }

  console.log("dryRun", DRY);
  console.log("filesScanned", stats.files);
  console.log("filesChanged", stats.changed);
  console.log("sectionsMigrated", stats.sections);
  for (const f of changedFiles) console.log("  ", f);
}

main();
