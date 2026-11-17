/**
 * When a price variable is saved as price_role:list with exactly one product,
 * write that product's pricing.list_price_variable (and clear stale bindings
 * that pointed at this variable on other products).
 */

import { getVariableManager, type VariableDefinition } from "./variable-manager";
import {
  listProductRows,
  listRemovedProductRows,
  readEntryProduct,
  writeEntryProduct,
} from "./product/product-io";
import { child } from "./logger";

const log = child({ module: "variable-list-price-bind" });

export type ListPriceBindResult = {
  bound?: { content_type: string; content_slug: string; variable: string };
  cleared: Array<{ content_type: string; content_slug: string }>;
  warnings: string[];
};

function allProductRefs(contentRoot?: string): Array<{ content_type: string; content_slug: string }> {
  const live = listProductRows({ includePaused: true, contentRoot });
  const removed = listRemovedProductRows({ contentRoot });
  const seen = new Set<string>();
  const out: Array<{ content_type: string; content_slug: string }> = [];
  for (const row of [...live, ...removed]) {
    const key = `${row.content_type}/${row.content_slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ content_type: row.content_type, content_slug: row.content_slug });
  }
  return out;
}

export function syncListPriceBindingFromVariable(
  variableName: string,
  def: VariableDefinition | null | undefined,
  contentRoot?: string,
): ListPriceBindResult {
  const warnings: string[] = [];
  const cleared: ListPriceBindResult["cleared"] = [];
  if (!def || def.category !== "price") {
    return { cleared, warnings };
  }

  const products = Array.isArray(def.products)
    ? def.products.filter((p): p is string => typeof p === "string" && !!p.trim())
    : [];
  const role = typeof def.price_role === "string" ? def.price_role.trim() : "";
  const refs = allProductRefs(contentRoot);

  const clearIfBound = (exceptSlug?: string) => {
    for (const row of refs) {
      if (exceptSlug && row.content_type === "program" && row.content_slug === exceptSlug) continue;
      const full = readEntryProduct(row.content_type, row.content_slug, contentRoot);
      if (full?.pricing?.list_price_variable !== variableName) continue;
      const result = writeEntryProduct(
        row.content_type,
        row.content_slug,
        { pricing: { list_price_variable: null } },
        contentRoot,
      );
      if (result.ok) {
        cleared.push({ content_type: row.content_type, content_slug: row.content_slug });
      } else {
        warnings.push(`Could not clear list price on ${row.content_slug}: ${result.error}`);
      }
    }
  };

  if (role !== "list" || products.length !== 1) {
    clearIfBound();
    return { cleared, warnings };
  }

  const targetSlug = products[0]!;
  const contentType = "program";
  clearIfBound(targetSlug);

  const bind = writeEntryProduct(
    contentType,
    targetSlug,
    { pricing: { list_price_variable: variableName } },
    contentRoot,
  );
  if (!bind.ok) {
    warnings.push(`Could not bind list price to ${targetSlug}: ${bind.error}`);
    log.warn({ variableName, targetSlug, error: bind.error }, "list price bind failed");
    return { cleared, warnings };
  }

  return {
    bound: { content_type: contentType, content_slug: targetSlug, variable: variableName },
    cleared,
    warnings,
  };
}

/** After any variable write, re-read def and sync list binding when applicable. */
export function syncListPriceBindingAfterWrite(
  variableName: string,
  contentRoot?: string,
): ListPriceBindResult {
  const def = getVariableManager(contentRoot).getDefinition(variableName);
  return syncListPriceBindingFromVariable(variableName, def, contentRoot);
}
