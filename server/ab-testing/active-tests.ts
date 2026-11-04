/**
 * Scan a site's content for versioning.yml files and list locales with traffic on a
 * variant (running tests). The hidden A/B check page is excluded.
 */

import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { getAllDirectories, getType } from "../content-types";
import { TEMPLATE_VERSIONING_SLUG, isTemplateVersioningSlug, versioningContentSlug } from "../shared-layout-entry";
import { isAbCheckPage } from "./state";

export interface ActiveTest {
  contentType: string;
  slug: string;
  locale: string;
  started_at: string | null;
  variants: Array<{ slug: string; allocation: number }>;
  /** Path relative to the content root. */
  file: string;
}

export interface VersioningFileRef {
  contentType: string;
  slug: string;
  /** Absolute path to versioning.yml. */
  absPath: string;
  /** Relative to the content root. */
  file: string;
}

type LocaleBlock = { variants?: Array<{ slug: string; allocation: number }>; started_at?: string };

/** Every versioning.yml in the site (entry folders and type-root templates). */
export function listVersioningFiles(contentRoot: string): VersioningFileRef[] {
  const out: VersioningFileRef[] = [];
  let dirs: string[] = [];
  try {
    dirs = getAllDirectories(contentRoot);
  } catch {
    dirs = [];
  }
  for (const dir of dirs) {
    const typeDir = path.join(contentRoot, dir);
    if (!fs.existsSync(typeDir)) continue;
    let contentType = dir;
    try {
      contentType = getType(dir, contentRoot);
    } catch {
      /* keep directory name */
    }
    const rootFile = path.join(typeDir, "versioning.yml");
    if (fs.existsSync(rootFile)) {
      out.push({ contentType, slug: TEMPLATE_VERSIONING_SLUG, absPath: rootFile, file: path.join(dir, "versioning.yml") });
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(typeDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const file = path.join(typeDir, e.name, "versioning.yml");
      if (fs.existsSync(file)) {
        out.push({ contentType, slug: e.name, absPath: file, file: path.join(dir, e.name, "versioning.yml") });
      }
    }
  }
  return out;
}

export function readVersioningYaml(absPath: string): Record<string, LocaleBlock> | null {
  try {
    const parsed = yaml.load(fs.readFileSync(absPath, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, LocaleBlock>) : null;
  } catch {
    return null;
  }
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; tests: ActiveTest[] }>();

/** Running tests (any variant above 0%), excluding the hidden check page. Cached 60 s. */
export function listActiveTests(contentRoot: string, opts: { fresh?: boolean } = {}): ActiveTest[] {
  const hit = cache.get(contentRoot);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.tests;
  const tests: ActiveTest[] = [];
  for (const ref of listVersioningFiles(contentRoot)) {
    if (isAbCheckPage(ref.contentType, ref.slug, contentRoot)) continue;
    const data = readVersioningYaml(ref.absPath);
    if (!data) continue;
    for (const [locale, block] of Object.entries(data)) {
      const variants = Array.isArray(block?.variants) ? block.variants : [];
      if (!variants.some((v) => v.allocation > 0)) continue;
      tests.push({
        contentType: ref.contentType,
        slug: ref.slug,
        locale,
        started_at: typeof block.started_at === "string" ? block.started_at : null,
        variants,
        file: ref.file,
      });
    }
  }
  cache.set(contentRoot, { at: Date.now(), tests });
  return tests;
}

export type EntryActiveTest = { started_at: string | null; versions: string[]; shared_template: boolean };

/**
 * Looks up the running test for an entry's language. Entries on a shared template resolve to the
 * template's test. Built once per call site from the 60 s cached list.
 */
export function makeActiveTestLookup(contentRoot: string): (contentType: string, slug: string, locale: string) => EntryActiveTest | null {
  const byKey = new Map<string, ActiveTest>();
  for (const t of listActiveTests(contentRoot)) byKey.set(`${t.contentType}\u0001${t.slug}\u0001${t.locale}`, t);
  return (contentType, slug, locale) => {
    if (byKey.size === 0) return null;
    let vslug = slug;
    try {
      vslug = versioningContentSlug(contentType, slug, contentRoot);
    } catch {
      /* keep entry slug */
    }
    const t = byKey.get(`${contentType}\u0001${vslug}\u0001${locale}`);
    if (!t) return null;
    return {
      started_at: t.started_at,
      versions: t.variants.filter((v) => v.allocation > 0).map((v) => v.slug),
      shared_template: isTemplateVersioningSlug(vslug),
    };
  };
}

export function invalidateActiveTestsCache(): void {
  cache.clear();
}
