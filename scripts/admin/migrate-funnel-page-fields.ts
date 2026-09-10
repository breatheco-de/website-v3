#!/usr/bin/env tsx
/**
 * Migrate section ecommerce_products → page funnel.products on _common.yml;
 * delete seo.intent, section ecommerce_products, and legacy _ecommerce.yml funnel lists.
 *
 * Usage:
 *   npx tsx scripts/admin/migrate-funnel-page-fields.ts
 *   npx tsx scripts/admin/migrate-funnel-page-fields.ts --write
 */

import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { getAllConfigs, getFolder } from "../../server/content-types";
import { getDefaultContentRoot } from "../../server/site-config";
import {
  readFunnelBlockFromYamlText,
  surgicalReplaceFunnelBlock,
  writeFunnelBlock,
} from "../../server/funnel-fields";
import { normalizeFunnelProducts, type FunnelBlock } from "@shared/funnel";
import { fileURLToPath } from "url";

export interface MigrateFunnelOptions {
  contentRoot?: string;
  dryRun?: boolean;
}

export interface MigrateFunnelResultItem {
  id: string;
  status: string;
  reason?: string;
}

export interface MigrateFunnelResult {
  message: string;
  entriesTouched: number;
  productsWritten: number;
  sectionsStripped: number;
  intentsRemoved: number;
  ecommerceFunnelCleaned: number;
  results: MigrateFunnelResultItem[];
}

function contentRootAbs(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function unionProducts(
  current: FunnelBlock["products"] | undefined,
  fromSections: unknown,
): FunnelBlock["products"] | undefined {
  if (fromSections === "all") return "all";
  if (current === "all") return "all";
  const lists: unknown[] = [];
  if (Array.isArray(current)) lists.push(...current);
  if (Array.isArray(fromSections)) lists.push(...fromSections);
  const normalized = normalizeFunnelProducts(lists.length ? lists : undefined);
  return normalized;
}

function collectSectionProducts(doc: unknown): FunnelBlock["products"] | undefined {
  if (!doc || typeof doc !== "object") return undefined;
  const sections = (doc as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return undefined;
  let acc: FunnelBlock["products"] | undefined;
  for (const sec of sections) {
    if (!sec || typeof sec !== "object") continue;
    const ep = (sec as Record<string, unknown>).ecommerce_products;
    if (ep === undefined || ep === null) continue;
    acc = unionProducts(acc, ep);
  }
  return acc;
}

function stripSectionEcommerceProducts(content: string): { text: string; count: number } {
  let doc: unknown;
  try {
    doc = yaml.load(content);
  } catch {
    return { text: content, count: 0 };
  }
  if (!doc || typeof doc !== "object") return { text: content, count: 0 };
  const sections = (doc as { sections?: unknown[] }).sections;
  if (!Array.isArray(sections)) return { text: content, count: 0 };
  let count = 0;
  for (const sec of sections) {
    if (!sec || typeof sec !== "object") continue;
    const rec = sec as Record<string, unknown>;
    if ("ecommerce_products" in rec) {
      delete rec.ecommerce_products;
      count++;
    }
  }
  if (count === 0) return { text: content, count: 0 };
  return {
    text: yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
    count,
  };
}

function stripSeoIntent(content: string): { text: string; removed: boolean } {
  let doc: unknown;
  try {
    doc = yaml.load(content);
  } catch {
    return { text: content, removed: false };
  }
  if (!doc || typeof doc !== "object") return { text: content, removed: false };
  const seo = (doc as { seo?: Record<string, unknown> }).seo;
  if (!seo || typeof seo !== "object" || !("intent" in seo)) {
    return { text: content, removed: false };
  }
  delete seo.intent;
  if (Object.keys(seo).length === 0) delete (doc as Record<string, unknown>).seo;
  return {
    text: yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
    removed: true,
  };
}

function cleanEcommerceFunnelFile(filePath: string, dryRun: boolean): boolean {
  if (!fs.existsSync(filePath)) return false;
  let doc: Record<string, unknown>;
  try {
    doc = (yaml.load(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>) ?? {};
  } catch {
    return false;
  }
  const funnel = doc.funnel;
  if (!funnel || typeof funnel !== "object") return false;
  const f = funnel as Record<string, unknown>;
  if (!("traffic_sources" in f) && !("steps" in f)) return false;
  if (dryRun) return true;
  if ("traffic_sources" in f) delete f.traffic_sources;
  if ("steps" in f) delete f.steps;
  if (Object.keys(f).length === 0) delete doc.funnel;
  fs.writeFileSync(
    filePath,
    yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
    "utf-8",
  );
  return true;
}

export async function migrateFunnelPageFields(
  options: MigrateFunnelOptions = {},
): Promise<MigrateFunnelResult> {
  const dryRun = options.dryRun !== false;
  const root = contentRootAbs(options.contentRoot);
  const results: MigrateFunnelResultItem[] = [];
  let entriesTouched = 0;
  let productsWritten = 0;
  let sectionsStripped = 0;
  let intentsRemoved = 0;
  let ecommerceFunnelCleaned = 0;

  const configs = getAllConfigs(options.contentRoot ?? root);

  for (const [contentType, cfg] of Object.entries(configs)) {
    const dirName = cfg.directory || getFolder(contentType, options.contentRoot ?? root);
    const typeDir = path.join(root, dirName);
    if (!fs.existsSync(typeDir)) continue;

    for (const slugEnt of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!slugEnt.isDirectory() || slugEnt.name.startsWith("_")) continue;
      const slug = slugEnt.name;
      const slugDir = path.join(typeDir, slug);
      const commonPath = path.join(slugDir, "_common.yml");

      let union: FunnelBlock["products"] | undefined;
      const yamlFiles: string[] = [];
      for (const f of fs.readdirSync(slugDir)) {
        if (/\.ya?ml$/.test(f)) yamlFiles.push(path.join(slugDir, f));
      }
      for (const abs of yamlFiles) {
        try {
          const text = fs.readFileSync(abs, "utf-8");
          const doc = yaml.load(text);
          union = unionProducts(union, collectSectionProducts(doc));
        } catch {
          // skip
        }
      }

      const existingCommon = fs.existsSync(commonPath)
        ? readFunnelBlockFromYamlText(fs.readFileSync(commonPath, "utf-8"))
        : {};
      const mergedProducts = unionProducts(existingCommon.products, union);

      if (mergedProducts && !existingCommon.products) {
        const nextFunnel: FunnelBlock = { ...existingCommon, products: mergedProducts };
        if (!dryRun) {
          if (fs.existsSync(commonPath)) {
            const text = fs.readFileSync(commonPath, "utf-8");
            fs.writeFileSync(commonPath, surgicalReplaceFunnelBlock(text, nextFunnel), "utf-8");
          } else {
            writeFunnelBlock(contentType, slug, nextFunnel, root);
          }
        }
        productsWritten++;
        results.push({
          id: `${contentType}/${slug}`,
          status: dryRun ? "would-write-funnel-products" : "wrote-funnel-products",
        });
      }

      let entryTouched = false;
      for (const abs of yamlFiles) {
        const base = path.basename(abs);
        let text = fs.readFileSync(abs, "utf-8");
        const stripped = stripSectionEcommerceProducts(text);
        if (stripped.count > 0) {
          entryTouched = true;
          sectionsStripped += stripped.count;
          if (!dryRun) fs.writeFileSync(abs, stripped.text, "utf-8");
        }
        const intent = stripSeoIntent(stripped.text);
        if (intent.removed) {
          entryTouched = true;
          intentsRemoved++;
          if (!dryRun) fs.writeFileSync(abs, intent.text, "utf-8");
        }
      }

      const ecommercePath = path.join(slugDir, "_ecommerce.yml");
      if (cleanEcommerceFunnelFile(ecommercePath, dryRun)) {
        ecommerceFunnelCleaned++;
        entryTouched = true;
      }

      if (entryTouched) {
        entriesTouched++;
        results.push({
          id: `${contentType}/${slug}`,
          status: dryRun ? "would-migrate-entry" : "migrated-entry",
        });
      }
    }
  }

  return {
    message: dryRun ? "Dry run complete" : "Migration complete",
    entriesTouched,
    productsWritten,
    sectionsStripped,
    intentsRemoved,
    ecommerceFunnelCleaned,
    results,
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const write = process.argv.includes("--write");
  migrateFunnelPageFields({ dryRun: !write })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
