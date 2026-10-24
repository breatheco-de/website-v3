/**
 * Read/patch entry `_product.yml` (full sidecar) + compact list rows for MCP/Store/overview.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  audienceStatus,
  parseAudienceFromProductDoc,
  parseProductAudience,
  type AudienceStatus,
  type ProductAudience,
  type ProductOffer,
  type ProductPersona,
  type ProductPersonaAvatar,
} from "@shared/productAudience";
import {
  assertAudienceUpdateAllowed,
  entryProductDir,
  readEntryAudience,
  readProductDoc,
  writeEntryAudience,
} from "./product-audience-io";
import {
  LEGACY_PRODUCT_SIDECAR_BASENAME,
  PRODUCT_SIDECAR_BASENAME,
  productSidecarWritePath,
} from "./product-sidecar";
import { productManager } from "./product-manager";
import { scanProductContent } from "./product-index";
import { getDefaultContentRoot } from "../site-config";
import type { CmsProduct } from "./types";
import { contentTypeAllowsSellableEntries } from "./products-type-config";
import { getAllConfigs, getType } from "../content-types";
import { normalizeShortKey, parseRetiredShortKeys, type RetiredShortKey } from "@shared/tracking-keys";
import { applyShortKeyRules } from "./tracking-keys-assign";
import { onTrackingKeysChanged } from "./tracking-keys-effects";

function contentRootAbs(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export type ProductListRow = {
  product_id: string;
  name: string;
  content_type: string;
  content_slug: string;
  actively_selling: boolean;
  /** false when soft-removed from the product index */
  purchasable: boolean;
  audience_status: AudienceStatus;
  /** Tracking code sent to GA4 (absent until assigned). */
  short_key?: string;
  personas: { id: string; label: string; short_key?: string }[];
};

export type ProductSnapshot = {
  product_id: string;
  name: string;
  description?: string;
  content_type: string;
  content_slug: string;
  purchasable: boolean;
  actively_selling: boolean;
  short_key?: string;
  /** Renamed / removed tracking keys; never reused. */
  retired_short_keys?: RetiredShortKey[];
  offer?: ProductOffer;
  personas?: ProductPersona[];
  audience_status: AudienceStatus;
  relative_path: string;
};

export type ProductPatch = {
  actively_selling?: boolean;
  product_id?: string;
  name?: string;
  /** Product tracking key. Locked once saved unless rename_short_key is true. */
  short_key?: string;
  /** Allow changing saved product / persona tracking keys; old keys are retired. */
  rename_short_key?: boolean;
  /** null clears description */
  description?: string | null;
  offer?: Partial<ProductOffer>;
  personas?: Array<Partial<ProductPersona> & { id: string }>;
  clear_personas?: string[];
  replace_personas?: boolean;
  /** Staff / product_manage: true create|re-enable; false soft-remove */
  purchasable?: boolean;
};

export type ProductWriteResult =
  | {
      ok: true;
      product: ProductSnapshot;
      relativePath: string;
      warnings: { code: string; message: string }[];
    }
  | { ok: false; error: string; code: string; details?: unknown };

function toListRow(product: CmsProduct, purchasable = true): ProductListRow {
  const audience = product.audience ?? null;
  return {
    product_id: product.product_id,
    name: product.name,
    content_type: product.content_type,
    content_slug: product.content_slug,
    actively_selling: product.actively_selling,
    purchasable,
    audience_status: audienceStatus(audience),
    ...(product.short_key ? { short_key: product.short_key } : {}),
    personas: (audience?.personas ?? []).map((p) => ({
      id: p.id,
      label: p.label || p.role,
      ...(p.short_key ? { short_key: p.short_key } : {}),
    })),
  };
}

function snapshotFromDoc(
  contentType: string,
  slug: string,
  doc: Record<string, unknown>,
  absolutePath: string,
  contentRoot?: string,
): ProductSnapshot {
  const audience = parseAudienceFromProductDoc(doc);
  const root = contentRootAbs(contentRoot);
  const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
  const productId =
    typeof doc.product_id === "string" && doc.product_id.trim()
      ? doc.product_id.trim()
      : `${contentType}-${slug}`;
  const name =
    typeof doc.name === "string" && doc.name.trim() ? doc.name.trim() : slug;
  const purchasable = doc.purchasable === true;
  const actively_selling =
    typeof doc.actively_selling === "boolean"
      ? doc.actively_selling
      : typeof doc.active === "boolean"
        ? doc.active
        : true;
  const description = typeof doc.description === "string" ? doc.description : undefined;
  const shortKey = normalizeShortKey(doc.short_key);
  const retired = parseRetiredShortKeys(doc.retired_short_keys);
  return {
    product_id: productId,
    name,
    ...(description ? { description } : {}),
    content_type: contentType,
    content_slug: slug,
    purchasable,
    actively_selling,
    ...(shortKey ? { short_key: shortKey } : {}),
    ...(retired.length ? { retired_short_keys: retired } : {}),
    ...(audience?.offer ? { offer: audience.offer } : {}),
    ...(audience?.personas ? { personas: audience.personas } : {}),
    audience_status: audienceStatus(audience),
    relative_path: relativePath,
  };
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function findProductIdCollision(
  productId: string,
  exceptContentType: string,
  exceptSlug: string,
  contentRoot?: string,
): { content_type: string; content_slug: string } | null {
  for (const p of productManager.listAllProducts({ includePaused: true })) {
    if (p.product_id !== productId) continue;
    if (p.content_type === exceptContentType && p.content_slug === exceptSlug) continue;
    return { content_type: p.content_type, content_slug: p.content_slug };
  }
  // Also scan removed sidecars for same product_id
  for (const row of listRemovedProductRows({ contentRoot })) {
    if (row.product_id !== productId) continue;
    if (row.content_type === exceptContentType && row.content_slug === exceptSlug) continue;
    return { content_type: row.content_type, content_slug: row.content_slug };
  }
  return null;
}

/** Compact inventory rows. Paused included by default. Removed excluded unless includeRemoved. */
export function listProductRows(opts?: {
  includePaused?: boolean;
  includeRemoved?: boolean;
  content_type?: string;
  contentRoot?: string;
}): ProductListRow[] {
  const includePaused = opts?.includePaused !== false;
  const ct = opts?.content_type?.trim();
  const rows = productManager
    .listAllProducts({ includePaused })
    .filter((p) => !ct || p.content_type === ct)
    .map((p) => toListRow(p, true));
  if (opts?.includeRemoved) {
    for (const r of listRemovedProductRows({ content_type: ct, contentRoot: opts.contentRoot })) {
      rows.push(r);
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Soft-removed products (purchasable: false sidecars) — not in the live index. */
export function listRemovedProductRows(opts?: {
  content_type?: string;
  contentRoot?: string;
}): ProductListRow[] {
  const root = contentRootAbs(opts?.contentRoot);
  const ctFilter = opts?.content_type?.trim();
  const out: ProductListRow[] = [];
  const configs = getAllConfigs(opts?.contentRoot);
  for (const [ct, cfg] of Object.entries(configs)) {
    if (ctFilter && ct !== getType(ctFilter, opts?.contentRoot) && ct !== ctFilter) continue;
    const folder =
      typeof (cfg as { directory?: string }).directory === "string"
        ? (cfg as { directory: string }).directory
        : ct;
    const typeDir = path.join(root, folder);
    if (!fs.existsSync(typeDir)) continue;
    for (const ent of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const slug = ent.name;
      const loaded = readProductDoc(ct, slug, opts?.contentRoot);
      if (!loaded) continue;
      if (loaded.doc.purchasable !== false) continue;
      const snap = snapshotFromDoc(ct, slug, loaded.doc, loaded.absolutePath, opts?.contentRoot);
      out.push({
        product_id: snap.product_id,
        name: snap.name,
        content_type: snap.content_type,
        content_slug: snap.content_slug,
        actively_selling: snap.actively_selling,
        purchasable: false,
        audience_status: snap.audience_status,
        ...(snap.short_key ? { short_key: snap.short_key } : {}),
        personas: (snap.personas ?? []).map((p) => ({
          id: p.id,
          label: p.label || p.role,
          ...(p.short_key ? { short_key: p.short_key } : {}),
        })),
      });
    }
  }
  return out;
}

/**
 * Read product snapshot from index or from sidecar (including purchasable: false).
 */
export function readEntryProduct(
  contentType: string,
  slug: string,
  contentRoot?: string,
): ProductSnapshot | null {
  const loaded = readProductDoc(contentType, slug, contentRoot);
  if (loaded) {
    return snapshotFromDoc(contentType, slug, loaded.doc, loaded.absolutePath, contentRoot);
  }
  const product = productManager.findProductByCmsEntry(contentType, slug, {
    includePaused: true,
  });
  if (!product) return null;
  const root = contentRootAbs(contentRoot);
  const relativePath = `${product.content_type}/${slug}/${PRODUCT_SIDECAR_BASENAME}`;
  return {
    product_id: product.product_id,
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    content_type: product.content_type,
    content_slug: product.content_slug,
    purchasable: true,
    actively_selling: product.actively_selling,
    ...(product.short_key ? { short_key: product.short_key } : {}),
    ...(product.audience?.offer ? { offer: product.audience.offer } : {}),
    ...(product.audience?.personas ? { personas: product.audience.personas } : {}),
    audience_status: audienceStatus(product.audience ?? null),
    relative_path: relativePath.startsWith(root)
      ? path.relative(root, relativePath).split(path.sep).join("/")
      : relativePath,
  };
}

function deepMergeOffer(
  base: ProductOffer | undefined,
  patch: Partial<ProductOffer>,
): ProductOffer {
  const next: ProductOffer = {
    one_liner: base?.one_liner ?? "",
    who_its_for: base?.who_its_for ?? "",
  };
  if (patch.one_liner !== undefined) next.one_liner = patch.one_liner;
  if (patch.who_its_for !== undefined) next.who_its_for = patch.who_its_for;
  if (patch.who_its_not_for !== undefined) {
    if (patch.who_its_not_for === null || patch.who_its_not_for === "") {
      delete next.who_its_not_for;
    } else {
      next.who_its_not_for = patch.who_its_not_for;
    }
  } else if (base?.who_its_not_for) {
    next.who_its_not_for = base.who_its_not_for;
  }
  if (patch.outcomes !== undefined) next.outcomes = patch.outcomes;
  else if (base?.outcomes) next.outcomes = base.outcomes;
  if (patch.differentiators !== undefined) next.differentiators = patch.differentiators;
  else if (base?.differentiators) next.differentiators = base.differentiators;
  return next;
}

function mergeAvatar(
  base: ProductPersonaAvatar | undefined,
  patch: Partial<ProductPersonaAvatar> | undefined,
): ProductPersonaAvatar {
  return {
    fears: patch?.fears ?? base?.fears ?? [],
    internal_dialogue: patch?.internal_dialogue ?? base?.internal_dialogue ?? "",
    objections: patch?.objections ?? base?.objections ?? [],
    ...(patch?.aspirational_identity !== undefined
      ? patch.aspirational_identity
        ? { aspirational_identity: patch.aspirational_identity }
        : {}
      : base?.aspirational_identity
        ? { aspirational_identity: base.aspirational_identity }
        : {}),
    ...(patch?.jobs_to_be_done !== undefined
      ? patch.jobs_to_be_done.length
        ? { jobs_to_be_done: patch.jobs_to_be_done }
        : {}
      : base?.jobs_to_be_done?.length
        ? { jobs_to_be_done: base.jobs_to_be_done }
        : {}),
  };
}

function mergePersona(
  base: ProductPersona | undefined,
  patch: Partial<ProductPersona> & { id: string },
): ProductPersona {
  const role = patch.role ?? base?.role ?? "";
  const shortKey = normalizeShortKey(patch.short_key) ?? base?.short_key;
  return {
    id: patch.id,
    ...(shortKey ? { short_key: shortKey } : {}),
    role,
    avatar: mergeAvatar(base?.avatar, patch.avatar),
    ...(patch.label !== undefined
      ? patch.label
        ? { label: patch.label }
        : {}
      : base?.label
        ? { label: base.label }
        : {}),
    ...(patch.industry_or_context !== undefined
      ? patch.industry_or_context
        ? { industry_or_context: patch.industry_or_context }
        : {}
      : base?.industry_or_context
        ? { industry_or_context: base.industry_or_context }
        : {}),
    ...(patch.demographics !== undefined
      ? patch.demographics
        ? { demographics: patch.demographics }
        : {}
      : base?.demographics
        ? { demographics: base.demographics }
        : {}),
    ...(patch.buying_behavior !== undefined
      ? patch.buying_behavior
        ? { buying_behavior: patch.buying_behavior }
        : {}
      : base?.buying_behavior
        ? { buying_behavior: base.buying_behavior }
        : {}),
    ...(patch.decision_criteria !== undefined
      ? patch.decision_criteria.length
        ? { decision_criteria: patch.decision_criteria }
        : {}
      : base?.decision_criteria?.length
        ? { decision_criteria: base.decision_criteria }
        : {}),
  };
}

function mergePersonas(
  prev: ProductPersona[],
  patch: ProductPatch,
): ProductPersona[] | { ok: false; error: string; code: string } {
  const clear = new Set((patch.clear_personas ?? []).map((id) => id.trim()).filter(Boolean));
  if (patch.replace_personas) {
    const list = (patch.personas ?? []).map((p) => mergePersona(undefined, p as ProductPersona & { id: string }));
    for (const id of clear) {
      // already replaced — clear is redundant
      void id;
    }
    return list.filter((p) => !clear.has(p.id));
  }

  const byId = new Map(prev.map((p) => [p.id, p]));
  for (const id of clear) {
    byId.delete(id);
  }
  for (const p of patch.personas ?? []) {
    const id = p.id.trim();
    if (!id) {
      return { ok: false, error: "Each persona needs a non-empty id", code: "invalid_persona" };
    }
    byId.set(id, mergePersona(byId.get(id), { ...p, id }));
  }
  return Array.from(byId.values());
}

/**
 * Staff/API product patch. Create / remove / re-enable via purchasable;
 * audience works on indexed and soft-removed sidecars.
 */
export function writeEntryProduct(
  contentType: string,
  slug: string,
  patch: ProductPatch,
  contentRoot?: string,
): ProductWriteResult {
  const dir = entryProductDir(contentType, slug, contentRoot);
  if (!fs.existsSync(dir)) {
    return { ok: false, code: "missing_entry", error: `Entry directory not found for ${contentType}/${slug}` };
  }

  const indexed = productManager.findProductByCmsEntry(contentType, slug, {
    includePaused: true,
  });
  const existing = readProductDoc(contentType, slug, contentRoot);
  const wasRemoved = existing?.doc.purchasable === false;
  const isIndexed = !!indexed;
  const isCreate = !isIndexed && !existing && patch.purchasable === true;

  let doc: Record<string, unknown>;
  if (isCreate) {
    if (!contentTypeAllowsSellableEntries(contentType, contentRoot)) {
      return {
        ok: false,
        code: "type_not_allow_sellable",
        error: `Content type "${contentType}" does not allow sellable entries (products.allow_sellable_entries).`,
      };
    }
    const productId =
      typeof patch.product_id === "string" && patch.product_id.trim()
        ? patch.product_id.trim()
        : `${contentType}-${slug}`;
    const collision = findProductIdCollision(productId, contentType, slug, contentRoot);
    if (collision) {
      return {
        ok: false,
        code: "product_id_collision",
        error: `Product id "${productId}" already used by ${collision.content_type}/${collision.content_slug}.`,
        details: collision,
      };
    }
    const name =
      typeof patch.name === "string" && patch.name.trim()
        ? patch.name.trim()
        : humanizeSlug(slug);
    doc = {
      purchasable: true,
      actively_selling: patch.actively_selling !== false,
      product_id: productId,
      name,
    };
  } else {
    // Need a sidecar for any further patch
    if (!existing && !isIndexed) {
      return {
        ok: false,
        code: "not_a_product",
        error: `No product sidecar for ${contentType}/${slug}. Pass purchasable: true to create one (requires products.allow_sellable_entries and product_manage).`,
      };
    }
    doc = existing?.doc ? { ...existing.doc } : {};
    if (typeof doc.purchasable !== "boolean") {
      doc.purchasable = true;
    }
  }

  // Soft-remove
  if (patch.purchasable === false) {
    if (doc.purchasable !== true && !isIndexed) {
      return {
        ok: false,
        code: "not_a_product",
        error: `No sellable product for ${contentType}/${slug} to remove.`,
      };
    }
    doc.purchasable = false;
  }

  // Re-enable removed or create from existing sidecar
  if (patch.purchasable === true && !isCreate) {
    if (!contentTypeAllowsSellableEntries(contentType, contentRoot)) {
      return {
        ok: false,
        code: "type_not_allow_sellable",
        error: `Content type "${contentType}" does not allow sellable entries (products.allow_sellable_entries).`,
      };
    }
    const productId =
      typeof patch.product_id === "string" && patch.product_id.trim()
        ? patch.product_id.trim()
        : typeof doc.product_id === "string" && doc.product_id.trim()
          ? String(doc.product_id).trim()
          : `${contentType}-${slug}`;
    const collision = findProductIdCollision(productId, contentType, slug, contentRoot);
    if (collision) {
      return {
        ok: false,
        code: "product_id_collision",
        error: `Product id "${productId}" already used by ${collision.content_type}/${collision.content_slug}.`,
        details: collision,
      };
    }
    doc.purchasable = true;
    doc.product_id = productId;
    if (typeof doc.name !== "string" || !String(doc.name).trim()) {
      doc.name =
        typeof patch.name === "string" && patch.name.trim()
          ? patch.name.trim()
          : humanizeSlug(slug);
    }
    if (typeof doc.actively_selling !== "boolean") {
      doc.actively_selling = true;
    }
  }

  if (typeof patch.actively_selling === "boolean") {
    if (doc.purchasable === false && patch.purchasable !== true) {
      return {
        ok: false,
        code: "not_sellable",
        error:
          "Product is not sellable (removed). Make sellable again before pausing/resuming store visibility.",
      };
    }
    doc.actively_selling = patch.actively_selling;
  }
  if (typeof patch.product_id === "string" && patch.product_id.trim() && patch.purchasable !== true) {
    const nextId = patch.product_id.trim();
    const collision = findProductIdCollision(nextId, contentType, slug, contentRoot);
    if (collision) {
      return {
        ok: false,
        code: "product_id_collision",
        error: `Product id "${nextId}" already used by ${collision.content_type}/${collision.content_slug}.`,
        details: collision,
      };
    }
    doc.product_id = nextId;
  }
  if (typeof patch.name === "string" && patch.name.trim()) {
    doc.name = patch.name.trim();
  }
  if (patch.description === null) {
    delete doc.description;
  } else if (typeof patch.description === "string") {
    doc.description = patch.description;
  }

  const prevAudience = parseAudienceFromProductDoc(doc) ?? readEntryAudience(contentType, slug, contentRoot);
  const touchAudience =
    patch.offer !== undefined ||
    patch.personas !== undefined ||
    (patch.clear_personas !== undefined && patch.clear_personas.length > 0) ||
    patch.replace_personas === true;

  if (touchAudience) {
    const prevPersonas = prevAudience?.personas ?? [];
    const mergedPersonas = mergePersonas(prevPersonas, patch);
    if (!Array.isArray(mergedPersonas)) {
      return mergedPersonas;
    }
    const offer = patch.offer
      ? deepMergeOffer(prevAudience?.offer, patch.offer)
      : prevAudience?.offer ?? { one_liner: "", who_its_for: "" };

    const nextAudience: ProductAudience = { offer, personas: mergedPersonas };
    const parsed = parseProductAudience(nextAudience);
    if (!parsed) {
      return {
        ok: false,
        code: "invalid_audience",
        error: "Audience must include offer and/or personas",
      };
    }
    for (const p of parsed.personas) {
      if (!p.id.trim() || !p.role.trim()) {
        return {
          ok: false,
          code: "invalid_persona",
          error: "Each persona needs a non-empty id and role",
        };
      }
    }
    const allowed = assertAudienceUpdateAllowed(contentType, slug, parsed, contentRoot);
    if (!allowed.ok) return allowed;

    doc.offer = parsed.offer;
    doc.personas = parsed.personas;
    delete doc.audience;
  }

  if (typeof patch.short_key === "string" && patch.short_key.trim()) {
    doc.short_key = patch.short_key.trim().toLowerCase();
  }
  const keys = applyShortKeyRules({
    contentRoot,
    contentType,
    slug,
    prevDoc: existing?.doc ? structuredClone(existing.doc) : null,
    nextDoc: doc,
    renameAllowed: patch.rename_short_key === true,
    fillMissing: true,
  });
  if (!keys.ok) return keys;

  const writePath = productSidecarWritePath(dir);
  const dumped = yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
  fs.writeFileSync(writePath, dumped.endsWith("\n") ? dumped : `${dumped}\n`, "utf-8");

  const warnings: { code: string; message: string }[] = [...keys.warnings];
  if (existing?.legacy) {
    warnings.push({
      code: "legacy_sidecar_present",
      message: `Wrote ${PRODUCT_SIDECAR_BASENAME}; legacy ${LEGACY_PRODUCT_SIDECAR_BASENAME} still exists — run migrate script to remove it.`,
    });
  }
  if (doc.purchasable === false) {
    warnings.push({
      code: "not_sellable",
      message:
        "Product is not sellable right now (removed from the store index). Audience can still be edited. Make sellable again to restore selling.",
    });
  } else if (wasRemoved && doc.purchasable === true) {
    warnings.push({
      code: "re_enabled",
      message: "Product is sellable again and back in the product index.",
    });
  }

  scanProductContent(contentRootAbs(contentRoot));

  const root = contentRootAbs(contentRoot);
  const relativePath = path.relative(root, writePath).split(path.sep).join("/");
  const snapshot = readEntryProduct(contentType, slug, contentRoot);
  if (!snapshot || (isCreate && !snapshot.purchasable)) {
    return {
      ok: false,
      code: "write_verify_failed",
      error: isCreate
        ? "Wrote product sidecar but could not re-read product from index"
        : "Wrote product sidecar but could not re-read product",
    };
  }
  if (isCreate && snapshot.audience_status === "missing") {
    warnings.push({
      code: "thin_create",
      message:
        "Product is sellable. Audience (offer + personas) is still missing — set it next so funnel landings can bind personas.",
    });
  }
  if (keys.changed) onTrackingKeysChanged(contentRoot, [{ contentType, slug }]);

  return {
    ok: true,
    product: snapshot,
    relativePath,
    warnings,
  };
}

/** Full audience replace (Store audience panel). */
export function writeEntryProductAudienceReplace(
  contentType: string,
  slug: string,
  audience: { offer: ProductOffer; personas: ProductPersona[] },
  contentRoot?: string,
  opts?: { renameShortKey?: boolean },
): ProductWriteResult {
  const result = writeEntryAudience(contentType, slug, audience, contentRoot, opts);
  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code, details: result.details };
  }
  if (result.shortKeysChanged) onTrackingKeysChanged(contentRoot, [{ contentType, slug }]);
  const snapshot = readEntryProduct(contentType, slug, contentRoot);
  if (!snapshot) {
    return {
      ok: false,
      code: "write_verify_failed",
      error: "Audience written but product could not be re-read",
    };
  }
  return {
    ok: true,
    product: snapshot,
    relativePath: result.relativePath,
    warnings: result.warnings,
  };
}
