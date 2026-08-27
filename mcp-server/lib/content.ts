import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  assertNoRegistryCollisions,
  listMergedComponentTypes,
  resolveComponentPath,
} from "../../shared/registry-resolve.js";
import {
  resolveComponentBehaviors,
  type ComponentBehaviors,
} from "../../shared/component-behaviors.js";

// ─── Multi-site helpers ───────────────────────────────────────────────────────

export interface SiteConfigMcp {
  domain: string;
  contentFolder: string;
  inheritComponentsFrom?: string;
}

let _mcpSiteConfigsCache: SiteConfigMcp[] | null = null;

/** Clear cached sites.yml parse (tests / hot reload). */
export function resetMcpSiteConfigsCache(): void {
  _mcpSiteConfigsCache = null;
}

/** @internal Test helper — pass null to clear and reload from disk on next read. */
export function setMcpSiteConfigsForTest(configs: SiteConfigMcp[] | null): void {
  _mcpSiteConfigsCache = configs;
}

/**
 * Absolute content folder when callers omit contentPath.
 * Sole site → that folder; multi-site → throw (must pass path from resolveSiteContext).
 */
export function getDefaultContentPath(): string {
  const configs = getMcpSiteConfigs();
  if (configs.length === 1) {
    return path.join(process.cwd(), configs[0].contentFolder);
  }
  throw new Error(
    "Multi-site: content path required. Pass contentPath from resolveSiteContext (supply the site domain parameter).",
  );
}

export function getContentTypesPath(): string {
  return path.join(getDefaultContentPath(), "content-types.yml");
}

export function getComponentRegistryPath(): string {
  return path.join(getDefaultContentPath(), "component-registry");
}

const SITES_YML_EXAMPLE = `# sites.yml — required at repo root
example.com:
  content_folder: site_example-com
  github_repo_url: https://github.com/org/example-content
`;

export function formatSitesYmlRequiredError(reason: string): string {
  return [
    "sites.yml is required but could not be loaded.",
    "",
    `Reason: ${reason}`,
    "",
    "Create sites.yml at the project root with at least one site entry.",
    "See INSTALL.md (Site content folders) for setup steps.",
    "",
    "Expected format:",
    SITES_YML_EXAMPLE.trimEnd(),
  ].join("\n");
}

function parseSitesYml(): SiteConfigMcp[] {
  const sitesYml = path.join(process.cwd(), "sites.yml");

  if (!fs.existsSync(sitesYml)) {
    throw new Error(formatSitesYmlRequiredError("sites.yml not found at project root"));
  }

  let parsed: Record<string, unknown> | null;
  try {
    const raw = fs.readFileSync(sitesYml, "utf-8");
    parsed = yaml.load(raw) as Record<string, unknown> | null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(formatSitesYmlRequiredError(`failed to parse sites.yml: ${msg}`));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(formatSitesYmlRequiredError("sites.yml must be a YAML mapping (object), not an array or scalar"));
  }

  const configs: SiteConfigMcp[] = [];
  for (const [domain, config] of Object.entries(parsed)) {
    if (domain === "bucket_name") continue;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(
        formatSitesYmlRequiredError(
          `site "${domain}" must be a YAML mapping with content_folder (got ${config === null ? "null" : Array.isArray(config) ? "array" : typeof config})`,
        ),
      );
    }
    const c = config as Record<string, unknown>;
    const contentFolder =
      (typeof c.content_folder === "string" && c.content_folder.trim()) ||
      (typeof c.contentFolder === "string" && c.contentFolder.trim()) ||
      "";
    if (!contentFolder) {
      throw new Error(formatSitesYmlRequiredError(`site "${domain}" is missing required content_folder`));
    }
    configs.push({
      domain,
      contentFolder,
      inheritComponentsFrom:
        (typeof c.inherit_components_from === "string" && c.inherit_components_from.trim()) ||
        (typeof c.inheritComponentsFrom === "string" && c.inheritComponentsFrom.trim()) ||
        undefined,
    });
  }

  if (configs.length === 0) {
    throw new Error(formatSitesYmlRequiredError("sites.yml contains no site entries (add at least one domain block)"));
  }

  return configs;
}

export function getMcpSiteConfigs(): SiteConfigMcp[] {
  if (_mcpSiteConfigsCache) return _mcpSiteConfigsCache;
  _mcpSiteConfigsCache = parseSitesYml();
  return _mcpSiteConfigsCache;
}

export function listMcpSites(): Array<{ domain: string; contentFolder: string }> {
  return getMcpSiteConfigs().map((c) => ({ domain: c.domain, contentFolder: c.contentFolder }));
}

/** True when more than one site is configured (UI / MCP param requirements). */
export function hasMultipleSites(): boolean {
  return getMcpSiteConfigs().length > 1;
}

/** @deprecated Use hasMultipleSites() */
export function isMultiSiteMode(): boolean {
  return hasMultipleSites();
}

export type SiteContextResult =
  | { ok: true; contentPath: string; contentFolder: string; domain: string }
  | { ok: false; error: string };

/**
 * Resolve a site domain to its absolute content path.
 * When one site is configured, domain is optional (but if provided must match).
 * When multiple sites are configured, domain is required.
 * Domain matching is case-insensitive.
 */
export function resolveSiteContext(domain?: string): SiteContextResult {
  const configs = getMcpSiteConfigs();
  const normalized = typeof domain === "string" ? domain.trim() : "";

  if (configs.length === 1) {
    const cfg = configs[0];
    if (normalized && cfg.domain.toLowerCase() !== normalized.toLowerCase()) {
      return {
        ok: false,
        error: JSON.stringify({
          error: "unknown_site",
          message: `Unknown site '${normalized}'. See available_sites for valid options.`,
          available_sites: configs.map((c) => c.domain),
          requested_site: normalized,
        }),
      };
    }
    return {
      ok: true,
      contentPath: path.join(process.cwd(), cfg.contentFolder),
      contentFolder: cfg.contentFolder,
      domain: cfg.domain,
    };
  }

  if (!normalized) {
    return {
      ok: false,
      error: JSON.stringify({
        error: "multi_site_domain_required",
        message:
          "This server manages multiple sites. You must supply the 'site' parameter (domain) to target the correct content folder.",
        available_sites: configs.map((c) => c.domain),
      }),
    };
  }

  const cfg = configs.find((c) => c.domain.toLowerCase() === normalized.toLowerCase());
  if (!cfg) {
    return {
      ok: false,
      error: JSON.stringify({
        error: "unknown_site",
        message: `Unknown site '${normalized}'. See available_sites for valid options.`,
        available_sites: configs.map((c) => c.domain),
        requested_site: normalized,
      }),
    };
  }

  return {
    ok: true,
    contentPath: path.join(process.cwd(), cfg.contentFolder),
    contentFolder: cfg.contentFolder,
    domain: cfg.domain,
  };
}

// ─── YAML helpers ─────────────────────────────────────────────────────────────

export function safeLoad(raw: string): Record<string, unknown> | null {
  try {
    // Template expressions like {{ ratio | 7:1 }} contain characters (e.g. ":")
    // that break YAML parsing. Swap them out for safe placeholders, parse, then
    // restore so callers receive the original template strings intact.
    const templates: string[] = [];
    const sanitized = raw.replace(/\{\{[^}]*\}\}/g, (match) => {
      templates.push(match);
      return `__TPL_${templates.length - 1}__`;
    });

    const parsed = (yaml.load(sanitized) as Record<string, unknown>) || null;
    if (!parsed || templates.length === 0) return parsed;

    function restore(val: unknown): unknown {
      if (typeof val === "string")
        return val.replace(/__TPL_(\d+)__/g, (_, i) => templates[parseInt(i)]);
      if (Array.isArray(val)) return val.map(restore);
      if (val && typeof val === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val as Record<string, unknown>))
          out[k] = restore(v);
        return out;
      }
      return val;
    }

    return restore(parsed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function safeDump(obj: unknown): string {
  return yaml.dump(obj, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
}

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof result[k] === "object" &&
      result[k] !== null &&
      !Array.isArray(result[k])
    ) {
      result[k] = deepMerge(result[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ─── Content type helpers ─────────────────────────────────────────────────────

export interface ContentTypeConfig {
  directory?: string;
  url_pattern?: Record<string, string>;
  database?: { slug: string };
  field_mapping?: Record<string, unknown>;
  layout?: unknown;
  single_template?: boolean;
  editor?: Record<string, {
    required?: boolean | "attached";
    type?: string;
    allow_custom_values?: boolean;
    populate_options?: boolean;
    description?: string;
    fill_intent?: unknown;
  }>;
  indexes?: string[];
  schema_org_requirements?: Array<{ schema_type: string }>;
  strategy?: { purpose: string; constraints?: string[] };
}

export function loadContentTypes(contentPath?: string): Record<string, ContentTypeConfig> {
  const ctPath = contentPath
    ? path.join(contentPath, "content-types.yml")
    : getContentTypesPath();
  if (!fs.existsSync(ctPath)) return {};
  const raw = fs.readFileSync(ctPath, "utf-8");
  return (safeLoad(raw) as Record<string, ContentTypeConfig>) || {};
}

export function isDbBacked(config: ContentTypeConfig): boolean {
  return !!config?.database?.slug;
}

export function isSharedLayoutConfig(config: ContentTypeConfig): boolean {
  return !!(config?.database?.slug || config?.single_template);
}

export function getDirectory(contentType: string, config: ContentTypeConfig): string {
  return config.directory || contentType;
}

export function resolveContentType(
  slug: string,
  hintContentType?: string,
  contentPath?: string,
  opts?: { allowSharedLayout?: boolean },
): { contentType: string; config: ContentTypeConfig } | null {
  const basePath = contentPath || getDefaultContentPath();
  const configs = loadContentTypes(contentPath);
  const allowShared = opts?.allowSharedLayout === true;

  if (hintContentType) {
    const config = configs[hintContentType];
    if (!config) return null;
    if (isDbBacked(config) && !allowShared) return null;
    if (allowShared && isSharedLayoutConfig(config)) {
      // DB-backed / single_template: slug may be an entry or the sentinel template|single
      if (slug === "single" || slug === "template") {
        const typeDir = path.join(basePath, getDirectory(hintContentType, config));
        const candidates = [
          "template.en.yml",
          "template.es.yml",
          "single.en.yml",
          "single.es.yml",
        ];
        if (candidates.some((n) => fs.existsSync(path.join(typeDir, n)))) {
          return { contentType: hintContentType, config };
        }
      }
      const dir = path.join(basePath, getDirectory(hintContentType, config), slug);
      if (fs.existsSync(dir) || isDbBacked(config)) {
        return { contentType: hintContentType, config };
      }
      return null;
    }
    const dir = path.join(basePath, getDirectory(hintContentType, config), slug);
    if (fs.existsSync(dir)) return { contentType: hintContentType, config };
    return null;
  }
  for (const [ct, config] of Object.entries(configs)) {
    if (isDbBacked(config) && !allowShared) continue;
    if (allowShared && (slug === "single" || slug === "template") && isSharedLayoutConfig(config)) {
      return { contentType: ct, config };
    }
    const dir = path.join(basePath, getDirectory(ct, config), slug);
    if (fs.existsSync(dir)) return { contentType: ct, config };
  }
  return null;
}

// ─── Page helpers ─────────────────────────────────────────────────────────────

export interface VersioningVariant {
  slug: string;
  allocation: number;
}

export interface VersioningLocale {
  variants: VersioningVariant[];
}

export type VersioningData = Record<string, VersioningLocale>;

export function loadVersioning(contentType: string, slug: string, contentPath?: string): VersioningData | null {
  const basePath = contentPath || getDefaultContentPath();
  const configs = loadContentTypes(contentPath);
  const config = configs[contentType];
  if (!config || isDbBacked(config)) return null;
  const dir = path.join(basePath, getDirectory(contentType, config), slug);
  const versioningPath = path.join(dir, "versioning.yml");
  if (!fs.existsSync(versioningPath)) return null;
  const parsed = safeLoad(fs.readFileSync(versioningPath, "utf-8"));
  if (!parsed) return null;
  return parsed as VersioningData;
}

export function loadVariantPage(
  contentType: string,
  slug: string,
  locale: string,
  variantSlug: string,
  contentPath?: string,
): { data: Record<string, unknown>; filePath: string } | null {
  const basePath = contentPath || getDefaultContentPath();
  const configs = loadContentTypes(contentPath);
  const config = configs[contentType];
  if (!config || isDbBacked(config)) return null;

  const dir = path.join(basePath, getDirectory(contentType, config), slug);
  if (!fs.existsSync(dir)) return null;

  const commonPath = path.join(dir, "_common.yml");
  const variantPath = path.join(dir, `${variantSlug}.${locale}.yml`);

  let commonData: Record<string, unknown> = {};
  if (fs.existsSync(commonPath)) {
    commonData = safeLoad(fs.readFileSync(commonPath, "utf-8")) || {};
  }

  if (!fs.existsSync(variantPath)) return null;
  const variantData = safeLoad(fs.readFileSync(variantPath, "utf-8")) || {};

  return {
    data: deepMerge(commonData, variantData),
    filePath: variantPath,
  };
}

export interface PageEntry {
  slug: string;
  contentType: string;
  directory: string;
  locales: string[];
  title?: string;
  urls?: Record<string, string>;
  variants?: Array<{ locale: string; slug: string; allocation: number }>;
}

export function scanPages(contentPath?: string): PageEntry[] {
  const basePath = contentPath || getDefaultContentPath();
  const contentFolder = path.basename(basePath);
  const configs = loadContentTypes(contentPath);
  const pages: PageEntry[] = [];

  for (const [contentType, config] of Object.entries(configs)) {
    if (isDbBacked(config)) continue;

    const dir = path.join(basePath, getDirectory(contentType, config));
    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      const files = fs.readdirSync(entryPath).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
      if (files.length === 0) continue;

      const locales = files
        .map(f => f.replace(/\.(yml|yaml)$/, ""))
        .filter(n => /^[a-z]{2}(-[a-z]{2})?$/.test(n));

      let title: string | undefined;
      for (const candidate of ["_common.yml", "_common.yaml", "en.yml", "en.yaml"]) {
        if (files.includes(candidate)) {
          try {
            const parsed = safeLoad(fs.readFileSync(path.join(entryPath, candidate), "utf-8"));
            if (parsed?.title && typeof parsed.title === "string") { title = parsed.title; break; }
            if (parsed?.name && typeof parsed.name === "string") { title = parsed.name; break; }
          } catch { /* ignore */ }
        }
      }

      const localeSlug: Record<string, string> = {};
      for (const locale of locales) {
        for (const ext of ["yml", "yaml"]) {
          const localeFile = `${locale}.${ext}`;
          if (!files.includes(localeFile)) continue;
          try {
            const parsed = safeLoad(fs.readFileSync(path.join(entryPath, localeFile), "utf-8"));
            const candidate = parsed?.slug;
            if (typeof candidate === "string" && candidate.trim()) {
              localeSlug[locale] = candidate.trim();
            }
          } catch {
            // Keep fallback behavior when locale file is malformed.
          }
          break;
        }
      }

      let urls: Record<string, string> | undefined;
      if (config.url_pattern) {
        const pattern = config.url_pattern;
        const resolved: Record<string, string> = {};
        if (pattern["default"]) {
          for (const locale of locales) {
            const slugForLocale = localeSlug[locale] || entry.name;
            resolved[locale] = pattern["default"].replace(":slug", slugForLocale);
          }
        } else {
          for (const locale of locales) {
            if (!pattern[locale]) continue;
            const slugForLocale = localeSlug[locale] || entry.name;
            resolved[locale] = pattern[locale].replace(":slug", slugForLocale);
          }
        }
        if (Object.keys(resolved).length > 0) urls = resolved;
      }

      const versioning = loadVersioning(contentType, entry.name, contentPath);
      let variants: Array<{ locale: string; slug: string; allocation: number }> | undefined;
      if (versioning) {
        const variantList: Array<{ locale: string; slug: string; allocation: number }> = [];
        for (const [locale, localeData] of Object.entries(versioning)) {
          for (const v of localeData.variants || []) {
            variantList.push({ locale, slug: v.slug, allocation: v.allocation });
          }
        }
        if (variantList.length > 0) variants = variantList;
      }

      pages.push({
        slug: entry.name,
        contentType,
        directory: `${contentFolder}/${getDirectory(contentType, config)}/${entry.name}`,
        locales,
        title,
        ...(urls ? { urls } : {}),
        ...(variants ? { variants } : {}),
      });
    }
  }
  return pages;
}

export function loadPage(
  contentType: string,
  slug: string,
  locale: string,
  contentPath?: string,
): { data: Record<string, unknown>; filePath: string } | null {
  const basePath = contentPath || getDefaultContentPath();
  const configs = loadContentTypes(contentPath);
  const config = configs[contentType];
  if (!config || isDbBacked(config)) return null;

  const dir = path.join(basePath, getDirectory(contentType, config), slug);
  if (!fs.existsSync(dir)) return null;

  const commonPath = path.join(dir, "_common.yml");
  const localePath = path.join(dir, `${locale}.yml`);

  let commonData: Record<string, unknown> = {};
  if (fs.existsSync(commonPath)) {
    commonData = safeLoad(fs.readFileSync(commonPath, "utf-8")) || {};
  }

  if (!fs.existsSync(localePath)) return null;
  const localeData = safeLoad(fs.readFileSync(localePath, "utf-8")) || {};

  return {
    data: deepMerge(commonData, localeData),
    filePath: localePath,
  };
}

export function getValueAtPath(obj: Record<string, unknown>, pathStr: string): unknown {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setValueAtPath(obj: Record<string, unknown>, pathStr: string, value: unknown): void {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || typeof current[part] !== "object") {
      current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

// ─── Component registry helpers ───────────────────────────────────────────────
// Kept in lib/content.ts alongside page helpers because both operate on the
// same content tree and share safeLoad/safeDump. Tools that need
// them import from here rather than from tools/components.ts to avoid cycles.

export interface ComponentVariantInfo {
  name: string;
}

export interface ComponentInfo {
  type: string;
  version: string;
  name?: string;
  description?: string;
  variants?: ComponentVariantInfo[];
  origin?: "shared" | "site";
}

function contentFolderFromPath(contentPath?: string): string {
  if (!contentPath) {
    // resolveSiteContext always passes contentPath in normal flow
    return path.basename(getDefaultContentPath());
  }
  return path.isAbsolute(contentPath)
    ? path.basename(contentPath)
    : contentPath;
}

function readSchemaMeta(schemaYml: string): {
  name?: string;
  description?: string;
  variants?: ComponentVariantInfo[];
} {
  let name: string | undefined;
  let description: string | undefined;
  let variants: ComponentVariantInfo[] | undefined;
  if (!fs.existsSync(schemaYml)) return {};
  const parsed = safeLoad(fs.readFileSync(schemaYml, "utf-8"));
  if (!parsed) return {};
  name = typeof parsed.name === "string" ? parsed.name : undefined;
  description = typeof parsed.description === "string" ? parsed.description : undefined;
  if (parsed.variants && typeof parsed.variants === "object" && !Array.isArray(parsed.variants)) {
    const variantsMap = parsed.variants as Record<string, unknown>;
    variants = Object.entries(variantsMap).map(([variantName]) => ({ name: variantName }));
  } else if (Array.isArray(parsed.variants)) {
    variants = (parsed.variants as unknown[]).map(v => ({ name: String(v) }));
  }
  return { name, description, variants };
}

function inheritForFolder(contentFolder: string): string | undefined {
  const want = contentFolder.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const c of getMcpSiteConfigs()) {
    const folder = c.contentFolder.replace(/\\/g, "/").replace(/\/+$/, "");
    if (folder === want) return c.inheritComponentsFrom;
  }
  return undefined;
}

export function listComponents(contentPath?: string): ComponentInfo[] {
  const folder = contentFolderFromPath(contentPath);
  const inherit = inheritForFolder(folder);
  assertNoRegistryCollisions(folder, process.cwd(), inherit);
  const components: ComponentInfo[] = [];

  for (const entry of listMergedComponentTypes(folder, process.cwd(), inherit)) {
    const versionDirs = fs
      .readdirSync(entry.componentDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^v\d/.test(d.name));

    for (const vDir of versionDirs) {
      const schemaYml = path.join(entry.componentDir, vDir.name, "schema.yml");
      const meta = readSchemaMeta(schemaYml);
      components.push({
        type: entry.type,
        version: vDir.name,
        ...meta,
        origin: entry.origin,
      });
    }
  }

  return components.sort((a, b) => a.type.localeCompare(b.type));
}

export interface ComponentVariantSummary {
  name: string;
  description?: string;
  best_for?: string;
}

export interface ComponentSchemaSlim {
  name: string | null;
  description: string | null;
  when_to_use: string | null;
  variants: ComponentVariantSummary[];
  behaviors?: ComponentBehaviors;
}

export function getComponentSchema(componentType: string, contentPath?: string): ComponentSchemaSlim | null {
  const folder = contentFolderFromPath(contentPath);
  const resolved = resolveComponentPath(componentType, folder, process.cwd(), inheritForFolder(folder));
  if (!resolved) return null;

  const versionDirs = fs
    .readdirSync(resolved.componentDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^v\d/.test(d.name))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (versionDirs.length === 0) return null;

  const latestVersion = versionDirs[0].name;
  const versionPath = path.join(resolved.componentDir, latestVersion);

  const schemaYml = path.join(versionPath, "schema.yml");
  if (!fs.existsSync(schemaYml)) return null;

  const parsed = safeLoad(fs.readFileSync(schemaYml, "utf-8"));
  if (!parsed) return null;

  const name = typeof parsed.name === "string" ? parsed.name : null;
  const description = typeof parsed.description === "string" ? parsed.description : null;
  const when_to_use = typeof parsed.when_to_use === "string" ? parsed.when_to_use : null;

  const variants: ComponentVariantSummary[] = [];
  if (parsed.variants && typeof parsed.variants === "object" && !Array.isArray(parsed.variants)) {
    for (const [variantName, variantDef] of Object.entries(parsed.variants as Record<string, unknown>)) {
      const def = variantDef as Record<string, unknown> | null;
      const entry: ComponentVariantSummary = { name: variantName };
      if (def && typeof def.description === "string") entry.description = def.description;
      if (def && typeof def.best_for === "string") entry.best_for = def.best_for;
      variants.push(entry);
    }
  } else if (Array.isArray(parsed.variants)) {
    for (const v of parsed.variants) {
      if (typeof v === "string") {
        variants.push({ name: v });
      } else if (v && typeof v === "object") {
        const def = v as Record<string, unknown>;
        if (typeof def.name !== "string") continue;
        const entry: ComponentVariantSummary = { name: def.name };
        if (typeof def.description === "string") entry.description = def.description;
        if (typeof def.best_for === "string") entry.best_for = def.best_for;
        variants.push(entry);
      }
    }
  }

  if (variants.length === 0) {
    variants.push({ name: "default", description: "Default (single-variant) component" });
  }

  const behaviors = resolveComponentBehaviors(parsed as Record<string, unknown>);
  const hasBehaviors = Object.keys(behaviors).length > 0;

  return {
    name,
    description,
    when_to_use,
    variants,
    ...(hasBehaviors ? { behaviors } : {}),
  };
}

export interface ComponentVariantDetail {
  componentType: string;
  variant: string;
  variant_props: Record<string, unknown> | null;
  example: string | null;
}

export function getComponentVariant(
  componentType: string,
  variant: string,
  contentPath?: string,
): ComponentVariantDetail | null {
  const folder = contentFolderFromPath(contentPath);
  const resolved = resolveComponentPath(componentType, folder, process.cwd(), inheritForFolder(folder));
  if (!resolved) return null;
  const componentPath = resolved.componentDir;

  const versionDirs = fs
    .readdirSync(componentPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^v\d/.test(d.name))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (versionDirs.length === 0) return null;

  const latestVersion = versionDirs[0].name;
  const versionPath = path.join(componentPath, latestVersion);

  const schemaYml = path.join(versionPath, "schema.yml");
  if (!fs.existsSync(schemaYml)) return null;

  const parsed = safeLoad(fs.readFileSync(schemaYml, "utf-8"));
  if (!parsed) return null;

  const variantsDef = parsed.variants;
  let variantExists = false;
  if (!variantsDef) {
    variantExists = true;
  } else if (typeof variantsDef === "object" && !Array.isArray(variantsDef)) {
    variantExists = variant in (variantsDef as Record<string, unknown>);
  } else if (Array.isArray(variantsDef)) {
    variantExists = variantsDef.some((v: unknown) => {
      if (typeof v === "string") return v === variant;
      if (v && typeof v === "object") return (v as Record<string, unknown>).name === variant;
      return false;
    });
  }
  if (!variantExists) return null;

  let variant_props: Record<string, unknown> | null = null;
  if (
    parsed.variant_props &&
    typeof parsed.variant_props === "object" &&
    !Array.isArray(parsed.variant_props)
  ) {
    const propsMap = parsed.variant_props as Record<string, unknown>;
    if (variant in propsMap && propsMap[variant] && typeof propsMap[variant] === "object") {
      variant_props = propsMap[variant] as Record<string, unknown>;
    }
  }
  if (
    variant_props === null &&
    parsed.props &&
    typeof parsed.props === "object" &&
    !Array.isArray(parsed.props)
  ) {
    variant_props = parsed.props as Record<string, unknown>;
  }
  if (
    variant_props === null &&
    parsed.properties &&
    typeof parsed.properties === "object" &&
    !Array.isArray(parsed.properties)
  ) {
    variant_props = parsed.properties as Record<string, unknown>;
  }

  const variantPattern = new RegExp(`variant:\\s*["']?${variant}["']?(?:\\s|$)`);
  let example: string | null = null;
  const examplesPath = path.join(versionPath, "examples");
  if (fs.existsSync(examplesPath)) {
    const exampleFiles = fs
      .readdirSync(examplesPath)
      .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));

    const extractYaml = (exFile: string): string | null => {
      try {
        const raw = fs.readFileSync(path.join(examplesPath, exFile), "utf-8");
        const exParsed = safeLoad(raw);
        return exParsed?.yaml && typeof exParsed.yaml === "string" ? exParsed.yaml : raw;
      } catch { return null; }
    };

    for (const exFile of exampleFiles) {
      const yamlContent = extractYaml(exFile);
      if (yamlContent && variantPattern.test(yamlContent)) {
        example = yamlContent;
        break;
      }
    }

    if (example === null && exampleFiles.length > 0) {
      example = extractYaml(exampleFiles[0]);
    }
  }

  return { componentType, variant, variant_props, example };
}
