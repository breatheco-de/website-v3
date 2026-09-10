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
  audience_status: AudienceStatus;
  personas: { id: string; label: string }[];
};

export type ProductSnapshot = {
  product_id: string;
  name: string;
  description?: string;
  content_type: string;
  content_slug: string;
  purchasable: true;
  actively_selling: boolean;
  offer?: ProductOffer;
  personas?: ProductPersona[];
  audience_status: AudienceStatus;
  relative_path: string;
};

export type ProductPatch = {
  actively_selling?: boolean;
  product_id?: string;
  name?: string;
  /** null clears description */
  description?: string | null;
  offer?: Partial<ProductOffer>;
  personas?: Array<Partial<ProductPersona> & { id: string }>;
  clear_personas?: string[];
  replace_personas?: boolean;
  /** Staff-only; MCP must refuse. Setting false is always refused. */
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

function toListRow(product: CmsProduct): ProductListRow {
  const audience = product.audience ?? null;
  return {
    product_id: product.product_id,
    name: product.name,
    content_type: product.content_type,
    content_slug: product.content_slug,
    actively_selling: product.actively_selling,
    audience_status: audienceStatus(audience),
    personas: (audience?.personas ?? []).map((p) => ({
      id: p.id,
      label: p.label || p.role,
    })),
  };
}

/** Compact inventory rows. Paused included by default. */
export function listProductRows(opts?: {
  includePaused?: boolean;
  content_type?: string;
}): ProductListRow[] {
  const includePaused = opts?.includePaused !== false;
  const ct = opts?.content_type?.trim();
  return productManager
    .listAllProducts({ includePaused })
    .filter((p) => !ct || p.content_type === ct)
    .map(toListRow)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readEntryProduct(
  contentType: string,
  slug: string,
  contentRoot?: string,
): ProductSnapshot | null {
  const product = productManager.findProductByCmsEntry(contentType, slug, {
    includePaused: true,
  });
  if (!product) return null;
  const loaded = readProductDoc(contentType, slug, contentRoot);
  const audience = loaded ? parseAudienceFromProductDoc(loaded.doc) : product.audience ?? null;
  const root = contentRootAbs(contentRoot);
  const relativePath = loaded
    ? path.relative(root, loaded.absolutePath).split(path.sep).join("/")
    : `${product.content_type}/${slug}/${PRODUCT_SIDECAR_BASENAME}`;

  const description =
    loaded && typeof loaded.doc.description === "string"
      ? loaded.doc.description
      : product.description;

  return {
    product_id: product.product_id,
    name: product.name,
    ...(description ? { description } : {}),
    content_type: product.content_type,
    content_slug: product.content_slug,
    purchasable: true,
    actively_selling: product.actively_selling,
    ...(audience?.offer ? { offer: audience.offer } : {}),
    ...(audience?.personas ? { personas: audience.personas } : {}),
    audience_status: audienceStatus(audience),
    relative_path: relativePath,
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
  return {
    id: patch.id,
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
 * Staff/API product patch. Callers that are MCP must strip purchasable/actively_selling first.
 */
export function writeEntryProduct(
  contentType: string,
  slug: string,
  patch: ProductPatch,
  contentRoot?: string,
): ProductWriteResult {
  if (patch.purchasable === false) {
    return {
      ok: false,
      code: "purchasable_remove_forbidden",
      error:
        "Cannot set purchasable to false via API. Removing a product from the index is a manual content change. To hide from the store, set actively_selling to false (staff Store).",
    };
  }

  const product = productManager.findProductByCmsEntry(contentType, slug, {
    includePaused: true,
  });
  if (!product) {
    return {
      ok: false,
      code: "not_a_product",
      error: `No purchasable product for ${contentType}/${slug}. Creating a sellable product requires a human (staff/YAML); agents should propose_change notes.`,
    };
  }

  const dir = entryProductDir(contentType, slug, contentRoot);
  if (!fs.existsSync(dir)) {
    return { ok: false, code: "missing_entry", error: `Entry directory not found for ${contentType}/${slug}` };
  }

  const existing = readProductDoc(contentType, slug, contentRoot);
  const doc: Record<string, unknown> = existing?.doc ? { ...existing.doc } : {};
  if (typeof doc.purchasable !== "boolean") {
    doc.purchasable = true;
  }

  if (patch.purchasable === true) {
    doc.purchasable = true;
  }
  if (typeof patch.actively_selling === "boolean") {
    doc.actively_selling = patch.actively_selling;
  }
  if (typeof patch.product_id === "string" && patch.product_id.trim()) {
    doc.product_id = patch.product_id.trim();
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

  const writePath = productSidecarWritePath(dir);
  const dumped = yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
  fs.writeFileSync(writePath, dumped.endsWith("\n") ? dumped : `${dumped}\n`, "utf-8");

  const warnings: { code: string; message: string }[] = [];
  if (existing?.legacy) {
    warnings.push({
      code: "legacy_sidecar_present",
      message: `Wrote ${PRODUCT_SIDECAR_BASENAME}; legacy ${LEGACY_PRODUCT_SIDECAR_BASENAME} still exists — run migrate script to remove it.`,
    });
  }

  scanProductContent(contentRootAbs(contentRoot));

  const root = contentRootAbs(contentRoot);
  const relativePath = path.relative(root, writePath).split(path.sep).join("/");
  const snapshot = readEntryProduct(contentType, slug, contentRoot);
  if (!snapshot) {
    return {
      ok: false,
      code: "write_verify_failed",
      error: "Wrote product sidecar but could not re-read product from index",
    };
  }

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
): ProductWriteResult {
  const result = writeEntryAudience(contentType, slug, audience, contentRoot);
  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code, details: result.details };
  }
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
