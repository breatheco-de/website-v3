import { resolveSingleTemplateValue } from "@shared/json-field";

/**
 * Resolve `dynamic_entries.search` when it is still a `{{ single.* }}` bind.
 */
export function resolveTestimonialSearchPhrase(
  raw: unknown,
  singleEntry?: Record<string, unknown> | null,
): string {
  const resolved = resolveSingleTemplateValue(raw, singleEntry ?? {});
  return typeof resolved === "string" ? resolved.trim() : "";
}
