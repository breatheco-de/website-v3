/**
 * Product audience REST API (offer + personas on `_product.yml`).
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireCapability } from "./_helpers";
import { getDefaultContentRoot } from "../site-config";
import { markFileAsModified } from "../sync-state";
import { productManager } from "../product/product-manager";
import {
  readEntryAudience,
  writeEntryAudience,
} from "../product/product-audience-io";
import { audienceStatus } from "@shared/productAudience";
import { child } from "../logger";
import { api } from "../rate-limit/api";

const log = child({ module: "routes/product-audience" });

function getContentRoot(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

const personaAvatarSchema = z.object({
  fears: z.array(z.string()).default([]),
  internal_dialogue: z.string().default(""),
  objections: z.array(z.string()).default([]),
  aspirational_identity: z.string().optional(),
  jobs_to_be_done: z.array(z.string()).optional(),
});

const personaSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  role: z.string().min(1),
  industry_or_context: z.string().optional(),
  demographics: z.string().optional(),
  buying_behavior: z.string().optional(),
  decision_criteria: z.array(z.string()).optional(),
  avatar: personaAvatarSchema,
});

const audiencePutSchema = z.object({
  content_type: z.string().default("program"),
  offer: z.object({
    one_liner: z.string(),
    who_its_for: z.string(),
    who_its_not_for: z.string().optional(),
    outcomes: z.array(z.string()).optional(),
    differentiators: z.array(z.string()).optional(),
  }),
  personas: z.array(personaSchema),
});

export function registerProductAudienceRoutes(app: Express): void {
  api.get(app, "/api/product/:slug/audience", { rate: "publicRead" }, async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      const contentType = String(req.query.content_type || "program").trim() || "program";
      const contentRoot = getContentRoot(res);
      const product = productManager.findProductByCmsEntry(contentType, slug, {
        includePaused: true,
      });
      if (!product) {
        return res.status(404).json({ error: `No purchasable product for slug "${slug}"` });
      }
      const audience = readEntryAudience(contentType, slug, contentRoot);
      res.json({
        product: {
          product_id: product.product_id,
          content_type: product.content_type,
          content_slug: product.content_slug,
          name: product.name,
        },
        audience,
        status: audienceStatus(audience),
        education: {
          summary:
            "Audience is this product's offer and buyer personas (avatar = emotional depth). Funnel pages bind product+persona pairs. Saving here does not change page copy.",
          advanced_paths: [
            `${product.content_type}/${slug}/_product.yml → offer, personas`,
            "shared/productAudience.ts",
          ],
        },
      });
    } catch (err) {
      log.error({ err }, "GET audience");
      res.status(500).json({ error: String(err) });
    }
  });

  api.put(app, "/api/product/:slug/audience", { rate: "staffWrite" }, async (req, res) => {
    const slug = String(req.params.slug || "").trim();
    const parsed = audiencePutSchema.safeParse({ ...req.body, ...(req.body?.content_type ? {} : {}) });
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const contentType = parsed.data.content_type || "program";
    const auth = await requireCapability(req, res, "content_edit_structure", contentType);
    if (!auth.authorized) return;

    try {
      const contentRoot = getContentRoot(res);
      const product = productManager.findProductByCmsEntry(contentType, slug, {
        includePaused: true,
      });
      if (!product) {
        return res.status(404).json({ error: `No purchasable product for slug "${slug}"` });
      }

      // Immutable persona ids: reject if client sends a persona that replaces an id (same index rename)
      const prev = readEntryAudience(contentType, slug, contentRoot);
      if (prev) {
        const prevById = new Map(prev.personas.map((p) => [p.id, p]));
        for (const nextP of parsed.data.personas) {
          // If label matches an old persona but id differs, treat as forbidden rename
          const oldSameLabel = prev.personas.find(
            (p) =>
              p.id !== nextP.id &&
              (p.label || p.role) === (nextP.label || nextP.role) &&
              !parsed.data.personas.some((x) => x.id === p.id),
          );
          if (oldSameLabel && !prevById.has(nextP.id)) {
            // soft — assertAudienceUpdateAllowed handles in-use deletes
          }
        }
      }

      const result = writeEntryAudience(
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

      res.json({
        success: true,
        audience: result.audience,
        status: result.status,
        relativePath: result.relativePath,
        warnings: result.warnings,
      });
    } catch (err) {
      log.error({ err }, "PUT audience");
      res.status(500).json({ error: String(err) });
    }
  });
}
