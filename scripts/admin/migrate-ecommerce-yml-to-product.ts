#!/usr/bin/env tsx
/**
 * Rename `_ecommerce.yml` → `_product.yml` (type + entry sidecars).
 * Dual-read remains in the product index until legacy files are gone.
 *
 * Usage:
 *   npx tsx scripts/admin/migrate-ecommerce-yml-to-product.ts
 *   npx tsx scripts/admin/migrate-ecommerce-yml-to-product.ts --write
 *   npx tsx scripts/admin/migrate-ecommerce-yml-to-product.ts --write --content-root site_4geeks-com
 */

import * as fs from "fs";
import * as path from "path";
import { getAllConfigs, getFolder } from "../../server/content-types";
import { getDefaultContentRoot, getSiteConfigs } from "../../server/site-config";
import { markFileAsModified } from "../../server/sync-state";
import {
  LEGACY_PRODUCT_SIDECAR_BASENAME,
  PRODUCT_SIDECAR_BASENAME,
} from "../../server/product/product-sidecar";

export interface MigrateResultItem {
  path: string;
  status: "renamed" | "skipped_exists" | "missing" | "dry_run";
}

export interface MigrateResult {
  contentRoot: string;
  dryRun: boolean;
  renamed: number;
  skipped: number;
  results: MigrateResultItem[];
}

function contentRootAbs(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function legacyCandidates(dir: string): string[] {
  return [
    path.join(dir, "_ecommerce.yml"),
    path.join(dir, "_ecommerce.yaml"),
  ].filter((p) => fs.existsSync(p));
}

function productTarget(dir: string): string {
  return path.join(dir, PRODUCT_SIDECAR_BASENAME);
}

export function migrateEcommerceYmlToProduct(opts?: {
  contentRoot?: string;
  dryRun?: boolean;
  author?: string;
}): MigrateResult {
  const dryRun = opts?.dryRun !== false;
  const root = contentRootAbs(opts?.contentRoot);
  const results: MigrateResultItem[] = [];
  let renamed = 0;
  let skipped = 0;

  const configs = getAllConfigs(opts?.contentRoot);
  const dirs = new Set<string>();

  for (const [ct] of Object.entries(configs)) {
    const folder = getFolder(ct, opts?.contentRoot);
    const typeDir = path.join(root, folder);
    if (fs.existsSync(typeDir)) dirs.add(typeDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const ent of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (ent.isDirectory()) dirs.add(path.join(typeDir, ent.name));
    }
  }

  for (const dir of dirs) {
    const legacies = legacyCandidates(dir);
    if (legacies.length === 0) continue;
    const target = productTarget(dir);
    const relLegacy = path.relative(root, legacies[0]).split(path.sep).join("/");
    const relTarget = path.relative(root, target).split(path.sep).join("/");

    if (fs.existsSync(target)) {
      results.push({ path: relLegacy, status: "skipped_exists" });
      skipped++;
      continue;
    }

    if (dryRun) {
      results.push({ path: `${relLegacy} → ${relTarget}`, status: "dry_run" });
      renamed++;
      continue;
    }

    fs.renameSync(legacies[0], target);
    // Remove alternate extension leftovers
    for (const extra of legacies.slice(1)) {
      try {
        fs.unlinkSync(extra);
      } catch {
        /* ignore */
      }
    }
    try {
      markFileAsModified(
        relTarget,
        opts?.author ?? "agent",
        undefined,
        opts?.contentRoot,
      );
    } catch {
      // Sync state optional in unit tests / bare trees
    }
    results.push({ path: `${relLegacy} → ${relTarget}`, status: "renamed" });
    renamed++;
  }

  return {
    contentRoot: root,
    dryRun,
    renamed,
    skipped,
    results,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const crIdx = args.indexOf("--content-root");
  const singleRoot = crIdx >= 0 ? args[crIdx + 1] : undefined;

  const roots = singleRoot
    ? [singleRoot]
    : getSiteConfigs().map((s) => s.contentFolder);

  for (const contentRoot of roots) {
    const result = migrateEcommerceYmlToProduct({
      contentRoot,
      dryRun: !write,
      author: "agent",
    });
    console.log(
      JSON.stringify(
        {
          contentRoot: result.contentRoot,
          dryRun: result.dryRun,
          renamed: result.renamed,
          skipped: result.skipped,
          sample: result.results.slice(0, 20),
          hint: write
            ? `Renamed to ${PRODUCT_SIDECAR_BASENAME} (legacy ${LEGACY_PRODUCT_SIDECAR_BASENAME} removed when present)`
            : "Dry run — pass --write to apply",
        },
        null,
        2,
      ),
    );
  }
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("migrate-ecommerce-yml-to-product.ts") ||
    process.argv[1].includes("migrate-ecommerce-yml-to-product"));

if (isMain) main();
