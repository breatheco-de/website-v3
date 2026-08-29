/**
 * Shared testimonials listing helpers.
 *
 * Testimonials sections (`testimonials`, `testimonials_grid`, `testimonials_slide`)
 * are listings over the `testimonials` database, authored via `dynamic_entries`
 * exactly like FAQ. `items` is runtime-resolved by resolveDynamicEntries and
 * carries bank-shaped rows, so every layout normalizes from the same shape here.
 */

export const TESTIMONIALS_DATABASE = "testimonials";

/** Ascending priority — this bank uses 1 = High, 3 = Low. */
export const TESTIMONIALS_SORT = "priority";

export type TestimonialsSectionType =
  | "testimonials"
  | "testimonials_grid"
  | "testimonials_slide";

/** Per-layout `dynamic_entries.limit` used when a section does not set one. */
export const TESTIMONIALS_LIMIT_DEFAULTS: Record<TestimonialsSectionType, number> = {
  testimonials: 10,
  testimonials_grid: 30,
  testimonials_slide: 20,
};

export const TESTIMONIALS_MAX_LIMIT = 30;

/**
 * Bank row as stored in `db/testimonials`. Section-local `hardcoded_entries`
 * use the same core fields, plus layout-only extras (slide country/status).
 */
export interface TestimonialBankRow {
  student_name?: string;
  student_thumb?: string;
  student_video?: string;
  excerpt?: string;
  full_text?: string;
  content?: string;
  /** Legacy alias still present in some hand-authored rows. */
  short_content?: string;
  related_features?: string[];
  priority?: number;
  rating?: number;
  linkedin_url?: string;
  role?: string;
  company?: string;
  locale?: string;
  featured?: boolean;
  media?: {
    url: string;
    type?: "image" | "video";
    ratio?: string;
  };
  /** Layout-only extras, authored on the section rather than the bank. */
  status?: string;
  country?: { name?: string; iso?: string };
  achievement?: string;
  contributor?: string;
  outcome?: string;
}

const ANONYMOUS_NAMES = ["anonymous", "anonimous", "anónimo", "anonimo", "anon"];

export function isAnonymousTestimonial(name: unknown): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  return !n || ANONYMOUS_NAMES.includes(n);
}

/** Longest available body text, so short excerpts never blank a card. */
export function testimonialText(row: TestimonialBankRow): string {
  return row.excerpt || row.short_content || row.content || row.full_text || "";
}

export function testimonialItemKey(studentName: unknown): string {
  return String(studentName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

/** Prefer a stable slug/id; fall back to the person's name. */
export function testimonialIgnoreIdentity(item: Record<string, unknown>): string {
  const slug = item.slug ?? item.id;
  if (slug !== undefined && slug !== null && String(slug).trim()) {
    return String(slug).toLowerCase().trim();
  }
  return testimonialItemKey(item.student_name);
}

/** Carousel: needs a named person and body text; video rows belong to the grid. */
export function isValidForCarousel(row: TestimonialBankRow): boolean {
  if (isAnonymousTestimonial(row.student_name)) return false;
  if (row.student_video) return false;
  return Boolean(testimonialText(row));
}

/** Grid: keeps video rows — they become the card media. */
export function isValidForGrid(row: TestimonialBankRow): boolean {
  if (isAnonymousTestimonial(row.student_name)) return false;
  return Boolean(testimonialText(row));
}

/** Slide: masonry cards are photo-led, so a thumb is required. */
export function isValidForSlide(row: TestimonialBankRow): boolean {
  if (isAnonymousTestimonial(row.student_name)) return false;
  if (row.student_video) return false;
  return Boolean(testimonialText(row)) && Boolean(row.student_thumb);
}

export function testimonialsValidityFilter(
  sectionType: TestimonialsSectionType,
): (row: TestimonialBankRow) => boolean {
  if (sectionType === "testimonials_grid") return isValidForGrid;
  if (sectionType === "testimonials_slide") return isValidForSlide;
  return isValidForCarousel;
}

/**
 * Flat shape the staff editor works in. Bank rows carry more fields than a
 * staff card needs, so `editorItemToBankRow` merges edits back onto the stored
 * row instead of replacing it — that keeps layout-only extras and bank columns
 * (locale, priority, related_features) intact.
 */
export interface TestimonialEditorItem {
  name: string;
  role: string;
  company?: string;
  rating: number;
  comment: string;
  outcome?: string;
  avatar?: string;
}

export function bankRowToEditorItem(row: TestimonialBankRow): TestimonialEditorItem {
  const item: TestimonialEditorItem = {
    name: row.student_name ?? "",
    role: row.role ?? row.contributor ?? "",
    rating: typeof row.rating === "number" ? row.rating : 5,
    comment: testimonialText(row),
  };
  const company = row.company ?? row.country?.name;
  if (company) item.company = company;
  const outcome = row.outcome ?? row.achievement;
  if (outcome) item.outcome = outcome;
  if (row.student_thumb) item.avatar = row.student_thumb;
  return item;
}

export function editorItemToBankRow(
  item: TestimonialEditorItem,
  previous?: TestimonialBankRow,
): TestimonialBankRow {
  const row: TestimonialBankRow = { ...previous };
  row.student_name = item.name;
  row.excerpt = item.comment;
  row.rating = item.rating;

  if (item.role) row.role = item.role;
  else delete row.role;

  if (item.company) row.company = item.company;
  else delete row.company;

  if (item.avatar) row.student_thumb = item.avatar;
  else delete row.student_thumb;

  // `achievement` is the slide's own label for the same idea; keep one of them.
  if (item.outcome) {
    if (previous?.achievement !== undefined) row.achievement = item.outcome;
    else row.outcome = item.outcome;
  } else {
    delete row.outcome;
    delete row.achievement;
  }

  // Longer bodies would silently win over the edited excerpt in testimonialText.
  delete row.short_content;
  delete row.content;
  delete row.full_text;
  return row;
}

export interface TestimonialsDynamicEntries {
  database?: string;
  limit?: number;
  sort?: string;
  search?: string;
  permanent_filters?: Array<{ item_property_slug: string; value: unknown }>;
  hardcoded_entries?: TestimonialBankRow[];
  ignored_entries?: string[];
}

/** Topics currently applied by a section, read from permanent_filters. */
export function readTestimonialTopics(
  dynamicEntries: TestimonialsDynamicEntries | undefined,
): string[] {
  const filter = dynamicEntries?.permanent_filters?.find(
    (pf) => pf.item_property_slug === "related_features",
  );
  if (!filter) return [];
  const value = filter.value;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/** Write topics back into permanent_filters, dropping the filter when empty. */
export function writeTestimonialTopics(
  dynamicEntries: TestimonialsDynamicEntries | undefined,
  topics: string[],
): TestimonialsDynamicEntries {
  const others = (dynamicEntries?.permanent_filters ?? []).filter(
    (pf) => pf.item_property_slug !== "related_features",
  );
  const next: TestimonialsDynamicEntries = { ...dynamicEntries };
  const filters = topics.length
    ? [...others, { item_property_slug: "related_features", value: topics }]
    : others;
  if (filters.length) next.permanent_filters = filters;
  else delete next.permanent_filters;
  return next;
}

/**
 * Legacy root fields (`related_features`, `limit`, carousel `items`,
 * slide `testimonials`, locale-split databases) folded into `dynamic_entries`.
 *
 * The bulk content migration rewrites authored YAML; this is the safety net for
 * files it missed and for sections pasted from older docs. Returns null when the
 * section already reads as a listing, so callers can skip a rewrite.
 */
export function normalizeTestimonialsListing(
  section: Record<string, unknown>,
): Record<string, unknown> | null {
  const sectionType = String(section.type ?? "") as TestimonialsSectionType;
  if (!(sectionType in TESTIMONIALS_LIMIT_DEFAULTS)) return null;

  const existing = (section.dynamic_entries ?? undefined) as
    | TestimonialsDynamicEntries
    | undefined;

  const legacyTopics = Array.isArray(section.related_features)
    ? (section.related_features as unknown[]).map(String).filter(Boolean)
    : [];
  const legacyLimit =
    typeof section.limit === "number" && section.limit > 0 ? section.limit : undefined;
  const legacyRows =
    sectionType === "testimonials_slide"
      ? (section.testimonials as unknown)
      : sectionType === "testimonials"
        ? (section.items as unknown)
        : undefined;
  const legacyRowList = Array.isArray(legacyRows) ? legacyRows : [];
  const legacyDatabase =
    existing?.database === "testimonials_en" || existing?.database === "testimonials_es";

  const needsRewrite =
    !existing?.database ||
    legacyDatabase ||
    legacyTopics.length > 0 ||
    legacyLimit !== undefined ||
    legacyRowList.length > 0 ||
    section.item_styles !== undefined;
  if (!needsRewrite) return null;

  let dynamicEntries: TestimonialsDynamicEntries = {
    ...existing,
    database: TESTIMONIALS_DATABASE,
    sort: existing?.sort || TESTIMONIALS_SORT,
    limit:
      existing?.limit && existing.limit > 0
        ? existing.limit
        : (legacyLimit ?? TESTIMONIALS_LIMIT_DEFAULTS[sectionType]),
  };

  if (legacyTopics.length && readTestimonialTopics(dynamicEntries).length === 0) {
    dynamicEntries = writeTestimonialTopics(dynamicEntries, legacyTopics);
  }

  // Grid is bank-only; its legacy `items` were always resolved, never authored.
  if (legacyRowList.length && sectionType !== "testimonials_grid") {
    const mapped = legacyRowList
      .map((row) => legacyRowToBankShape(row, sectionType))
      .filter((row): row is TestimonialBankRow => row !== null);
    if (mapped.length && !dynamicEntries.hardcoded_entries?.length) {
      dynamicEntries.hardcoded_entries = mapped;
    }
  }

  const next: Record<string, unknown> = { ...section, dynamic_entries: dynamicEntries };
  delete next.related_features;
  delete next.limit;
  delete next.item_styles;
  // `items` is runtime-resolved for every layout; slide authored `testimonials` moved too.
  delete next.items;
  if (sectionType === "testimonials_slide") delete next.testimonials;
  return next;
}

/**
 * Map an authored legacy row onto bank core fields, keeping layout-only extras
 * (slide country/status/achievement) that the DB deliberately does not store.
 */
export function legacyRowToBankShape(
  raw: unknown,
  sectionType: TestimonialsSectionType,
): TestimonialBankRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;

  // Already bank-shaped (re-run of the migration).
  if (typeof row.student_name === "string" && row.student_name.trim()) {
    return row as TestimonialBankRow;
  }

  const name = String(row.name ?? "").trim();
  const out: TestimonialBankRow = {};
  if (name) out.student_name = name;

  if (sectionType === "testimonials_slide") {
    const description = String(row.description ?? "").trim();
    const img = String(row.img ?? "").trim();
    if (description) out.excerpt = description;
    if (img) out.student_thumb = img;
    const contributor = String(row.contributor ?? "").trim();
    if (contributor) out.company = contributor;
    if (typeof row.status === "string" && row.status.trim()) out.status = row.status.trim();
    if (typeof row.achievement === "string" && row.achievement.trim()) {
      out.achievement = row.achievement.trim();
    }
    if (row.country && typeof row.country === "object" && !Array.isArray(row.country)) {
      const country = row.country as Record<string, unknown>;
      const iso = String(country.iso ?? "").trim();
      const countryName = String(country.name ?? "").trim();
      if (iso || countryName) out.country = { iso, name: countryName };
    }
  } else {
    const comment = String(row.comment ?? "").trim();
    if (comment) out.excerpt = comment;
    const role = String(row.role ?? "").trim();
    if (role) out.role = role;
    const company = String(row.company ?? "").trim();
    if (company) out.company = company;
    const avatar = String(row.avatar ?? "").trim();
    if (avatar) out.student_thumb = avatar;
    if (typeof row.rating === "number") out.rating = row.rating;
    const outcome = String(row.outcome ?? "").trim();
    if (outcome) out.outcome = outcome;
  }

  if (!out.student_name || !testimonialText(out)) return null;
  return out;
}
