/**
 * Effective LeadForm field values: the single precedence chain used by the lead
 * payload, form_overrides matching, tracking, and the edit-mode hidden fields notice.
 *
 * Each field resolves to the first non-empty candidate (same `||` order as the
 * historical inline chains). Candidates carry their source so staff tooling can
 * explain the value without re-deriving it.
 */
import {
  resolveSubmitValueFromOptions,
  type FormFieldOption,
} from "@shared/resolveFormFieldRelationSource";
import type { FormLocationLayer } from "@shared/formLocationPolicy";

/** Hidden payload defaults may be numbers/bools after resolveDeep (e.g. entry.id). */
export type LeadFormFieldDefault = string | number | boolean;

/** Non-empty string, or any number/boolean (ids like event_id). */
export function isNonEmptyLeadFormWireScalar(
  value: unknown,
): value is LeadFormFieldDefault {
  if (typeof value === "string") return value.trim() !== "";
  return typeof value === "number" || typeof value === "boolean";
}

/** Fields with a dedicated precedence chain (always present in the resolved record). */
export const LEAD_FORM_CHAIN_FIELDS = [
  "program",
  "location",
  "region",
  "coupon",
  "referral_key",
  "current_download",
  "plan",
] as const;

const CHAIN_FIELD_SET = new Set<string>(LEAD_FORM_CHAIN_FIELDS);

export type LeadFormFieldSourceKind =
  /** Value already in form state (typed, or prefilled on load). */
  | "form_state"
  /** Logged-in profile prefill (signup forms). */
  | "signed_in_profile"
  | "page_single_location"
  | "page_single_region"
  | "visitor_location"
  | "visitor_region"
  /** The form's own single location (`fields.location.default`). */
  | "form_location"
  /** Region of the chosen location (region follows location). */
  | "location_region"
  /** Detection used only because nothing sets a location yet (content type disallows it). */
  | "visitor_location_fallback"
  /** Nothing sets a location and detection is off (save/publish is blocked). */
  | "location_missing"
  /** Program page slug resolved through the form-options catalog. */
  | "program_page_catalog"
  | "program_page"
  | "url_coupon"
  | "url_referral_key"
  | "url_referral"
  | "url_ref"
  /** `fields.<name>.default` (fixed text, or `auto` resolved — see `auto`). */
  | "configured_default"
  /** Literal `fields.<name>.default` kept when nothing else filled the field. */
  | "configured_default_literal";

/** How `default: "auto"` was resolved. */
export type LeadFormAutoDefaultSource =
  | "program_page"
  | "page_single_location"
  | "page_single_region"
  | "visitor_location"
  | "visitor_region"
  | "url_coupon"
  | "url_referral"
  | "none";

export type LeadFormLoadingKey = "session" | "formOptions" | "programOptions";

export interface LeadFormFieldCandidate {
  source: LeadFormFieldSourceKind;
  value: LeadFormFieldDefault | undefined;
  /** Set when source is configured_default and the YAML default was `auto`. */
  auto?: LeadFormAutoDefaultSource;
  /** Data this candidate depends on that may still be loading. */
  loadingKey?: LeadFormLoadingKey;
}

export interface ResolvedLeadFormField {
  name: string;
  value: LeadFormFieldDefault | undefined;
  /** Winning candidate (null when no candidate produced a value). */
  source: LeadFormFieldSourceKind | null;
  /** `auto` resolution of the winning configured_default, when applicable. */
  auto?: LeadFormAutoDefaultSource;
  /**
   * True when the form-state winner equals a later candidate's value: the effect
   * that prefilled form state copied it from that source.
   */
  viaFormState?: boolean;
  /** Ordered candidates checked (same order as the submit chain). */
  candidates: LeadFormFieldCandidate[];
  /** A candidate at or before the winner is empty because its data is still loading. */
  pending: boolean;
  /** Value is personal to the viewer (location, URL, account). */
  viewerDependent: boolean;
  /** Program only: raw pick before mapping through the program options. */
  programRawValue?: string;
}

export interface LeadFormFieldResolveContext {
  /** Current react-hook-form values. */
  values: Record<string, unknown>;
  /** Authored `data.fields` (used for the default fallback on any key). */
  fields: Record<string, { default?: LeadFormFieldDefault } | undefined>;
  /** Effective `getFieldConfig(name).default` (cardinality / landing aware). */
  getConfigDefault: (name: string) => LeadFormFieldDefault | undefined;
  programContext?: string;
  formPrograms?: Array<{ slug: string; bc_slug?: string }>;
  /** Options used to map the program pick to its submit value. */
  programOptions: FormFieldOption[];
  singleLandingLocation?: string | null;
  singleLandingRegion?: string | null;
  sessionLocation?: { slug?: string; region?: string } | null;
  utm: { coupon?: string; referral_key?: string; referral?: string; ref?: string };
  /** Signup prefill from the logged-in profile (name/email/phone). */
  identityPrefill?: Record<string, string | undefined>;
  loading?: Partial<Record<LeadFormLoadingKey, boolean>>;
  /**
   * Set when the content type opted into `forms.location`. Absent = today's order
   * (page single location, form state, detected, default).
   */
  locationPlan?: LeadFormLocationPlan | null;
  /** Region of a location slug (from form options), for "region follows location". */
  locationRegionOf?: (slug: string) => string | undefined;
}

export interface LeadFormLocationPlan {
  layer: FormLocationLayer;
  /** Locations offered by the form or the page (empty for picker / autodetect / missing). */
  locations: string[];
  /** Detected city pre-selected in a several-locations dropdown, when on the list. */
  preselected?: string | null;
}

/** How the submitted location was chosen (analytics only). */
export type LeadFormLocationSource = "visitor_picked" | "preselected" | "page" | "form" | "detected";

const VIEWER_DEPENDENT_SOURCES = new Set<LeadFormFieldSourceKind>([
  "signed_in_profile",
  "visitor_location",
  "visitor_region",
  "visitor_location_fallback",
  "url_coupon",
  "url_referral_key",
  "url_referral",
  "url_ref",
]);

/** `auto` on these fields reads the visitor session (location, URL params). */
const SESSION_AUTO_FIELDS = new Set(["location", "region", "coupon", "referral_key"]);

const VIEWER_DEPENDENT_AUTO = new Set<LeadFormAutoDefaultSource>([
  "visitor_location",
  "visitor_region",
  "url_coupon",
  "url_referral",
]);

/** Resolve `default: "auto"` (or a fixed default) to its runtime value and origin. */
export function resolveLeadFormDefaultWithSource(
  fieldName: string,
  configDefault: LeadFormFieldDefault | undefined | null,
  ctx: Pick<
    LeadFormFieldResolveContext,
    "programContext" | "singleLandingLocation" | "singleLandingRegion" | "sessionLocation" | "utm"
  >,
): { value: string; auto?: LeadFormAutoDefaultSource } {
  if (configDefault === undefined || configDefault === null) return { value: "" };
  if (typeof configDefault !== "string") return { value: String(configDefault) };
  if (configDefault !== "auto") return { value: configDefault };

  const { programContext, singleLandingLocation, singleLandingRegion, sessionLocation, utm } = ctx;
  switch (fieldName) {
    case "program":
      return programContext
        ? { value: programContext, auto: "program_page" }
        : { value: "", auto: "none" };
    case "location":
      if (singleLandingLocation) return { value: singleLandingLocation, auto: "page_single_location" };
      return sessionLocation?.slug
        ? { value: sessionLocation.slug, auto: "visitor_location" }
        : { value: "", auto: "none" };
    case "region":
      if (singleLandingRegion) return { value: singleLandingRegion, auto: "page_single_region" };
      return sessionLocation?.region
        ? { value: sessionLocation.region, auto: "visitor_region" }
        : { value: "", auto: "none" };
    case "coupon":
      return utm.coupon ? { value: utm.coupon, auto: "url_coupon" } : { value: "", auto: "none" };
    case "referral_key": {
      const v = utm.referral_key || utm.referral || utm.ref || "";
      return v ? { value: v, auto: "url_referral" } : { value: "", auto: "none" };
    }
    default:
      return { value: "", auto: "none" };
  }
}

/** Value-only `resolveDefault` (useForm defaults, autofill effects). */
export function resolveLeadFormDefault(
  fieldName: string,
  configDefault: LeadFormFieldDefault | undefined | null,
  ctx: Parameters<typeof resolveLeadFormDefaultWithSource>[2],
): string {
  return resolveLeadFormDefaultWithSource(fieldName, configDefault, ctx).value;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function defaultCandidate(
  name: string,
  ctx: LeadFormFieldResolveContext,
): LeadFormFieldCandidate {
  const { value, auto } = resolveLeadFormDefaultWithSource(name, ctx.getConfigDefault(name), ctx);
  const loadingKey: LeadFormLoadingKey | undefined =
    auto && SESSION_AUTO_FIELDS.has(name) ? "session" : undefined;
  return { source: "configured_default", value, ...(auto ? { auto } : {}), ...(loadingKey ? { loadingKey } : {}) };
}

/** Location order for content types with `forms.location`: form, then page, then detection when allowed. */
function plannedLocationCandidates(
  plan: LeadFormLocationPlan,
  ctx: LeadFormFieldResolveContext,
): LeadFormFieldCandidate[] {
  const { values, sessionLocation } = ctx;
  const current = str(values.location);
  if (plan.layer === "form" || plan.layer === "entry") {
    if (plan.locations.length === 1) {
      return [{ source: plan.layer === "form" ? "form_location" : "page_single_location", value: plan.locations[0] }];
    }
    // Several locations: only a value on the list counts (picker = every location).
    const onList = plan.locations.length === 0 || (!!current && plan.locations.includes(current));
    return [{ source: "form_state", value: onList ? current : "" }];
  }
  if (plan.layer === "autodetect") {
    return [
      { source: "form_state", value: current },
      { source: "visitor_location", value: sessionLocation?.slug, loadingKey: "session" },
      { source: "location_missing", value: "" },
    ];
  }
  return [
    { source: "form_state", value: current },
    { source: "visitor_location_fallback", value: sessionLocation?.slug, loadingKey: "session" },
    { source: "location_missing", value: "" },
  ];
}

function plannedRegionCandidates(ctx: LeadFormFieldResolveContext): LeadFormFieldCandidate[] {
  const { values, sessionLocation } = ctx;
  const location = resolveLeadFormFieldValue("location", ctx).value;
  const fromLocation =
    typeof location === "string" && location ? ctx.locationRegionOf?.(location) : undefined;
  const detectionAllowed = ctx.locationPlan?.layer === "autodetect" || ctx.locationPlan?.layer === "missing";
  return [
    { source: "location_region", value: fromLocation },
    { source: "form_state", value: str(values.region) },
    ...(detectionAllowed
      ? [{ source: "visitor_region" as const, value: sessionLocation?.region, loadingKey: "session" as const }]
      : []),
    defaultCandidate("region", ctx),
  ];
}

function chainCandidates(name: string, ctx: LeadFormFieldResolveContext): LeadFormFieldCandidate[] {
  const { values, sessionLocation, utm } = ctx;
  if (ctx.locationPlan && name === "location") return plannedLocationCandidates(ctx.locationPlan, ctx);
  if (ctx.locationPlan && name === "region") return plannedRegionCandidates(ctx);
  switch (name) {
    case "program":
      return [
        { source: "form_state", value: str(values.program) },
        {
          source: "program_page_catalog",
          value: ctx.formPrograms?.find((p) => p.slug === ctx.programContext)?.bc_slug,
          loadingKey: "formOptions",
        },
        { source: "program_page", value: ctx.programContext },
        defaultCandidate("program", ctx),
      ];
    case "location":
      return [
        { source: "page_single_location", value: ctx.singleLandingLocation ?? undefined },
        { source: "form_state", value: str(values.location) },
        { source: "visitor_location", value: sessionLocation?.slug, loadingKey: "session" },
        defaultCandidate("location", ctx),
      ];
    case "region":
      return [
        { source: "page_single_region", value: ctx.singleLandingRegion ?? undefined },
        { source: "form_state", value: str(values.region) },
        { source: "visitor_region", value: sessionLocation?.region, loadingKey: "session" },
        defaultCandidate("region", ctx),
      ];
    case "coupon":
      return [
        { source: "form_state", value: str(values.coupon) },
        { source: "url_coupon", value: utm.coupon, loadingKey: "session" },
        defaultCandidate("coupon", ctx),
      ];
    case "referral_key":
      return [
        { source: "form_state", value: str(values.referral_key) },
        { source: "url_referral_key", value: utm.referral_key, loadingKey: "session" },
        { source: "url_referral", value: utm.referral, loadingKey: "session" },
        { source: "url_ref", value: utm.ref, loadingKey: "session" },
        defaultCandidate("referral_key", ctx),
      ];
    case "current_download":
      return [
        { source: "form_state", value: str(values.current_download) },
        defaultCandidate("current_download", ctx),
      ];
    case "plan":
      return [
        { source: "form_state", value: str(values.plan) },
        defaultCandidate("plan", ctx),
      ];
    default: {
      const prefill = ctx.identityPrefill?.[name];
      const current = str(values[name]);
      const fromProfile = !!prefill && current === prefill;
      return [{ source: fromProfile ? "signed_in_profile" : "form_state", value: current }];
    }
  }
}

/** Resolve one field: winning value, its source, and every candidate checked. */
export function resolveLeadFormFieldValue(
  name: string,
  ctx: LeadFormFieldResolveContext,
): ResolvedLeadFormField {
  const candidates = chainCandidates(name, ctx);
  const isChain = CHAIN_FIELD_SET.has(name);

  // Same `a || b || c` semantics: first truthy candidate, else the last one.
  let winnerIdx = candidates.findIndex((c) => !!c.value);
  if (winnerIdx < 0) winnerIdx = isChain ? candidates.length - 1 : 0;
  let value: LeadFormFieldDefault | undefined = candidates[winnerIdx]?.value;
  if (name === "plan" && !value) value = "";

  let programRawValue: string | undefined;
  if (name === "program") {
    programRawValue = typeof value === "string" ? value : "";
    value = resolveSubmitValueFromOptions(programRawValue, ctx.programOptions) || programRawValue;
  }

  // Any fields.* default not already filled (extras like event_id).
  const cfg = ctx.fields[name];
  const plannedGeo = !!ctx.locationPlan && (name === "location" || name === "region");
  if (!plannedGeo && !isNonEmptyLeadFormWireScalar(value) && cfg && typeof cfg === "object") {
    const rawDefault = cfg.default;
    if (isNonEmptyLeadFormWireScalar(rawDefault)) {
      let fallback: LeadFormFieldDefault = rawDefault;
      let auto: LeadFormAutoDefaultSource | undefined;
      if (typeof rawDefault === "string") {
        const resolved = resolveLeadFormDefaultWithSource(name, rawDefault, ctx);
        fallback = resolved.value || rawDefault;
        auto = resolved.value ? resolved.auto : undefined;
      }
      candidates.push({
        source: resolvedFallbackSource(fallback, rawDefault),
        value: fallback,
        ...(auto ? { auto } : {}),
      });
      winnerIdx = candidates.length - 1;
      value = fallback;
    }
  }

  const winner = candidates[winnerIdx];
  let source: LeadFormFieldSourceKind | null = winner && isNonEmptyLeadFormWireScalar(winner.value)
    ? winner.source
    : null;
  let auto = winner?.auto;
  let viaFormState = false;

  // Form state is usually a copy made by the autofill effects; attribute it.
  if (source === "form_state" && winner) {
    const origin = candidates
      .slice(winnerIdx + 1)
      .find((c) => isNonEmptyLeadFormWireScalar(c.value) && c.value === winner.value);
    if (origin) {
      source = origin.source;
      auto = origin.auto;
      viaFormState = true;
    }
  }

  const loading = ctx.loading ?? {};
  const pending = candidates
    .slice(0, winnerIdx + 1)
    .some((c) => !!c.loadingKey && !!loading[c.loadingKey] && !c.value);
  const programPending =
    name === "program" && !!loading.programOptions && !!programRawValue;

  const viewerDependent =
    (source !== null && VIEWER_DEPENDENT_SOURCES.has(source)) ||
    (source === "configured_default" && !!auto && VIEWER_DEPENDENT_AUTO.has(auto));

  return {
    name,
    value,
    source,
    ...(auto && source === "configured_default" ? { auto } : {}),
    ...(viaFormState ? { viaFormState } : {}),
    candidates,
    pending: pending || programPending,
    viewerDependent,
    ...(programRawValue !== undefined ? { programRawValue } : {}),
  };
}

/** How the location that will be sent was chosen (analytics `location_source`), or null when none. */
export function resolveLeadFormLocationSource(
  ctx: LeadFormFieldResolveContext,
): LeadFormLocationSource | null {
  const r = resolveLeadFormFieldValue("location", ctx);
  if (typeof r.value !== "string" || !r.value) return null;
  switch (r.source) {
    case "form_location":
      return "form";
    case "page_single_location":
      return "page";
    case "visitor_location":
    case "visitor_location_fallback":
      return "detected";
    case "configured_default":
      return r.auto === "visitor_location" ? "detected" : r.auto === "page_single_location" ? "page" : "form";
    default: {
      const pre = ctx.locationPlan?.preselected;
      return pre && r.value === pre ? "preselected" : "visitor_picked";
    }
  }
}

function resolvedFallbackSource(
  fallback: LeadFormFieldDefault,
  rawDefault: LeadFormFieldDefault,
): LeadFormFieldSourceKind {
  return fallback === rawDefault && rawDefault === "auto"
    ? "configured_default_literal"
    : "configured_default";
}

/**
 * Full effective record for submit / override matching / tracking.
 * Keys: string form values, the chain fields, and any filled `fields.*` extras.
 */
export function resolveLeadFormFieldValues(
  ctx: LeadFormFieldResolveContext,
): Record<string, LeadFormFieldDefault> {
  const out: Record<string, LeadFormFieldDefault> = {};
  const stringValueKeys = Object.entries(ctx.values)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([k]) => k);

  const keys = new Set<string>([
    ...stringValueKeys,
    ...LEAD_FORM_CHAIN_FIELDS,
    ...Object.keys(ctx.fields),
  ]);
  const presentAlways = new Set<string>([...stringValueKeys, ...LEAD_FORM_CHAIN_FIELDS]);

  for (const key of Array.from(keys)) {
    const cfg = ctx.fields[key];
    if (!presentAlways.has(key) && (!cfg || typeof cfg !== "object")) continue;
    const { value } = resolveLeadFormFieldValue(key, ctx);
    if (presentAlways.has(key)) {
      if (value !== undefined) out[key] = value;
    } else if (isNonEmptyLeadFormWireScalar(value)) {
      out[key] = value;
    }
  }
  return out;
}
