/**
 * Content-type schema_org_requirements + hero course companion helpers.
 * Used by validators, live SEO gate, CT attach API, and MCP tools.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  countSchemaOrgOfType,
  getSchemaOrgType,
  isSchemaOrgSection,
  schemaOrgInsertIndex,
  clampSchemaOrgSectionsLeading,
} from "@shared/schema-org-sections";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { dumpContentYaml } from "./content-yaml";
import { getContentTypeConfig, getDirectory } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";
import { getBaseUrl } from "./hreflang";
import { buildLocalBusinessSection } from "./schema-org-seed";
import { contentIndex as defaultContentIndex } from "./content-index";

/** Minimal content-index surface for coverage (multi-site routes pass getCI(res)). */
export type SchemaOrgContentIndex = {
  findByType(contentType: string): Array<{ slug: string; locales: string[] }>;
  loadMergedContent(
    contentType: string,
    slug: string,
    locale: string,
  ): { data: unknown | null };
};

export type SchemaOrgRequirement = { schema_type: string };

export type SchemaOrgRequirementGap = {
  kind: "content_type_requirement";
  contentType: string;
  schema_type: string;
  slug: string;
  message: string;
};

export type HeroCourseCompanionGap = {
  kind: "hero_course_companion";
  contentType?: string;
  slug?: string;
  locale?: string;
  message: string;
};

export type SchemaOrgCoverage = {
  contentType: string;
  requirements: SchemaOrgRequirement[];
  schema_type: string;
  present: number;
  total: number;
  missing_slugs: string[];
  present_slugs: string[];
};

function asSections(sections: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(sections)) return [];
  return sections.filter(
    (s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s),
  );
}

export function getContentTypeSchemaOrgRequirements(
  contentType: string,
  contentRoot?: string,
): SchemaOrgRequirement[] {
  const config = getContentTypeConfig(contentType, contentRoot);
  const raw = config?.schema_org_requirements;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is SchemaOrgRequirement => !!r && typeof r === "object" && typeof r.schema_type === "string")
    .map((r) => ({ schema_type: r.schema_type }));
}

/**
 * Gaps for content-type schema_org_requirements given merged page sections.
 * Does not include hero companion checks (see validateHeroCourseCompanions).
 */
export function getSchemaOrgRequirementGaps(
  sections: unknown,
  contentType: string,
  contentRoot?: string,
  opts?: { slug?: string },
): SchemaOrgRequirementGap[] {
  const reqs = getContentTypeSchemaOrgRequirements(contentType, contentRoot);
  if (reqs.length === 0) return [];
  const list = asSections(sections);
  const slug = opts?.slug ?? "";
  const gaps: SchemaOrgRequirementGap[] = [];
  for (const req of reqs) {
    if (countSchemaOrgOfType(list, req.schema_type) < 1) {
      gaps.push({
        kind: "content_type_requirement",
        contentType,
        schema_type: req.schema_type,
        slug,
        message:
          `Content type "${contentType}" requires companion schema_org schema_type "${req.schema_type}"` +
          (slug ? ` on entry "${slug}"` : ""),
      });
    }
  }
  return gaps;
}

/**
 * Hero course (or behaviors.schema_org.requires with when_variant) → Course companion.
 */
export function validateHeroCourseCompanions(
  sections: unknown,
  opts?: { contentType?: string; slug?: string; locale?: string },
): HeroCourseCompanionGap[] {
  const list = asSections(sections);
  let needsCourse = false;

  for (const sec of list) {
    const type = String(sec.type ?? "");
    const variant = typeof sec.variant === "string" ? sec.variant : "";
    if (type === "hero" && variant === "course") {
      needsCourse = true;
      break;
    }
  }

  if (!needsCourse) return [];
  if (countSchemaOrgOfType(list, "Course") >= 1) return [];

  const { contentType, slug, locale } = opts ?? {};
  const parts = [
    contentType ? `content type "${contentType}"` : null,
    slug ? `slug "${slug}"` : null,
    locale ? `locale "${locale}"` : null,
    "hero variant course requires companion schema_org Course section",
  ].filter(Boolean);

  return [
    {
      kind: "hero_course_companion",
      contentType,
      slug,
      locale,
      message: parts.join(": "),
    },
  ];
}

/** Combined companion + CT requirement error string for live SEO gate (null if OK). */
export function formatSchemaOrgCompanionGateError(opts: {
  sections: unknown;
  contentType: string;
  slug: string;
  locale?: string;
  contentRoot?: string;
}): string | null {
  const heroGaps = validateHeroCourseCompanions(opts.sections, {
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
  });
  if (heroGaps.length > 0) return heroGaps[0]!.message;

  const ctGaps = getSchemaOrgRequirementGaps(opts.sections, opts.contentType, opts.contentRoot, {
    slug: opts.slug,
  });
  if (ctGaps.length > 0) return ctGaps[0]!.message;
  return null;
}

function dumpYaml(data: unknown): string {
  const out = dumpContentYaml(data, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
  return out.endsWith("\n") ? out : `${out}\n`;
}

function loadYamlFile(filePath: string): Record<string, unknown> | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { escaped, map } = escapeTemplateVars(raw);
  const parsed = yaml.load(escaped);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return unescapeObjectVars(parsed, map) as Record<string, unknown>;
}

function isLocaleLikeYaml(filename: string): boolean {
  if (filename.startsWith("_")) return false;
  if (filename === "versioning.yml" || filename === "versioning.yaml") return false;
  if (filename === "ecommerce.yml" || filename === "ecommerce.yaml") return false;
  return filename.endsWith(".yml") || filename.endsWith(".yaml");
}

function readCommonMeta(
  entryDir: string,
): { region?: string; name?: string; city?: string } {
  const commonPath = path.join(entryDir, "_common.yml");
  if (!fs.existsSync(commonPath)) return {};
  try {
    const doc = loadYamlFile(commonPath);
    if (!doc) return {};
    return {
      region: typeof doc.region === "string" ? doc.region : undefined,
      name: typeof doc.name === "string" ? doc.name : undefined,
      city: typeof doc.city === "string" ? doc.city : undefined,
    };
  } catch {
    return {};
  }
}

function buildSeededSection(opts: {
  schemaType: string;
  contentType: string;
  slug: string;
  contentRoot: string;
  region?: string;
  locationName?: string;
}): Record<string, unknown> {
  if (opts.schemaType === "LocalBusiness") {
    return buildLocalBusinessSection({
      locationSlug: opts.slug,
      locationName: opts.locationName || opts.slug,
      region: opts.region,
      siteUrl: getBaseUrl(),
      contentRoot: opts.contentRoot,
    });
  }
  return {
    type: "schema_org",
    version: "1.0",
    section_id: `schema-org-${opts.schemaType.toLowerCase()}-${opts.slug}`,
    schema_type: opts.schemaType,
    properties: {},
  };
}

export type EnsureSchemaOrgResult = {
  slug: string;
  schema_type: string;
  status: "added" | "already_present" | "skipped" | "error";
  files?: string[];
  reason?: string;
};

/**
 * Ensure a leading schema_org section of `schemaType` exists on live locale YAML
 * for one entry. Seeds LocalBusiness from catalog / miami-madrid templates.
 */
export function ensureSchemaOrgSectionOnEntry(opts: {
  contentType: string;
  slug: string;
  schemaType: string;
  contentRoot?: string;
  author?: string;
  dryRun?: boolean;
}): EnsureSchemaOrgResult {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  const rootAbs = path.isAbsolute(contentRoot)
    ? contentRoot
    : path.join(process.cwd(), contentRoot);
  const contentRootFolder = path.relative(process.cwd(), rootAbs) || contentRoot;
  const directory = getDirectory(opts.contentType, contentRoot);
  const entryDir = path.join(rootAbs, directory, opts.slug);

  if (!fs.existsSync(entryDir)) {
    return {
      slug: opts.slug,
      schema_type: opts.schemaType,
      status: "error",
      reason: `Entry directory not found: ${directory}/${opts.slug}`,
    };
  }

  const yamlFiles = fs
    .readdirSync(entryDir)
    .filter((name) => isLocaleLikeYaml(name))
    .sort();

  if (yamlFiles.length === 0) {
    return {
      slug: opts.slug,
      schema_type: opts.schemaType,
      status: "skipped",
      reason: "no live locale YAML files",
    };
  }

  // Already present on every locale file that has sections?
  let filesNeeding = 0;
  for (const filename of yamlFiles) {
    const absPath = path.join(entryDir, filename);
    try {
      const doc = loadYamlFile(absPath);
      if (!doc) continue;
      const sections = asSections(doc.sections);
      if (countSchemaOrgOfType(sections, opts.schemaType) < 1) filesNeeding++;
    } catch {
      filesNeeding++;
    }
  }
  if (filesNeeding === 0) {
    return {
      slug: opts.slug,
      schema_type: opts.schemaType,
      status: "already_present",
    };
  }

  const meta = readCommonMeta(entryDir);
  const locationName = meta.name || meta.city || opts.slug;
  const seeded = buildSeededSection({
    schemaType: opts.schemaType,
    contentType: opts.contentType,
    slug: opts.slug,
    contentRoot,
    region: meta.region,
    locationName,
  });

  const files: string[] = [];
  for (const filename of yamlFiles) {
    const absPath = path.join(entryDir, filename);
    try {
      const doc = loadYamlFile(absPath);
      if (!doc) continue;
      if (!Array.isArray(doc.sections)) {
        doc.sections = [];
      }
      const sections = doc.sections as unknown[];
      if (countSchemaOrgOfType(asSections(sections), opts.schemaType) >= 1) {
        continue;
      }
      const insertAt = schemaOrgInsertIndex(sections);
      sections.splice(insertAt, 0, seeded);
      doc.sections = clampSchemaOrgSectionsLeading(sections);
      if (!opts.dryRun) {
        fs.writeFileSync(absPath, dumpYaml(doc), "utf-8");
        markFileAsModified(absPath, opts.author ?? "ensure-schema-org", undefined, contentRootFolder);
      }
      files.push(path.join(directory, opts.slug, filename));
    } catch (err) {
      return {
        slug: opts.slug,
        schema_type: opts.schemaType,
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (files.length === 0) {
    return {
      slug: opts.slug,
      schema_type: opts.schemaType,
      status: "already_present",
    };
  }

  return {
    slug: opts.slug,
    schema_type: opts.schemaType,
    status: "added",
    files,
  };
}

/** Coverage of a CT schema_org_requirement across all entries. */
export function getSchemaOrgRequirementCoverage(
  contentType: string,
  schemaType: string,
  contentRoot?: string,
  ci: SchemaOrgContentIndex = defaultContentIndex,
): SchemaOrgCoverage {
  const root = contentRoot ?? getDefaultContentRoot();
  const requirements = getContentTypeSchemaOrgRequirements(contentType, root);
  const entries = ci.findByType(contentType);
  const present_slugs: string[] = [];
  const missing_slugs: string[] = [];

  for (const entry of entries) {
    let has = false;
    for (const locale of entry.locales) {
      if (locale.startsWith("_") || locale.includes(".")) continue;
      try {
        const { data } = ci.loadMergedContent(contentType, entry.slug, locale);
        const sections = asSections((data as Record<string, unknown> | null)?.sections);
        if (countSchemaOrgOfType(sections, schemaType) >= 1) {
          has = true;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (has) present_slugs.push(entry.slug);
    else missing_slugs.push(entry.slug);
  }

  present_slugs.sort();
  missing_slugs.sort();

  return {
    contentType,
    requirements,
    schema_type: schemaType,
    present: present_slugs.length,
    total: entries.length,
    missing_slugs,
    present_slugs,
  };
}

/** Ensure schema_org of schemaType on all missing entries of a content type. */
export function ensureContentTypeSchemaOrg(opts: {
  contentType: string;
  schemaType: string;
  contentRoot?: string;
  author?: string;
  dryRun?: boolean;
  slugs?: string[];
  ci?: SchemaOrgContentIndex;
}): {
  contentType: string;
  schema_type: string;
  results: EnsureSchemaOrgResult[];
  added: number;
  already_present: number;
  errors: number;
} {
  const coverage = getSchemaOrgRequirementCoverage(
    opts.contentType,
    opts.schemaType,
    opts.contentRoot,
    opts.ci,
  );
  const targets = opts.slugs?.length
    ? opts.slugs
    : coverage.missing_slugs;

  const results: EnsureSchemaOrgResult[] = [];
  let added = 0;
  let already_present = 0;
  let errors = 0;

  for (const slug of targets) {
    const r = ensureSchemaOrgSectionOnEntry({
      contentType: opts.contentType,
      slug,
      schemaType: opts.schemaType,
      contentRoot: opts.contentRoot,
      author: opts.author,
      dryRun: opts.dryRun,
    });
    results.push(r);
    if (r.status === "added") added++;
    else if (r.status === "already_present") already_present++;
    else if (r.status === "error") errors++;
  }

  return {
    contentType: opts.contentType,
    schema_type: opts.schemaType,
    results,
    added,
    already_present,
    errors,
  };
}

/** True when a schema_org section is a page-level WebSite/Organization override. */
export function isSchemaOrgSiteTemplateOverride(section: unknown): "WebSite" | "Organization" | null {
  if (!isSchemaOrgSection(section)) return null;
  const t = getSchemaOrgType(section as Record<string, unknown>);
  if (t === "WebSite" || t === "Organization") return t;
  return null;
}
