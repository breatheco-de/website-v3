/**
 * Resolve LeadForm `form_overrides`: first entry whose `conditions` all match
 * (AND) overlays form props for UI + submit. No match → null (caller keeps root).
 *
 * Condition left-hand side (XOR per condition):
 * - `form_field_slug` → submitted/watched form field value
 * - `entry_field_slug` → bare entry field path on `options.entry` (e.g. event_started).
 *   Looked up at match time — do not use {{ entry.* }} here (section resolveDeep
 *   would replace the template before LeadForm runs).
 *
 * Condition `value` goes through resolveValue when provided (e.g. "{{ visitor.id }}").
 */

export type LeadFormOverrideMatchMethod = "equals" | "contains";

export interface LeadFormOverrideCondition {
  /** Form field key — actual value comes from submitted/watched form values. */
  form_field_slug?: string;
  /**
   * Bare entry field path (e.g. "event_started", "registered_attendee_ids").
   * Resolved from `options.entry` at match time — not a resolveDeep template.
   */
  entry_field_slug?: string;
  /**
   * How to compare actual vs value. Default `equals`.
   * `contains`: substring on strings; membership on arrays of scalars (ids/strings).
   */
  match_method?: LeadFormOverrideMatchMethod;
  value: unknown;
}

export interface LeadFormOverrideSuccess {
  url?: string;
  message?: string;
  /**
   * When true, after a successful submit invalidate the current entry page query
   * (non-blocking) so entry fields like registered_attendee_ids refresh.
   */
  reload_entry_fields?: boolean;
}

export interface LeadFormOverrideWebhook {
  url?: string;
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  /** When true, fire-and-forget delivery (form shows success even if upstream fails). */
  fail_silently?: boolean;
}

/** Fields a matched override may set on the form. New keys pass through automatically. */
export interface LeadFormOverrideOutcome {
  conversion_name?: string;
  success?: LeadFormOverrideSuccess;
  /** Same shape as form root: comma-separated string (e.g. "ai-lead" or "a,b"). */
  tags?: string;
  automations?: string;
  webhook?: LeadFormOverrideWebhook;
  /** Partial phase copy; deep-merged onto form messages. */
  messages?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LeadFormOverride extends LeadFormOverrideOutcome {
  conditions: LeadFormOverrideCondition[];
}

export interface ResolveLeadFormOverrideOptions {
  /** Current page/content-type entry (singleEntry). Required for entry_field_slug. */
  entry?: Record<string, unknown> | null;
  /**
   * Resolve template tokens in condition.value (e.g. client resolveDeep).
   * Omit for literal compare (tests).
   */
  resolveValue?: (raw: string) => unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  if (!path.includes(".")) return obj[path];
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function deepMergePlain(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    const prev = out[key];
    out[key] =
      isPlainObject(value) && isPlainObject(prev)
        ? deepMergePlain(prev, value)
        : value;
  }
  return out;
}

function expectedCompareString(expected: unknown): string {
  if (expected == null) return "";
  if (typeof expected === "string") return expected;
  if (typeof expected === "number" || typeof expected === "boolean") {
    return String(expected);
  }
  try {
    return JSON.stringify(expected);
  } catch {
    return String(expected);
  }
}

function valuesMatch(
  actual: unknown,
  expected: unknown,
  matchMethod: LeadFormOverrideMatchMethod,
): boolean {
  const expectedStr = expectedCompareString(expected);
  if (matchMethod === "contains") {
    if (Array.isArray(actual)) {
      return actual.some((item) => String(item ?? "") === expectedStr);
    }
    if (typeof actual === "string") {
      return actual.includes(expectedStr);
    }
    return false;
  }
  return String(actual ?? "") === expectedStr;
}

function resolveExpectedValue(
  raw: unknown,
  options?: ResolveLeadFormOverrideOptions,
): unknown {
  // Already resolved by section resolveDeep (non-string) — use as-is.
  if (typeof raw !== "string") return raw;
  const resolveValue = options?.resolveValue ?? ((s: string) => s);
  return resolveValue(raw);
}

function resolveActualValue(
  condition: LeadFormOverrideCondition,
  values: Record<string, unknown>,
  options?: ResolveLeadFormOverrideOptions,
): unknown {
  const formSlug =
    typeof condition.form_field_slug === "string"
      ? condition.form_field_slug.trim()
      : "";
  if (formSlug) {
    return formSlug.includes(".")
      ? getNested(values, formSlug)
      : values[formSlug];
  }

  const entrySlug =
    typeof condition.entry_field_slug === "string"
      ? condition.entry_field_slug.trim()
      : "";
  if (!entrySlug) return undefined;

  const entry = options?.entry;
  if (!entry || typeof entry !== "object") return undefined;
  return entrySlug.includes(".")
    ? getNested(entry, entrySlug)
    : entry[entrySlug];
}

function conditionMatches(
  condition: LeadFormOverrideCondition,
  values: Record<string, unknown>,
  options?: ResolveLeadFormOverrideOptions,
): boolean {
  const matchMethod: LeadFormOverrideMatchMethod =
    condition.match_method === "contains" ? "contains" : "equals";

  const formSlug =
    typeof condition.form_field_slug === "string"
      ? condition.form_field_slug.trim()
      : "";
  const entrySlug =
    typeof condition.entry_field_slug === "string"
      ? condition.entry_field_slug.trim()
      : "";
  if (!formSlug && !entrySlug) return false;

  return valuesMatch(
    resolveActualValue(condition, values, options),
    resolveExpectedValue(condition.value, options),
    matchMethod,
  );
}

/**
 * Returns the first matching override's outcome fields (everything except
 * `conditions`), or null if none match / list is empty/absent.
 */
export function resolveLeadFormOverride(
  values: Record<string, unknown>,
  overrides: LeadFormOverride[] | null | undefined,
  options?: ResolveLeadFormOverrideOptions,
): LeadFormOverrideOutcome | null {
  if (!overrides?.length) return null;

  for (const override of overrides) {
    const { conditions, ...outcome } = override;
    if (!conditions?.length) continue;

    const matches = conditions.every((c) =>
      conditionMatches(c, values, options),
    );
    if (!matches) continue;

    return Object.fromEntries(
      Object.entries(outcome).filter(([, v]) => v !== undefined),
    ) as LeadFormOverrideOutcome;
  }

  return null;
}

/** Normalize tags to a comma-separated string for the lead payload. */
export function normalizeLeadFormTags(
  tags: string | string[] | null | undefined,
): string {
  if (Array.isArray(tags) && tags.length > 0) {
    return tags.map(String).filter(Boolean).join(",");
  }
  if (typeof tags === "string" && tags.trim()) return tags.trim();
  return "";
}

/**
 * Merge an override outcome onto form settings. Defined keys win;
 * plain objects (e.g. success, webhook, messages) are deep-merged.
 */
export function applyLeadFormOverrideOutcome<T extends Record<string, unknown>>(
  formData: T,
  override: LeadFormOverrideOutcome | null,
): T {
  if (!override) return formData;

  const next: Record<string, unknown> = { ...formData };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const prev = next[key];
    next[key] =
      isPlainObject(value) && isPlainObject(prev)
        ? deepMergePlain(prev, value)
        : value;
  }
  return next as T;
}
