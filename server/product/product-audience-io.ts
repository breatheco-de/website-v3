/**
 * Read/write product audience on entry `_product.yml`.
 * Writes always use `_product.yml` (never legacy filename).
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  audienceStatus,
  isMinimalProductAudience,
  parseAudienceFromProductDoc,
  parseProductAudience,
  type AudienceStatus,
  type ProductAudience,
  type ProductPersona,
} from "@shared/productAudience";
import { getFolder } from "../content-types";
import { getDefaultContentRoot } from "../site-config";
import { contentIndex } from "../content-index";
import {
  productSidecarWritePath,
  resolveProductSidecarPath,
  LEGACY_PRODUCT_SIDECAR_BASENAME,
  PRODUCT_SIDECAR_BASENAME,
} from "./product-sidecar";
import { productManager } from "./product-manager";
import { scanProductContent } from "./product-index";
import {
  normalizeFunnelBlock,
  personasBoundToProduct,
  type FunnelBlock,
} from "@shared/funnel";
import { readFunnelBlockFromFile, commonYmlPath } from "../funnel-fields";
import { getAllConfigs } from "../content-types";

function contentRootAbs(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function entryProductDir(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string {
  return path.join(contentRootAbs(contentRoot), getFolder(contentType, contentRoot), slug);
}

export function readProductDoc(
  contentType: string,
  slug: string,
  contentRoot?: string,
): { doc: Record<string, unknown>; absolutePath: string; legacy: boolean } | null {
  const dir = entryProductDir(contentType, slug, contentRoot);
  const resolved = resolveProductSidecarPath(dir);
  if (!resolved.exists) return null;
  const raw = fs.readFileSync(resolved.absolutePath, "utf-8");
  const parsed = contentIndex.safeYamlLoad(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { doc: {}, absolutePath: resolved.absolutePath, legacy: resolved.legacy };
  }
  return {
    doc: parsed as Record<string, unknown>,
    absolutePath: resolved.absolutePath,
    legacy: resolved.legacy,
  };
}

export function readEntryAudience(
  contentType: string,
  slug: string,
  contentRoot?: string,
): ProductAudience | null {
  const loaded = readProductDoc(contentType, slug, contentRoot);
  if (!loaded) return null;
  return parseAudienceFromProductDoc(loaded.doc);
}

export type AudienceWriteResult =
  | {
      ok: true;
      audience: ProductAudience;
      status: AudienceStatus;
      relativePath: string;
      warnings: { code: string; message: string }[];
    }
  | { ok: false; error: string; code: string; details?: unknown };

export type PersonaFunnelUsagePage = {
  contentType: string;
  slug: string;
  href?: string;
};

function primaryHrefForEntry(contentType: string, slug: string): string | undefined {
  try {
    const urls = contentIndex.getAlternateUrls(slug, contentType) ?? {};
    return urls.en || urls.es || Object.values(urls)[0] || undefined;
  } catch {
    return undefined;
  }
}

export function listFunnelBindingsUsingPersona(
  _contentType: string,
  productSlug: string,
  personaId: string,
  contentRoot?: string,
): PersonaFunnelUsagePage[] {
  const root = contentRootAbs(contentRoot);
  const hits: PersonaFunnelUsagePage[] = [];
  const configs = getAllConfigs(contentRoot);
  for (const [ct, cfg] of Object.entries(configs)) {
    const folder = typeof (cfg as { directory?: string }).directory === "string"
      ? (cfg as { directory: string }).directory
      : ct;
    const typeDir = path.join(root, folder);
    if (!fs.existsSync(typeDir)) continue;
    for (const ent of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const slug = ent.name;
      const funnelPath = commonYmlPath(ct, slug, contentRoot);
      if (!fs.existsSync(funnelPath)) continue;
      const funnel = readFunnelBlockFromFile(funnelPath);
      const bound = personasBoundToProduct(funnel, productSlug);
      if (bound.includes(personaId)) {
        const href = primaryHrefForEntry(ct, slug);
        hits.push(href ? { contentType: ct, slug, href } : { contentType: ct, slug });
      }
    }
  }
  return hits;
}

/** Pages whose funnel.products bind this product+persona (for Store delete UI). */
export function getPersonaFunnelUsage(
  contentType: string,
  productSlug: string,
  personaId: string,
  contentRoot?: string,
): { persona_id: string; pages: PersonaFunnelUsagePage[] } {
  const id = personaId.trim();
  return {
    persona_id: id,
    pages: id ? listFunnelBindingsUsingPersona(contentType, productSlug, id, contentRoot) : [],
  };
}

/**
 * Map of persona id → funnel pages that bind this product+persona (single directory walk).
 * Includes the product’s own page when it binds that persona.
 */
export function getProductPersonaUsageMap(
  productSlug: string,
  contentRoot?: string,
): Record<string, { pages: PersonaFunnelUsagePage[] }> {
  const root = contentRootAbs(contentRoot);
  const byPersona = new Map<string, PersonaFunnelUsagePage[]>();
  const configs = getAllConfigs(contentRoot);
  for (const [ct, cfg] of Object.entries(configs)) {
    const folder = typeof (cfg as { directory?: string }).directory === "string"
      ? (cfg as { directory: string }).directory
      : ct;
    const typeDir = path.join(root, folder);
    if (!fs.existsSync(typeDir)) continue;
    for (const ent of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const slug = ent.name;
      const funnelPath = commonYmlPath(ct, slug, contentRoot);
      if (!fs.existsSync(funnelPath)) continue;
      const funnel = readFunnelBlockFromFile(funnelPath);
      const bound = personasBoundToProduct(funnel, productSlug);
      if (bound.length === 0) continue;
      const href = primaryHrefForEntry(ct, slug);
      const page: PersonaFunnelUsagePage = href
        ? { contentType: ct, slug, href }
        : { contentType: ct, slug };
      for (const personaId of bound) {
        const list = byPersona.get(personaId) ?? [];
        list.push(page);
        byPersona.set(personaId, list);
      }
    }
  }
  const out: Record<string, { pages: PersonaFunnelUsagePage[] }> = {};
  for (const [id, pages] of byPersona) {
    out[id] = { pages };
  }
  return out;
}

/** Reject duplicate persona ids on the same product. */
export function findDuplicatePersonaIds(
  personas: { id: string }[],
): string | null {
  const seen = new Set<string>();
  for (const p of personas) {
    const id = p.id.trim();
    if (!id) continue;
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

function listPagesBindingProduct(
  productSlug: string,
  contentRoot?: string,
): { contentType: string; slug: string; funnel: FunnelBlock }[] {
  const root = contentRootAbs(contentRoot);
  const hits: { contentType: string; slug: string; funnel: FunnelBlock }[] = [];
  const configs = getAllConfigs(contentRoot);
  for (const [ct, cfg] of Object.entries(configs)) {
    const folder = typeof (cfg as { directory?: string }).directory === "string"
      ? (cfg as { directory: string }).directory
      : ct;
    const typeDir = path.join(root, folder);
    if (!fs.existsSync(typeDir)) continue;
    for (const ent of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const slug = ent.name;
      const funnelPath = commonYmlPath(ct, slug, contentRoot);
      if (!fs.existsSync(funnelPath)) continue;
      const funnel = normalizeFunnelBlock(readFunnelBlockFromFile(funnelPath));
      const products = funnel.products;
      if (!products || products === "all") continue;
      if (products.some((b) => b.product === productSlug)) {
        hits.push({ contentType: ct, slug, funnel });
      }
    }
  }
  return hits;
}

/**
 * Assert audience update does not orphan funnel bindings.
 * Persona id rename is treated as remove+add: allowed only when the old id
 * has zero funnel bindings (including the product’s own page). Ids are
 * immutable while bound — not forever.
 */
export function assertAudienceUpdateAllowed(
  contentType: string,
  slug: string,
  nextAudience: ProductAudience,
  contentRoot?: string,
): { ok: true } | { ok: false; error: string; code: string; details?: unknown } {
  const dup = findDuplicatePersonaIds(nextAudience.personas);
  if (dup) {
    return {
      ok: false,
      code: "duplicate_persona_id",
      error: `Persona id "${dup}" is used more than once on this product. Each persona needs a unique id.`,
      details: { persona_id: dup },
    };
  }

  const prev = readEntryAudience(contentType, slug, contentRoot);
  const prevIds = new Set((prev?.personas ?? []).map((p) => p.id));
  const nextIds = new Set(nextAudience.personas.map((p) => p.id));

  if ((prev?.personas.length ?? 0) > 0 && nextAudience.personas.length === 0) {
    return {
      ok: false,
      code: "last_persona",
      error:
        "The product must keep at least one persona. Add another persona first, or edit the existing one instead of deleting it.",
      details: { persona_ids_removed: [...prevIds] },
    };
  }

  for (const id of prevIds) {
    if (!nextIds.has(id)) {
      const users = listFunnelBindingsUsingPersona(contentType, slug, id, contentRoot);
      if (users.length > 0) {
        return {
          ok: false,
          code: "persona_in_use",
          error: `Cannot remove or rename persona "${id}" while pages still bind to it. Re-point or clear those funnel bindings first.`,
          details: { persona_id: id, pages: users },
        };
      }
    }
  }

  const nextMinimal = isMinimalProductAudience(nextAudience);
  if (prev && isMinimalProductAudience(prev) && !nextMinimal) {
    const pages = listPagesBindingProduct(slug, contentRoot).filter((p) => {
      // program self may omit persona; still block dropping below minimal if any non-self specific binding exists
      if (p.contentType === contentType && p.slug === slug) return false;
      const products = p.funnel.products;
      if (!products || products === "all") return false;
      return products.some((b) => b.product === slug);
    });
    if (pages.length > 0) {
      return {
        ok: false,
        code: "audience_in_use",
        error:
          "Cannot clear or demote audience below minimal while other pages bind this product in their funnel. Fix those pages first.",
        details: { pages: pages.map((p) => ({ contentType: p.contentType, slug: p.slug })) },
      };
    }
  }

  return { ok: true };
}

export function writeEntryAudience(
  contentType: string,
  slug: string,
  audienceRaw: unknown,
  contentRoot?: string,
): AudienceWriteResult {
  const audience = parseProductAudience(audienceRaw);
  if (!audience) {
    return {
      ok: false,
      code: "invalid_audience",
      error: "Audience must include offer and/or personas objects",
    };
  }

  // Normalize personas: reject empty ids
  for (const p of audience.personas) {
    if (!p.id.trim() || !p.role.trim()) {
      return {
        ok: false,
        code: "invalid_persona",
        error: "Each persona needs a non-empty id and role",
      };
    }
  }

  const allowed = assertAudienceUpdateAllowed(contentType, slug, audience, contentRoot);
  if (!allowed.ok) return allowed;

  const dir = entryProductDir(contentType, slug, contentRoot);
  if (!fs.existsSync(dir)) {
    return { ok: false, code: "missing_entry", error: `Entry directory not found for ${contentType}/${slug}` };
  }

  const existing = readProductDoc(contentType, slug, contentRoot);
  const doc: Record<string, unknown> = existing?.doc ? { ...existing.doc } : {};
  // Ensure purchasable product declaration preserved
  if (typeof doc.purchasable !== "boolean") {
    const indexed = productManager.findProductByCmsEntry(contentType, slug, { includePaused: true });
    if (indexed) doc.purchasable = true;
  }

  doc.offer = audience.offer;
  doc.personas = audience.personas;
  delete doc.audience; // prefer top-level offer/personas

  const writePath = productSidecarWritePath(dir);
  const dumped = yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
  fs.writeFileSync(writePath, dumped.endsWith("\n") ? dumped : `${dumped}\n`, "utf-8");

  // Leave legacy file in place for dual-read until migration deletes it; prefer product file on next read.
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

  return {
    ok: true,
    audience,
    status: audienceStatus(audience),
    relativePath,
    warnings,
  };
}

export type { ProductAudience, ProductPersona, AudienceStatus };
