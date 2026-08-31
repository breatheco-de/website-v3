/**
 * Build the merged `db/testimonials` database from flat `testimonials/{en,es}.yml`.
 *
 * One database, locale-filtered (`locale` field), so testimonials sections can
 * author `dynamic_entries` like FAQ does. Supersedes `db/testimonials_en|es`.
 *
 * Idempotent: re-running rebuilds testimonials.yml from the flat banks and
 * preserves any staff-edited `featured` flag already stored in the merged DB.
 *
 * Usage:
 *   npx tsx scripts/migrate-testimonials-db.ts --dry-run
 *   npx tsx scripts/migrate-testimonials-db.ts
 *   npx tsx scripts/migrate-testimonials-db.ts --content-root=site_4geeks-com
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getDefaultContentRoot } from "../server/site-config";
import { markFileAsModified } from "../server/sync-state";

const DRY = process.argv.includes("--dry-run");
const AUTHOR = "migrate-testimonials-db";
const LOCALES = ["en", "es"] as const;

const rootArg = process.argv.find((a) => a.startsWith("--content-root="));
const CONTENT_ROOT = rootArg ? rootArg.split("=")[1] : getDefaultContentRoot();

/** Bank columns kept in the merged DB. Layout-only extras stay on section YAML. */
const BANK_FIELDS = [
  "student_name",
  "student_thumb",
  "student_video",
  "excerpt",
  "full_text",
  "content",
  "related_features",
  "priority",
  "rating",
  "linkedin_url",
  "role",
  "company",
  "testimonial_date",
  "source",
] as const;

type Row = Record<string, unknown>;

function isAnonymous(name: unknown): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  return !n || n === "anonymous" || n === "anónimo" || n === "anonimo";
}

/**
 * Seed the `featured` flag used by testimonials_grid to pick card colors.
 *
 * The plan suggested `priority >= 5`, but this bank only uses 1..3 (1 = High),
 * so that would flag nothing. A named person with a photo/video is the actual
 * showcase signal; staff can flip the flag per row in the DB manage UI after.
 */
function seedFeatured(row: Row): boolean {
  if (isAnonymous(row.student_name)) return false;
  return Boolean(row.student_thumb || row.student_video);
}

function readFlatBank(locale: string): Row[] {
  const p = path.join(CONTENT_ROOT, "testimonials", `${locale}.yml`);
  if (!fs.existsSync(p)) return [];
  const parsed = yaml.load(fs.readFileSync(p, "utf-8"));
  return Array.isArray(parsed) ? (parsed as Row[]) : [];
}

/** Stable identity for carrying staff edits across rebuilds. */
function rowKey(locale: string, row: Row): string {
  const name = String(row.student_name ?? "").trim().toLowerCase();
  const text = String(row.excerpt ?? row.full_text ?? row.content ?? "")
    .trim()
    .slice(0, 120)
    .toLowerCase();
  return `${locale}::${name}::${text}`;
}

function existingFeaturedByKey(mergedPath: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!fs.existsSync(mergedPath)) return out;
  try {
    const parsed = yaml.load(fs.readFileSync(mergedPath, "utf-8"));
    if (!Array.isArray(parsed)) return out;
    for (const row of parsed as Row[]) {
      if (typeof row?.featured !== "boolean") continue;
      out.set(rowKey(String(row.locale ?? ""), row), row.featured);
    }
  } catch {
    /* rebuild from scratch when the previous file is unreadable */
  }
  return out;
}

const CONFIG = {
  name: "Testimonials",
  description:
    "Student testimonials bank (EN + ES). Locale-filtered listing source for testimonials, testimonials_grid and testimonials_slide sections.",
  source: {
    type: "local",
    local: { filename: "testimonials.yml" },
  },
  cache: { ttl_hours: 24 },
  filter_by_locale: true,
  field_mapping: {
    locale: "locale",
    student_name: "student_name",
    student_thumb: "student_thumb",
    student_video: "student_video",
    excerpt: "excerpt",
    full_text: "full_text",
    content: "content",
    related_features: "related_features",
    priority: "priority",
    rating: "rating",
    linkedin_url: "linkedin_url",
    role: "role",
    company: "company",
    testimonial_date: "testimonial_date",
    source: "source",
    featured: "featured",
  },
  vector_search: {
    enabled: true,
    fields: ["excerpt", "content", "full_text"],
  },
  search_fields: ["excerpt", "content", "full_text", "student_name"],
  editor: {
    student_thumb: { cache_images: true },
    featured: {
      type: "boolean",
      description:
        "Highlight this person. testimonials_grid renders featured rows with the section's featured colors instead of the default card colors. Applies to every page that lists this row.",
    },
    locale: {
      type: "select",
      options: ["en", "es"],
      description: "Which locale's sections may list this testimonial.",
    },
  },
};

function main(): void {
  const dbDir = path.join(CONTENT_ROOT, "db", "testimonials");
  const configPath = path.join(dbDir, "config.yml");
  const dataPath = path.join(dbDir, "testimonials.yml");

  const carried = existingFeaturedByKey(dataPath);

  const merged: Row[] = [];
  const perLocale: Record<string, number> = {};
  let featuredCount = 0;
  let carriedCount = 0;

  for (const locale of LOCALES) {
    const rows = readFlatBank(locale);
    perLocale[locale] = rows.length;
    for (const row of rows) {
      const out: Row = { locale };
      for (const field of BANK_FIELDS) {
        const value = row[field];
        if (value === undefined || value === null) continue;
        if (typeof value === "string" && !value.trim()) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        out[field] = value;
      }
      const key = rowKey(locale, row);
      const previous = carried.get(key);
      if (previous !== undefined) carriedCount++;
      out.featured = previous !== undefined ? previous : seedFeatured(row);
      if (out.featured) featuredCount++;
      merged.push(out);
    }
  }

  console.log("contentRoot", CONTENT_ROOT);
  console.log("rowsPerLocale", perLocale);
  console.log("mergedRows", merged.length);
  console.log("featuredRows", featuredCount);
  console.log("featuredCarriedFromPreviousRun", carriedCount);

  if (DRY) {
    console.log("dryRun", true);
    console.log("wouldWrite", [configPath, dataPath]);
    return;
  }

  fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(
    configPath,
    yaml.dump(CONFIG, { lineWidth: 120, noRefs: true, sortKeys: false }),
    "utf-8",
  );
  fs.writeFileSync(
    dataPath,
    yaml.dump(merged, { lineWidth: 120, noRefs: true, sortKeys: false }),
    "utf-8",
  );

  for (const abs of [configPath, dataPath]) {
    markFileAsModified(path.relative(process.cwd(), abs), AUTHOR, undefined, CONTENT_ROOT);
  }

  console.log("wrote", [configPath, dataPath]);
}

main();
