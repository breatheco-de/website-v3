/**
 * Gate lead-form source writes: required value_path/label_path; ecommerce catalogs require query.
 * Merges update_fields patches onto the existing source object before validating.
 */

import { parseFormFieldSourceStrict } from "../../shared/parseFormFieldSource.js";
import { ecommerceManager } from "../../server/ecommerce/ecommerce-manager.js";
import { actionRequired, type McpTextResult, type NextAction } from "./respond.js";

export type MissingCatalogQueryHit = {
  property_path: string;
  content_type: string;
  purchasable_slugs: string[];
};

export type MissingSourcePathsHit = {
  property_path: string;
  error: string;
};

export type FormSourceHit = {
  property_path: string;
  source: unknown;
};

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function getAtDottedPath(root: unknown, path: string): unknown {
  if (!path) return root;
  const parts = path.split(".");
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(part);
      if (!Number.isInteger(i) || i < 0) return undefined;
      cur = cur[i];
      continue;
    }
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function mergePlain(existing: unknown, patch: unknown): unknown {
  if (isPlain(existing) && isPlain(patch)) return { ...existing, ...patch };
  if (patch === undefined) return existing;
  return patch;
}

function inspectMergedSource(
  source: unknown,
  propertyPath: string,
  queryHits: MissingCatalogQueryHit[],
  pathHits: MissingSourcePathsHit[],
): void {
  if (source == null) return;
  const parsed = parseFormFieldSourceStrict(source as Parameters<typeof parseFormFieldSourceStrict>[0]);
  if (!parsed.ok) {
    pathHits.push({ property_path: propertyPath, error: parsed.error });
    return;
  }
  const { config } = parsed;
  const ct = config.content_type;
  if (!ct || config.related_field || config.database) return;
  if (config.query && config.query.trim()) return;
  if (!ecommerceManager.contentTypeHasEcommerce(ct)) return;
  queryHits.push({
    property_path: propertyPath,
    content_type: ct,
    purchasable_slugs: ecommerceManager.listPurchasableSlugs(ct),
  });
}

function walkFields(
  fields: Record<string, unknown>,
  prefix: string,
  currentDoc: unknown | undefined,
  hits: FormSourceHit[],
): void {
  for (const [name, cfg] of Object.entries(fields)) {
    if (!isPlain(cfg) || cfg.source === undefined) continue;
    const sourcePath = `${prefix}.${name}.source`;
    const existing = currentDoc !== undefined ? getAtDottedPath(currentDoc, sourcePath) : undefined;
    hits.push({ property_path: sourcePath, source: mergePlain(existing, cfg.source) });
  }
}

function collectSourcesInNode(
  node: unknown,
  pathPrefix: string,
  currentDoc: unknown | undefined,
  hits: FormSourceHit[],
): void {
  const visit = (n: unknown, p: string) => {
    if (Array.isArray(n)) {
      n.forEach((item, i) => visit(item, p ? `${p}.${i}` : String(i)));
      return;
    }
    if (!isPlain(n)) return;
    if (isPlain(n.fields)) {
      walkFields(n.fields, p ? `${p}.fields` : "fields", currentDoc, hits);
    }
    if (isPlain(n.form)) visit(n.form, p ? `${p}.form` : "form");
    for (const [k, v] of Object.entries(n)) {
      if (k === "fields" || k === "form") continue;
      visit(v, p ? `${p}.${k}` : k);
    }
  };
  visit(node, pathPrefix);
}

/** Walk a new section / node (add_section). */
export function collectFormSourceHitsFromNode(
  node: unknown,
  pathPrefix = "",
): FormSourceHit[] {
  const hits: FormSourceHit[] = [];
  collectSourcesInNode(node, pathPrefix, undefined, hits);
  return hits;
}

/** @deprecated Use collectFormSourceHitsFromNode */
export function collectMissingCatalogQueries(
  node: unknown,
  pathPrefix = "",
): MissingCatalogQueryHit[] {
  const queryHits: MissingCatalogQueryHit[] = [];
  const pathHits: MissingSourcePathsHit[] = [];
  for (const hit of collectFormSourceHitsFromNode(node, pathPrefix)) {
    inspectMergedSource(hit.source, hit.property_path, queryHits, pathHits);
  }
  return queryHits;
}

const SOURCE_LEAF = /^(.*)\.source(?:\.(query|value_path|label_path|content_type|database|related_field|value|label|relation|name))?$/;

export function collectFormSourceHitsFromUpdates(
  updates: Array<{ field_path: string; value?: unknown }>,
  currentDoc?: unknown,
): FormSourceHit[] {
  const hits: FormSourceHit[] = [];
  const seen = new Set<string>();
  const push = (property_path: string, source: unknown) => {
    if (seen.has(property_path)) return;
    seen.add(property_path);
    hits.push({ property_path, source });
  };

  for (const u of updates) {
    const m = u.field_path.match(SOURCE_LEAF);
    if (m) {
      const sourcePath = `${m[1]}.source`;
      const leaf = m[2];
      const existing =
        currentDoc !== undefined ? getAtDottedPath(currentDoc, sourcePath) : undefined;
      const merged = leaf
        ? mergePlain(existing, { [leaf]: u.value })
        : mergePlain(existing, u.value);
      push(sourcePath, merged);
      continue;
    }
    if (isPlain(u.value) && u.value.source !== undefined) {
      const sourcePath = `${u.field_path}.source`;
      const existing =
        currentDoc !== undefined ? getAtDottedPath(currentDoc, sourcePath) : undefined;
      push(sourcePath, mergePlain(existing, u.value.source));
    }
    collectSourcesInNode(u.value, u.field_path, currentDoc, hits);
  }
  const unique: FormSourceHit[] = [];
  const keys = new Set<string>();
  for (const h of hits) {
    if (keys.has(h.property_path)) continue;
    keys.add(h.property_path);
    unique.push(h);
  }
  return unique;
}

/** @deprecated Use collectFormSourceHitsFromUpdates */
export function collectMissingCatalogQueriesFromUpdates(
  updates: Array<{ field_path: string; value: unknown }>,
  currentDoc?: unknown,
): MissingCatalogQueryHit[] {
  const queryHits: MissingCatalogQueryHit[] = [];
  const pathHits: MissingSourcePathsHit[] = [];
  for (const hit of collectFormSourceHitsFromUpdates(updates, currentDoc)) {
    inspectMergedSource(hit.source, hit.property_path, queryHits, pathHits);
  }
  return queryHits;
}

function inspectHits(hits: FormSourceHit[]): {
  queryHits: MissingCatalogQueryHit[];
  pathHits: MissingSourcePathsHit[];
} {
  const queryHits: MissingCatalogQueryHit[] = [];
  const pathHits: MissingSourcePathsHit[] = [];
  for (const hit of hits) {
    inspectMergedSource(hit.source, hit.property_path, queryHits, pathHits);
  }
  return { queryHits, pathHits };
}

function sourceWriteNextActions(ctx: {
  tool: string;
  retryArgs: Record<string, unknown>;
  site?: string;
  contentType?: string;
  slug?: string;
}): NextAction[] {
  const siteArg = ctx.site ? { site: ctx.site } : {};
  return [
    {
      tool: "explain_site",
      reason:
        "Lead-form source contract: content_type | database | related_field, required value_path and label_path, ecommerce catalogs need query",
      args_hint: { topic: "lead-forms" },
      priority: "recommended",
    },
    {
      tool: "get_content_type_info",
      reason: "Inspect field_mapping / relation_fields / ecommerce. Do not guess value_path or label_path.",
      args_hint: {
        ...(ctx.contentType ? { contentType: ctx.contentType } : {}),
        ...siteArg,
      },
      priority: "recommended",
    },
    {
      tool: "get_entry_fields",
      reason: "Inspect this entry’s related_field pointers and computed purchasable",
      args_hint: {
        ...(ctx.contentType ? { contentType: ctx.contentType } : {}),
        ...(ctx.slug ? { slug: ctx.slug } : {}),
        ...siteArg,
      },
      priority: "recommended",
    },
    {
      tool: "get_entry_content",
      reason: "Read current form YAML (source, fields, routes) for this locale only",
      args_hint: {
        ...(ctx.slug ? { slug: ctx.slug } : {}),
        ...(ctx.contentType ? { contentType: ctx.contentType } : {}),
        ...siteArg,
      },
      priority: "optional",
    },
    {
      tool: ctx.tool,
      reason:
        "Re-submit the merged source with value_path, label_path, and (for ecommerce catalogs) query. Confirm the subset with the user. Do not write single.purchasable. EN/ES are separate writes.",
      args_hint: ctx.retryArgs,
      priority: "required",
    },
  ];
}

export function formSourceWriteGate(
  hits: FormSourceHit[],
  ctx: {
    tool: string;
    retryArgs: Record<string, unknown>;
    site?: string;
    contentType?: string;
    slug?: string;
  },
): McpTextResult | null {
  const { queryHits, pathHits } = inspectHits(hits);
  if (!queryHits.length && !pathHits.length) return null;

  const firstQuery = queryHits[0];
  const subset =
    firstQuery && firstQuery.purchasable_slugs.length > 0
      ? `slug=${firstQuery.purchasable_slugs.join(",")}`
      : "slug=<slug>";

  const parts: string[] = [];
  if (pathHits.length) {
    parts.push(
      `source.value_path and source.label_path are required (dot-paths on each item). ` +
        `Do not guess keys from field_mapping. Inspect get_content_type_info / get_entry_content and confirm both paths with the user. ` +
        pathHits.map((h) => `${h.property_path}: ${h.error}`).join(" "),
    );
  }
  if (queryHits.length) {
    parts.push(
      `Catalog source.content_type on an ecommerce content type requires an explicit query. ` +
        `Typical: query: "purchasable=true". Subset: query: "${subset}". ` +
        `On a non-purchasable program page, bind that program only (source.related_field or slug query), not the full catalog. ` +
        `Do not write single.purchasable. actively_selling on _product.yml pauses the store — it is not the form filter.`,
    );
  }
  parts.push("EN/ES are separate writes (no locale fan-out).");

  const action_required =
    pathHits.length && queryHits.length
      ? "form_source_incomplete"
      : pathHits.length
        ? "source_value_label_path_required"
        : "catalog_source_query_required";

  return actionRequired(
    {
      success: false,
      action_required,
      message: parts.join(" "),
      missing_paths: pathHits,
      missing_query: queryHits,
      ...(queryHits.length
        ? { proposed_query: "purchasable=true", proposed_subset_query: subset }
        : {}),
    },
    sourceWriteNextActions(ctx),
  );
}

/** Back-compat wrapper used by add_section / update_fields until call sites use formSourceWriteGate. */
export function missingCatalogQueryGate(
  hits: MissingCatalogQueryHit[] | FormSourceHit[],
  ctx: {
    tool: string;
    retryArgs: Record<string, unknown>;
    site?: string;
    contentType?: string;
    slug?: string;
  },
): McpTextResult | null {
  if (!hits.length) return null;
  const asSourceHits: FormSourceHit[] = hits.map((h) => {
    if ("source" in h) return h as FormSourceHit;
    const q = h as MissingCatalogQueryHit;
    return {
      property_path: q.property_path,
      source: { content_type: q.content_type },
    };
  });
  return formSourceWriteGate(asSourceHits, ctx);
}
