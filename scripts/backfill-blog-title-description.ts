/**
 * One-shot: backfill blog entry title/description when description is empty.
 * Skips posts that already have a non-empty description (unless --repair).
 *
 * Usage:
 *   npx tsx scripts/backfill-blog-title-description.ts
 *   npx tsx scripts/backfill-blog-title-description.ts --repair
 *
 * --repair: re-pick title (and fill empty meta) for posts whose listing title is
 *   bad / CTA garbage even when description is already set. Does not rewrite
 *   descriptions that are already non-empty.
 */
import fs from "fs";
import path from "path";
import { dumpContentYaml, loadContentYamlObject } from "../server/content-yaml";

const BLOG_ROOT = path.join(process.cwd(), "site_4geeks-com", "blog");
const SITE_SUFFIX_RE = /\s*\|\s*4Geeks\s*$/i;
const REPAIR = process.argv.includes("--repair");

/** English stub / shared-template CTA titles that must never become listing titles. */
const GENERIC_CTA_TITLE_RE =
  /start your ai career|da el siguiente paso hacia tu carrera|join thousands of graduates/i;

function loadYaml(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return loadContentYamlObject(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function dumpYaml(data: Record<string, unknown>): string {
  return dumpContentYaml(data, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && !/\{\{/.test(v);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateSeo(text: string, max = 158): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

function cleanPageTitle(pageTitle: string): string {
  return pageTitle.replace(SITE_SUFFIX_RE, "").trim();
}

function isGenericCtaTitle(title: string): boolean {
  return GENERIC_CTA_TITLE_RE.test(title.trim());
}

function isBadTitle(title: unknown, slug: string): boolean {
  if (!isNonEmptyString(title)) return true;
  const t = title.trim();
  if (t.length <= 2) return true;
  if (t.toLowerCase() === slug.toLowerCase()) return true;
  if (isGenericCtaTitle(t)) return true;
  return false;
}

function heroTitle(localeData: Record<string, unknown>): string | null {
  const sections = localeData.sections;
  if (!Array.isArray(sections)) return null;
  for (const sec of sections) {
    if (!sec || typeof sec !== "object") continue;
    const s = sec as Record<string, unknown>;
    if (s.type === "hero" && isNonEmptyString(s.title) && !isGenericCtaTitle(s.title)) {
      return s.title.trim();
    }
  }
  return null;
}

function heroSubtitle(localeData: Record<string, unknown>): string | null {
  const sections = localeData.sections;
  if (!Array.isArray(sections)) return null;
  for (const sec of sections) {
    if (!sec || typeof sec !== "object") continue;
    const s = sec as Record<string, unknown>;
    if (s.type === "hero" && isNonEmptyString(s.subtitle)) return s.subtitle.trim();
  }
  return null;
}

function articleLead(localeData: Record<string, unknown>): string | null {
  const sections = localeData.sections;
  if (!Array.isArray(sections)) return null;
  for (const sec of sections) {
    if (!sec || typeof sec !== "object") continue;
    const s = sec as Record<string, unknown>;
    if (s.type === "article" && isNonEmptyString(s.content)) {
      const text = stripHtml(s.content);
      if (text.length > 40) return truncateSeo(text);
    }
  }
  if (isNonEmptyString(localeData.content)) {
    const text = stripHtml(localeData.content);
    if (text.length > 40) return truncateSeo(text);
  }
  return null;
}

function pickDescription(localeData: Record<string, unknown>): string | null {
  const meta = localeData.meta as Record<string, unknown> | undefined;
  if (meta && isNonEmptyString(meta.description) && !isGenericCtaTitle(meta.description)) {
    return meta.description.trim();
  }
  const sub = heroSubtitle(localeData);
  if (sub) return truncateSeo(sub);
  return articleLead(localeData);
}

function pickTitle(localeData: Record<string, unknown>, slug: string): string | null {
  const fromHero = heroTitle(localeData);
  if (fromHero) return fromHero;
  const meta = localeData.meta as Record<string, unknown> | undefined;
  if (meta && isNonEmptyString(meta.page_title)) {
    const cleaned = cleanPageTitle(meta.page_title);
    if (!isBadTitle(cleaned, slug)) return cleaned;
  }
  if (isNonEmptyString(localeData.title) && !isBadTitle(localeData.title, slug)) {
    return localeData.title.trim();
  }
  return null;
}

/** Prefer locales with a real hero title / meta over corrupted EN stubs. */
function scoreLocale(loc: Record<string, unknown>, slug: string): number {
  let score = 0;
  if (heroTitle(loc)) score += 100;
  const meta = loc.meta as Record<string, unknown> | undefined;
  if (meta && isNonEmptyString(meta.description)) score += 50;
  if (meta && isNonEmptyString(meta.page_title)) {
    const cleaned = cleanPageTitle(meta.page_title);
    if (!isBadTitle(cleaned, slug)) score += 30;
  }
  if (articleLead(loc)) score += 20;
  if (heroSubtitle(loc)) score += 10;
  // Penalize obvious object-corruption stubs
  const sections = loc.sections;
  if (Array.isArray(sections)) {
    for (const sec of sections) {
      if (!sec || typeof sec !== "object") continue;
      const title = (sec as Record<string, unknown>).title;
      if (title && typeof title === "object") score -= 80;
    }
  }
  return score;
}

type Stats = {
  scanned: number;
  skipped: number;
  updated: number;
  repaired: number;
  failed: string[];
};

function processSlug(slug: string, stats: Stats): void {
  const dir = path.join(BLOG_ROOT, slug);
  if (!fs.statSync(dir).isDirectory()) return;
  if (slug.startsWith("_")) return;

  const commonPath = path.join(dir, "_common.yml");
  const common = loadYaml(commonPath) || {};

  const localeFiles = fs
    .readdirSync(dir)
    .filter((f) => /^[a-z]{2}(-[a-z]{2})?\.ya?ml$/i.test(f));

  const commonDesc = common.description;
  const hasDescription =
    isNonEmptyString(commonDesc) ||
    localeFiles.some((lf) => {
      const loc = loadYaml(path.join(dir, lf));
      return loc != null && isNonEmptyString(loc.description);
    });

  const titleNeedsRepair = isBadTitle(common.title, slug);

  if (hasDescription && !REPAIR) {
    stats.skipped++;
    return;
  }
  if (hasDescription && REPAIR && !titleNeedsRepair) {
    stats.skipped++;
    return;
  }

  stats.scanned++;

  const locales: { file: string; data: Record<string, unknown>; score: number }[] = [];
  for (const lf of localeFiles) {
    const loc = loadYaml(path.join(dir, lf));
    if (!loc) continue;
    locales.push({ file: lf, data: loc, score: scoreLocale(loc, slug) });
  }
  locales.sort((a, b) => b.score - a.score);

  let bestTitle: string | null = null;
  let bestDesc: string | null = null;
  let primary: { file: string; data: Record<string, unknown> } | null = null;

  for (const { file, data } of locales) {
    if (!primary) primary = { file, data };
    if (!bestTitle) bestTitle = pickTitle(data, slug);
    if (!bestDesc) bestDesc = pickDescription(data);
    if (bestTitle && bestDesc) break;
  }

  // Repair mode: keep existing description; only fix title (+ empty meta)
  if (REPAIR && hasDescription) {
    if (!bestTitle) {
      stats.failed.push(`${slug}: repair — no title source (hero/meta)`);
      return;
    }
    common.title = bestTitle;
    fs.writeFileSync(commonPath, dumpYaml(common), "utf-8");

    if (primary) {
      const fp = path.join(dir, primary.file);
      if (!primary.data.meta || typeof primary.data.meta !== "object") {
        primary.data.meta = {};
      }
      const meta = primary.data.meta as Record<string, unknown>;
      if (!isNonEmptyString(meta.page_title) || isBadTitle(cleanPageTitle(String(meta.page_title)), slug)) {
        meta.page_title = `${bestTitle} | 4Geeks`;
      }
      if (!isNonEmptyString(meta.description) && isNonEmptyString(common.description)) {
        meta.description = String(common.description).trim();
      }
      fs.writeFileSync(fp, dumpYaml(primary.data), "utf-8");
    }

    stats.repaired++;
    console.log(`repaired ${slug}: title=${JSON.stringify(bestTitle).slice(0, 80)}`);
    return;
  }

  if (!bestDesc) {
    // Last resort: derive a short blurb from a usable title / cleaned page_title / slug words
    const titleForDesc =
      bestTitle ||
      (isNonEmptyString(common.title) && !isBadTitle(common.title, slug)
        ? String(common.title).trim()
        : null) ||
      slug.replace(/-/g, " ");
    if (titleForDesc && titleForDesc.length > 8) {
      bestDesc = truncateSeo(
        `Guía sobre ${titleForDesc.trim()}: conceptos clave, contexto y tips prácticos para empezar.`,
      );
    } else {
      stats.failed.push(`${slug}: no description source (meta/hero/article)`);
      return;
    }
  }
  if (!bestTitle) {
    bestTitle = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  common.title = bestTitle;
  common.description = bestDesc;
  fs.writeFileSync(commonPath, dumpYaml(common), "utf-8");

  if (primary) {
    const fp = path.join(dir, primary.file);
    if (!primary.data.meta || typeof primary.data.meta !== "object") {
      primary.data.meta = {};
    }
    const meta = primary.data.meta as Record<string, unknown>;
    if (!isNonEmptyString(meta.page_title) || isBadTitle(cleanPageTitle(String(meta.page_title)), slug)) {
      meta.page_title = `${bestTitle} | 4Geeks`;
    }
    if (!isNonEmptyString(meta.description)) {
      meta.description = bestDesc;
    }
    if (!isNonEmptyString(primary.data.title) || isBadTitle(primary.data.title, slug)) {
      if (!Array.isArray(primary.data.sections) || primary.data.sections.length === 0) {
        primary.data.title = bestTitle;
      }
    }
    if (
      !isNonEmptyString(primary.data.description) &&
      (!Array.isArray(primary.data.sections) || primary.data.sections.length === 0)
    ) {
      primary.data.description = bestDesc;
    }
    fs.writeFileSync(fp, dumpYaml(primary.data), "utf-8");
  }

  stats.updated++;
  console.log(`updated ${slug}: title=${JSON.stringify(bestTitle).slice(0, 60)}…`);
}

function main(): void {
  if (!fs.existsSync(BLOG_ROOT)) {
    console.error("Blog root not found:", BLOG_ROOT);
    process.exit(1);
  }
  const stats: Stats = { scanned: 0, skipped: 0, updated: 0, repaired: 0, failed: [] };
  const slugs = fs.readdirSync(BLOG_ROOT).filter((s) => {
    const p = path.join(BLOG_ROOT, s);
    return fs.statSync(p).isDirectory() && !s.startsWith("_");
  });

  for (const slug of slugs) {
    try {
      processSlug(slug, stats);
    } catch (err) {
      stats.failed.push(`${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: REPAIR ? "repair" : "backfill",
        skipped: stats.skipped,
        considered: stats.scanned,
        updated: stats.updated,
        repaired: stats.repaired,
        failed: stats.failed,
      },
      null,
      2,
    ),
  );
  if (stats.failed.length > 0) process.exitCode = 1;
}

main();
