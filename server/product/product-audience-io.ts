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

function listFunnelBindingsUsingPersona(
  contentType: string,
  productSlug: string,
  personaId: string,
  contentRoot?: string,
): { contentType: string; slug: string }[] {
  const root = contentRootAbs(contentRoot);
  const hits: { contentType: string; slug: string }[] = [];
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
        hits.push({ contentType: ct, slug });
      }
    }
  }
  return hits;
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
 * Assert audience update does not orphan funnel bindings (edge 1a)
 * and does not rename persona ids (edge 2a).
 */
export function assertAudienceUpdateAllowed(
  contentType: string,
  slug: string,
  nextAudience: ProductAudience,
  contentRoot?: string,
): { ok: true } | { ok: false; error: string; code: string; details?: unknown } {
  const prev = readEntryAudience(contentType, slug, contentRoot);
  const prevIds = new Set((prev?.personas ?? []).map((p) => p.id));
  const nextIds = new Set(nextAudience.personas.map((p) => p.id));

  for (const id of prevIds) {
    if (!nextIds.has(id)) {
      const users = listFunnelBindingsUsingPersona(contentType, slug, id, contentRoot);
      if (users.length > 0) {
        return {
          ok: false,
          code: "persona_in_use",
          error: `Cannot remove persona "${id}" while pages still bind to it. Re-point or clear those funnel bindings first.`,
          details: { persona_id: id, pages: users },
        };
      }
    }
  }

  // Immutable ids: if same count and labels changed but an id disappeared while a new id appeared with same label — still blocked by remove check.
  // Explicit: cannot change an existing persona's id field (treat as remove+add).
  if (prev) {
    for (const oldP of prev.personas) {
      const still = nextAudience.personas.find((p) => p.id === oldP.id);
      if (!still) continue; // handled above if in use; if not in use, delete OK
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
