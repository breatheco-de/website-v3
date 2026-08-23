/**
 * Opt-in JSON-LD field requirements per schema.org @type.
 * Undeclared types are not validated for field presence.
 */

export type JsonLdSchemaSource =
  | "faq"
  | "article"
  | "breadcrumb"
  | "schema_org"
  | "organization";

export type JsonLdFieldRule = {
  /** Top-level keys: non-empty string, non-empty array, or object. */
  require?: string[];
  /** At least one group must be fully satisfied (e.g. url OR @id). */
  requireOneOf?: string[][];
};

export const JSON_LD_FIELD_RULES: Record<string, JsonLdFieldRule> = {
  BlogPosting: {
    require: ["headline", "description", "datePublished", "author"],
  },
  Article: {
    require: ["headline", "description"],
  },
  Course: {
    require: ["name", "description"],
  },
  LocalBusiness: {
    require: ["name", "url"],
  },
  Person: {
    require: ["name"],
    requireOneOf: [["url"], ["@id"]],
  },
};

export type JsonLdRequiredField =
  | "headline"
  | "description"
  | "datePublished"
  | "author"
  | "name"
  | "url"
  | "@id";

export function jsonLdPrimaryType(doc: Record<string, unknown>): string | null {
  const t = doc["@type"];
  if (typeof t === "string" && t.trim()) return t.trim();
  if (Array.isArray(t)) {
    const first = t.find((x): x is string => typeof x === "string" && x.trim().length > 0);
    return first?.trim() ?? null;
  }
  return null;
}

export function getJsonLdFieldRule(doc: Record<string, unknown>): JsonLdFieldRule | null {
  const type = jsonLdPrimaryType(doc);
  if (!type) return null;
  return JSON_LD_FIELD_RULES[type] ?? null;
}

export function hasNonEmptyJsonLdValue(doc: Record<string, unknown>, key: string): boolean {
  const value = doc[key];
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return true;
  return false;
}

export function missingRequiredJsonLdFields(
  doc: Record<string, unknown>,
  rule: JsonLdFieldRule,
): JsonLdRequiredField[] {
  const missing: JsonLdRequiredField[] = [];

  for (const field of rule.require ?? []) {
    if (!hasNonEmptyJsonLdValue(doc, field)) {
      missing.push(field as JsonLdRequiredField);
    }
  }

  if (rule.requireOneOf?.length) {
    const satisfied = rule.requireOneOf.some((group) =>
      group.every((field) => hasNonEmptyJsonLdValue(doc, field)),
    );
    if (!satisfied && !missing.includes("url")) {
      missing.push("url");
    }
  }

  return missing;
}

/** Deduplicate missing fields while preserving order. */
export function collectMissingJsonLdFields(doc: Record<string, unknown>): JsonLdRequiredField[] {
  const rule = getJsonLdFieldRule(doc);
  if (!rule) return [];
  const missing = missingRequiredJsonLdFields(doc, rule);
  return [...new Set(missing)];
}

export function warningCodeForJsonLdField(field: JsonLdRequiredField): string {
  switch (field) {
    case "headline":
      return "SCHEMA_MISSING_HEADLINE";
    case "description":
      return "SCHEMA_MISSING_DESCRIPTION";
    case "datePublished":
      return "SCHEMA_MISSING_DATE_PUBLISHED";
    case "author":
      return "SCHEMA_MISSING_AUTHOR";
    case "name":
      return "SCHEMA_MISSING_NAME";
    case "url":
      return "SCHEMA_MISSING_URL";
    case "@id":
      return "SCHEMA_MISSING_ID";
    default:
      return "SCHEMA_MISSING_REQUIRED_FIELD";
  }
}

export function suggestionForMissingField(opts: {
  type: string;
  field: JsonLdRequiredField;
  source: JsonLdSchemaSource;
}): string {
  const { type, field, source } = opts;

  if (source === "article") {
    switch (field) {
      case "headline":
        return "Set meta.page_title or entry title so the article contributor can emit headline";
      case "description":
        return "Set meta.description on the page or blog entry";
      case "datePublished":
        return "Set published_at on the blog entry (database field or YAML)";
      case "author":
        return 'Map authors on the article section (e.g. authors: "{{ single.authors }}")';
      default:
        break;
    }
  }

  if (source === "schema_org") {
    if (field === "url" || field === "@id") {
      return `Add ${field === "@id" ? "@id" : "url"} under the schema_org section properties (Person hubs also get url from page URL when omitted)`;
    }
    return `Add ${field} under the schema_org section properties for ${type}`;
  }

  if (field === "url" || field === "@id") {
    return `Add ${field} to the ${type} JSON-LD document`;
  }

  return `Add ${field} to the ${type} JSON-LD document`;
}

export function messageForMissingField(opts: {
  type: string;
  field: JsonLdRequiredField;
  url: string;
}): string {
  return `${opts.type} JSON-LD missing "${opts.field}" for ${opts.url}`;
}
