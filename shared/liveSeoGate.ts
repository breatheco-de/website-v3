/**
 * Shared helpers for live SEO + editor.required gate failures.
 * Used by server gate + MCP error guidance (circular meta vs body fields).
 */

export const LIVE_REQUIRED_FIELDS_CODE = "live_required_fields" as const;

export type LiveRequiredFieldsCode = typeof LIVE_REQUIRED_FIELDS_CODE;

/**
 * Paths agents can set via update_fields / edit-sections update_field.
 * Meta keys use meta.* ; editor.required keys are top-level (e.g. description).
 */
export function parseLiveRequiredMissingFields(errorMessage: string): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();
  const push = (f: string) => {
    if (!seen.has(f)) {
      seen.add(f);
      fields.push(f);
    }
  };

  if (/meta\.page_title is required/i.test(errorMessage)) push("meta.page_title");
  if (/meta\.description is required/i.test(errorMessage)) push("meta.description");

  for (const m of errorMessage.matchAll(/Field "([^"]+)" is required/g)) {
    push(m[1]);
  }

  return fields;
}

/**
 * When both SEO meta.description and body description (editor.required) are empty,
 * single-field writes cannot unblock each other — agents must set them together.
 */
export function isCircularDescriptionTrap(missingFields: string[]): boolean {
  return (
    missingFields.includes("meta.description") &&
    missingFields.includes("description")
  );
}

export function circularRequiredFieldsHint(missingFields: string[]): string | null {
  if (missingFields.length < 2) return null;
  const hasMeta = missingFields.some((f) => f.startsWith("meta."));
  const hasBody = missingFields.some((f) => !f.startsWith("meta."));
  if (!hasMeta || !hasBody) return null;
  return (
    `CIRCULAR_REQUIRED_FIELDS: live saves validate SEO meta and editor.required fields together. ` +
    `Set all of [${missingFields.join(", ")}] in one multi-field write ` +
    `(MCP: update_fields; API: edit-sections with multiple update_field ops). ` +
    `Safe-attr bulk (update_entry_attributes: meta.* / funnel.*) cannot set body description and stays blocked while the other side is empty.`
  );
}
