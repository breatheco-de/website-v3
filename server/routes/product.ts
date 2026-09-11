/**
 * Product REST API — GET/PUT /api/product/:slug (full sidecar).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { requireCapability } from "./_helpers";
import { getDefaultContentRoot } from "../site-config";
import { markFileAsModified } from "../sync-state";
import { productManager } from "../product/product-manager";
import {
  listProductRows,
  readEntryProduct,
  writeEntryProduct,
  writeEntryProductAudienceReplace,
} from "../product/product-io";
import {
  getPersonaFunnelUsage,
  getProductPersonaUsageMap,
} from "../product/product-audience-io";
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
      const contentType = typeof req.query.content_type === "string" ? req.query.content_type.trim() : undefined;
      const products = listProductRows({
        includePaused,
        ...(contentType ? { content_type: contentType } : {}),
      });
      res.json({
        products,
        education: {
          summary:
            "Purchasable CMS products (paused included by default). Audience status is missing|minimal|complete. Persona ids only — use GET /api/product/:slug for offer/avatar depth.",
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
        return res.status(404).json({ error: `No purchasable product for slug "${slug}"` });
      }
      const persona_usage = getProductPersonaUsageMap(slug, contentRoot);
      res.json({
        product: snapshot,
        audience: snapshot.offer || snapshot.personas
          ? { offer: snapshot.offer, personas: snapshot.personas }
          : null,
        status: snapshot.audience_status,
        persona_usage,
        education: {
          summary:
            "Product sidecar: offer, personas (avatar), and store visibility. Persona id is editable only when no funnel page binds it (creating a persona is not a binding). Label is always editable. Saving audience does not change page copy.",
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
          return res.status(404).json({ error: `No purchasable product for slug "${slug}"` });
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
        );
        if (!result.ok) {
          return res.status(400).json({
            error: result.error,
            code: result.code,
            details: result.details,
          });
        }
        markFileAsModified(result.relativePath, auth.author ?? "staff", undefined, contentRoot);
        return res.json({
          success: true,
          product: result.product,
          audience: {
            offer: result.product.offer,
            personas: result.product.personas,
          },
          status: result.product.audience_status,
          relativePath: result.relativePath,
          warnings: result.warnings,
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
    const auth = await requireCapability(req, res, "content_edit_structure", contentType);
    if (!auth.authorized) return;

    try {
      const contentRoot = getContentRoot(res);
      const result = writeEntryProduct(
        contentType,
        slug,
        {
          actively_selling: parsed.data.actively_selling,
          product_id: parsed.data.product_id,
          name: parsed.data.name,
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
        const status = result.code === "not_a_product" ? 404 : 400;
        return res.status(status).json({
          error: result.error,
          code: result.code,
          details: result.details,
        });
      }
      markFileAsModified(result.relativePath, auth.author ?? "staff", undefined, contentRoot);
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
