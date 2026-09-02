import { resolveFormDefaults, type ConversionEventDefaults } from "./resolveFormDefaults";
import {
  allReservedAuthEventNames,
  type AuthConversionEventConfig,
} from "./authConversionEvents";

/**
 * Resolves a form section's effective settings by merging conversion event defaults.
 * Form-level YAML values always win; missing fields fall back to the event definition.
 *
 * Use this as the canonical entry point before rendering or validating any form
 * section — ensures automations, tags, consent, and webhook are consistently derived
 * across the editor UI, live render path, and submission handling.
 *
 * @param section       The raw parsed section object from YAML.
 * @param conversionEvent The matching ConversionEventEntry (or null/undefined).
 * @param formSettingsPath Dot-path to the form settings object within the section (default "form").
 */
export function resolveFormSection(
  section: Record<string, unknown>,
  conversionEvent: ConversionEventDefaults | null | undefined,
  formSettingsPath: string = "form"
): Record<string, unknown> {
  return resolveFormDefaults(section, conversionEvent, formSettingsPath);
}

function getFormSettingsObject(
  section: Record<string, unknown>,
  formSettingsPath: string,
): Record<string, unknown> | null {
  if (!formSettingsPath) {
    return section;
  }
  const parts = formSettingsPath.split(".").filter(Boolean);
  let current: unknown = section;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return null;
  return current as Record<string, unknown>;
}

/**
 * Normalize a conversion_name for membership checks against known events.
 * Exact `{{ entry.… | plainFallback }}` / legacy `{{ single.… }}` binds → validate the plain fallback.
 * Other template binds (no usable plain fallback) → skip (return null).
 * Plain strings → return as-is.
 */
export function conversionNameForValidation(raw: string): string | null {
  const name = raw.trim();
  if (!name) return null;

  const exactTemplate = name.match(
    /^\{\{\s*(?:entry|single)\.[a-zA-Z_][a-zA-Z0-9_.]*\s*(?:\|\s*([\s\S]*?))?\s*\}\}$/,
  );
  if (exactTemplate) {
    const fallback = exactTemplate[1]?.trim() ?? "";
    if (!fallback) return null;
    // Nested/object JSON fallbacks are not conversion names
    if (fallback.startsWith("{") || fallback.startsWith("[")) return null;
    if (fallback.includes("{{")) return null;
    return fallback;
  }

  if (name.includes("{{")) return null;
  return name;
}

/** Collect non-empty conversion_name from form root and routes[].conversion_name. */
export function collectConversionNames(form: Record<string, unknown>): string[] {
  const names: string[] = [];
  const rootName = form.conversion_name;
  if (typeof rootName === "string" && rootName.trim()) {
    names.push(rootName.trim());
  }
  const routes = form.routes;
  if (Array.isArray(routes)) {
    for (const route of routes) {
      if (!route || typeof route !== "object" || Array.isArray(route)) continue;
      const routeName = (route as Record<string, unknown>).conversion_name;
      if (typeof routeName === "string" && routeName.trim()) {
        names.push(routeName.trim());
      }
    }
  }
  return names;
}

/**
 * When a section has a form-settings bind **and** the form object is present,
 * require an explicit conversion decision:
 * - non-empty conversion_name on form root or any route → on
 * - root `conversion_name: null` → explicit off
 * - key missing (e.g. after duplicate wipe) → invalid
 *
 * Nested binds (e.g. `signup_card.form`) may be absent when the section is CTA-only
 * (button → modal / link). That matches cta-tracking: validate only when the object exists.
 * Root bind (`""`, lead_form) always uses the section as the form object.
 *
 * @param formSettingsPath "" = settings on section root (lead_form); "form" = nested.
 */
export function validateRequiredConversionName(
  section: Record<string, unknown>,
  formSettingsPath: string | null | undefined,
): string | null {
  if (formSettingsPath == null) return null;
  const form = getFormSettingsObject(section, formSettingsPath);
  // Optional presence for nested form-settings (CTA-only heroes, etc.).
  if (!form) return null;
  // Account gate: conversion goal is optional (signup-only / login-only forms).
  if (form.is_signup === true) return null;
  if (collectConversionNames(form).length > 0) return null;

  const label = formSettingsPath ? `${formSettingsPath}.conversion_name` : "conversion_name";
  if ("conversion_name" in form) {
    if (form.conversion_name === null) return null;
    if (form.conversion_name === "") {
      return (
        `${label} is empty — set a conversion name from tracking.conversion_events Intent ` +
        `(when_to_use / when_not_to_use via explain_site topic component-behaviors), ` +
        `matching this section’s visitor CTA copy — or use null to turn conversion off. ` +
        `Do not restore a pre-duplicate conversion_name.`
      );
    }
  }

  return (
    `${label} is required (set a name from conversion_events Intent matching this section’s CTA, ` +
    `a route conversion_name, or null to turn off). ` +
    `Duplicating clears conversion names on purpose — choose again from visitor intent; ` +
    `never copy the source page’s conversion_name.`
  );
}

/**
 * Validates a section's `form` config.
 *
 * Returns null if the section has no `form` key or the config is valid.
 * When a name is set (root or any route), it must be in `conversionNames` if that list is provided.
 * Use {@link validateRequiredConversionName} to require a name when form-settings is bound.
 */
export function validateFormSection(
  section: Record<string, unknown>,
  conversionNames?: string[],
  authConversion?: AuthConversionEventConfig | null,
): string | null {
  if (!("form" in section)) return null;

  const form = section.form as Record<string, unknown> | null | undefined;

  if (!form || typeof form !== "object") {
    return "section.form must be an object";
  }

  // Only validate CMS form components — identified by having a `variant` field
  // (e.g. "stacked", "inline"). Sections that use `form:` for label/config
  // objects (e.g. apply_form, hero signup labels) don't need conversion_name.
  if (!("variant" in form)) return null;

  const namesToCheck = collectConversionNames(form);

  if (!conversionNames?.length && !authConversion) return null;

  const allowed = new Set(conversionNames ?? []);
  if (authConversion) {
    for (const n of allReservedAuthEventNames(authConversion)) {
      allowed.add(n);
    }
  }

  for (const raw of namesToCheck) {
    const name = conversionNameForValidation(raw);
    if (name === null) continue;
    if (allowed.size > 0 && !allowed.has(name)) {
      return `conversion_name "${name}" is not valid. Valid values: ${[...allowed].join(", ")}`;
    }
  }

  return null;
}
