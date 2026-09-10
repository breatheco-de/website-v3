import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { child } from "./logger";
import { getProjectRoot } from "../shared/paths";

const log = child({ module: "site-config" });

export interface SiteConfig {
  domain: string;
  contentFolder: string;
  githubRepoUrl?: string;
  /** When an image_id is missing locally, resolve it from this site's registry. */
  fallbackContentFolder?: string;
  /**
   * Use this site's component-registry (schema / field-editors / examples).
   * One hop only; the parent must own a registry (must not itself inherit).
   * When set, this site must not have a local component-registry/ directory.
   */
  inheritComponentsFrom?: string;
  /** Hostnames that 301-redirect to this site's canonical domain (e.g. ["www.4geeks.com"]). */
  aliases?: string[];
}

let _cached: SiteConfig[] | null = null;
let _bucketName: string | null | undefined = undefined;

const SITES_YML_EXAMPLE = `# sites.yml — required at repo root
#
# bucket_name: my-gcs-bucket   # optional — shared GCS bucket for all sites
#
# example.com:
#   content_folder: site_example-com
#   github_repo_url: https://github.com/org/example-content
#   fallback_content_folder: site_parent-com  # optional — missing images
#   inherit_components_from: site_parent-com  # optional — component-registry

bucket_name: my-gcs-bucket

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
    "Create sites.yml at the project root with at least one site entry (copy sites.yml.example).",
    "See INSTALL.md (Site content folders) for setup steps.",
    "",
    "Expected format:",
    SITES_YML_EXAMPLE.trimEnd(),
  ].join("\n");
}

export class SitesYmlRequiredError extends Error {
  constructor(reason: string) {
    super(formatSitesYmlRequiredError(reason));
    this.name = "SitesYmlRequiredError";
  }
}

function parseSitesYmlContent(raw: string): { configs: SiteConfig[]; bucketName: string | null } {
  let parsed: Record<string, unknown> | null;
  try {
    parsed = yaml.load(raw) as Record<string, unknown> | null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SitesYmlRequiredError(`failed to parse sites.yml: ${msg}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SitesYmlRequiredError("sites.yml must be a YAML mapping (object), not an array or scalar");
  }

  const configs: SiteConfig[] = [];
  let bucketName: string | null = null;

  if (typeof parsed.bucket_name === "string" && parsed.bucket_name) {
    bucketName = parsed.bucket_name;
  }

  for (const [domain, config] of Object.entries(parsed)) {
    if (domain === "bucket_name") continue;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new SitesYmlRequiredError(
        `site "${domain}" must be a YAML mapping with content_folder (got ${config === null ? "null" : Array.isArray(config) ? "array" : typeof config})`,
      );
    }
    const c = config as Record<string, unknown>;
    const contentFolderRaw =
      (typeof c.content_folder === "string" && c.content_folder.trim()) ||
      (typeof c.contentFolder === "string" && c.contentFolder.trim()) ||
      "";
    if (!contentFolderRaw) {
      throw new SitesYmlRequiredError(`site "${domain}" is missing required content_folder`);
    }
    const fallbackFolder =
      (typeof c.fallback_content_folder === "string" && c.fallback_content_folder.trim()) ||
      (typeof c.fallbackContentFolder === "string" && c.fallbackContentFolder.trim()) ||
      undefined;
    const inheritFrom =
      (typeof c.inherit_components_from === "string" && c.inherit_components_from.trim()) ||
      (typeof c.inheritComponentsFrom === "string" && c.inheritComponentsFrom.trim()) ||
      undefined;
    const rawAliases = (c.aliases ?? c.alias) as unknown;
    const aliases = Array.isArray(rawAliases)
      ? rawAliases.filter((a): a is string => typeof a === "string" && a.trim() !== "").map((a) => a.trim().toLowerCase())
      : typeof rawAliases === "string" && rawAliases.trim() !== ""
        ? [rawAliases.trim().toLowerCase()]
        : undefined;
    configs.push({
      domain,
      contentFolder: contentFolderRaw,
      githubRepoUrl: (c.github_repo_url as string) || (c.githubRepoUrl as string) || undefined,
      fallbackContentFolder: fallbackFolder || undefined,
      inheritComponentsFrom: inheritFrom || undefined,
      aliases,
    });
  }

  if (configs.length === 0) {
    throw new SitesYmlRequiredError("sites.yml contains no site entries (add at least one domain block)");
  }

  // Validate aliases: an alias must not be a configured site domain (redirect
  // loop / conflicting ownership) and must not be claimed by two sites.
  const domains = new Set(configs.map((c) => c.domain.toLowerCase()));
  const seenAliases = new Map<string, string>();
  for (const c of configs) {
    for (const alias of c.aliases ?? []) {
      if (domains.has(alias)) {
        throw new SitesYmlRequiredError(`alias "${alias}" (under ${c.domain}) is also a configured site domain — this would create a redirect loop or conflicting ownership`);
      }
      const owner = seenAliases.get(alias);
      if (owner && owner !== c.domain) {
        throw new SitesYmlRequiredError(`alias "${alias}" is claimed by both ${owner} and ${c.domain} — an alias may belong to only one site`);
      }
      seenAliases.set(alias, c.domain);
    }
  }

  validateFallbackContentFolders(configs);
  validateInheritComponentsFrom(configs);

  return { configs, bucketName };
}

/** Validate sites.yml text without writing to disk. Throws SitesYmlRequiredError on failure. */
export function validateSitesYmlContent(raw: string): SiteConfig[] {
  return parseSitesYmlContent(raw).configs;
}

function parseSitesYmlFile(sitesYml: string): SiteConfig[] {
  if (!fs.existsSync(sitesYml)) {
    throw new SitesYmlRequiredError("sites.yml not found at project root");
  }

  let raw: string;
  try {
    raw = fs.readFileSync(sitesYml, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SitesYmlRequiredError(`failed to read sites.yml: ${msg}`);
  }

  const { configs, bucketName } = parseSitesYmlContent(raw);
  _bucketName = bucketName;
  return configs;
}

function normalizeFolderKey(folder: string): string {
  return folder.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** fallback_content_folder must name another site's content_folder. */
function validateFallbackContentFolders(configs: SiteConfig[]): void {
  const byFolder = new Map(configs.map((c) => [normalizeFolderKey(c.contentFolder), c]));

  for (const c of configs) {
    const fallback = c.fallbackContentFolder?.trim();
    if (!fallback) continue;
    const want = normalizeFolderKey(fallback);
    const self = normalizeFolderKey(c.contentFolder);
    if (want === self) {
      throw new SitesYmlRequiredError(
        `site "${c.domain}" fallback_content_folder cannot be its own content_folder (${c.contentFolder})`,
      );
    }
    if (!byFolder.has(want)) {
      throw new SitesYmlRequiredError(
        `site "${c.domain}" fallback_content_folder "${fallback}" is not a content_folder of any site in sites.yml`,
      );
    }
  }
}

/** One-hop inherit: known folder, not self, parent does not inherit, parent exists on disk. */
function validateInheritComponentsFrom(configs: SiteConfig[]): void {
  const byFolder = new Map(configs.map((c) => [normalizeFolderKey(c.contentFolder), c]));
  const cwd = getProjectRoot();

  for (const c of configs) {
    const inherit = c.inheritComponentsFrom?.trim();
    if (!inherit) continue;
    const want = normalizeFolderKey(inherit);
    const self = normalizeFolderKey(c.contentFolder);
    if (want === self) {
      throw new SitesYmlRequiredError(
        `site "${c.domain}" inherit_components_from cannot be its own content_folder (${c.contentFolder})`,
      );
    }
    const parent = byFolder.get(want);
    if (!parent) {
      throw new SitesYmlRequiredError(
        `site "${c.domain}" inherit_components_from "${inherit}" is not a content_folder of any site in sites.yml`,
      );
    }
    if (parent.inheritComponentsFrom?.trim()) {
      throw new SitesYmlRequiredError(
        `site "${c.domain}" inherit_components_from "${inherit}" is invalid — parent site "${parent.domain}" also inherits (one hop only)`,
      );
    }
    const parentAbs = path.isAbsolute(parent.contentFolder)
      ? parent.contentFolder
      : path.join(cwd, parent.contentFolder);
    if (!fs.existsSync(parentAbs) || !fs.statSync(parentAbs).isDirectory()) {
      throw new SitesYmlRequiredError(
        `site "${c.domain}" inherit_components_from "${inherit}" — parent folder missing on disk: ${parentAbs}`,
      );
    }
  }
}

/** Lookup inherit_components_from for a content folder (undefined if none / unknown). */
export function getInheritComponentsFrom(contentFolder: string): string | undefined {
  const want = normalizeFolderKey(contentFolder);
  for (const c of getSiteConfigs()) {
    if (normalizeFolderKey(c.contentFolder) === want) {
      return c.inheritComponentsFrom?.trim() || undefined;
    }
  }
  return undefined;
}

/** Load site configs from sites.yml; throws SitesYmlRequiredError when missing or invalid. */
export function requireSiteConfigs(): SiteConfig[] {
  if (_cached) return _cached;

  const sitesYml = path.join(getProjectRoot(), "sites.yml");
  const configs = parseSitesYmlFile(sitesYml);
  log.info(`[SiteConfig] Loaded ${configs.length} site(s) from sites.yml`);
  _cached = configs;
  return _cached;
}

export function getSiteConfigs(): SiteConfig[] {
  return requireSiteConfigs();
}

/**
 * Returns the shared GCS bucket name from the top-level `bucket_name` field
 * in `sites.yml`, or null if not set.
 *
 * Resolution chain (consumers should apply in this order):
 *   1. getBucketName() — sites.yml top-level field (new, post-migration)
 *   2. GCS_BUCKET_NAME env var — legacy fallback
 */
export function getBucketName(): string | null {
  if (_bucketName !== undefined) return _bucketName;

  const sitesYml = path.join(getProjectRoot(), "sites.yml");
  if (fs.existsSync(sitesYml)) {
    try {
      const raw = fs.readFileSync(sitesYml, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (typeof parsed.bucket_name === "string" && parsed.bucket_name) {
          _bucketName = parsed.bucket_name;
          return _bucketName;
        }
      }
    } catch {}
  }

  _bucketName = null;
  return null;
}

/** True when more than one site is configured (UI-only: site switcher visibility). */
export function hasMultipleSites(): boolean {
  return getSiteConfigs().length > 1;
}

/** @deprecated Use hasMultipleSites() — kept for compatibility during migration. */
export function isMultiSiteMode(): boolean {
  return hasMultipleSites();
}

/** First site in sites.yml (the default site for unmatched hostnames). */
export function getDefaultContentFolder(): string {
  return getSiteConfigs()[0].contentFolder;
}

/** Absolute path to the default site's content folder (from sites.yml). */
export function getDefaultContentRoot(): string {
  const folder = getDefaultContentFolder();
  return path.isAbsolute(folder) ? folder : path.join(getProjectRoot(), folder);
}

export function resetSiteConfigs(): void {
  _cached = null;
  _bucketName = undefined;
}

/**
 * Re-read sites.yml from disk and replace the cache — but only if the fresh
 * parse succeeds. If sites.yml is missing or invalid, the previously cached
 * (valid) configs are left untouched and the parse error propagates, so a
 * failed reload never leaves the process without a usable site config.
 */
export function reloadSiteConfigs(): SiteConfig[] {
  const sitesYml = path.join(getProjectRoot(), "sites.yml");
  const configs = parseSitesYmlFile(sitesYml);
  log.info(`[SiteConfig] Reloaded ${configs.length} site(s) from sites.yml`);
  _cached = configs;
  _bucketName = undefined; // force re-read of bucket_name on next access
  return configs;
}

export interface SiteConfigSnapshot {
  cached: SiteConfig[] | null;
  bucketName: string | null | undefined;
}

/** Capture the current config cache so it can be restored after a failed reload. */
export function snapshotSiteConfigs(): SiteConfigSnapshot {
  return { cached: _cached, bucketName: _bucketName };
}

/** Restore a previously captured config cache (used to roll back a failed reload). */
export function restoreSiteConfigs(snap: SiteConfigSnapshot): void {
  _cached = snap.cached;
  _bucketName = snap.bucketName;
}
