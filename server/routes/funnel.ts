/**
 * REST routes for page-level funnel fields on _common.yml.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { productManager as ecommerceManager } from "../product/product-manager";
import {
  readFunnelBlockFromFile,
  commonYmlPath,
  prepareAndWriteFunnelMerge,
} from "../funnel-fields";
import {
  effectiveBindings,
  effectiveProducts,
  enrollmentIdsOutsideFunnel,
  funnelHasProductsWithoutStage,
  type FunnelBlock,
} from "@shared/funnel";
import { assertFunnelAudienceGates } from "../product/funnel-audience-gates";
import { audienceStatus } from "@shared/productAudience";
import { requireCapability } from "./_helpers";
import { getDefaultContentRoot } from "../site-config";
import { contentIndex } from "../content-index";
import { markFileAsModified } from "../sync-state";
import { child } from "../logger";
import { enrollmentCardIds } from "@shared/resolveProductScope";

const log = child({ module: "routes/funnel" });

function getContentRoot(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

const funnelBindingSchema = z.union([
  z.string(),
  z.object({
    product: z.string().optional(),
    slug: z.string().optional(),
    persona: z.string().optional().nullable(),
    persona_id: z.string().optional().nullable(),
  }),
]);

const funnelPutSchema = z.object({
  stage: z.string().optional().nullable(),
  products: z.union([z.literal("all"), z.array(funnelBindingSchema), z.null()]).optional(),
});

function resolveProductActive(slug: string): { active: boolean } | undefined {
  const p =
    ecommerceManager.findProductByCmsEntry("program", slug) ||
    ecommerceManager.getAllProducts().find((x) => x.content_slug === slug);
  if (!p) return undefined;
  return { active: p.actively_selling !== false };
}

function inactiveProductWarnings(funnel: FunnelBlock): { code: string; message: string }[] {
  const scope = effectiveProducts(funnel, {});
  if (!scope || scope === "all") return [];
  const warnings: { code: string; message: string }[] = [];
  for (const slug of scope) {
    const r = resolveProductActive(slug);
    if (!r?.active) {
      warnings.push({
        code: "inactive_product",
        message: `Product "${slug}" is unknown or not actively selling — skipped in Store and tracking.`,
      });
    }
  }
  return warnings;
}

function audienceWarningsForFunnel(
  funnel: FunnelBlock,
  ctx: { contentType: string; contentSlug: string },
): { code: string; message: string; action_required?: string }[] {
  const products = funnel.products;
  if (!products || products === "all") return [];
  const out: { code: string; message: string; action_required?: string }[] = [];
  for (const b of products) {
    const p =
      ecommerceManager.findProductByCmsEntry("program", b.product, { includePaused: true }) ||
      ecommerceManager.findProductByProgramId(b.product);
    if (!p) continue;
    const status = audienceStatus(p.audience);
    const isSelf = ctx.contentType === "program" && ctx.contentSlug === b.product;
    if (status === "missing") {
      out.push({
        code: "missing_product_audience",
        message: `Product "${b.product}" has no minimal audience — set offer + persona before relying on this binding.`,
        action_required: "missing_product_audience",
      });
    } else if (!b.persona && !isSelf) {
      out.push({
        code: "missing_funnel_persona",
        message: `Binding to "${b.product}" is missing persona — pick one on next save.`,
        action_required: "missing_funnel_persona",
      });
    }
  }
  return out;
}

function storeJourneyMembership(
  contentType: string,
  slug: string,
  funnel: FunnelBlock,
): { productSlug: string; stage: string; persona?: string }[] {
  const stage = typeof funnel.stage === "string" ? funnel.stage : "";
  if (!stage) return [];
  const bindings = effectiveBindings(funnel, { contentType, contentSlug: slug });
  if (!bindings) return [];

  const products = ecommerceManager.getAllProducts().filter((p) => p.actively_selling !== false);
  const out: { productSlug: string; stage: string; persona?: string }[] = [];
  if (bindings === "all") {
    for (const product of products) {
      out.push({ productSlug: product.content_slug, stage });
    }
    return out;
  }
  for (const b of bindings) {
    if (!products.some((p) => p.content_slug === b.product)) continue;
    out.push({
      productSlug: b.product,
      stage,
      ...(b.persona ? { persona: b.persona } : {}),
    });
  }
  return out;
}

export function registerFunnelRoutes(app: Express): void {
  app.get("/api/content-types/:type/funnel/:slug", async (req: Request, res: Response) => {
    try {
      const contentType = req.params.type;
      const slug = req.params.slug;
      const contentRoot = getContentRoot(res);
      const filePath = commonYmlPath(contentType, slug, contentRoot);
      const funnel = readFunnelBlockFromFile(filePath);
      const effective = effectiveProducts(funnel, { contentType, contentSlug: slug });
      const bindings = effectiveBindings(funnel, { contentType, contentSlug: slug });

      const enrollmentWarnings: { code: string; message: string; ids: string[] }[] = [];
      const merged = contentIndex.loadMergedContent(contentType, slug, "en");
      const sections = (merged.data as { sections?: unknown[] } | null)?.sections;
      if (Array.isArray(sections)) {
        const allCardIds: string[] = [];
        for (const sec of sections) {
          if (!sec || typeof sec !== "object") continue;
          allCardIds.push(...enrollmentCardIds(sec as Record<string, unknown>));
        }
        const outside = enrollmentIdsOutsideFunnel(allCardIds, funnel, {
          contentType,
          contentSlug: slug,
        });
        if (outside.length > 0) {
          enrollmentWarnings.push({
            code: "enrollment_outside_funnel",
            message:
              "Enrollment card program ids not in page funnel.products — allowed, but journey membership differs.",
            ids: outside,
          });
        }
      }

      const relPath = filePath.includes(contentRoot)
        ? filePath.slice(filePath.indexOf(contentRoot)).replace(/^\//, "")
        : filePath;

      res.json({
        funnel,
        effectiveProducts: effective ?? null,
        effectiveBindings: bindings ?? null,
        storeMembership: storeJourneyMembership(contentType, slug, funnel),
        warnings: [
          ...(funnelHasProductsWithoutStage(funnel)
            ? [
                {
                  code: "products_without_stage",
                  message:
                    "Products are set but stage is missing. Diagnostics counts Unknown; Store hides this page.",
                },
              ]
            : []),
          ...inactiveProductWarnings(funnel),
          ...audienceWarningsForFunnel(funnel, { contentType, contentSlug: slug }),
          ...enrollmentWarnings,
        ],
        relativePath: relPath,
      });
    } catch (err) {
      log.error({ err }, "GET funnel");
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-types/:type/funnel/:slug", async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "content_edit_structure", req.params.type);
    if (!auth.authorized) return;

    const parsed = funnelPutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    try {
      const contentType = req.params.type;
      const slug = req.params.slug;
      const contentRoot = getContentRoot(res);
      // Path-touched merge: omitted keys leave current; null clears.
      const body = parsed.data;
      const result = prepareAndWriteFunnelMerge(
        contentType,
        slug,
        {
          touchStage: body.stage !== undefined,
          stage: body.stage,
          touchProducts: body.products !== undefined,
          products: body.products,
        },
        contentRoot,
        assertFunnelAudienceGates,
      );
      if (!result.ok) {
        return res.status(400).json({
          error: result.error,
          code: result.code,
          details: result.details,
        });
      }

      if (result.relativePath) {
        markFileAsModified(result.relativePath, auth.author ?? "staff", undefined, contentRoot);
      }

      res.json({
        success: true,
        funnel: result.coerced,
        warnings: [
          ...result.warnings,
          ...inactiveProductWarnings(result.coerced),
        ],
        relativePath: result.relativePath,
      });
    } catch (err) {
      log.error({ err }, "PUT funnel");
      res.status(500).json({ error: String(err) });
    }
  });
}
