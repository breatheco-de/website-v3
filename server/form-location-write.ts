/**
 * Forms tab → Locations box writes.
 * - "page": the page's Locations field (forms.location.entry_field). Live writes go to
 *   `_common.yml`; in a draft the value is staged and moves to `_common.yml` on publish.
 * - "form": this form's own `fields.location` in every language file (matched by
 *   section_id, else same position + type). The editor's own language is saved by the
 *   section editor; this writes the other languages.
 */

import path from "path";
import { resolveBoundFormSettingsPath } from "@shared/wipeOnDuplicate";
import { formObjectAtPath } from "@shared/formConsentCheck";
import { parseFormLocationPolicy } from "@shared/formLocationPolicy";
import { applyFieldUpdates } from "./field-write-router";
import { editContent, getCommonEditGateLocales } from "./content-editor";
import { getContentTypeConfig } from "./content-types";
import { loadAllFieldEditors } from "./component-registry";
import type { ContentIndex } from "./content-index";

export interface FormLocationWriteInput {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  scope: "page" | "form";
  locations: string[];
  /** Form section in the editor's language (for "form" and for clearing overrides). */
  section?: { index: number; id?: string | null; type: string };
  /** Sections (editor's language) whose own location should be cleared so they follow the page. */
  clearOverrideIndexes?: number[];
  author: string;
  contentRoot: string;
  contentRootName: string;
  ci: ContentIndex;
}

export type FormLocationWriteResult =
  | {
      ok: true;
      wrote: string[];
      updated_locales: string[];
      unmatched_locales: string[];
      cleared_overrides: number;
      warnings: Array<{ code: string; message: string }>;
    }
  | { ok: false; error: string; code?: string; details?: unknown };

/** The new `fields.location` object for a form: one = default, several = allowed, none = cleared. */
export function nextFormLocationConfig(
  current: unknown,
  locations: string[],
): Record<string, unknown> | null {
  const base =
    current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
  delete base.default;
  delete base.allowed;
  if (locations.length === 1) base.default = locations[0];
  else if (locations.length > 1) base.allowed = locations;
  return Object.keys(base).length > 0 ? base : null;
}

function sectionId(section: Record<string, unknown>): string | null {
  const id = section.section_id ?? section.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Same form in another language file: section_id, else same position and type. */
export function matchFormSection(
  sections: unknown[],
  target: { index: number; id?: string | null; type: string },
): number | null {
  if (target.id) {
    const byId = sections.findIndex(
      (s) => !!s && typeof s === "object" && sectionId(s as Record<string, unknown>) === target.id,
    );
    if (byId >= 0) return byId;
  }
  const same = sections[target.index] as Record<string, unknown> | undefined;
  if (same && typeof same === "object" && String(same.type ?? "") === target.type) return target.index;
  return null;
}

async function setFormLocationInLocale(
  input: FormLocationWriteInput,
  locale: string,
  target: { index: number; id?: string | null; type: string },
  locations: string[],
): Promise<"updated" | "unmatched" | { error: string }> {
  const loaded = input.ci.loadLocaleData(input.contentType, input.slug, locale, input.variant || undefined);
  const data = (loaded.data as Record<string, unknown> | null) ?? null;
  const sections = Array.isArray(data?.sections) ? (data!.sections as unknown[]) : [];
  const idx = matchFormSection(sections, target);
  if (idx === null) return "unmatched";
  const section = sections[idx] as Record<string, unknown>;
  const editors = (loadAllFieldEditors(path.basename(input.contentRoot))[target.type] ?? {}) as Record<string, string>;
  const variant = typeof section.variant === "string" ? section.variant : undefined;
  const formPath = resolveBoundFormSettingsPath(editors, variant);
  const form = formObjectAtPath(section, formPath);
  if (!form) return "unmatched";
  const fields = form.fields && typeof form.fields === "object" ? (form.fields as Record<string, unknown>) : {};
  const next = nextFormLocationConfig(fields.location, locations);
  const base = `sections.${idx}${formPath ? `.${formPath}` : ""}.fields`;
  const nextFields = { ...fields };
  if (next) nextFields.location = next;
  else delete nextFields.location;
  const result = await editContent({
    contentType: input.contentType,
    slug: input.slug,
    locale,
    variant: input.variant || undefined,
    operations: [{ action: "update_field", path: base, value: nextFields }],
    author: input.author,
    contentRoot: input.contentRoot,
    ci: input.ci,
  });
  if (!result.success) return { error: result.error || "write failed" };
  return "updated";
}

function otherLocales(input: FormLocationWriteInput): string[] {
  const all = getCommonEditGateLocales(input.contentType, input.slug, input.contentRootName);
  return all.filter((l) => l !== input.locale);
}

export async function writeFormLocation(input: FormLocationWriteInput): Promise<FormLocationWriteResult> {
  const locations = Array.from(new Set(input.locations.map((l) => l.trim()).filter(Boolean)));
  const warnings: Array<{ code: string; message: string }> = [];
  const wrote: string[] = [];
  const updated: string[] = [];
  const unmatched: string[] = [];
  let cleared = 0;

  if (input.scope === "page") {
    const policy = parseFormLocationPolicy(getContentTypeConfig(input.contentType, input.contentRoot));
    if (!policy?.entryField) {
      return {
        ok: false,
        code: "form_location_no_page_field",
        error: "This page type has no page Locations field set up for forms. Save the location on the form instead.",
      };
    }
    const res = await applyFieldUpdates({
      contentType: input.contentType,
      slug: input.slug,
      locale: input.locale,
      variant: input.variant,
      updates: [
        locations.length > 0
          ? { field_path: policy.entryField, value: locations }
          : { field_path: policy.entryField, op: "remove" },
      ],
      author: input.author,
      contentRoot: input.contentRoot,
      contentRootName: input.contentRootName,
      ci: input.ci,
      mode: input.variant ? "draft_only" : "direct",
    });
    if (!res.ok) return { ok: false, error: res.error, code: res.code, details: res.details };
    wrote.push(...res.wrote);
    warnings.push(...res.warnings);

    // Forms that should follow the page: clear their own location in every language.
    const current = input.ci.loadLocaleData(input.contentType, input.slug, input.locale, input.variant || undefined);
    const sections = Array.isArray((current.data as Record<string, unknown> | null)?.sections)
      ? ((current.data as Record<string, unknown>).sections as unknown[])
      : [];
    for (const idx of input.clearOverrideIndexes ?? []) {
      const sec = sections[idx] as Record<string, unknown> | undefined;
      if (!sec) continue;
      const target = { index: idx, id: sectionId(sec), type: String(sec.type ?? "") };
      for (const loc of [input.locale, ...otherLocales(input)]) {
        const r = await setFormLocationInLocale(input, loc, target, []);
        if (typeof r === "object") warnings.push({ code: "form_location_clear_failed", message: `${loc}: ${r.error}` });
      }
      cleared++;
    }
    return { ok: true, wrote, updated_locales: [input.locale], unmatched_locales: [], cleared_overrides: cleared, warnings };
  }

  if (!input.section) return { ok: false, error: "section is required for scope form" };
  for (const loc of otherLocales(input)) {
    const r = await setFormLocationInLocale(input, loc, input.section, locations);
    if (r === "updated") updated.push(loc);
    else if (r === "unmatched") unmatched.push(loc);
    else {
      unmatched.push(loc);
      warnings.push({ code: "form_location_locale_failed", message: `${loc}: ${r.error}` });
    }
  }
  return { ok: true, wrote, updated_locales: updated, unmatched_locales: unmatched, cleared_overrides: 0, warnings };
}
