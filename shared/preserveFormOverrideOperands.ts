/**
 * LeadForm `form_overrides[].conditions[]` operands are match-time templates.
 * Page/SSR resolvers may expand {{ entry.* }} etc. into non-strings; restore
 * operands from the pre-resolve tree after walking the rest of the section.
 */

const OPERAND_KEYS = [
  "field_property_slug",
  "value",
  "form_field_slug",
  "entry_field_slug",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function restoreOverrideList(original: unknown[], resolved: unknown[]): unknown[] {
  const len = Math.max(original.length, resolved.length);
  const out: unknown[] = [];
  for (let i = 0; i < len; i++) {
    const o = original[i];
    const r = resolved[i];
    if (!isPlainObject(o) || !isPlainObject(r)) {
      out.push(r !== undefined ? r : o);
      continue;
    }
    const next: Record<string, unknown> = { ...r };
    if (Array.isArray(o.conditions) && Array.isArray(r.conditions)) {
      next.conditions = r.conditions.map((rCond, ci) => {
        const oCond = o.conditions[ci];
        if (!isPlainObject(oCond) || !isPlainObject(rCond)) return rCond;
        const merged = { ...rCond };
        for (const key of OPERAND_KEYS) {
          if (key in oCond) merged[key] = oCond[key];
        }
        return merged;
      });
    }
    out.push(next);
  }
  return out;
}

/**
 * After template resolution, copy condition operand fields from `original`
 * onto the matching `form_overrides` nodes in `resolved` (any depth).
 */
export function reapplyFormOverrideConditionOperands<T>(original: T, resolved: T): T {
  function walk(orig: unknown, res: unknown): unknown {
    if (Array.isArray(orig) && Array.isArray(res)) {
      const n = Math.max(orig.length, res.length);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) {
        out.push(walk(orig[i], res[i] !== undefined ? res[i] : orig[i]));
      }
      return out;
    }
    if (isPlainObject(orig) && isPlainObject(res)) {
      const out: Record<string, unknown> = {};
      const keys = new Set([...Object.keys(orig), ...Object.keys(res)]);
      for (const key of keys) {
        if (key === "form_overrides" && Array.isArray(orig[key]) && Array.isArray(res[key])) {
          out[key] = restoreOverrideList(orig[key] as unknown[], res[key] as unknown[]);
          // Still walk nested structure inside outcomes? restoreOverrideList already
          // kept resolved outcomes and only restored operands.
          continue;
        }
        if (key in res) {
          out[key] = key in orig ? walk(orig[key], res[key]) : res[key];
        }
      }
      return out;
    }
    return res;
  }

  return walk(original, resolved) as T;
}
