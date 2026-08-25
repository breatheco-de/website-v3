import fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import path from "path";
import yaml from "js-yaml";
import { normalizeFlexibleDate } from "@shared/normalizeFlexibleDate";
import { isLocaleIndexField, LOCALE_INDEX_FIELD_NAMES } from "@shared/locale";
import { getSupportedLocales, getDefaultLocale } from "./settings";
import { markFileAsModified } from "./sync-state";
import {
  getValueByPath,
  resolveFieldValue as resolveMappedFieldValue,
} from "./transform";
import { child } from "./logger";
const log = child({ module: "content-types" });



export interface DatabaseConfig {
  slug: string;
}

/** SEO cluster monitoring — omitted means disabled (opt-in). */
export interface SeoMonitoringConfig {
  enabled?: boolean;
  require_cluster?: boolean;
}

export interface LayoutMenuConfig {
  top: string | null;
  bottom: string | null;
}

export interface LayoutConfig {
  menu: LayoutMenuConfig;
}

/** Component-based OG / entry preview screenshot config. */
export interface ContentTypePreviewConfig {
  component: string;
  variant?: string;
  version?: string;
  theme?: "dark" | "light";
  /** Capture widths; first entry used (OG default 1200). */
  widths?: number[];
  maxHeight?: number;
  /** When true, prop-value hash drift marks preview dirty. Default false. */
  dirty_on_prop_change?: boolean;
  /** Component data key → entry field name. Supports dotted paths (e.g. `left.heading`). Must not map reserved `image`. */
  props?: Record<string, string>;
}

/** Per-field editor hints for content-type mapping fields (same shape as database `editor`). */
export type ContentTypeEditorHint = {
  type?: string;
  options?: (string | { value: string; label: string })[];
  populate_options?: boolean;
  allow_custom_values?: boolean;
  /** When true, comma-separated strings are split into tokens (arrays always expand). Warning: values that legitimately contain commas will be split. */
  split_comma_values?: boolean;
  cache_images?: boolean;
  /** Legacy UI hint (read-compat). Prefer fill_intent.purpose; Field Settings Apply omits this. */
  description?: string;
  /**
   * When true: drafts may omit a value; publishing to live requires non-empty;
   * live saves cannot clear the field. Distinct from field_mapping `?` (key may be missing).
   * When `"attached"`: same rules only for shared-layout entries that are not detached
   * (`detached: true` skips). On non–shared-layout types, `"attached"` behaves like true.
   * JSON fields must also satisfy editor.schema (and call_to_action semantics when applicable).
   * Required true|attached also requires a valid fill_intent (goal + purpose).
   */
  required?: boolean | "attached";
  /**
   * Declarative why/how to fill this field when required. Open `goal` string;
   * see FILL_INTENT_GOAL_PRESETS for UI/MCP suggestions.
   */
  fill_intent?: {
    goal: string;
    purpose: string;
    constraints?: string[];
  };
  /**
   * Required when type is `json`. JSON Schema for structured values; exact
   * `{{ single.field }}` binds can return arrays/objects at delivery.
   */
  schema?: Record<string, unknown>;
  /** When type is `relation`: content-type key or database slug (query-options source). */
  source?: string;
  /** Relation value path on related items (default slug). */
  value?: string;
  /** Relation label path for picker (default title/name). */
  label?: string;
  /** When true, store string[] of pointers. */
  multiple?: boolean;
};

export interface ContentTypeEntry {
  directory: string;
  url_pattern: Record<string, string>;
  unique_fields?: string[];
  field_mapping?: Record<string, string | { source: string; default: string | null }>;
  /** Editor widgets for Fields tab / ItemEditModal (keyed by mapping field name). */
  editor?: Record<string, ContentTypeEditorHint>;
  indexes?: string[];
  database?: DatabaseConfig;
  layout?: { menu?: { top?: string | null; bottom?: string | null } };
  /**
   * When true (static types), `_common.single.yml` (+ optional `single.{locale}.yml`)
   * is the shared section template; entry YAML id-patches sections instead of replacing them.
   * DB-backed types already use this merge model via mergeSingleTemplate.
   */
  single_template?: boolean;
  /**
   * Optional component used to generate OG/entry preview screenshots when
   * the reserved `image` field is missing or 404.
   */
  preview?: ContentTypePreviewConfig;
  /**
   * Required companion schema_org sections (by schema_type) on every entry of this type.
   * Validated by schema-org-companions; hard-gated on publish/promote / full replace
   * (not on live micro structural saves). Attach via ensure API/MCP.
   */
  schema_org_requirements?: Array<{ schema_type: string }>;
  /**
   * When true, entry slug cannot be renamed via rename-slug API / SEO UI.
   */
  immutable_slug?: boolean;
  /**
   * Entry slugs that cannot be deleted (system defaults, e.g. org author).
   */
  protected_slugs?: string[];
  /**
   * When enabled, entries of this type participate in seo-index.json and Cluster Map stats.
   * Omitted = disabled. require_cluster warns when a monitored entry has no cluster assignment.
   */
  seo_monitoring?: SeoMonitoringConfig;
  /**
   * Type-level strategy brief for staff/agents (main why of this content type).
   * Required before any editor.required true|attached. Context only for field fill_intent.
   */
  strategy?: {
    purpose: string;
    constraints?: string[];
  };
}

interface ContentTypesRegistry {
  types: Record<string, ContentTypeEntry>;
  directoryToType: Map<string, string>;
  allDirectories: string[];
  allTypes: string[];
}

const registryCache = new Map<string, ContentTypesRegistry>();
const registryMtime = new Map<string, number>();

function resolveContentTypeRoot(contentRoot?: string): string {
  return contentRoot ?? getDefaultContentRoot();
}
function getConfigPath(contentRoot?: string): string {
  return path.join(resolveContentTypeRoot(contentRoot), "content-types.yml");
}

const CONFIG_HEADER = `# Content Types Configuration
# ===========================
# Each entry defines a content type with its URL routing, field mapping, and optional database connection.
#
# Required fields:
#   directory: folder inside 4geeks-com/ where YAML entries live
#   url_pattern: URL routing pattern (must include :slug for unique entry URLs)
#     - Per-locale object: { en: /en/path/:slug, es: /es/ruta/:slug }
#     - Shorthand: { default: /landing/:slug } (same path for all locales)
#
# field_mapping (recommended):
#   Keys are the content-type schema (available in Fields tab and as {{ single.* }}
#   for non-underscore keys). Values are auto-fill sources:
#     identity (author: author) — same-name YAML parent key (static) or DB column
#     { source, default } — schema key with default (default may be null)
#     other path — remap DB column → schema key (DB-attached types only)
#     function:… — computed; ?prefix — optional non-identity source
#   System specials (DB identity / routing; auto-exposed on single as slug|locale|image|updated_at
#   and _slug|_locale|_image|_updated_at — not {{ single._hreflangs }}):
#     _slug — entry identity for URLs / lookups
#     _locale — language of the row
#     _hreflangs — locale→slug map (routing only; not a template var)
#     _updated_at — editorial last-modified (YAML/DB updated_at, else published_at)
#     _image — preview / OG image source
#   Forbidden as regular schema keys: "slug" (use _slug), "image" (use _image).
#   Do not index/unique _image. unique_fields may still list "slug" (the alias).
#   _updated_at maps source updated_at (locale YAML top-level key). Templates use
#     {{ single.updated_at }}. Not Git/file mtime / .sync-state.json.
#   published_at — reserved editorial go-live time (not a system special). Stored in
#     _common.yml; stamped once when the entry first goes live (create for shared-layout /
#     non–draft-first; first draft→live publish/promote for draft-first). Never recomputed
#     on save; cannot clear to empty. Manual override via Fields → _common.yml.
#     Distinct from _updated_at (last content change). Not tied to YAML status: PUBLISHED.
#
# Template namespaces (delivery): {{ single.* }} → {{ meta.* }} → {{ param.* }} → brand/global
#   meta: SEO head block. param: URL path + querystring (path wins on conflict).
# indexes (optional):
#   Fields for filtering when listing entries. Works for DB and non-DB types.
#
# database (optional):
#   slug: database name (matches a db config in 4geeks-com/db/)
#
# layout (optional):
#   menu:
#     top: menu ID for navbar (e.g., "main-navbar") or null for no navbar
#     bottom: menu ID for footer (e.g., "main-footer") or null for no footer
#   System default (when absent): { menu: { top: null, bottom: null } }
#   Per-entry override: set layout.menu.top / layout.menu.bottom in _common.yml or locale files
#
# single_template (optional, default false):
#   When true, static entries inherit sections from _common.single.yml (and single.{locale}.yml
#   if present) and apply per-entry section patches by id — same model as DB-backed singles.
#   Set automatically when converting a DB-backed type to static.
#
# field_mapping — reserved / system:
#   _slug: entry identity (aliased to single.slug at runtime)
#   _image: preview / OG image URL source (aliased to single.image at runtime)
#   _updated_at: last content-change source (aliased to single.updated_at; default updated_at)
#   published_at: reserved editorial go-live (authored; always ensured in field_mapping)
#   Do not use plain "slug" or "image" as field_mapping keys.
#
# preview (optional):
#   Component used to generate OG / entry list thumbnails when \`_image\` is
#   missing or 404. Screenshots are stored in the site media bucket (not image-registry).
#     component: registry section type (e.g. hero)
#     variant / version / theme: optional
#     widths: [1200] (OG default); maxHeight: 630
#     dirty_on_prop_change: false (when true, mapped prop value changes mark dirty)
#     props: { componentDataKey: source } — component keys may be dotted paths (e.g. left.heading).
#       Sources: mapped field keys, meta.<key>, or brand.<key> (same namespaces as templates).
#       Capture loads SEO meta and expands {{ single.* }} inside it. Brand is live at capture;
#       brand.logo / brand.logo_dark registry IDs are resolved to image URLs for the screenshot.
#       brand.logo is theme-aware (dark theme → logo_dark with light fallback); brand.logo_dark
#       is dark-only (no light fallback) — prefer it for dark OG canvases.
#       brand.* is omitted from propsHash (changing brand does not auto-recapture).
#       Blocked: _image, image, og_image, meta.og_image.
#
# editor (optional):
#   Per-field editor hints for the SEO Fields tab / item editors (same shape as db/*/config editor).
#   Keys match field_mapping target names. Types: text, textarea, markdown, number, boolean,
#   date, datetime, image, pdf, select, tags, json, relation. Optional: options, populate_options,
#   allow_custom_values, split_comma_values, required, fill_intent, schema.
#   description: legacy UI hint only (read-compat). Field Settings no longer edits it;
#     Apply clears it. Prefer fill_intent.purpose as the staff/agent brief.
#   required: when true, drafts may be empty; publish/live saves require a non-empty value
#     (cannot clear on a live entry). When "attached", same rules only for shared-layout
#     entries that are not detached (detached: true skips). On non–shared-layout types,
#     "attached" behaves like true. JSON editor fields must also satisfy editor.schema
#     (call_to_action also checks conversion_name / CRM tags). Distinct from field_mapping
#     ? prefix (key may be missing). Every required true|attached field MUST also set
#     fill_intent: { goal (open string), purpose, constraints? string[] }.
#     Goal presets (suggestions only): geo_llm, conversion, seo, editorial, structural,
#     compliance, other — each has title/description in FILL_INTENT_GOAL_PRESET_OPTIONS;
#     custom goals allowed. Content type must also have strategy.purpose before any
#     required true|attached field (code: missing_strategy).
#   split_comma_values: when true, string cells like "a, b" become tokens a and b (arrays always
#     expand). WARNING: values that legitimately contain commas (e.g. "San Francisco, CA") will
#     also be split. Saving a tags field may normalize CSV strings into string arrays.
#   json: structured object/array field (CodeMirror + schema lint). schema (JSON Schema object)
#     is REQUIRED. Empty editor → null. Exact {{ single.field }} returns the value as-is;
#     pipe fallbacks may be JSON literals (e.g. {{ single.field | [] }}).
#   relation: pointer to another content type or private database (same source namespace as
#     /api/query-options). Required: source (CT key or DB slug — must not collide across
#     namespaces). Optional: value (default slug), label (default title/name), multiple.
#     Stores slug string or string[] (multiple). Empty [] fails when required. Page/SSR
#     hydrate to related objects via resolve-relations; listings keep pointers.
#
# strategy (optional until a field is required):
#   Type-level main strategy for staff and agents — not the same as insights_intent
#   (Component Insights taxonomy) or field fill_intent (per-field brief).
#   strategy:
#     purpose: string (required when any editor.required true|attached)
#     constraints: optional string[]
#   Context only: never replaces field fill_intent. Clearing strategy while required
#   fields exist is rejected (code: missing_strategy).
#
# seo_monitoring (optional):
#   When enabled: true, entries join seo-index.json and Cluster Map stats (omitted = off).
#   require_cluster: true warns when a monitored entry lacks a cluster (seo.pillar_path unset/empty).
#   Per-entry opt-out: set seo.pillar_path: null on locale YAML (intentional standalone).
#   DB-backed types: optional field_mapping keys seo_main_keyword, seo_pillar_path, seo_is_pillar
#   map DB columns; locale YAML seo: overlay wins per key.
#
# schema_org_requirements (optional):
#   List of companion schema_org sections required on every entry, e.g.
#     schema_org_requirements:
#       - schema_type: LocalBusiness
#   Validated by schema-org-companions; hard-gated on publish/promote / full replace.
#   Attach via ensure API / MCP
#   ensure_content_type_schema_org.
`;

function writeConfigWithHeader(allTypes: Record<string, ContentTypeEntry>, contentRoot?: string): void {
  const configPath = getConfigPath(contentRoot);
  const yamlBody = yaml.dump(allTypes, { lineWidth: 120, noRefs: true, sortKeys: false });
  fs.writeFileSync(configPath, CONFIG_HEADER + "\n" + yamlBody, "utf-8");
}

function validateUrlPatterns(urlPattern: Record<string, string>): void {
  for (const [locale, pattern] of Object.entries(urlPattern)) {
    if (!pattern.startsWith("/")) {
      throw new Error(`URL pattern for "${locale}" must start with /`);
    }
    if (!pattern.includes(":slug")) {
      throw new Error(`URL pattern for "${locale}" must include :slug`);
    }
  }
}

export function normalizeUrlPattern(raw: string | Record<string, string>): Record<string, string> {
  if (typeof raw === "object" && raw !== null) return raw;
  if (typeof raw !== "string") return {};
  if (raw.includes(":locale")) {
    const result: Record<string, string> = {};
    for (const locale of getSupportedLocales()) {
      result[locale] = raw.replaceAll(":locale", locale);
    }
    return result;
  }
  return { default: raw };
}

function loadRegistry(contentRoot?: string): ContentTypesRegistry {
  const key = resolveContentTypeRoot(contentRoot);
  const configPath = getConfigPath(key);
  let mtime = 0;
  try {
    if (fs.existsSync(configPath)) mtime = fs.statSync(configPath).mtimeMs;
  } catch {
    /* ignore */
  }
  if (registryCache.has(key) && registryMtime.get(key) === mtime) {
    return registryCache.get(key)!;
  }

  let parsed: Record<string, any> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      parsed = (yaml.load(raw) as Record<string, any>) || {};
    } catch (err) {
      log.error({ err: err }, "[ContentTypes] Failed to read content-types.yml:");
    }
  }

  for (const config of Object.values(parsed)) {
    if (config?.url_pattern) {
      config.url_pattern = normalizeUrlPattern(config.url_pattern);
    }
    if (config?.folder && !config.directory) {
      config.directory = config.folder;
      delete config.folder;
    }
  }

  const directoryToType = new Map<string, string>();
  for (const [type, config] of Object.entries(parsed)) {
    if ((config as ContentTypeEntry).directory) {
      directoryToType.set((config as ContentTypeEntry).directory, type);
    }
  }

  const reg: ContentTypesRegistry = {
    types: parsed,
    directoryToType,
    allDirectories: Object.values(parsed).map(c => c.directory),
    allTypes: Object.keys(parsed),
  };

  registryCache.set(key, reg);
  registryMtime.set(key, mtime);
  return reg;
}

export function getDirectory(type: string, contentRoot?: string): string {
  const reg = loadRegistry(contentRoot);
  const entry = reg.types[type];
  if (entry?.directory) return entry.directory;
  if (reg.directoryToType.has(type)) return type;
  return type;
}

export const getFolder = getDirectory;

export function getType(directoryOrType: string, contentRoot?: string): string {
  const reg = loadRegistry(contentRoot);
  if (reg.types[directoryOrType]) return directoryOrType;
  const mapped = reg.directoryToType.get(directoryOrType);
  return mapped || directoryOrType;
}

export function isValidType(type: string, contentRoot?: string): boolean {
  const reg = loadRegistry(contentRoot);
  return type in reg.types || reg.directoryToType.has(type);
}

export function getAllTypes(contentRoot?: string): string[] {
  return loadRegistry(contentRoot).allTypes;
}

export function getAllDirectories(contentRoot?: string): string[] {
  return loadRegistry(contentRoot).allDirectories;
}

export const getAllFolders = getAllDirectories;

export function getUrlPattern(type: string, locale: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  if (!entry?.url_pattern) return null;
  return entry.url_pattern[locale] || entry.url_pattern["default"] || null;
}

export function getContentTypeConfig(type: string, contentRoot?: string): ContentTypeEntry | undefined {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  return reg.types[singular];
}

export function getPreviewConfig(
  type: string,
  contentRoot?: string,
): ContentTypePreviewConfig | null {
  const config = getContentTypeConfig(type, contentRoot);
  const preview = config?.preview;
  if (!preview || typeof preview.component !== "string" || !preview.component.trim()) {
    return null;
  }
  return preview;
}

/** System specials — present on every content type; remappable; never deletable. */
export const KNOWN_SPECIAL_FIELDS = ["_slug", "_locale", "_hreflangs", "_updated_at", "_image"] as const;
export type KnownSpecialField = (typeof KNOWN_SPECIAL_FIELDS)[number];

/** Preview / OG image mapping key (system special). Runtime alias on single bag: {@link IMAGE_ALIAS_FIELD}. */
export const RESERVED_IMAGE_FIELD = "_image";

/** Template / legacy key populated from `_image` when building single / mapped entries. */
export const IMAGE_ALIAS_FIELD = "image";

/** Entry identity mapping key (system special). Runtime alias on single bag: {@link SLUG_ALIAS_FIELD}. */
export const RESERVED_SLUG_FIELD = "_slug";

/** Template key populated from `_slug` when building single / mapped entries (`{{ single.slug }}`). */
export const SLUG_ALIAS_FIELD = "slug";

/** Locale mapping key (system special). Runtime alias on single bag: {@link LOCALE_ALIAS_FIELD}. */
export const RESERVED_LOCALE_FIELD = "_locale";

/** Template key populated from `_locale` (`{{ single.locale }}`). */
export const LOCALE_ALIAS_FIELD = "locale";

/** Routing-only — never expose on the template `single` bag. */
export const RESERVED_HREFLANGS_FIELD = "_hreflangs";

/** Last-modified mapping key (system special). Runtime alias: {@link UPDATED_AT_ALIAS_FIELD}. */
export const RESERVED_UPDATED_AT_FIELD = "_updated_at";

/** Template / list key populated from `_updated_at` (`{{ single.updated_at }}`). */
export const UPDATED_AT_ALIAS_FIELD = "updated_at";

/**
 * Reserved editorial go-live timestamp (authored in `_common.yml`).
 * Not a system special — never injected from file mtime; stamped once on go-live.
 */
export const RESERVED_PUBLISHED_AT_FIELD = "published_at";

/**
 * Platform SEO strategy fields — nested under locale YAML `seo:` for templates/edits
 * (`{{ seo.main_keyword }}`, writeSeoFields). DB-backed types may also map baselines via
 * {@link SEO_FIELD_MAPPING_KEYS} in field_mapping; locale YAML overlay wins per key.
 */
export const KNOWN_SEO_FIELDS = ["main_keyword", "pillar_path", "is_pillar"] as const;
export type KnownSeoField = (typeof KNOWN_SEO_FIELDS)[number];
export const SEO_YAML_KEY = "seo";
export const LEGACY_SEO_PILLAR_KEY = "pillar";
export const LEGACY_MAIN_SEO_KEYWORD_KEY = "main_seo_keyword";

/** field_mapping keys that read DB columns into the effective seo: baseline (not dotted seo.*). */
export const SEO_FIELD_MAPPING_KEYS = {
  main_keyword: "seo_main_keyword",
  pillar_path: "seo_pillar_path",
  is_pillar: "seo_is_pillar",
} as const;

export const SEO_DB_MAPPING_KEY_LIST = [
  SEO_FIELD_MAPPING_KEYS.main_keyword,
  SEO_FIELD_MAPPING_KEYS.pillar_path,
  SEO_FIELD_MAPPING_KEYS.is_pillar,
] as const;

export type SeoDbMappingKey = (typeof SEO_DB_MAPPING_KEY_LIST)[number];

export function isSeoDbMappingKey(key: string): boolean {
  return (SEO_DB_MAPPING_KEY_LIST as readonly string[]).includes(key);
}

/** Dotted keys must never appear in field_mapping (would break writeMappedFields). */
export function isForbiddenDottedSeoFieldMappingKey(key: string): boolean {
  if (key === `${SEO_YAML_KEY}.${LEGACY_SEO_PILLAR_KEY}`) return true;
  return (KNOWN_SEO_FIELDS as readonly string[]).some((k) => key === `${SEO_YAML_KEY}.${k}`);
}

export function assertNoDottedSeoFieldMappingKeys(fieldMapping: Record<string, unknown>): void {
  const bad = Object.keys(fieldMapping).filter(isForbiddenDottedSeoFieldMappingKey);
  if (bad.length === 0) return;
  throw new Error(
    `Invalid field_mapping key(s): ${bad.join(", ")}. Use ${SEO_DB_MAPPING_KEY_LIST.join(", ")} to map DB columns into the seo: baseline — never dotted seo.* keys.`,
  );
}

export function isKnownSeoFieldPath(fieldPath: string): boolean {
  return (KNOWN_SEO_FIELDS as readonly string[]).some((k) => fieldPath === `${SEO_YAML_KEY}.${k}`);
}

export function seoFieldFromPath(fieldPath: string): KnownSeoField | null {
  if (!fieldPath.startsWith(`${SEO_YAML_KEY}.`)) return null;
  const key = fieldPath.slice(SEO_YAML_KEY.length + 1);
  return (KNOWN_SEO_FIELDS as readonly string[]).includes(key) ? (key as KnownSeoField) : null;
}

const FORBIDDEN_SCHEMA_KEYS = new Set<string>([IMAGE_ALIAS_FIELD, SLUG_ALIAS_FIELD, "purchasable"]);

export function isSystemSpecialField(key: string): boolean {
  return (KNOWN_SPECIAL_FIELDS as readonly string[]).includes(key);
}

export function isForbiddenSchemaFieldName(key: string): boolean {
  return FORBIDDEN_SCHEMA_KEYS.has(key);
}

type FieldMappingValue = string | { source: string; default: string | null };
type FieldMappingRecord = Record<string, FieldMappingValue>;

function mappingValueToSource(value: FieldMappingValue | undefined): string {
  if (!value) return "";
  return typeof value === "object" ? value.source : value;
}

/**
 * Migrate legacy `image` → `_image` and `slug` → `_slug`, ensure system specials,
 * strip forbidden schema keys, and remove `_image` / `image` from indexes / unique_fields.
 * (`slug` may remain in unique_fields — it names the alias, not a schema key.)
 */
export function normalizeContentTypeFieldConfig(
  fieldMapping: FieldMappingRecord | undefined,
  opts: {
    isDbBacked: boolean;
    previous?: FieldMappingRecord;
    indexes?: string[];
    unique_fields?: string[];
  },
): {
  field_mapping: FieldMappingRecord;
  indexes?: string[];
  unique_fields?: string[];
} {
  const next: FieldMappingRecord = { ...(fieldMapping || {}) };

  assertNoDottedSeoFieldMappingKeys(next as Record<string, unknown>);

  // Migrate reserved plain image → _image
  if ("image" in next) {
    const legacy = next.image;
    delete next.image;
    if (!("_image" in next) || !mappingValueToSource(next._image)) {
      next._image = legacy;
    }
  }

  // Migrate reserved plain slug → _slug
  if ("slug" in next) {
    const legacy = next.slug;
    delete next.slug;
    if (!("_slug" in next) || !mappingValueToSource(next._slug)) {
      next._slug = legacy;
    }
  }

  // Migrate legacy plain updated_at → _updated_at (system special)
  if ("updated_at" in next) {
    const legacy = next.updated_at;
    delete next.updated_at;
    if (!("_updated_at" in next) || !mappingValueToSource(next._updated_at)) {
      next._updated_at = legacy;
    }
  }

  for (const key of Object.keys(next)) {
    if (isForbiddenSchemaFieldName(key)) {
      delete next[key];
    }
  }

  const defaults: Record<string, string> = {
    _slug: "slug",
    _locale: "locale",
    _hreflangs: opts.isDbBacked ? "translations" : "",
    _updated_at: "updated_at",
    _image: "",
  };

  for (const key of KNOWN_SPECIAL_FIELDS) {
    if (!(key in next)) {
      const prev = opts.previous?.[key];
      if (prev !== undefined) {
        next[key] = prev;
      } else if (defaults[key]) {
        next[key] = defaults[key];
      } else {
        next[key] = "";
      }
    }
  }

  // Reserved editorial: always present as identity mapping when missing
  if (!(RESERVED_PUBLISHED_AT_FIELD in next)) {
    const prevPub = opts.previous?.[RESERVED_PUBLISHED_AT_FIELD];
    next[RESERVED_PUBLISHED_AT_FIELD] =
      prevPub !== undefined ? prevPub : RESERVED_PUBLISHED_AT_FIELD;
  }

  const stripProtected = (arr: string[] | undefined) =>
    arr?.filter(
      (f) =>
        f !== IMAGE_ALIAS_FIELD &&
        f !== RESERVED_IMAGE_FIELD &&
        !isSystemSpecialField(f) &&
        !isLocaleIndexField(f),
    );

  return {
    field_mapping: next,
    indexes: stripProtected(opts.indexes),
    unique_fields: stripProtected(opts.unique_fields),
  };
}

function isPresentAliasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Resolve `_image` onto both `image` and `_image` for templates. */
export function applyImageAliasToEntry(
  entry: Record<string, unknown>,
  imageValue: unknown,
): void {
  if (isPresentAliasValue(imageValue)) {
    entry[IMAGE_ALIAS_FIELD] = imageValue;
    entry[RESERVED_IMAGE_FIELD] = imageValue;
  }
}

/** Resolve `_slug` onto both `slug` and `_slug` for templates. */
export function applySlugAliasToEntry(
  entry: Record<string, unknown>,
  slugValue: unknown,
): void {
  if (isPresentAliasValue(slugValue)) {
    entry[SLUG_ALIAS_FIELD] = slugValue;
    entry[RESERVED_SLUG_FIELD] = slugValue;
  }
}

/** Resolve `_locale` onto both `locale` and `_locale` for templates. */
export function applyLocaleAliasToEntry(
  entry: Record<string, unknown>,
  localeValue: unknown,
): void {
  if (isPresentAliasValue(localeValue)) {
    entry[LOCALE_ALIAS_FIELD] = localeValue;
    entry[RESERVED_LOCALE_FIELD] = localeValue;
  }
}

/** Resolve `_updated_at` onto both `updated_at` and `_updated_at` for templates. */
export function applyUpdatedAtAliasToEntry(
  entry: Record<string, unknown>,
  updatedAtValue: unknown,
): void {
  if (isPresentAliasValue(updatedAtValue)) {
    entry[UPDATED_AT_ALIAS_FIELD] = updatedAtValue;
    entry[RESERVED_UPDATED_AT_FIELD] = updatedAtValue;
  }
}

/**
 * Prepare a single-entry bag for template resolution:
 * - Bidirectional aliases for slug/_slug, locale/_locale, image/_image, updated_at/_updated_at
 * - Strip `_hreflangs` (routing-only; not a template var)
 */
export function finalizeSingleEntryForTemplates(
  entry: Record<string, unknown> | null | undefined,
  opts?: { slug?: string; locale?: string },
): Record<string, unknown> | undefined {
  if (!entry && !opts?.slug && !opts?.locale) return undefined;
  const out: Record<string, unknown> = entry ? { ...entry } : {};
  delete out[RESERVED_HREFLANGS_FIELD];

  const slugVal = out[SLUG_ALIAS_FIELD] ?? out[RESERVED_SLUG_FIELD] ?? opts?.slug;
  if (isPresentAliasValue(slugVal)) {
    out[SLUG_ALIAS_FIELD] = slugVal;
    out[RESERVED_SLUG_FIELD] = slugVal;
  }

  const localeVal = out[LOCALE_ALIAS_FIELD] ?? out[RESERVED_LOCALE_FIELD] ?? opts?.locale;
  if (isPresentAliasValue(localeVal)) {
    out[LOCALE_ALIAS_FIELD] = localeVal;
    out[RESERVED_LOCALE_FIELD] = localeVal;
  }

  const imageVal = out[IMAGE_ALIAS_FIELD] ?? out[RESERVED_IMAGE_FIELD];
  if (isPresentAliasValue(imageVal)) {
    out[IMAGE_ALIAS_FIELD] = imageVal;
    out[RESERVED_IMAGE_FIELD] = imageVal;
  }

  const updatedAtVal = out[UPDATED_AT_ALIAS_FIELD] ?? out[RESERVED_UPDATED_AT_FIELD];
  if (isPresentAliasValue(updatedAtVal)) {
    out[UPDATED_AT_ALIAS_FIELD] = updatedAtVal;
    out[RESERVED_UPDATED_AT_FIELD] = updatedAtVal;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function getAllConfigs(contentRoot?: string): Record<string, ContentTypeEntry> {
  return loadRegistry(contentRoot).types;
}

export function getLabel(type: string, contentRoot?: string): string {
  const singular = getType(type, contentRoot);
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

export function getDirectoryMap(contentRoot?: string): Record<string, string> {
  const reg = loadRegistry(contentRoot);
  const map: Record<string, string> = {};
  for (const [type, config] of Object.entries(reg.types)) {
    map[type] = config.directory;
  }
  return map;
}

export const getFolderMap = getDirectoryMap;

export function getDatabaseName(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  return entry?.database?.slug || null;
}

export function getFullFieldMapping(type: string, contentRoot?: string): Record<string, string> | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const mapping = entry?.field_mapping;
  if (!mapping) return null;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping)) {
    result[key] = typeof value === "object" ? value.source : value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** Schema-field defaults from object-form field_mapping entries (`{ source, default }`). */
export function getFieldMappingDefaults(
  type: string,
  contentRoot?: string,
): Record<string, string | null> {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const mapping = entry?.field_mapping;
  if (!mapping) return {};
  const defaults: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (key.startsWith("_")) continue;
    if (value && typeof value === "object" && "default" in value) {
      defaults[key] = value.default;
    }
  }
  return defaults;
}

export function getFieldMapping(type: string, contentRoot?: string): Record<string, string> | null {
  const full = getFullFieldMapping(type, contentRoot);
  if (!full) return null;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(full)) {
    if (!key.startsWith("_")) {
      filtered[key] = value;
    }
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
}

export function getSlugField(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const slugConfig = entry?.field_mapping?._slug;
  if (!slugConfig) return null;
  if (typeof slugConfig === "object") return slugConfig.source;
  return slugConfig;
}

export function getLocaleKey(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const localeConfig = entry?.field_mapping?._locale;
  if (!localeConfig) return null;
  const raw = typeof localeConfig === "object" ? localeConfig.source : localeConfig;
  if (raw.startsWith("function:")) {
    const mapping = entry?.field_mapping;
    if (mapping) {
      for (const f of LOCALE_INDEX_FIELD_NAMES) {
        if (f in mapping && !f.startsWith("_")) return f;
      }
    }
    return null;
  }
  return raw;
}

export function getLocaleSource(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const localeConfig = entry?.field_mapping?._locale;
  if (!localeConfig) return null;
  if (typeof localeConfig === "object") return localeConfig.source;
  return localeConfig;
}

export function getLocaleDefault(type: string, contentRoot?: string): string {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const localeConfig = entry?.field_mapping?._locale;
  if (localeConfig && typeof localeConfig === "object" && localeConfig.default) {
    return localeConfig.default;
  }
  return getDefaultLocale(contentRoot);
}

/** Source path or function: for field_mapping._hreflangs (locale → slug map). */
export function getHreflangsSource(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const config = entry?.field_mapping?._hreflangs;
  if (!config) return null;
  if (typeof config === "object") return config.source;
  return config;
}

/** Source path or function for field_mapping._updated_at. */
export function getUpdatedAtSource(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const config = entry?.field_mapping?._updated_at;
  if (!config) return null;
  if (typeof config === "object") return config.source || null;
  return config || null;
}

export type ResolveEntryUpdatedAtOpts = {
  contentType: string;
  slug?: string;
  locale?: string;
  record?: Record<string, unknown> | null;
  contentRoot?: string;
  /** When true (or when type has database.slug), use mapped DB field. */
  isDb?: boolean;
};

export type EditorialUpdatedAtSource = "yaml" | "published_at";

function contentRootAbs(contentRoot?: string): string {
  if (!contentRoot) return getDefaultContentRoot();
  return path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);
}

function readYamlRootDates(
  filePath: string,
): { updated?: unknown; published?: unknown } {
  if (!fs.existsSync(filePath)) return {};
  try {
    const data = (yaml.load(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>) || {};
    return {
      updated: data[UPDATED_AT_ALIAS_FIELD] ?? data[RESERVED_UPDATED_AT_FIELD],
      published: data[RESERVED_PUBLISHED_AT_FIELD],
    };
  } catch {
    return {};
  }
}

function firstNormalizedDate(...values: unknown[]): string | null {
  for (const value of values) {
    const iso = normalizeFlexibleDate(value);
    if (iso) return iso;
  }
  return null;
}

/**
 * Resolve ISO `updated_at` for an entry (editorial content clock).
 * YAML/DB `updated_at` / `_updated_at`, else `published_at`, else null.
 * Never sync-state file mtime or "today".
 */
export function resolveEntryUpdatedAtDetail(
  opts: ResolveEntryUpdatedAtOpts,
): { iso: string | null; source: EditorialUpdatedAtSource | null } {
  const { contentType, slug, locale, record, contentRoot } = opts;
  const config = getContentTypeConfig(contentType, contentRoot);
  const isDb = opts.isDb ?? !!config?.database?.slug;
  const root = contentRootAbs(contentRoot);
  const directory = getDirectory(contentType, contentRoot);

  const fromRecordUpdated = record
    ? firstNormalizedDate(
        record[UPDATED_AT_ALIAS_FIELD],
        record[RESERVED_UPDATED_AT_FIELD],
      )
    : null;
  if (fromRecordUpdated) return { iso: fromRecordUpdated, source: "yaml" };

  if (isDb && record) {
    const source = getUpdatedAtSource(contentType, contentRoot);
    if (source && source.trim()) {
      try {
        const raw = resolveMappedFieldValue(source, record, RESERVED_UPDATED_AT_FIELD);
        const fromSource = firstNormalizedDate(raw);
        if (fromSource) return { iso: fromSource, source: "yaml" };
      } catch {
        // fall through
      }
    }
    const fromPublished = firstNormalizedDate(record[RESERVED_PUBLISHED_AT_FIELD]);
    if (fromPublished) return { iso: fromPublished, source: "published_at" };
    if (slug) {
      const commonPath = path.join(root, directory, slug, "_common.yml");
      const fromCommon = firstNormalizedDate(readYamlRootDates(commonPath).published);
      if (fromCommon) return { iso: fromCommon, source: "published_at" };
    }
    return { iso: null, source: null };
  }

  if (slug && locale) {
    const localePath = path.join(root, directory, slug, `${locale}.yml`);
    const fromLocale = firstNormalizedDate(readYamlRootDates(localePath).updated);
    if (fromLocale) return { iso: fromLocale, source: "yaml" };
  }

  const fromRecordPublished = record
    ? firstNormalizedDate(record[RESERVED_PUBLISHED_AT_FIELD])
    : null;
  if (fromRecordPublished) return { iso: fromRecordPublished, source: "published_at" };

  if (slug) {
    const commonPath = path.join(root, directory, slug, "_common.yml");
    const fromCommon = firstNormalizedDate(readYamlRootDates(commonPath).published);
    if (fromCommon) return { iso: fromCommon, source: "published_at" };
  }

  return { iso: null, source: null };
}

export function resolveEntryUpdatedAt(opts: ResolveEntryUpdatedAtOpts): string | null {
  return resolveEntryUpdatedAtDetail(opts).iso;
}

/**
 * Max editorial updated_at across locale files for a static entry (manage table).
 */
export function resolveStaticEntryUpdatedAt(
  contentType: string,
  slug: string,
  locales: string[],
  contentRoot?: string,
): string | null {
  let best: string | null = null;
  let bestMs = -1;
  for (const locale of locales) {
    if (locale.startsWith("_") || locale.includes(".")) continue;
    const iso = resolveEntryUpdatedAt({
      contentType,
      slug,
      locale,
      contentRoot,
      isDb: false,
    });
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      best = iso;
    }
  }
  if (best) return best;
  return resolveEntryUpdatedAt({
    contentType,
    slug,
    contentRoot,
    isDb: false,
  });
}

/** Normalize API locale keys (us→en), keep string slugs, optionally merge current item. */
export function normalizeHreflangMap(
  raw: unknown,
  self?: { locale: string; slug: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== "string" || !value.trim()) continue;
      const locale = normalizeHreflangLocaleKey(key);
      if (!locale) continue;
      out[locale] = value.trim();
    }
  }
  if (self?.locale && self?.slug) {
    const locale = normalizeHreflangLocaleKey(self.locale);
    if (locale && self.slug.trim()) {
      out[locale] = self.slug.trim();
    }
  }
  return out;
}

export function normalizeHreflangLocaleKey(key: string): string {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return "";
  if (k === "us") return "en";
  const m = k.match(/^([a-z]{2})/);
  return m ? m[1] : k;
}

/** Prefer en slug, else first sorted slug — stable cluster id for sitemap / migration. */
export function getCanonicalHreflangSlug(map: Record<string, string>): string | null {
  if (map.en) return map.en;
  const sorted = Object.keys(map).sort();
  if (sorted.length === 0) return null;
  return map[sorted[0]] ?? null;
}

/**
 * Resolve a locale→slug map from a mapped DB item (or any record that already
 * carries the `_hreflangs` source field). Returns null if `_hreflangs` is not configured.
 */
export function resolveHreflangsFromRecord(
  record: Record<string, unknown>,
  contentType: string,
  contentRoot?: string,
): Record<string, string> | null {
  const source = getHreflangsSource(contentType, contentRoot);
  if (!source) return null;

  const localeKey = getLocaleKey(contentType, contentRoot);
  const selfLocale = String(
    (localeKey && record[localeKey]) ?? record.language ?? record.lang ?? record.locale ?? "",
  );
  const selfSlug = String(record.slug ?? "");

  let raw: unknown;
  if (source.startsWith("function:") || source.startsWith("?function:")) {
    raw = resolveMappedFieldValue(source, record, "_hreflangs");
  } else {
    const pathKey = source.startsWith("?") ? source.slice(1) : source;
    raw = record[pathKey];
    if (raw === undefined && pathKey.includes(".")) {
      raw = getValueByPath(record, pathKey);
    }
  }

  return normalizeHreflangMap(raw, {
    locale: selfLocale,
    slug: selfSlug,
  });
}

export function getIndexes(type: string, contentRoot?: string): string[] {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  return entry?.indexes || [];
}

export function getDatabaseConfig(type: string, contentRoot?: string): DatabaseConfig | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  return entry?.database || null;
}

export function getLookupKey(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  if (!entry?.url_pattern) return null;
  const patterns = Object.values(entry.url_pattern);
  if (patterns.length === 0) return null;
  const pattern = patterns[0];
  const params = pattern.match(/:([a-zA-Z_]+)/g);
  if (!params || params.length === 0) return null;
  return params[params.length - 1].slice(1);
}

export function hasDatabaseSingle(type: string, contentRoot?: string): boolean {
  return !!getDatabaseName(type, contentRoot);
}

export function hasFieldMapping(type: string, contentRoot?: string): boolean {
  return !!getFieldMapping(type, contentRoot);
}

export type ContentTypeConfigUpdate = Partial<Omit<ContentTypeEntry, "database" | "preview" | "editor" | "seo_monitoring" | "strategy">> & {
  /** Pass `null` to unlink a database-backed type (removes the `database` key). */
  database?: DatabaseConfig | null;
  /** Pass `null` to remove preview screenshot config. */
  preview?: ContentTypePreviewConfig | null;
  /** Pass `null` to remove all content-type editor hints. */
  editor?: ContentTypeEntry["editor"] | null;
  /** Pass `null` to remove seo_monitoring (same as omitted = disabled). */
  seo_monitoring?: SeoMonitoringConfig | null;
  /** Pass `null` to remove strategy (rejected if required fields remain). */
  strategy?: ContentTypeEntry["strategy"] | null;
};

export function updateContentTypeConfig(type: string, update: ContentTypeConfigUpdate, contentRoot?: string): void {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const existing = reg.types[singular];
  if (!existing) {
    throw new Error(`Content type "${type}" not found`);
  }

  const {
    database: databaseUpdate,
    preview: previewUpdate,
    editor: editorUpdate,
    seo_monitoring: seoMonitoringUpdate,
    strategy: strategyUpdate,
    ...rest
  } = update;
  const merged: ContentTypeEntry = { ...existing, ...rest };
  if (databaseUpdate === null) {
    delete merged.database;
  } else if (databaseUpdate && existing.database) {
    merged.database = { ...existing.database, ...databaseUpdate };
  } else if (databaseUpdate) {
    merged.database = databaseUpdate;
  }

  if (previewUpdate === null) {
    delete merged.preview;
  } else if (previewUpdate) {
    merged.preview = previewUpdate;
  }

  if (editorUpdate === null) {
    delete merged.editor;
  } else if (editorUpdate) {
    merged.editor = editorUpdate;
  }

  if (seoMonitoringUpdate === null) {
    delete merged.seo_monitoring;
  } else if (seoMonitoringUpdate) {
    merged.seo_monitoring = seoMonitoringUpdate;
  }

  if (strategyUpdate === null) {
    delete merged.strategy;
  } else if (strategyUpdate) {
    merged.strategy = strategyUpdate;
  }

  // Database-backed types always use a shared template.
  if (merged.database?.slug) {
    merged.single_template = true;
  }

  if (
    existing.database?.slug &&
    update.single_template === false &&
    databaseUpdate !== null
  ) {
    throw new Error(
      `Cannot disable shared layout (single_template) while content type "${singular}" is linked to a database. Unlink the database first.`,
    );
  }

  if (merged.url_pattern) {
    validateUrlPatterns(merged.url_pattern);
  }

  if (merged.field_mapping !== undefined || update.indexes !== undefined || update.unique_fields !== undefined) {
    const normalized = normalizeContentTypeFieldConfig(
      (merged.field_mapping || {}) as FieldMappingRecord,
      {
        isDbBacked: !!merged.database?.slug,
        previous: existing.field_mapping as FieldMappingRecord | undefined,
        indexes: merged.indexes,
        unique_fields: merged.unique_fields,
      },
    );
    merged.field_mapping = normalized.field_mapping;
    if (update.indexes !== undefined || normalized.indexes !== undefined) {
      merged.indexes = normalized.indexes?.length ? normalized.indexes : undefined;
    }
    if (update.unique_fields !== undefined || normalized.unique_fields !== undefined) {
      merged.unique_fields = normalized.unique_fields?.length
        ? normalized.unique_fields
        : undefined;
    }
  }

  if (merged.database && !merged.field_mapping?._slug) {
    throw new Error(`Database-backed content type "${singular}" requires _slug in field_mapping`);
  }

  // Soft-ensure specials even when field_mapping was not in this update
  if (!merged.field_mapping?._slug || !merged.field_mapping?._image) {
    const normalized = normalizeContentTypeFieldConfig(
      (merged.field_mapping || {}) as FieldMappingRecord,
      {
        isDbBacked: !!merged.database?.slug,
        previous: existing.field_mapping as FieldMappingRecord | undefined,
        indexes: merged.indexes,
        unique_fields: merged.unique_fields,
      },
    );
    merged.field_mapping = normalized.field_mapping;
  }

  const resolvedRoot = resolveContentTypeRoot(contentRoot);
  const configPath = getConfigPath(contentRoot);
  const allTypes = { ...reg.types, [singular]: merged };
  writeConfigWithHeader(allTypes, contentRoot);
  markFileAsModified(configPath, undefined, undefined, resolvedRoot);
  resetRegistry(resolvedRoot);
  log.info(`[ContentTypes] Updated config for "${singular}"`);
}

export function addContentType(name: string, config: ContentTypeEntry, contentRoot?: string): void {
  const reg = loadRegistry(contentRoot);
  if (reg.types[name]) {
    throw new Error(`Content type "${name}" already exists`);
  }

  const { DatabaseManager } = require("./database") as typeof import("./database");
  const { assertSourceNameAvailable } = require("./query-options") as typeof import("./query-options");
  assertSourceNameAvailable(name, "contentType", contentRoot, new DatabaseManager(contentRoot));

  validateUrlPatterns(config.url_pattern);

  if (config.database && !config.field_mapping?._slug) {
    throw new Error(`Database-backed content type "${name}" requires _slug in field_mapping`);
  }

  const configPath = getConfigPath(contentRoot);
  const resolvedRoot = resolveContentTypeRoot(contentRoot);
  const allTypes = { ...reg.types, [name]: config };
  writeConfigWithHeader(allTypes, contentRoot);
  markFileAsModified(configPath, undefined, undefined, resolvedRoot);
  registryCache.delete(resolvedRoot);

  const dirPath = path.join(resolvedRoot, config.directory);
  const isNewDir = !fs.existsSync(dirPath);
  if (isNewDir) {
    fs.mkdirSync(dirPath, { recursive: true });
    const folderName = path.relative(process.cwd(), resolvedRoot);
    log.info(`[ContentTypes] Created directory: ${folderName}/${config.directory}/`);
  }

  if (isNewDir) {
    const locales = getSupportedLocales(contentRoot);
    const sampleSlug = `sample-${name}`;
    const sampleDir = path.join(dirPath, sampleSlug);
    fs.mkdirSync(sampleDir, { recursive: true });

    const titleCase = name.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    const commonYml = [
      `slug: ${sampleSlug}`,
      `title: ${titleCase}`,
      "",
      "meta:",
      "  robots: index, follow",
      "  priority: 0.9",
      "  change_frequency: weekly",
      "",
      "schema:",
      "  include:",
      "    - organization",
      "    - website",
      "",
    ].join("\n");
    const commonYmlPath = path.join(sampleDir, "_common.yml");
    fs.writeFileSync(commonYmlPath, commonYml);
    markFileAsModified(commonYmlPath, undefined, undefined, resolvedRoot);

    for (const locale of locales) {
      const localeYml = [
        `slug: ${sampleSlug}`,
        `title: ${titleCase}`,
        "",
        "meta:",
        `  page_title: "${titleCase} | 4Geeks"`,
        `  description: "Sample ${name} entry for ${locale} locale."`,
        "",
        "sections: []",
        "",
      ].join("\n");
      const localeYmlPath = path.join(sampleDir, `${locale}.yml`);
      fs.writeFileSync(localeYmlPath, localeYml);
      markFileAsModified(localeYmlPath, undefined, undefined, resolvedRoot);
    }

    const folderName2 = path.relative(process.cwd(), resolvedRoot);
    log.info(`[ContentTypes] Created sample entry: ${folderName2}/${config.directory}/${sampleSlug}/ (${locales.length} locale(s))`);
  }

  resetRegistry(resolvedRoot);
  log.info(`[ContentTypes] Added content type "${name}"`);
}

export function deleteContentType(name: string, contentRoot?: string): void {
  const reg = loadRegistry(contentRoot);
  const singular = getType(name, contentRoot);
  if (!reg.types[singular]) {
    throw new Error(`Content type "${name}" not found`);
  }

  const configPath = getConfigPath(contentRoot);
  const resolvedRoot = resolveContentTypeRoot(contentRoot);
  const allTypes = { ...reg.types };
  delete allTypes[singular];
  writeConfigWithHeader(allTypes, contentRoot);
  markFileAsModified(configPath, undefined, undefined, resolvedRoot);
  resetRegistry(resolvedRoot);
  log.info(`[ContentTypes] Deleted content type "${singular}"`);
}

export function resetRegistry(contentRoot?: string): void {
  if (contentRoot) {
    registryCache.delete(contentRoot);
    registryMtime.delete(contentRoot);
  } else {
    registryCache.clear();
    registryMtime.clear();
  }
}

export function readRawContentTypesYml(contentRoot?: string): { content: string; absolutePath: string } | null {
  const configPath = getConfigPath(contentRoot);
  if (!fs.existsSync(configPath)) return null;
  return {
    content: fs.readFileSync(configPath, "utf-8"),
    absolutePath: configPath,
  };
}

export function writeRawContentTypesYml(content: string, contentRoot?: string, author?: string): void {
  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("content-types.yml must be a YAML object mapping type names to configs");
  }

  for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Entry "${name}" must be an object`);
    }
    const config = entry as Partial<ContentTypeEntry>;
    if (!config.directory || typeof config.directory !== "string") {
      throw new Error(`Entry "${name}" requires a string "directory"`);
    }
    if (!config.url_pattern) {
      throw new Error(`Entry "${name}" requires "url_pattern"`);
    }
    const normalized = normalizeUrlPattern(config.url_pattern as string | Record<string, string>);
    validateUrlPatterns(normalized);
    if (config.database && !(config.field_mapping as Record<string, unknown> | undefined)?._slug) {
      throw new Error(`Database-backed content type "${name}" requires _slug in field_mapping`);
    }
  }

  const resolvedRoot = resolveContentTypeRoot(contentRoot);
  const configPath = getConfigPath(resolvedRoot);
  fs.writeFileSync(configPath, content, "utf-8");
  markFileAsModified(configPath, author, undefined, resolvedRoot);
  resetRegistry(resolvedRoot);
  log.info("[ContentTypes] Wrote raw content-types.yml");
}

function extractDotPath(record: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = record;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function resolveFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "object" && "slug" in (value as object)) {
    return String((value as Record<string, unknown>).slug || "");
  }
  return String(value);
}

export type UrlParamValueShape = "object_slug" | "string";

/**
 * Extra `:param` names from a content type's url_pattern (excludes slug / locale).
 */
export function listExtraUrlPatternParams(
  urlPattern?: Record<string, string> | null,
): string[] {
  if (!urlPattern) return [];
  const keys = new Set<string>();
  for (const pattern of Object.values(urlPattern)) {
    if (!pattern) continue;
    const matches = pattern.match(/:([a-zA-Z_]+)/g) || [];
    for (const m of matches) {
      const key = m.slice(1);
      if (key !== "slug" && key !== "locale") keys.add(key);
    }
  }
  return [...keys];
}

export function detectUrlParamValueShape(rawValue: unknown): UrlParamValueShape {
  if (
    rawValue != null &&
    typeof rawValue === "object" &&
    !Array.isArray(rawValue) &&
    "slug" in (rawValue as object)
  ) {
    return "object_slug";
  }
  return "string";
}

export function formatUrlParamFieldValue(
  value: string,
  shape: UrlParamValueShape,
): string | { slug: string } {
  if (shape === "object_slug") return { slug: value };
  return value;
}

/**
 * Resolve the raw YAML/DB value for a URL pattern param from an entry record.
 */
export function getRawUrlParamValue(
  record: Record<string, unknown>,
  param: string,
  fieldMapping?: Record<string, string | null> | null,
): unknown {
  const mappingKey = fieldMapping && `_${param}` in fieldMapping ? `_${param}` : param;
  if (fieldMapping && mappingKey in fieldMapping) {
    const sourceField = fieldMapping[mappingKey];
    if (sourceField) {
      const mapped = extractDotPath(record, sourceField);
      if (mapped !== undefined) return mapped;
    }
  }
  return extractDotPath(record, param);
}

/**
 * Extract all `:variable` params (besides `slug` and `locale`) from a URL pattern
 * and resolve each from the entry's merged data. Blog `category` is a plain string;
 * other fields may still be objects with `.slug` (unwrapped via resolveFieldValue)
 * or use dot-notation lookups via an optional field mapping.
 *
 * Returns the resolved params plus a list of variables that could not be
 * resolved (missing or empty), so callers can skip entries instead of emitting
 * malformed URLs.
 */
export function extractUrlPatternParams(
  pattern: string,
  record: Record<string, unknown>,
  fieldMapping?: Record<string, string | null> | null,
  defaults?: Record<string, string | null> | null,
): { params: Record<string, string>; missing: string[] } {
  const params: Record<string, string> = {};
  const missing: string[] = [];

  const paramMatches = pattern.match(/:([a-zA-Z_]+)/g) || [];
  for (const param of paramMatches) {
    const key = param.slice(1);
    if (key === "slug" || key === "locale") continue;

    let rawValue: unknown;
    const mappingKey = fieldMapping && `_${key}` in fieldMapping ? `_${key}` : key;
    if (fieldMapping && mappingKey in fieldMapping) {
      const sourceField = fieldMapping[mappingKey];
      if (sourceField) {
        rawValue = extractDotPath(record, sourceField);
      }
    }
    if (rawValue === undefined) {
      rawValue = extractDotPath(record, key);
    }

    let resolved = resolveFieldValue(rawValue);
    if (!resolved && defaults && defaults[key] != null && defaults[key] !== "") {
      resolved = resolveFieldValue(defaults[key]);
    }
    if (!resolved) {
      if (!missing.includes(key)) missing.push(key);
      continue;
    }
    params[key] = resolved;
  }

  return { params, missing };
}

export function resolveUrlPatternWithMapping(
  pattern: string,
  record: Record<string, unknown>,
  locale: string,
  fieldMapping?: Record<string, string | null> | null,
  defaults?: Record<string, string | null> | null,
): string {
  let result = pattern.replaceAll(":locale", locale);

  const paramMatches = result.match(/:([a-zA-Z_]+)/g) || [];
  for (const param of paramMatches) {
    const key = param.slice(1);

    let rawValue: unknown;

    const mappingKey = fieldMapping && `_${key}` in fieldMapping ? `_${key}` : key;
    if (fieldMapping && mappingKey in fieldMapping) {
      const sourceField = fieldMapping[mappingKey];
      if (sourceField) {
        rawValue = extractDotPath(record, sourceField);
      }
    }

    if (rawValue === undefined) {
      rawValue = extractDotPath(record, key);
    }

    let resolved = resolveFieldValue(rawValue);
    if (!resolved && key !== "slug" && key !== "locale" && defaults && defaults[key] != null && defaults[key] !== "") {
      resolved = resolveFieldValue(defaults[key]);
    }
    result = result.replaceAll(param, resolved);
  }

  result = result.replace(/\/\/+/g, "/");

  return result;
}

export function resolveContentTypeUrl(
  type: string,
  record: Record<string, unknown>,
  locale: string,
  contentRoot?: string,
): string | null {
  const config = getContentTypeConfig(type, contentRoot);
  if (!config?.url_pattern) return null;
  const pattern = config.url_pattern[locale] || config.url_pattern["default"] || config.url_pattern["en"];
  if (!pattern) return null;
  const mapping = getFullFieldMapping(type, contentRoot);
  const defaults = getFieldMappingDefaults(type, contentRoot);
  return resolveUrlPatternWithMapping(pattern, record, locale, mapping, defaults);
}

const SYSTEM_DEFAULT_LAYOUT: LayoutConfig = {
  menu: { top: null, bottom: null },
};

export function getLayout(type: string, contentRoot?: string): LayoutConfig {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  if (!entry?.layout?.menu) {
    return { ...SYSTEM_DEFAULT_LAYOUT };
  }
  return {
    menu: {
      top: entry.layout.menu.top ?? null,
      bottom: entry.layout.menu.bottom ?? null,
    },
  };
}

export function resolveLayout(
  contentType: string,
  mergedData: Record<string, unknown>,
  contentRoot?: string,
): LayoutConfig {
  const typeLayout = getLayout(contentType, contentRoot);
  const entryLayout = mergedData.layout as
    | { menu?: { top?: string | null; bottom?: string | null } }
    | undefined;

  if (!entryLayout?.menu) return typeLayout;

  return {
    menu: {
      top: "top" in (entryLayout.menu || {}) ? (entryLayout.menu!.top ?? null) : typeLayout.menu.top,
      bottom: "bottom" in (entryLayout.menu || {}) ? (entryLayout.menu!.bottom ?? null) : typeLayout.menu.bottom,
    },
  };
}

export function listAvailableMenus(contentRoot?: string): string[] {
  const menusDir = path.join(resolveContentTypeRoot(contentRoot), "menus");
  if (!fs.existsSync(menusDir)) return [];

  const files = fs.readdirSync(menusDir);
  const ids = new Set<string>();
  for (const file of files) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const base = file.replace(/\.(yml|yaml)$/, "").replace(/\.[a-z]{2}$/, "");
    ids.add(base);
  }
  return Array.from(ids).sort();
}
