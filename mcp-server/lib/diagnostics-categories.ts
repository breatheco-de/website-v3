/**
 * MCP-only: map diagnostics categories → validator names.
 * Staff HTTP Hard refresh / scope chips are unchanged (view filter only).
 */

import { validators } from "../../scripts/validation/validators/index.js";

/** Validator names whose `.category` is in the given set (lowercased). */
export function validatorNamesForCategories(categories: string[]): string[] {
  const want = new Set(
    categories.map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
  if (want.size === 0) return [];
  const names: string[] = [];
  for (const v of validators) {
    if (want.has(String(v.category || "").toLowerCase())) {
      names.push(v.name);
    }
  }
  return names;
}

/**
 * When MCP passes categories without an explicit validators list, narrow the job.
 * Returns undefined when categories omitted/empty (full/general run).
 */
export function mcpValidatorsFromCategories(
  categories: string[] | undefined,
): string[] | undefined {
  if (!categories || categories.length === 0) return undefined;
  const names = validatorNamesForCategories(categories);
  return names.length > 0 ? names : undefined;
}
