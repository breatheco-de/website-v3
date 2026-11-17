/**
 * Convert category:price variable values from marketing strings to { amount, currency }.
 * Optionally fills products / price_role from name heuristics when missing.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getSiteConfigs } from "./site-config";
import { markFileAsModified, updateFileAfterCommit } from "./sync-state";
import { commitAndPush, getConflictInfo } from "./github";
import {
  isMoneyValue,
  parseBareAmountAsUsd,
  parseLegacyPriceString,
  type MoneyValue,
  type PriceRole,
  type VariableValue,
} from "@shared/variable-money";
import { child } from "./logger";
import { resetVariableManagerCache } from "./variable-manager";

const log = child({ module: "price-variables-migration" });

type Def = {
  category?: string;
  products?: string[];
  price_role?: string;
  default?: VariableValue;
  conditions?: Array<{ query: Record<string, string>; value: VariableValue }>;
  by_region?: Record<string, string>;
  by_location?: Record<string, string>;
  by_locale?: Record<string, string>;
  [key: string]: unknown;
};

function inferProductSlug(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("fullstack") || n.includes("full_stack") || n.includes("full-stack")) {
    return "full-stack";
  }
  if (n.includes("datascience") || n.includes("data_science") || n.includes("data-science")) {
    return "data-science-ml";
  }
  if (n.includes("cyber")) return "cybersecurity";
  if (n.includes("ai_engineering") || n.includes("ai-engineering") || n.includes("ai_eng")) {
    return "ai-engineering";
  }
  if (n.includes("ai_fluency") || n.includes("ai-fluency") || n.includes("ai.fluency")) {
    return "ai-fluency";
  }
  if (n.includes("ai_flex") || n.includes("ai-flex")) return "ai-flex";
  if (n.includes("applied_ai") || n.includes("applied-ai")) return "applied-ai-course";
  return null;
}

function inferPriceRole(name: string): PriceRole {
  const n = name.toLowerCase();
  if (
    n.includes("price_full_") ||
    n.includes("_full_") ||
    n.includes("full_tuition") ||
    (n.includes("full_") && n.includes("price"))
  ) {
    return "list";
  }
  if (n.includes("monthly") || n.includes("mounthly") || n.includes("financing")) {
    return "monthly";
  }
  // price_fullstack / price_datascience without "full" → monthly installment style
  if (/^global\.price_[a-z0-9]+$/.test(n) && !n.includes("full")) {
    return "monthly";
  }
  if (n.includes("price_full") || n.endsWith("_full") || n.includes("full_price")) {
    return "list";
  }
  return "other";
}

function convertValue(raw: unknown): { next: VariableValue; changed: boolean } | null {
  if (isMoneyValue(raw)) return { next: raw, changed: false };
  if (typeof raw !== "string") return null;
  const money = parseLegacyPriceString(raw) ?? parseBareAmountAsUsd(raw);
  if (!money) return null;
  // Keep original marketing string as display when format would differ meaningfully
  const next: MoneyValue = { amount: money.amount, currency: money.currency, display: raw.trim() };
  return { next, changed: true };
}

function convertDef(name: string, def: Def): { def: Def; changed: boolean } {
  if (def.category !== "price") return { def, changed: false };
  let changed = false;
  const next: Def = { ...def };

  if (next.default !== undefined) {
    const c = convertValue(next.default);
    if (c?.changed) {
      next.default = c.next;
      changed = true;
    }
  }
  if (Array.isArray(next.conditions)) {
    next.conditions = next.conditions.map((cond) => {
      const c = convertValue(cond.value);
      if (c?.changed) {
        changed = true;
        return { ...cond, value: c.next };
      }
      return cond;
    });
  }
  for (const key of ["by_region", "by_location", "by_locale"] as const) {
    const map = next[key];
    if (!map || typeof map !== "object") continue;
    const out: Record<string, VariableValue> = {};
    let mapChanged = false;
    for (const [k, v] of Object.entries(map)) {
      const c = convertValue(v);
      if (c?.changed) {
        out[k] = c.next;
        mapChanged = true;
        changed = true;
      } else {
        out[k] = v as VariableValue;
      }
    }
    if (mapChanged) (next as Record<string, unknown>)[key] = out;
  }

  const products = Array.isArray(next.products) ? next.products.filter((p) => typeof p === "string") : [];
  if (products.length !== 1) {
    const inferred = inferProductSlug(name);
    if (inferred) {
      next.products = [inferred];
      changed = true;
    }
  }
  if (!next.price_role) {
    next.price_role = inferPriceRole(name);
    changed = true;
  }

  return { def: next, changed };
}

export async function runPriceVariablesMigration(opts: {
  site?: string;
  dryRun: boolean;
}): Promise<{ failed: boolean; changed: number }> {
  const sites = getSiteConfigs().filter(
    (s) =>
      !opts.site ||
      s.contentFolder === opts.site ||
      s.domain === opts.site ||
      opts.site === `site_${s.domain}`,
  );
  let changed = 0;
  let failed = false;

  for (const site of sites) {
    const contentRoot = path.isAbsolute(site.contentFolder)
      ? site.contentFolder
      : path.join(process.cwd(), site.contentFolder);
    const variablesPath = path.join(contentRoot, "variables.yml");
    if (!fs.existsSync(variablesPath)) {
      log.info({ site: site.contentFolder }, "no variables.yml — skip");
      continue;
    }

    const raw = fs.readFileSync(variablesPath, "utf-8");
    const parsed = (yaml.load(raw) as Record<string, Def> | null) || {};
    const out: Record<string, Def> = {};
    let siteChanged = false;
    const listBindings: Array<{ product: string; variable: string }> = [];

    for (const [name, def] of Object.entries(parsed)) {
      const { def: next, changed: c } = convertDef(name, def ?? {});
      out[name] = next;
      if (c) siteChanged = true;
      if (
        next.category === "price" &&
        next.price_role === "list" &&
        Array.isArray(next.products) &&
        next.products.length === 1
      ) {
        listBindings.push({ product: next.products[0]!, variable: name });
      }
    }

    if (!siteChanged && listBindings.length === 0) {
      log.info({ site: site.contentFolder }, "already structured — skip");
      continue;
    }

    const folder = site.contentFolder;
    const rel = `${folder}/variables.yml`;
    if (opts.dryRun) {
      console.log("would_update", rel, "list_bindings", listBindings.length);
      changed++;
      continue;
    }

    const dumped = yaml.dump(out, { lineWidth: -1, quotingType: '"', forceQuotes: false });
    fs.writeFileSync(variablesPath, dumped, "utf-8");
    markFileAsModified(rel, "agent", undefined, contentRoot);

    // Apply list-price bindings on product sidecars
    for (const { product, variable } of listBindings) {
      const productPath = path.join(contentRoot, "programs", product, "_product.yml");
      if (!fs.existsSync(productPath)) continue;
      const pRaw = fs.readFileSync(productPath, "utf-8");
      const pDoc = (yaml.load(pRaw) as Record<string, unknown>) || {};
      const pricing = (pDoc.pricing as Record<string, unknown> | undefined) ?? {};
      if (pricing.list_price_variable === variable) continue;
      pDoc.pricing = { ...pricing, list_price_variable: variable };
      fs.writeFileSync(productPath, yaml.dump(pDoc, { lineWidth: -1 }), "utf-8");
      const pRel = `${folder}/programs/${product}/_product.yml`;
      markFileAsModified(pRel, "agent", undefined, contentRoot);
      console.log("bound", variable, "→", pRel);
    }

    const files = [
      rel,
      ...listBindings.map((b) => `${folder}/programs/${b.product}/_product.yml`),
    ];
    const uniqueFiles = [...new Set(files)].filter((f) =>
      fs.existsSync(path.join(process.cwd(), f)),
    );

    try {
      const conflicts = await getConflictInfo({ contentRoot });
      const remoteTouched: string[] = (conflicts as { changedFiles?: string[] })?.changedFiles ?? [];
      const overlap = uniqueFiles.filter((f) => remoteTouched.includes(f));
      if (overlap.length) {
        console.error("Resolve overlap before push:", overlap.join(", "));
        failed = true;
        continue;
      }
      const result = await commitAndPush(
        "Structure price variables as amount+currency; bind list prices to products",
        { files: uniqueFiles, contentRoot },
      );
      const sha = (result as { commitHash?: string }).commitHash;
      if (!sha) {
        console.error("Content push failed:", (result as { error?: string }).error);
        failed = true;
        continue;
      }
      console.log("commitSha", sha);
      for (const f of uniqueFiles) updateFileAfterCommit(f, sha, contentRoot);
      changed++;
      resetVariableManagerCache();
    } catch (err) {
      log.error({ err }, "push failed");
      failed = true;
    }
  }

  return { failed, changed };
}
