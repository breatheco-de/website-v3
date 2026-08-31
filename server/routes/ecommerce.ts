/**
 * Ecommerce REST routes.
 *
 * GET  /api/ecommerce/products
 * GET  /api/ecommerce/product-map
 * GET  /api/ecommerce/events
 * GET  /api/ecommerce/funnel/:slug
 * PUT  /api/ecommerce/funnel/:slug (410 — membership is on page _common.yml)
 * GET  /api/ecommerce/products/:productId
 */

import type { Express, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { z } from "zod";
import { ecommerceManager } from "../ecommerce/ecommerce-manager";
import { getDefaultContentRoot } from "../site-config";
import { resolveComponentBehaviors } from "@shared/component-behaviors";
import { buildProductFunnelJourney } from "../ecommerce/funnel-journey";
import { FUNNEL_STAGES } from "@shared/funnel";
import { api } from "../rate-limit/api.js";
import { child } from "../logger";

const log = child({ module: "routes/ecommerce" });

const productIdSchema = z.object({
  productId: z.string().min(1).regex(/^[a-z0-9-_]+$/i),
});

const slugSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-_]+$/i),
});

const ECOMMERCE_EVENT_CATALOG = [
  {
    name: "view_item",
    wired: true,
    description: "Hero course (or product page) when a purchasable product resolves",
    sample: {
      event: "view_item",
      item_id: "program-ai-fluency",
      item_name: "AI Fluency",
      item_category: "program",
      program_id: "ai-fluency",
      component_type: "hero",
      component_variant: "course",
    },
  },
  {
    name: "add_to_cart",
    wired: true,
    description: "CTA with tracking=add_to_cart (e.g. payment-component / enrollment CTA)",
    sample: {
      event: "add_to_cart",
      item_id: "program-ai-flex",
      item_name: "AI Flex",
      item_category: "program",
      program_id: "ai-flex",
      item_list_name: "enrollment_selector",
      selected_plan_option: "basic",
      amount: "129",
      period_label: "/month",
      component_type: "enrollment_selector",
    },
  },
  {
    name: "view_item_list",
    wired: true,
    description: "enrollment_selector / pricing_plans when viewport-visible",
    sample: {
      event: "view_item_list",
      item_list_name: "enrollment_selector",
      program_id: "ai-fluency",
      item_id: "program-ai-fluency",
      item_name: "AI Fluency",
      item_category: "program",
      cohort_date: "2026-09-08",
      amount: "$250",
      component_type: "enrollment_selector",
    },
  },
  {
    name: "select_item",
    wired: true,
    description: "User changes program in enrollment_selector (debounced)",
    sample: {
      event: "select_item",
      program_id: "ai-fluency",
      item_id: "program-ai-fluency",
      item_name: "AI Fluency",
      item_category: "program",
      item_list_name: "enrollment_selector",
      cohort_date: "2026-09-08",
      amount: "$250",
      component_type: "enrollment_selector",
    },
  },
  {
    name: "click_begin_checkout",
    wired: true,
    description: "User clicks checkout CTA on enrollment_selector / hero",
    sample: {
      event: "click_begin_checkout",
      program_id: "ai-engineering",
      item_id: "program-ai-engineering",
      item_name: "AI Engineering",
      item_category: "program",
      item_list_name: "enrollment_selector",
      cohort_date: "2026-09-08",
      amount: "$250",
      addon_id: "job-guarantee",
      component_type: "enrollment_selector",
    },
  },
  {
    name: "begin_checkout",
    wired: false,
    description: "Off-site only (learn.4geeks checkout page). Not fired from this site.",
    sample: { event: "begin_checkout", item_id: "program-ai-fluency", note: "off-site (learn.4geeks)" },
  },
  {
    name: "purchase",
    wired: false,
    description: "Off-site only (checkout POS). Not fired from this site.",
    sample: { event: "purchase", item_id: "program-ai-fluency", note: "off-site" },
  },
] as const;

function scanEcommerceComponentUsage(): Array<{
  component_type: string;
  role?: string;
  events: string[];
  notes?: string;
}> {
  const usage: Array<{ component_type: string; role?: string; events: string[]; notes?: string }> = [];
  try {
    const root = getDefaultContentRoot();
    const registry = path.join(root, "component-registry");
    if (!fs.existsSync(registry)) return usage;
    for (const typeDir of fs.readdirSync(registry, { withFileTypes: true })) {
      if (!typeDir.isDirectory()) continue;
      const typePath = path.join(registry, typeDir.name);
      const versions = fs
        .readdirSync(typePath, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d/.test(d.name))
        .sort((a, b) => b.name.localeCompare(a.name));
      if (!versions[0]) continue;
      const schemaPath = path.join(typePath, versions[0].name, "schema.yml");
      if (!fs.existsSync(schemaPath)) continue;
      const parsed = yaml.load(fs.readFileSync(schemaPath, "utf-8"));
      if (!parsed || typeof parsed !== "object") continue;
      const behaviors = resolveComponentBehaviors(parsed as Record<string, unknown>);
      if (!behaviors.ecommerce) continue;
      usage.push({
        component_type: typeDir.name,
        role: behaviors.ecommerce.role,
        events: behaviors.ecommerce.events ?? [],
        notes: behaviors.ecommerce.notes,
      });
    }
  } catch (err) {
    log.warn({ err }, "[EcommerceRoutes] usage scan failed");
  }
  return usage;
}

export function registerEcommerceRoutes(app: Express): void {
  app.get("/api/ecommerce/products", (_req, res) => {
    try {
      const products = ecommerceManager.getAllProducts();
      res.json({ products, settings: ecommerceManager.getSettings() });
    } catch (err) {
      log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/products:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/ecommerce/product-map", (_req, res) => {
    try {
      const products = ecommerceManager.getAllProducts().map((p) => ({
        product_id: p.product_id,
        name: p.name,
        content_type: p.content_type,
        content_slug: p.content_slug,
        actively_selling: p.actively_selling,
        active: p.actively_selling,
      }));
      res.json({ products });
    } catch (err) {
      log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/product-map:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/ecommerce/events", (_req, res) => {
    try {
      res.json({
        events: ECOMMERCE_EVENT_CATALOG,
        usage: scanEcommerceComponentUsage(),
        product_count: ecommerceManager.getAllProducts().length,
        education: {
          summary:
            "Ecommerce funnel events are purchasable-gated. Call sites send selection fields; trackEcommerce resolves product identity from page funnel.products on _common.yml. Visitor session (user_id, geo, language, UTMs) is pushed once via setVisitorContext — not re-attached on every ecommerce event. Forms/conversions are separate. CMS does not manage billing plans. This site fires click_begin_checkout; begin_checkout and purchase are off-site (learn POS).",
          advanced_paths: [
            "docs/component-behaviors.md",
            "docs/gtm-analytics-setup.md",
            "mcp-server/explain/ecommerce.md",
            "client/src/lib/tracking.ts",
            "client/src/lib/ecommerceProgramId.ts",
            "client/src/lib/ecommerceProductMap.ts",
            "shared/component-behaviors.ts",
            "shared/resolveProductScope.ts",
            "shared/funnel.ts",
          ],
        },
      });
    } catch (err) {
      log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/events:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/ecommerce/funnel/:slug", (req, res) => {
    const parsed = slugSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid slug" });
    }
    try {
      const slug = parsed.data.slug;
      const product =
        ecommerceManager.findProductByCmsEntry("program", slug) ||
        ecommerceManager.getAllProducts().find((p) => p.content_slug === slug);
      if (!product) {
        return res.status(404).json({ error: `No purchasable product for slug "${slug}"` });
      }
      const resolved = ecommerceManager.resolveProduct(product.product_id);
      const journey = buildProductFunnelJourney(
        product.content_slug,
        product.content_type,
      );
      const usage = scanEcommerceComponentUsage();

      res.json({
        product: resolved,
        funnel: {
          locked: { ...journey.locked, source: "locked" as const },
          stages: journey.stages,
          stage_order: [...FUNNEL_STAGES],
          components: usage.map((u) => ({
            type: u.component_type,
            events: u.events,
            role: u.role,
          })),
        },
        education: {
          summary:
            "Conversion journey is a read-only query of pages whose _common.yml funnel.products includes this SKU (or all) and funnel.stage is set, grouped by stage. Edit membership on each page's Funnel tab — not here. The product page is always the locked decision step.",
          advanced_paths: [
            "{contentType}/{slug}/_common.yml → funnel.stage, funnel.products",
            "GET /api/content-types/:type/funnel/:slug",
            "server/ecommerce/funnel-journey.ts",
            "shared/funnel.ts",
            "mcp-server/explain/ecommerce.md",
          ],
        },
      });
    } catch (err) {
      log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/funnel/:slug:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  api.get(
    app,
    "/api/ecommerce/funnel/:slug/analytics",
    { rate: "publicRead" },
    async (req, res) => {
      const { requireCapability } = await import("./_helpers");
      const auth = await requireCapability(req, res, "metrics_view");
      if (!auth.authorized) return;

      const parsed = slugSchema.safeParse(req.params);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid slug" });
      }
      const modeRaw = typeof req.query.mode === "string" ? req.query.mode : "page_performance";
      const mode =
        modeRaw === "stage_flow" ? ("stage_flow" as const) : ("page_performance" as const);
      const daysRaw = typeof req.query.days === "string" ? Number(req.query.days) : 28;
      const days = Number.isFinite(daysRaw) ? daysRaw : 28;

      try {
        const slug = parsed.data.slug;
        const product =
          ecommerceManager.findProductByCmsEntry("program", slug) ||
          ecommerceManager.getAllProducts().find((p) => p.content_slug === slug);
        if (!product) {
          return res.status(404).json({ error: `No purchasable product for slug "${slug}"` });
        }
        const { getProductJourneyAnalytics } = await import("../ecommerce/journey-analytics");
        const analytics = await getProductJourneyAnalytics({
          productSlug: product.content_slug,
          productContentType: product.content_type,
          mode,
          days,
        });
        res.json(analytics);
      } catch (err) {
        log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/funnel/:slug/analytics:");
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  app.put("/api/ecommerce/funnel/:slug", (_req: Request, res: Response) => {
    res.status(410).json({
      error: "Product funnel membership moved to page _common.yml (funnel.stage + funnel.products).",
      action_required:
        "Open each page's Funnel tab in SEO modal, or PUT /api/content-types/:type/funnel/:slug.",
      property_path: "funnel.products",
    });
  });

  app.get("/api/ecommerce/products/:productId", (req, res) => {
    const parsed = productIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    try {
      const resolved = ecommerceManager.resolveProduct(parsed.data.productId);
      if (!resolved) {
        return res.status(404).json({ error: `Product "${parsed.data.productId}" not found` });
      }
      res.json({ product: resolved, settings: ecommerceManager.getSettings() });
    } catch (err) {
      log.error({ err }, `[EcommerceRoutes] GET /api/ecommerce/products/${parsed.data.productId}:`);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
