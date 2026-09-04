/**
 * Set/delete a raw value at a (possibly nested) path on a parsed YAML object.
 * Used by SectionEditorPanel so a single user action can apply multiple keys
 * without consecutive setState reads clobbering each other.
 */
export function applyRawValueAtPath(
  parsed: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const pathParts = key.split(".");
  const leaf = pathParts[pathParts.length - 1] ?? "";
  // Persist YAML null for identity opt-out (missing ≠ off after duplicate wipe)
  const persistNull =
    value === null &&
    (leaf === "conversion_name" ||
      leaf === "ecommerce_products" ||
      key.endsWith(".conversion_name") ||
      key.endsWith(".ecommerce_products"));
  const shouldDelete =
    value === undefined ||
    (value === null && !persistNull) ||
    (value === "" && !persistNull);

  if (pathParts.length === 1) {
    if (!shouldDelete) {
      parsed[key] = value;
    } else {
      delete parsed[key];
    }
    return;
  }

  let current: Record<string, unknown> = parsed;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const finalKey = pathParts[pathParts.length - 1];
  if (!shouldDelete) {
    current[finalKey] = value;
    return;
  }

  delete current[finalKey];
  // Clean up empty parent objects after deletion
  if (!persistNull) {
    for (let i = pathParts.length - 2; i >= 0; i--) {
      const parentPath = pathParts.slice(0, i);
      let parent: Record<string, unknown> = parsed;
      for (const p of parentPath) {
        parent = parent[p] as Record<string, unknown>;
      }
      const child = parent[pathParts[i]];
      if (
        child &&
        typeof child === "object" &&
        Object.keys(child as Record<string, unknown>).length === 0
      ) {
        delete parent[pathParts[i]];
      } else {
        break;
      }
    }
  }
}

/** Apply multiple raw path updates on one object (batch). */
export function applyRawValuesAtPaths(
  parsed: Record<string, unknown>,
  updates: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(updates)) {
    applyRawValueAtPath(parsed, key, value);
  }
}
