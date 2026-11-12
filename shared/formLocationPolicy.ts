/**
 * Where a lead form's location comes from, per content type (`forms.location` in
 * content-types.yml). Order: the form's own setting, then the page field named by
 * `entry_field` (a relation to `location`), then visitor detection when allowed.
 * Pure: shared by the browser form, the save/publish gate and diagnostics.
 */

import { normalizeRelationPointers } from "./relation-field";

export interface FormLocationPolicy {
  /** Page (entry) relation field that lists this page's locations. */
  entryField: string | null;
  /** When false, a form must get its location from the form or the page. */
  autodetect: boolean;
}

/** Locations that stand for a region or "online", not a campus with a city. */
export const REGION_WIDE_LOCATION_SLUGS = new Set(["remote", "rest-of-america", "rest-of-europe"]);

export type FormLocationLayer = "form" | "entry" | "autodetect" | "missing";

export interface FormOwnLocation {
  /**
   * picker: the field is visible, so the visitor picks (from `allowed` when set, else every location).
   * allowed: hidden field limited to `allowed` (one = locked, several = dropdown).
   * fixed: hidden field with a real `default` (a variable may resolve to several).
   */
  mode: "fixed" | "allowed" | "picker";
  values: string[];
}

export interface FormLocationSource {
  layer: FormLocationLayer;
  /** Locations offered (empty for picker / autodetect / missing). */
  locations: string[];
  own: FormOwnLocation | null;
}

export interface LocationNameIndex {
  /** Every location slug on the site, listed or hidden. */
  known: Set<string>;
  /** Slugs of locations hidden from the public list (`visibility: unlisted`). */
  hidden: Set<string>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function parseFormLocationPolicy(config: unknown): FormLocationPolicy | null {
  if (!isPlainObject(config)) return null;
  const forms = config.forms;
  if (!isPlainObject(forms)) return null;
  const loc = forms.location;
  if (!isPlainObject(loc)) return null;
  const entryField = typeof loc.entry_field === "string" && loc.entry_field.trim() ? loc.entry_field.trim() : null;
  return { entryField, autodetect: loc.autodetect !== false };
}

export function hasUnresolvedTemplate(value: string): boolean {
  return value.includes("{{");
}

/** Location values from a string (comma-separated allowed), string[] or hydrated objects with `slug`. */
export function splitLocationValues(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    if (hasUnresolvedTemplate(t)) return [t];
    return t
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const el of raw) {
      if (typeof el === "string" && el.trim()) out.push(el.trim());
      else if (isPlainObject(el) && typeof el.slug === "string" && el.slug.trim()) out.push(el.slug.trim());
    }
    return Array.from(new Set(out));
  }
  if (isPlainObject(raw) && typeof raw.slug === "string" && raw.slug.trim()) return [raw.slug.trim()];
  return [];
}

/** The form's own location setting (`fields.location`), or null when the form leaves it to the page. */
export function formOwnLocation(form: Record<string, unknown> | null | undefined): FormOwnLocation | null {
  if (!form) return null;
  const fields = form.fields;
  if (!isPlainObject(fields)) return null;
  const loc = fields.location;
  if (!isPlainObject(loc)) return null;

  const allowed = splitLocationValues(loc.allowed);
  if (loc.visible === true) return { mode: "picker", values: allowed };
  if (allowed.length > 0) return { mode: "allowed", values: allowed };

  const def = loc.default;
  if (Array.isArray(def)) {
    const values = splitLocationValues(def);
    if (values.length > 0) return { mode: "fixed", values };
  } else if (typeof def === "string" && def.trim() && def.trim() !== "auto") {
    const values = splitLocationValues(def);
    if (values.length > 0) return { mode: "fixed", values };
  }
  return null;
}

export function formSetsLocation(form: Record<string, unknown> | null | undefined): boolean {
  return formOwnLocation(form) !== null;
}

/** Location slugs stored on the page field (relation pointers or hydrated objects). */
export function pageLocationValues(
  entry: Record<string, unknown> | null | undefined,
  entryField: string | null | undefined,
): string[] {
  if (!entry || !entryField) return [];
  const raw = entry[entryField];
  if (Array.isArray(raw) && raw.some((el) => isPlainObject(el))) return splitLocationValues(raw);
  const normalized = normalizeRelationPointers(raw);
  if (!normalized.ok || normalized.value === null) return [];
  return Array.isArray(normalized.value) ? normalized.value : [normalized.value];
}

/** `fields.location.source.related_field` on the form (explicit page field), if any. */
export function formLocationRelatedField(form: Record<string, unknown> | null | undefined): string | null {
  const fields = form?.fields;
  if (!isPlainObject(fields)) return null;
  const loc = fields.location;
  if (!isPlainObject(loc) || !isPlainObject(loc.source)) return null;
  const rf = loc.source.related_field;
  return typeof rf === "string" && rf.trim() ? rf.trim() : null;
}

/** Policy for one form: an explicit `source.related_field` replaces the type's `entry_field`. */
export function effectiveFormLocationPolicy(
  form: Record<string, unknown> | null | undefined,
  policy: FormLocationPolicy | null,
): FormLocationPolicy | null {
  const related = formLocationRelatedField(form);
  if (!related) return policy;
  return { entryField: related, autodetect: policy?.autodetect ?? true };
}

export function resolveFormLocationSource(opts: {
  form: Record<string, unknown> | null | undefined;
  entry: Record<string, unknown> | null | undefined;
  policy: FormLocationPolicy | null;
}): FormLocationSource {
  const own = formOwnLocation(opts.form);
  if (own) return { layer: "form", locations: own.values, own };
  const policy = effectiveFormLocationPolicy(opts.form, opts.policy);
  if (policy !== opts.policy) return resolveFormLocationSource({ ...opts, form: null, policy });
  const page = pageLocationValues(opts.entry, opts.policy?.entryField);
  if (page.length > 0) return { layer: "entry", locations: page, own: null };
  if (!opts.policy || opts.policy.autodetect) return { layer: "autodetect", locations: [], own: null };
  return { layer: "missing", locations: [], own: null };
}

/**
 * Wrong and hidden location names. Values still holding `{{ … }}` (not filled in)
 * are skipped: they can only be checked once the page resolves them.
 */
export function checkLocationNames(
  values: string[],
  index: LocationNameIndex,
): { unknown: string[]; hidden: string[] } {
  const unknown: string[] = [];
  const hidden: string[] = [];
  // A site without location entries has nothing to check against.
  if (index.known.size === 0) return { unknown, hidden };
  for (const v of values) {
    if (!v || hasUnresolvedTemplate(v)) continue;
    if (!index.known.has(v)) unknown.push(v);
    else if (index.hidden.has(v)) hidden.push(v);
  }
  return { unknown, hidden };
}

/** Form and page both set locations and they differ (the form wins). */
export function formPageLocationMismatch(formValues: string[], pageValues: string[]): boolean {
  if (formValues.length === 0 || pageValues.length === 0) return false;
  const page = new Set(pageValues);
  return formValues.some((v) => !hasUnresolvedTemplate(v) && !page.has(v));
}
