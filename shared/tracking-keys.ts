/**
 * Tracking short keys for products and personas (`short_key` in `_product.yml`).
 *
 * GA4 keeps 100 characters per event value, so events carry these codes instead of
 * slugs / persona ids. Keys are unique per site: product keys among products, persona
 * keys among all of the site's personas. Retired keys (renamed / deleted) are never reused.
 */

export const SHORT_KEY_PATTERN = /^[a-z0-9]{2,6}$/;
export const SHORT_KEY_MAX = 6;
/** Sentinel values sent for "every product" and "no funnel". */
export const RESERVED_SHORT_KEYS: ReadonlySet<string> = new Set(["all", "none"]);

export type ShortKeyType = "product" | "persona";

export type RetiredShortKey = {
  key: string;
  type: ShortKeyType;
  /** Product slug (type product) or persona id (type persona). */
  id: string;
  name?: string;
  retired_at: string;
};

export type TrackingKeyPersona = { id: string; name: string; key?: string };

export type TrackingKeyProduct = {
  /** Content slug — what page funnels reference. */
  slug: string;
  content_type: string;
  product_id: string;
  name: string;
  key?: string;
  /** false when soft-removed (purchasable: false); keys stay reserved. */
  active: boolean;
  personas: TrackingKeyPersona[];
  retired: RetiredShortKey[];
};

/** Site-wide key index (wire shape for `/api/ecommerce/product-map`). */
export type TrackingKeyIndex = {
  products: TrackingKeyProduct[];
};

export function normalizeShortKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const k = raw.trim().toLowerCase();
  return k || undefined;
}

export function isValidShortKey(key: string): boolean {
  return SHORT_KEY_PATTERN.test(key) && !RESERVED_SHORT_KEYS.has(key);
}

export function shortKeyFormatError(key: string): string | null {
  if (RESERVED_SHORT_KEYS.has(key)) return `"${key}" is reserved and can't be used as a tracking key.`;
  if (!SHORT_KEY_PATTERN.test(key)) {
    return `Tracking key "${key}" must be 2 to 6 lowercase letters or digits.`;
  }
  return null;
}

export function parseRetiredShortKeys(raw: unknown): RetiredShortKey[] {
  if (!Array.isArray(raw)) return [];
  const out: RetiredShortKey[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const key = normalizeShortKey(o.key);
    const type = o.type === "product" || o.type === "persona" ? o.type : null;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!key || !type || !id) continue;
    out.push({
      key,
      type,
      id,
      ...(typeof o.name === "string" && o.name.trim() ? { name: o.name.trim() } : {}),
      retired_at: typeof o.retired_at === "string" ? o.retired_at : "",
    });
  }
  return out;
}

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "for", "to", "with", "in", "on", "who", "their", "your", "my"]);

function words(name: string): { text: string; acronym: boolean }[] {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w.toLowerCase()))
    .map((w) => ({
      text: w.toLowerCase(),
      acronym: w.length <= 4 && w === w.toUpperCase() && /[A-Z]/.test(w),
    }));
}

function baseSuggestion(name: string): string {
  const ws = words(name);
  if (ws.length === 0) return "";
  if (ws.length === 1) return ws[0].text.slice(0, 3);
  let out = "";
  for (const w of ws) out += w.acronym ? w.text : w.text[0];
  if (out.length < 2) out += ws[0].text.slice(1, 3);
  return out.slice(0, SHORT_KEY_MAX);
}

/** Readable suggestion (initials, acronyms kept), extended until it is not in `taken`. */
export function suggestShortKey(name: string, taken: ReadonlySet<string>, fallbackId = ""): string {
  let base = baseSuggestion(name);
  if (base.length < 2) base = baseSuggestion(fallbackId.replace(/[-_]+/g, " "));
  if (base.length < 2) base = (base + "xx").slice(0, 2);
  const free = (k: string) => isValidShortKey(k) && !taken.has(k);
  if (free(base)) return base;

  const ws = words(name || fallbackId.replace(/[-_]+/g, " "));
  const last = ws.length ? ws[ws.length - 1].text : "";
  for (let i = 1; i < last.length && base.length + i <= SHORT_KEY_MAX; i++) {
    const k = base + last.slice(1, 1 + i);
    if (free(k)) return k;
  }
  const stem = base.slice(0, SHORT_KEY_MAX - 1);
  for (let n = 2; n < 10; n++) {
    const k = `${stem}${n}`;
    if (free(k)) return k;
  }
  const stem2 = base.slice(0, SHORT_KEY_MAX - 2);
  for (let n = 10; n < 100; n++) {
    const k = `${stem2}${n}`;
    if (free(k)) return k;
  }
  for (let n = 0; ; n++) {
    const k = `k${n.toString(36)}`.slice(0, SHORT_KEY_MAX);
    if (free(k)) return k;
  }
}

/** Every key of `type` that is current or retired anywhere on the site. */
export function takenShortKeys(
  products: TrackingKeyProduct[],
  type: ShortKeyType,
  opts?: { exceptProductSlug?: string },
): Set<string> {
  const taken = new Set<string>();
  for (const p of products) {
    for (const r of p.retired) if (r.type === type) taken.add(r.key);
    if (opts?.exceptProductSlug && p.slug === opts.exceptProductSlug) continue;
    if (type === "product") {
      if (p.key) taken.add(p.key);
    } else {
      for (const persona of p.personas) if (persona.key) taken.add(persona.key);
    }
  }
  return taken;
}

export type ShortKeyConflict = {
  key: string;
  type: ShortKeyType;
  /** `product-slug` or `product-slug/persona-id`; `(retired)` suffix for retired holders. */
  owners: string[];
};

/** Keys used by more than one product / persona, or reusing a retired key. */
export function findShortKeyConflicts(products: TrackingKeyProduct[]): ShortKeyConflict[] {
  const holders: Record<ShortKeyType, Map<string, string[]>> = {
    product: new Map(),
    persona: new Map(),
  };
  const add = (type: ShortKeyType, key: string, owner: string) => {
    const list = holders[type].get(key) ?? [];
    list.push(owner);
    holders[type].set(key, list);
  };
  for (const p of products) {
    if (p.key) add("product", p.key, p.slug);
    for (const persona of p.personas) if (persona.key) add("persona", persona.key, `${p.slug}/${persona.id}`);
    for (const r of p.retired) {
      add(r.type, r.key, r.type === "product" ? `${r.id} (retired)` : `${p.slug}/${r.id} (retired)`);
    }
  }
  const out: ShortKeyConflict[] = [];
  for (const type of ["product", "persona"] as const) {
    for (const [key, owners] of Array.from(holders[type].entries())) {
      const current = owners.filter((o) => !o.endsWith("(retired)"));
      if (current.length > 1 || (current.length >= 1 && owners.length > current.length)) {
        out.push({ key, type, owners });
      }
    }
  }
  return out;
}

export type MissingShortKey = {
  type: ShortKeyType;
  product: string;
  persona?: string;
  name: string;
};

/** Active products / personas without a key (soft-removed products are skipped). */
export function listMissingShortKeys(products: TrackingKeyProduct[]): MissingShortKey[] {
  const out: MissingShortKey[] = [];
  for (const p of products) {
    if (!p.active) continue;
    if (!p.key) out.push({ type: "product", product: p.slug, name: p.name });
    for (const persona of p.personas) {
      if (!persona.key) out.push({ type: "persona", product: p.slug, persona: persona.id, name: persona.name });
    }
  }
  return out;
}
