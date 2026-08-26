/**
 * Move blog `category` off _common.yml onto locale YAML (en.yml / es.yml / draft.*).
 * Bilingual live folders get EN=ai-tools, ES=herramientas-ia.
 *
 * Usage:
 *   npx tsx scripts/migrate-blog-category-to-locale.ts --dry-run
 *   npx tsx scripts/migrate-blog-category-to-locale.ts
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getDefaultContentRoot } from "../server/site-config";
import { markFileAsModified } from "../server/sync-state";

const DRY = process.argv.includes("--dry-run");
const AUTHOR = "migrate-blog-category-to-locale";

const BILINGUAL_LIVE = new Set([
  "cumora",
  "gobernanza-agentes-ia-empresa",
  "grok-bot-casos-uso",
  "que-es-stagehand",
  "what-is-huzzah",
]);

const EN_CATEGORY = "ai-tools";
const ES_CATEGORY = "herramientas-ia";

const LOCALE_FILE = /^(draft\.)?(en|es)\.ya?ml$/i;

function readYaml(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = yaml.load(fs.readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function writeYaml(filePath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false }), "utf-8");
}

function categoryFrom(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const c = data.category;
  if (typeof c === "string" && c.trim()) return c.trim();
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const slug = (c as Record<string, unknown>).slug;
    if (typeof slug === "string" && slug.trim()) return slug.trim();
  }
  return null;
}

function localeFromFileName(name: string): string | null {
  const m = name.match(/^(?:draft\.)?(en|es)\.ya?ml$/i);
  return m ? m[1].toLowerCase() : null;
}

function isDraftFile(name: string): boolean {
  return /^draft\./i.test(name);
}

function targetCategoryForLocale(
  slug: string,
  locale: string,
  commonCat: string | null,
  existingLocaleCat: string | null,
): string | null {
  if (existingLocaleCat) return existingLocaleCat;
  if (BILINGUAL_LIVE.has(slug)) {
    return locale === "en" ? EN_CATEGORY : ES_CATEGORY;
  }
  if (commonCat) return commonCat;
  if (slug === "formacion-ia-fundae" && locale === "es") {
    return "reglamento-europeo-ia-empresas";
  }
  return null;
}

function migrateEntry(blogRoot: string, slug: string, contentRoot: string): string[] {
  const entryDir = path.join(blogRoot, slug);
  const changed: string[] = [];
  const commonPath = path.join(entryDir, "_common.yml");
  const common = readYaml(commonPath);
  const commonCat = categoryFrom(common);

  const localeFiles = fs.readdirSync(entryDir).filter((f) => LOCALE_FILE.test(f));

  for (const file of localeFiles) {
    const locale = localeFromFileName(file);
    if (!locale) continue;
    const filePath = path.join(entryDir, file);
    const data = readYaml(filePath) ?? {};
    const existing = categoryFrom(data);
    const target = targetCategoryForLocale(slug, locale, commonCat, existing);
    if (!target) continue;
    if (existing === target) continue;
    data.category = target;
    if (!DRY) {
      writeYaml(filePath, data);
      markFileAsModified(`${path.basename(contentRoot)}/blog/${slug}/${file}`, AUTHOR, undefined, path.basename(contentRoot));
    }
    changed.push(`${slug}/${file} category=${target}`);
  }

  if (common && "category" in common) {
    delete common.category;
    if (!DRY) {
      writeYaml(commonPath, common);
      markFileAsModified(`${path.basename(contentRoot)}/blog/${slug}/_common.yml`, AUTHOR, undefined, path.basename(contentRoot));
    }
    changed.push(`${slug}/_common.yml removed category`);
  }

  return changed;
}

function main(): void {
  const contentRoot = getDefaultContentRoot();
  const blogRoot = path.join(contentRoot, "blog");
  if (!fs.existsSync(blogRoot)) {
    console.error("Blog root not found:", blogRoot);
    process.exit(1);
  }

  const allChanged: string[] = [];
  for (const entry of fs.readdirSync(blogRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    allChanged.push(...migrateEntry(blogRoot, entry.name, contentRoot));
  }

  console.log(DRY ? "[dry-run]" : "[applied]", "changes", allChanged.length);
  for (const line of allChanged.slice(0, 50)) console.log(" ", line);
  if (allChanged.length > 50) console.log(" ...", allChanged.length - 50, "more");
}

main();
