/**
 * Effective consent check for one form object (validator + publish gate).
 * Effective consent = the form's own `consent`, plus its conversion event defaults,
 * plus the site Default (`consent.fallback`). Each `form_overrides` entry that switches
 * `conversion_name` (or carries its own `consent`) is checked as its own variant.
 */

import { resolveConsentRequirement } from "./consent-settings";
import { resolveFormDefaults, type ConversionEventDefaults } from "./resolveFormDefaults";

/** Publish blocked: a form on the page has no checkbox visitors must tick. */
export const CONSENT_REQUIRED_CODE = "consent_no_mandatory_checkbox";
/** Publish note: the site has no Default consent (`consent.fallback`). */
export const SITE_NO_DEFAULT_CONSENT_CODE = "site_no_default_consent";

/** One form (or override) on a page that fails the mandatory-consent rule. */
export type ConsentGateForm = {
  /** e.g. `sections[2].form` or `sections[2].form.form_overrides[0]`. */
  property_path: string;
  /** update_fields path to turn General on, e.g. `sections.2.form.consent.general`. */
  fix_field_path: string;
  conversion_name: string | null;
};

export type FormConsentVariant = {
  /** "form" or "form_overrides[i]". */
  where: string;
  conversionName: string | null;
  required: string[];
  twoRequired: boolean;
  /** True when the form has no mandatory checkbox of its own and relies on the site Default. */
  reliesOnDefault: boolean;
};

function effectiveConsent(
  form: Record<string, unknown>,
  event: ConversionEventDefaults | undefined,
): Record<string, unknown> {
  const resolved = resolveFormDefaults({ _f: form }, event ? { name: event.name, consent: event.consent } : null, "_f");
  const consent = (resolved._f as Record<string, unknown>).consent;
  return consent && typeof consent === "object" ? (consent as Record<string, unknown>) : {};
}

export function checkFormConsent(
  form: Record<string, unknown>,
  events: ConversionEventDefaults[],
  fallbackKey: string | null | undefined,
): FormConsentVariant[] {
  const byName = new Map(events.map((e) => [e.name, e]));
  const variants: Array<{ where: string; form: Record<string, unknown> }> = [{ where: "form", form }];
  const overrides = Array.isArray(form.form_overrides) ? form.form_overrides : [];
  overrides.forEach((o, i) => {
    if (!o || typeof o !== "object") return;
    const ov = o as Record<string, unknown>;
    const switchesEvent = typeof ov.conversion_name === "string" && ov.conversion_name !== form.conversion_name;
    const ownConsent = ov.consent && typeof ov.consent === "object";
    if (!switchesEvent && !ownConsent) return;
    variants.push({
      where: `form_overrides[${i}]`,
      form: {
        ...form,
        ...(switchesEvent ? { conversion_name: ov.conversion_name } : {}),
        ...(ownConsent ? { consent: { ...((form.consent as object) ?? {}), ...(ov.consent as object) } } : {}),
      },
    });
  });

  return variants.map(({ where, form: f }) => {
    const name = typeof f.conversion_name === "string" ? f.conversion_name : null;
    const consent = effectiveConsent(f, name ? byName.get(name) : undefined);
    const withDefault = resolveConsentRequirement(consent, fallbackKey);
    const own = resolveConsentRequirement(consent, null);
    return {
      where,
      conversionName: name,
      required: withDefault.required,
      twoRequired: withDefault.twoRequired,
      reliesOnDefault: own.required.length === 0,
    };
  });
}

/** Lead form settings object inside a section, given its bound path ("" = the section itself). */
export function formObjectAtPath(
  section: Record<string, unknown>,
  formSettingsPath: string | null | undefined,
): Record<string, unknown> | null {
  if (formSettingsPath == null) return null;
  if (!formSettingsPath) return section;
  let current: unknown = section;
  for (const part of formSettingsPath.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : null;
}
