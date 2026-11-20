#!/usr/bin/env tsx
/**
 * Read-only report: site facts typed as literals in page copy instead of `{{variable}}` tokens.
 * Exact matching only — currency values, phone numbers, and percentages (`84` in variables.yml
 * matches `84%` in copy). Structured price money `{ amount, currency, display? }` is expanded to
 * display + common spellings (`$999`, `999 USD`, `140€` / `€140`). Status compares currency by
 * amount+currency so alternate spellings of the same price are not wrong_for_audience.
 * Never writes YAML.
 *
 *   npx tsx scripts/admin/report-hardcoded-fact-literals.ts site_4geeks-com
 *   npx tsx scripts/admin/report-hardcoded-fact-literals.ts site_4geeks-com --json
 *
 * Each hit is classified with the page-audience rules (hand-set `region` / `locations`):
 *   token_recommended  literal equals the value this page's audience sees → swap for the token
 *   wrong_for_audience literal is another region/location's value → likely a wrong fact
 *   varies             page has no audience and the fact differs by region → token required
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { fileURLToPath } from "url";
import type { VariableContext } from "../../server/variable-manager";
import { audienceFromEntryData, audienceValuesFor } from "../../server/page-audience";
import {
  buildLiteralIndex,
  findLiterals,
  isNonCopyFieldPath,
  literalKinds,
  sameFactLiteral,
  type LiteralHitStatus,
  type LiteralKind,
} from "../../server/fact-literals";

export {
  buildLiteralIndex,
  findLiterals,
  literalKinds,
  moneyAliases,
  sameFactLiteral,
  valueSearchStrings,
  type LiteralHitStatus,
  type LiteralKind,
} from "../../server/fact-literals";

export const REPORT_CONTENT_FOLDERS = ["programs", "landings", "pages", "locations"] as const;

export interface ReportHardcodedFactLiteralsOptions {
  /** Content root folder name, e.g. site_4geeks-com. */
  site: string;
  /** Absolute content root; defaults to <cwd>/<site>. */
  contentRoot?: string;
}

export interface HardcodedLiteralHit {
  id: string;
  src: string;
  status: LiteralHitStatus;
  field_path: string;
  literal: string;
  kind: LiteralKind;
  variables: string[];
  /** Value the page's audience sees for the first matching variable (null when it varies). */
  audience_value: string | null;
  audience: string;
}

export interface ReportHardcodedFactLiteralsResult {
  message: string;
  warnings: string[];
  scannedFiles: number;
  counts: Record<LiteralHitStatus, number>;
  results: HardcodedLiteralHit[];
}

function walkStrings(node: unknown, prefix: string, out: Array<{ path: string; text: string }>): void {
  if (typeof node === "string") {
    out.push({ path: prefix, text: node });
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => walkStrings(v, `${prefix}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walkStrings(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

function readYaml(file: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function entryDirs(contentRoot: string, folder: string): string[] {
  const base = path.join(contentRoot, folder);
  if (!fs.existsSync(base)) return [];
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    const names = fs.readdirSync(dir);
    if (names.some((n) => n === "_common.yml" || /^[a-z]{2}\.yml$/.test(n))) out.push(dir);
    if (depth >= 2) return;
    for (const n of names) {
      const p = path.join(dir, n);
      if (!n.startsWith("_") && !n.startsWith(".") && fs.statSync(p).isDirectory()) visit(p, depth + 1);
    }
  };
  visit(base, 0);
  return out;
}

function locationRegionsFrom(contentRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const dir of entryDirs(contentRoot, "locations")) {
    const common = readYaml(path.join(dir, "_common.yml")) ?? {};
    const region = typeof common.region === "string" ? common.region.trim() : "";
    if (region) map.set(path.basename(dir), region);
  }
  return map;
}

function audienceLabel(a: ReturnType<typeof audienceFromEntryData>): string {
  if (a.source === "region") return `region:${a.regions.join(",")}`;
  if (a.source === "locations") return `locations:${a.locations.join(",")}`;
  return "none";
}

export async function reportHardcodedFactLiterals(
  options: ReportHardcodedFactLiteralsOptions,
): Promise<ReportHardcodedFactLiteralsResult> {
  const contentRoot = options.contentRoot ?? path.join(process.cwd(), options.site);
  const warnings: string[] = [];
  const counts: Record<LiteralHitStatus, number> = { token_recommended: 0, wrong_for_audience: 0, varies: 0 };
  if (!fs.existsSync(path.join(contentRoot, "variables.yml"))) {
    return { message: `No variables.yml under ${contentRoot}.`, warnings, scannedFiles: 0, counts, results: [] };
  }

  const { getVariableManager } = await import("../../server/variable-manager");
  const vm = getVariableManager(contentRoot);
  const defs = vm.getDefinitions();
  const index = buildLiteralIndex(defs);
  const resolve = (name: string, ctx: VariableContext) => vm.resolveVariable(name, ctx);
  const locationRegions = locationRegionsFrom(contentRoot);

  const results: HardcodedLiteralHit[] = [];
  let scannedFiles = 0;
  for (const folder of REPORT_CONTENT_FOLDERS) {
    for (const dir of entryDirs(contentRoot, folder)) {
      const common = readYaml(path.join(dir, "_common.yml")) ?? {};
      const localeFiles = fs.readdirSync(dir).filter((n) => /^[a-z]{2}\.yml$/.test(n));
      const files = [
        { file: "_common.yml", locale: null as string | null, data: common },
        ...localeFiles.map((n) => ({ file: n, locale: n.slice(0, 2), data: readYaml(path.join(dir, n)) ?? {} })),
      ];
      for (const { file, locale, data } of files) {
        if (file === "_common.yml" && !fs.existsSync(path.join(dir, file))) continue;
        scannedFiles++;
        const rel = path.relative(contentRoot, path.join(dir, file));
        const effectiveLocale = locale ?? "en";
        const audience = audienceFromEntryData({ ...common, ...(locale ? data : {}) }, locationRegions);
        const strings: Array<{ path: string; text: string }> = [];
        walkStrings(data, "", strings);
        for (const { path: fieldPath, text } of strings) {
          if (isNonCopyFieldPath(fieldPath)) continue;
          for (const hit of findLiterals(text, index)) {
            const names = [...hit.names].sort();
            const perName = names.map((n) => ({
              name: n,
              ...audienceValuesFor(n, resolve, audience, effectiveLocale, locationRegions),
            }));
            const exact = perName.find((p) => p.literal_ok != null && sameFactLiteral(p.literal_ok, hit.literal));
            const anyFixed = perName.find((p) => p.literal_ok !== null);
            const status: LiteralHitStatus = exact
              ? "token_recommended"
              : anyFixed
                ? "wrong_for_audience"
                : "varies";
            counts[status]++;
            results.push({
              id: `${rel}#${fieldPath}`,
              src: rel,
              status,
              field_path: fieldPath,
              literal: hit.literal,
              kind: hit.kind,
              variables: exact ? [exact.name, ...names.filter((n) => n !== exact.name)] : names,
              audience_value: (exact ?? anyFixed)?.literal_ok ?? null,
              audience: audienceLabel(audience),
            });
          }
        }
        warnings.push(...audience.warnings.map((w) => `${rel}: ${w}`));
      }
    }
  }

  const total = results.length;
  return {
    message: `${total} hardcoded fact literal(s) in ${scannedFiles} files (${counts.token_recommended} token_recommended, ${counts.wrong_for_audience} wrong_for_audience, ${counts.varies} varies). ${index.size} literal values indexed.`,
    warnings: [...new Set(warnings)],
    scannedFiles,
    counts,
    results,
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  if (!positional[0]) {
    console.log("Usage: npx tsx scripts/admin/report-hardcoded-fact-literals.ts <site_folder> [--json]");
    process.exit(1);
  }
  reportHardcodedFactLiterals({ site: positional[0] })
    .then((result) => {
      if (flags.has("--json")) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      for (const w of result.warnings) console.log("warning", w);
      for (const r of result.results) {
        const tag = r.status === "wrong_for_audience" ? "[ERR]" : r.status === "varies" ? "[SKIP]" : "[OK] ";
        console.log(
          `  ${tag} ${r.id} — ${r.status} · "${r.literal}" (${r.kind}) → {{${r.variables[0]}}}${
            r.variables.length > 1 ? ` (+${r.variables.length - 1})` : ""
          } · audience ${r.audience}${r.audience_value ? ` sees ${r.audience_value}` : ""}`,
        );
      }
      console.log(`\nDone. ${result.message}`);
    })
    .catch((err) => {
      console.error("Failed:", err);
      process.exit(1);
    });
}
