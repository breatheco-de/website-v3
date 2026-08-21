/**
 * Intent fields on tracking.conversion_events — agent/staff catalog for choosing conversion_name.
 * Length bounds shared by API validation and Conversions UI.
 */

export const CONVERSION_INTENT_MIN_CHARS = 30;
export const CONVERSION_INTENT_MAX_CHARS = 1000;

export type ConversionIntentField = "when_to_use" | "when_not_to_use";

/** Returns an error message if invalid, or null if ok. */
export function validateConversionIntentField(
  field: ConversionIntentField,
  raw: unknown,
): string | null {
  if (typeof raw !== "string") {
    return `${field} is required (${CONVERSION_INTENT_MIN_CHARS}–${CONVERSION_INTENT_MAX_CHARS} characters)`;
  }
  const trimmed = raw.trim();
  if (trimmed.length < CONVERSION_INTENT_MIN_CHARS) {
    return `${field} must be at least ${CONVERSION_INTENT_MIN_CHARS} characters (got ${trimmed.length})`;
  }
  if (trimmed.length > CONVERSION_INTENT_MAX_CHARS) {
    return `${field} must be at most ${CONVERSION_INTENT_MAX_CHARS} characters (got ${trimmed.length})`;
  }
  return null;
}

/** Validate both intent fields on a conversion event entry. */
export function validateConversionEventIntent(entry: {
  name?: string;
  when_to_use?: unknown;
  when_not_to_use?: unknown;
}): string | null {
  const label = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : "(unnamed)";
  for (const field of ["when_to_use", "when_not_to_use"] as const) {
    const err = validateConversionIntentField(field, entry[field]);
    if (err) return `Conversion event "${label}": ${err}`;
  }
  return null;
}

export function isConversionIntentFieldValid(raw: unknown): boolean {
  return validateConversionIntentField("when_to_use", raw) === null;
}
