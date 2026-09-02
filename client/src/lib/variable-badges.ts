import {
  resolveVariable,
  type VariableCondition,
  type VariableContext,
  type VariableDefinition,
} from "@/lib/variable-manager";

export function isVariableOverridden(
  def: VariableDefinition | undefined,
  name: string,
  definitions: Record<string, VariableDefinition>,
  context: VariableContext,
): boolean {
  if (!def) return false;
  const resolution = resolveVariable(name, definitions, context);
  if (!resolution) return false;
  return resolution.source !== "default";
}

export interface LocationValueDiff {
  location: string;
  value: string;
}

/**
 * Location-scoped conditions whose value differs from the currently resolved string.
 */
export function otherLocationDiffs(
  def: VariableDefinition | undefined,
  resolvedValue: string,
): LocationValueDiff[] {
  if (!def?.conditions?.length) return [];
  const out: LocationValueDiff[] = [];
  const seen = new Set<string>();

  for (const condition of def.conditions as VariableCondition[]) {
    const location = condition.query?.location;
    if (!location) continue;
    if (condition.value === resolvedValue) continue;
    const key = `${location}::${condition.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ location, value: condition.value });
  }

  return out;
}

/** Unique other location slugs with a different value than the current resolution. */
export function otherLocationDiffLocationCount(
  def: VariableDefinition | undefined,
  resolvedValue: string,
): number {
  return new Set(otherLocationDiffs(def, resolvedValue).map((d) => d.location)).size;
}
