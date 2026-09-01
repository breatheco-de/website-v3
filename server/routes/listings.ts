import type { Express, Response } from "express";
import * as path from "path";
import { api } from "../rate-limit/api.js";
import { databaseManager, type DatabaseManager } from "../database";
import { getDefaultContentRoot } from "../site-config";
import {
  parseJsonQueryParam,
  searchListingItems,
  type ListingPermanentFilter,
} from "../listing-search";
import { child } from "../logger";
import { requireStaffSession } from "./_helpers";
import { resolveTestimonialsSectionPreview } from "../testimonials-section-preview";
import {
  TESTIMONIALS_LIMIT_DEFAULTS,
  type TestimonialsDynamicEntries,
  type TestimonialsSectionType,
} from "@shared/testimonials-listing";

const log = child({ module: "routes/listings" });

function getContentRoot(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

function getContentRootName(res: Response): string {
  const cr = getContentRoot(res);
  return path.isAbsolute(cr) ? path.relative(process.cwd(), cr) : cr;
}

function getDB(res: Response): DatabaseManager {
  return (res.locals.site as { database?: DatabaseManager } | undefined)?.database ?? databaseManager;
}

export function registerListingsRoutes(app: Express): void {
  api.get(
    app,
    "/api/listings/search",
    { rate: "publicRead" },
    async (req, res) => {
      try {
        const database = (req.query.database as string) || undefined;
        const contentType = (req.query.content_type as string) || undefined;
        const locale = (req.query.locale as string) || undefined;
        const q = (req.query.q as string) || undefined;
        const sort = (req.query.sort as string) || undefined;
        const limit = Math.min(Number(req.query.limit) || 100, 100);
        const contentRoot = getContentRootName(res);

        const filters = parseJsonQueryParam<ListingPermanentFilter[]>(
          req.query.filters,
          "filters",
        );
        const itemTemplate = parseJsonQueryParam<Record<string, unknown>>(
          req.query.item_template,
          "item_template",
        );
        const searchFields = parseJsonQueryParam<string[]>(
          req.query.search_fields,
          "search_fields",
        );

        const result = await searchListingItems({
          database,
          contentType,
          locale,
          q,
          limit,
          permanentFilters: filters,
          itemTemplate,
          searchFields,
          sort,
          contentRoot,
          db: getDB(res),
        });

        res.json({
          items: result.items,
          count: result.count,
          semantic: result.semantic,
          ...(result.scores && { scores: result.scores }),
          ...(result.fallback_reason && {
            fallback_reason: result.fallback_reason,
            fallback_message: result.fallback_message,
          }),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err }, "listing search error");
        if (msg.includes("Invalid JSON")) {
          res.status(400).json({ error: msg });
          return;
        }
        res.status(500).json({ error: msg });
      }
    },
  );

  api.get(
    app,
    "/api/listings/testimonials-section-preview",
    { rate: "publicRead" },
    async (req, res) => {
      try {
        const staff = await requireStaffSession(req, res);
        if (!staff.authorized) return;

        const sectionType = String(req.query.section_type ?? "").trim() as TestimonialsSectionType;
        if (!(sectionType in TESTIMONIALS_LIMIT_DEFAULTS)) {
          res.status(400).json({ error: "Invalid or missing section_type" });
          return;
        }

        const locale = String(req.query.locale ?? "en").trim() || "en";
        const dynamicEntries =
          parseJsonQueryParam<TestimonialsDynamicEntries>(
            req.query.dynamic_entries,
            "dynamic_entries",
          ) ?? {};
        const singleEntry = parseJsonQueryParam<Record<string, unknown>>(
          req.query.single_entry,
          "single_entry",
        );

        const contentRoot = getContentRootName(res);
        const result = await resolveTestimonialsSectionPreview({
          sectionType,
          locale,
          dynamicEntries,
          singleEntry,
          contentRoot,
          db: getDB(res),
        });

        res.json(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err }, "testimonials section preview error");
        if (msg.includes("Invalid JSON")) {
          res.status(400).json({ error: msg });
          return;
        }
        res.status(500).json({ error: msg });
      }
    },
  );
}
