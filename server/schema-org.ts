import fs from "fs";
import { getDefaultContentRoot, getDefaultContentFolder } from "./site-config";
import path from "path";
import yaml from "js-yaml";
import { child } from "./logger";
import {
  camelToJsonLd,
  transformToJsonLd,
  type SchemaLocales,
} from "@shared/schema-org-transform";

export { transformToJsonLd, camelToJsonLd } from "@shared/schema-org-transform";

const log = child({ module: "schema-org" });

interface BaseSchema {
  type: string;
  locales?: SchemaLocales;
  [key: string]: unknown;
}

interface SchemaOrgConfig {
  organization?: BaseSchema;
  website?: BaseSchema;
  courses?: Record<string, BaseSchema>;
  item_lists?: Record<string, BaseSchema>;
  local_business?: Record<string, BaseSchema>;
}

interface SchemaReference {
  include?: string[];
  overrides?: Record<string, Record<string, unknown>>;
}

const schemaCache = new Map<string, SchemaOrgConfig>();

function resolveSchemaPath(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.join(root, "schema-org.yml");
}

function loadSchemaConfig(contentRoot?: string): SchemaOrgConfig {
  const schemaPath = resolveSchemaPath(contentRoot);

  if (schemaCache.has(schemaPath)) {
    return schemaCache.get(schemaPath)!;
  }

  if (!fs.existsSync(schemaPath)) {
    log.warn("[SchemaOrg] schema-org.yml not found");
    return {};
  }

  try {
    const content = fs.readFileSync(schemaPath, "utf-8");
    const config = (yaml.load(content) as SchemaOrgConfig) || {};
    schemaCache.set(schemaPath, config);
    return config;
  } catch (err) {
    log.error({ err: err }, "[SchemaOrg] Error loading schema-org.yml:");
    return {};
  }
}

/** Clear the schema cache for a specific site (by contentRoot) or all sites if no arg given. */
export function clearSchemaCache(contentRoot?: string): void {
  if (contentRoot !== undefined) {
    schemaCache.delete(resolveSchemaPath(contentRoot));
  } else {
    schemaCache.clear();
  }
}

function resolveSchemaRef(ref: string, config: SchemaOrgConfig, locale: string): Record<string, unknown> | null {
  if (ref === "@organization") {
    return config.organization ? transformToJsonLd(config.organization, locale) : null;
  }
  
  if (ref.startsWith("courses:")) {
    const courseSlug = ref.replace("courses:", "");
    const course = config.courses?.[courseSlug];
    if (course) {
      const transformed = transformToJsonLd(course, locale);
      // Resolve provider reference
      if (transformed.provider === "@organization" && config.organization) {
        transformed.provider = {
          "@type": config.organization.type,
          name: config.organization.name,
          url: config.organization.url,
        };
      }
      return transformed;
    }
  }
  
  if (ref.startsWith("item_lists:")) {
    const listSlug = ref.replace("item_lists:", "");
    const list = config.item_lists?.[listSlug];
    if (list) {
      const transformed = transformToJsonLd(list, locale);
      // Resolve item refs
      if (Array.isArray(transformed.itemListElement)) {
        transformed.itemListElement = transformed.itemListElement.map((item: { ref?: string; position?: number }) => {
          if (item.ref) {
            const resolvedItem = resolveSchemaRef(item.ref, config, locale);
            return {
              "@type": "ListItem",
              position: item.position,
              item: resolvedItem,
            };
          }
          return item;
        });
      }
      return transformed;
    }
  }

  if (ref.startsWith("local_business:")) {
    const bizSlug = ref.replace("local_business:", "");
    const biz = config.local_business?.[bizSlug];
    if (biz) {
      const transformed = transformToJsonLd(biz, locale);
      if (transformed.parentOrganization === "@organization" && config.organization) {
        transformed.parentOrganization = {
          "@type": config.organization.type,
          name: config.organization.name,
          url: config.organization.url,
        };
      }
      return transformed;
    }
  }
  
  return null;
}

export function getSchema(schemaKey: string, locale: string = "en", contentRoot?: string): Record<string, unknown> | null {
  const config = loadSchemaConfig(contentRoot);
  
  if (schemaKey === "organization" && config.organization) {
    return {
      "@context": "https://schema.org",
      ...transformToJsonLd(config.organization, locale),
    };
  }
  
  if (schemaKey === "website" && config.website) {
    return {
      "@context": "https://schema.org",
      ...transformToJsonLd(config.website, locale),
    };
  }
  
  if (schemaKey.startsWith("courses:")) {
    const resolved = resolveSchemaRef(schemaKey, config, locale);
    if (resolved) {
      return {
        "@context": "https://schema.org",
        ...resolved,
      };
    }
  }
  
  if (schemaKey.startsWith("item_lists:")) {
    const resolved = resolveSchemaRef(schemaKey, config, locale);
    if (resolved) {
      return {
        "@context": "https://schema.org",
        ...resolved,
      };
    }
  }

  if (schemaKey.startsWith("local_business:")) {
    const resolved = resolveSchemaRef(schemaKey, config, locale);
    if (resolved) {
      return {
        "@context": "https://schema.org",
        ...resolved,
      };
    }
  }
  
  return null;
}

export function getMergedSchemas(
  schemaRef: SchemaReference,
  locale: string = "en",
  contentRoot?: string
): Record<string, unknown>[] {
  const config = loadSchemaConfig(contentRoot);
  const result: Record<string, unknown>[] = [];
  
  if (!schemaRef.include || schemaRef.include.length === 0) {
    return result;
  }
  
  for (const key of schemaRef.include) {
    let schema = getSchema(key, locale, contentRoot);
    
    if (schema) {
      // Apply overrides (Option A: full replace of properties)
      const overrides = schemaRef.overrides?.[key];
      if (overrides) {
        schema = { ...schema };
        for (const [propKey, propValue] of Object.entries(overrides)) {
          const jsonLdKey = camelToJsonLd(propKey);
          (schema as Record<string, unknown>)[jsonLdKey] = propValue;
        }
      }
      
      result.push(schema);
    }
  }
  
  return result;
}

const SOCIAL_PLATFORM_DOMAINS: Record<string, string[]> = {
  twitter: ["twitter.com/", "x.com/"],
  linkedin: ["linkedin.com/"],
  facebook: ["facebook.com/"],
  youtube: ["youtube.com/"],
  instagram: ["instagram.com/"],
  github: ["github.com/"],
};

function matchesPlatform(url: string, platform: string): boolean {
  const domains = SOCIAL_PLATFORM_DOMAINS[platform];
  if (!domains) return false;
  return domains.some((d) => url.includes(d));
}

export function getOrganizationTwitterHandle(contentRoot?: string): string | null {
  const config = loadSchemaConfig(contentRoot);
  const sameAs = config.organization?.same_as;
  if (!Array.isArray(sameAs)) return null;
  for (const url of sameAs) {
    if (typeof url === "string" && matchesPlatform(url, "twitter")) {
      const segments = url.replace(/\/$/, "").split("/").filter(Boolean);
      const handle = segments[segments.length - 1];
      if (handle) return `@${handle}`;
    }
  }
  return null;
}

export function getOrganizationSameAsUrl(platform: string, contentRoot?: string): string | null {
  const config = loadSchemaConfig(contentRoot);
  const sameAs = config.organization?.same_as;
  if (!Array.isArray(sameAs)) return null;
  for (const url of sameAs) {
    if (typeof url === "string" && matchesPlatform(url, platform)) {
      return url;
    }
  }
  return null;
}

export function updateOrganizationSameAsUrl(platform: string, url: string): void {
  const schemaPath = path.join(process.cwd(), getDefaultContentFolder(), "schema-org.yml");
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(schemaPath)) {
    try {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  if (!existing.organization || typeof existing.organization !== "object") {
    existing.organization = {};
  }
  const org = existing.organization as Record<string, unknown>;

  const newUrl = url.trim() || null;
  let sameAs: string[] = Array.isArray(org.same_as) ? [...(org.same_as as string[])] : [];

  const matchIndex = sameAs.findIndex(
    (entry) => typeof entry === "string" && matchesPlatform(entry, platform)
  );

  if (newUrl) {
    if (matchIndex >= 0) {
      sameAs[matchIndex] = newUrl;
    } else {
      sameAs.push(newUrl);
    }
  } else if (matchIndex >= 0) {
    sameAs.splice(matchIndex, 1);
  }

  org.same_as = sameAs;

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(schemaPath, output, "utf-8");
  clearSchemaCache();
}

export function getWebsiteDefaultSocialImage(contentRoot?: string): string | null {
  const config = loadSchemaConfig(contentRoot);
  const img = (config.website as Record<string, unknown> | undefined)?.default_social_image;
  return typeof img === "string" && img.trim() !== "" ? img.trim() : null;
}

export function getOrganizationLogo(contentRoot?: string): string | null {
  const config = loadSchemaConfig(contentRoot);
  const logo = (config.organization as Record<string, unknown> | undefined)?.logo;
  return typeof logo === "string" && logo.trim() !== "" ? logo.trim() : null;
}

export function getOrganizationName(contentRoot?: string): string | null {
  const config = loadSchemaConfig(contentRoot);
  const name = (config.organization as Record<string, unknown> | undefined)?.name;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

function loadWritableSchemaConfig(contentRoot?: string): { schemaPath: string; existing: Record<string, unknown> } {
  const schemaPath = resolveSchemaPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(schemaPath)) {
    try {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }
  return { schemaPath, existing };
}

function writeSchemaConfig(schemaPath: string, existing: Record<string, unknown>): void {
  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(schemaPath, output, "utf-8");
  clearSchemaCache();
}

export function updateOrganizationLogo(imageUrl: string): void {
  const { schemaPath, existing } = loadWritableSchemaConfig();
  if (!existing.organization || typeof existing.organization !== "object") {
    existing.organization = {};
  }
  (existing.organization as Record<string, unknown>).logo = imageUrl;
  writeSchemaConfig(schemaPath, existing);
}

export function updateOrganizationName(name: string): void {
  const { schemaPath, existing } = loadWritableSchemaConfig();
  if (!existing.organization || typeof existing.organization !== "object") {
    existing.organization = {};
  }
  (existing.organization as Record<string, unknown>).name = name;
  writeSchemaConfig(schemaPath, existing);
}

export function updateOrganizationTwitterHandle(handle: string): void {
  const { schemaPath, existing } = loadWritableSchemaConfig();

  if (!existing.organization || typeof existing.organization !== "object") {
    existing.organization = {};
  }
  const org = existing.organization as Record<string, unknown>;

  const normalizedHandle = handle.replace(/^@/, "").trim();
  const newUrl = normalizedHandle ? `https://twitter.com/${normalizedHandle}` : null;

  let sameAs: string[] = Array.isArray(org.same_as) ? [...(org.same_as as string[])] : [];

  const twitterIndex = sameAs.findIndex(
    (url) => typeof url === "string" && (url.includes("twitter.com/") || url.includes("x.com/"))
  );

  if (newUrl) {
    if (twitterIndex >= 0) {
      sameAs[twitterIndex] = newUrl;
    } else {
      sameAs.push(newUrl);
    }
  } else if (twitterIndex >= 0) {
    sameAs.splice(twitterIndex, 1);
  }

  org.same_as = sameAs;
  writeSchemaConfig(schemaPath, existing);
}

export function updateWebsiteDefaultSocialImage(imageUrl: string): void {
  const { schemaPath, existing } = loadWritableSchemaConfig();
  if (!existing.website || typeof existing.website !== "object") {
    existing.website = {};
  }
  (existing.website as Record<string, unknown>).default_social_image = imageUrl;
  writeSchemaConfig(schemaPath, existing);
}

export function getAvailableSchemaKeys(contentRoot?: string): string[] {
  const config = loadSchemaConfig(contentRoot);
  const keys: string[] = [];

  // Site file is organization + website templates only (courses/local_business migrated to sections).
  if (config.organization) keys.push("organization");
  if (config.website) keys.push("website");

  // Legacy catalogs may still exist until content sync; expose keys for migration tooling only.
  if (config.courses) {
    for (const slug of Object.keys(config.courses)) {
      keys.push(`courses:${slug}`);
    }
  }
  if (config.item_lists) {
    for (const slug of Object.keys(config.item_lists)) {
      keys.push(`item_lists:${slug}`);
    }
  }
  if (config.local_business) {
    for (const slug of Object.keys(config.local_business)) {
      keys.push(`local_business:${slug}`);
    }
  }

  return keys;
}

/** Stable @id for the site Organization (dual-emit / nested refs). */
export function getOrganizationId(contentRoot?: string): string {
  const config = loadSchemaConfig(contentRoot);
  const url = typeof config.organization?.url === "string" ? config.organization.url.replace(/\/$/, "") : "";
  return url ? `${url}/#organization` : "https://schema.org/#organization";
}

/** Site Organization as JSON-LD (with @context and stable @id). */
export function getOrganizationDocument(locale: string = "en", contentRoot?: string): Record<string, unknown> | null {
  const config = loadSchemaConfig(contentRoot);
  if (!config.organization) return null;
  return {
    "@context": "https://schema.org",
    "@id": getOrganizationId(contentRoot),
    ...transformToJsonLd(config.organization, locale),
  };
}

/**
 * Lightweight Organization ref for nested provider/parentOrganization fields.
 * Omits aggregateRating and other fields so dual-emit can carry the rating once.
 */
export function getOrganizationNestedRef(
  locale: string = "en",
  contentRoot?: string,
): Record<string, unknown> | null {
  const config = loadSchemaConfig(contentRoot);
  if (!config.organization) return null;
  const transformed = transformToJsonLd(config.organization, locale);
  const orgType =
    (typeof transformed["@type"] === "string" && transformed["@type"]) ||
    (typeof config.organization.type === "string" && config.organization.type) ||
    "Organization";
  const ref: Record<string, unknown> = {
    "@id": getOrganizationId(contentRoot),
    "@type": orgType,
  };
  if (typeof transformed.name === "string" && transformed.name.trim()) {
    ref.name = transformed.name;
  }
  if (typeof transformed.url === "string" && transformed.url.trim()) {
    ref.url = transformed.url;
  }
  return ref;
}

/** Site Website template properties (no @context) for prefilling page schema_org sections. */
export function getWebsiteTemplateProperties(locale: string = "en", contentRoot?: string): Record<string, unknown> | null {
  const config = loadSchemaConfig(contentRoot);
  if (!config.website) return null;
  const { default_social_image: _d, ...rest } = config.website as Record<string, unknown>;
  return { ...rest };
}

/** Site Organization template properties (no @context) for prefilling page schema_org sections. */
export function getOrganizationTemplateProperties(locale: string = "en", contentRoot?: string): Record<string, unknown> | null {
  const config = loadSchemaConfig(contentRoot);
  if (!config.organization) return null;
  return { ...config.organization };
}

/**
 * Expand `@organization` string refs inside a document to nested Organization
 * objects sharing the stable @id. Returns whether any ref was expanded.
 */
export function expandOrganizationRefs(
  doc: Record<string, unknown>,
  locale: string,
  contentRoot?: string,
): boolean {
  const nested = getOrganizationNestedRef(locale, contentRoot);
  if (!nested) return false;

  let expanded = false;
  const walk = (node: unknown): unknown => {
    if (node === "@organization") {
      expanded = true;
      return nested;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };

  const walked = walk(doc) as Record<string, unknown>;
  Object.keys(doc).forEach((k) => delete doc[k]);
  Object.assign(doc, walked);
  return expanded;
}

/** Raw course catalog entry (legacy) for migration / ensure seeding. */
export function getLegacyCourseCatalog(contentRoot?: string): Record<string, BaseSchema> {
  return loadSchemaConfig(contentRoot).courses ?? {};
}

/** Raw local_business catalog entry (legacy) for migration / ensure seeding. */
export function getLegacyLocalBusinessCatalog(contentRoot?: string): Record<string, BaseSchema> {
  return loadSchemaConfig(contentRoot).local_business ?? {};
}

export type SchemaOrgEditorOrganization = {
  type: string;
  name: string;
  url: string;
  description: string;
  description_es: string;
  founding_date: string;
  founders: Array<{ name: string }>;
  contact_point: {
    contact_type: string;
    email: string;
  };
  address: {
    address_country: string;
  };
  aggregate_rating: {
    rating_value: string;
    review_count: string;
    best_rating: string;
    worst_rating: string;
  };
  logo: string;
};

export type SchemaOrgEditorWebsite = {
  type: string;
  name: string;
  url: string;
  description: string;
  description_es: string;
  default_social_image: string;
};

export type SchemaOrgEditorPayload = {
  organization: SchemaOrgEditorOrganization;
  website: SchemaOrgEditorWebsite;
  other_keys: string[];
  path: string;
};

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function getSchemaOrgEditorPayload(contentRoot?: string): SchemaOrgEditorPayload {
  const config = loadSchemaConfig(contentRoot);
  const org = (config.organization ?? {}) as Record<string, unknown>;
  const website = (config.website ?? {}) as Record<string, unknown>;
  const orgLocales = (org.locales as Record<string, Record<string, unknown>> | undefined) ?? {};
  const webLocales = (website.locales as Record<string, Record<string, unknown>> | undefined) ?? {};
  const contact = (org.contact_point as Record<string, unknown> | undefined) ?? {};
  const address = (org.address as Record<string, unknown> | undefined) ?? {};
  const rating = (org.aggregate_rating as Record<string, unknown> | undefined) ?? {};
  const foundersRaw = Array.isArray(org.founders) ? org.founders : [];

  const other_keys = getAvailableSchemaKeys(contentRoot).filter(
    (k) => k !== "organization" && k !== "website",
  );

  return {
    path: resolveSchemaPath(contentRoot),
    other_keys,
    organization: {
      type: asString(org.type) || "Organization",
      name: asString(org.name),
      url: asString(org.url),
      description: asString(org.description),
      description_es: asString(orgLocales.es?.description),
      founding_date: asString(org.founding_date),
      founders: foundersRaw
        .filter((f): f is { name: string } => !!f && typeof f === "object" && typeof (f as { name?: unknown }).name === "string")
        .map((f) => ({ name: f.name })),
      contact_point: {
        contact_type: asString(contact.contact_type),
        email: asString(contact.email),
      },
      address: {
        address_country: asString(address.address_country),
      },
      aggregate_rating: {
        rating_value: rating.rating_value != null ? String(rating.rating_value) : "",
        review_count: rating.review_count != null ? String(rating.review_count) : "",
        best_rating: rating.best_rating != null ? String(rating.best_rating) : "",
        worst_rating: rating.worst_rating != null ? String(rating.worst_rating) : "",
      },
      logo: asString(org.logo),
    },
    website: {
      type: asString(website.type) || "WebSite",
      name: asString(website.name),
      url: asString(website.url),
      description: asString(website.description),
      description_es: asString(webLocales.es?.description),
      default_social_image: asString(website.default_social_image),
    },
  };
}

export function updateSchemaOrgEditorPayload(
  input: {
    organization?: Partial<SchemaOrgEditorOrganization>;
    website?: Partial<SchemaOrgEditorWebsite>;
  },
  contentRoot?: string,
): SchemaOrgEditorPayload {
  const { schemaPath, existing } = loadWritableSchemaConfig(contentRoot);
  const current = getSchemaOrgEditorPayload(contentRoot);

  if (input.organization) {
    const o = { ...current.organization, ...input.organization };
    if (input.organization.contact_point) {
      o.contact_point = { ...current.organization.contact_point, ...input.organization.contact_point };
    }
    if (input.organization.address) {
      o.address = { ...current.organization.address, ...input.organization.address };
    }
    if (input.organization.aggregate_rating) {
      o.aggregate_rating = {
        ...current.organization.aggregate_rating,
        ...input.organization.aggregate_rating,
      };
    }
    if (input.organization.founders) {
      o.founders = input.organization.founders;
    }

    const prevOrg = (existing.organization as Record<string, unknown> | undefined) ?? {};
    const locales = {
      ...((prevOrg.locales as Record<string, unknown>) || {}),
    } as Record<string, Record<string, unknown>>;
    if (o.description_es.trim()) {
      locales.es = { ...(locales.es || {}), description: o.description_es.trim() };
    } else if (locales.es) {
      const { description: _d, ...rest } = locales.es;
      if (Object.keys(rest).length === 0) delete locales.es;
      else locales.es = rest;
    }

    const orgOut: Record<string, unknown> = {
      ...prevOrg,
      type: o.type.trim() || "Organization",
      name: o.name.trim(),
      url: o.url.trim(),
      description: o.description.trim(),
      founding_date: o.founding_date.trim(),
      logo: o.logo.trim() || prevOrg.logo,
      founders: o.founders
        .map((f) => ({ name: (f.name || "").trim() }))
        .filter((f) => f.name),
      contact_point: {
        type: "ContactPoint",
        contact_type: o.contact_point.contact_type.trim(),
        email: o.contact_point.email.trim(),
      },
      address: {
        type: "PostalAddress",
        address_country: o.address.address_country.trim(),
      },
    };

    const rv = o.aggregate_rating.rating_value.trim();
    const rc = o.aggregate_rating.review_count.trim();
    if (rv || rc) {
      orgOut.aggregate_rating = {
        rating_value: rv ? Number(rv) || rv : undefined,
        review_count: rc ? Number(rc) || rc : undefined,
        best_rating: o.aggregate_rating.best_rating.trim()
          ? Number(o.aggregate_rating.best_rating) || o.aggregate_rating.best_rating.trim()
          : 5,
        worst_rating: o.aggregate_rating.worst_rating.trim()
          ? Number(o.aggregate_rating.worst_rating) || o.aggregate_rating.worst_rating.trim()
          : 1,
      };
    }

    if (Object.keys(locales).length > 0) orgOut.locales = locales;
    else delete orgOut.locales;

    existing.organization = orgOut;
  }

  if (input.website) {
    const w = { ...current.website, ...input.website };
    const prevWeb = (existing.website as Record<string, unknown> | undefined) ?? {};
    const locales = {
      ...((prevWeb.locales as Record<string, unknown>) || {}),
    } as Record<string, Record<string, unknown>>;
    if (w.description_es.trim()) {
      locales.es = { ...(locales.es || {}), description: w.description_es.trim() };
    } else if (locales.es) {
      const { description: _d, ...rest } = locales.es;
      if (Object.keys(rest).length === 0) delete locales.es;
      else locales.es = rest;
    }

    const webOut: Record<string, unknown> = {
      ...prevWeb,
      type: w.type.trim() || "WebSite",
      name: w.name.trim(),
      url: w.url.trim(),
      description: w.description.trim(),
      // Preserve default_social_image from Brand — do not overwrite from this editor
      default_social_image: prevWeb.default_social_image,
    };
    if (Object.keys(locales).length > 0) webOut.locales = locales;
    else delete webOut.locales;

    existing.website = webOut;
  }

  writeSchemaConfig(schemaPath, existing);
  clearSchemaCache(contentRoot);
  return getSchemaOrgEditorPayload(contentRoot);
}

export function getSchemaOrgYaml(contentRoot?: string): {
  exists: boolean;
  path: string;
  content: string;
} {
  const schemaPath = resolveSchemaPath(contentRoot);
  if (!fs.existsSync(schemaPath)) {
    return { exists: false, path: schemaPath, content: "" };
  }
  return {
    exists: true,
    path: schemaPath,
    content: fs.readFileSync(schemaPath, "utf-8"),
  };
}

export function putSchemaOrgYaml(content: string, contentRoot?: string): {
  path: string;
  content: string;
} {
  if (typeof content !== "string") {
    throw new Error("content must be a string");
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err: any) {
    throw new Error(`Invalid YAML: ${err?.message || String(err)}`);
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("schema-org.yml must be a YAML object at the root");
  }
  const schemaPath = resolveSchemaPath(contentRoot);
  const dir = path.dirname(schemaPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Normalize via dump so formatting is consistent
  const output = yaml.dump(parsed, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(schemaPath, output, "utf-8");
  clearSchemaCache(contentRoot);
  return { path: schemaPath, content: output };
}
