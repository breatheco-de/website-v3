/**
 * Product REST API — GET/PUT /api/product/:slug (full sidecar).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { requireCapability } from "./_helpers";
import { getDefaultContentRoot } from "../site-config";
import { markFileAsModified } from "../sync-state";
import {
  listProductRows,
  readEntryProduct,
  writeEntryProduct,
  writeEntryProductAudienceReplace,
} from "../product/product-io";
import {
  getPersonaFunnelUsage,
  getProductPersonaUsageMap,
  listFunnelBindingsForProduct,
} from "../product/product-audience-io";
import { loadTrackingKeyIndex } from "../product/tracking-key-index";
import { takenShortKeys } from "@shared/tracking-keys";
import { child } from "../logger";
import { api } from "../rate-limit/api";

const log = child({ module: "routes/product" });

function getContentRoot(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

const personaAvatarSchema = z.object({
  fears: z.array(z.string()).optional(),
  internal_dialogue: z.string().optional(),
  objections: z.array(z.string()).optional(),
  aspirational_identity: z.string().optional(),
  jobs_to_be_done: z.array(z.string()).optional(),
});

const personaPatchSchema = z.object({
  id: z.string().min(1),
  short_key: z.string().optional(),
  label: z.string().optional(),
  role: z.string().optional(),
  industry_or_context: z.string().optional(),
  demographics: z.string().optional(),
  buying_behavior: z.string().optional(),
  decision_criteria: z.array(z.string()).optional(),
  avatar: personaAvatarSchema.optional(),
});

const productPutSchema = z.object({
  content_type: z.string().default("program"),
  actively_selling: z.boolean().optional(),
  product_id: z.string().optional(),
  name: z.string().optional(),
  short_key: z.string().optional(),
  rename_short_key: z.boolean().optional(),
  description: z.union([z.string(), z.null()]).optional(),
  purchasable: z.boolean().optional(),
  offer: z
    .object({
      one_liner: z.string().optional(),
      who_its_for: z.string().optional(),
      who_its_not_for: z.string().optional(),
      outcomes: z.array(z.string()).optional(),
      differentiators: z.array(z.string()).optional(),
    })
    .optional(),
  personas: z.array(personaPatchSchema).optional(),
  clear_personas: z.array(z.string()).optional(),
  replace_personas: z.boolean().optional(),
});

/** Full audience replace (Store panel) — all fields required for each persona. */
const audienceReplaceSchema = z.object({
  content_type: z.string().default("program"),
  replace_personas: z.literal(true),
  rename_short_key: z.boolean().optional(),
  offer: z.object({
    one_liner: z.string(),
    who_its_for: z.string(),
    who_its_not_for: z.string().optional(),
    outcomes: z.array(z.string()).optional(),
    differentiators: z.array(z.string()).optional(),
  }),
  personas: z.array(
    z.object({
      id: z.string().min(1),
      short_key: z.string().optional(),
      label: z.string().optional(),
      role: z.string().min(1),
      industry_or_context: z.string().optional(),
      demographics: z.string().optional(),
      buying_behavior: z.string().optional(),
      decision_criteria: z.array(z.string()).optional(),
      avatar: z.object({
        fears: z.array(z.string()).default([]),
        internal_dialogue: z.string().default(""),
        objections: z.array(z.string()).default([]),
        aspirational_identity: z.string().optional(),
        jobs_to_be_done: z.array(z.string()).optional(),
      }),
    }),
  ),
});

export function registerProductRoutes(app: Express): void {
  api.get(app, "/api/product", { rate: "publicRead" }, async (req, res) => {
    try {
      const includePaused = String(req.query.include_paused ?? "true") !== "false";
      const includeRemoved = String(req.query.include_removed ?? "false") === "true";
      const contentType = typeof req.query.content_type === "string" ? req.query.content_type.trim() : undefined;
      const contentRoot = getContentRoot(res);
      const products = listProductRows({
        includePaused,
        includeRemoved,
        contentRoot,
        ...(contentType ? { content_type: contentType } : {}),
      });
      res.json({
        products,
        education: {
          summary:
            "CMS products. Paused included by default. Removed (not sellable) hidden unless include_removed=true. Audience status is missing|minimal|complete.",
          advanced_paths: ["programs/{slug}/_product.yml", "server/product/product-io.ts"],
        },
      });
    } catch (err) {
      log.error({ err }, "GET /api/product");
      res.status(500).json({ error: String(err) });
    }
  });

  api.get(app, "/api/product/:slug", { rate: "publicRead" }, async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      const contentType = String(req.query.content_type || "program").trim() || "program";
      const contentRoot = getContentRoot(res);
      const snapshot = readEntryProduct(contentType, slug, contentRoot);
      if (!snapshot) {
        return res.status(404).json({ error: `No product for slug "${slug}"` });
      }
      const persona_usage = getProductPersonaUsageMap(slug, contentRoot);
      const funnel_binding_pages = listFunnelBindingsForProduct(slug, contentRoot);
      const warnings: { code: string; message: string }[] = [];
      if (!snapshot.purchasable) {
        warnings.push({
          code: "not_sellable",
          message:
            "This product is not sellable right now (removed from the store index). Audience can still be edited. Make sellable again to restore selling. Distinct from paused.",
        });
      }
      const keyIndex = loadTrackingKeyIndex(contentRoot).products;
      res.json({
        product: snapshot,
        tracking_keys: {
          // Other products' keys plus every retired key; the editor suggests around these.
          taken_product: [...takenShortKeys(keyIndex, "product", { exceptProductSlug: slug })],
          taken_persona: [...takenShortKeys(keyIndex, "persona", { exceptProductSlug: slug })],
        },
        audience: snapshot.offer || snapshot.personas
          ? { offer: snapshot.offer, personas: snapshot.personas }
          : null,
        status: snapshot.audience_status,
        persona_usage,
        funnel_binding_pages,
        warnings,
        education: {
          summary: snapshot.purchasable
            ? "Product sidecar: offer, personas (avatar), and store visibility. Persona id is editable only when no funnel page binds it. Label is always editable."
            : "Product is not sellable (removed). Offer/personas remain. Make sellable to restore store index. Not the same as paused.",
          advanced_paths: [
            snapshot.relative_path,
            "shared/productAudience.ts",
            "page _common.yml → funnel.products[].persona",
          ],
        },
      });
    } catch (err) {
      log.error({ err }, "GET product");
      res.status(500).json({ error: String(err) });
    }
  });

  api.get(
    app,
    "/api/product/:slug/personas/:personaId/usage",
    { rate: "publicRead" },
    async (req, res) => {
      try {
        const slug = String(req.params.slug || "").trim();
        const personaId = String(req.params.personaId || "").trim();
        const contentType = String(req.query.content_type || "program").trim() || "program";
        if (!slug || !personaId) {
          return res.status(400).json({ error: "slug and personaId are required" });
        }
        const contentRoot = getContentRoot(res);
        const snapshot = readEntryProduct(contentType, slug, contentRoot);
        if (!snapshot) {
          return res.status(404).json({ error: `No product for slug "${slug}"` });
        }
        const usage = getPersonaFunnelUsage(contentType, slug, personaId, contentRoot);
        res.json(usage);
      } catch (err) {
        log.error({ err }, "GET product persona usage");
        res.status(500).json({ error: String(err) });
      }
    },
  );

  api.put(app, "/api/product/:slug", { rate: "staffWrite" }, async (req, res) => {
    const slug = String(req.params.slug || "").trim();
    const body = req.body ?? {};

    // Full audience replace path (Store Audience panel)
    if (body.replace_personas === true && body.offer && Array.isArray(body.personas)) {
      const parsed = audienceReplaceSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const contentType = parsed.data.content_type || "program";
      const auth = await requireCapability(req, res, "content_edit_structure", contentType);
      if (!auth.authorized) return;
      try {
        const contentRoot = getContentRoot(res);
        const result = writeEntryProductAudienceReplace(
          contentType,
          slug,
          { offer: parsed.data.offer, personas: parsed.data.personas },
          contentRoot,
          { renameShortKey: parsed.data.rename_short_key === true },
        );
        if (!result.ok) {
          return res.status(400).json({
            error: result.error,
            code: result.code,
            details: result.details,
          });
        }
        markFileAsModified(result.relativePath, auth.author ?? "staff", undefined, contentRoot);
        const warnings = [...(result.warnings ?? [])];
        if (!result.product.purchasable) {
          warnings.push({
            code: "not_sellable",
            message:
              "Audience saved, but this product is not sellable right now. Make sellable again to restore the store index.",
          });
        }
        return res.json({
          success: true,
          product: result.product,
          audience: {
            offer: result.product.offer,
            personas: result.product.personas,
          },
          status: result.product.audience_status,
          relativePath: result.relativePath,
          warnings,
        });
      } catch (err) {
        log.error({ err }, "PUT product audience replace");
        return res.status(500).json({ error: String(err) });
      }
    }

    const parsed = productPutSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const contentType = parsed.data.content_type || "program";
    const touchesSellable =
      parsed.data.purchasable !== undefined || parsed.data.actively_selling !== undefined;
    const touchesAudienceOrMeta =
      parsed.data.offer !== undefined ||
      parsed.data.personas !== undefined ||
      (parsed.data.clear_personas !== undefined && parsed.data.clear_personas.length > 0) ||
      parsed.data.replace_personas === true ||
      parsed.data.name !== undefined ||
      parsed.data.description !== undefined ||
      parsed.data.product_id !== undefined ||
      parsed.data.short_key !== undefined;

    let author = "staff";
    if (touchesSellable) {
      const auth = await requireCapability(req, res, "product_manage", contentType);
      if (!auth.authorized) return;
      author = auth.author ?? author;
    }
    if (touchesAudienceOrMeta || !touchesSellable) {
      const auth = await requireCapability(req, res, "content_edit_structure", contentType);
      if (!auth.authorized) return;
      author = auth.author ?? author;
    }

    try {
      const contentRoot = getContentRoot(res);
      const result = writeEntryProduct(
        contentType,
        slug,
        {
          actively_selling: parsed.data.actively_selling,
          product_id: parsed.data.product_id,
          name: parsed.data.name,
          short_key: parsed.data.short_key,
          rename_short_key: parsed.data.rename_short_key,
          description: parsed.data.description,
          purchasable: parsed.data.purchasable,
          offer: parsed.data.offer,
          personas: parsed.data.personas,
          clear_personas: parsed.data.clear_personas,
          replace_personas: parsed.data.replace_personas,
        },
        contentRoot,
      );
      if (!result.ok) {
        const status =
          result.code === "not_a_product" || result.code === "missing_entry" ? 404 : 400;
        return res.status(status).json({
          error: result.error,
          code: result.code,
          details: result.details,
        });
      }
      markFileAsModified(result.relativePath, author, undefined, contentRoot);
      res.json({
        success: true,
        product: result.product,
        status: result.product.audience_status,
        relativePath: result.relativePath,
        warnings: result.warnings,
      });
    } catch (err) {
      log.error({ err }, "PUT product");
      res.status(500).json({ error: String(err) });
    }
  });
}

/** @deprecated Use registerProductRoutes */
export const registerProductAudienceRoutes = registerProductRoutes;
