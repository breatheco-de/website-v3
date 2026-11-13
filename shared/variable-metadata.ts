/**
 * Site variable metadata (description / category / unit / source / products / deprecated).
 * Variables are the site's fact database: categories drive review strictness
 * (figures review) and the `list_variables` MCP catalog.
 */

export const VARIABLE_CATEGORIES = [
  "price",
  "outcome_claim",
  "social_proof",
  "product_fact",
  "company_fact",
  "contact",
  "link",
  "copy",
  "system",
] as const;

export type VariableCategory = (typeof VARIABLE_CATEGORIES)[number];

/** Categories whose value changes trigger the Outcome figures review. */
export const FIGURE_CATEGORIES = ["price", "outcome_claim", "social_proof"] as const satisfies readonly VariableCategory[];

/** "Site facts": everything a reviewer should check stats against. */
export const FACT_CATEGORIES = [
  ...FIGURE_CATEGORIES,
  "product_fact",
  "company_fact",
  "contact",
] as const satisfies readonly VariableCategory[];

export const VARIABLE_UNITS = ["percent", "usd", "eur", "count", "weeks", "rating", "url", "text"] as const;

export type VariableUnit = (typeof VARIABLE_UNITS)[number];

/** Where the fact comes from: our measurement/claim vs outside sources. */
export const VARIABLE_SOURCES = ["internal", "external"] as const;

export type VariableSource = (typeof VARIABLE_SOURCES)[number];

export const VARIABLE_CATEGORY_LABELS: Record<VariableCategory, string> = {
  price: "Price",
  outcome_claim: "Outcome claim",
  social_proof: "Social proof",
  product_fact: "Product fact",
  company_fact: "Company fact",
  contact: "Contact",
  link: "Link",
  copy: "Copy",
  system: "System",
};

export const VARIABLE_CATEGORY_HINTS: Record<VariableCategory, string> = {
  price: "Tuition, monthly payments, financing amounts.",
  outcome_claim: "Hire rates, salaries, salary increases.",
  social_proof: "Review counts, ratings, alumni counts.",
  product_fact: "Program duration, tracks, eligibility.",
  company_fact: "Campuses, hiring partners, scholarships.",
  contact: "Phone numbers, emails, addresses.",
  link: "URLs such as checkout links.",
  copy: "Reusable wording (button labels, greetings).",
  system: "Technical settings managed elsewhere.",
};

export const VARIABLE_UNIT_LABELS: Record<VariableUnit, string> = {
  percent: "Percent",
  usd: "USD",
  eur: "EUR",
  count: "Count",
  weeks: "Weeks",
  rating: "Rating",
  url: "URL",
  text: "Text",
};

export const VARIABLE_SOURCE_LABELS: Record<VariableSource, string> = {
  internal: "Internal",
  external: "External",
};

/** Always-visible helper under the Source field in the edit modal. */
export const VARIABLE_SOURCE_FIELD_HINT =
  "Internal — a fact we measure or claim. External — a fact taken from outside sources.";

export interface VariableMetadata {
  description?: string;
  category?: VariableCategory | string;
  unit?: VariableUnit | string;
  /** internal = we measure/claim it; external = outside sources. */
  source?: VariableSource | string;
  /** Sellable product content slugs this fact applies to (empty/omit = site-wide). */
  products?: string[];
  deprecated?: boolean;
  replaced_by?: string;
}

export function isVariableCategory(value: unknown): value is VariableCategory {
  return typeof value === "string" && (VARIABLE_CATEGORIES as readonly string[]).includes(value);
}

export function isVariableUnit(value: unknown): value is VariableUnit {
  return typeof value === "string" && (VARIABLE_UNITS as readonly string[]).includes(value);
}

export function isVariableSource(value: unknown): value is VariableSource {
  return typeof value === "string" && (VARIABLE_SOURCES as readonly string[]).includes(value);
}

export function isFigureCategory(value: unknown): boolean {
  return typeof value === "string" && (FIGURE_CATEGORIES as readonly string[]).includes(value);
}

export function isFactCategory(value: unknown): boolean {
  return typeof value === "string" && (FACT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Normalize unknown YAML/JSON into a deduped list of product content slugs.
 * Empty / missing → undefined (site-wide). Invalid items are dropped.
 */
export function normalizeVariableProducts(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const slug = item.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out.length > 0 ? out : undefined;
}

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  "brand.title": "Site brand name shown in titles and headers. Managed in Settings → Brand.",
  "brand.logo": "Brand logo image id (light backgrounds). Managed in Settings → Brand.",
  "brand.logo_dark": "Brand logo image id for dark backgrounds. Managed in Settings → Brand.",
  "reserved.legal_terms_url": "Terms and conditions page URL used by forms. Managed in Settings → Legal.",
  "reserved.legal_privacy_url": "Privacy policy page URL used by forms. Managed in Settings → Legal.",
};

/**
 * Brand, reserved and consent keys are managed in Settings. They carry built-in
 * metadata so they never show as "missing description".
 */
export function isSystemManagedVariable(name: string, def?: { isReserved?: boolean } | null): boolean {
  if (name.startsWith("brand.") || name.startsWith("reserved.")) return true;
  return def?.isReserved === true;
}

export function builtinVariableMetadata(name: string): Required<Pick<VariableMetadata, "description" | "category">> | null {
  const key = name.startsWith("global.") ? `reserved.${name.slice("global.".length)}` : name;
  if (BUILTIN_DESCRIPTIONS[key]) {
    return { description: BUILTIN_DESCRIPTIONS[key], category: "system" };
  }
  const suffix = key.startsWith("reserved.") ? key.slice("reserved.".length) : null;
  if (suffix && suffix.startsWith("consent_")) {
    return {
      description: `Lead-form consent text (${suffix.replace(/^consent_/, "")}). Managed in Settings → Consent.`,
      category: "system",
    };
  }
  if (key.startsWith("brand.")) {
    return { description: "Brand setting. Managed in Settings → Brand.", category: "system" };
  }
  if (key.startsWith("reserved.")) {
    return { description: "Reserved setting. Managed in Settings.", category: "system" };
  }
  return null;
}

/** Effective description/category: saved metadata first, built-in for system keys. */
export function effectiveVariableMetadata(
  name: string,
  def: (VariableMetadata & { isReserved?: boolean }) | null | undefined,
): VariableMetadata & { system_managed: boolean } {
  const systemManaged = isSystemManagedVariable(name, def ?? null);
  const builtin = systemManaged ? builtinVariableMetadata(name) : null;
  const description = def?.description?.trim() || builtin?.description || undefined;
  const category = (def?.category && String(def.category).trim()) || builtin?.category || undefined;
  const source =
    def?.source && String(def.source).trim() ? String(def.source).trim() : undefined;
  const products = normalizeVariableProducts(def?.products);
  return {
    description,
    category,
    unit: def?.unit,
    source,
    products,
    deprecated: def?.deprecated === true ? true : undefined,
    replaced_by: def?.replaced_by?.trim() || undefined,
    system_managed: systemManaged,
  };
}

export function missingVariableMetadata(
  name: string,
  def: (VariableMetadata & { isReserved?: boolean }) | null | undefined,
): { description: boolean; category: boolean } {
  const eff = effectiveVariableMetadata(name, def);
  return {
    description: !eff.description,
    category: !eff.category || !isVariableCategory(eff.category),
  };
}
