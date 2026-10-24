/**
 * Tracking short key rules for product writes, and the "fill missing keys" job shared by
 * migration 009, the Diagnostics fixer and product saves.
 *
 * - Saved keys are locked: a different key needs `rename_short_key: true`, and the old key
 *   moves to `retired_short_keys` (never reused).
 * - Removing a persona retires its key.
 * - Keys are unique per site (product keys among products, persona keys among personas),
 *   counting retired keys.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  normalizeShortKey,
  parseRetiredShortKeys,
  shortKeyFormatError,
  suggestShortKey,
  takenShortKeys,
  type RetiredShortKey,
  type ShortKeyType,
} from "@shared/tracking-keys";
import { getFolder } from "../content-types";
import { resolveProductSidecarPath, productSidecarWritePath } from "./product-sidecar";
import {
  contentRootAbsolute,
  invalidateTrackingKeyIndex,
  loadTrackingKeyIndex,
  trackingKeyProductFromDoc,
} from "./tracking-key-index";

export type ShortKeyWarning = { code: string; message: string };

export type ShortKeyAssignment = {
  type: ShortKeyType;
  product: string;
  persona?: string;
  name: string;
  key: string;
};

export type ShortKeyRulesResult =
  | { ok: true; warnings: ShortKeyWarning[]; assigned: ShortKeyAssignment[]; changed: boolean }
  | { ok: false; code: string; error: string; details?: unknown };

type PersonaRow = Record<string, unknown> & { id?: unknown; short_key?: unknown };

function personaRows(doc: Record<string, unknown> | null | undefined): PersonaRow[] {
  const raw = doc?.personas ?? (doc?.audience as Record<string, unknown> | undefined)?.personas;
  return Array.isArray(raw) ? (raw.filter((p) => p && typeof p === "object") as PersonaRow[]) : [];
}

function personaName(p: PersonaRow): string {
  for (const k of ["label", "role", "id"]) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function personaId(p: PersonaRow): string {
  return typeof p.id === "string" ? p.id.trim() : "";
}

/**
 * Apply key rules to `nextDoc` (mutated) for one product, given the doc before the write.
 * Call after audience merge, before writing the file.
 */
export function applyShortKeyRules(args: {
  contentRoot?: string;
  contentType: string;
  slug: string;
  prevDoc: Record<string, unknown> | null;
  nextDoc: Record<string, unknown>;
  renameAllowed?: boolean;
  fillMissing?: boolean;
  now?: Date;
}): ShortKeyRulesResult {
  const { contentType, slug, prevDoc, nextDoc } = args;
  const renameAllowed = args.renameAllowed === true;
  const retiredAt = (args.now ?? new Date()).toISOString();
  const retired: RetiredShortKey[] = parseRetiredShortKeys(prevDoc?.retired_short_keys ?? nextDoc.retired_short_keys);
  const warnings: ShortKeyWarning[] = [];
  const assigned: ShortKeyAssignment[] = [];
  let changed = false;
  const productName =
    typeof nextDoc.name === "string" && nextDoc.name.trim() ? nextDoc.name.trim() : slug;

  const retire = (key: string, type: ShortKeyType, id: string, name: string) => {
    if (retired.some((r) => r.key === key && r.type === type)) return;
    retired.push({ key, type, id, ...(name ? { name } : {}), retired_at: retiredAt });
    changed = true;
  };

  // Product key
  const prevProductKey = normalizeShortKey(prevDoc?.short_key);
  let nextProductKey = normalizeShortKey(nextDoc.short_key);
  if (!nextProductKey && prevProductKey) nextProductKey = prevProductKey;
  if (prevProductKey && nextProductKey && nextProductKey !== prevProductKey) {
    if (!renameAllowed) {
      return {
        ok: false,
        code: "short_key_locked",
        error: `Tracking key "${prevProductKey}" is locked. Pass rename_short_key: true to change it (old reports keep the old code).`,
        details: { product: slug, key: prevProductKey },
      };
    }
    retire(prevProductKey, "product", slug, productName);
    warnings.push({
      code: "short_key_renamed",
      message: `Product tracking key changed from "${prevProductKey}" to "${nextProductKey}". Reports before today keep "${prevProductKey}"; it is retired and can't be used again.`,
    });
  }
  if (nextProductKey) nextDoc.short_key = nextProductKey;
  else delete nextDoc.short_key;

  // Persona keys
  const prevPersonas = new Map(personaRows(prevDoc).map((p) => [personaId(p), p]));
  const nextPersonas = personaRows(nextDoc);
  const nextIds = new Set(nextPersonas.map(personaId));
  for (const p of nextPersonas) {
    const id = personaId(p);
    const prev = prevPersonas.get(id);
    const prevKey = normalizeShortKey(prev?.short_key);
    let key = normalizeShortKey(p.short_key);
    if (!key && prevKey) key = prevKey;
    if (prevKey && key && key !== prevKey) {
      if (!renameAllowed) {
        return {
          ok: false,
          code: "short_key_locked",
          error: `Persona "${id}" tracking key "${prevKey}" is locked. Pass rename_short_key: true to change it (old reports keep the old code).`,
          details: { product: slug, persona: id, key: prevKey },
        };
      }
      retire(prevKey, "persona", id, personaName(prev ?? p));
      warnings.push({
        code: "short_key_renamed",
        message: `Persona "${id}" tracking key changed from "${prevKey}" to "${key}". Reports before today keep "${prevKey}"; it is retired and can't be used again.`,
      });
    }
    if (key) p.short_key = key;
    else delete p.short_key;
  }
  for (const [id, prev] of prevPersonas) {
    if (!id || nextIds.has(id)) continue;
    const prevKey = normalizeShortKey(prev.short_key);
    if (prevKey) {
      retire(prevKey, "persona", id, personaName(prev));
      warnings.push({
        code: "short_key_retired",
        message: `Persona "${id}" was removed; its tracking key "${prevKey}" is retired and can't be used again.`,
      });
    }
  }

  // Format
  const allKeys: { type: ShortKeyType; key: string; label: string }[] = [];
  if (nextProductKey) allKeys.push({ type: "product", key: nextProductKey, label: `product ${slug}` });
  for (const p of nextPersonas) {
    const k = normalizeShortKey(p.short_key);
    if (k) allKeys.push({ type: "persona", key: k, label: `persona ${personaId(p)}` });
  }
  for (const k of allKeys) {
    const err = shortKeyFormatError(k.key);
    if (err) return { ok: false, code: "invalid_short_key", error: `${err} (${k.label})`, details: k };
  }

  // Uniqueness: other products (current + retired) plus this product's retired keys
  const others = loadTrackingKeyIndex(args.contentRoot, { fresh: true }).products;
  const takenProduct = takenShortKeys(others, "product", { exceptProductSlug: slug });
  const takenPersona = takenShortKeys(others, "persona", { exceptProductSlug: slug });
  for (const r of retired) (r.type === "product" ? takenProduct : takenPersona).add(r.key);
  const ownerOf = (type: ShortKeyType, key: string): string => {
    for (const o of others) {
      if (type === "product" && o.slug !== slug && o.key === key) return o.slug;
      if (type === "persona" && o.slug !== slug) {
        const hit = o.personas.find((p) => p.key === key);
        if (hit) return `${o.slug}/${hit.id}`;
      }
      const ret = o.retired.find((r) => r.type === type && r.key === key);
      if (ret) return `${o.slug === slug ? "" : `${o.slug}/`}${ret.id} (retired)`;
    }
    const own = retired.find((r) => r.type === type && r.key === key);
    return own ? `${own.id} (retired)` : "";
  };
  if (nextProductKey && takenProduct.has(nextProductKey)) {
    return {
      ok: false,
      code: "short_key_conflict",
      error: `Product tracking key "${nextProductKey}" is already used on this site (${ownerOf("product", nextProductKey)}). Pick another key.`,
      details: { type: "product", key: nextProductKey },
    };
  }
  const seenPersona = new Set<string>();
  for (const p of nextPersonas) {
    const k = normalizeShortKey(p.short_key);
    if (!k) continue;
    if (takenPersona.has(k) || seenPersona.has(k)) {
      return {
        ok: false,
        code: "short_key_conflict",
        error: `Persona tracking key "${k}" (persona ${personaId(p)}) is already used on this site (${ownerOf("persona", k) || "this product"}). Persona keys are unique across all of the site's products.`,
        details: { type: "persona", key: k, persona: personaId(p) },
      };
    }
    seenPersona.add(k);
  }

  // Fill missing
  if (args.fillMissing) {
    if (!nextProductKey) {
      const key = suggestShortKey(productName, takenProduct, slug);
      nextDoc.short_key = key;
      takenProduct.add(key);
      assigned.push({ type: "product", product: slug, name: productName, key });
    }
    for (const p of nextPersonas) {
      if (normalizeShortKey(p.short_key)) continue;
      const taken = new Set([...takenPersona, ...seenPersona]);
      const key = suggestShortKey(personaName(p), taken, personaId(p));
      p.short_key = key;
      seenPersona.add(key);
      assigned.push({ type: "persona", product: slug, persona: personaId(p), name: personaName(p), key });
    }
    if (assigned.length) {
      changed = true;
      warnings.push({
        code: "short_keys_assigned",
        message: `Assigned tracking keys: ${assigned
          .map((a) => `${a.persona ? `persona ${a.persona}` : `product ${a.product}`} = ${a.key}`)
          .join(", ")}. Use rename_short_key to change one later (old reports keep the old code).`,
      });
    }
  }

  if (retired.length) nextDoc.retired_short_keys = retired;
  else delete nextDoc.retired_short_keys;
  if (prevProductKey !== normalizeShortKey(nextDoc.short_key)) changed = true;
  for (const p of nextPersonas) {
    const prevKey = normalizeShortKey(prevPersonas.get(personaId(p))?.short_key);
    if (prevKey !== normalizeShortKey(p.short_key)) changed = true;
  }
  void contentType;
  return { ok: true, warnings, assigned, changed };
}

function dumpProductDoc(doc: Record<string, unknown>): string {
  const dumped = yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
  return dumped.endsWith("\n") ? dumped : `${dumped}\n`;
}

export type AssignMissingResult = {
  assigned: ShortKeyAssignment[];
  /** Content-root-relative paths written (empty on dry run). */
  files: string[];
  errors: { product: string; error: string }[];
};

/**
 * Give every product / persona without a key its suggested key (current site only).
 * Soft-removed products are included so their personas never collide later.
 */
export function assignMissingShortKeys(
  contentRoot: string | undefined,
  opts: { dryRun?: boolean; productSlug?: string } = {},
): AssignMissingResult {
  const root = contentRootAbsolute(contentRoot);
  const index = loadTrackingKeyIndex(root, { fresh: true });
  const takenProduct = takenShortKeys(index.products, "product");
  const takenPersona = takenShortKeys(index.products, "persona");
  const result: AssignMissingResult = { assigned: [], files: [], errors: [] };

  for (const product of index.products) {
    if (opts.productSlug && product.slug !== opts.productSlug) continue;
    const needsProduct = !product.key;
    const needsPersonas = product.personas.filter((p) => !p.key);
    if (!needsProduct && needsPersonas.length === 0) continue;

    let dir: string;
    try {
      dir = path.join(root, getFolder(product.content_type, root), product.slug);
    } catch (err) {
      result.errors.push({ product: product.slug, error: String(err) });
      continue;
    }
    const resolved = resolveProductSidecarPath(dir);
    if (!resolved.exists) continue;
    let doc: Record<string, unknown>;
    try {
      const parsed = yaml.load(fs.readFileSync(resolved.absolutePath, "utf-8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      doc = parsed as Record<string, unknown>;
    } catch (err) {
      result.errors.push({ product: product.slug, error: `Unparseable ${resolved.relativeHint}: ${String(err)}` });
      continue;
    }

    if (needsProduct && !normalizeShortKey(doc.short_key)) {
      const key = suggestShortKey(product.name, takenProduct, product.slug);
      takenProduct.add(key);
      doc.short_key = key;
      result.assigned.push({ type: "product", product: product.slug, name: product.name, key });
    }
    for (const row of personaRows(doc)) {
      if (normalizeShortKey(row.short_key)) continue;
      const key = suggestShortKey(personaName(row), takenPersona, personaId(row));
      takenPersona.add(key);
      row.short_key = key;
      result.assigned.push({
        type: "persona",
        product: product.slug,
        persona: personaId(row),
        name: personaName(row),
        key,
      });
    }

    if (!opts.dryRun) {
      const writePath = productSidecarWritePath(dir);
      fs.writeFileSync(writePath, dumpProductDoc(doc), "utf-8");
      result.files.push(path.relative(root, writePath).split(path.sep).join("/"));
    }
  }
  if (!opts.dryRun && result.files.length) invalidateTrackingKeyIndex(root);
  return result;
}

/** Recompute one product's tracking entry from its file (for callers that already wrote). */
export function readTrackingKeyProduct(
  contentRoot: string | undefined,
  contentType: string,
  slug: string,
) {
  const root = contentRootAbsolute(contentRoot);
  const dir = path.join(root, getFolder(contentType, root), slug);
  const resolved = resolveProductSidecarPath(dir);
  if (!resolved.exists) return null;
  try {
    const parsed = yaml.load(fs.readFileSync(resolved.absolutePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return trackingKeyProductFromDoc(contentType, slug, parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}
