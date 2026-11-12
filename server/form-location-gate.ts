/**
 * Save/publish check for lead form locations (forms.location on the content type).
 * Errors: a form with no location when detection is off; location names that don't
 * exist. Warnings: hidden campuses, and a form that overrides the page's Locations.
 * Variables ({{ entry.* }}) are filled in before checking.
 */

import path from "path";
import { formObjectAtPath } from "@shared/formConsentCheck";
import { resolveBoundFormSettingsPath } from "@shared/wipeOnDuplicate";
import {
  checkLocationNames,
  effectiveFormLocationPolicy,
  formOwnLocation,
  formPageLocationMismatch,
  pageLocationValues,
  parseFormLocationPolicy,
  resolveFormLocationSource,
  type FormLocationPolicy,
  type LocationNameIndex,
} from "@shared/formLocationPolicy";
import { getContentTypeConfig } from "./content-types";
import { loadAllFieldEditors } from "./component-registry";
import { locationNameIndex } from "./location-catalog";
import { resolveSingleVars } from "./single-resolver";

export const FORM_LOCATION_MISSING_CODE = "form_location_missing";
export const FORM_LOCATION_UNKNOWN_CODE = "form_location_unknown";
export const FORM_LOCATION_HIDDEN_CODE = "form_location_hidden_campus";
export const FORM_LOCATION_MISMATCH_CODE = "form_location_page_mismatch";

export interface FormLocationIssue {
  code: string;
  message: string;
  /** e.g. sections[2].form, or the page field name for page-level issues. */
  property_path: string;
  /** Dot path to fix (update_fields), e.g. sections.2.form.fields.location.default or locations. */
  fix_field_path: string;
  section_index?: number;
  values?: string[];
}

export interface FormLocationGateResult {
  errors: FormLocationIssue[];
  warnings: FormLocationIssue[];
  /** Section indexes that hold a lead form (for "did this save touch a form"). */
  formSectionIndexes: number[];
  /** Page field the content type uses for locations (null when not configured). */
  entryField: string | null;
}

export function runFormLocationGate(opts: {
  pageData: Record<string, unknown>;
  contentType: string;
  contentRoot?: string;
  /** Injected in tests. */
  policy?: FormLocationPolicy | null;
  index?: LocationNameIndex;
  editors?: Record<string, Record<string, unknown>>;
}): FormLocationGateResult {
  const policy =
    opts.policy !== undefined
      ? opts.policy
      : parseFormLocationPolicy(getContentTypeConfig(opts.contentType, opts.contentRoot));
  const index = opts.index ?? locationNameIndex(opts.contentRoot);
  const allEditors =
    opts.editors ??
    (loadAllFieldEditors(opts.contentRoot ? path.basename(opts.contentRoot) : undefined) as Record<
      string,
      Record<string, unknown>
    >);
  const errors: FormLocationIssue[] = [];
  const warnings: FormLocationIssue[] = [];
  const formSectionIndexes: number[] = [];
  const entryField = policy?.entryField ?? null;

  const pageValues = pageLocationValues(opts.pageData, entryField);
  if (entryField && pageValues.length > 0) {
    const { unknown, hidden } = checkLocationNames(pageValues, index);
    if (unknown.length) {
      errors.push({
        code: FORM_LOCATION_UNKNOWN_CODE,
        message: `The page's ${entryField} lists locations that don't exist: ${unknown.join(", ")}. Pick real locations in Page Meta → Fields.`,
        property_path: entryField,
        fix_field_path: entryField,
        values: unknown,
      });
    }
    if (hidden.length) {
      warnings.push({
        code: FORM_LOCATION_HIDDEN_CODE,
        message: `The page's ${entryField} uses hidden campuses: ${hidden.join(", ")}. Leads still get them; update the page when the campus closes.`,
        property_path: entryField,
        fix_field_path: entryField,
        values: hidden,
      });
    }
  }

  const sections = Array.isArray(opts.pageData.sections) ? opts.pageData.sections : [];
  sections.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const section = raw as Record<string, unknown>;
    const editors = allEditors[String(section.type ?? "")] ?? {};
    const variant = typeof section.variant === "string" ? section.variant : undefined;
    const formPath = resolveBoundFormSettingsPath(editors as never, variant);
    const rawForm = formObjectAtPath(section, formPath);
    if (!rawForm) return;
    formSectionIndexes.push(i);
    const form = resolveSingleVars(rawForm, opts.pageData) as Record<string, unknown>;
    const base = formPath ? `sections[${i}].${formPath}` : `sections[${i}]`;
    const fixBase = formPath ? `sections.${i}.${formPath}` : `sections.${i}`;

    const own = formOwnLocation(form);
    if (own && own.values.length > 0) {
      const { unknown, hidden } = checkLocationNames(own.values, index);
      if (unknown.length) {
        errors.push({
          code: FORM_LOCATION_UNKNOWN_CODE,
          message: `${base} uses locations that don't exist: ${unknown.join(", ")}.`,
          property_path: `${base}.fields.location`,
          fix_field_path: `${fixBase}.fields.location.${own.mode === "fixed" ? "default" : "allowed"}`,
          section_index: i,
          values: unknown,
        });
      }
      if (hidden.length) {
        warnings.push({
          code: FORM_LOCATION_HIDDEN_CODE,
          message: `${base} uses hidden campuses: ${hidden.join(", ")}.`,
          property_path: `${base}.fields.location`,
          fix_field_path: `${fixBase}.fields.location`,
          section_index: i,
          values: hidden,
        });
      }
      const formPolicy = effectiveFormLocationPolicy(form, policy);
      const formPage = pageLocationValues(opts.pageData, formPolicy?.entryField);
      if (formPageLocationMismatch(own.values, formPage)) {
        warnings.push({
          code: FORM_LOCATION_MISMATCH_CODE,
          message: `${base} sets its own location (${own.values.join(", ")}), different from the page's (${formPage.join(", ")}). The form's wins.`,
          property_path: `${base}.fields.location`,
          fix_field_path: `${fixBase}.fields.location`,
          section_index: i,
          values: own.values,
        });
      }
    }

    if (!policy) return;
    const source = resolveFormLocationSource({ form, entry: opts.pageData, policy });
    if (source.layer === "missing") {
      errors.push({
        code: FORM_LOCATION_MISSING_CODE,
        message: `${base} has no location. Set one on the form (Forms tab → Locations) or in the page's ${entryField ?? "Locations"} (Page Meta → Fields). Location detection is off for this page type.`,
        property_path: `${base}.fields.location`,
        fix_field_path: entryField ?? `${fixBase}.fields.location.default`,
        section_index: i,
      });
    }
  });

  return { errors, warnings, formSectionIndexes, entryField };
}

/** True when an edit touched a form section or the page's Locations field. */
export function editTouchesFormLocation(
  gate: FormLocationGateResult,
  touched: { paths: string[]; sectionIndexes: Set<number> | null },
): boolean {
  if (touched.sectionIndexes === null) return gate.formSectionIndexes.length > 0;
  if (gate.formSectionIndexes.some((i) => touched.sectionIndexes!.has(i))) return true;
  const field = gate.entryField;
  return !!field && touched.paths.some((p) => p === field || p.startsWith(`${field}.`));
}

export function formLocationBlockMessage(errors: FormLocationIssue[]): string {
  return errors.map((e) => e.message).join(" ");
}
